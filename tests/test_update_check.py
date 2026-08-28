"""Standalone tests for app.update_check -- no Tkinter required, and no
real network calls (urllib.request.urlopen is mocked throughout)."""
import io
import os
import sys
import unittest
import urllib.error
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import update_check


def fake_response(payload_bytes, status=200):
    resp = MagicMock()
    resp.read.return_value = payload_bytes
    resp.status = status
    resp.__enter__ = lambda self: resp
    resp.__exit__ = lambda self, *a: False
    return resp


class TestParseVersion(unittest.TestCase):
    def test_parses_with_v_prefix(self):
        self.assertEqual(update_check.parse_version("v1.5.0"), (1, 5, 0))

    def test_parses_without_v_prefix(self):
        self.assertEqual(update_check.parse_version("1.5.0"), (1, 5, 0))

    def test_parses_embedded_in_other_text(self):
        self.assertEqual(update_check.parse_version("release v2.3.10 (final)"), (2, 3, 10))

    def test_malformed_input_does_not_raise(self):
        self.assertEqual(update_check.parse_version("not-a-version"), (0, 0, 0))
        self.assertEqual(update_check.parse_version(""), (0, 0, 0))
        self.assertEqual(update_check.parse_version(None), (0, 0, 0))


class TestIsNewer(unittest.TestCase):
    def test_newer_major(self):
        self.assertTrue(update_check.is_newer("v2.0.0", "v1.9.9"))

    def test_newer_patch(self):
        self.assertTrue(update_check.is_newer("v1.5.1", "v1.5.0"))

    def test_equal_is_not_newer(self):
        self.assertFalse(update_check.is_newer("v1.5.0", "v1.5.0"))

    def test_older_is_not_newer(self):
        self.assertFalse(update_check.is_newer("v1.4.0", "v1.5.0"))

    def test_malformed_candidate_is_never_newer(self):
        self.assertFalse(update_check.is_newer("not-a-version", "v1.5.0"))


class TestCheckLatestVersion(unittest.TestCase):
    @patch("app.update_check.urllib.request.urlopen")
    def test_success_returns_tag_and_url(self, mock_urlopen):
        payload = b'{"tag_name": "v1.6.0", "html_url": "https://github.com/x/y/releases/tag/v1.6.0"}'
        mock_urlopen.return_value = fake_response(payload)
        result = update_check.check_latest_version()
        self.assertEqual(result, {
            "tag_name": "v1.6.0",
            "html_url": "https://github.com/x/y/releases/tag/v1.6.0",
        })

    @patch("app.update_check.urllib.request.urlopen")
    def test_missing_html_url_falls_back_to_releases_page(self, mock_urlopen):
        payload = b'{"tag_name": "v1.6.0"}'
        mock_urlopen.return_value = fake_response(payload)
        result = update_check.check_latest_version()
        self.assertEqual(result["tag_name"], "v1.6.0")
        self.assertEqual(result["html_url"], update_check._RELEASES_PAGE_URL)

    @patch("app.update_check.urllib.request.urlopen")
    def test_missing_tag_name_returns_none(self, mock_urlopen):
        mock_urlopen.return_value = fake_response(b'{"foo": "bar"}')
        self.assertIsNone(update_check.check_latest_version())

    @patch("app.update_check.urllib.request.urlopen")
    def test_http_404_returns_none(self, mock_urlopen):
        # e.g. a still-private repo, or a repo with no releases yet.
        mock_urlopen.side_effect = urllib.error.HTTPError(
            update_check._LATEST_RELEASE_URL, 404, "Not Found", {}, None)
        self.assertIsNone(update_check.check_latest_version())

    @patch("app.update_check.urllib.request.urlopen")
    def test_network_error_returns_none(self, mock_urlopen):
        mock_urlopen.side_effect = urllib.error.URLError("no route to host")
        self.assertIsNone(update_check.check_latest_version())

    @patch("app.update_check.urllib.request.urlopen")
    def test_timeout_returns_none(self, mock_urlopen):
        mock_urlopen.side_effect = TimeoutError("timed out")
        self.assertIsNone(update_check.check_latest_version())

    @patch("app.update_check.urllib.request.urlopen")
    def test_malformed_json_returns_none(self, mock_urlopen):
        mock_urlopen.return_value = fake_response(b"not json at all")
        self.assertIsNone(update_check.check_latest_version())

    @patch("app.update_check.urllib.request.urlopen")
    def test_request_carries_a_user_agent(self, mock_urlopen):
        mock_urlopen.return_value = fake_response(b'{"tag_name": "v1.6.0"}')
        update_check.check_latest_version()
        sent_request = mock_urlopen.call_args.args[0]
        # urllib.request.Request normalizes header keys via str.capitalize()
        # ("User-Agent" -> "User-agent"), so compare case-insensitively
        # rather than assume the exact casing survives.
        header_keys_lower = {k.lower() for k in sent_request.headers}
        self.assertIn("user-agent", header_keys_lower)


if __name__ == "__main__":
    unittest.main()
