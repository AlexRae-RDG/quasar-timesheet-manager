"""Tests for app.auto_update's pure-logic pieces -- asset selection,
path resolution, and error handling. No Tkinter required.

What ISN'T (and can't be) covered here: actually running the generated
swap scripts. This sandbox has no real macOS Finder/GUI and no Windows
machine at all, so the scripts' own shell/batch logic (waiting for a
PID, moving files, relaunching) has to be verified by hand on real
machines -- see auto_update.py's module docstring. These tests only
check that perform_update() builds the right inputs and writes/launches
something, via mocks."""
import os
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import auto_update


class TestIsFrozen(unittest.TestCase):
    def test_false_when_sys_frozen_absent(self):
        # Running under the real test suite (not a PyInstaller build) --
        # sys.frozen should simply not be set.
        self.assertFalse(hasattr(sys, "frozen") and sys.frozen and auto_update.is_frozen() is False)
        with patch.object(sys, "frozen", False, create=True):
            self.assertFalse(auto_update.is_frozen())

    def test_true_when_sys_frozen_set(self):
        with patch.object(sys, "frozen", True, create=True):
            self.assertTrue(auto_update.is_frozen())


class TestPlatformAssetName(unittest.TestCase):
    def test_macos(self):
        with patch.object(auto_update.sys, "platform", "darwin"):
            self.assertEqual(auto_update.platform_asset_name(), "QUASAR-Timesheet-Manager-macOS.zip")

    def test_windows(self):
        with patch.object(auto_update.sys, "platform", "win32"):
            self.assertEqual(auto_update.platform_asset_name(), "QUASAR-Timesheet-Manager-Windows.zip")

    def test_unsupported_platform_returns_none(self):
        with patch.object(auto_update.sys, "platform", "linux"):
            self.assertIsNone(auto_update.platform_asset_name())


class TestFindAssetUrl(unittest.TestCase):
    ASSETS = [
        {"name": "QUASAR-Timesheet-Manager-macOS.zip", "browser_download_url": "https://x/mac.zip"},
        {"name": "QUASAR-Timesheet-Manager-Windows.zip", "browser_download_url": "https://x/win.zip"},
    ]

    def test_finds_matching_asset(self):
        self.assertEqual(
            auto_update.find_asset_url(self.ASSETS, "QUASAR-Timesheet-Manager-Windows.zip"),
            "https://x/win.zip",
        )

    def test_no_match_returns_none(self):
        self.assertIsNone(auto_update.find_asset_url(self.ASSETS, "nope.zip"))

    def test_empty_assets_returns_none(self):
        self.assertIsNone(auto_update.find_asset_url([], "QUASAR-Timesheet-Manager-macOS.zip"))
        self.assertIsNone(auto_update.find_asset_url(None, "QUASAR-Timesheet-Manager-macOS.zip"))


class TestCurrentInstallPaths(unittest.TestCase):
    def test_macos_layout(self):
        exe = "/Applications/QUASAR Timesheet Manager.app/Contents/MacOS/QUASAR Timesheet Manager"
        with patch.object(auto_update.sys, "platform", "darwin"), \
             patch.object(auto_update.sys, "executable", exe):
            install_path, containing_dir = auto_update.current_install_paths()
        self.assertEqual(install_path, Path("/Applications/QUASAR Timesheet Manager.app"))
        self.assertEqual(containing_dir, Path("/Applications"))

    def test_macos_unexpected_layout_raises(self):
        exe = "/Applications/SomeOtherLayout/QUASAR Timesheet Manager"
        with patch.object(auto_update.sys, "platform", "darwin"), \
             patch.object(auto_update.sys, "executable", exe):
            with self.assertRaises(auto_update.AutoUpdateError):
                auto_update.current_install_paths()

    def test_windows_layout(self):
        exe = r"C:\Users\alex\Desktop\QUASAR Timesheet Manager\QUASAR Timesheet Manager.exe"
        with patch.object(auto_update.sys, "platform", "win32"), \
             patch.object(auto_update.sys, "executable", exe):
            install_path, containing_dir = auto_update.current_install_paths()
        self.assertEqual(install_path.name, "QUASAR Timesheet Manager")
        self.assertEqual(containing_dir.name, "Desktop")

    def test_unsupported_platform_raises(self):
        with patch.object(auto_update.sys, "platform", "linux"):
            with self.assertRaises(auto_update.AutoUpdateError):
                auto_update.current_install_paths()


