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

# Trade certifi's own bundled CA list for the operating system's native
# trust store, before anything below gets a chance to open an HTTPS
# connection -- the Jira "Test connection" button in Settings, worklog
# upload, QDM import, and the GitHub update check all do eventually.
#
# Why this matters: `requests` (used by app/jira_client.py) verifies TLS
# certificates against the `certifi` package's own bundled list of public
# CAs by default, not whatever Windows/macOS already trusts. On a
# corporate network that intercepts HTTPS with its own inspection proxy
# (common on managed work laptops), the OS has that proxy's root
# certificate installed and trusted -- but certifi's bundle doesn't, and
# never will, since it only ships public CAs. The result is exactly
# "[SSL: CERTIFICATE_VERIFY_FAILED] ... unable to get local issuer
# certificate" on the Jira connection test, even though the same laptop's
# browser reaches the same site without complaint.
#
# truststore.inject_into_ssl() patches Python's ssl module so every HTTPS
# connection made from here on (through `requests`, `urllib`, anything)
# verifies against the OS's own trust store instead -- the same one the
# browser already uses, corporate proxy CA included. It's a no-op on a
# normal, uninspected connection (the OS store already contains the same
# public CAs certifi does), so this is safe to enable everywhere, not
# just on affected networks. Optional/best-effort: requirements.txt skips
# installing it on Python <3.10 (truststore's own minimum), so this falls
# back to certifi's default behaviour there instead of failing to start.
try:
    import truststore
    truststore.inject_into_ssl()
except ImportError:
    pass

from app.main_window import MainWindow  # noqa: E402


def main():
    win = MainWindow()
    win.mainloop()


if __name__ == "__main__":
    main()
