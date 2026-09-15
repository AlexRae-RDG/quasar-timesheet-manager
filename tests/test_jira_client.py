"""Standalone tests for app.jira_client -- no Tkinter required. requests
calls are mocked throughout; nothing here makes a real network call. Token
storage (TestApiTokenStorage below) goes through a real temp-file Database,
same as test_db.py -- see jira_client.py's own comment for why the token
lives there now instead of the OS keychain."""
import os
import re
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import requests

from app import jira_client
from app.db import Database
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


class TestSearchIssues(unittest.TestCase):
    def setUp(self):
        self.creds = jira_client.JiraCredentials(
            site_url="https://yourteam.atlassian.net", email="alex@example.com", api_token="tok")

    @patch("app.jira_client.requests.post")
    def test_single_page_returns_key_summary_pairs(self, mock_post):
        mock_post.return_value = MagicMock(status_code=200, json=lambda: {
            "issues": [
                {"key": "QDM-1", "fields": {"summary": "Fix the thing"}},
                {"key": "QDM-2", "fields": {"summary": "Other thing"}},
            ]
        })
        results = jira_client.search_issues(self.creds, "project = QDM")
        self.assertEqual(results, [("QDM-1", "Fix the thing"), ("QDM-2", "Other thing")])
        self.assertEqual(mock_post.call_count, 1)
        # The current (not the deprecated /rest/api/3/search) endpoint.
        self.assertEqual(mock_post.call_args.args[0],
                          "https://yourteam.atlassian.net/rest/api/3/search/jql")
        # Basic Auth uses the account email + API token, same as upload_entries.
        self.assertEqual(mock_post.call_args.kwargs["auth"], ("alex@example.com", "tok"))
        self.assertEqual(mock_post.call_args.kwargs["json"]["jql"], "project = QDM")

    @patch("app.jira_client.requests.post")
    def test_pagination_follows_next_page_token_until_absent(self, mock_post):
        mock_post.side_effect = [
            MagicMock(status_code=200, json=lambda: {
                "issues": [{"key": "QDM-1", "fields": {"summary": "First"}}],
                "nextPageToken": "page-2",
            }),
            MagicMock(status_code=200, json=lambda: {
                "issues": [{"key": "QDM-2", "fields": {"summary": "Second"}}],
                # No nextPageToken here -- this is what signals the last page
                # (this endpoint has no isLast flag).
            }),
        ]
        results = jira_client.search_issues(self.creds, "project = QDM")
        self.assertEqual(results, [("QDM-1", "First"), ("QDM-2", "Second")])
        self.assertEqual(mock_post.call_count, 2)
        # Second call carries the token the first response returned.
        self.assertEqual(mock_post.call_args_list[1].kwargs["json"]["nextPageToken"], "page-2")
        # First call has no token to send yet.
        self.assertNotIn("nextPageToken", mock_post.call_args_list[0].kwargs["json"])

    @patch("app.jira_client.requests.post")
    def test_missing_summary_field_becomes_empty_string_not_a_crash(self, mock_post):
        mock_post.return_value = MagicMock(status_code=200, json=lambda: {
            "issues": [{"key": "QDM-1", "fields": {}}]
        })
        results = jira_client.search_issues(self.creds, "project = QDM")
        self.assertEqual(results, [("QDM-1", "")])

    @patch("app.jira_client.requests.post")
    def test_http_error_raises_jira_search_error(self, mock_post):
        mock_post.return_value = MagicMock(
            status_code=400, text="Invalid JQL", reason="Bad Request")
        with self.assertRaises(jira_client.JiraSearchError) as ctx:
            jira_client.search_issues(self.creds, "not valid jql")
        self.assertIn("400", str(ctx.exception))

    @patch("app.jira_client.requests.post")
    def test_network_exception_raises_jira_search_error(self, mock_post):
        mock_post.side_effect = requests.ConnectionError("no route to host")
        with self.assertRaises(jira_client.JiraSearchError) as ctx:
            jira_client.search_issues(self.creds, "project = QDM")
        self.assertIn("no route to host", str(ctx.exception))


