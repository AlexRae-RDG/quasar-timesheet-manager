"""Direct-to-Jira worklog upload (Jira Cloud only) -- the alternative to
app/export_csv.py's "download a CSV, then import it by hand in Jira" flow.
Posts one REST API call per time entry instead:

    POST https://<site>.atlassian.net/rest/api/3/issue/{issueKey}/worklog

Deliberately not a webhook -- Jira has no "push a worklog at me" webhook to
receive; this is the same REST API a human importing a CSV eventually
triggers under the hood, just called directly instead of going through
Jira's own CSV importer UI. Jira Server/Data Center use a different API
path entirely and are out of scope -- this app was scoped for Jira Cloud
only (see the "Uploading directly to Jira" section in the README).

Mirrors export_csv.py's own field-mapping/fallback rules on purpose (same
Jira Project / Issue Type fallback chain, same notes-or-activity-name
Work Description) so a given time entry produces the same Jira content
whichever of the two upload paths is used.

Also holds search_issues() -- the direct-API sibling of
app/jira_csv_import.py's CSV-based import, fetching QDMs straight from

    POST https://<site>.atlassian.net/rest/api/3/search/jql

instead of asking someone to export a CSV from Jira's UI by hand first.
That's the *current* Jira Cloud search endpoint -- Atlassian fully
removed the older `/rest/api/3/search` endpoint, and this one paginates
with a `nextPageToken` (absent once you've hit the last page) instead of
the old `startAt`/`total` scheme.
"""
import os
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Callable, List, Optional, Tuple

from .models import TimeEntry

try:
    import requests
except ImportError:  # pragma: no cover -- exercised only via a genuinely
    # missing dependency; requests is a hard requirement listed in
    # requirements.txt, but this keeps import-time failures readable
    # (see main_window.py's _do_jira_upload) instead of a bare traceback
    # if someone runs from source without installing it first.
    requests = None

try:
    from cryptography.fernet import Fernet, InvalidToken
except ImportError:  # pragma: no cover -- see requests above; cryptography
    # is a hard requirement listed in requirements.txt (and PyInstaller
    # bundles it via its own built-in hook -- no hiddenimports workaround
    # needed here, unlike the old keyring dependency this replaced).
    Fernet = None
    InvalidToken = Exception  # never actually raised while Fernet is None

# ---------------------------------------------------------------------------
# API token storage
# ---------------------------------------------------------------------------
# This used to go through the OS keychain (macOS Keychain / Windows
# Credential Locker / Secret Service or KWallet on Linux) via the
# `keyring` package, same as a browser's saved-password store. In
# practice that made the token itself unreliable to hold onto: an
# unsigned, frequently-rebuilt desktop app isn't a stable "identity" as
# far as a keychain is concerned, so entries could stop resolving after a
# rebuild or a reinstall -- and regenerating a token means a full trip
# back through Atlassian's own token-creation flow (see the README's
# "Getting a Jira API token" walkthrough), which is exactly the kind of
# repeat effort this was supposed to avoid.
#
# A plain local-database write (the very next version of this) fixed the
# reliability problem but gave up too much: the token sat in plain text
# in the same `settings` table as everything else Database stores, which
# meant Database.backup_to() -- BackupPanel's "Backup & Restore…" -- would
# happily copy it into a shared/emailed backup file along with it.
#
# So the token itself is still a `settings` row (same table, same file --
# still survives a rebuild/reinstall exactly as reliably as the rest of
# your data), but now it's a Fernet-encrypted value rather than the raw
# string, and the *decryption key* lives in its own separate file next to
# the database (see _key_path) instead of inside it. That's the actual
# security property this buys: backup_to()/restore_from() only ever touch
# the database file, so a shared or backed-up copy carries nothing but
# ciphertext -- useless without the key file, which never leaves the
# machine that created it. It's still not OS-keychain-strength (anyone
# with read access to both files on THIS machine can decrypt it -- there's
# no separate password gate the way a keychain prompts for one), but it
# closes the "I sent someone my backup file" leak while staying exactly
# as easy to update as before: Settings' "Save API Token"/"Save"/"Clear
# stored token" all work unchanged, with the encrypt/decrypt happening
# transparently in here.
_TOKEN_SETTING_KEY = "jira_api_token"
_KEY_FILENAME = ".jira_token.key"
_ENCRYPTED_PREFIX = "enc:1:"


class EncryptionUnavailable(Exception):
    """Raised by store_api_token() when the 'cryptography' package isn't
    installed -- only reachable running from source without `pip install
    -r requirements.txt` first; a packaged build always bundles it (see
    the import block above). Callers should catch this specifically and
    tell the user, same idea as the old KeyringUnavailable this replaces."""


