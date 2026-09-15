"""Parses a Jira CSV export (Issue Navigator -> Export -> CSV) into
candidate QDMs to review before adding them to this app -- see
app/panels.py's ImportQdmPanel and main_window.py's
_open_jira_csv_import_dialog for the review-then-create flow this feeds.
Nothing here touches the database directly (same separation as
export_csv.py's own build_row/export_entries) -- this only reads a file
and returns plain data for the caller to act on.

Deliberately tolerant of exactly which columns Jira included -- a raw
"Export CSV (all fields)" can run to 50+ columns depending on what's
configured in that Jira instance, and even "current fields" varies by
whatever's showing in the issue search view. Only two are ever read, by
header name rather than position, so column order/count/extras never
matter:

    "Issue key" (or just "Key") -- becomes the QDM's Jira Issue Key
    "Summary"                    -- becomes the QDM's Name

Every other column in the file -- Status, Assignee, Project, whatever
else Jira included -- is ignored outright. See the README's "Importing
QDMs from Jira" section for the JQL/export walkthrough this is meant to
consume (built around "assignee = currentUser()", one Jira issue per
QDM)."""
import csv
from dataclasses import dataclass, field
from typing import List, Optional, Set, Tuple

from . import config

_KEY_HEADER_CANDIDATES = {"issue key", "key"}
_SUMMARY_HEADER_CANDIDATES = {"summary"}


@dataclass
class ImportCandidate:
    """One CSV row that looks like a real, not-yet-added QDM -- exactly
    what ImportQdmPanel shows one review row for. `jira_key` is already
    the canonical full key (e.g. "QDM-1234", same shape
    config.jira_key_from_number produces) -- never just the number."""
    jira_key: str
    name: str


@dataclass
class ImportResult:
    candidates: List[ImportCandidate] = field(default_factory=list)
    # Already an Activity with this jira_key (see existing_jira_keys
    # below) -- including a second CSV row repeating a key the first row
    # in this same file already claimed.
    skipped_duplicate: int = 0
    # Had a value in the key column, but it didn't start with
    # config.JIRA_KEY_PREFIX at all -- most likely the Jira search wasn't
    # scoped to just this app's Jira project, so the export mixed in
    # other teams' issues.
    skipped_not_a_qdm_key: int = 0
    # The key column was present but blank on that row.
    skipped_blank_key: int = 0


class NotAJiraExport(Exception):
    """Raised by parse() when the file doesn't have a recognizable Issue-
    Key column at all -- see ImportQdmPanel/main_window.py's
    _open_jira_csv_import_dialog for how this is surfaced (a messagebox,
    same treatment jira_client.EncryptionUnavailable and db.py's
    restore_from ValueError get at their own call sites) rather than a
    bare traceback for what's almost always just the wrong file picked."""


def _find_header(fieldnames: Optional[List[str]], candidates: Set[str]) -> Optional[str]:
    if not fieldnames:
        return None
    for name in fieldnames:
        if name and name.strip().lower() in candidates:
            return name
    return None


def _classify_rows(rows, existing_jira_keys: Set[str]) -> ImportResult:
    """The actual "does this row become a QDM" rules, shared by every
    source of rows -- a CSV export (parse(), below) and a live Jira API
    search (from_api_results(), below) alike -- so a CSV import and an
    API import can never quietly apply different rules for what counts
    as a duplicate or a valid QDM key. rows is any iterable of
    (raw_key, summary) pairs.

    existing_jira_keys must already be canonical, upper-cased full keys
    (e.g. {"QDM-1234", ...}) -- see main_window.py's
    _open_jira_csv_import_dialog for how it's built from
    Database.list_activities(include_archived=True). Archived QDMs count
    as "already have this one" same as active ones do, so re-importing
    the same export twice (or an overlapping one) never creates a second
    copy of something that was only archived, not deleted."""
    result = ImportResult()
    seen_this_batch: Set[str] = set()
    prefix = config.JIRA_KEY_PREFIX.upper()

    for raw_key, summary in rows:
        raw_key = (raw_key or "").strip()
        if not raw_key:
            result.skipped_blank_key += 1
            continue
        if not raw_key.upper().startswith(prefix):
            result.skipped_not_a_qdm_key += 1
            continue
        number = raw_key[len(config.JIRA_KEY_PREFIX):].strip()
        if not number:
            result.skipped_not_a_qdm_key += 1
            continue
        full_key = config.JIRA_KEY_PREFIX + number
        canonical = full_key.upper()
        if canonical in existing_jira_keys or canonical in seen_this_batch:
            result.skipped_duplicate += 1
            continue
        seen_this_batch.add(canonical)
        summary = (summary or "").strip()
        result.candidates.append(ImportCandidate(jira_key=full_key, name=summary or full_key))

    return result


def parse(csv_path: str, existing_jira_keys: Set[str]) -> ImportResult:
    """existing_jira_keys -- see _classify_rows above.

    encoding="utf-8-sig" rather than "utf-8" -- Jira's own CSV export
    starts with a UTF-8 byte-order mark; plain utf-8 would leave it stuck
    to the front of the first header name, silently breaking the "Issue
    key"/"Summary" header match for a file that opens and looks fine in
    every spreadsheet app (they all strip it invisibly, which is exactly
    why this needs to as well)."""
    with open(csv_path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        key_header = _find_header(reader.fieldnames, _KEY_HEADER_CANDIDATES)
        summary_header = _find_header(reader.fieldnames, _SUMMARY_HEADER_CANDIDATES)
        if key_header is None:
            raise NotAJiraExport(
                'No "Issue key" column found in that file. Make sure it’s a CSV '
                "exported from Jira’s own issue search (Export → CSV), not "
                "something else.")

        rows = ((row.get(key_header) or "",
                 (row.get(summary_header) or "") if summary_header else "")
                for row in reader)
        return _classify_rows(rows, existing_jira_keys)


def from_api_results(issues: List[Tuple[str, str]], existing_jira_keys: Set[str]) -> ImportResult:
    """The direct-API sibling of parse() -- same filtering (dedup, QDM-key
    validation, blank-key handling), just fed (issue_key, summary) pairs
    from jira_client.search_issues() instead of CSV rows, so
    main_window.py's _open_jira_api_import produces exactly the same
    kind of ImportResult the CSV route does and can hand it to the same
    ImportQdmPanel review screen unchanged."""
    return _classify_rows(issues, existing_jira_keys)
