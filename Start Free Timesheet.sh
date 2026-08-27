#!/bin/bash
# Linux launcher. Right-click this file -> Properties -> Permissions ->
# "Allow executing file as program" (only needed once), then double-click
# it (most file managers will offer to "Run" it; some ask "Run in
# Terminal" -- either works).
cd "$(dirname "$0")"

if ! command -v python3 >/dev/null 2>&1; then
    echo "Python 3 was not found."
    echo "Install it with your package manager (e.g. sudo apt install python3 python3-tk), then run this again."
    read -r -p "Press Enter to close..."
    exit 1
fi

python3 app.py
status=$?
if [ $status -ne 0 ]; then
    echo ""
    echo "Free Timesheet closed with an error (see above)."
    read -r -p "Press Enter to close..."
fi
