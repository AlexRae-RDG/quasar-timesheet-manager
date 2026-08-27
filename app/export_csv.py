"""
Timesheet CSV export, matching the column structure Jira expects for the
worklog CSV imports used with this workspace:

    Project, Issue Type, Key, Date Started, Display Name, Time Spent (h), Work Description

Each output row is one time block. Only blocks with a Jira Issue Key are
exported (Jira needs an existing issue to attach a worklog to); entries
without one are reported back to the caller so the UI can warn the user.

The CSV's "Project" column is the Jira project this exports under (e.g.
"Quasar Delivery Management") -- called `jira_project` internally (not just
"project") so it doesn't collide with either of this app's own "Project"-ish
concepts: an Activity (the loggable thing dragged onto the calendar) and a
Project (the group an Activity belongs to, which sets its time blocks'
color). It's fixed for the scope of this app -- every row exports under the same
Jira project and issue type (see app/config.py's DEFAULT_JIRA_PROJECT/
DEFAULT_ISSUE_TYPE) -- so a block only needs to set its own if it's ever
logged against something different than usual:

    block's own Jira Project/Issue Type
    -> else the activity's Jira Project/Issue Type (copied onto the block
       when it was created/duplicated from that activity)
    -> else this app's fixed defaults (config.DEFAULT_JIRA_PROJECT /
       config.DEFAULT_ISSUE_TYPE)
"""
import csv
from typing import List, Tuple

from . import config
from .models import TimeEntry

CSV_HEADER = ["Project", "Issue Type", "Key", "Date Started", "Display Name",
              "Time Spent (h)", "Work Description"]


def format_time_spent(minutes: int) -> str:
    """90 -> '1h 30m', 30 -> '0h 30m' -- matches the 'Xh YYm' style Jira uses."""
    hours, mins = divmod(max(0, minutes), 60)
    return f"{hours}h {mins:02d}m"


def build_row(entry: TimeEntry, display_name: str) -> List[str]:
    jira_project = (entry.jira_project or config.DEFAULT_JIRA_PROJECT).strip()
    issue_type = (entry.issue_type or config.DEFAULT_ISSUE_TYPE).strip()
    key = (entry.jira_key or "").strip()
    date_started = f"{entry.date} 00:00:00"
    description = (entry.notes or entry.activity_name or "").replace("\n", " ").strip()
    return [
        jira_project,
        issue_type,
        key,
        date_started,
        (display_name or "").strip(),
        format_time_spent(entry.duration_minutes()),
        description,
    ]


def export_entries(
    entries: List[TimeEntry],
    filepath: str,
    display_name: str,
) -> Tuple[int, List[TimeEntry]]:
    """
    Write `entries` to `filepath` as a timesheet CSV.

    Returns (rows_written, skipped_entries) where skipped_entries are those
    without a Jira Issue Key (and therefore not written).
    """
    exportable = [e for e in entries if e.jira_key and e.jira_key.strip()]
    skipped = [e for e in entries if not (e.jira_key and e.jira_key.strip())]

    # Most-recent-day-first, chronological within a day (Python's sort is
    # stable, so sorting by start_time first and then by date preserves the
    # within-day order).
    exportable.sort(key=lambda e: e.start_time)
    exportable.sort(key=lambda e: e.date, reverse=True)

    with open(filepath, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(CSV_HEADER)
        for e in exportable:
            writer.writerow(build_row(e, display_name))

    return len(exportable), skipped