def _key_path(db) -> str:
    """Deliberately a sibling of the database file (see db.path) rather
    than a `settings` row -- see this section's own comment above for why
    that's the whole point: Database.backup_to()'s snapshot never
    includes it."""
    return os.path.join(os.path.dirname(os.path.abspath(db.path)), _KEY_FILENAME)


def _get_or_create_key(db) -> bytes:
    path = _key_path(db)
    if os.path.exists(path):
        with open(path, "rb") as f:
            return f.read().strip()
    key = Fernet.generate_key()
    with open(path, "wb") as f:
        f.write(key)
    try:
        # Best-effort owner-only read/write. Windows' ACL model doesn't
        # map onto Unix permission bits the way chmod expects, but the
        # file already lives under the user's own profile directory there
        # either way, which is the normal protection Windows gives it.
        os.chmod(path, 0o600)
    except OSError:
        pass
    return key


def store_api_token(db, token: str):
    if Fernet is None:
        raise EncryptionUnavailable("The 'cryptography' package is not installed.")
    key = _get_or_create_key(db)
    encrypted = Fernet(key).encrypt(token.encode("utf-8")).decode("ascii")
    db.set_setting(_TOKEN_SETTING_KEY, _ENCRYPTED_PREFIX + encrypted)


def get_api_token(db) -> Optional[str]:
    """Returns None when nothing's been stored yet, and also when what IS
    stored can't be decrypted with this machine's key -- e.g. a database
    restored from a backup made on a different machine (see _key_path's
    comment: the key file itself never travels with a backup). Both read
    the same as "no token" to callers; a clear "paste it again" beats a
    confusing Jira auth failure built from garbage ciphertext.

    Also transparently upgrades a plain-text value left over from the
    version of this app that stored tokens unencrypted -- recognized by
    the missing _ENCRYPTED_PREFIX -- re-saving it through store_api_token
    the first time it's read, with no action needed from the user."""
    raw = db.get_setting(_TOKEN_SETTING_KEY, "") or ""
    if not raw:
        return None
    if not raw.startswith(_ENCRYPTED_PREFIX):
        if Fernet is not None:
            try:
                store_api_token(db, raw)
            except EncryptionUnavailable:
                pass
        return raw
    if Fernet is None:
        return None
    try:
        key = _get_or_create_key(db)
        ciphertext = raw[len(_ENCRYPTED_PREFIX):].encode("ascii")
        return Fernet(key).decrypt(ciphertext).decode("utf-8")
    except InvalidToken:
        return None


def has_stored_api_token(db) -> bool:
    return bool(get_api_token(db))


def delete_api_token(db):
    # No real "delete a setting" op on Database -- an empty string reads
    # back as falsy through get_api_token/has_stored_api_token exactly
    # like a never-set one would, same convention config.DEFAULT_JIRA_*
    # relies on elsewhere for "nothing saved yet". The key file is left
    # in place -- harmless with nothing left to decrypt, and reused as-is
    # if a new token is saved afterward.
    db.set_setting(_TOKEN_SETTING_KEY, "")


# ---------------------------------------------------------------------------
# Credentials + payload building
# ---------------------------------------------------------------------------
@dataclass
class JiraCredentials:
    site_url: str   # e.g. "https://yourteam.atlassian.net" (scheme required)
    email: str
    api_token: str


def normalize_site_url(raw: str) -> str:
    """Accepts either "yourteam.atlassian.net" or a full
    "https://yourteam.atlassian.net" (with or without a trailing slash) --
    Settings' Site URL field doesn't force the user to type the scheme."""
    raw = (raw or "").strip().rstrip("/")
    if not raw:
        return raw
    if not re.match(r"^https?://", raw, re.IGNORECASE):
        raw = f"https://{raw}"
    return raw


def _worklog_url(site_url: str, issue_key: str) -> str:
    return f"{normalize_site_url(site_url)}/rest/api/3/issue/{issue_key}/worklog"


def _started_timestamp(entry: TimeEntry) -> str:
    """Jira's worklog `started` field wants
    "yyyy-MM-dd'T'HH:mm:ss.SSSZ" (e.g. "2026-08-24T09:00:00.000+0000").
    Built from the entry's own date/start_time in the machine's local
    timezone -- there's no per-entry timezone stored anywhere in this app,
    so "whatever timezone this computer is in" is the only sensible
    reading of a locally-entered "9:00 AM" block."""
    hour, minute = (int(x) for x in entry.start_time.split(":"))
    year, month, day = (int(x) for x in entry.date.split("-"))
    local_dt = datetime(year, month, day, hour, minute)
    offset = local_dt.astimezone().strftime("%z") or "+0000"
    return local_dt.strftime("%Y-%m-%dT%H:%M:%S.000") + offset


