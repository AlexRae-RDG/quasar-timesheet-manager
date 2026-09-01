"""
Shared "modern look" building blocks used across the app: a hand-drawn
rounded button, a hand-drawn rounded-corner card, and a scrollable card
that combines a rounded card with the app's own hand-drawn scrollbar.

Tkinter/ttk has no first-class support for rounded corners -- there's no
border-radius style option, and ttk's "clam" theme engine draws buttons and
frame borders as hard rectangles no matter what padding/relief is
configured. This app already works around a very similar toolkit
limitation for its scrollbar (ttk.Scrollbar's thumb/track doesn't reliably
paint in this app's target environments -- see VectorScrollbar below) by
drawing it by hand on a Canvas instead of fighting the toolkit. Buttons and
card-style containers get the same treatment here, so every "box" in the
app -- buttons, cards, calendar blocks -- shares one consistent rounded
look instead of only the calendar blocks (see calendar_view._draw_entry)
looking modern while buttons and panels stayed sharp-cornered.
"""
import os
import tkinter as tk
import tkinter.font as tkfont
from typing import Callable, Optional

from . import theme

# Corner radius (px) for hand-drawn buttons and cards -- deliberately
# generous; rounded_rect() clamps it to half of whatever width/height a
# particular button or card actually ends up with, so small elements (e.g.
# the "‹"/"›" week-nav buttons) automatically become pill-shaped instead of
# needing a separate smaller constant.
BUTTON_RADIUS = 10
CARD_RADIUS = 14

# See sidebar.py's original copy of this flag (now here) -- set
# FREE_TIMESHEET_DEBUG_WHEEL=1 in the environment to print every wheel-ish
# event any ScrollArea's global dispatcher sees, and whether its geometric
# hit-test thought the pointer was over that particular scrollable area.
_DEBUG_WHEEL = os.environ.get("FREE_TIMESHEET_DEBUG_WHEEL") == "1"


def _color(spec: str) -> str:
    """Resolve a style-table color entry: a literal "#RRGGBB" is returned
    as-is, anything else is looked up as a live theme.* attribute name (so
    button colors always reflect whichever theme is currently active)."""
    if spec.startswith("#"):
        return spec
    return getattr(theme, spec)


def _darken(hex_color: str, amount: float) -> str:
    """Blend `hex_color` toward black by `amount` (0-1). Used for the
    optional drop shadow on RoundedButton: the shadow is drawn as a
    darkened echo of whatever surface sits behind the button (its own
    canvas bg, already resolved to the parent's color -- see
    _parent_bg), rather than a fixed gray that might clash with the
    current theme."""
    hex_color = hex_color.lstrip("#")
    r = int(hex_color[0:2], 16)
    g = int(hex_color[2:4], 16)
    b = int(hex_color[4:6], 16)
    r = max(0, min(255, int(r * (1 - amount))))
    g = max(0, min(255, int(g * (1 - amount))))
    b = max(0, min(255, int(b * (1 - amount))))
    return f"#{r:02x}{g:02x}{b:02x}"


def _parent_bg(widget) -> str:
    """Best-effort guess at a widget's background color, used so a
    hand-drawn button/card's own canvas background matches whatever it
    sits on (its four corners, cut off by the rounded shape, need to blend
    into the parent rather than showing a mismatched square halo).

    Plain tk widgets (Frame/Label/Canvas) expose a real "bg"/"background"
    option we can read directly. ttk widgets (ttk.Frame and friends, used
    for most button rows in this app) don't -- they're styled, not
    configured, so cget("bg") raises TclError. Every ttk.Frame in this app
    uses the default "TFrame" style, which theme.apply_theme() always
    configures to PANEL_BG, so that's the safe fallback.
    """
    try:
        bg = widget.cget("bg")
    except tk.TclError:
        return theme.PANEL_BG
    # Some ttk widgets/Tk builds don't raise TclError for an option they
    # don't really support -- they just hand back an empty string instead.
    # An empty bg passed straight to Canvas(bg=...) doesn't inherit
    # anything; it falls back to Tk's own platform default window color,
    # which is exactly the "mismatched square halo" this function exists
    # to prevent (seen on real macOS/Aqua ttk.Frame parents, not
    # reproducible against plain tk widgets or on Linux). Treat a falsy
    # result the same as a TclError.
    return bg or theme.PANEL_BG


# ---------------------------------------------------------------------------
# Buttons
# ---------------------------------------------------------------------------
_BUTTON_STYLES = {
    # Padding matches theme.apply_theme()'s old ttk button padding exactly
    # (14,8 / 10,6 / 10,6 / 8,5) -- not just for visual parity, but because
    # several smoke tests (and the sidebar/calendar minimum-width layout
    # itself) depend on the real pixel sizes these buttons occupy. Rounder
    # corners are a drawing change, not a "make everything bigger" change.
    #
    # Secondary/Nav both idle at "SURFACE" rather than "APP_BG": APP_BG is
    # this app's own darkest/outermost layer, which in every dark theme is
    # *darker* than the PANEL_BG these buttons actually sit on -- so an
    # APP_BG-filled button read as a dim notch sunk into its panel rather
    # than a button, exactly the "hard to read" overlapping-element problem.
    # SURFACE is a dedicated token that's deliberately a step *lighter* than
    # PANEL_BG in every dark theme (matching how BORDER/BORDER_STRONG below
    # already correctly lighten further still on hover/press), while
    # keeping the original APP_BG look for light themes, where a slightly
    # darker idle fill against a white/cream panel already reads fine. See
    # theme.py's THEMES dict for where SURFACE is defined per theme.
    "Accent.TButton": dict(bg="ACCENT", hover="ACCENT_HOVER", press="ACCENT_HOVER", fg="#FFFFFF",
                            bold=True, pad=(14, 8), border=None),
    "Secondary.TButton": dict(bg="SURFACE", hover="BORDER", press="BORDER_STRONG", fg="TEXT_PRIMARY",
                               bold=False, pad=(10, 6), border=None),
    "Danger.TButton": dict(bg="DANGER_SOFT", hover="DANGER_SOFT_ACTIVE", press="DANGER_SOFT_ACTIVE",
                            fg="DANGER", bold=False, pad=(10, 6), border=None),
    "Nav.TButton": dict(bg="PANEL_BG", hover="SURFACE", press="BORDER", fg="TEXT_PRIMARY",
                         bold=False, pad=(8, 5), border="BORDER_STRONG"),
}