class TestDownloadAndExtract(unittest.TestCase):
    def test_download_asset_writes_bytes(self):
        fake_resp = MagicMock()
        fake_resp.read.return_value = b"zip-bytes-here"
        fake_resp.__enter__ = lambda self: fake_resp
        fake_resp.__exit__ = lambda self, *a: False
        with tempfile.TemporaryDirectory() as tmp:
            with patch("app.auto_update.urllib.request.urlopen", return_value=fake_resp):
                dest = auto_update.download_asset("https://x/mac.zip", Path(tmp))
            self.assertEqual(dest.read_bytes(), b"zip-bytes-here")

    def test_download_failure_raises_auto_update_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            with patch("app.auto_update.urllib.request.urlopen", side_effect=OSError("boom")):
                with self.assertRaises(auto_update.AutoUpdateError):
                    auto_update.download_asset("https://x/mac.zip", Path(tmp))

    def test_extract_zip_extracts_contents(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            zip_path = tmp_path / "update.zip"
            with zipfile.ZipFile(zip_path, "w") as zf:
                zf.writestr("QUASAR Timesheet Manager.app/Contents/Info.plist", "fake")
            extract_dir = tmp_path / "extracted"
            extract_dir.mkdir()
            auto_update.extract_zip(zip_path, extract_dir)
            self.assertTrue((extract_dir / "QUASAR Timesheet Manager.app").exists())

    def test_extract_bad_zip_raises_auto_update_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            bad_zip = tmp_path / "update.zip"
            bad_zip.write_bytes(b"not a zip file")
            extract_dir = tmp_path / "extracted"
            extract_dir.mkdir()
            with self.assertRaises(auto_update.AutoUpdateError):
                auto_update.extract_zip(bad_zip, extract_dir)

    def test_find_extracted_root_missing_raises(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(auto_update.AutoUpdateError):
                auto_update.find_extracted_root(Path(tmp), "QUASAR Timesheet Manager.app")

    def test_find_extracted_root_found(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            (tmp_path / "QUASAR Timesheet Manager.app").mkdir()
            root = auto_update.find_extracted_root(tmp_path, "QUASAR Timesheet Manager.app")
            self.assertEqual(root, tmp_path / "QUASAR Timesheet Manager.app")


class TestPerformUpdateFallbacks(unittest.TestCase):
    """perform_update() should raise AutoUpdateError -- never anything
    else -- for every "can't proceed" case, since main_window.py only
    catches that one exception type before falling back to the browser."""

    def test_not_frozen_raises(self):
        with patch.object(auto_update, "is_frozen", return_value=False):
            with self.assertRaises(auto_update.AutoUpdateError):
                auto_update.perform_update([])

    def test_unsupported_platform_asset_raises(self):
        with patch.object(auto_update, "is_frozen", return_value=True), \
             patch.object(auto_update, "platform_asset_name", return_value=None):
            with self.assertRaises(auto_update.AutoUpdateError):
                auto_update.perform_update([])

    def test_no_matching_asset_raises(self):
        with patch.object(auto_update, "is_frozen", return_value=True), \
             patch.object(auto_update, "platform_asset_name", return_value="QUASAR-Timesheet-Manager-macOS.zip"):
            with self.assertRaises(auto_update.AutoUpdateError):
                auto_update.perform_update([{"name": "something-else.zip", "browser_download_url": "https://x"}])

    @patch("app.auto_update.subprocess.Popen")
    def test_success_writes_and_launches_macos_swap_script(self, mock_popen):
        exe = "/Applications/QUASAR Timesheet Manager.app/Contents/MacOS/QUASAR Timesheet Manager"
        assets = [{"name": "QUASAR-Timesheet-Manager-macOS.zip", "browser_download_url": "https://x/mac.zip"}]

        fake_resp = MagicMock()
        fake_resp.read.return_value = b"pretend-zip-bytes"
        fake_resp.__enter__ = lambda self: fake_resp
        fake_resp.__exit__ = lambda self, *a: False

        real_zipfile_init = zipfile.ZipFile

        def fake_zipfile(path, *a, **kw):
            # Build a real (tiny) zip on first open-for-read so
            # extractall has something valid to work with, matching the
            # "QUASAR Timesheet Manager.app" name current_install_paths()
            # will derive from `exe` above.
            with real_zipfile_init(path, "w") as zf:
                zf.writestr("QUASAR Timesheet Manager.app/Contents/Info.plist", "fake")
            return real_zipfile_init(path, *a, **kw)

        with patch.object(auto_update.sys, "platform", "darwin"), \
             patch.object(auto_update.sys, "executable", exe), \
             patch.object(auto_update, "is_frozen", return_value=True), \
             patch("app.auto_update.urllib.request.urlopen", return_value=fake_resp), \
             patch("app.auto_update.zipfile.ZipFile", side_effect=fake_zipfile):
            auto_update.perform_update(assets)

        mock_popen.assert_called_once()
        args, kwargs = mock_popen.call_args
        self.assertEqual(args[0][0], "/bin/bash")
        script_path = Path(args[0][1])
        self.assertTrue(script_path.exists())
        contents = script_path.read_text()
        self.assertIn("QUASAR Timesheet Manager.app", contents)
        self.assertIn(str(os.getpid()), contents)
        script_path.unlink()

    @patch("app.auto_update.subprocess.Popen")
    def test_success_writes_and_launches_windows_swap_script(self, mock_popen):
        exe = r"C:\Users\alex\Desktop\QUASAR Timesheet Manager\QUASAR Timesheet Manager.exe"
        assets = [{"name": "QUASAR-Timesheet-Manager-Windows.zip", "browser_download_url": "https://x/win.zip"}]

        fake_resp = MagicMock()
        fake_resp.read.return_value = b"pretend-zip-bytes"
        fake_resp.__enter__ = lambda self: fake_resp
        fake_resp.__exit__ = lambda self, *a: False

        real_zipfile_init = zipfile.ZipFile

        def fake_zipfile(path, *a, **kw):
            with real_zipfile_init(path, "w") as zf:
                zf.writestr("QUASAR Timesheet Manager/QUASAR Timesheet Manager.exe", "fake")
            return real_zipfile_init(path, *a, **kw)

        with patch.object(auto_update.sys, "platform", "win32"), \
             patch.object(auto_update.sys, "executable", exe), \
             patch.object(auto_update, "is_frozen", return_value=True), \
             patch("app.auto_update.urllib.request.urlopen", return_value=fake_resp), \
             patch("app.auto_update.zipfile.ZipFile", side_effect=fake_zipfile):
            auto_update.perform_update(assets)

        mock_popen.assert_called_once()
        args, kwargs = mock_popen.call_args
        self.assertEqual(args[0][0], "cmd")
        script_path = Path(args[0][2])
        self.assertTrue(script_path.exists())
        contents = script_path.read_text()
        self.assertIn("QUASAR Timesheet Manager.exe", contents)
        self.assertIn(str(os.getpid()), contents)
        script_path.unlink()


if __name__ == "__main__":
    unittest.main()
