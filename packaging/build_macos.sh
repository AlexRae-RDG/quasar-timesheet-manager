#!/bin/bash
# Builds "QUASAR Timesheet Manager.app" -- a real, double-clickable macOS
# app with Python and Tkinter bundled inside, so it runs on a Mac with no
# separate Python install needed, and no Terminal window involved once
# it's built. Run this ON A MAC (PyInstaller bundles the actual interpreter
# of the machine it runs on -- it can't build a Mac app from Linux or
# Windows).
#
# Usage, from the repo root:
#   bash packaging/build_macos.sh
set -e
cd "$(dirname "$0")/.."

if ! command -v python3 >/dev/null 2>&1; then
    echo "Python 3 was not found. Install it from https://python.org first."
    exit 1
fi

echo "Setting up a throwaway build environment (packaging/.build-venv)..."
python3 -m venv packaging/.build-venv
source packaging/.build-venv/bin/activate
pip install --upgrade pip >/dev/null
pip install pyinstaller

if [ ! -f packaging/icons/icon.icns ]; then
    echo "Icon files not found -- generating them..."
    pip install pillow
    python3 packaging/make_icons.py
fi

echo "Building..."
rm -rf build dist
pyinstaller --noconfirm packaging/free_timesheet.spec

deactivate

echo ""
echo "Done. Your app is at: dist/QUASAR Timesheet Manager.app"
echo ""
echo "Drag it into /Applications, then the first time you open it:"
echo "  Right-click (or Control-click) the app -> Open -> Open, in the"
echo "  dialog that appears. This is only needed once -- macOS shows it"
echo "  because the app isn't signed with a paid Apple Developer"
echo "  certificate, not because anything is actually wrong with it. After"
echo "  that first confirmation, opening it normally (double-click, or from"
echo "  the Dock/Launchpad) works every time."
echo ""
echo "build/ and dist/ (at the repo root) are build output and safe to"
echo "delete/rebuild any time; packaging/.build-venv is the throwaway"
echo "virtual environment this script created and can be deleted too."