class RoundedButton(tk.Canvas):
    """Hand-drawn, pill/rounded-corner replacement for ttk.Button.

    Matches this app's four style names (Accent/Secondary/Danger/Nav --
    same colors and padding theme.apply_theme() configures for the ttk
    versions, just drawn with rounded corners) and the small slice of the
    ttk.Button API this app actually calls: text=/command=/style=/width= at
    construction time, plus .config(text=...) and .config(style=...)
    afterwards (used by the Timer bar's Start/Stop toggle and the Summary
    tab's Week/Month toggle) and .cget("text") (used by a couple of smoke
    tests) -- enough to be a mechanical drop-in at every call site.
    """

    def __init__(self, master, text: str = "", command: Optional[Callable[[], None]] = None,
                 style: str = "Secondary.TButton", width: Optional[int] = None,
                 shadow: bool = False, **kwargs):
        bg = kwargs.pop("bg", None) or _parent_bg(master)
        kwargs.setdefault("highlightthickness", 0)
        kwargs.setdefault("cursor", "hand2")
        super().__init__(master, bg=bg, **kwargs)
        self._command = command
        self._text = text
        self._style = style
        self._char_width = width
        self._hover = False
        self._pressed = False
        # Opt-in only (currently just the calendar's nav row) -- a subtle
        # offset duplicate of the button's own shape, darkened and drawn
        # first so it peeks out bottom-right, is a "flat" hand-drawn
        # canvas's best approximation of a real (blurred, alpha-blended)
        # drop shadow. Not the default for every button in the app; this
        # is a deliberately small, opt-in visual accent.
        self._shadow = shadow

        self.bind("<Configure>", lambda e: self._redraw())
        self.bind("<Enter>", self._on_enter)
        self.bind("<Leave>", self._on_leave)
        self.bind("<ButtonPress-1>", self._on_press)
        self.bind("<ButtonRelease-1>", self._on_release)

        self._resize_to_content()

    # -- ttk.Button-compatible surface --------------------------------
    def cget(self, key):
        if key == "text":
            return self._text
        if key == "style":
            return self._style
        return super().cget(key)

    def __getitem__(self, key):
        return self.cget(key)

    def config(self, **kwargs):  # type: ignore[override]
        self.configure(**kwargs)

    def configure(self, **kwargs):  # type: ignore[override]
        resize = False
        if "text" in kwargs:
            self._text = kwargs.pop("text")
            resize = True
        if "style" in kwargs:
            self._style = kwargs.pop("style")
            resize = True
        if "command" in kwargs:
            self._command = kwargs.pop("command")
        if "width" in kwargs:
            # A plain int here means ttk-style "character width" (this
            # app's only usage, e.g. width=3 for the "‹"/"›" nav buttons)
            # rather than a pixel Canvas width -- handled by
            # _resize_to_content(), not passed through to Canvas.configure.
            self._char_width = kwargs.pop("width")
            resize = True
        if kwargs:
            super().configure(**kwargs)
        if resize:
            self._resize_to_content()
        else:
            self._redraw()

    # -- sizing ---------------------------------------------------------
    def _font(self):
        spec = _BUTTON_STYLES[self._style]
        family = theme.resolve_font_family()
        weight = "bold" if spec["bold"] else "normal"
        return tkfont.Font(family=family, size=10, weight=weight)

    def _resize_to_content(self):
        spec = _BUTTON_STYLES[self._style]
        f = self._font()
        pad_x, pad_y = spec["pad"]
        text_w = f.measure(self._text)
        if self._char_width:
            text_w = max(text_w, self._char_width * f.measure("0"))
        width = max(text_w + 2 * pad_x, 2 * pad_x + 4)
        height = f.metrics("linespace") + 2 * pad_y
        # super().configure(), not self.configure() -- our own override
        # above treats a "width" kwarg as ttk-style *character* width, not
        # a pixel Canvas width, which would misinterpret this and recurse.
        super().configure(width=int(width), height=int(height))
        self._redraw()

    # -- drawing ----------------------------------------------------------
    def _redraw(self):
        self.delete("all")
        w, h = self.winfo_width(), self.winfo_height()
        if w <= 1 or h <= 1:
            return
        spec = _BUTTON_STYLES[self._style]
        fill = _color(spec["press"] if self._pressed else spec["hover"] if self._hover else spec["bg"])
        fg = _color(spec["fg"])
        outline = _color(spec["border"]) if spec["border"] else ""
        # A quarter-pixel inset -- splitting the difference between the
        # original 0.5 (hairline-aligned at an exact 1x/2x scale, but
        # visibly uneven/glowy at other effective scale factors) and a
        # plain 0 (even all the way around, but reads as harder-edged/
        # more angular than the original look). 0.25 keeps the outline's
        # anti-aliasing closer to how it always looked without
        # reintroducing the lopsided "glow" the full 0.5 inset caused.
        inset = 0.25
        if self._shadow:
            # Shrink the "real" button rect by a couple of px on the
            # bottom-right, and draw a darkened copy of the same shape
            # first, offset into the space that frees up -- the sliver
            # that peeks out reads as a soft shadow without needing any
            # extra canvas space beyond the button's own footprint (which
            # would otherwise nudge this button out of vertical alignment
            # with its non-shadowed siblings, e.g. the week-range label).
            off = 2
            shadow_color = _darken(self.cget("bg"), 0.35)
            theme.rounded_rect(self, inset + off, inset + off, w - inset, h - inset,
                                radius=BUTTON_RADIUS, fill=shadow_color, outline="")
            theme.rounded_rect(self, inset, inset, w - inset - off, h - inset - off,
                                radius=BUTTON_RADIUS, fill=fill, outline=outline, width=1)
        else:
            theme.rounded_rect(self, inset, inset, w - inset, h - inset, radius=BUTTON_RADIUS,
                                fill=fill, outline=outline, width=1)
        f = self._font()
        self.create_text(w / 2, h / 2, text=self._text, fill=fg, font=f, anchor="center")

    # -- interaction ------------------------------------------------------
    def _on_enter(self, _event=None):
        self._hover = True
        self._redraw()

    def _on_leave(self, _event=None):
        self._hover = False
        self._pressed = False
        self._redraw()

    def _on_press(self, _event=None):
        self._pressed = True
        self._redraw()

    def _on_release(self, event=None):
        was_pressed = self._pressed
        self._pressed = False
        self._redraw()
        if was_pressed and event is not None and self._command is not None:
            if 0 <= event.x <= self.winfo_width() and 0 <= event.y <= self.winfo_height():
                self._command()

    def invoke(self):
        """Matches ttk.Button.invoke() -- fires the command directly,
        without needing a synthetic click. Used by nothing in this app
        today, kept for API parity / future tests."""
        if self._command is not None:
            self._command()


