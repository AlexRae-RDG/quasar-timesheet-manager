"""Top-level application window: header bar, sidebar, and weekly calendar grid."""
import sys
import tkinter as tk
from tkinter import messagebox, ttk

from . import config, jira_client, theme
from .calendar_view import CalendarGrid
from .db import Database
from .export_csv import export_entries
from .models import Project
from .panels import (ActivityPanel, BackupPanel, DuplicatePanel, ExportPanel, JiraUploadPanel,
                      ProjectPanel, SettingsPanel)
from .sidebar import Sidebar
from .summary_panel import SummaryPanel
from .timeblock_panel import TimeBlockPanel
from .timer_bar import TimerBar
from .widgets import RoundedButton


class MainWindow(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("QUASAR Timesheet Manager")
        self.geometry("1240x780")
        self.minsize(1000, 640)
        self._maximize_on_start()

        self.db = Database()

        # The user's own "Custom" palette seeds -- loaded before
        # set_theme() below so that, if theme_mode is "custom", it
        # resolves against the user's actual saved colors rather than
        # theme.py's built-in defaults for a brand-new install.
        _custom_defaults = theme.get_custom_seeds()
        theme.set_custom_seeds(
            self.db.get_setting("custom_theme_app_bg", _custom_defaults["app_bg"]) or _custom_defaults["app_bg"],
            self.db.get_setting("custom_theme_panel_bg", _custom_defaults["panel_bg"]) or _custom_defaults["panel_bg"],
            self.db.get_setting("custom_theme_text", _custom_defaults["text_primary"]) or _custom_defaults["text_primary"],
            self.db.get_setting("custom_theme_accent", _custom_defaults["accent"]) or _custom_defaults["accent"],
        )

        saved_theme = self.db.get_setting("theme_mode", theme.DEFAULT_THEME_ID) or theme.DEFAULT_THEME_ID
        theme.set_theme(saved_theme)

        # Work Hours / Show Weekends (Settings tab) -- same "load once at
        # startup, mutate the config module's globals" pattern theme.py's
        # own colors use, so every place that already reads
        # config.START_HOUR/config.END_HOUR/config.DAY_NAMES picks this up
        # with no further plumbing needed.
        saved_start_hour = int(self.db.get_setting("work_start_hour", str(config.START_HOUR))
                                or config.START_HOUR)
        saved_end_hour = int(self.db.get_setting("work_end_hour", str(config.END_HOUR))
                              or config.END_HOUR)
        config.set_work_hours(saved_start_hour, saved_end_hour)
        config.set_show_weekends((self.db.get_setting("show_weekends", "0") or "0") == "1")

        self.family = theme.apply_theme(self)
        self.configure(bg=theme.APP_BG)

        self._build_menu()
        self._build_header()
        self._build_timer_bar()
        self._build_body()
        self._bind_global_shortcuts()

        self.protocol("WM_DELETE_WINDOW", self._on_close)

        if sys.platform == "darwin":
            # Older Tk builds (the one macOS still bundles system-wide) have
            # a long-standing Cocoa bug where a freshly-created window shows
            # up blank until something forces it to repaint -- e.g. the user
            # resizing or minimizing it. Nudging the window by a pixel and
            # back right after launch forces that repaint automatically so
            # nobody has to do it by hand.
            self.after(150, self._nudge_to_force_repaint)

    def _nudge_to_force_repaint(self):
        try:
            x, y = self.winfo_x(), self.winfo_y()
            self.geometry(f"+{x + 1}+{y}")
            self.after(50, lambda: self.geometry(f"+{x}+{y}"))
        except tk.TclError:
            pass

    def _maximize_on_start(self):
        """Start filling the screen rather than the fixed 1240x780
        self.geometry() above (kept as the fallback size if every
        approach here fails, e.g. some unusual window manager) -- Tk
        doesn't have one call that reliably does this everywhere, so each
        platform gets its own best option:

        Windows and most Linux window managers support a real "zoomed"
        window state (self.state("zoomed")) or, failing that, the
        "-zoomed" attribute some X11 window managers use instead.

        macOS is deliberately handled differently, not just as the last
        resort below: the Tk/Aqua build macOS still bundles system-wide
        has a long history of quirks (see _nudge_to_force_repaint's own
        note on the same build's blank-window-on-launch bug), and
        "zoomed" isn't reliably one of the states it honors. Sizing the
        window to the screen's own dimensions gets the same practical
        result without depending on that support."""
        if sys.platform == "darwin":
            try:
                self.geometry(f"{self.winfo_screenwidth()}x{self.winfo_screenheight()}+0+0")
            except tk.TclError:
                pass
            return
        try:
            self.state("zoomed")
            return
        except tk.TclError:
            pass
        try:
            self.attributes("-zoomed", True)
            return
        except tk.TclError:
            pass
        try:
            self.geometry(f"{self.winfo_screenwidth()}x{self.winfo_screenheight()}+0+0")
        except tk.TclError:
            pass

    def _build_menu(self):
        menubar = tk.Menu(self)

        file_menu = tk.Menu(menubar, tearoff=0)
        file_menu.add_command(label="Export to Jira CSV…", command=self._open_export_dialog)
        file_menu.add_command(label="Upload to Jira…", command=self._open_jira_upload_dialog)
        file_menu.add_separator()
        file_menu.add_command(label="Backup & Restore…", command=self._open_backup_dialog)
        file_menu.add_separator()
        file_menu.add_command(label="Exit", command=self._on_close)
        menubar.add_cascade(label="File", menu=file_menu)

        settings_menu = tk.Menu(menubar, tearoff=0)
        settings_menu.add_command(label="Jira Export Settings…", command=self._open_settings_dialog)
        menubar.add_cascade(label="Settings", menu=settings_menu)

        # The old binary "Dark Mode" checkbutton lived here; it's been
        # replaced by a full theme picker embedded in the Settings tab (see
        # panels.SettingsPanel and app/theme.py's THEMES) since there are
        # now twenty curated themes (plus a Custom one) to choose from, not
        # just two. This menu item is
        # a shortcut straight to that picker rather than a second, separate
        # place to change it.
        view_menu = tk.Menu(menubar, tearoff=0)
        view_menu.add_command(label="Theme…", command=self._open_settings_dialog)
        menubar.add_cascade(label="View", menu=view_menu)

        help_menu = tk.Menu(menubar, tearoff=0)
        help_menu.add_command(label="How to use", command=self._show_help)
        menubar.add_cascade(label="Help", menu=help_menu)

        self.config(menu=menubar)

    def _build_header(self):
        header = tk.Frame(self, bg=theme.PANEL_BG)
        header.pack(fill="x")

        inner = tk.Frame(header, bg=theme.PANEL_BG)
        inner.pack(fill="x", padx=20, pady=14)

        title_row = tk.Frame(inner, bg=theme.PANEL_BG)
        title_row.pack(side="left")
        logo = tk.Canvas(title_row, width=30, height=30, bg=theme.PANEL_BG, highlightthickness=0)
        logo.pack(side="left", padx=(0, 10))
        theme.draw_logo_mark(logo)
        title_box = tk.Frame(title_row, bg=theme.PANEL_BG)
        title_box.pack(side="left")
        tk.Label(title_box, text="QUASAR Timesheet Manager", font=(self.family, 16, "bold"),
                 bg=theme.PANEL_BG, fg=theme.TEXT_PRIMARY).pack(anchor="w")

        # Settings used to have its own header button here -- it's now a
        # permanent tab (see _build_body) alongside Timesheet/Template/
        # Summary instead, so there's no separate "open" button for it any
        # more; the Settings/View-menu "Theme…" entries still reach it
        # (_open_settings_dialog now just selects the tab).
        btn_box = tk.Frame(inner, bg=theme.PANEL_BG)
        btn_box.pack(side="right")
        RoundedButton(btn_box, text="Export to Jira CSV", style="Accent.TButton",
                      command=self._open_export_dialog).pack(side="left", padx=(8, 0))
        RoundedButton(btn_box, text="Upload to Jira", style="Accent.TButton",
                      command=self._open_jira_upload_dialog).pack(side="left", padx=(8, 0))

        sep = tk.Frame(self, bg=theme.BORDER, height=1)
        sep.pack(fill="x")

    def _build_timer_bar(self, initial_timer_state=None):
        # Its own full-width row rather than squeezing into the header's
        # button cluster -- an activity picker + Start/Stop + a live
        # elapsed readout don't comfortably fit alongside Settings/Export/
        # Dark Mode at the window's minimum width, and it's arguably the
        # single most-used control in the app, so it gets a row of its own
        # instead of competing for space.
        self.timer_bar = TimerBar(
            self, self.db, get_activities=lambda: self.db.list_activities(),
            on_saved=self._on_timer_saved, family=self.family,
            initial_state=initial_timer_state)
        self.timer_bar.pack(fill="x")

        sep = tk.Frame(self, bg=theme.BORDER, height=1)
        sep.pack(fill="x")

    def _on_timer_saved(self, entry):
        # The timer always logs against *today*, regardless of which tab or
        # which week is currently on screen -- jump the Timesheet tab (not
        # Template, which isn't date-based) to today's week and bring it to
        # the front so the block that was just logged is immediately
        # visible, the same way a manually-drawn block would be.
        self._on_sidebar_change()
        self.calendar._go_today()
        self.notebook.select(0)

    def _make_sidebar_track_width(self, body):
        """Size column 0 (the sidebar) by hand on every resize of `body`,
        instead of leaving it to Tk's grid weight-based surplus
        distribution alone.

        CalendarGrid deliberately grows its own day columns to fill
        whatever width its column is given (see
        CalendarGrid._on_canvas_resize) -- that's the intended behavior,
        so the calendar soaks up most of a wider window. But it also means
        the calendar's *own* natural reqwidth grows right along with it
        (its internal day-total Frames get their width explicitly
        reconfigured to match), so by the time Tk lays the grid back out,
        the calendar's demand has already inflated to claim almost all of
        the available space. That leaves Tk's weight-based split with
        essentially no real surplus left to hand the sidebar its
        proportional share, and the sidebar stays pinned at its bare
        minsize even on a much wider window.

        The fix is to stop relying on that feedback loop and set the
        sidebar's minsize directly, as a fixed proportion of `body`'s own
        available width (matching the 1:4 weight split configured above),
        floored at MIN_SIDEBAR_WIDTH_PX. Column 0's weight is zeroed out
        once this takes over, so 100% of whatever's left still flows to
        the calendar column exactly as before.
        """
        col0 = body.grid_columnconfigure(0)
        col1 = body.grid_columnconfigure(1)
        w0 = col0["weight"] or 1
        w1 = col1["weight"] or 1
        ratio = w0 / (w0 + w1)

        def on_resize(event):
            if event.widget is not body:
                return
            sidebar_w = max(config.MIN_SIDEBAR_WIDTH_PX, int(event.width * ratio))
            body.grid_columnconfigure(0, minsize=sidebar_w, weight=0)

        body.bind("<Configure>", on_resize, add="+")

    def _build_body(self, initial_week_start=None):
        # A Notebook (tabs at the top) rather than a bare frame: every
        # dialog that used to be a pop-up window (add/edit time block,
        # duplicate, add/edit project, settings, export) is now a tab that
        # appears next to "Timesheet" only while it's in use, and hides
        # again afterwards -- see _show_panel()/_hide_panel() below and the
        # docstrings in app/timeblock_panel.py and app/panels.py for why
        # tabs instead of pop-up windows.
        #
        # "Template" is different: it's a second permanent tab (never hidden
        # via _register_panel/_show_panel) holding a recurring Mon-Fri week
        # of blocks that isn't tied to any real date -- see the module
        # docstring in app/calendar_view.py. "Apply Template to This Week"
        # on the Timesheet tab copies it onto whatever week is open there.
        # Hand-drawn tab strip instead of ttk.Notebook's own (square-
        # cornered, see theme.apply_theme's tabposition="" note) -- this
        # row of RoundedButton toggles is purely cosmetic. It doesn't
        # replace any of the notebook's actual tab-management: `self.
        # notebook` underneath still gets every .add/.tab(state=...)/
        # .select() call exactly as before, from the exact same call
        # sites (_register_panel/_show_panel/_hide_panel below) -- this
        # bar just mirrors whichever tabs are currently in "normal" state
        # and calls .select() on click, refreshed by _refresh_tab_bar()
        # (called from _on_tab_changed, so it stays in sync with every
        # notebook.select()/tab(state=...) call anywhere in this file).
        self.tab_bar = tk.Frame(self, bg=theme.APP_BG)
        # Equal gap above and below -- it used to be flush against the
        # separator under the Timer bar (pady top=0) while still getting
        # 8px before the notebook/content card below, which read as
        # crowded against the Timer section and lopsided against the card.
        self.tab_bar.pack(fill="x", padx=16, pady=(10, 10))
        self._all_tabs: list = []  # [(widget, tab_text), ...] in tab order

        self.notebook = ttk.Notebook(self)
        self.notebook.pack(fill="both", expand=True, padx=16, pady=(0, 16))
        self.notebook.bind("<<NotebookTabChanged>>", self._on_tab_changed)
        self._panels = []

        body = tk.Frame(self.notebook, bg=theme.APP_BG)
        self.notebook.add(body, text="Timesheet")
        self._all_tabs.append((body, "Timesheet"))
        # Kept so _active_calendar() (see the keyboard-shortcut handlers
        # below) can tell which tab is currently showing -- notebook.select()
        # returns the tab *container* widget's path, not self.calendar
        # itself, since the calendar is nested a level deeper alongside the
        # sidebar.
        self.timesheet_tab = body

        # Grid (rather than pack) so the sidebar column can stretch along
        # with the window instead of staying pinned at a fixed pixel width
        # -- it just gets a much smaller share of any extra space than the
        # calendar does, and never shrinks below MIN_SIDEBAR_WIDTH_PX.
        body.grid_rowconfigure(0, weight=1)
        body.grid_columnconfigure(0, weight=1, minsize=config.MIN_SIDEBAR_WIDTH_PX)
        body.grid_columnconfigure(1, weight=4)
        self._make_sidebar_track_width(body)

        self.sidebar = Sidebar(body, self.db, on_change=self._on_sidebar_change,
                                open_activity_panel=self._open_activity_panel,
                                open_project_panel=self._open_project_panel)
        # The 14px gap between sidebar and calendar is taken out of the
        # calendar's side (padx on the calendar below), not the sidebar's:
        # the sidebar's ScrollArea draws its rounded card via place(), which
        # -- unlike pack -- doesn't hint the column's width negotiation with
        # its content's natural size, so any padx carved out of the
        # sidebar's own cell comes straight off its configured minimum
        # width. The calendar has plenty of slack to spare instead.
        self.sidebar.grid(row=0, column=0, sticky="nsew")

        self.calendar = CalendarGrid(
            body, self.db,
            get_armed_activity=lambda: self.sidebar.get_armed_activity(),
            clear_armed_activity=lambda: self.sidebar.clear_armed(),
            open_time_block=self._open_time_block_panel,
            open_duplicate=self._open_duplicate_panel,
            initial_week_start=initial_week_start,
        )
        self.calendar.grid(row=0, column=1, sticky="nsew", padx=(14, 0))

        # Permanent "Template" tab -- built the same way as "Timesheet"
        # above, but backed by TemplateEntry rows (template_mode=True) with
        # its own Sidebar/CalendarGrid pair so arming/editing activities
        # there doesn't interfere with whatever's armed on the real
        # Timesheet tab. Added directly via self.notebook.add (NOT
        # self._register_panel) so it's never auto-hidden by _show_panel.
        template_body = tk.Frame(self.notebook, bg=theme.APP_BG)
        self.notebook.add(template_body, text="Template")
        self._all_tabs.append((template_body, "Template"))
        self.template_tab = template_body

        template_body.grid_rowconfigure(0, weight=1)
        template_body.grid_columnconfigure(0, weight=1, minsize=config.MIN_SIDEBAR_WIDTH_PX)
        template_body.grid_columnconfigure(1, weight=4)
        self._make_sidebar_track_width(template_body)

        self.template_sidebar = Sidebar(template_body, self.db, on_change=self._on_sidebar_change,
                                         open_activity_panel=self._open_activity_panel,
                                         open_project_panel=self._open_project_panel)
        self.template_sidebar.grid(row=0, column=0, sticky="nsew")

        self.template_calendar = CalendarGrid(
            template_body, self.db,
            get_armed_activity=lambda: self.template_sidebar.get_armed_activity(),
            clear_armed_activity=lambda: self.template_sidebar.clear_armed(),
            open_time_block=self._open_time_block_panel,
            open_duplicate=self._open_duplicate_panel,
            template_mode=True,
        )
        self.template_calendar.grid(row=0, column=1, sticky="nsew", padx=(14, 0))

        # Permanent "Summary" tab -- like Template, added directly via
        # self.notebook.add (not self._register_panel) so it's never
        # auto-hidden; it's a place you come back to, not a one-shot dialog.
        self.summary_panel = SummaryPanel(self.notebook, self.db, family=self.family)
        self.notebook.add(self.summary_panel, text="Summary")
        self._all_tabs.append((self.summary_panel, "Summary"))

        # Permanent "Settings" tab -- same treatment as Template/Summary
        # above (added directly, never auto-hidden) instead of the
        # hide-until-opened panel it used to be, reached by a header
        # button that's now gone. on_close no longer hides this tab (there
        # would be nothing left to switch back to it with) -- Save/Cancel
        # just jump back to the Timesheet tab, same "you're done, here's
        # your other work" feel as before, minus actually disappearing.
        self.settings_panel = SettingsPanel(
            self.notebook, family=self.family,
            on_close=lambda: self.notebook.select(0))
        self.notebook.add(self.settings_panel, text="Settings")
        self._all_tabs.append((self.settings_panel, "Settings"))
        self._load_settings_panel()

        self.timeblock_panel = TimeBlockPanel(
            self.notebook, family=self.family,
            on_close=lambda: self._hide_panel(self.timeblock_panel))
        self._register_panel(self.timeblock_panel, "Time Block")

        self.duplicate_panel = DuplicatePanel(
            self.notebook, family=self.family,
            on_close=lambda: self._hide_panel(self.duplicate_panel))
        self._register_panel(self.duplicate_panel, "Duplicate")

        self.activity_panel = ActivityPanel(
            self.notebook, family=self.family,
            on_close=lambda: self._hide_panel(self.activity_panel),
            get_projects=lambda: self.db.list_projects(),
            create_project=self._create_project_inline)
        self._register_panel(self.activity_panel, "Add QDM")

        self.project_panel = ProjectPanel(
            self.notebook, family=self.family,
            on_close=lambda: self._hide_panel(self.project_panel))
        self._register_panel(self.project_panel, "Project")

        self.backup_panel = BackupPanel(
            self.notebook, family=self.family,
            on_close=lambda: self._hide_panel(self.backup_panel),
            on_backup=self._backup_data, on_restore=self._restore_data)
        self._register_panel(self.backup_panel, "Backup")

        self.export_panel = ExportPanel(
            self.notebook, family=self.family,
            on_close=lambda: self._hide_panel(self.export_panel))
        self._register_panel(self.export_panel, "Export")

        self.jira_upload_panel = JiraUploadPanel(
            self.notebook, family=self.family,
            on_close=lambda: self._hide_panel(self.jira_upload_panel))
        self._register_panel(self.jira_upload_panel, "Upload")

        self._refresh_tab_bar()

    def _on_sidebar_change(self):
        # Both tabs share the same activities/projects tables, so an
        # arm/edit/delete on either sidebar needs to refresh both
        # calendars, both sidebars, and the timer bar's activity picker
        # to stay in sync.
        self.calendar.refresh()
        self.template_calendar.refresh()
        self.sidebar.refresh()
        self.template_sidebar.refresh()
        self.timer_bar.refresh_activities()

    def _create_project_inline(self, name: str) -> Project:
        """Used by the Add QDM tab's "+ New Project..." option (see
        ActivityPanel.create_project in app/panels.py) to create a Project
        without leaving that tab -- unlike the dedicated Add Project tab,
        this doesn't ask for a color; one is auto-picked (see
        Database.add_project_with_default_color)."""
        project = self.db.add_project_with_default_color(name)
        self._on_sidebar_change()
        return project

    # ------------------------------------------------------------------
    # Keyboard shortcuts: undo/redo (app-wide) + giving the calendar focus
    # whenever its tab becomes visible (so arrow keys/Delete/Escape --
    # bound directly on the canvas, see CalendarGrid._build_widgets -- work
    # right away without an extra click first).
    # ------------------------------------------------------------------
    def _active_calendar(self):
        """The CalendarGrid for whichever of Timesheet/Template is the
        currently-selected notebook tab, or None while some other tab (a
        panel like Settings/Project/Time Block, or the window isn't fully
        built yet) is showing. Undo/redo only ever acts on a calendar
        that's actually visible."""
        if not hasattr(self, "notebook"):
            return None
        try:
            current = self.notebook.select()
        except tk.TclError:
            return None
        if not current:
            return None
        if hasattr(self, "timesheet_tab") and current == str(self.timesheet_tab):
            return self.calendar
        if hasattr(self, "template_tab") and current == str(self.template_tab):
            return self.template_calendar
        return None

    def _on_tab_changed(self, event=None):
        self._refresh_tab_bar()
        cal = self._active_calendar()
        if cal is not None:
            cal.canvas.focus_set()
        # The Summary tab doesn't live-update while entries change on the
        # other tabs, so refresh its totals every time it becomes visible.
        # (Unlike Timesheet/Template, summary_panel itself IS the tab
        # widget -- there's no separate container Frame to compare against.)
        if hasattr(self, "summary_panel"):
            try:
                current = self.notebook.select()
            except tk.TclError:
                current = None
            if current and current == str(self.summary_panel):
                self.summary_panel.refresh()

    @staticmethod
    def _is_typing_target(widget) -> bool:
        """True while the keyboard focus is on a widget that expects to
        consume Ctrl+Z/Ctrl+Shift+Z itself for normal text editing (even
        though none of our Entry/Combobox/Text widgets actually bind
        anything to those keys today, a text field silently swallowing
        undo/redo instead of the calendar acting on it would be a worse
        surprise than this shortcut occasionally doing nothing)."""
        return isinstance(widget, (tk.Entry, tk.Text, ttk.Entry, ttk.Combobox, ttk.Spinbox))

    def _on_undo_shortcut(self, event=None):
        if self._is_typing_target(self.focus_get()):
            return
        cal = self._active_calendar()
        if cal is not None:
            cal.undo()

    def _on_redo_shortcut(self, event=None):
        if self._is_typing_target(self.focus_get()):
            return
        cal = self._active_calendar()
        if cal is not None:
            cal.redo()

    def _bind_global_shortcuts(self):
        """Ctrl+Z / Ctrl+Shift+Z (and Ctrl+Y) undo/redo the last calendar
        edit -- create, move, resize, delete, or duplicate -- on whichever
        of the Timesheet/Template tabs is currently visible (see
        _active_calendar). Bound once, here, rather than re-bound on every
        theme change: `self.bind_all` registers on Tk's global "all"
        bindtag, which outlives the plain tk widgets that
        _apply_theme_and_rebuild destroys and recreates, and
        _on_undo_shortcut/_on_redo_shortcut look up self.calendar/
        self.template_calendar fresh each time rather than closing over
        them, so this keeps working across rebuilds without re-binding.

        Left/Right/Up/Down and Delete/Backspace are deliberately NOT bound
        here -- see CalendarGrid._build_widgets, which binds them directly
        on each canvas instead, precisely so they never fight with a
        Notebook tab strip's own arrow-key tab-switching or with normal
        text editing in an Entry/Combobox/Text field elsewhere in the app.
        Ctrl+Z doesn't have that conflict (nothing else in this app binds
        it), so a single app-wide binding is simpler and just as safe."""
        self.bind_all("<Control-z>", self._on_undo_shortcut, add="+")
        self.bind_all("<Control-Z>", self._on_undo_shortcut, add="+")
        self.bind_all("<Control-y>", self._on_redo_shortcut, add="+")
        self.bind_all("<Control-Y>", self._on_redo_shortcut, add="+")
        self.bind_all("<Control-Shift-Z>", self._on_redo_shortcut, add="+")
        if sys.platform == "darwin":
            # macOS Tk supports a "Command" modifier the same way other
            # platforms support "Control" -- bind both so the shortcut
            # works with whichever key a Mac user reaches for. Guarded with
            # try/except (rather than an outright platform check alone)
            # since exactly how forgiving a given Tk build is about
            # modifier names it doesn't recognize isn't worth relying on.
            for sequence, handler in (
                ("<Command-z>", self._on_undo_shortcut), ("<Command-Z>", self._on_undo_shortcut),
                ("<Command-Shift-Z>", self._on_redo_shortcut), ("<Command-y>", self._on_redo_shortcut),
            ):
                try:
                    self.bind_all(sequence, handler, add="+")
                except tk.TclError:
                    pass

    # ------------------------------------------------------------------
    # Tab panels (replace what used to be pop-up dialogs -- see _build_body)
    # ------------------------------------------------------------------
    def _register_panel(self, widget, tab_text):
        self.notebook.add(widget, text=tab_text)
        self.notebook.tab(widget, state="hidden")
        self._panels.append(widget)
        self._all_tabs.append((widget, tab_text))

    def _refresh_tab_bar(self):
        """Rebuild the hand-drawn tab strip (see _build_body) from
        self._all_tabs + the notebook's own current state -- one button
        per tab currently in "normal" state (every permanent tab, plus
        whichever single transient panel _show_panel most recently made
        visible, if any), styled Accent for whichever one is selected and
        Secondary for the rest -- the exact same selected/unselected style
        convention SummaryPanel already uses for its Week/Month toggle."""
        try:
            selected = self.notebook.select()
        except tk.TclError:
            selected = None
        for child in self.tab_bar.winfo_children():
            child.destroy()
        for widget, tab_text in self._all_tabs:
            try:
                state = self.notebook.tab(widget, option="state")
            except tk.TclError:
                continue
            if state == "hidden":
                continue
            is_selected = selected is not None and selected == str(widget)
            RoundedButton(
                self.tab_bar, text=tab_text,
                style="Accent.TButton" if is_selected else "Secondary.TButton",
                command=lambda w=widget: self.notebook.select(w),
            ).pack(side="left", padx=(0, 6))

    def _show_panel(self, widget):
        # Only one extra tab is ever shown at a time, alongside "Timesheet".
        for other in self._panels:
            if other is not widget:
                self.notebook.tab(other, state="hidden")
        self.notebook.tab(widget, state="normal")
        self.notebook.select(widget)

    def _hide_panel(self, widget):
        self.notebook.tab(widget, state="hidden")
        self.notebook.select(0)

    def _open_time_block_panel(self, **kwargs):
        kwargs["known_jira_projects"] = self.db.list_known_jira_projects()
        self.timeblock_panel.load(**kwargs)
        self._show_panel(self.timeblock_panel)

    def _open_duplicate_panel(self, **kwargs):
        self.duplicate_panel.load(**kwargs)
        self._show_panel(self.duplicate_panel)

    def _open_activity_panel(self, activity, on_save, on_delete=None):
        self.activity_panel.load(activity, on_save, on_delete)
        self._show_panel(self.activity_panel)

    def _open_project_panel(self, project, on_save, on_delete=None):
        self.project_panel.load(project, on_save, on_delete)
        self._show_panel(self.project_panel)

    # ------------------------------------------------------------------
    # Theme (see app/theme.py's THEMES for the twenty curated choices, plus
    # the "custom" id built live from the user's own picked colors)
    # ------------------------------------------------------------------
    def _select_theme(self, theme_id: str):
        """Persist and apply a theme chosen from the Settings picker (see
        panels.SettingsPanel). Safe to call even when `theme_id` is the
        theme that's already active -- the rebuild is a little wasted work
        in that case, but simpler and safer than trying to special-case a
        no-op, and it's on the Settings-Save path anyway, not called on
        every keystroke."""
        self.db.set_setting("theme_mode", theme_id)
        self._apply_theme_and_rebuild(theme_id)

    def _apply_theme_and_rebuild(self, theme_id: str):
        theme.set_theme(theme_id)
        self.family = theme.apply_theme(self)
        self.configure(bg=theme.APP_BG)

        # Plain tk widgets (Frame/Label/Canvas/Menu, as opposed to ttk ones)
        # cache their colors at construction time and won't pick up the new
        # palette on their own -- rebuild them from scratch. ttk widgets
        # (buttons, entries, comboboxes...) already re-rendered the instant
        # apply_theme() re-configured their styles above.
        week_start = self.calendar.week_start if hasattr(self, "calendar") else None
        # A running timer would otherwise be silently lost here -- capture
        # its state (see TimerBar.get_state) before the old TimerBar is
        # destroyed below, and hand it to the new one so counting continues
        # uninterrupted right through the toggle.
        timer_state = self.timer_bar.get_state() if hasattr(self, "timer_bar") else None
        for child in list(self.winfo_children()):
            child.destroy()

        self._build_menu()
        self._build_header()
        self._build_timer_bar(initial_timer_state=timer_state)
        self._build_body(initial_week_start=week_start)

    # ------------------------------------------------------------------
    def _load_settings_panel(self):
        """(Re)populate the Settings tab from the db's current values. Used
        to be called only from _open_settings_dialog, right before that
        opened the tab (back when Settings was a hide-until-opened panel
        like Time Block/Duplicate/etc.) -- now that it's a permanent tab
        built once in _build_body, this runs once at build time instead,
        and again from _open_settings_dialog below just to stay safe if
        anything reaches that path."""
        display_name = self.db.get_setting("jira_display_name", "") or ""
        current_theme_id = theme.get_theme_id()
        current_work_start_hour = config.START_HOUR
        current_work_end_hour = config.END_HOUR
        current_show_weekends = config.SHOW_WEEKENDS
        current_jira_site_url = self.db.get_setting("jira_site_url", "") or ""
        current_jira_email = self.db.get_setting("jira_email", "") or ""

        def on_save(new_display_name, new_theme_id,
                    new_work_start_hour, new_work_end_hour, new_show_weekends,
                    new_jira_site_url, new_jira_email, new_jira_api_token):
            self.db.set_setting("jira_display_name", new_display_name)
            self.db.set_setting("work_start_hour", str(new_work_start_hour))
            self.db.set_setting("work_end_hour", str(new_work_end_hour))
            self.db.set_setting("show_weekends", "1" if new_show_weekends else "0")
            self.db.set_setting("jira_site_url", new_jira_site_url)
            self.db.set_setting("jira_email", new_jira_email)
            # A blank API Token field means "leave whatever's already in
            # the keychain alone" (see SettingsPanel's own comment on that
            # field) -- only a non-blank entry ever touches the stored
            # token, so re-saving the rest of Settings never accidentally
            # wipes it.
            if new_jira_api_token:
                try:
                    jira_client.store_api_token(new_jira_api_token)
                except jira_client.KeyringUnavailable as exc:
                    messagebox.showwarning(
                        "Couldn't reach your OS keychain",
                        "Everything else in Settings was saved, but the Jira API token "
                        "could not be stored:\n\n" + str(exc) +
                        "\n\nSee requirements.txt for what your OS needs for a keychain "
                        "backend to be available, then try entering the token again.")

            # Always persist the Custom palette's current seed colors,
            # whether or not "custom" is the theme actually being saved --
            # SettingsPanel keeps theme.get_custom_seeds() in sync with
            # whatever the user last picked in the Custom color row, so
            # this just makes sure it's remembered next time, even if they
            # ended up saving a different preset instead.
            custom_seeds = theme.get_custom_seeds()
            self.db.set_setting("custom_theme_app_bg", custom_seeds["app_bg"])
            self.db.set_setting("custom_theme_panel_bg", custom_seeds["panel_bg"])
            self.db.set_setting("custom_theme_text", custom_seeds["text_primary"])
            self.db.set_setting("custom_theme_accent", custom_seeds["accent"])

            hours_changed = (new_work_start_hour != current_work_start_hour
                              or new_work_end_hour != current_work_end_hour
                              or new_show_weekends != current_show_weekends)
            if hours_changed:
                config.set_work_hours(new_work_start_hour, new_work_end_hour)
                config.set_show_weekends(new_show_weekends)

            # A theme change and a work-hours/weekend change both need the
            # same full destroy-and-rebuild (_select_theme already
            # triggers one for its own reason: plain tk widgets cache
            # their colors at construction time). The calendar's visible-
            # hours grid height and day count are baked into its widgets
            # at construction exactly the same way, so reuse the same
            # path here rather than a second, separate rebuild routine.
            # Deferred via after(0, ...) since this callback runs from the
            # very Settings tab the rebuild is about to destroy.
            if new_theme_id != current_theme_id or hours_changed:
                self.after(0, lambda: self._select_theme(new_theme_id))

        self.settings_panel.load(display_name, current_theme_id, current_work_start_hour,
                                  current_work_end_hour, current_show_weekends,
                                  current_jira_site_url, current_jira_email, on_save)

    def _open_settings_dialog(self):
        # Settings is a permanent tab now (see _build_body) -- this just
        # jumps the notebook to it, still wired up from the Settings/View
        # menu's "Jira Export Settings…"/"Theme…" entries now that the
        # header button that used to call this is gone.
        self._load_settings_panel()
        self.notebook.select(self.settings_panel)

    def _open_backup_dialog(self):
        self._show_panel(self.backup_panel)

    def _backup_data(self, path: str):
        try:
            self.db.backup_to(path)
        except Exception as exc:
            messagebox.showwarning("Backup Failed", f"Could not write the backup file:\n\n{exc}")
            return
        messagebox.showinfo("Backup Complete", f"Your data was backed up to:\n\n{path}")

    def _restore_data(self, path: str):
        if self.timer_bar.is_running():
            messagebox.showwarning(
                "Timer Running",
                "Stop the running timer first, so its time isn't lost, then try "
                "restoring again.")
            return
        try:
            self.db.restore_from(path)
        except Exception as exc:
            messagebox.showwarning("Restore Failed", f"Could not restore from that file:\n\n{exc}")
            return
        # Restoring can change literally everything the UI shows -- every
        # project/activity/time block/template entry, plus every setting
        # (display name, defaults, and the theme itself) -- so the safest
        # way to reflect it is the same full destroy-and-rebuild
        # _select_theme() already uses for a theme change. Deferred via
        # after(0, ...) for the same reason as that theme-change path: this
        # callback was invoked from the very Settings tab the rebuild is
        # about to destroy, so let the current event finish first.
        self.after(0, self._finish_restore)

    def _finish_restore(self):
        restored_theme_id = self.db.get_setting("theme_mode", theme.DEFAULT_THEME_ID) or theme.DEFAULT_THEME_ID
        self._apply_theme_and_rebuild(restored_theme_id)
        messagebox.showinfo("Restore Complete", "Your data has been restored.")

    def _open_export_dialog(self):
        def on_export(start_date, end_date):
            self._do_export(start_date, end_date)

        self.export_panel.load(self.calendar.week_start, on_export)
        self._show_panel(self.export_panel)

    def _do_export(self, start_date: str, end_date: str):
        entries = self.db.list_time_entries_between(start_date, end_date)
        if not entries:
            messagebox.showinfo("Nothing to export", "There are no time blocks in that date range.")
            return

        default_name = f"jira_worklog_{start_date}_to_{end_date}.csv"
        from tkinter import filedialog
        filepath = filedialog.asksaveasfilename(
            title="Save Jira CSV export",
            initialfile=default_name,
            defaultextension=".csv",
            filetypes=[("CSV files", "*.csv"), ("All files", "*.*")],
        )
        if not filepath:
            return

        display_name = self.db.get_setting("jira_display_name", "") or ""
        if not display_name:
            proceed = messagebox.askyesno(
                "No Display Name set",
                "You haven't set a Display Name in Settings → Jira Export Settings.\n"
                "Exported rows will have a blank Display Name. Continue anyway?",
            )
            if not proceed:
                return

        written, skipped = export_entries(entries, filepath, display_name)

        msg = f"Exported {written} worklog row(s) to:\n{filepath}"
        if skipped:
            msg += (f"\n\n{len(skipped)} time block(s) were skipped because they have no "
                    f"Jira Issue Key assigned:\n" +
                    "\n".join(f"  • {e.activity_name} ({e.date} {e.start_time}-{e.end_time})"
                              for e in skipped[:10]))
            if len(skipped) > 10:
                msg += f"\n  …and {len(skipped) - 10} more."
        messagebox.showinfo("Export complete", msg)

    def _open_jira_upload_dialog(self):
        def on_upload(start_date, end_date):
            self._do_jira_upload(start_date, end_date)

        self.jira_upload_panel.load(self.calendar.week_start, on_upload)
        self._show_panel(self.jira_upload_panel)

    def _do_jira_upload(self, start_date: str, end_date: str):
        site_url = self.db.get_setting("jira_site_url", "") or ""
        email = self.db.get_setting("jira_email", "") or ""
        api_token = jira_client.get_api_token() or ""
        if not (site_url and email and api_token):
            messagebox.showwarning(
                "Jira Cloud not set up",
                "Enter your Jira Site URL, Email, and API Token in Settings → Jira Cloud "
                "Upload before using this button. \u201cExport to Jira CSV\u201d doesn't "
                "need any of this and still works without it.")
            return

        entries = self.db.list_time_entries_between(start_date, end_date)
        has_key = [e for e in entries if e.jira_key and e.jira_key.strip()]
        no_key = [e for e in entries if not (e.jira_key and e.jira_key.strip())]
        # Duplicate protection: only ever send entries that haven't been
        # uploaded before (see TimeEntry.jira_uploaded_at's docstring) --
        # this is what makes re-running this button on the same date range
        # safe instead of creating a second worklog for something Jira
        # already has.
        already_uploaded = [e for e in has_key if e.jira_uploaded_at]
        pending = [e for e in has_key if not e.jira_uploaded_at]

        if not pending:
            messagebox.showinfo(
                "Nothing new to upload",
                f"Every time block with a Jira Issue Key in that range ({len(already_uploaded)}) "
                "has already been uploaded to Jira. Nothing to send.")
            return

        confirm_msg = f"Upload {len(pending)} worklog(s) to Jira?"
        if already_uploaded:
            confirm_msg += f"\n\n{len(already_uploaded)} already-uploaded entry(ies) will be skipped."
        if no_key:
            confirm_msg += f"\n{len(no_key)} entry(ies) have no Jira Issue Key and will be skipped."
        if not messagebox.askyesno("Confirm upload", confirm_msg):
            return

        credentials = jira_client.JiraCredentials(site_url=site_url, email=email, api_token=api_token)
        try:
            results = jira_client.upload_entries(credentials, pending)
        except RuntimeError as exc:
            messagebox.showerror("Upload failed", str(exc))
            return

        succeeded = [r.entry for r in results if r.success]
        failed = [r for r in results if not r.success]
        if succeeded:
            self.db.mark_time_entries_jira_uploaded([e.id for e in succeeded if e.id is not None])

        msg = f"Uploaded {len(succeeded)} of {len(pending)} worklog(s) to Jira."
        if already_uploaded:
            msg += f"\n{len(already_uploaded)} already-uploaded entry(ies) were skipped."
        if no_key:
            msg += f"\n{len(no_key)} entry(ies) with no Jira Issue Key were skipped."
        if failed:
            msg += (f"\n\n{len(failed)} failed:\n" +
                    "\n".join(f"  \u2022 {r.entry.activity_name} ({r.entry.date} "
                               f"{r.entry.start_time}-{r.entry.end_time}, {r.entry.jira_key}): {r.error}"
                               for r in failed[:10]))
            if len(failed) > 10:
                msg += f"\n  \u2026and {len(failed) - 10} more."
            messagebox.showwarning("Upload complete, with errors", msg)
        else:
            messagebox.showinfo("Upload complete", msg)

    def _show_help(self):
        messagebox.showinfo(
            "How to use",
            "• Timer (top of the window): pick an activity and click Start "
            "Timer. Click Stop Timer when you're done and it logs a time "
            "block for today automatically, rounded to the nearest 15 "
            "minutes.\n"
            "• Drag on an empty part of the grid to create a time block.\n"
            "• Drag a block's top/bottom edge to resize it.\n"
            "• Drag the middle of a block to move it (even to another day).\n"
            "• Right-click a block to edit, duplicate, or delete it.\n"
            "• Ctrl+click a block to instantly duplicate it into the same slot.\n"
            "• Overlapping blocks are allowed -- they're shown side by side "
            "instead of one hiding the other.\n"
            "• Click an activity in the sidebar to \"arm\" it, then click an "
            "empty slot to instantly place it (Esc cancels).\n"
            "• Double-click or right-click an activity to edit/delete it.\n"
            "• \"+ Project\" groups activities into a collapsible project, "
            "which sets the color every one of its activities' time blocks "
            "shows -- click the arrow to collapse/expand, or right-click a "
            "project to edit/delete it.\n"
            "• File → Export to Jira CSV… to generate a worklog CSV for Jira's "
            "CSV importer. Only blocks with a Jira Issue Key are exported.\n\n"
            "Keyboard shortcuts (click the calendar first so it has focus):\n"
            "• Click a block (without dragging) to select it -- it gets a "
            "highlighted outline.\n"
            "• Delete or Backspace: remove the selected block (same confirmation "
            "as the right-click menu's Delete).\n"
            "• Left/Right arrow: with a block selected, move it to the previous/"
            "next day; with nothing selected, go to the previous/next week.\n"
            "• Up/Down arrow: move the selected block's time a slot earlier/"
            "later.\n"
            "• Esc: cancel a drag in progress, un-arm an activity, or deselect "
            "the selected block.\n"
            "• Ctrl+Z (Cmd+Z on Mac): undo the last create/move/resize/delete/"
            "duplicate. Ctrl+Shift+Z or Ctrl+Y (Cmd+Shift+Z on Mac): redo.",
        )

    def _on_close(self):
        if self.timer_bar.is_running():
            answer = messagebox.askyesnocancel(
                "Timer is still running",
                "The timer is still running.\n\n"
                "Yes = stop it and log the time so far, then close\n"
                "No = close without logging it (the time is discarded)\n"
                "Cancel = don't close, go back to the timer",
            )
            if answer is None:
                return
            if answer:
                self.timer_bar.stop()
        self.db.close()
        self.destroy()
