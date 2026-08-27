"""Pure time-rounding helpers, kept in their own module (no Tkinter import)
so they can be unit-tested directly without needing a display -- unlike
app/timer_bar.py, which needs Tkinter and is only exercised by the
Xvfb-based smoke tests.
"""

ROUND_TO_MINUTES = 15


def round_duration_minutes(elapsed_minutes: float) -> int:
    """Round elapsed timer time to the nearest 15 minutes, with a 15-minute
    floor. A 0-minute time block would be meaningless in a timesheet, so
    any timer that ran at all (even a few seconds -- someone clicked Stop
    right after Start by mistake) logs at least one quarter hour rather
    than silently logging nothing."""
    if elapsed_minutes <= 0:
        return 0
    rounded = round(elapsed_minutes / ROUND_TO_MINUTES) * ROUND_TO_MINUTES
    return max(ROUND_TO_MINUTES, rounded)
