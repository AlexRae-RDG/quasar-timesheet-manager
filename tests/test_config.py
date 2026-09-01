"""Standalone tests for app.config's Jira Issue Key helpers -- no Tkinter
required. These back the number-only Jira Issue Key entry fields on the
Activity and Time Block tabs (see app/panels.py and
app/timeblock_panel.py) -- the "QDM-" prefix is constant for this app, so
a human only ever types the number after it."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import config


class TestJiraKeyNumber(unittest.TestCase):
    def test_strips_the_fixed_prefix_for_display(self):
        self.assertEqual(config.jira_key_number("QDM-5455"), "5455")

    def test_none_or_blank_becomes_an_empty_field(self):
        self.assertEqual(config.jira_key_number(None), "")
        self.assertEqual(config.jira_key_number(""), "")

    def test_is_case_and_whitespace_tolerant(self):
        self.assertEqual(config.jira_key_number("  qdm-42  "), "42")

    def test_falls_back_to_showing_the_raw_value_if_prefix_doesnt_match(self):
        # Older data (or a key from before this app existed) shouldn't be
        # silently hidden just because it doesn't start with "QDM-".
        self.assertEqual(config.jira_key_number("OTHER-99"), "OTHER-99")


class TestJiraKeyFromNumber(unittest.TestCase):
    def test_prepends_the_fixed_prefix(self):
        self.assertEqual(config.jira_key_from_number("5455"), "QDM-5455")

    def test_strips_whitespace_first(self):
        self.assertEqual(config.jira_key_from_number("  42  "), "QDM-42")

    def test_blank_or_none_means_no_jira_issue_key_set(self):
        self.assertIsNone(config.jira_key_from_number(""))
        self.assertIsNone(config.jira_key_from_number("   "))
        self.assertIsNone(config.jira_key_from_number(None))

    def test_doesnt_double_up_a_prefix_someone_typed_or_pasted_themselves(self):
        self.assertEqual(config.jira_key_from_number("QDM-42"), "QDM-42")
        self.assertEqual(config.jira_key_from_number("qdm-42"), "qdm-42")

    def test_round_trips_with_jira_key_number(self):
        full = "QDM-1234"
        self.assertEqual(config.jira_key_from_number(config.jira_key_number(full)), full)


class TestZoomClamp(unittest.TestCase):
    """Regression coverage for two calendar zoom bugs, both eventually
    traced to the same root cause: zoom_clamp clamping raw_value against a
    moving target instead of scaling a fixed "unzoomed" size.

    Bug 1 (zoom-out): 85% and 70% zoom produced the identical (floored)
    size on a narrow window, because the very first version clamped
    raw_value to the fixed [min_px, max_px] range, multiplied by
    zoom_mult, then clamped AGAIN to that same fixed range -- erasing the
    zoom for any value that had reached the floor.

    Bug 2 (zoom-in): fixing bug 1 by clamping raw_value into
    [min_px*zoom_mult, max_px*zoom_mult] (scaling the bounds, not the
    value) then broke zoom-in on ordinary window sizes: a raw_value that
    already sat inside the *unzoomed* [min_px, max_px] range also sat
    inside the wider zoomed-in range, so it passed through completely
    unscaled and zooming in above 100% visibly did nothing.

    The fix pins raw_value to [min_px, max_px] once (the "100%" size)
    and then multiplies that by zoom_mult with no further clamping, so
    zoom actually scales the value at every window size instead of just
    nudging a clamp boundary that may or may not still bind."""

    def test_different_zoom_out_levels_produce_different_sizes_below_the_floor(self):
        # A narrow window: the raw auto-fit width is already below the
        # unzoomed minimum, so at 100% zoom it floors at min_px.
        raw = 90
        min_px, max_px = 140, 340
        at_100 = config.zoom_clamp(raw, min_px, max_px, 1.0)
        at_85 = config.zoom_clamp(raw, min_px, max_px, 0.85)
        at_70 = config.zoom_clamp(raw, min_px, max_px, 0.70)

        self.assertEqual(at_100, min_px)
        self.assertLess(at_85, at_100)
        self.assertLess(at_70, at_85)

    def test_different_zoom_in_levels_produce_different_sizes_above_the_ceiling(self):
        # A wide window: the raw auto-fit width is already above the
        # unzoomed maximum, so at 100% zoom it ceilings at max_px.
        raw = 500
        min_px, max_px = 140, 340
        at_100 = config.zoom_clamp(raw, min_px, max_px, 1.0)
        at_115 = config.zoom_clamp(raw, min_px, max_px, 1.15)
        at_130 = config.zoom_clamp(raw, min_px, max_px, 1.30)

        self.assertEqual(at_100, max_px)
        self.assertGreater(at_115, at_100)
        self.assertGreater(at_130, at_115)

    def test_zoom_actually_scales_an_ordinary_mid_range_value_too(self):
        # This is the case that broke: an everyday window size where the
        # auto-fit value already sits comfortably inside [min_px, max_px]
        # with no clamping needed at 100%. Zoom must still visibly change
        # the size here, not just when a window is unusually narrow/wide.
        raw = 240
        min_px, max_px = 140, 340
        at_100 = config.zoom_clamp(raw, min_px, max_px, 1.0)
        at_130 = config.zoom_clamp(raw, min_px, max_px, 1.30)
        at_70 = config.zoom_clamp(raw, min_px, max_px, 0.70)

        self.assertEqual(at_100, raw)
        self.assertGreater(at_130, at_100)
        self.assertLess(at_70, at_100)

    def test_clamps_to_the_unzoomed_minimum_before_scaling(self):
        self.assertEqual(config.zoom_clamp(10, 140, 340, 0.70), 140 * 0.70)

    def test_clamps_to_the_unzoomed_maximum_before_scaling(self):
        self.assertEqual(config.zoom_clamp(10000, 140, 340, 0.70), 340 * 0.70)

    def test_passes_through_unscaled_at_100_percent(self):
        self.assertEqual(config.zoom_clamp(200, 140, 340, 1.0), 200)

    def test_zoom_multiplier_of_one_matches_the_plain_unzoomed_clamp(self):
        for raw in (10, 140, 200, 340, 10000):
            self.assertEqual(config.zoom_clamp(raw, 140, 340, 1.0),
                              max(140, min(340, raw)))


if __name__ == "__main__":
    unittest.main(verbosity=2)
