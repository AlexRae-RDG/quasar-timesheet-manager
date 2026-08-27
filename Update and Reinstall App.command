#!/bin/bash
# Double-click this file in Finder whenever you've replaced this folder's
# contents with a newer version of the app and want your installed
# "QUASAR Timesheet Manager.app" (in /Applications) updated to match --
# no typing required, just watch it finish.
#
# What it does: rebuilds the app from this folder's current source (same
# as running packaging/build_macos.sh by hand), then copies the result
# into /Applications, replacing whatever version is already there. Your
# data is untouched either way -- it lives separately, at
# ~/.jira_timesheet/timesheet.db, not inside the app itself.
#
# (First time only: macOS may say this file is from an unidentified
# developer -- right-click it, choose Open, then confirm. After that,
# plain double-clicking works.)
cd "$(dirname "$0")"

echo "Rebuilding QUASAR Timesheet Manager from this folder..."
echo ""
bash packaging/build_macos.sh
build_status=$?

if [ $build_status -ne 0 ]; then
    echo ""
    echo "The build failed (see the errors above) -- nothing in /Applications"
    echo "was touched."
    read -r -p "Press Return to close this window..."
    exit 1
fi

APP_SRC="dist/QUASAR Timesheet Manager.app"
APP_DST="/Applications/QUASAR Timesheet Manager.app"

if [ ! -d "$APP_SRC" ]; then
    echo ""
    echo "Build finished but $APP_SRC wasn't found -- something unexpected"
    echo "happened. Nothing in /Applications was touched."
    read -r -p "Press Return to close this window..."
    exit 1
fi

echo ""
echo "Installing into /Applications (replacing the previous version, if any)..."
rm -rf "$APP_DST"
cp -R "$APP_SRC" "$APP_DST"

echo ""
echo "Done. \"QUASAR Timesheet Manager\" in /Applications is now up to date --"
echo "open it from there or Launchpad like normal. If macOS still asks about"
echo "an unidentified developer the very first time after an update,"
echo "right-click the app -> Open -> Open once, same as before."
echo ""
echo "Closing this window automatically..."

# Best-effort auto-close, success path only -- the two failure cases
# above still stop and wait for Return, so a real error stays on screen
# to actually be read instead of the window vanishing along with it.
# Only does anything inside Terminal.app itself (TERM_PROGRAM check); in
# iTerm or any other terminal this is a harmless no-op and the window is
# left open as before, same as if this block weren't here at all.
if [ "$TERM_PROGRAM" = "Apple_Terminal" ]; then
    close_tty="$(tty)"
    # Backgrounded with a short delay and disowned so it survives this
    # script's own exit below instead of asking Terminal to close a
    # window whose shell still looks "running" (which prompts a "are you
    # sure" dialog instead of just closing) or being killed outright when
    # the parent shell exits.
    (sleep 1; osascript -e "tell application \"Terminal\" to close (every window whose tty is \"$close_tty\")" \
        >/dev/null 2>&1) &
    disown
fi
exit 0
