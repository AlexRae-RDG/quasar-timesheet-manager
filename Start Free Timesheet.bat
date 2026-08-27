@echo off
title Free Timesheet
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
    echo Python was not found on this computer.
    echo.
    echo Install it from https://python.org - during setup, check the box
    echo that says "Add python.exe to PATH" - then double-click this file again.
    echo.
    pause
    exit /b 1
)

python app.py
if errorlevel 1 (
    echo.
    echo Free Timesheet closed with an error ^(see above^).
    pause
)
