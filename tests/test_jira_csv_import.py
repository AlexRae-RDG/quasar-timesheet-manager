"""Standalone tests for app.jira_csv_import -- no Tkinter required, no
real Jira export needed; each test writes its own small CSV to a temp
file."""
import csv
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import jira_csv_import


def write_csv(rows, fieldnames):
    """rows: list of dicts. Returns the path to a temp CSV file with a
    UTF-8 BOM prepended, same as Jira's own export -- see parse()'s own
    comment for why that matters."""
    fd, path = tempfile.mkstemp(suffix=".csv")
    os.close(fd)
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow(row)
    return path


class TestParse(unittest.TestCase):
    def test_basic_rows_become_candidates(self):
        path = write_csv(
            [
                {"Issue key": "QDM-101", "Summary": "Sprint Planning"},
                {"Issue key": "QDM-102", "Summary": "Client A Retainer"},
            ],
            fieldnames=["Issue key", "Summary"],
        )
        result = jira_csv_import.parse(path, existing_jira_keys=set())
        self.assertEqual(len(result.candidates), 2)
        self.assertEqual(result.candidates[0].jira_key, "QDM-101")
        self.assertEqual(result.candidates[0].name, "Sprint Planning")
        self.assertEqual(result.candidates[1].jira_key, "QDM-102")
        self.assertEqual(result.skipped_duplicate, 0)
        self.assertEqual(result.skipped_not_a_qdm_key, 0)
        self.assertEqual(result.skipped_blank_key, 0)

    def test_extra_columns_are_ignored(self):
        path = write_csv(
            [{"Issue key": "QDM-101", "Summary": "Sprint Planning", "Status": "In Progress",
              "Assignee": "Alex Rae", "Project name": "Quasar Delivery Management"}],
            fieldnames=["Issue key", "Summary", "Status", "Assignee", "Project name"],
        )
        result = jira_csv_import.parse(path, existing_jira_keys=set())
        self.assertEqual(len(result.candidates), 1)
        self.assertEqual(result.candidates[0].jira_key, "QDM-101")

    def test_key_header_matches_case_insensitively_and_bare_key(self):
        path = write_csv(
            [{"key": "QDM-5", "summary": "Something"}],
            fieldnames=["key", "summary"],
        )
        result = jira_csv_import.parse(path, existing_jira_keys=set())
        self.assertEqual(len(result.candidates), 1)
        self.assertEqual(result.candidates[0].jira_key, "QDM-5")

    def test_rows_not_matching_the_qdm_prefix_are_skipped(self):
        path = write_csv(
            [
                {"Issue key": "QDM-1", "Summary": "A real one"},
                {"Issue key": "OTHER-9", "Summary": "Different team's issue"},
            ],
            fieldnames=["Issue key", "Summary"],
        )
        result = jira_csv_import.parse(path, existing_jira_keys=set())
        self.assertEqual(len(result.candidates), 1)
        self.assertEqual(result.candidates[0].jira_key, "QDM-1")
        self.assertEqual(result.skipped_not_a_qdm_key, 1)

    def test_blank_key_rows_are_skipped(self):
        path = write_csv(
            [{"Issue key": "", "Summary": "No key at all"}],
            fieldnames=["Issue key", "Summary"],
        )
        result = jira_csv_import.parse(path, existing_jira_keys=set())
        self.assertEqual(len(result.candidates), 0)
        self.assertEqual(result.skipped_blank_key, 1)

    def test_rows_already_in_existing_jira_keys_are_skipped_as_duplicates(self):
        path = write_csv(
            [
                {"Issue key": "QDM-1", "Summary": "Already added"},
                {"Issue key": "QDM-2", "Summary": "New one"},
            ],
            fieldnames=["Issue key", "Summary"],
        )
        result = jira_csv_import.parse(path, existing_jira_keys={"QDM-1"})
        self.assertEqual([c.jira_key for c in result.candidates], ["QDM-2"])
        self.assertEqual(result.skipped_duplicate, 1)

    def test_duplicate_keys_within_the_same_file_are_only_counted_once(self):
        path = write_csv(
            [
                {"Issue key": "QDM-1", "Summary": "First"},
                {"Issue key": "QDM-1", "Summary": "Repeated in the same export"},
            ],
            fieldnames=["Issue key", "Summary"],
        )
        result = jira_csv_import.parse(path, existing_jira_keys=set())
        self.assertEqual(len(result.candidates), 1)
        self.assertEqual(result.skipped_duplicate, 1)

    def test_existing_key_comparison_is_case_insensitive(self):
        path = write_csv(
            [{"Issue key": "qdm-1", "Summary": "Lowercase key in the export"}],
            fieldnames=["Issue key", "Summary"],
        )
        result = jira_csv_import.parse(path, existing_jira_keys={"QDM-1"})
        self.assertEqual(len(result.candidates), 0)
        self.assertEqual(result.skipped_duplicate, 1)

    def test_blank_summary_falls_back_to_the_key_as_the_name(self):
        path = write_csv(
            [{"Issue key": "QDM-7", "Summary": ""}],
            fieldnames=["Issue key", "Summary"],
        )
        result = jira_csv_import.parse(path, existing_jira_keys=set())
        self.assertEqual(result.candidates[0].name, "QDM-7")

    def test_missing_summary_column_entirely_falls_back_to_the_key(self):
        path = write_csv([{"Issue key": "QDM-8"}], fieldnames=["Issue key"])
        result = jira_csv_import.parse(path, existing_jira_keys=set())
        self.assertEqual(result.candidates[0].name, "QDM-8")

    def test_missing_key_column_raises_not_a_jira_export(self):
        path = write_csv([{"Summary": "No key column at all"}], fieldnames=["Summary"])
        with self.assertRaises(jira_csv_import.NotAJiraExport):
            jira_csv_import.parse(path, existing_jira_keys=set())

    def test_utf8_bom_does_not_break_header_matching(self):
        # write_csv already writes with utf-8-sig (a real BOM) -- this
        # just makes the point explicit rather than relying on every
        # other test incidentally covering it.
        path = write_csv([{"Issue key": "QDM-1", "Summary": "BOM check"}],
                          fieldnames=["Issue key", "Summary"])
        with open(path, "rb") as f:
            self.assertTrue(f.read(3) == b"\xef\xbb\xbf")
        result = jira_csv_import.parse(path, existing_jira_keys=set())
        self.assertEqual(len(result.candidates), 1)


