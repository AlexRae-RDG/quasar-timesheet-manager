"""Standalone tests for app.update_check -- no Tkinter required, and no
real network calls (urllib.request.urlopen is mocked throughout)."""
import io
import os
import sys
import tempfile
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
            "assets": [],
        })

    @patch("app.update_check.urllib.request.urlopen")
    def test_missing_html_url_falls_back_to_releases_page(self, mock_urlopen):
        payload = b'{"tag_name": "v1.6.0"}'
        mock_urlopen.return_value = fake_response(payload)
        result = update_check.check_latest_version()
        self.assertEqual(result["tag_name"], "v1.6.0")
        self.assertEqual(result["html_url"], update_check._RELEASES_PAGE_URL)

    @patch("app.update_check.urllib.request.urlopen")
    def test_assets_array_is_passed_through(self, mock_urlopen):
        payload = (
            b'{"tag_name": "v1.6.0", "html_url": "https://x/y",'
            b' "assets": [{"name": "QUASAR-Timesheet-Manager-macOS.zip",'
            b' "browser_download_url": "https://x/y/download/mac.zip"}]}'
        )
        mock_urlopen.return_value = fake_response(payload)
        result = update_check.check_latest_version()
        self.assertEqual(result["assets"], [{
            "name": "QUASAR-Timesheet-Manager-macOS.zip",
            "browser_download_url": "https://x/y/download/mac.zip",
        }])

    @patch("app.update_check.urllib.request.urlopen")
    def test_missing_assets_defaults_to_empty_list(self, mock_urlopen):
        payload = b'{"tag_name": "v1.6.0"}'
        mock_urlopen.return_value = fake_response(payload)
        result = update_check.check_latest_version()
        self.assertEqual(result["assets"], [])

    @patch("app.update_check._log_check_failure")
    @patch("app.update_check.urllib.request.urlopen")
    def test_missing_tag_name_returns_none(self, mock_urlopen, mock_log):
        mock_urlopen.return_value = fake_response(b'{"foo": "bar"}')
        self.assertIsNone(update_check.check_latest_version())

    @patch("app.update_check._log_check_failure")
    @patch("app.update_check.urllib.request.urlopen")
    def test_http_404_returns_none(self, mock_urlopen, mock_log):
        # e.g. a still-private repo, or a repo with no releases yet.
        mock_urlopen.side_effect = urllib.error.HTTPError(
            update_check._LATEST_RELEASE_URL, 404, "Not Found", {}, None)
        self.assertIsNone(update_check.check_latest_version())
        mock_log.assert_called_once()

    @patch("app.update_check._log_check_failure")
    @patch("app.update_check.urllib.request.urlopen")
    def test_network_error_returns_none(self, mock_urlopen, mock_log):
        mock_urlopen.side_effect = urllib.error.URLError("no route to host")
        self.assertIsNone(update_check.check_latest_version())
        mock_log.assert_called_once()

    @patch("app.update_check._log_check_failure")
    @patch("app.update_check.urllib.request.urlopen")
    def test_timeout_returns_none(self, mock_urlopen, mock_log):
        mock_urlopen.side_effect = TimeoutError("timed out")
        self.assertIsNone(update_check.check_latest_version())
        mock_log.assert_called_once()

    @patch("app.update_check._log_check_failure")
    @patch("app.update_check.urllib.request.urlopen")
    def test_malformed_json_returns_none(self, mock_urlopen, mock_log):
        mock_urlopen.return_value = fake_response(b"not json at all")
        self.assertIsNone(update_check.check_latest_version())
        mock_log.assert_called_once()

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


class TestLogCheckFailure(unittest.TestCase):
    """_log_check_failure is check_latest_version()'s only concession to
    debuggability -- every actual failure is still silent toward the
    caller (see check_latest_version's own tests above), but this is what
    lets a real "why didn't the popup show up" report get diagnosed from
    outside a packaged build with no visible console."""

    def test_writes_a_line_with_the_exception(self):
        with tempfile.TemporaryDirectory() as tmp:
            with patch.object(update_check.config, "APP_DIR", tmp):
                update_check._log_check_failure(ValueError("boom"))
                log_path = os.path.join(tmp, "update_check.log")
                self.assertTrue(os.path.exists(log_path))
                with open(log_path) as f:
                    contents = f.read()
                self.assertIn("ValueError", contents)
                self.assertIn("boom", contents)

    def test_creates_app_dir_if_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            missing_dir = os.path.join(tmp, "not-created-yet")
            with patch.object(update_check.config, "APP_DIR", missing_dir):
                update_check._log_check_failure(OSError("no network"))
                self.assertTrue(os.path.exists(os.path.join(missing_dir, "update_check.log")))

    def test_never_raises_even_if_logging_itself_fails(self):
        # e.g. APP_DIR pointing somewhere unwritable -- logging a failure
        # must never become a second, unhandled failure of its own.
        with patch.object(update_check.config, "APP_DIR", "/this/path/does/not/exist/and/cant/be/made"):
            with patch("app.update_check.os.makedirs", side_effect=OSError("denied")):
                update_check._log_check_failure(RuntimeError("whatever"))  # must not raise


if __name__ == "__main__":
    unittest.main()