class TestVerifyCredentials(unittest.TestCase):
    def setUp(self):
        self.creds = jira_client.JiraCredentials(
            site_url="https://yourteam.atlassian.net", email="alex@example.com", api_token="tok")

    @patch("app.jira_client.requests.get")
    def test_success_returns_display_name(self, mock_get):
        mock_get.return_value = MagicMock(
            status_code=200, json=lambda: {"displayName": "Alex Rae"})
        result = jira_client.verify_credentials(self.creds)
        self.assertEqual(result, "Alex Rae")
        # Hits the "who am I" endpoint, not search or upload.
        self.assertEqual(mock_get.call_args.args[0],
                          "https://yourteam.atlassian.net/rest/api/3/myself")
        self.assertEqual(mock_get.call_args.kwargs["auth"], ("alex@example.com", "tok"))

    @patch("app.jira_client.requests.get")
    def test_missing_display_name_falls_back_to_email(self, mock_get):
        mock_get.return_value = MagicMock(status_code=200, json=lambda: {})
        result = jira_client.verify_credentials(self.creds)
        self.assertEqual(result, "alex@example.com")

    @patch("app.jira_client.requests.get")
    def test_401_raises_jira_connection_error_about_credentials(self, mock_get):
        mock_get.return_value = MagicMock(status_code=401, text="", reason="Unauthorized")
        with self.assertRaises(jira_client.JiraConnectionError) as ctx:
            jira_client.verify_credentials(self.creds)
        self.assertIn("credentials", str(ctx.exception).lower())

    @patch("app.jira_client.requests.get")
    def test_403_raises_jira_connection_error_about_credentials(self, mock_get):
        mock_get.return_value = MagicMock(status_code=403, text="", reason="Forbidden")
        with self.assertRaises(jira_client.JiraConnectionError) as ctx:
            jira_client.verify_credentials(self.creds)
        self.assertIn("credentials", str(ctx.exception).lower())

    @patch("app.jira_client.requests.get")
    def test_other_http_error_raises_jira_connection_error_about_site_url(self, mock_get):
        mock_get.return_value = MagicMock(
            status_code=404, text="Not Found", reason="Not Found")
        with self.assertRaises(jira_client.JiraConnectionError) as ctx:
            jira_client.verify_credentials(self.creds)
        self.assertIn("Site URL", str(ctx.exception))
        self.assertIn("404", str(ctx.exception))

    @patch("app.jira_client.requests.get")
    def test_network_exception_raises_jira_connection_error(self, mock_get):
        mock_get.side_effect = requests.ConnectionError("no route to host")
        with self.assertRaises(jira_client.JiraConnectionError) as ctx:
            jira_client.verify_credentials(self.creds)
        self.assertIn("no route to host", str(ctx.exception))

    def test_blank_site_url_raises_before_any_request(self):
        creds = jira_client.JiraCredentials(site_url="", email="alex@example.com", api_token="tok")
        with self.assertRaises(jira_client.JiraConnectionError) as ctx:
            jira_client.verify_credentials(creds)
        self.assertIn("Site URL", str(ctx.exception))

    def test_blank_email_raises_before_any_request(self):
        creds = jira_client.JiraCredentials(
            site_url="https://yourteam.atlassian.net", email="", api_token="tok")
        with self.assertRaises(jira_client.JiraConnectionError) as ctx:
            jira_client.verify_credentials(creds)
        self.assertIn("Email", str(ctx.exception))

    def test_blank_api_token_raises_before_any_request(self):
        creds = jira_client.JiraCredentials(
            site_url="https://yourteam.atlassian.net", email="alex@example.com", api_token="")
        with self.assertRaises(jira_client.JiraConnectionError) as ctx:
            jira_client.verify_credentials(creds)
        self.assertIn("API Token", str(ctx.exception))


