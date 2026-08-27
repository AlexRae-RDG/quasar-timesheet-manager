#!/usr/bin/env python3
"""
Free Timesheet — a self-hosted Toggl-Track-style weekly time blocker with
Jira CSV worklog export.

Run with:  python3 app.py
Requires:  Python 3.8+ with Tkinter (bundled on Windows/macOS; on Linux
           install the 'python3-tk' package if you see an import error).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.main_window import MainWindow  # noqa: E402


def main():
    win = MainWindow()
    win.mainloop()


if __name__ == "__main__":
    main()
