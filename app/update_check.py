"""Checks GitHub Releases for a newer published version of this app than
the one currently running, so main_window.py can show a "new version
available" popup on launch.

Only works once the GitHub repo is public -- this app's own bundled
Python has no GitHub auth token to attach, and an unauthenticated request
against a private repo's API just comes back 404, which check_latest_
version() below already treats as "couldn't check" (returns None) rather
than an error. Nothing here ever raises out to the caller: no internet,
DNS failure, a slow connection, GitHub being down, rate limiting, a
private repo, no releases published yet, or a malformed response all
collapse to the same "skip the check this launch" outcome, since this is
a best-effort convenience, never something that should be allowed to
delay or interrupt a normal launch.

Uses only the standard library (urllib) rather than adding `requests` as
a dependency -- this app has stayed dependency-free everywhere else, and
one small, infrequent GET request doesn't need more than that.
"""
import json
import re
import urllib.request
from typing import Optional, Tuple

# Must match this project's actual GitHub repo (see the remote in `git
# remote -v`) -- there's nowhere else this could be auto-detected from
# inside a packaged, offline-installed copy of the app.
GITHUB_REPO = "AlexRae-RDG/quasar-timesheet-manager"
_LATEST_RELEASE_URL = f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"
_RELEASES_PAGE_URL = f"https://github.com/{GITHUB_REPO}/releases/latest"

# GitHub's API rejects requests with no User-Agent header (403s them) --
# any identifying string satisfies it, this one just also makes this
# app's own traffic recognizable in server logs if that's ever useful.
_HEADERS = {
    "User-Agent": "QUASAR-Timesheet-Manager-update-check",
    "Accept": "application/vnd.github+json",
}


def parse_version(text: str) -> Tuple[int, ...]:
    """"v1.5.0" / "1.5.0" -> (1, 5, 0). Tolerant of a missing "v" prefix
    (GitHub tag names always have one in this project, but the raw
    APP_VERSION string in version.py deliberately doesn't) and of
    anything that isn't a recognizable version at all -- returns (0, 0, 0)
    for those, which is_newer() below then never treats as newer than a
    real version, so a malformed value on either side just disables the
    comparison instead of raising."""
    match = re.search(r"(\d+)\.(\d+)\.(\d+)", text or "")
    if not match:
        return (0, 0, 0)
    return tuple(int(g) for g in match.groups())


def is_newer(candidate: str, current: str) -> bool:
    return parse_version(candidate) > parse_version(current)


def check_latest_version(timeout: float = 4.0) -> Optional[dict]:
    """Returns {"tag_name": "v1.6.0", "html_url": "...", "assets": [...]}
    for the latest published GitHub Release, or None if it couldn't be
    determined for any reason. Blocks for up to `timeout` seconds --
    callers (see main_window.py's _check_for_updates) are expected to run
    this off the Tkinter main thread so a slow/unreachable network never
    freezes the UI.

    "assets" is the release's raw list of downloadable files, each a dict
    with (among other things) "name" and "browser_download_url" -- passed
    straight through from GitHub's API, unfiltered, since it's
    auto_update.py's job (not this module's) to pick out the one asset
    that matches the platform this app is running on."""
    request = urllib.request.Request(_LATEST_RELEASE_URL, headers=_HEADERS)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            data = json.loads(response.read().decode("utf-8"))
    except Exception:
        # Deliberately blanket: see the module docstring -- every failure
        # mode here (no network, a 404 from a still-private repo or a repo
        # with no releases yet, a timeout, malformed JSON, ...) should be
        # indistinguishable to the caller from "nothing to report".
        return None

    tag_name = data.get("tag_name")
    if not tag_name:
        return None
    return {
        "tag_name": tag_name,
        "html_url": data.get("html_url") or _RELEASES_PAGE_URL,
        "assets": data.get("assets") or [],
    }
