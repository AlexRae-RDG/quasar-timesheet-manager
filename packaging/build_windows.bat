@echo off
REM Builds "QUASAR Timesheet Manager.exe" -- a real, double-clickable
REM Windows app with Python and Tkinter bundled inside, so it runs on a
REM Windows PC with no separate Python install needed. Run this ON WINDOWS
REM (PyInstaller bundles the actual interpreter of the machine it runs on
REM -- it can't build a Windows app from macOS or Linux).
REM
REM Usage, from the repo root (double-click this file, or run it from a
REM Command Prompt opened in the repo root):
REM   packaging\build_windows.bat

cd /d "%~dp0\.."

where python >nul 2>nul
if errorlevel 1 (
    echo Python was not found. Install it from https://python.org first,
    echo checking "Add python.exe to PATH" during setup, then run this again.
    pause
    exit /b 1
)

echo Setting up a throwaway build environment (packaging\.build-venv)...
python -m venv packaging\.build-venv
call packaging\.build-venv\Scripts\activate.bat
python -m pip install --upgrade pip >nul
pip install pyinstaller

if not exist packaging\icons\icon.ico (
    echo Icon files not found -- generating them...
    pip install pillow
    python packaging\make_icons.py
)

echo Building...
if exist build rmdir /s /q build
if exist dist rmdir /s /q dist
pyinstaller --noconfirm packaging\free_timesheet.spec

call packaging\.build-venv\Scripts\deactivate.bat

echo.
echo Done. Your app is at: dist\QUASAR Timesheet Manager\QUASAR Timesheet Manager.exe
echo.
echo Copy the whole "dist\QUASAR Timesheet Manager" folder wherever you want to
echo keep it (a Desktop shortcut to the .exe inside it is the easiest way to
echo launch it) -- everything it needs is in that one folder, so moving or
echo zipping the whole folder together is safe; the .exe alone won't run on
echo its own once separated from the rest of the folder.
echo.
echo Windows SmartScreen may show an "unrecognized app" warning the first
echo time you run it, since it isn't signed with a paid code-signing
echo certificate -- click "More info", then "Run anyway". This is only
echo needed once.
echo.
echo build\ and dist\ (at the repo root) are build output and safe to
echo delete/rebuild any time; packaging\.build-venv is the throwaway
echo virtual environment this script created and can be deleted too.
pause