def _adf_comment(text: str) -> dict:
    """Wraps plain text in the minimal Atlassian Document Format the v3
    API requires for the worklog `comment` field -- a v2-style plain
    string is rejected outright, not just downgraded. A single paragraph
    is all export_csv.py's own Work Description column ever needed, so
    that's all this builds."""
    return {
        "type": "doc",
        "version": 1,
        "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": text}]}
        ],
    }


def _work_description(entry: TimeEntry) -> str:
    # Same fallback export_csv.build_row uses: notes, or the activity name
    # if there are no notes, newlines flattened to spaces.
    return (entry.notes or entry.activity_name or "").replace("\n", " ").strip()


def build_worklog_payload(entry: TimeEntry) -> dict:
    return {
        "started": _started_timestamp(entry),
        "timeSpentSeconds": entry.duration_minutes() * 60,
        "comment": _adf_comment(_work_description(entry)),
    }


# ---------------------------------------------------------------------------
# Upload
# ---------------------------------------------------------------------------
@dataclass
class JiraUploadResult:
    entry: TimeEntry
    success: bool
    error: Optional[str] = None


def upload_entries(credentials: JiraCredentials, entries: List[TimeEntry],
                    on_progress: Optional[Callable[[int, int], None]] = None,
                    timeout: float = 15.0) -> List[JiraUploadResult]:
    """POSTs one worklog per entry, sequentially (these are weekly-sized
    batches -- tens of entries at most -- so a simple blocking loop is
    plenty; see main_window.py's _do_jira_upload for how the confirm-count
    step keeps a user from accidentally kicking off a huge one). Every
    entry gets its own try/except so one bad row (an issue key that no
    longer exists, a transient network blip) can't abort the rest of the
    batch -- results carry each entry's own outcome, and it's up to the
    caller (again _do_jira_upload) to decide what to tell the user and
    which ones to mark uploaded.

    entries is assumed to already be filtered to ones with a real
    jira_key and not already uploaded -- this function doesn't re-check
    either, so it will happily re-post a duplicate if asked to; that
    filtering is the caller's job (see the module docstring's mirroring
    of export_csv.py's own division of responsibility)."""
    if requests is None:
        raise RuntimeError("The 'requests' package is not installed.")

    results: List[JiraUploadResult] = []
    auth = (credentials.email, credentials.api_token)
    headers = {"Accept": "application/json", "Content-Type": "application/json"}

    for i, entry in enumerate(entries):
        issue_key = (entry.jira_key or "").strip()
        try:
            resp = requests.post(
                _worklog_url(credentials.site_url, issue_key),
                json=build_worklog_payload(entry),
                auth=auth, headers=headers, timeout=timeout,
            )
            if resp.status_code == 201:
                results.append(JiraUploadResult(entry=entry, success=True))
            else:
                detail = (resp.text or "").strip()
                if len(detail) > 300:
                    detail = detail[:300] + "…"
                results.append(JiraUploadResult(
                    entry=entry, success=False,
                    error=f"HTTP {resp.status_code}: {detail or resp.reason}"))
        except requests.RequestException as exc:
            results.append(JiraUploadResult(entry=entry, success=False, error=str(exc)))

        if on_progress is not None:
            on_progress(i + 1, len(entries))

    return results


# ---------------------------------------------------------------------------
# Search (direct-API alternative to the CSV export/import round trip)
# ---------------------------------------------------------------------------
def _search_url(site_url: str) -> str:
    return f"{normalize_site_url(site_url)}/rest/api/3/search/jql"


class JiraSearchError(Exception):
    """Raised by search_issues() for anything that stops the search short
    of a full result set -- a missing 'requests' install, a non-200
    response (bad JQL, an expired/invalid API token, ...), or a network
    error. One exception type rather than upload_entries()'s per-item
    JiraUploadResult list, because a search is a single logical operation
    (you either get the matching QDMs or you don't) rather than a batch
    where some items can succeed while others fail."""