# ---------------------------------------------------------------------------
# Rounded cards
# ---------------------------------------------------------------------------
class RoundedCard(tk.Frame):
    """A rounded-corner container. Draws a rounded rectangle onto an
    internal Canvas sized to fill `self`, then overlays `.body` (a plain
    Frame, filled with the same color as the rounded shape) inset by at
    least the corner radius on every side -- so `.body`'s own square
    corners always land on the rounded rect's straight edges, invisible
    against the matching fill color underneath. Real content goes in
    `.body`, packed/gridded exactly like it would be in any other Frame.
    """

    def __init__(self, master, bg: Optional[str] = None, radius: int = CARD_RADIUS,
                 outline: bool = True, pad: Optional[int] = None, **kwargs):
        self._bg = bg or theme.PANEL_BG
        outer_bg = _parent_bg(master)
        kwargs.setdefault("bg", outer_bg)
        super().__init__(master, **kwargs)
        self._radius = radius
        self._outline = outline
        self._inset = pad if pad is not None else max(6, radius // 2)

        self._canvas = tk.Canvas(self, highlightthickness=0, bg=outer_bg)
        self._canvas.place(x=0, y=0, relwidth=1, relheight=1)
        self._canvas.bind("<Configure>", lambda e: self._redraw())

        self.body = tk.Frame(self, bg=self._bg)
        i = self._inset
        self.body.place(x=i, y=i, relwidth=1, relheight=1, width=-2 * i, height=-2 * i)

    def _redraw(self):
        c = self._canvas
        c.delete("all")
        w, h = c.winfo_width(), c.winfo_height()
        if w <= 1 or h <= 1:
            return
        outline_color = theme.BORDER if self._outline else ""
        # See the matching note in RoundedButton._redraw -- same quarter-
        # pixel inset (halfway between the too-glowy 0.5 and the too-
        # angular 0) applied here too, everywhere a RoundedCard draws its
        # own border (Activities panel, calendar grid, Timer bar, every
        # Settings/Duplicate/etc. panel).
        inset = 0.25
        theme.rounded_rect(c, inset, inset, w - inset, h - inset, radius=self._radius,
                            fill=self._bg, outline=outline_color, width=1)


class ScrollArea(RoundedCard):
    """A RoundedCard whose interior scrolls vertically -- the one thing to
    reach for whenever a panel's content might not fit the window (which,
    below full-screen, several already didn't: Settings' theme
    previews, the Activities sidebar once it has more than a handful of
    activities/projects, a tall Duplicate/Export/Backup panel, etc).

    Real content goes in `.content` (not `.body`, which here just hosts the
    scrolling machinery). Scrolling works four ways, in order of how
    reliable each one has proven across platforms in this app's history
    (see the long comment this replaces in sidebar.py's git history):
    two-finger trackpad scrolling on Tk 9+ (see _on_touchpad_anywhere/
    _on_touchpad_direct below -- Tk 9.0 stopped translating trackpad
    gestures into MouseWheel events at all, per TIP 684, in favor of a new
    dedicated TouchpadScroll event; confirmed via an isolated reproduction
    that on Tk 9.0.4/macOS zero MouseWheel/Button-4/Button-5 events ever
    fire for a trackpad swipe, only this one does), classic mouse wheel
    (best-effort -- older Tk/Aqua builds and some trackpads don't always
    deliver wheel events the way X11 does either), dragging the scrollbar
    thumb, and clicking the scrollbar's up/down arrow buttons or its bare
    track (guaranteed to work everywhere, since these depend only on plain
    button clicks rather than any wheel/scroll event actually reaching Tk).
    """

    def __init__(self, master, bg: Optional[str] = None, radius: int = CARD_RADIUS,
                 outline: bool = True, pad: Optional[int] = None, **kwargs):
        super().__init__(master, bg=bg, radius=radius, outline=outline, pad=pad, **kwargs)
        bgc = self._bg

        self.canvas = tk.Canvas(self.body, bg=bgc, highlightthickness=0)
        self.scrollbar = VectorScrollbar(self.body, command=self.canvas.yview, bg=bgc)
        self.content = tk.Frame(self.canvas, bg=bgc)
        self._wheel_bound: set = set()
        # TouchpadScroll (see _scroll_touchpad_from_event) reports small,
        # precise per-event pixel deltas via tk::PreciseScrollDeltas -- no
        # rounding to integer "units" happens anywhere in that path, so
        # unlike classic MouseWheel there's no leftover fractional motion
        # to track between events.

        self.content.bind("<Configure>", self._on_content_configure)
        window = self.canvas.create_window((0, 0), window=self.content, anchor="nw")
        self.canvas.bind("<Configure>", lambda e: self.canvas.itemconfigure(window, width=e.width))
        self.canvas.configure(yscrollcommand=self.scrollbar.set)

        # Scrollbar packed first: an expand=True widget packed first claims
        # the whole container, leaving a later-packed scrollbar nothing to
        # show in (see sidebar.py's original note on this same gotcha).
        self.scrollbar.pack(side="right", fill="y")
        self.canvas.pack(side="left", fill="both", expand=True)

        # Mouse wheel scrolling is wired up TWO independent ways, since a
        # real user reported wheel scrolling still not working after the
        # first approach alone (bind_all + winfo_containing) shipped, on
        # macOS specifically:
        #
        # 1. A global, geometry-hit-tested dispatch: on every wheel event
        #    anywhere in the app, check via winfo_containing() whether the
        #    pointer is actually over *this* ScrollArea. Works well on
        #    X11/Windows in testing.
        # 2. A DIRECT binding on every widget inside `.content` (see
        #    bind_wheel_recursive/_on_content_configure below), which
        #    sidesteps winfo_containing() entirely -- the event simply
        #    fires on whichever widget the pointer is actually over, no
        #    coordinate math involved. This matters because winfo_containing
        #    depends on root-window coordinates lining up with what the
        #    platform reports for the pointer, which is exactly the kind of
        #    thing HiDPI/Retina scaling on macOS has a real history of
        #    getting subtly wrong in Tk -- see the module docstring's note
        #    on Tk/Aqua wheel delivery being unreliable in general.
        #
        # Both paths end up calling _scroll_from_event, so neither one
        # "wins" -- whichever fires first just scrolls the canvas.
        self.bind_all("<MouseWheel>", self._on_wheel_anywhere, add="+")
        self.bind_all("<Button-4>", self._on_wheel_anywhere, add="+")
        self.bind_all("<Button-5>", self._on_wheel_anywhere, add="+")
        # <TouchpadScroll> is a Tk 9+ event (TIP 684). An older/other Tk
        # build that's never heard of it usually just never fires it if
        # you bind to it -- but Tk on Windows instead raises TclError
        # ("bad event type or keysym") the moment you try, which crashed
        # the app on startup there. So this is probed once, here, instead
        # of assumed: _bind_touchpad_scroll reports whether it actually
        # took, and every later touchpad bind (bind_wheel_recursive below)
        # trusts that same result instead of trying again.
        self._touchpad_supported = self._bind_touchpad_scroll(
            self, self._on_touchpad_anywhere, bind_all=True)
        self.bind_wheel_recursive(self.canvas)
        self.bind_wheel_recursive(self.scrollbar)
        self.bind_wheel_recursive(self.content)

    def _bind_touchpad_scroll(self, widget, handler, bind_all: bool = False) -> bool:
        """Best-effort <TouchpadScroll> bind (Tk 9+, TIP 684). Confirmed on
        Windows that some Tk builds raise TclError for this event name at
        bind time ("bad event type or keysym") rather than silently never
        firing it, so every attempt is guarded -- a failure here just means
        touchpad scrolling falls back to the other three scrolling paths
        (mouse wheel, scrollbar drag, and the scrollbar's arrow buttons)."""
        try:
            if bind_all:
                widget.bind_all("<TouchpadScroll>", handler, add="+")
            else:
                widget.bind("<TouchpadScroll>", handler, add="+")
            return True
        except tk.TclError:
            return False

    def refresh_scrollregion(self):
        """Call after replacing `.content`'s children in bulk (destroying
        and re-`pack`ing everything, say) if a caller needs the scrollbar
        to reflect the new size sooner than the next natural <Configure>."""
        self.canvas.configure(scrollregion=self.canvas.bbox("all"))
        self.bind_wheel_recursive(self.content)

    def _on_content_configure(self, _event=None):
        self.canvas.configure(scrollregion=self.canvas.bbox("all"))
        # `.content`'s children change constantly (rows added/removed,
        # panels rebuilt) -- re-attach the direct wheel binding here so
        # every newly-created row/label/frame picks it up automatically,
        # without every call site that populates a ScrollArea needing to
        # remember to do it themselves. bind_wheel_recursive tracks what's
        # already bound, so this is cheap on repeat calls.
        self.bind_wheel_recursive(self.content)

    def bind_wheel_recursive(self, widget):
        """Attach the direct (non-hit-tested) wheel handler to `widget` and
        every current descendant of it, skipping anything already bound
        (tracked in `self._wheel_bound`) so repeat calls -- e.g. from
        _on_content_configure, which fires on every row add/remove -- don't
        keep stacking additional callbacks on long-lived widgets and
        scrolling faster and faster."""
        if widget not in self._wheel_bound:
            widget.bind("<MouseWheel>", self._on_wheel_direct, add="+")
            widget.bind("<Button-4>", self._on_wheel_direct, add="+")
            widget.bind("<Button-5>", self._on_wheel_direct, add="+")
            # Tk 9+ TouchpadScroll (TIP 684) -- see class docstring and
            # _bind_touchpad_scroll. Only attempted when the __init__ probe
            # already confirmed this Tk build actually supports it.
            if self._touchpad_supported:
                self._bind_touchpad_scroll(widget, self._on_touchpad_direct)
            self._wheel_bound.add(widget)
        for child in widget.winfo_children():
            self.bind_wheel_recursive(child)

    def _is_within(self, widget) -> bool:
        w = widget
        while w is not None:
            if w is self.canvas or w is self.scrollbar:
                return True
            w = getattr(w, "master", None)
        return False

    def _scroll_from_event(self, event) -> bool:
        """Scroll the canvas per one wheel event. Returns whether it
        actually recognized the event as a scroll (handles the X11-style
        Button-4/5 case and the delta-based MouseWheel case used by
        Windows/macOS)."""
        if getattr(event, "num", None) == 4:
            self.canvas.yview_scroll(-1, "units")
        elif getattr(event, "num", None) == 5:
            self.canvas.yview_scroll(1, "units")
        elif getattr(event, "delta", 0):
            self.canvas.yview_scroll(-1 if event.delta > 0 else 1, "units")
        else:
            return False
        return True

    def _on_wheel_anywhere(self, event):
        try:
            hovered = self.winfo_containing(event.x_root, event.y_root)
        except (KeyError, tk.TclError):
            return
        within = self._is_within(hovered)
        if _DEBUG_WHEEL:
            print(f"[wheel-debug] anywhere event={event.type} num={getattr(event, 'num', None)} "
                  f"delta={getattr(event, 'delta', None)} root=({event.x_root},{event.y_root}) "
                  f"hovered={hovered!r} within={within}", flush=True)
        if not within:
            return
        self._scroll_from_event(event)

    def _on_wheel_direct(self, event):
        # Being called at all means the event fired on a widget we know is
        # inside this ScrollArea -- no hit-test needed, unlike
        # _on_wheel_anywhere above.
        if _DEBUG_WHEEL:
            print(f"[wheel-debug] direct event={event.type} num={getattr(event, 'num', None)} "
                  f"delta={getattr(event, 'delta', None)} widget={event.widget!r}", flush=True)
        self._scroll_from_event(event)

    def _scroll_touchpad_from_event(self, event) -> bool:
        """Scroll the canvas per one <TouchpadScroll> event (Tk 9+, TIP 684).

        Unlike classic <MouseWheel> (one event == one "click" == a fixed
        unit jump), TouchpadScroll fires many events per swipe, each
        carrying a small precise pixel delta packed into event.delta (the
        Tk %D substitution). We unpack it with the Tcl helper proc
        tk::PreciseScrollDeltas, then move the view by that many pixels
        (via yview_moveto against the canvas's current scrollregion)
        rather than converting to integer "units" -- doing units would
        require setting an explicit yscrollincrement on the canvas, which
        would risk changing the already-working feel of the classic
        MouseWheel/Button-4/5/scrollbar-arrow paths that all currently
        rely on Tk's default per-canvas unit size.

        Sign convention: mirrors the classic wheel handling below (a
        negative delta scrolls the view down). macOS's own "natural
        scrolling" setting already inverts the raw hardware signal before
        Tk ever sees it, so this is a best-guess convention -- flip the
        sign here if real-world testing shows it's backwards.
        """
        try:
            dx_str, dy_str = self.tk.splitlist(
                self.tk.call("tk::PreciseScrollDeltas", event.delta)
            )
            dy = int(dy_str)
        except (tk.TclError, ValueError, AttributeError):
            return False

        if dy == 0:
            return True  # recognized as a touchpad event, just no vertical motion

        try:
            region = self.canvas.cget("scrollregion")
            _, y0, _, y1 = (float(v) for v in str(region).split())
            content_height = y1 - y0
        except (tk.TclError, ValueError):
            return False

        if content_height <= 0:
            return True

        pixel_delta = -dy

        try:
            current_top = self.canvas.yview()[0] * content_height
        except tk.TclError:
            return False

        new_top = current_top + pixel_delta
        new_top = max(0.0, min(new_top, content_height))
        self.canvas.yview_moveto(new_top / content_height)
        return True

    def _on_touchpad_anywhere(self, event):
        try:
            hovered = self.winfo_containing(event.x_root, event.y_root)
        except (KeyError, tk.TclError):
            return
        within = self._is_within(hovered)
        if _DEBUG_WHEEL:
            print(f"[touchpad-debug] anywhere event={event.type} delta={getattr(event, 'delta', None)} "
                  f"root=({event.x_root},{event.y_root}) hovered={hovered!r} within={within}", flush=True)
        if not within:
            return
        self._scroll_touchpad_from_event(event)

    def _on_touchpad_direct(self, event):
        # Being called at all means the event fired on a widget we know is
        # inside this ScrollArea -- no hit-test needed, unlike
        # _on_touchpad_anywhere above.
        if _DEBUG_WHEEL:
            print(f"[touchpad-debug] direct event={event.type} delta={getattr(event, 'delta', None)} "
                  f"widget={event.widget!r}", flush=True)
        self._scroll_touchpad_from_event(event)


# ---------------------------------------------------------------------------
# Scrollbar
# ---------------------------------------------------------------------------
class VectorScrollbar(tk.Canvas):
    """A hand-drawn stand-in for ttk.Scrollbar.

    ttk.Scrollbar's "clam"-theme thumb/track doesn't reliably paint in this
    app's target environments -- an isolated reproduction (a bare Canvas +
    ttk.Scrollbar with an explicit width and a bright, unmistakable color)
    still rendered with zero visible pixels. That's the same class of
    problem this app has already hit with native pop-up window placement
    and Unicode glyph rendering, and the fix has always been the same:
    stop trusting the toolkit to draw the thing and draw it ourselves.

    This implements just enough of the real Scrollbar protocol to be a
    drop-in replacement: `set(first, last)` (called automatically via
    `yscrollcommand`) to draw the thumb, and being passed as `command=` to
    whatever it scrolls -- it calls that command the same way a real
    Scrollbar would, with ("moveto", fraction) or ("scroll", n, "units").

    Also draws a small up/down arrow button at each end of the track, and
    supports clicking/dragging the thumb and clicking the bare track. These
    all work via plain <Button-1>/<ButtonRelease-1>/<B1-Motion> and don't
    depend on wheel events at all -- a guaranteed fallback for platforms
    where mouse-wheel delivery to Tk is unreliable (see ScrollArea above).
    """
    WIDTH = 12
    MIN_THUMB_H = 24
    ARROW_H = 14
    ARROW_REPEAT_MS = 90
    ARROW_REPEAT_FIRST_MS = 350

    def __init__(self, master, command: Callable[..., None], **kwargs):
        kwargs.setdefault("width", self.WIDTH)
        kwargs.setdefault("bg", theme.PANEL_BG)
        kwargs.setdefault("highlightthickness", 0)
        kwargs.setdefault("cursor", "arrow")
        super().__init__(master, **kwargs)
        self._command = command
        self._first = 0.0
        self._last = 1.0
        self._dragging = False
        self._drag_offset = 0.0
        self._hover = False
        self._arrow_hover: Optional[str] = None  # "up" | "down" | None
        self._repeat_job: Optional[str] = None
        self.bind("<Configure>", lambda e: self._redraw())
        self.bind("<Button-1>", self._on_click)
        self.bind("<B1-Motion>", self._on_drag)
        self.bind("<ButtonRelease-1>", self._on_release)
        self.bind("<Enter>", self._on_enter)
        self.bind("<Leave>", self._on_leave)
        self.bind("<Motion>", self._on_motion)

    def set(self, first, last):
        """Matches ttk.Scrollbar.set / the yscrollcommand protocol."""
        self._first = float(first)
        self._last = float(last)
        self._redraw()

    # -- Track geometry (the draggable area sits between the two arrows) --
    def _track_bounds(self):
        h = self.winfo_height()
        return self.ARROW_H, max(self.ARROW_H, h - self.ARROW_H)

    def _thumb_bounds(self):
        track_top, track_bottom = self._track_bounds()
        track_h = track_bottom - track_top
        if track_h <= 1:
            return track_top, track_top
        top = track_top + self._first * track_h
        bottom = track_top + self._last * track_h
        if bottom - top < self.MIN_THUMB_H:
            center = (top + bottom) / 2
            top = center - self.MIN_THUMB_H / 2
            bottom = center + self.MIN_THUMB_H / 2
            if top < track_top:
                top, bottom = track_top, track_top + self.MIN_THUMB_H
            elif bottom > track_bottom:
                top, bottom = track_bottom - self.MIN_THUMB_H, track_bottom
        return top, bottom

    def _which_arrow(self, y) -> Optional[str]:
        h = self.winfo_height()
        if h <= 2 * self.ARROW_H:
            return None
        if y < self.ARROW_H:
            return "up"
        if y > h - self.ARROW_H:
            return "down"
        return None

    def _redraw(self):
        self.delete("all")
        w, h = self.winfo_width(), self.winfo_height()
        if w <= 1 or h <= 1:
            return
        self.create_rectangle(0, 0, w, h, fill=self.cget("bg"), outline="")

        can_scroll = not (self._first <= 0.0 and self._last >= 1.0)

        for which in ("up", "down"):
            active = self._arrow_hover == which and can_scroll
            tri_color = theme.ACCENT if active else (
                theme.TEXT_SECONDARY if can_scroll else theme.BORDER_STRONG)
            cx = w / 2
            cy = self.ARROW_H / 2 if which == "up" else h - self.ARROW_H / 2
            sz = 3.2
            if which == "up":
                pts = (cx - sz, cy + sz * 0.6, cx + sz, cy + sz * 0.6, cx, cy - sz * 0.6)
            else:
                pts = (cx - sz, cy - sz * 0.6, cx + sz, cy - sz * 0.6, cx, cy + sz * 0.6)
            self.create_polygon(*pts, fill=tri_color, outline="")

        if not can_scroll:
            # Everything already fits -- an empty track (and dimmed arrows)
            # communicates that better than a full-height thumb that can't
            # actually move.
            return
        top, bottom = self._thumb_bounds()
        pad = 2
        color = theme.ACCENT if (self._hover or self._dragging) else theme.BORDER_STRONG
        theme.rounded_rect(self, pad, top + pad, w - pad, bottom - pad,
                            radius=(w - 2 * pad) / 2, fill=color, outline="")

    def _on_enter(self, _event=None):
        self._hover = True
        self._redraw()

    def _on_leave(self, _event=None):
        self._hover = False
        self._arrow_hover = None
        self._redraw()

    def _on_motion(self, event):
        if self._dragging:
            return
        arrow = self._which_arrow(event.y)
        if arrow != self._arrow_hover:
            self._arrow_hover = arrow
            self._redraw()

    def _on_click(self, event):
        arrow = self._which_arrow(event.y)
        if arrow is not None:
            self._step(arrow)
            self._start_repeat(arrow)
            return
        top, bottom = self._thumb_bounds()
        if top <= event.y <= bottom:
            self._dragging = True
            self._drag_offset = event.y - top
            self._redraw()
        else:
            # Clicking the bare track (above or below the thumb) jumps the
            # view to roughly that position, same as clicking a real
            # scrollbar's track.
            track_top, track_bottom = self._track_bounds()
            track_h = track_bottom - track_top
            frac = max(0.0, min(1.0, (event.y - track_top) / track_h)) if track_h > 1 else 0.0
            self._command("moveto", frac)

    def _step(self, arrow: str):
        self._command("scroll", -1 if arrow == "up" else 1, "units")

    def _start_repeat(self, arrow: str):
        # Press-and-hold auto-repeats the step, same as a native scrollbar
        # arrow, so holding it down pages through a long list instead of
        # needing repeated clicks.
        self._cancel_repeat()

        def repeat():
            if self._arrow_hover != arrow:
                return
            self._step(arrow)
            self._repeat_job = self.after(self.ARROW_REPEAT_MS, repeat)

        self._repeat_job = self.after(self.ARROW_REPEAT_FIRST_MS, repeat)

    def _cancel_repeat(self):
        if self._repeat_job is not None:
            self.after_cancel(self._repeat_job)
            self._repeat_job = None

    def _on_drag(self, event):
        if not self._dragging:
            return
        track_top, track_bottom = self._track_bounds()
        track_h = track_bottom - track_top
        if track_h <= 1:
            return
        top0, bottom0 = self._thumb_bounds()
        thumb_h = bottom0 - top0
        usable = track_h - thumb_h
        new_top = max(track_top, min(track_top + usable, event.y - self._drag_offset))
        frac = (new_top - track_top) / usable if usable > 0 else 0.0
        self._command("moveto", frac)

    def _on_release(self, _event=None):
        self._dragging = False
        self._cancel_repeat()
        arrow = self._which_arrow(_event.y) if _event is not None else None
        self._arrow_hover = arrow
        self._redraw()


class HorizontalVectorScrollbar(tk.Canvas):
    """HorizontalVectorScrollbar is VectorScrollbar's mirror image -- same
    hand-drawn thumb/track/arrow-button approach (see VectorScrollbar's
    own docstring for why this app draws its own scrollbars at all), just
    laid out along x instead of y. Used by the calendar grid's new
    horizontal scroll fallback (see calendar_view.py) -- VectorScrollbar
    itself is left untouched since ScrollArea and every other existing
    user of it depends on its vertical-only behavior exactly as it is.

    Same drop-in protocol as VectorScrollbar: `set(first, last)` (via
    `xscrollcommand`) and `command=` called with ("moveto", fraction) or
    ("scroll", n, "units")."""
    HEIGHT = 12
    MIN_THUMB_W = 24
    ARROW_W = 14
    ARROW_REPEAT_MS = 90
    ARROW_REPEAT_FIRST_MS = 350

    def __init__(self, master, command: Callable[..., None], **kwargs):
        kwargs.setdefault("height", self.HEIGHT)
        kwargs.setdefault("bg", theme.PANEL_BG)
        kwargs.setdefault("highlightthickness", 0)
        kwargs.setdefault("cursor", "arrow")
        super().__init__(master, **kwargs)
        self._command = command
        self._first = 0.0
        self._last = 1.0
        self._dragging = False
        self._drag_offset = 0.0
        self._hover = False
        self._arrow_hover: Optional[str] = None  # "left" | "right" | None
        self._repeat_job: Optional[str] = None
        self.bind("<Configure>", lambda e: self._redraw())
        self.bind("<Button-1>", self._on_click)
        self.bind("<B1-Motion>", self._on_drag)
        self.bind("<ButtonRelease-1>", self._on_release)
        self.bind("<Enter>", self._on_enter)
        self.bind("<Leave>", self._on_leave)
        self.bind("<Motion>", self._on_motion)

    def set(self, first, last):
        """Matches ttk.Scrollbar.set / the xscrollcommand protocol."""
        self._first = float(first)
        self._last = float(last)
        self._redraw()

    # -- Track geometry (the draggable area sits between the two arrows) --
    def _track_bounds(self):
        w = self.winfo_width()
        return self.ARROW_W, max(self.ARROW_W, w - self.ARROW_W)

    def _thumb_bounds(self):
        track_left, track_right = self._track_bounds()
        track_w = track_right - track_left
        if track_w <= 1:
            return track_left, track_left
        left = track_left + self._first * track_w
        right = track_left + self._last * track_w
        if right - left < self.MIN_THUMB_W:
            center = (left + right) / 2
            left = center - self.MIN_THUMB_W / 2
            right = center + self.MIN_THUMB_W / 2
            if left < track_left:
                left, right = track_left, track_left + self.MIN_THUMB_W
            elif right > track_right:
                left, right = track_right - self.MIN_THUMB_W, track_right
        return left, right

    def _which_arrow(self, x) -> Optional[str]:
        w = self.winfo_width()
        if w <= 2 * self.ARROW_W:
            return None
        if x < self.ARROW_W:
            return "left"
        if x > w - self.ARROW_W:
            return "right"
        return None

    def _redraw(self):
        self.delete("all")
        w, h = self.winfo_width(), self.winfo_height()
        if w <= 1 or h <= 1:
            return
        self.create_rectangle(0, 0, w, h, fill=self.cget("bg"), outline="")

        can_scroll = not (self._first <= 0.0 and self._last >= 1.0)

        for which in ("left", "right"):
            active = self._arrow_hover == which and can_scroll
            tri_color = theme.ACCENT if active else (
                theme.TEXT_SECONDARY if can_scroll else theme.BORDER_STRONG)
            cy = h / 2
            cx = self.ARROW_W / 2 if which == "left" else w - self.ARROW_W / 2
            sz = 3.2
            if which == "left":
                pts = (cx + sz * 0.6, cy - sz, cx + sz * 0.6, cy + sz, cx - sz * 0.6, cy)
            else:
                pts = (cx - sz * 0.6, cy - sz, cx - sz * 0.6, cy + sz, cx + sz * 0.6, cy)
            self.create_polygon(*pts, fill=tri_color, outline="")

        if not can_scroll:
            # Everything already fits -- an empty track (and dimmed arrows)
            # communicates that better than a full-width thumb that can't
            # actually move.
            return
        left, right = self._thumb_bounds()
        pad = 2
        color = theme.ACCENT if (self._hover or self._dragging) else theme.BORDER_STRONG
        theme.rounded_rect(self, left + pad, pad, right - pad, h - pad,
                            radius=(h - 2 * pad) / 2, fill=color, outline="")

    def _on_enter(self, _event=None):
        self._hover = True
        self._redraw()

    def _on_leave(self, _event=None):
        self._hover = False
        self._arrow_hover = None
        self._redraw()

    def _on_motion(self, event):
        if self._dragging:
            return
        arrow = self._which_arrow(event.x)
        if arrow != self._arrow_hover:
            self._arrow_hover = arrow
            self._redraw()

    def _on_click(self, event):
        arrow = self._which_arrow(event.x)
        if arrow is not None:
            self._step(arrow)
            self._start_repeat(arrow)
            return
        left, right = self._thumb_bounds()
        if left <= event.x <= right:
            self._dragging = True
            self._drag_offset = event.x - left
            self._redraw()
        else:
            # Clicking the bare track (left or right of the thumb) jumps
            # the view to roughly that position, same as clicking a real
            # scrollbar's track.
            track_left, track_right = self._track_bounds()
            track_w = track_right - track_left
            frac = max(0.0, min(1.0, (event.x - track_left) / track_w)) if track_w > 1 else 0.0
            self._command("moveto", frac)

    def _step(self, arrow: str):
        self._command("scroll", -1 if arrow == "left" else 1, "units")

    def _start_repeat(self, arrow: str):
        # Press-and-hold auto-repeats the step, same as a native scrollbar
        # arrow, so holding it down pages through a long list instead of
        # needing repeated clicks.
        self._cancel_repeat()

        def repeat():
            if self._arrow_hover != arrow:
                return
            self._step(arrow)
            self._repeat_job = self.after(self.ARROW_REPEAT_MS, repeat)

        self._repeat_job = self.after(self.ARROW_REPEAT_FIRST_MS, repeat)

    def _cancel_repeat(self):
        if self._repeat_job is not None:
            self.after_cancel(self._repeat_job)
            self._repeat_job = None

    def _on_drag(self, event):
        if not self._dragging:
            return
        track_left, track_right = self._track_bounds()
        track_w = track_right - track_left
        if track_w <= 1:
            return
        left0, right0 = self._thumb_bounds()
        thumb_w = right0 - left0
        usable = track_w - thumb_w
        new_left = max(track_left, min(track_left + usable, event.x - self._drag_offset))
        frac = (new_left - track_left) / usable if usable > 0 else 0.0
        self._command("moveto", frac)

    def _on_release(self, _event=None):
        self._dragging = False
        self._cancel_repeat()
        arrow = self._which_arrow(_event.x) if _event is not None else None
        self._arrow_hover = arrow
        self._redraw()


def show_saved_toast(widget, text: str = "Saved"):
    """Brief, self-dismissing confirmation toast anchored to the
    bottom-right corner of `widget`'s window -- the only feedback after
    clicking Save used to be the panel/tab closing, which is easy to miss
    if you weren't watching for it. Call this right when a save succeeds,
    before the panel closes.

    Deliberately not a Toplevel the user can interact with: it doesn't
    grab focus, isn't modal, and never raises on failure -- confirmation
    is a nice-to-have, so on any platform quirk (no window manager
    support for override-redirect positioning, no -alpha support, a
    window that's mid-teardown) this just quietly does nothing rather
    than risking the save itself.

    Calling this again before a previous toast has faded replaces it
    (tracked on the root window as _saved_toast) instead of stacking
    multiple toasts on top of each other.
    """
    try:
        root = widget.winfo_toplevel()
        existing = getattr(root, "_saved_toast", None)
        if existing is not None:
            try:
                existing.destroy()
            except tk.TclError:
                pass
            root._saved_toast = None

        toast = tk.Toplevel(root)
        root._saved_toast = toast
        toast.withdraw()
        toast.overrideredirect(True)
        try:
            toast.attributes("-topmost", True)
        except tk.TclError:
            pass

        bg = theme.ACCENT
        card = RoundedCard(toast, bg=bg, radius=10, outline=False, pad=12)
        card.pack()
        family = theme.resolve_font_family()
        tk.Label(card.body, text=f"✓  {text}", font=(family, 11, "bold"),
                 bg=bg, fg="#FFFFFF").pack(padx=6, pady=4)

        toast.update_idletasks()
        w, h = toast.winfo_reqwidth(), toast.winfo_reqheight()
        x = root.winfo_rootx() + root.winfo_width() - w - 28
        y = root.winfo_rooty() + root.winfo_height() - h - 28
        toast.geometry(f"{w}x{h}+{x}+{y}")

        supports_alpha = True
        try:
            toast.attributes("-alpha", 0.0)
        except tk.TclError:
            supports_alpha = False
        toast.deiconify()

        def destroy_toast():
            if getattr(root, "_saved_toast", None) is toast:
                root._saved_toast = None
            try:
                toast.destroy()
            except tk.TclError:
                pass

        if not supports_alpha:
            root.after(1400, destroy_toast)
            return

        def fade(step, total, start, end, then):
            try:
                frac = step / total
                toast.attributes("-alpha", start + (end - start) * frac)
            except tk.TclError:
                then()
                return
            if step >= total:
                then()
            else:
                root.after(15, lambda: fade(step + 1, total, start, end, then))

        def fade_out():
            fade(0, 8, 1.0, 0.0, destroy_toast)

        fade(0, 6, 0.0, 1.0, lambda: root.after(1200, fade_out))
    except tk.TclError:
        pass
