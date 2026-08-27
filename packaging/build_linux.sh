#!/bin/bash
# Builds a "QUASAR Timesheet Manager" binary -- a real, double-clickable
# Linux app with Python and Tkinter bundled inside, so it runs without a
# separate Python install (it still needs whatever shared system libraries
# Tk itself depends on -- see the note below if it won't launch on another
# machine). Run this ON LINUX (PyInstaller bundles the actual interpreter
# of the machine it runs on -- it can't build a Linux binary from macOS or
# Windows).
#
# Usage, from the repo root:
#   bash packaging/build_linux.sh
set -e
cd "$(dirname "$0")/.."

if ! command -v python3 >/dev/null 2>&1; then
    echo "Python 3 was not found. Install it with your package manager first."
    exit 1
fi
if ! python3 -c "import tkinter" >/dev/null 2>&1; then
    echo "Tkinter isn't installed for this Python -- install it first, e.g.:"
    echo "  Debian/Ubuntu:  sudo apt install python3-tk"
    echo "  Fedora:         sudo dnf install python3-tkinter"
    echo "  Arch:           sudo pacman -S tk"
    exit 1
fi

echo "Setting up a throwaway build environment (packaging/.build-venv)..."
python3 -m venv --system-site-packages packaging/.build-venv
# --system-site-packages above: Tkinter is a system package tied to the
# system Python (there's no pip-installable version of it), so the venv
# needs to see the system's tkinter rather than trying to reinstall it.
source packaging/.build-venv/bin/activate
pip install --upgrade pip >/dev/null
pip install pyinstaller

if [ ! -f packaging/icons/icon.png ]; then
    echo "Icon files not found -- generating them..."
    pip install pillow
    python3 packaging/make_icons.py
fi

echo "Building..."
rm -rf build dist
pyinstaller --noconfirm packaging/free_timesheet.spec

deactivate

echo ""
echo "Done. Your app is at: dist/QUASAR Timesheet Manager/QUASAR Timesheet Manager"
echo ""
echo "Run it directly (./\"dist/QUASAR Timesheet Manager/QUASAR Timesheet Manager\"),"
echo "or copy the whole \"dist/QUASAR Timesheet Manager\" folder wherever you'd like"
echo "to keep it and point a .desktop launcher's Exec= line at the binary inside it"
echo "(see the repo root's Free Timesheet.desktop for the format, which still uses"
echo "the app's original file name) with Icon= set to the full path of"
echo "packaging/icons/icon.png."
echo ""
echo "This binary only bundles Python + this app's own code -- it still"
echo "relies on Tk/Tcl's shared libraries already being present on whatever"
echo "machine runs it (the same ones python3-tk depends on), since those"
echo "aren't portable to bundle the way pure-Python code is. If it fails to"
echo "launch on a different machine than the one that built it, installing"
echo "that machine's python3-tk package first is usually the fix -- or just"
echo "use the plain \"Start Free Timesheet.sh\" launcher at the repo root"
echo "instead, which only needs Python + Tkinter and skips packaging"
echo "entirely."
echo ""
echo "build/ and dist/ (at the repo root) are build output and safe to"
echo "delete/rebuild any time; packaging/.build-venv is the throwaway"
echo "virtual environment this script created and can be deleted too."
