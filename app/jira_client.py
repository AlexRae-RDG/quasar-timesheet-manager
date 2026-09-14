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
"""
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Callable, List, Optional

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
    import keyring
    import keyring.errors
except ImportError:  # pragma: no cover -- see requests above
    keyring = None

# ---------------------------------------------------------------------------
# API token storage
# ---------------------------------------------------------------------------
# The token is a secret (unlike the plain settings this app otherwise keeps
# in its own SQLite `settings` table -- theme, display name, work hours,
# etc.), so it goes through the OS keychain via the `keyring` package
# instead: macOS Keychain, Windows Credential Locker, or the Secret
# Service/KWallet on Linux, whichever `keyring` finds available. Site URL
# and email aren't secrets on their own, so those two stay in the regular
# settings table (see main_window.py's _load_settings_panel) -- only the
# API token comes through here.
_KEYRING_SERVICE = "QUASAR Timesheet Manager - Jira Cloud"
_KEYRING_USERNAME = "jira_api_token"


class KeyringUnavailable(Exception):
    """Raised by store_api_token()/get_api_token() when no OS keychain
    backend could be found (the `keyring` package failed to import, or it
    imported but couldn't locate a usable backend -- both real
    possibilities in a PyInstaller-bundled app; see packaging/
    free_timesheet.spec's hiddenimports comment for why). Callers should
    catch this specifically and fall back to telling the user, rather than
    silently storing the token in plaintext anywhere."""


def store_api_token(token: str):
    if keyring is None:
        raise KeyringUnavailable("The 'keyring' package is not installed.")
    try:
        keyring.set_password(_KEYRING_SERVICE, _KEYRING_USERNAME, token)
    except keyring.errors.NoKeyringError as exc:
        raise KeyringUnavailable(str(exc)) from exc


def get_api_token() -> Optional[str]:
    """Returns None both when nothing has been stored yet AND when no
    keychain backend is available -- callers that need to tell those two
    cases apart (Settings' "is a token currently set?" indicator) should
    use has_stored_api_token() instead."""
    if keyring is None:
        return None
    try:
        return keyring.get_password(_KEYRING_SERVICE, _KEYRING_USERNAME)
    except keyring.errors.KeyringError:
        return None


def has_stored_api_token() -> bool:
    return bool(get_api_token())


def delete_api_token():
    if keyring is None:
        return
    try:
        keyring.delete_password(_KEYRING_SERVICE, _KEYRING_USERNAME)
    except keyring.errors.KeyringError:
        pass


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
