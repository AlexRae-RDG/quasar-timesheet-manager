"""Fully-automatic "one click" update: downloads the right platform build
from the latest GitHub Release and swaps it in for the currently-running
install, so the user never has to find, unzip, or drag a file themselves.

This only works for a packaged (PyInstaller-frozen) build -- see
is_frozen() -- since running from source (`python3 app.py`) has no single
"install" on disk to replace. Every function here either returns a plain
value or raises AutoUpdateError; main_window.py wraps the whole thing in
one try/except and falls back to the old "open the release page in a
browser" behavior on any failure, so nothing added here can make an
update attempt worse than before -- at worst it's a no-op followed by the
browser opening like it always did.

The tricky part is that a running program generally can't delete or
overwrite its own executable while it's still running (Windows actively
locks the .exe file; even on macOS, where it's technically possible,
doing it out from under a live process invites corruption). So the
actual swap is done by a small, detached helper script -- bash on macOS,
a .bat file on Windows -- that this process writes to a temp file and
launches just before quitting. It waits for this process's PID to exit,
replaces the install, and relaunches it. This mirrors exactly what
"Update and Reinstall App.command" already does by hand for macOS (see
that file at the repo root); this module adds the Windows equivalent and
triggers both automatically instead of by double-click.

Untested end-to-end from this development environment: there's no real
macOS display/Finder here to exercise the actual app-swap (only the pure
path/URL logic below is unit-tested), and no Windows machine at all to
run the Windows path on even once. Treat a first real update through
this feature -- on both an actual Mac and an actual Windows PC -- as a
test, not a given.
"""
import os
import shlex
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path, PureWindowsPath
from typing import List, Optional

from .update_check import build_ssl_context


class AutoUpdateError(Exception):
    """Raised for any failure along the download/extract/swap path.
    Callers (main_window.py) catch this and fall back to opening the
    release's page in a browser -- never shown to the user as a raw
    traceback."""


# GitHub rejects requests with no User-Agent (403s them) -- same header
# update_check.py already uses for the same reason.
_HEADERS = {"User-Agent": "QUASAR-Timesheet-Manager-update-check"}

# Must match the exact asset filenames release.yml produces and uploads.
_ASSET_NAMES = {
    "darwin": "QUASAR-Timesheet-Manager-macOS.zip",
    "win32": "QUASAR-Timesheet-Manager-Windows.zip",
}


def is_frozen() -> bool:
    """True only inside a PyInstaller-built app. sys.frozen is the
    standard flag PyInstaller sets on the running interpreter; it's
    simply absent when running from source."""
    return bool(getattr(sys, "frozen", False))


def platform_asset_name() -> Optional[str]:
    """The GitHub Release asset name to look for on this OS, or None on a
    platform with no packaged build to fetch (e.g. Linux -- build_linux.sh
    exists for building your own, but release.yml doesn't publish one)."""
    return _ASSET_NAMES.get(sys.platform)


def find_asset_url(assets: List[dict], asset_name: str) -> Optional[str]:
    """Picks out browser_download_url for `asset_name` from a release's
    raw "assets" array (see update_check.check_latest_version)."""
    for asset in assets or []:
        if asset.get("name") == asset_name:
            return asset.get("browser_download_url")
    return None


def current_install_paths():
    """Returns (install_path, containing_dir) for the running frozen
    build -- the thing to be replaced, and the folder it lives in:

    - macOS: install_path is the "*.app" bundle itself, resolved from
      sys.executable (which sits at
      "<Name>.app/Contents/MacOS/<Name>"); containing_dir is normally
      /Applications, but whatever folder the .app actually happens to be
      running from.
    - Windows: build_windows.bat/release.yml zip up the .exe together
      with the rest of dist/"QUASAR Timesheet Manager"/, and the whole
      folder has to move as a unit for the .exe to keep working -- so
      install_path is that containing folder (the .exe's parent), and
      containing_dir is its parent.

    Raises AutoUpdateError if sys.executable isn't laid out the way the
    build scripts produce (shouldn't happen for a normal packaged
    build), or if the platform isn't macOS/Windows at all.
    """
    if sys.platform == "darwin":
        exe = Path(sys.executable).resolve()
        try:
            macos_dir, contents_dir, app_bundle = exe.parents[0], exe.parents[1], exe.parents[2]
        except IndexError:
            raise AutoUpdateError(f"unexpected macOS executable path: {exe}")
        if macos_dir.name != "MacOS" or contents_dir.name != "Contents" or app_bundle.suffix != ".app":
            raise AutoUpdateError(f"unexpected macOS app bundle layout: {exe}")
        return app_bundle, app_bundle.parent
    if sys.platform == "win32":
        # PureWindowsPath (not plain Path) so backslash-separated paths
        # parse correctly even when this function's tests run on a
        # non-Windows machine -- plain Path() only splits on backslashes
        # when the interpreter is actually running on Windows itself.
        exe = PureWindowsPath(sys.executable)
        install_dir = exe.parent
        return install_dir, install_dir.parent
    raise AutoUpdateError(f"auto-update isn't supported on this platform: {sys.platform!r}")


