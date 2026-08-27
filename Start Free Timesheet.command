#!/bin/bash
# Double-click this file in Finder to launch Free Timesheet.
# (First time only: macOS may say it's from an unidentified developer --
# right-click the file, choose Open, then confirm. After that, plain
# double-clicking works.)
cd "$(dirname "$0")"

# macOS's bundled Tk is old and prints a cosmetic deprecation notice on
# every launch -- it's harmless (the app still runs fine), just silenced
# here so it doesn't look like an error.
export TK_SILENCE_DEPRECATION=1

if ! command -v python3 >/dev/null 2>&1; then
    echo "Python 3 was not found on this Mac."
    echo "Install it from https://python.org, then double-click this file again."
    read -r -p "Press Return to close this window..."
    exit 1
fi

python3 app.py
status=$?
if [ $status -ne 0 ]; then
    echo ""
    echo "Free Timesheet closed with an error (see above)."
    read -r -p "Press Return to close this window..."
fi
