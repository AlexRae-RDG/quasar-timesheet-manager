"""Standalone tests for app.jira_client -- no Tkinter required. requests
and keyring calls are mocked throughout; nothing here makes a real network
call or touches a real OS keychain."""
import os
import re
import sys
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import keyring.errors
import requests

from app import jira_client
from app.models import TimeEntry


def make_entry(**kwargs):
    defaults = dict(
        id=1, activity_id=1, activity_name="Sprint Planning", jira_key="QDM-123",
        color="#4C6EF5", date="2026-08-24", start_time="09:00", end_time="10:30",
        notes="", jira_project=None, issue_type=None, jira_uploaded_at=None,
    )
    defaults.update(kwargs)
    return TimeEntry(**defaults)


class TestNormalizeSiteUrl(unittest.TestCase):
    def test_adds_https_when_missing(self):
        self.assertEqual(jira_client.normalize_site_url("yourteam.atlassian.net"),
                          "https://yourteam.atlassian.net")

    def test_leaves_existing_scheme_alone(self):
        self.assertEqual(jira_client.normalize_site_url("http://yourteam.atlassian.net"),
                          "http://yourteam.atlassian.net")

    def test_strips_trailing_slash(self):
        self.assertEqual(jira_client.normalize_site_url("https://yourteam.atlassian.net/"),
                          "https://yourteam.atlassian.net")

    def test_blank_stays_blank(self):
        self.assertEqual(jira_client.normalize_site_url(""), "")
        self.assertEqual(jira_client.normalize_site_url("   "), "")


class TestPayloadBuilding(unittest.TestCase):
    def test_started_timestamp_format(self):
        e = make_entry(date="2026-08-24", start_time="09:30")
        started = jira_client._started_timestamp(e)
        # yyyy-MM-dd'T'HH:mm:ss.SSSZ, e.g. "2026-08-24T09:30:00.000+0000"
        self.assertRegex(started, r"^2026-08-24T09:30:00\.000[+-]\d{4}$")

    def test_time_spent_seconds_matches_duration(self):
        e = make_entry(start_time="09:00", end_time="10:30")  # 90 minutes
        payload = jira_client.build_worklog_payload(e)
        self.assertEqual(payload["timeSpentSeconds"], 90 * 60)

    def test_comment_wraps_work_description_in_adf(self):
        e = make_entry(notes="Fixed the flaky test\nadded coverage")
        payload = jira_client.build_worklog_payload(e)
        self.assertEqual(payload["comment"], {
            "type": "doc",
            "version": 1,
            "content": [{
                "type": "paragraph",
                "content": [{"type": "text", "text": "Fixed the flaky test added coverage"}],
            }],
        })

    def test_comment_falls_back_to_activity_name_when_no_notes(self):
        e = make_entry(notes="", activity_name="Sprint Planning")
        payload = jira_client.build_worklog_payload(e)
        text = payload["comment"]["content"][0]["content"][0]["text"]
        self.assertEqual(text, "Sprint Planning")

    def test_worklog_url_uses_normalized_site_and_issue_key(self):
        url = jira_client._worklog_url("yourteam.atlassian.net", "QDM-42")
        self.assertEqual(url, "https://yourteam.atlassian.net/rest/api/3/issue/QDM-42/worklog")


class TestUploadEntries(unittest.TestCase):
    def setUp(self):
        self.creds = jira_client.JiraCredentials(
            site_url="https://yourteam.atlassian.net", email="alex@example.com", api_token="tok")

    @patch("app.jira_client.requests.post")
    def test_success_posts_once_per_entry_and_reports_success(self, mock_post):
        mock_post.return_value = MagicMock(status_code=201)
        entries = [make_entry(id=1, jira_key="QDM-1"), make_entry(id=2, jira_key="QDM-2")]
        results = jira_client.upload_entries(self.creds, entries)
        self.assertEqual(mock_post.call_count, 2)
        self.assertTrue(all(r.success for r in results))
        called_urls = [c.args[0] for c in mock_post.call_args_list]
        self.assertIn("https://yourteam.atlassian.net/rest/api/3/issue/QDM-1/worklog", called_urls)
        self.assertIn("https://yourteam.atlassian.net/rest/api/3/issue/QDM-2/worklog", called_urls)
        # Basic Auth uses the account email + API token, never a password.
        self.assertEqual(mock_post.call_args_list[0].kwargs["auth"], ("alex@example.com", "tok"))

    @patch("app.jira_client.requests.post")
    def test_http_error_is_reported_per_entry_without_aborting_the_batch(self, mock_post):
        ok_response = MagicMock(status_code=201)
        bad_response = MagicMock(status_code=400, text="issue does not exist", reason="Bad Request")
        mock_post.side_effect = [bad_response, ok_response]
        entries = [make_entry(id=1, jira_key="QDM-BOGUS"), make_entry(id=2, jira_key="QDM-2")]
        results = jira_client.upload_entries(self.creds, entries)
        self.assertEqual(mock_post.call_count, 2)  # one bad row didn't stop the second call
        self.assertFalse(results[0].success)
        self.assertIn("400", results[0].error)
        self.assertTrue(results[1].success)

    @patch("app.jira_client.requests.post")
    def test_network_exception_is_caught_and_reported(self, mock_post):
        mock_post.side_effect = requests.ConnectionError("no route to host")
        results = jira_client.upload_entries(self.creds, [make_entry()])
        self.assertFalse(results[0].success)
        self.assertIn("no route to host", results[0].error)

    def test_progress_callback_is_invoked_per_entry(self):
        seen = []
        with patch("app.jira_client.requests.post", return_value=MagicMock(status_code=201)):
            jira_client.upload_entries(self.creds, [make_entry(), make_entry()],
                                        on_progress=lambda done, total: seen.append((done, total)))
        self.assertEqual(seen, [(1, 2), (2, 2)])


class TestApiTokenStorage(unittest.TestCase):
    @patch("app.jira_client.keyring.set_password")
    def test_store_api_token_uses_keyring(self, mock_set):
        jira_client.store_api_token("secret-token")
        mock_set.assert_called_once_with(
            jira_client._KEYRING_SERVICE, jira_client._KEYRING_USERNAME, "secret-token")

    @patch("app.jira_client.keyring.set_password")
    def test_store_api_token_raises_keyring_unavailable_when_no_backend(self, mock_set):
        mock_set.side_effect = keyring.errors.NoKeyringError("no backend")
        with self.assertRaises(jira_client.KeyringUnavailable):
            jira_client.store_api_token("secret-token")

    @patch("app.jira_client.keyring.get_password", return_value="secret-token")
    def test_get_api_token_returns_stored_value(self, mock_get):
        self.assertEqual(jira_client.get_api_token(), "secret-token")
        self.assertTrue(jira_client.has_stored_api_token())

    @patch("app.jira_client.keyring.get_password", side_effect=keyring.errors.KeyringError("boom"))
    def test_get_api_token_returns_none_when_backend_errors(self, mock_get):
        self.assertIsNone(jira_client.get_api_token())
        self.assertFalse(jira_client.has_stored_api_token())

    @patch("app.jira_client.keyring.delete_password")
    def test_delete_api_token_swallows_keyring_errors(self, mock_delete):
        mock_delete.side_effect = keyring.errors.PasswordDeleteError("nothing to delete")
        jira_client.delete_api_token()  # must not raise


if __name__ == "__main__":
    unittest.main()
