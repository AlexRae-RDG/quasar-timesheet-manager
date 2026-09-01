"""Sidebar: saved Activities list with add/edit/delete + quick-assign
arming, organized into collapsible Projects. Every Activity belongs to
exactly one Project -- there's no "ungrouped" state -- since a time block's
color always comes from its Activity's Project (see app/models.py)."""
import tkinter as tk
from tkinter import messagebox
from typing import Callable, Dict, List, Optional

from . import theme
from .db import Database
from .models import Activity, Project
from .widgets import CARD_RADIUS, RoundedButton, RoundedCard, ScrollArea


class Sidebar(tk.Frame):
    def __init__(self, master, db: Database, on_change: Callable[[], None],
                 open_activity_panel: Callable[..., None],
                 open_project_panel: Callable[..., None],
                 collapsed: bool = False,
                 on_toggle_collapse: Optional[Callable[[], None]] = None, **kwargs):
        kwargs.setdefault("bg", theme.APP_BG)
        kwargs.setdefault("highlightthickness", 0)
        super().__init__(master, **kwargs)
        self.db = db
        self.on_change = on_change  # called whenever armed activity or list/project state changes
        self.open_activity_panel = open_activity_panel
        self.open_project_panel = open_project_panel
        # Collapsed is fixed for this instance's whole lifetime -- toggling
        # it (see on_toggle_collapse, called from main_window.py) triggers
        # a full window rebuild rather than switching this Sidebar between
        # modes in place, since the column width that holds it is owned by
        # MainWindow's grid, not by this widget. That keeps _render_rows
        # below simple: it only ever needs to render the one mode this
        # instance was built for.
        self.collapsed = collapsed
        self.on_toggle_collapse = on_toggle_collapse
        self.armed_activity_id: Optional[int] = None
        self.family = theme.resolve_font_family()
        self._activities: List[Activity] = []
        self._projects: List[Project] = []

        # The whole panel (header + hint + scrolling list) is one
        # RoundedCard now, so it reads as a single rounded box against the
        # window background -- matching the rounded buttons/calendar/timer
        # bar elsewhere instead of a plain rectangular sidebar with only
        # its inner list rounded. Real content lives in `.body`, exactly
        # like every other RoundedCard user in this app.
        #
        # Collapsed mode uses a smaller outer pack margin and a smaller
        # RoundedCard `pad` than the expanded card above -- the standard
        # 14px pack margin plus RoundedCard's own ~7px inset (28px total,
        # both sides) is fine against a 230px+ expanded sidebar, but
        # against a ~60px collapsed rail it left almost no real content
        # width. That's what actually broke the first collapsed design:
        # it wasn't just a styling problem, the button and Project dots
        # were being squeezed into a sliver only a few pixels wide and
        # rendering clipped. See config.SIDEBAR_COLLAPSED_WIDTH_PX for the
        # matching width-budget comment.
        card_padx, card_pady = (6, 10) if self.collapsed else (14, 14)
        card = RoundedCard(self, bg=theme.PANEL_BG, radius=CARD_RADIUS,
                            pad=4 if self.collapsed else None)
        card.pack(fill="both", expand=True, padx=card_padx, pady=card_pady)
        inner = card.body

        # list_container/canvas stay None in collapsed mode -- there's no
        # ScrollArea there (see below), so nothing sets them.
        self.list_container: Optional[ScrollArea] = None
        self.canvas: Optional[tk.Canvas] = None

        if self.collapsed:
            # A narrow icon rail instead of the full card: a round expand
            # button, a rotated "QDM's" label so it's obvious what's
            # hidden, then one small color dot per Project (no
            # Activities, no scrolling) as a quick visual reminder of
            # what's hidden. self.list_frame still exists here (holding
            # just the dots) so refresh()/_render_rows() below don't need
            # two separate call paths for external callers like
            # MainWindow._on_sidebar_change.
            #
            # This went through two earlier designs before landing here.
            # First, a bare 3-character "»" button was "extremely
            # difficult" to hit on the ~40px rail. Then a full-width
            # Accent-styled button was bigger but, combined with the
            # padding bug described above, rendered as a clipped sliver
            # instead of an actual button. This version fixes the real
            # spacing bug AND -- per the user's own pick from three
            # mocked-up options -- combines the compact round icon button
            # from one option with the rotated text label from another,
            # so there's both a proper-sized click target and a label
            # that reads at a glance. The whole rail (not just the
            # button) still re-expands on click, all with a hand cursor,
            # so hitting the exact button is never required.
            top_row = tk.Frame(inner, bg=theme.PANEL_BG)
            top_row.pack(pady=(2, 10))
            expand_btn = tk.Canvas(top_row, width=32, height=32, bg=theme.PANEL_BG,
                                    highlightthickness=0, cursor="hand2")
            expand_btn.create_oval(0, 0, 32, 32, fill=theme.ACCENT, outline="")
            expand_btn.create_line(12, 9, 20, 16, 12, 23, fill="#FFFFFF", width=3,
                                    capstyle="round", joinstyle="round")
            expand_btn.pack()
            if self.on_toggle_collapse is not None:
                expand_btn.bind("<Button-1>", lambda e: self.on_toggle_collapse())

            # A Canvas (not a Label) so the text can be drawn rotated --
            # Tk Labels have no rotation option, but Canvas.create_text
            # does via `angle=`. Sized just wide enough for the rotated
            # text's height (its *width* once rotated 90 degrees) plus a
            # little breathing room either side.
            label_canvas = tk.Canvas(inner, width=22, height=74, bg=theme.PANEL_BG,
                                      highlightthickness=0, cursor="hand2")
            label_canvas.create_text(11, 37, text="QDM's", angle=90,
                                      fill=theme.TEXT_SECONDARY,
                                      font=(self.family, 10, "bold"))
            label_canvas.pack(pady=(0, 12))

            self.list_frame = tk.Frame(inner, bg=theme.PANEL_BG)
            self.list_frame.pack(fill="both", expand=True)
            if self.on_toggle_collapse is not None:
                for widget in (card, inner, top_row, label_canvas, self.list_frame):
                    widget.configure(cursor="hand2")
                    widget.bind("<Button-1>", lambda e: self.on_toggle_collapse())
        else:
            header = tk.Frame(inner, bg=theme.PANEL_BG)
            header.pack(fill="x", pady=(0, 10))
            tk.Label(header, text="QDM's", font=(self.family, 13, "bold"),
                     bg=theme.PANEL_BG, fg=theme.TEXT_PRIMARY).pack(side="left")
            if self.on_toggle_collapse is not None:
                RoundedButton(header, text="«", width=3, style="Secondary.TButton",
                              command=self.on_toggle_collapse).pack(side="right")
            RoundedButton(header, text="+ QDM", style="Accent.TButton", command=self._add_activity).pack(
                side="right", padx=(0, 6))
            RoundedButton(header, text="+ Project", style="Secondary.TButton", command=self._add_project).pack(
                side="right", padx=(0, 6))

            # ScrollArea is itself a RoundedCard with a scrolling interior
            # built in -- see app/widgets.py for the mouse-wheel/drag/
            # click-arrow scrolling it provides (three independent ways to
            # scroll, since wheel-event delivery has proven unreliable on
            # at least one real user's machine across several binding
            # designs already). Its own outline is turned off here since
            # it now nests inside the outer card above -- a second visible
            # border right inside the first would just look like a
            # box-in-a-box instead of one clean panel.
            scroll_area = ScrollArea(inner, bg=theme.PANEL_BG, outline=False)
            scroll_area.pack(fill="both", expand=True)
            self.list_container = scroll_area
            self.canvas = scroll_area.canvas
            self.list_frame = scroll_area.content

        self.refresh()

    # ------------------------------------------------------------------
    def get_armed_activity(self) -> Optional[Activity]:
        if self.armed_activity_id is None:
            return None
        return self.db.get_activity(self.armed_activity_id)

    def clear_armed(self):
        self.armed_activity_id = None
        self._render_rows()
        self.on_change()

    # ------------------------------------------------------------------
    def refresh(self):
        self._activities = self.db.list_activities()
        self._projects = self.db.list_projects()
        self._render_rows()

    def _render_rows(self):
        for child in self.list_frame.winfo_children():
            child.destroy()

        if self.collapsed:
            self._render_collapsed_rail()
            return

        if not self._activities and not self._projects:
            tk.Label(self.list_frame, text="No QDM's yet. Click “+ QDM”.",
                      fg=theme.TEXT_MUTED, bg=theme.PANEL_BG, wraplength=200,
                      font=(self.family, 9)).pack(pady=14, padx=8)
            self.list_container.bind_wheel_recursive(self.list_frame)
            return

        by_project: Dict[int, List[Activity]] = {}
        for act in self._activities:
            if act.project_id is not None:
                by_project.setdefault(act.project_id, []).append(act)

        for project in self._projects:
            assert project.id is not None
            members = by_project.get(project.id, [])
            self._render_project_header(project, len(members))
            if not project.collapsed:
                if members:
                    for act in members:
                        self._render_activity_row(act)
                else:
                    tk.Label(self.list_frame, text="No activities in this project yet.",
                              fg=theme.TEXT_MUTED, bg=theme.PANEL_BG,
                              font=(self.family, 8, "italic")).pack(
                        anchor="w", padx=(28, 8), pady=(4, 8))

        # Belt-and-braces alongside ScrollArea's own auto-rebind-on-resize
        # (see widgets.ScrollArea._on_content_configure) -- collapsing/
        # expanding a project can leave the list's overall height unchanged
        # (one project's rows appear as another's disappear), which
        # wouldn't otherwise trigger a re-bind of the freshly-created rows.
        self.list_container.bind_wheel_recursive(self.list_frame)

    def _render_collapsed_rail(self):
        """Collapsed mode's whole "list": one small color dot per Project,
        no Activities -- just enough to remember what's hidden while the
        rail is narrow. Clicking any dot re-expands, same as the round
        button and "QDM's" label above it (and the rest of the rail)."""
        for project in self._projects:
            dot = tk.Canvas(self.list_frame, width=12, height=12, bg=theme.PANEL_BG,
                             highlightthickness=0, cursor="hand2")
            dot.create_oval(1, 1, 11, 11, fill=project.color, outline="")
            dot.pack(pady=4)
            if self.on_toggle_collapse is not None:
                dot.bind("<Button-1>", lambda e: self.on_toggle_collapse())

    def _render_activity_row(self, act: Activity):
        armed = act.id == self.armed_activity_id
        row_bg = theme.ACCENT_SOFT if armed else theme.PANEL_BG

        row = tk.Frame(self.list_frame, bg=row_bg, cursor="hand2")
        row.pack(fill="x")

        # Every Activity lives inside a Project, so it's always indented
        # under that Project's header to keep the grouping visually obvious.
        spacer = tk.Frame(row, bg=row_bg, width=18)
        spacer.pack(side="left", fill="y")

        accent_bar = tk.Frame(row, bg=(theme.ACCENT if armed else row_bg), width=3)
        accent_bar.pack(side="left", fill="y")

        content = tk.Frame(row, bg=row_bg)
        content.pack(side="left", fill="both", expand=True, padx=(9, 8), pady=8)

        top_line = tk.Frame(content, bg=row_bg)
        top_line.pack(fill="x")
        # This dot shows act.color -- which is really its Project's color,
        # joined in by Database.list_activities() (see app/models.py's
        # Activity docstring) -- as a reminder of which Project it belongs
        # to even when its Project header has scrolled out of view.
        dot = tk.Canvas(top_line, width=10, height=10, bg=row_bg, highlightthickness=0)
        dot.create_oval(0, 0, 10, 10, fill=act.color, outline="")
        dot.pack(side="left", padx=(0, 7))
        name_fg = theme.ACCENT if armed else theme.TEXT_PRIMARY
        tk.Label(top_line, text=act.name, bg=row_bg, fg=name_fg, anchor="w", justify="left",
                 wraplength=155 - 18,
                 font=(self.family, 10, "bold" if armed else "normal")).pack(
            side="left", fill="x", expand=True)

        meta_bits = []
        if act.jira_key:
            meta_bits.append(act.jira_key)
        if act.issue_type:
            meta_bits.append(act.issue_type)
        if act.default_duration_minutes:
            meta_bits.append(f"{act.default_duration_minutes} min")
        if meta_bits:
            tk.Label(content, text="   ·   ".join(meta_bits), bg=row_bg, fg=theme.TEXT_SECONDARY,
                     anchor="w", font=(self.family, 8)).pack(fill="x", pady=(2, 0))

        def bind_all(widget):
            widget.bind("<Button-1>", lambda e, a=act: self._arm(a))
            widget.bind("<Double-Button-1>", lambda e, a=act: self._edit_activity(a))
            widget.bind("<Button-3>", lambda e, a=act: self._context_menu(e, a))

        clickable = [row, content, top_line, dot] + content.winfo_children() + top_line.winfo_children()
        for widget in clickable:
            bind_all(widget)

        sep = tk.Frame(self.list_frame, bg=theme.BORDER, height=1)
        sep.pack(fill="x")

    def _render_project_header(self, project: Project, count: int):
        row = tk.Frame(self.list_frame, bg=theme.HEADER_BG)
        row.pack(fill="x")

        content = tk.Frame(row, bg=theme.HEADER_BG)
        content.pack(side="left", fill="both", expand=True, padx=(6, 8), pady=7)

        # A small vector-drawn triangle rather than a Unicode arrow glyph
        # (▾/▸) -- same reasoning as theme.draw_logo_mark/
        # draw_theme_swatch elsewhere in the app: glyph availability isn't
        # guaranteed across every OS/font combination, but a couple of
        # drawn lines always render the same everywhere.
        arrow_canvas = tk.Canvas(content, width=12, height=12, bg=theme.HEADER_BG,
                                  highlightthickness=0, cursor="hand2")
        arrow_canvas.pack(side="left", padx=(0, 2))
        if project.collapsed:
            points = (3, 2, 3, 10, 9, 6)   # pointing right
        else:
            points = (2, 3, 10, 3, 6, 9)   # pointing down
        arrow_canvas.create_polygon(*points, fill=theme.TEXT_SECONDARY, outline="")
        # Only the disclosure arrow toggles collapse -- toggling round-trips
        # through the database and refreshes every sidebar/calendar sharing
        # it (see _toggle_project), so keeping that off the rest of the row
        # means a double-click there reliably opens Edit instead of racing
        # a rebuild triggered by the first click.
        arrow_canvas.bind("<Button-1>", lambda e, p=project: self._toggle_project(p))

        # A small color swatch so the Project's color -- what every one of
        # its Activities' time blocks actually shows -- is visible right on
        # its own header, not just inferred from its Activities' dots.
        swatch = tk.Canvas(content, width=10, height=10, bg=theme.HEADER_BG, highlightthickness=0)
        swatch.create_oval(0, 0, 10, 10, fill=project.color, outline="")
        swatch.pack(side="left", padx=(0, 6))

        tk.Label(content, text=project.name, bg=theme.HEADER_BG, fg=theme.TEXT_PRIMARY,
                 anchor="w", font=(self.family, 10, "bold")).pack(side="left")
        tk.Label(content, text=f"({count})", bg=theme.HEADER_BG, fg=theme.TEXT_MUTED,
                 font=(self.family, 8)).pack(side="left", padx=(6, 0))

        def bind_edit_and_menu(widget):
            widget.bind("<Double-Button-1>", lambda e, p=project: self._edit_project(p))
            widget.bind("<Button-3>", lambda e, p=project: self._project_context_menu(e, p))

        for widget in [row, content] + content.winfo_children():
            bind_edit_and_menu(widget)

        sep = tk.Frame(self.list_frame, bg=theme.BORDER, height=1)
        sep.pack(fill="x")

    # ------------------------------------------------------------------
    # Activities
    # ------------------------------------------------------------------
    def _arm(self, activity: Activity):
        self.armed_activity_id = None if self.armed_activity_id == activity.id else activity.id
        self._render_rows()
        self.on_change()

    def _context_menu(self, event, activity: Activity):
        menu = tk.Menu(self, tearoff=0)
        menu.add_command(label="Edit…", command=lambda: self._edit_activity(activity))
        menu.add_command(label="Delete", command=lambda: self._delete_activity(activity))
        menu.tk_popup(event.x_root, event.y_root)

    def _add_activity(self):
        if not self._projects:
            # ActivityPanel's Project dropdown needs at least one option --
            # this only happens if every Project was ever deleted along
            # with its Activities, since a fresh install always seeds a
            # couple and deleting a Project otherwise falls back to
            # "General" rather than leaving zero.
            self.db.get_or_create_general_project()
            self._projects = self.db.list_projects()

        def on_save(result):
            self.db.add_activity(Activity(None, **result))
            self.on_change()
            return True

        self.open_activity_panel(activity=None, on_save=on_save, on_delete=None)

    def _edit_activity(self, activity: Activity):
        def on_save(result):
            activity.name = result["name"]
            activity.jira_key = result["jira_key"]
            activity.default_duration_minutes = result["default_duration_minutes"]
            activity.project_id = result["project_id"]
            activity.jira_project = result["jira_project"]
            activity.issue_type = result["issue_type"]
            self.db.update_activity(activity)
            self.on_change()
            return True

        def on_delete():
            self._delete_activity(activity)

        self.open_activity_panel(activity=activity, on_save=on_save, on_delete=on_delete)

    def _delete_activity(self, activity: Activity):
        assert activity.id is not None
        answer = messagebox.askyesnocancel(
            "Delete activity",
            f"Delete “{activity.name}”?\n\n"
            f"Yes = delete activity but keep its existing time blocks\n"
            f"No = also delete all of its time blocks\n"
            f"Cancel = don't delete anything",
        )
        if answer is None:
            return
        delete_entries = not answer  # answer True("Yes")->keep entries, False("No")->delete entries
        self.db.delete_activity(activity.id, delete_entries=delete_entries)
        if self.armed_activity_id == activity.id:
            self.armed_activity_id = None
        self.refresh()
        self.on_change()

    # ------------------------------------------------------------------
    # Projects
    # ------------------------------------------------------------------
    def _toggle_project(self, project: Project):
        assert project.id is not None
        self.db.set_project_collapsed(project.id, not project.collapsed)
        self.on_change()

    def _project_context_menu(self, event, project: Project):
        menu = tk.Menu(self, tearoff=0)
        menu.add_command(label="Collapse" if not project.collapsed else "Expand",
                          command=lambda: self._toggle_project(project))
        menu.add_command(label="Edit…", command=lambda: self._edit_project(project))
        menu.add_command(label="Delete", command=lambda: self._delete_project(project))
        menu.tk_popup(event.x_root, event.y_root)

    def _add_project(self):
        def on_save(result):
            self.db.add_project(Project(None, result["name"], result["color"]))
            self.on_change()
            return True

        self.open_project_panel(project=None, on_save=on_save, on_delete=None)

    def _edit_project(self, project: Project):
        def on_save(result):
            project.name = result["name"]
            project.color = result["color"]
            self.db.update_project(project)
            self.on_change()
            return True

        def on_delete():
            self._delete_project(project)

        self.open_project_panel(project=project, on_save=on_save, on_delete=on_delete)

    def _delete_project(self, project: Project):
        assert project.id is not None
        answer = messagebox.askyesnocancel(
            "Delete project",
            f"Delete the “{project.name}” project?\n\n"
            f"Yes = delete the project but keep its activities (they move to “General”)\n"
            f"No = also delete all activities inside it (their time blocks are kept)\n"
            f"Cancel = don't delete anything",
        )
        if answer is None:
            return
        delete_activities = not answer  # "Yes" -> keep activities, "No" -> delete them
        self.db.delete_project(project.id, delete_activities=delete_activities)
        if self.armed_activity_id is not None and self.db.get_activity(self.armed_activity_id) is None:
            self.armed_activity_id = None
        self.refresh()
        self.on_change()
