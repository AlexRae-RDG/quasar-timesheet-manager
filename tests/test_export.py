"""Standalone tests for app.export_csv -- no Tkinter required."""
import csv
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.export_csv import export_entries, build_row, format_time_spent, CSV_HEADER
from app.models import TimeEntry


def make_entry(**kwargs):
    defaults = dict(
        id=1, activity_id=1, activity_name="Sprint Planning", jira_key="PROJ-1",
        color="#4C6EF5", date="2026-08-24", start_time="09:00", end_time="10:00",
        notes="", jira_project=None, issue_type=None,
    )
    defaults.update(kwargs)
    return TimeEntry(**defaults)


class TestExport(unittest.TestCase):
    def test_format_time_spent(self):
        self.assertEqual(format_time_spent(60), "1h 00m")
        self.assertEqual(format_time_spent(30), "0h 30m")
        self.assertEqual(format_time_spent(20), "0h 20m")
        self.assertEqual(format_time_spent(150), "2h 30m")

    def test_build_row_uses_entry_project_and_issue_type_when_set(self):
        e = make_entry(jira_project="Quasar Delivery Management", issue_type="Sub-task",
                        notes="Photocard test condition analysis")
        row = build_row(e, "Alex Rae", default_jira_project="Fallback Project",
                         default_issue_type="Task")
        self.assertEqual(row, [
            "Quasar Delivery Management", "Sub-task", "PROJ-1", "2026-08-24 00:00:00",
            "Alex Rae", "1h 00m", "Photocard test condition analysis",
        ])

    def test_build_row_falls_back_to_defaults_when_entry_has_none(self):
        e = make_entry(jira_project=None, issue_type=None, notes="")
        row = build_row(e, "Alex Rae", default_jira_project="Quasar Delivery Management",
                         default_issue_type="Sub-task")
        self.assertEqual(row[0], "Quasar Delivery Management")
        self.assertEqual(row[1], "Sub-task")
        # No notes -> falls back to the activity name for Work Description.
        self.assertEqual(row[6], "Sprint Planning")

    def test_build_row_issue_type_falls_back_to_task_when_nothing_set(self):
        e = make_entry(jira_project=None, issue_type=None)
        row = build_row(e, "Alex Rae", default_jira_project="", default_issue_type="")
        self.assertEqual(row[0], "")
        self.assertEqual(row[1], "Task")

    def test_newlines_in_notes_sanitized_in_work_description(self):
        e = make_entry(notes="Fixed bug\nwrote tests")
        row = build_row(e, "Alex Rae", "", "")
        self.assertEqual(row[6], "Fixed bug wrote tests")

    def test_skips_entries_without_jira_key(self):
        e1 = make_entry(id=1, jira_key="PROJ-1")
        e2 = make_entry(id=2, jira_key=None, activity_name="No Jira Key Task")
        e3 = make_entry(id=3, jira_key="   ")
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "out.csv")
            written, skipped = export_entries([e1, e2, e3], path, "Alex Rae")
            self.assertEqual(written, 1)
            self.assertEqual(len(skipped), 2)

    def test_csv_header_and_row_shape(self):
        e = make_entry(jira_project="Quasar Delivery Management", issue_type="Sub-task")
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "out.csv")
            export_entries([e], path, "Alex Rae")
            with open(path, newline="", encoding="utf-8") as f:
                rows = list(csv.reader(f))
        self.assertEqual(rows[0], CSV_HEADER)
        self.assertEqual(rows[0], ["Project", "Issue Type", "Key", "Date Started",
                                    "Display Name", "Time Spent (h)", "Work Description"])
        self.assertEqual(rows[1][0], "Quasar Delivery Management")
        self.assertEqual(rows[1][1], "Sub-task")
        self.assertEqual(rows[1][2], "PROJ-1")
        self.assertEqual(rows[1][3], "2026-08-24 00:00:00")
        self.assertEqual(rows[1][4], "Alex Rae")
        self.assertEqual(rows[1][5], "1h 00m")

    def test_sort_order_most_recent_date_first_then_chronological(self):
        e1 = make_entry(id=1, date="2026-08-25", start_time="09:00", jira_key="PROJ-2")
        e2 = make_entry(id=2, date="2026-08-24", start_time="11:00", jira_key="PROJ-3")
        e3 = make_entry(id=3, date="2026-08-24", start_time="09:00", jira_key="PROJ-1")
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "out.csv")
            export_entries([e1, e2, e3], path, "Alex Rae")
            with open(path, newline="", encoding="utf-8") as f:
                rows = list(csv.reader(f))[1:]
        # Most recent date first (Aug 25), then within Aug 24, earliest start
        # time first (09:00 before 11:00).
        self.assertEqual([r[2] for r in rows], ["PROJ-2", "PROJ-1", "PROJ-3"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