class TestFromApiResults(unittest.TestCase):
    """from_api_results() is the direct-API sibling of parse() -- it
    funnels through the exact same _classify_rows() filtering, so these
    only need to spot-check that funneling actually happens rather than
    re-covering every rule TestParse above already covers row-by-row."""

    def test_basic_pairs_become_candidates(self):
        result = jira_csv_import.from_api_results(
            [("QDM-1", "Fix the thing"), ("QDM-2", "Other thing")],
            existing_jira_keys=set())
        self.assertEqual(len(result.candidates), 2)
        self.assertEqual(result.candidates[0].jira_key, "QDM-1")
        self.assertEqual(result.candidates[0].name, "Fix the thing")

    def test_already_added_keys_are_skipped_as_duplicates(self):
        result = jira_csv_import.from_api_results(
            [("QDM-1", "Already have this one"), ("QDM-2", "New one")],
            existing_jira_keys={"QDM-1"})
        self.assertEqual([c.jira_key for c in result.candidates], ["QDM-2"])
        self.assertEqual(result.skipped_duplicate, 1)

    def test_blank_summary_falls_back_to_the_key_as_the_name(self):
        result = jira_csv_import.from_api_results(
            [("QDM-3", "")], existing_jira_keys=set())
        self.assertEqual(result.candidates[0].name, "QDM-3")

    def test_a_key_outside_this_project_is_skipped_not_a_qdm_key(self):
        # Belt-and-braces: the JQL search_issues() runs is already scoped
        # to `project = QDM`, so this should never actually happen from
        # the API path in practice -- but from_api_results() shares
        # _classify_rows() with parse() precisely so it doesn't have to
        # trust that and applies the same check anyway.
        result = jira_csv_import.from_api_results(
            [("PROJ-100", "Wrong project")], existing_jira_keys=set())
        self.assertEqual(result.candidates, [])
        self.assertEqual(result.skipped_not_a_qdm_key, 1)


if __name__ == "__main__":
    unittest.main()