def download_asset(url: str, dest_dir: Path, timeout: float = 60.0) -> Path:
    """Downloads `url` into dest_dir/update.zip, returning that path."""
    dest = dest_dir / "update.zip"
    request = urllib.request.Request(url, headers=_HEADERS)
    try:
        # See update_check.build_ssl_context's docstring -- a frozen
        # macOS build can lose track of its own trusted certificate
        # bundle for HTTPS requests, this download included.
        with urllib.request.urlopen(request, timeout=timeout, context=build_ssl_context()) as response:
            dest.write_bytes(response.read())
    except Exception as exc:
        raise AutoUpdateError(f"download failed: {exc}") from exc
    return dest


def extract_zip(zip_path: Path, dest_dir: Path) -> Path:
    """Extracts zip_path into dest_dir (created by the caller), returning
    dest_dir back for convenience.

    macOS specifically shells out to `ditto` instead of using Python's
    zipfile module: zipfile.extractall() doesn't actually recreate
    symlinks -- it writes each one out as a plain file containing the
    link's target path as text instead of a real symlink. A macOS .app
    built with a bundled Python framework has real internal symlinks
    (e.g. Python.framework/Versions/Current), so extracting one with
    zipfile silently corrupts it just enough that macOS refuses to open
    it at all, with no useful error -- confirmed the hard way against a
    real downloaded update. `ditto` is Apple's own archive tool, and
    it's the exact same one release.yml uses to CREATE this zip in the
    first place, so it round-trips symlinks (and everything else
    macOS-bundle-specific) correctly. zipfile is fine for Windows, which
    has no such symlinks to lose."""
    if sys.platform == "darwin":
        try:
            subprocess.run(["ditto", "-x", "-k", str(zip_path), str(dest_dir)],
                            check=True, capture_output=True, text=True)
        except (subprocess.CalledProcessError, OSError) as exc:
            raise AutoUpdateError(f"couldn't extract the downloaded update: {exc}") from exc
        return dest_dir

    try:
        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(dest_dir)
    except Exception as exc:
        raise AutoUpdateError(f"couldn't extract the downloaded update: {exc}") from exc
    return dest_dir


def find_extracted_root(extract_dir: Path, expected_name: str) -> Path:
    """Both release.yml zips contain exactly one top-level entry, named
    to match what's already installed ("QUASAR Timesheet Manager.app" on
    macOS, "QUASAR Timesheet Manager" on Windows) -- find and return it."""
    candidate = extract_dir / expected_name
    if not candidate.exists():
        raise AutoUpdateError(f"downloaded update didn't contain {expected_name!r}")
    return candidate


def _write_macos_swap_script(script_path: Path, pid: int, new_app: Path, app_dst: Path, cleanup_dir: Path) -> None:
    script = f"""#!/bin/bash
# Auto-generated by app/auto_update.py -- waits for QUASAR Timesheet
# Manager (pid {pid}) to fully quit, swaps the newly-downloaded build
# into place, relaunches it, and cleans up after itself.
NEW_APP={shlex.quote(str(new_app))}
APP_DST={shlex.quote(str(app_dst))}
CLEANUP_DIR={shlex.quote(str(cleanup_dir))}

for i in $(seq 1 150); do
    kill -0 {pid} 2>/dev/null || break
    sleep 0.2
done

rm -rf "$APP_DST"
cp -R "$NEW_APP" "$APP_DST"
# Defensively clear any quarantine flag -- harmless if it was never set
# (plain urllib downloads usually aren't quarantined the way a browser
# download is), but this is exactly what a user would otherwise have to
# do by hand via right-click -> Open the first time after an update.
xattr -cr "$APP_DST" 2>/dev/null
open "$APP_DST"
rm -rf "$CLEANUP_DIR"
rm -f -- "$0"
"""
    script_path.write_text(script)
    script_path.chmod(0o755)


