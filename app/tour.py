"""
Embedded (non-popup) guided-tour overlay.

A small floating instructional card, .place()'d directly on the main
window itself (not inside the notebook, so it floats above whichever
tab is selected) -- same "no separate pop-up window" reasoning as every
other dialog in this app (see app/panels.py's own module docstring):
a real Toplevel can get mis-positioned by the OS on some macOS/Tk
setups, and even setting that aside, this needs to sit on top of tab
content while the tour itself switches tabs underneath it, which a
separate window makes far more awkward than a plain .place()'d sibling
frame inside the same window.

Generic and app-agnostic on purpose: TourCard only knows how to show a
step's text with Back/Next/Skip controls, position itself near a target
widget, and draw a thin highlight ring around one. main_window.py owns
the actual step content (app/main_window.py's _TOUR_STEPS) and decides,
per step, which tab to switch to and which widget to point at before
calling show_step()/place_near()/highlight().
"""
import tkinter as tk
from typing import Callable, List, Optional

from . import theme
from .widgets import RoundedButton

_CARD_WIDTH = 320


class TourCard(tk.Frame):
    def __init__(self, master, family: str, on_next: Callable[[], None],
                 on_back: Callable[[], None], on_skip: Callable[[], None]):
        # A visible border so this reads as a distinct floating card
        # against whatever tab content is behind it.
        super().__init__(master, bg=theme.PANEL_BG, highlightbackground=theme.BORDER_STRONG,
                          highlightthickness=1, bd=0)
        self.family = family
        self.on_next = on_next
        self.on_back = on_back
        self.on_skip = on_skip
        self._highlight_frames: List[tk.Frame] = []

        inner = tk.Frame(self, bg=theme.PANEL_BG)
        inner.pack(fill="both", expand=True, padx=16, pady=14)

        top_row = tk.Frame(inner, bg=theme.PANEL_BG)
        top_row.pack(fill="x")
        self.step_label = tk.Label(top_row, text="", font=(self.family, 9, "bold"),
                                    bg=theme.PANEL_BG, fg=theme.ACCENT)
        self.step_label.pack(side="left")
        close_label = tk.Label(top_row, text="✕", font=(self.family, 10), bg=theme.PANEL_BG,
                                fg=theme.TEXT_MUTED, cursor="hand2")
        close_label.pack(side="right")
        close_label.bind("<Button-1>", lambda e: self.on_skip())

        self.text_label = tk.Label(inner, text="", font=(self.family, 10), bg=theme.PANEL_BG,
                                    fg=theme.TEXT_PRIMARY, justify="left",
                                    wraplength=_CARD_WIDTH - 32)
        self.text_label.pack(anchor="w", fill="x", pady=(8, 12))

        # btn_row's three buttons are built once here but Back is only
        # packed/unpacked per step (see show_step) -- there's nowhere to
        # go "back" to from the first step.
        btn_row = tk.Frame(inner, bg=theme.PANEL_BG)
        btn_row.pack(fill="x")
        self.skip_button = RoundedButton(btn_row, text="Skip tour", style="Secondary.TButton",
                                          command=lambda: self.on_skip())
        self.skip_button.pack(side="left")
        self.next_button = RoundedButton(btn_row, text="Next", style="Accent.TButton",
                                          command=lambda: self.on_next())
        self.next_button.pack(side="right")
        self.back_button = RoundedButton(btn_row, text="Back", style="Secondary.TButton",
                                          command=lambda: self.on_back())
        self._btn_row = btn_row

    def show_step(self, index: int, total: int, text: str):
        self.step_label.config(text=f"{index + 1} of {total}")
        self.text_label.config(text=text)
        self.next_button.config(text="Finish" if index == total - 1 else "Next")
        if index == 0:
            self.back_button.pack_forget()
        else:
            self.back_button.pack(side="right", padx=(0, 6), before=self.next_button)

    def place_near(self, root: tk.Misc, anchor_widget: Optional[tk.Widget]):
        """Positions this card just below-right of anchor_widget (converted
        from screen to root-window coordinates), flipping above/left and
        clamping to stay fully inside the window when it would otherwise
        run off an edge. Falls back to a fixed bottom-right corner when
        there's no anchor widget currently on screen to aim at (a hidden
        tab, or a step -- like Summary/Settings -- that's really about an
        entire tab rather than one control on it)."""
        root.update_idletasks()
        root_w = root.winfo_width()
        root_h = root.winfo_height()
        self.update_idletasks()
        card_w = max(self.winfo_reqwidth(), _CARD_WIDTH)
        card_h = self.winfo_reqheight()

        if anchor_widget is not None and anchor_widget.winfo_exists() and anchor_widget.winfo_ismapped():
            ax = anchor_widget.winfo_rootx() - root.winfo_rootx()
            ay = anchor_widget.winfo_rooty() - root.winfo_rooty()
            aw = anchor_widget.winfo_width()
            ah = anchor_widget.winfo_height()
            x = ax + min(24, aw)
            y = ay + ah + 12
            if y + card_h > root_h:
                y = max(12, ay - card_h - 12)
            if x + card_w > root_w:
                x = max(12, root_w - card_w - 12)
        else:
            x = root_w - card_w - 24
            y = root_h - card_h - 24

        x = max(12, min(x, root_w - card_w - 12))
        y = max(12, min(y, root_h - card_h - 12))
        self.place(x=x, y=y, width=card_w)
        self.lift()

    def highlight(self, root: tk.Misc, widget: Optional[tk.Widget]):
        """Draws a thin accent-colored ring around widget using four plain
        Frames for the edges (top/bottom/left/right) rather than one solid
        rectangle -- a solid one would cover the widget it's meant to be
        pointing at instead of just outlining it. No-ops (clearing any
        previous ring) when widget is None or not currently visible."""
        self.clear_highlight()
        if widget is None or not widget.winfo_exists() or not widget.winfo_ismapped():
            return
        x = widget.winfo_rootx() - root.winfo_rootx()
        y = widget.winfo_rooty() - root.winfo_rooty()
        w = widget.winfo_width()
        h = widget.winfo_height()
        thickness = 3
        pad = 3
        bars = [
            (x - pad, y - pad, w + pad * 2, thickness),                  # top
            (x - pad, y + h + pad - thickness, w + pad * 2, thickness),  # bottom
            (x - pad, y - pad, thickness, h + pad * 2),                  # left
            (x + w + pad - thickness, y - pad, thickness, h + pad * 2),  # right
        ]
        for bx, by, bw, bh in bars:
            bar = tk.Frame(root, bg=theme.ACCENT)
            bar.place(x=bx, y=by, width=max(bw, 1), height=max(bh, 1))
            bar.lift()
            self._highlight_frames.append(bar)
        self.lift()

    def clear_highlight(self):
        for frame in self._highlight_frames:
            frame.destroy()
        self._highlight_frames = []

    def destroy(self):
        self.clear_highlight()
        super().destroy()
