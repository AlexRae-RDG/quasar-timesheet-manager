"""Standalone tests for app.config's Jira Issue Key helpers -- no Tkinter
required. These back the number-only Jira Issue Key entry fields on the
Activity and Time Block tabs (see app/panels.py and
app/timeblock_panel.py) -- the "QDM-" prefix is constant for this app, so
a human only ever types the number after it."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import config


class TestJiraKeyNumber(unittest.TestCase):
    def test_strips_the_fixed_prefix_for_display(self):
        self.assertEqual(config.jira_key_number("QDM-5455"), "5455")

    def test_none_or_blank_becomes_an_empty_field(self):
        self.assertEqual(config.jira_key_number(None), "")
        self.assertEqual(config.jira_key_number(""), "")

    def test_is_case_and_whitespace_tolerant(self):
        self.assertEqual(config.jira_key_number("  qdm-42  "), "42")

    def test_falls_back_to_showing_the_raw_value_if_prefix_doesnt_match(self):
        # Older data (or a key from before this app existed) shouldn't be
        # silently hidden just because it doesn't start with "QDM-".
        self.assertEqual(config.jira_key_number("OTHER-99"), "OTHER-99")


class TestJiraKeyFromNumber(unittest.TestCase):
    def test_prepends_the_fixed_prefix(self):
        self.assertEqual(config.jira_key_from_number("5455"), "QDM-5455")

    def test_strips_whitespace_first(self):
        self.assertEqual(config.jira_key_from_number("  42  "), "QDM-42")

    def test_blank_or_none_means_no_jira_issue_key_set(self):
        self.assertIsNone(config.jira_key_from_number(""))
        self.assertIsNone(config.jira_key_from_number("   "))
        self.assertIsNone(config.jira_key_from_number(None))

    def test_doesnt_double_up_a_prefix_someone_typed_or_pasted_themselves(self):
        self.assertEqual(config.jira_key_from_number("QDM-42"), "QDM-42")
        self.assertEqual(config.jira_key_from_number("qdm-42"), "qdm-42")

    def test_round_trips_with_jira_key_number(self):
        full = "QDM-1234"
        self.assertEqual(config.jira_key_from_number(config.jira_key_number(full)), full)


if __name__ == "__main__":
    unittest.main(verbosity=2)