def _write_windows_swap_script(script_path: Path, pid: int, new_dir: Path, install_dir: Path,
                                cleanup_dir: Path, exe_name: str) -> None:
    script = f"""@echo off
:: Auto-generated by app/auto_update.py -- waits for QUASAR Timesheet
:: Manager (pid {pid}) to fully quit, swaps the newly-downloaded build
:: into place, and relaunches it. Deliberately does NOT delete itself
:: (a running .bat file can't reliably delete its own file on Windows) --
:: it's a few KB left in %TEMP%, which Windows cleans up on its own.
::
:: Critically, this script's own working directory must NOT be inside
:: the install folder it's about to rmdir -- Windows refuses to delete
:: a directory that is any running process's current directory (unlike
:: macOS/Unix), and a double-clicked .exe normally launches with its
:: own folder as the current directory, which this detached script
:: would otherwise inherit. cd somewhere unrelated first so the rmdir
:: below can actually succeed.
cd /d "%~dp0"
:waitloop
tasklist /FI "PID eq {pid}" 2>NUL | find "{pid}" >NUL
if not errorlevel 1 (
    timeout /t 1 /nobreak >nul
    goto waitloop
)

rmdir /s /q "{install_dir}"
move "{new_dir}" "{install_dir}"
start "" "{install_dir}\\{exe_name}"
rmdir /s /q "{cleanup_dir}"
"""
    script_path.write_text(script)


def perform_update(assets: List[dict]) -> None:
    """The one entry point main_window.py calls after the user picks
    "Yes" on the update popup. Downloads the release asset matching this
    platform, extracts it, writes and launches a detached swap script,
    and returns. The caller is expected to quit the app immediately
    after this returns successfully (see MainWindow._quit_for_update) --
    the swap script is already waiting for this process's PID to exit.

    Raises AutoUpdateError on any failure (not a packaged build, no
    matching asset, download/extraction trouble, ...); the caller should
    catch it and fall back to opening the release page in a browser."""
    if not is_frozen():
        raise AutoUpdateError("not running as a packaged build -- nothing to swap in place")

    asset_name = platform_asset_name()
    if asset_name is None:
        raise AutoUpdateError(f"no packaged build is published for this platform ({sys.platform!r})")

    url = find_asset_url(assets, asset_name)
    if url is None:
        raise AutoUpdateError(f"the release has no {asset_name!r} asset")

    install_path, _containing_dir = current_install_paths()

    work_dir = Path(tempfile.mkdtemp(prefix="quasar-update-"))
    zip_path = download_asset(url, work_dir)
    extract_dir = work_dir / "extracted"
    extract_dir.mkdir()
    extract_zip(zip_path, extract_dir)
    new_root = find_extracted_root(extract_dir, install_path.name)

    pid = os.getpid()
    # Neither swap process may run with its working directory inside
    # install_path -- it's about to delete/move that folder, and (on
    # Windows especially) a directory can't be removed while any running
    # process has it as its current directory. tempfile.gettempdir() is
    # unrelated to wherever the app is installed on either OS.
    safe_cwd = tempfile.gettempdir()
    if sys.platform == "darwin":
        fd, script_name = tempfile.mkstemp(prefix="quasar-update-swap-", suffix=".sh")
        os.close(fd)
        script_path = Path(script_name)
        _write_macos_swap_script(script_path, pid, new_root, install_path, work_dir)
        subprocess.Popen(["/bin/bash", str(script_path)], start_new_session=True, cwd=safe_cwd)
    elif sys.platform == "win32":
        fd, script_name = tempfile.mkstemp(prefix="quasar-update-swap-", suffix=".bat")
        os.close(fd)
        script_path = Path(script_name)
        # PureWindowsPath again -- same reasoning as current_install_paths' win32 branch above.
        _write_windows_swap_script(script_path, pid, new_root, install_path, work_dir, exe_name=PureWindowsPath(sys.executable).name)
        detached_flags = getattr(subprocess, "DETACHED_PROCESS", 0x00000008) | \
            getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0x00000200)
        subprocess.Popen(["cmd", "/c", str(script_path)], creationflags=detached_flags, cwd=safe_cwd)
    else:
        raise AutoUpdateError(f"auto-update isn't supported on this platform: {sys.platform!r}")
