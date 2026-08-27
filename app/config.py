"""
Application-wide configuration constants for the Jira Timesheet app.

Feel free to tweak these values to fit your own workflow (e.g. change
SLOT_MINUTES to 15 for finer-grained time blocking, or widen the visible
hours).
"""
import os
from typing import Optional

# ---------------------------------------------------------------------------
# Calendar grid
# ---------------------------------------------------------------------------
# WEEKDAY_NAMES/WEEKEND_NAMES are the fixed building blocks; DAY_NAMES is the
# *currently visible* list the rest of the app actually reads, and START_HOUR/
# END_HOUR the currently visible hour window -- all three are plain module
# globals (like every color in theme.py) rather than fixed constants, since
# Settings' "Work Hours" section (see app/panels.py's SettingsPanel and
# app/main_window.py's _load_settings_panel) lets a user change them at
# runtime. set_work_hours()/set_show_weekends() below are the only places
# that should ever reassign them -- everywhere else in the app just reads
# config.DAY_NAMES/config.START_HOUR/config.END_HOUR fresh, so a change here
# takes effect the moment the window rebuilds (the same full destroy-and-
# recreate a theme change already triggers, reused for this too, since the
# grid's dimensions are baked into widgets at construction time exactly like
# theme colors are).
WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
WEEKEND_NAMES = ["Saturday", "Sunday"]

DAY_NAMES = list(WEEKDAY_NAMES)
SHOW_WEEKENDS = False

# Visible work day, in 24h hours
START_HOUR = 9
END_HOUR = 17  # exclusive end (5pm)


def set_work_hours(start_hour: int, end_hour: int):
    """Change the calendar's visible work-hours window. `end_hour` is
    exclusive (17 means the grid's last visible half-hour ends at 5pm),
    same convention the original fixed START_HOUR/END_HOUR always used."""
    global START_HOUR, END_HOUR
    START_HOUR = start_hour
    END_HOUR = end_hour


def set_show_weekends(show: bool):
    """Toggle Saturday/Sunday on or off the calendar grid."""
    global DAY_NAMES, SHOW_WEEKENDS
    SHOW_WEEKENDS = show
    DAY_NAMES = (list(WEEKDAY_NAMES) + list(WEEKEND_NAMES)) if show else list(WEEKDAY_NAMES)


def week_end_offset() -> int:
    """Days from Monday to the last visible day of the week -- 4 for a
    plain Mon-Fri week, 6 once weekends are shown. The one shared source
    of truth for what used to be several separate hard-coded
    timedelta(days=4)s (the Summary tab's week range, the Export dialog's
    default date range, ...) -- each of those now derives it from here so
    they can't drift out of sync with what the calendar itself shows."""
    return len(DAY_NAMES) - 1

# Size of each draggable slot, in minutes. 30 or 15 both work well.
SLOT_MINUTES = 30

# Pixel height of a single slot row and pixel width of a single day column.
# The calendar grid is dynamic: it stretches to fill whatever space its
# window gives it, recomputing these on every resize. The values below are
# just the starting point (and the lower bound it won't shrink past) --
# the MAX_* values are the upper bound it won't grow past on very large
# windows, so blocks stay readable instead of turning huge.
SLOT_HEIGHT_PX = 34
DAY_WIDTH_PX = 190
MIN_SLOT_HEIGHT_PX = 22
MIN_DAY_WIDTH_PX = 140
MAX_SLOT_HEIGHT_PX = 64
MAX_DAY_WIDTH_PX = 340
GUTTER_WIDTH_PX = 60  # left-hand column that shows hour labels
HEADER_HEIGHT_PX = 44  # day-name header row

# Extra room below the last hour gridline, inside the canvas. The bottom-most
# hour label (e.g. "5 PM") is vertically centered ON that gridline, so it
# needs real space below it to avoid being clipped by the canvas edge.
CANVAS_BOTTOM_PAD_PX = 16

# Height reserved for the per-day totals row underneath the grid, and the
# minimum width given to the Activities sidebar (it's allowed to stretch
# wider than this as the window grows, but never narrower).
TOTALS_ROW_HEIGHT_PX = 28
MIN_SIDEBAR_WIDTH_PX = 230

# Corner radius (px) used when drawing time blocks.
BLOCK_CORNER_RADIUS = 10

# Minimum drag distance (px) before a click-drag is treated as a "drag to
# create a block" rather than a plain click (quick-assign).
DRAG_THRESHOLD_PX = 6

# Pixel distance from a block's top/bottom edge that counts as a resize grip.
RESIZE_GRIP_PX = 7

# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------
APP_DIR = os.path.join(os.path.expanduser("~"), ".jira_timesheet")
DB_PATH = os.path.join(APP_DIR, "timesheet.db")

# ---------------------------------------------------------------------------
# Project colors -- every Activity's time blocks show its Project's color,
# not a color of their own (chrome/UI colors live in app/theme.py)
# ---------------------------------------------------------------------------
DEFAULT_PROJECT_COLORS = [
    "#4C6EF5", "#12B886", "#F76707", "#E64980", "#7048E8",
    "#1098AD", "#F59F00", "#82C91E", "#E03131", "#495057",
]

# ---------------------------------------------------------------------------
# Jira CSV export
# ---------------------------------------------------------------------------
# The export matches this exact column structure (see app/export_csv.py):
#   Project, Issue Type, Key, Date Started, Display Name, Time Spent (h), Work Description
# Fixed for the scope of this app -- every exported row always goes into the
# same Jira project as the same issue type, so these are plain constants
# rather than user-editable settings. (Settings used to have "Default Jira
# Project"/"Default Issue Type" fields for this; removed since a value that
# never actually changes is just a place a typo could sneak in.) A time
# block can still override either one individually via its own Time Block
# tab, for the rare case one genuinely needs to differ -- see
# app/export_csv.py's build_row for the fallback order.
DEFAULT_JIRA_PROJECT = "Quasar Delivery Management"
DEFAULT_ISSUE_TYPE = "Sub-task"

# Every Jira Issue Key in this app starts with the same fixed prefix, so
# every place a human types one (app/panels.py's Activity tab, app/
# timeblock_panel.py's Time Block tab) only asks for the number after
# it -- jira_key_number/jira_key_from_number below are the shared
# round-trip between that number-only field and the real stored key.
JIRA_KEY_PREFIX = "QDM-"


def jira_key_number(full_key: Optional[str]) -> str:
    """Strip JIRA_KEY_PREFIX for display in a number-only entry field.
    Case/whitespace-tolerant, and falls back to showing the value as-is
    if it doesn't start with the prefix (older data from before this,
    or a stray paste) -- nothing already stored is ever silently
    dropped from view."""
    if not full_key:
        return ""
    full_key = full_key.strip()
    if full_key.upper().startswith(JIRA_KEY_PREFIX.upper()):
        return full_key[len(JIRA_KEY_PREFIX):].strip()
    return full_key


def jira_key_from_number(number: Optional[str]) -> Optional[str]:
    """The inverse of jira_key_number(): reconstructs the full key from
    whatever was typed into the number-only field. Tolerates someone
    pasting (or typing) the prefix themselves rather than doubling it
    up into "QDM-QDM-1234". Returns None for a blank entry, same as an
    unset Jira Issue Key has always meant in this app."""
    number = (number or "").strip()
    if not number:
        return None
    if number.upper().startswith(JIRA_KEY_PREFIX.upper()):
        return number
    return f"{JIRA_KEY_PREFIX}{number}"
