"""Unit tests for the Timer button's rounding rule. Pure logic, no Tkinter
needed -- see app/time_rounding.py for why this is split out of
app/timer_bar.py.
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.time_rounding import round_duration_minutes  # noqa: E402


class TestRoundDurationMinutes(unittest.TestCase):
    def test_zero_or_negative_elapsed_logs_nothing(self):
        self.assertEqual(round_duration_minutes(0), 0)
        self.assertEqual(round_duration_minutes(-5), 0)

    def test_any_positive_elapsed_floors_to_at_least_one_quarter_hour(self):
        # A timer that ran at all -- even for a few seconds -- should never
        # silently produce a 0-minute (i.e. no) time block.
        self.assertEqual(round_duration_minutes(0.1), 15)
        self.assertEqual(round_duration_minutes(1), 15)
        self.assertEqual(round_duration_minutes(7), 15)

    def test_rounds_to_the_nearer_quarter_hour(self):
        self.assertEqual(round_duration_minutes(8), 15)     # closer to 15 than 0
        self.assertEqual(round_duration_minutes(22), 15)    # closer to 15 than 30
        self.assertEqual(round_duration_minutes(23), 30)    # closer to 30 than 15
        self.assertEqual(round_duration_minutes(37), 30)    # closer to 30 than 45
        self.assertEqual(round_duration_minutes(38), 45)    # closer to 45 than 30

    def test_exact_quarter_hour_multiples_are_unchanged(self):
        self.assertEqual(round_duration_minutes(15), 15)
        self.assertEqual(round_duration_minutes(30), 30)
        self.assertEqual(round_duration_minutes(90), 90)

    def test_long_elapsed_time_still_rounds_correctly(self):
        # 3h07m -> nearest quarter hour is 3h00m (180 min); 3h08m -> 3h15m.
        self.assertEqual(round_duration_minutes(187), 180)
        self.assertEqual(round_duration_minutes(188), 195)


if __name__ == "__main__":
    unittest.main()