class TestApiTokenStorage(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.db = Database(os.path.join(self.tmpdir, "test.db"))

    def tearDown(self):
        self.db.close()

    def test_get_api_token_returns_none_when_nothing_stored(self):
        self.assertIsNone(jira_client.get_api_token(self.db))
        self.assertFalse(jira_client.has_stored_api_token(self.db))

    def test_store_and_get_api_token_round_trips(self):
        jira_client.store_api_token(self.db, "secret-token")
        self.assertEqual(jira_client.get_api_token(self.db), "secret-token")
        self.assertTrue(jira_client.has_stored_api_token(self.db))

    def test_store_api_token_encrypts_at_rest(self):
        # The `settings` row itself never holds the plain token -- only
        # the tagged, Fernet-encrypted form (see jira_client.py's own
        # comment for why: Database.backup_to() only ever sees this row,
        # not the separate key file, so a shared backup stays unreadable).
        jira_client.store_api_token(self.db, "secret-token")
        stored = self.db.get_setting("jira_api_token")
        self.assertTrue(stored.startswith(jira_client._ENCRYPTED_PREFIX))
        self.assertNotIn("secret-token", stored)

    def test_key_file_lives_next_to_the_database_not_inside_it(self):
        jira_client.store_api_token(self.db, "secret-token")
        key_path = jira_client._key_path(self.db)
        self.assertTrue(os.path.exists(key_path))
        self.assertEqual(os.path.dirname(key_path), os.path.dirname(self.db.path))

    def test_a_restored_backup_without_the_key_file_cannot_be_decrypted(self):
        # The whole point (see jira_client.py's comment): backup_to()
        # snapshots the database only, never the sibling key file, so
        # restoring that snapshot onto a database with a *different* key
        # (a different machine, or just a fresh key file) can't recover
        # the plaintext token -- it should read back as "no token" rather
        # than garbage passed on to a Jira API call.
        jira_client.store_api_token(self.db, "secret-token")
        backup_path = os.path.join(self.tmpdir, "backup.db")
        self.db.backup_to(backup_path)

        other_dir = tempfile.mkdtemp()
        restored_path = os.path.join(other_dir, "restored.db")
        os.rename(backup_path, restored_path)
        restored_db = Database(restored_path)
        try:
            self.assertIsNone(jira_client.get_api_token(restored_db))
            self.assertFalse(jira_client.has_stored_api_token(restored_db))
        finally:
            restored_db.close()

    def test_get_api_token_upgrades_a_legacy_plaintext_value_in_place(self):
        # A real value from the version of this app that stored tokens
        # unencrypted -- no _ENCRYPTED_PREFIX -- written directly the way
        # that version's store_api_token did, to simulate an existing
        # user's already-saved token rather than going through today's
        # (encrypting) store_api_token.
        self.db.set_setting("jira_api_token", "legacy-plaintext-token")
        self.assertEqual(jira_client.get_api_token(self.db), "legacy-plaintext-token")
        # And it's upgraded by that read, with no action from the user.
        stored = self.db.get_setting("jira_api_token")
        self.assertTrue(stored.startswith(jira_client._ENCRYPTED_PREFIX))
        self.assertEqual(jira_client.get_api_token(self.db), "legacy-plaintext-token")

    def test_delete_api_token_clears_it(self):
        jira_client.store_api_token(self.db, "secret-token")
        jira_client.delete_api_token(self.db)
        self.assertIsNone(jira_client.get_api_token(self.db))
        self.assertFalse(jira_client.has_stored_api_token(self.db))

    def test_delete_api_token_is_safe_when_nothing_stored(self):
        jira_client.delete_api_token(self.db)  # must not raise
        self.assertFalse(jira_client.has_stored_api_token(self.db))


if __name__ == "__main__":
    unittest.main()