def search_issues(credentials: JiraCredentials, jql: str, max_results: int = 100,
                   timeout: float = 15.0) -> List[Tuple[str, str]]:
    """Returns every (issue_key, summary) pair the given JQL matches,
    handling pagination transparently -- callers get one flat list, same
    shape jira_csv_import.from_api_results() expects.

    Uses the same email + API token Basic auth as upload_entries() (a
    Jira API token authenticates both reading and writing), so this only
    works once someone has saved a token in Settings -> Jira Cloud
    Upload -- unlike main_window.py's _open_jira_csv_import_dialog/
    _open_jira_export_page route, which only needs the browser signed
    into Jira, never a saved token. That's a real trade-off, not a bug:
    this is the faster path for anyone who's already set up direct
    upload, not a replacement for the no-setup-required CSV route.

    POST (not GET) even though this JQL easily fits in a URL -- the
    request body form is what Atlassian's own migration guidance for
    this endpoint recommends to sidestep URL-length/encoding edge cases
    entirely, and it costs nothing here since this is already a JSON
    API call."""
    if requests is None:
        raise JiraSearchError("The 'requests' package is not installed.")

    auth = (credentials.email, credentials.api_token)
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    issues: List[Tuple[str, str]] = []
    next_page_token: Optional[str] = None

    while True:
        body = {"jql": jql, "maxResults": max_results, "fields": ["summary"]}
        if next_page_token:
            body["nextPageToken"] = next_page_token
        try:
            resp = requests.post(_search_url(credentials.site_url), json=body,
                                  auth=auth, headers=headers, timeout=timeout)
        except requests.RequestException as exc:
            raise JiraSearchError(str(exc)) from exc

        if resp.status_code != 200:
            detail = (resp.text or "").strip()
            if len(detail) > 300:
                detail = detail[:300] + "…"
            raise JiraSearchError(f"HTTP {resp.status_code}: {detail or resp.reason}")

        data = resp.json()
        for issue in data.get("issues", []):
            key = (issue.get("key") or "").strip()
            if not key:
                continue
            summary = ((issue.get("fields") or {}).get("summary") or "").strip()
            issues.append((key, summary))

        # No isLast flag on this endpoint (Atlassian's own migration notes
        # for it) -- the absence of nextPageToken IS the "last page"
        # signal.
        next_page_token = data.get("nextPageToken")
        if not next_page_token:
            break

    return issues


# ---------------------------------------------------------------------------
# Credential verification (instant feedback when Settings -> Save is clicked)
# ---------------------------------------------------------------------------
class JiraConnectionError(Exception):
    """Raised by verify_credentials() when Jira rejects the credentials, or
    can't be reached at all -- distinct from JiraSearchError/JiraUploadResult
    because this always means "the credentials themselves are the problem",
    never "some items failed"."""


def verify_credentials(credentials: JiraCredentials, timeout: float = 10.0) -> str:
    """Calls Jira Cloud's GET /rest/api/3/myself -- the standard, side-effect
    -free "who am I" endpoint -- to confirm the Site URL / Email / API Token
    combination actually works, and returns the authenticated user's display
    name on success (so Settings can show "Connected as Alex Rae" rather than
    a bare "it worked").

    Used from main_window.py's _save_jira_api_token() to give new users
    instant, specific feedback right when they click Save in Settings,
    instead of only finding out their token/email/site is wrong the first
    time they click "Upload to JIRA via API" or "Import QDM via API" --
    the actual goal being that these buttons work first time.

    Raises JiraConnectionError with a message meant to be shown directly
    in the UI -- distinguishing "bad credentials" (401/403) from "bad site
    URL / network problem" (anything else) since those need different
    fixes from the user."""
    if requests is None:
        raise JiraConnectionError("The 'requests' package is not installed.")

    site_url = normalize_site_url(credentials.site_url)
    if not site_url:
        raise JiraConnectionError("Enter a Jira Site URL first.")
    if not credentials.email:
        raise JiraConnectionError("Enter your Jira account Email first.")
    if not credentials.api_token:
        raise JiraConnectionError("Enter an API Token first.")

    auth = (credentials.email, credentials.api_token)
    headers = {"Accept": "application/json"}
    url = f"{site_url}/rest/api/3/myself"
    try:
        resp = requests.get(url, auth=auth, headers=headers, timeout=timeout)
    except requests.RequestException as exc:
        raise JiraConnectionError(
            f"Couldn't reach {credentials.site_url or '(no site set)'} -- {exc}") from exc

    if resp.status_code == 200:
        data = resp.json()
        return (data.get("displayName") or credentials.email or "").strip()

    if resp.status_code in (401, 403):
        raise JiraConnectionError(
            "Jira rejected these credentials -- check your Email and API Token.")

    detail = (resp.text or "").strip()
    if len(detail) > 200:
        detail = detail[:200] + "…"
    raise JiraConnectionError(
        f"HTTP {resp.status_code} from Jira -- check your Site URL. {detail or resp.reason}")
