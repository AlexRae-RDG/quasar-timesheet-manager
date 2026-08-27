"""
Embedded (non-popup) panels: Duplicate, Add/Edit Activity, Add/Edit Project,
Settings, Export.

These used to be separate pop-up windows (tk.Toplevel dialogs). Like the
time-block editor (see app/timeblock_panel.py), they're now tabs that show
up next to "Timesheet" in the main window's tab bar only while in use, and
hide again afterwards -- this sidesteps macOS/Tk setups where pop-up
windows can ignore explicit on-screen positioning and open off in a corner
no matter what the app asks for, since there's no separate window to
mis-position in the first place.

The one exception is the OS's native color picker (colorchooser.askcolor,
used from ProjectPanel) -- that's the operating system's own dialog, not
one of ours, positioned by the OS the same way a file-open dialog is, so it
isn't affected by the pop-up-window bug this refactor works around.
"""
import tkinter as tk
from datetime import date, datetime, timedelta
from tkinter import colorchooser, filedialog, messagebox, ttk
from typing import Callable, Dict, List, Optional, Union

from . import config, theme
from .models import Activity, Project, TemplateEntry, TimeEntry
from .widgets import RoundedButton, ScrollArea

EntryLike = Union[TimeEntry, TemplateEntry]

# Shown read-only under Settings -> Keyboard Shortcuts (see SettingsPanel
# below). Kept as one list here rather than scattered across whichever
# file actually binds each one, so this stays the single place to update
# if a shortcut is ever added, changed, or removed -- see
# main_window.py._bind_global_shortcuts (undo/redo) and
# calendar_view.py._build_widgets (everything else) for where they're
# actually wired up.
_SHORTCUTS = [
    ("Ctrl+Z  (or Cmd+Z on Mac)", "Undo the last calendar change"),
    ("Ctrl+Y or Ctrl+Shift+Z  (or Cmd+Shift+Z / Cmd+Y on Mac)", "Redo"),
    ("Left / Right arrow", "Move the selected block a day earlier/later -- or, "
                            "with nothing selected, go to the previous/next week"),
    ("Up / Down arrow", "Move the selected block earlier/later by one time slot"),
    ("Delete or Backspace", "Delete the selected block"),
    ("Esc", "Cancel a drag in progress, un-arm a queued activity, or deselect a block"),
    ("Ctrl+Click a block", "Instantly duplicate it into its own exact time slot "
                            "(drag the copy afterward to retime it)"),
]


def _scroll_body(master, **kwargs) -> tk.Frame:
    """Every embedded panel's content goes inside one of these instead of
    packing straight into the panel Frame -- a plain ScrollArea with no
    visible border (outline=False) and no inset (pad=0), so nothing looks
    different from before, but content that doesn't fit the window (a lot
    of fields stacked up, or the Settings tab's theme previews) can
    still be scrolled to and its Save/Cancel/Delete buttons are never
    stranded off the bottom of an un-maximized window."""
    kwargs.setdefault("bg", theme.PANEL_BG)
    kwargs.setdefault("outline", False)
    kwargs.setdefault("pad", 0)
    area = ScrollArea(master, **kwargs)
    area.pack(fill="both", expand=True)
    # Stashed so _rebind_wheel (below) can find the owning ScrollArea from
    # any descendant widget without every panel needing to keep its own
    # reference around.
    area.content._scroll_area = area  # type: ignore[attr-defined]
    return area.content


def _rebind_wheel(widget):
    """Call after destroying and recreating a widget's children inside a
    panel built on _scroll_body (a Save/Cancel/Delete button row, a
    checkbox list, etc). ScrollArea normally re-attaches its direct mouse-
    wheel binding (see ScrollArea.bind_wheel_recursive in app/widgets.py)
    to newly-added widgets automatically, the next time its `.content`
    frame's own size changes -- but re-opening one of these panels for a
    different record often rebuilds an identically-sized row (the same
    Save/Cancel/Delete buttons every time), which never fires that resize,
    so the freshly-created widgets would otherwise be missed. This walks up
    to the owning ScrollArea and re-binds `widget` and its children
    explicitly instead of depending on a resize happening at all."""
    w = widget
    while w is not None:
        area = getattr(w, "_scroll_area", None)
        if area is not None:
            area.bind_wheel_recursive(widget)
            return
        w = getattr(w, "master", None)


# ---------------------------------------------------------------------------
# Duplicate panel -- copy a time block to other weekdays
# ---------------------------------------------------------------------------
class DuplicatePanel(tk.Frame):
    def __init__(self, master, family: str, on_close: Callable[[], None]):
        super().__init__(master, bg=theme.PANEL_BG)
        self.family = family
        self.on_close = on_close
        self.on_duplicate: Optional[Callable[[List[int]], None]] = None
        self.day_vars = {}

        body = _scroll_body(self)
        outer = tk.Frame(body, bg=theme.PANEL_BG)
        outer.pack(fill="both", expand=True, padx=28, pady=24)

        tk.Label(outer, text="Duplicate Time Block", font=(self.family, 14, "bold"),
                 bg=theme.PANEL_BG, fg=theme.TEXT_PRIMARY).pack(anchor="w", pady=(0, 6))

        self.subheading = tk.Label(outer, text="", font=(self.family, 10), justify="left",
                                    wraplength=380, bg=theme.PANEL_BG, fg=theme.TEXT_SECONDARY)
        self.subheading.pack(anchor="w", pady=(0, 14))

        self.days_frame = ttk.Frame(outer)
        self.days_frame.pack(anchor="w")

        quick_row = ttk.Frame(outer)
        quick_row.pack(anchor="w", pady=(10, 12))
        RoundedButton(quick_row, text="Select all", style="Secondary.TButton",
                      command=self._select_all).pack(side="left")
        RoundedButton(quick_row, text="Clear", style="Secondary.TButton",
                      command=self._clear_all).pack(side="left", padx=6)

        self.error_label = ttk.Label(outer, text="", foreground=theme.DANGER)
        self.error_label.pack(anchor="w")

        self.btns = ttk.Frame(outer)
        self.btns.pack(anchor="w", fill="x", pady=(16, 0))

    def load(self, source_entry: EntryLike, day_options, source_day_idx: int,
              on_duplicate: Callable[[List[int]], None]):
        self.on_duplicate = on_duplicate
        self.subheading.config(
            text=f"Duplicate “{source_entry.activity_name}” "
                 f"({source_entry.start_time}–{source_entry.end_time}) to:")

        for child in self.days_frame.winfo_children():
            child.destroy()
        self.day_vars = {}
        for label, day_idx in day_options:
            if day_idx == source_day_idx:
                continue  # the source day already has this block
            var = tk.BooleanVar(value=False)
            self.day_vars[day_idx] = var
            ttk.Checkbutton(self.days_frame, text=label, variable=var).pack(anchor="w", pady=2)
        _rebind_wheel(self.days_frame)

        self.error_label.config(text="")
        for child in self.btns.winfo_children():
            child.destroy()
        RoundedButton(self.btns, text="Cancel", style="Secondary.TButton",
                      command=self._cancel).pack(side="right")
        RoundedButton(self.btns, text="Duplicate", style="Accent.TButton",
                      command=self._duplicate).pack(side="right", padx=6)
        _rebind_wheel(self.btns)

    def _select_all(self):
        for var in self.day_vars.values():
            var.set(True)

    def _clear_all(self):
        for var in self.day_vars.values():
            var.set(False)

    def _duplicate(self):
        selected = [day_idx for day_idx, var in self.day_vars.items() if var.get()]
        if not selected:
            self.error_label.config(text="Pick at least one day.")
            return
        cb = self.on_duplicate
        self.on_close()
        assert cb is not None
        cb(selected)

    def _cancel(self):
        self.on_close()


# ---------------------------------------------------------------------------
# Activity add/edit panel (the loggable, draggable-onto-the-calendar leaf item)
# ---------------------------------------------------------------------------
class ActivityPanel(tk.Frame):
    def __init__(self, master, family: str, on_close: Callable[[], None],
                 get_projects: Callable[[], List[Project]]):
        super().__init__(master, bg=theme.PANEL_BG)
        self.family = family
        self.on_close = on_close
        self.get_projects = get_projects
        self.on_save: Optional[Callable[[dict], bool]] = None
        self.on_delete: Optional[Callable[[], None]] = None
        self.project_id_by_label: Dict[str, Optional[int]] = {}

        body = _scroll_body(self)
        outer = tk.Frame(body, bg=theme.PANEL_BG)
        outer.pack(fill="both", expand=True, padx=28, pady=24)

        self.heading = tk.Label(outer, text="Add Activity", font=(self.family, 14, "bold"),
                                 bg=theme.PANEL_BG, fg=theme.TEXT_PRIMARY)
        self.heading.pack(anchor="w", pady=(0, 16))

        frm = ttk.Frame(outer)
        frm.pack(anchor="w")

        row = 0
        ttk.Label(frm, text="Name *").grid(row=row, column=0, sticky="w", pady=4)
        self.name_var = tk.StringVar()
        ttk.Entry(frm, textvariable=self.name_var, width=32).grid(row=row, column=1, sticky="ew", pady=4)
        row += 1

        ttk.Label(frm, text="Jira Issue Key").grid(row=row, column=0, sticky="w", pady=4)
        self.jira_var = tk.StringVar()
        ttk.Entry(frm, textvariable=self.jira_var, width=32).grid(row=row, column=1, sticky="ew", pady=4)
        row += 1

        ttk.Label(frm, text="Project *").grid(row=row, column=0, sticky="w", pady=4)
        self.project_var = tk.StringVar()
        self.project_combo = ttk.Combobox(frm, textvariable=self.project_var,
                                           state="readonly", width=30)
        self.project_combo.grid(row=row, column=1, sticky="ew", pady=4)
        row += 1

        # Every Activity belongs to exactly one Project -- there's no
        # "(No project)" option -- since a time block's color always comes
        # from its Activity's Project rather than being set here.
        tk.Label(frm, text="Color comes from the Project this activity belongs to -- set it "
                            "from the Project's own edit panel.",
                 fg=theme.TEXT_MUTED, bg=theme.PANEL_BG, justify="left", wraplength=340,
                 font=(self.family, 8)).grid(row=row, column=0, columnspan=2, sticky="w", pady=(0, 8))
        row += 1

        # Jira Project and Issue Type are deliberately NOT editable
        # per-activity here -- for most people every activity exports under
        # the same Jira project and issue type, so those two live in one
        # place (Settings -> Jira Export Settings) instead of being
        # repeated on every activity. Export still fills them in from there
        # automatically (see app/export_csv.py's build_row) -- a time block
        # can still override either one individually if it ever needs to
        # differ, via its own Time Block tab.

        ttk.Label(frm, text="Default Duration (min)").grid(row=row, column=0, sticky="w", pady=4)
        self.duration_var = tk.StringVar()
        ttk.Entry(frm, textvariable=self.duration_var, width=10).grid(row=row, column=1, sticky="w", pady=4)
        row += 1

        self.error_label = ttk.Label(frm, text="", foreground=theme.DANGER)
        self.error_label.grid(row=row, column=0, columnspan=2, sticky="w")
        row += 1

        self.btns = ttk.Frame(frm)
        self.btns.grid(row=row, column=0, columnspan=2, sticky="ew", pady=(16, 0))

    def load(self, activity: Optional[Activity], on_save: Callable[[dict], bool],
              on_delete: Optional[Callable[[], None]] = None):
        self.on_save = on_save
        self.on_delete = on_delete
        self.heading.config(text="Edit Activity" if activity else "Add Activity")

        projects = self.get_projects()
        labels = [p.name for p in projects]
        self.project_id_by_label = {p.name: p.id for p in projects}
        self.project_combo.config(values=labels)
        current_project_id = activity.project_id if activity else (projects[0].id if projects else None)
        current_label = next((p.name for p in projects if p.id == current_project_id),
                              (labels[0] if labels else ""))
        self.project_var.set(current_label)
        self.project_combo.set(current_label)

        self.name_var.set(activity.name if activity else "")
        self.jira_var.set((activity.jira_key or "") if activity else "")
        self.duration_var.set(
            str(activity.default_duration_minutes) if activity and activity.default_duration_minutes else "")
        self.error_label.config(text="")

        for child in self.btns.winfo_children():
            child.destroy()
        if on_delete:
            RoundedButton(self.btns, text="Delete", style="Danger.TButton",
                          command=self._delete).pack(side="left")
        RoundedButton(self.btns, text="Cancel", style="Secondary.TButton",
                      command=self._cancel).pack(side="right")
        RoundedButton(self.btns, text="Save", style="Accent.TButton",
                      command=self._save).pack(side="right", padx=6)
        _rebind_wheel(self.btns)

    def _save(self):
        name = self.name_var.get().strip()
        if not name:
            self.error_label.config(text="Name is required.")
            return
        duration = None
        raw_dur = self.duration_var.get().strip()
        if raw_dur:
            try:
                duration = int(raw_dur)
                if duration <= 0:
                    raise ValueError
            except ValueError:
                self.error_label.config(text="Default duration must be a positive whole number of minutes.")
                return

        project_id = self.project_id_by_label.get(self.project_var.get())
        if project_id is None:
            self.error_label.config(text="Choose a project.")
            return

        result = {
            "name": name,
            "jira_key": self.jira_var.get().strip() or None,
            "default_duration_minutes": duration,
            "project_id": project_id,
            # No longer editable per-activity (see the comment near the
            # fields above) -- Jira Project/Issue Type come from Settings'
            # Default Jira Project/Default Issue Type at export time instead.
            "jira_project": None,
            "issue_type": None,
        }
        assert self.on_save is not None
        ok = self.on_save(result)
        if ok is not False:
            self.on_close()

    def _cancel(self):
        self.on_close()

    def _delete(self):
        cb = self.on_delete
        self.on_close()
        if cb:
            cb()


# ---------------------------------------------------------------------------
# Project add/edit panel (collapsible groups in the sidebar; owns color)
# ---------------------------------------------------------------------------
class ProjectPanel(tk.Frame):
    def __init__(self, master, family: str, on_close: Callable[[], None]):
        super().__init__(master, bg=theme.PANEL_BG)
        self.family = family
        self.on_close = on_close
        self.on_save: Optional[Callable[[dict], bool]] = None
        self.on_delete: Optional[Callable[[], None]] = None
        self.selected_color = tk.StringVar(value=config.DEFAULT_PROJECT_COLORS[0])

        body = _scroll_body(self)
        outer = tk.Frame(body, bg=theme.PANEL_BG)
        outer.pack(fill="both", expand=True, padx=28, pady=24)

        self.heading = tk.Label(outer, text="Add Project", font=(self.family, 14, "bold"),
                                 bg=theme.PANEL_BG, fg=theme.TEXT_PRIMARY)
        self.heading.pack(anchor="w", pady=(0, 16))

        self.subheading = tk.Label(
            outer, text="Projects group your activities in the sidebar and set the color "
                        "every one of their time blocks shows.",
            font=(self.family, 9), justify="left", wraplength=340,
            bg=theme.PANEL_BG, fg=theme.TEXT_SECONDARY)
        self.subheading.pack(anchor="w", pady=(0, 14))

        frm = ttk.Frame(outer)
        frm.pack(anchor="w")

        row = 0
        ttk.Label(frm, text="Name *").grid(row=row, column=0, sticky="w", pady=4)
        self.name_var = tk.StringVar()
        entry = ttk.Entry(frm, textvariable=self.name_var, width=32)
        entry.grid(row=row, column=1, sticky="ew", pady=4)
        entry.bind("<Return>", lambda e: self._save())
        row += 1

        ttk.Label(frm, text="Color").grid(row=row, column=0, sticky="w", pady=4)
        color_frame = ttk.Frame(frm)
        color_frame.grid(row=row, column=1, sticky="w", pady=4)
        self.swatch = tk.Canvas(color_frame, width=26, height=26, highlightthickness=1,
                                 highlightbackground=theme.BORDER_STRONG, bg=theme.PANEL_BG)
        self.swatch.pack(side="left", padx=(0, 8))
        self._draw_swatch()
        RoundedButton(color_frame, text="Choose…", style="Secondary.TButton",
                      command=self._pick_color).pack(side="left")
        row += 1

        palette = ttk.Frame(frm)
        palette.grid(row=row, column=0, columnspan=2, sticky="w", pady=(2, 8))
        for c in config.DEFAULT_PROJECT_COLORS:
            sw = tk.Canvas(palette, width=20, height=20, bg=c, highlightthickness=1,
                            highlightbackground=theme.BORDER_STRONG, cursor="hand2")
            sw.pack(side="left", padx=2)
            sw.bind("<Button-1>", lambda e, col=c: self._set_color(col))
        row += 1

        # This project's color is the ONLY place a color gets set -- every
        # time block for every activity in this project just inherits it
        # (and stays in sync if it's changed here later, see
        # Sidebar._edit_project -> db.update_project), rather than each
        # activity or block having its own color.
        tk.Label(frm, text="This color is used for every time block for every activity in this project.",
                 fg=theme.TEXT_MUTED, bg=theme.PANEL_BG, justify="left", wraplength=340,
                 font=(self.family, 8)).grid(row=row, column=0, columnspan=2, sticky="w", pady=(0, 8))
        row += 1

        self.error_label = ttk.Label(frm, text="", foreground=theme.DANGER)
        self.error_label.grid(row=row, column=0, columnspan=2, sticky="w")
        row += 1

        self.btns = ttk.Frame(frm)
        self.btns.grid(row=row, column=0, columnspan=2, sticky="ew", pady=(16, 0))

    def load(self, project: Optional[Project], on_save: Callable[[dict], bool],
              on_delete: Optional[Callable[[], None]] = None):
        self.on_save = on_save
        self.on_delete = on_delete
        self.heading.config(text="Edit Project" if project else "Add Project")
        self.name_var.set(project.name if project else "")
        self.selected_color.set(project.color if project else config.DEFAULT_PROJECT_COLORS[0])
        self._draw_swatch()
        self.error_label.config(text="")

        for child in self.btns.winfo_children():
            child.destroy()
        if on_delete:
            RoundedButton(self.btns, text="Delete", style="Danger.TButton",
                          command=self._delete).pack(side="left")
        RoundedButton(self.btns, text="Cancel", style="Secondary.TButton",
                      command=self._cancel).pack(side="right")
        RoundedButton(self.btns, text="Save", style="Accent.TButton",
                      command=self._save).pack(side="right", padx=6)
        _rebind_wheel(self.btns)

    def _draw_swatch(self):
        self.swatch.delete("all")
        theme.rounded_rect(self.swatch, 2, 2, 24, 24, radius=5, fill=self.selected_color.get(), outline="")

    def _set_color(self, color):
        self.selected_color.set(color)
        self._draw_swatch()

    def _pick_color(self):
        # Native OS color picker -- not one of our windows, unaffected by
        # the pop-up-positioning bug this file otherwise works around.
        rgb, hexcode = colorchooser.askcolor(color=self.selected_color.get(), parent=self)
        if hexcode:
            self._set_color(hexcode)

    def _save(self):
        name = self.name_var.get().strip()
        if not name:
            self.error_label.config(text="Name is required.")
            return
        assert self.on_save is not None
        ok = self.on_save({"name": name, "color": self.selected_color.get()})
        if ok is not False:
            self.on_close()

    def _cancel(self):
        self.on_close()

    def _delete(self):
        cb = self.on_delete
        self.on_close()
        if cb:
            cb()


# ---------------------------------------------------------------------------
# Settings panel (Display Name + default Jira Project/Issue Type for exports)
# ---------------------------------------------------------------------------
class SettingsPanel(tk.Frame):
    def __init__(self, master, family: str, on_close: Callable[[], None]):
        super().__init__(master, bg=theme.PANEL_BG)
        self.family = family
        self.on_close = on_close
        self.on_save: Optional[Callable[[str, str, str, str, int, int, bool], None]] = None
        self.theme_var = tk.StringVar(value=theme.DEFAULT_THEME_ID)
        self.theme_swatch_canvases: Dict[str, tk.Canvas] = {}

        # Custom palette's four seed colors (background, panel, text,
        # accent) -- staged as a plain dict (nothing binds to it via
        # textvariable; _pick_custom_color/_draw_custom_swatches below
        # read and write it directly) and pushed live into
        # theme.set_custom_seeds() on every pick, so the "Custom" grid
        # card always previews the current picks -- same live-preview
        # approach ProjectPanel's own color picker uses.
        # _custom_seeds_on_load stashes what they were when this panel was
        # last load()-ed, so _cancel() can restore them if the user tweaks
        # colors here and then backs out without saving.
        self.custom_seeds: Dict[str, str] = theme.get_custom_seeds()
        self._custom_seeds_on_load: Dict[str, str] = dict(self.custom_seeds)
        self.custom_swatch_canvases: Dict[str, tk.Canvas] = {}
        self.custom_controls_frame: Optional[tk.Frame] = None

        # The theme preview grid plus every field below it can run
        # taller than a smaller (non-maximized) window -- see _scroll_body.
        body = _scroll_body(self)
        outer = tk.Frame(body, bg=theme.PANEL_BG)
        outer.pack(fill="both", expand=True, padx=28, pady=24)

        tk.Label(outer, text="Settings", font=(self.family, 14, "bold"),
                 bg=theme.PANEL_BG, fg=theme.TEXT_PRIMARY).pack(anchor="w", pady=(0, 16))

        frm = ttk.Frame(outer)
        frm.pack(anchor="w")

        ttk.Label(frm, text="Display Name (appears in every exported row)").grid(
            row=0, column=0, sticky="w", pady=(0, 4))
        self.display_name_var = tk.StringVar()
        ttk.Entry(frm, textvariable=self.display_name_var, width=36).grid(
            row=1, column=0, sticky="ew", pady=(0, 12))

        ttk.Label(frm, text="Default Jira Project (used when a block/project doesn't set its own)").grid(
            row=2, column=0, sticky="w", pady=(0, 4))
        self.default_jira_project_var = tk.StringVar()
        ttk.Entry(frm, textvariable=self.default_jira_project_var, width=36).grid(
            row=3, column=0, sticky="ew", pady=(0, 2))
        # This is the Jira *project* the CSV export goes under (still
        # written to the CSV's "Project" column, since that's the field
        # name Jira's importer expects) -- a completely different thing
        # from your Activities or the Projects that group them in the
        # sidebar. Called out explicitly here since all three now share
        # the word "Project" and it's genuinely easy to conflate them; in
        # practice this is almost always one fixed value for your whole
        # Jira workspace (e.g. "Quasar Delivery Management"), so you should
        # rarely need to touch it after setting it once.
        tk.Label(frm, text="This is the Jira project for CSV export (e.g. \"Quasar Delivery "
                            "Management\") -- not an Activity or Project from your sidebar. "
                            "Usually set once and left alone.",
                 fg=theme.TEXT_MUTED, bg=theme.PANEL_BG, justify="left", wraplength=360,
                 font=(self.family, 8)).grid(row=4, column=0, sticky="w", pady=(0, 12))

        ttk.Label(frm, text="Default Issue Type (used when a block/project doesn't set its own)").grid(
            row=5, column=0, sticky="w", pady=(0, 4))
        self.default_issue_type_var = tk.StringVar()
        ttk.Entry(frm, textvariable=self.default_issue_type_var, width=36).grid(
            row=6, column=0, sticky="ew", pady=(0, 12))

        ttk.Label(frm, text="Work Hours", style="Heading.TLabel").grid(
            row=7, column=0, columnspan=2, sticky="w", pady=(4, 2))
        tk.Label(frm, text="Which hours the calendar grid shows, and whether it includes "
                            "Saturday/Sunday. Applies to the Timesheet and Template tabs alike.",
                 fg=theme.TEXT_MUTED, bg=theme.PANEL_BG, justify="left", wraplength=420,
                 font=(self.family, 8)).grid(row=8, column=0, columnspan=2, sticky="w", pady=(0, 8))

        hours_row = tk.Frame(frm, bg=theme.PANEL_BG)
        hours_row.grid(row=9, column=0, columnspan=2, sticky="w", pady=(0, 10))
        # Index-based (not string-parsed) round trip: each Combobox's
        # `values` is a list of display labels ("9 AM", etc.); the actual
        # hour that label maps to is looked up by matching index in the
        # parallel _start_hour_values/_end_hour_values lists below, both
        # in load() and in _save() -- avoids re-parsing "9 AM" back into
        # an hour number and all the AM/PM edge cases that would invite.
        self._start_hour_values = list(range(0, 24))
        self._end_hour_values = list(range(1, 25))
        start_labels = [self._format_hour(h) for h in self._start_hour_values]
        end_labels = [self._format_hour(h) for h in self._end_hour_values]

        ttk.Label(hours_row, text="From").pack(side="left")
        self.work_start_var = tk.StringVar()
        self.work_start_combo = ttk.Combobox(hours_row, textvariable=self.work_start_var,
                                              values=start_labels, state="readonly", width=8)
        self.work_start_combo.pack(side="left", padx=(6, 16))

        ttk.Label(hours_row, text="To").pack(side="left")
        self.work_end_var = tk.StringVar()
        self.work_end_combo = ttk.Combobox(hours_row, textvariable=self.work_end_var,
                                            values=end_labels, state="readonly", width=8)
        self.work_end_combo.pack(side="left", padx=(6, 0))

        self.show_weekends_var = tk.BooleanVar(value=False)
        ttk.Checkbutton(frm, text="Show weekends (Saturday & Sunday)",
                         variable=self.show_weekends_var).grid(
            row=10, column=0, columnspan=2, sticky="w", pady=(0, 12))

        ttk.Label(frm, text="Theme", style="Heading.TLabel").grid(
            row=11, column=0, columnspan=2, sticky="w", pady=(4, 2))
        self.theme_description_label = tk.Label(
            frm, text="", fg=theme.TEXT_MUTED, bg=theme.PANEL_BG, justify="left",
            wraplength=520, font=(self.family, 8))
        self.theme_description_label.grid(row=12, column=0, columnspan=2, sticky="w", pady=(0, 8))

        self.theme_grid = ttk.Frame(frm)
        self.theme_grid.grid(row=13, column=0, columnspan=2, sticky="w", pady=(0, 12))
        self._build_theme_grid()

        # Only visible while "Custom" is the selected card above (toggled
        # in _refresh_theme_selection via grid()/grid_remove(), which Tk
        # remembers the row/col/sticky/pady for automatically -- no need
        # to repeat them at toggle time).
        self.custom_controls_frame = tk.Frame(frm, bg=theme.PANEL_BG)
        self.custom_controls_frame.grid(row=14, column=0, columnspan=2, sticky="w", pady=(0, 16))
        self._build_custom_controls()

        ttk.Label(frm, text="Keyboard Shortcuts", style="Heading.TLabel").grid(
            row=15, column=0, columnspan=2, sticky="w", pady=(4, 8))
        shortcuts = tk.Frame(frm, bg=theme.PANEL_BG)
        shortcuts.grid(row=16, column=0, columnspan=2, sticky="w", pady=(0, 16))
        for i, (keys, description) in enumerate(_SHORTCUTS):
            tk.Label(shortcuts, text=keys, font=(self.family, 9, "bold"),
                     bg=theme.PANEL_BG, fg=theme.TEXT_PRIMARY, anchor="nw",
                     justify="left", wraplength=230).grid(
                row=i, column=0, sticky="nw", padx=(0, 16), pady=3)
            tk.Label(shortcuts, text=description, font=(self.family, 9),
                     bg=theme.PANEL_BG, fg=theme.TEXT_SECONDARY, anchor="nw",
                     justify="left", wraplength=320).grid(row=i, column=1, sticky="nw", pady=3)

        btns = ttk.Frame(frm)
        btns.grid(row=17, column=0, columnspan=2, sticky="ew")
        RoundedButton(btns, text="Cancel", style="Secondary.TButton", command=self._cancel).pack(side="right")
        RoundedButton(btns, text="Save", style="Accent.TButton", command=self._save).pack(side="right", padx=6)

    def _build_theme_grid(self):
        # A fixed 4-columns-wide grid of theme preview cards -- the twenty
        # curated palettes plus a 21st "Custom" card at the end, wrapping
        # to a tidy 4-per-row layout. Built once (not rebuilt on every
        # load()); only the selection ring and description text change
        # after that, via _refresh_theme_selection().
        cols = 4
        ids = list(theme.THEME_ORDER) + [theme.CUSTOM_THEME_ID]
        for i, theme_id in enumerate(ids):
            row, col = divmod(i, cols)
            cell = tk.Frame(self.theme_grid, bg=theme.PANEL_BG)
            cell.grid(row=row, column=col, padx=6, pady=6)

            canvas = tk.Canvas(cell, width=132, height=88, bg=theme.PANEL_BG, highlightthickness=0,
                                cursor="hand2")
            canvas.pack()
            canvas.bind("<Button-1>", lambda e, tid=theme_id: self._select_theme(tid))
            self.theme_swatch_canvases[theme_id] = canvas

            label = tk.Label(cell, text=theme.get_theme(theme_id)["label"], font=(self.family, 9),
                              bg=theme.PANEL_BG, fg=theme.TEXT_PRIMARY, cursor="hand2")
            label.pack(pady=(4, 0))
            label.bind("<Button-1>", lambda e, tid=theme_id: self._select_theme(tid))

    def _build_custom_controls(self):
        """Four color pickers (Background, Panel, Text, Accent) that make
        up the "Custom" palette -- populates self.custom_controls_frame,
        which _refresh_theme_selection shows/hides depending on whether
        "Custom" is the selected card above. Picking a color updates
        self.custom_seeds, pushes it into theme.set_custom_seeds() right
        away (so the Custom grid card's own preview updates live, exactly
        like ProjectPanel's color picker updates its own swatch), and
        redraws that one card."""
        fields = [
            ("app_bg", "Background"), ("panel_bg", "Panel"),
            ("text_primary", "Text"), ("accent", "Accent"),
        ]
        for i, (key, label) in enumerate(fields):
            cell = tk.Frame(self.custom_controls_frame, bg=theme.PANEL_BG)
            cell.grid(row=0, column=i, padx=(0, 20), sticky="w")
            tk.Label(cell, text=label, font=(self.family, 9),
                     bg=theme.PANEL_BG, fg=theme.TEXT_SECONDARY).pack(anchor="w")
            picker_row = tk.Frame(cell, bg=theme.PANEL_BG)
            picker_row.pack(anchor="w", pady=(2, 0))
            canvas = tk.Canvas(picker_row, width=28, height=28, bg=theme.PANEL_BG,
                                highlightthickness=0, cursor="hand2")
            canvas.pack(side="left", padx=(0, 8))
            canvas.bind("<Button-1>", lambda e, k=key: self._pick_custom_color(k))
            self.custom_swatch_canvases[key] = canvas
            RoundedButton(picker_row, text="Choose…", style="Secondary.TButton",
                          command=lambda k=key: self._pick_custom_color(k)).pack(side="left")
        self._draw_custom_swatches()

    def _draw_custom_swatches(self):
        for key, canvas in self.custom_swatch_canvases.items():
            canvas.delete("all")
            theme.rounded_rect(canvas, 2, 2, 26, 26, radius=6,
                                fill=self.custom_seeds[key], outline=theme.BORDER_STRONG)

    def _pick_custom_color(self, key: str):
        # Native OS color picker, same as ProjectPanel's -- not one of our
        # windows, unaffected by the pop-up-positioning bug this file
        # otherwise works around.
        rgb, hexcode = colorchooser.askcolor(color=self.custom_seeds.get(key), parent=self)
        if not hexcode:
            return
        self.custom_seeds[key] = hexcode
        theme.set_custom_seeds(**self.custom_seeds)
        self._draw_custom_swatches()
        custom_canvas = self.theme_swatch_canvases.get(theme.CUSTOM_THEME_ID)
        if custom_canvas is not None:
            theme.draw_theme_swatch(custom_canvas, theme.CUSTOM_THEME_ID,
                                     selected=(self.theme_var.get() == theme.CUSTOM_THEME_ID))
        if self.theme_var.get() == theme.CUSTOM_THEME_ID:
            self.theme_description_label.config(text=theme.get_theme(theme.CUSTOM_THEME_ID)["description"])

    def _select_theme(self, theme_id: str):
        self.theme_var.set(theme_id)
        self._refresh_theme_selection()

    def _refresh_theme_selection(self):
        selected = self.theme_var.get()
        for theme_id, canvas in self.theme_swatch_canvases.items():
            theme.draw_theme_swatch(canvas, theme_id, selected=(theme_id == selected))
        self.theme_description_label.config(text=theme.get_theme(selected)["description"])
        if self.custom_controls_frame is not None:
            if selected == theme.CUSTOM_THEME_ID:
                self.custom_controls_frame.grid()
            else:
                self.custom_controls_frame.grid_remove()

    @staticmethod
    def _format_hour(hour_0_23: int) -> str:
        """'9 AM', '5 PM', etc. -- same format calendar_view.py's hour
        gridline labels use. Only ever called with 0-23 (an End-hour
        value of 24 is normalized to 0 -- "12 AM" -- by the caller, same
        "end of day wraps to midnight" convention a 24-hour clock uses)."""
        return datetime.strptime(str(hour_0_23 % 24), "%H").strftime("%I %p").lstrip("0")

    def load(self, display_name: str, default_jira_project: str, default_issue_type: str,
              current_theme_id: str, work_start_hour: int, work_end_hour: int, show_weekends: bool,
              on_save: Callable[[str, str, str, str, int, int, bool], None]):
        self.on_save = on_save
        self.display_name_var.set(display_name)
        self.default_jira_project_var.set(default_jira_project)
        self.default_issue_type_var.set(default_issue_type)
        self.theme_var.set(theme.resolve_theme_id(current_theme_id))
        self.custom_seeds = theme.get_custom_seeds()
        self._custom_seeds_on_load = dict(self.custom_seeds)
        self._draw_custom_swatches()
        self._refresh_theme_selection()

        start_idx = self._start_hour_values.index(work_start_hour) if work_start_hour in self._start_hour_values else 9
        end_idx = self._end_hour_values.index(work_end_hour) if work_end_hour in self._end_hour_values else 7
        self.work_start_combo.current(start_idx)
        self.work_end_combo.current(end_idx)
        self.show_weekends_var.set(show_weekends)

    def _save(self):
        assert self.on_save is not None
        start_idx = self.work_start_combo.current()
        end_idx = self.work_end_combo.current()
        work_start_hour = self._start_hour_values[start_idx if start_idx >= 0 else 9]
        work_end_hour = self._end_hour_values[end_idx if end_idx >= 0 else 7]
        if work_end_hour <= work_start_hour:
            messagebox.showwarning(
                "Invalid Work Hours",
                "The “To” time has to be later than the “From” time.")
            return
        self.on_save(
            self.display_name_var.get().strip(),
            self.default_jira_project_var.get().strip(),
            self.default_issue_type_var.get().strip(),
            self.theme_var.get(),
            work_start_hour,
            work_end_hour,
            self.show_weekends_var.get(),
        )
        self.on_close()

    def _cancel(self):
        # Revert any custom-color edits made this time the panel was open
        # but never saved -- otherwise an abandoned tweak would still show
        # up as "current" the next time Settings is reopened, even though
        # it was never actually applied or persisted.
        if self.custom_seeds != self._custom_seeds_on_load:
            theme.set_custom_seeds(**self._custom_seeds_on_load)
        self.on_close()


# ---------------------------------------------------------------------------
# Backup panel -- back up the whole database to a file, or restore from one
# ---------------------------------------------------------------------------
class BackupPanel(tk.Frame):
    """Its own tab (reached from File -> Backup & Restore…) rather than a
    section inside Settings -- it was tried there first, but the Settings
    tab's Display Name/Jira defaults/theme-grid content already fills
    a normal-sized window, and Backup & Restore's own buttons plus Save/
    Cancel ended up pushed entirely off the bottom with no way to scroll to
    them. A separate tab keeps both panels comfortably short."""

    def __init__(self, master, family: str, on_close: Callable[[], None],
                 on_backup: Callable[[str], None], on_restore: Callable[[str], None]):
        super().__init__(master, bg=theme.PANEL_BG)
        self.family = family
        self.on_close = on_close
        self.on_backup = on_backup
        self.on_restore = on_restore

        body = _scroll_body(self)
        outer = tk.Frame(body, bg=theme.PANEL_BG)
        outer.pack(fill="both", expand=True, padx=28, pady=24)

        tk.Label(outer, text="Backup & Restore", font=(self.family, 14, "bold"),
                 bg=theme.PANEL_BG, fg=theme.TEXT_PRIMARY).pack(anchor="w", pady=(0, 16))

        tk.Label(outer, text="Back up everything -- projects, activities, time blocks, the "
                              "template, and your settings -- to a single file, or restore "
                              "from a backup made earlier. Restoring replaces everything "
                              "currently in the app, so back up first if you're at all unsure.",
                 fg=theme.TEXT_MUTED, bg=theme.PANEL_BG, justify="left", wraplength=440,
                 font=(self.family, 9)).pack(anchor="w", pady=(0, 20))

        # Immediate actions, not staged fields to Save/Cancel -- each opens a
        # native file dialog (positioned by the OS, same as
        # colorchooser.askcolor in ProjectPanel above, so the embedded-tab-
        # instead-of-popup rationale in this module's docstring doesn't
        # apply here) and takes effect the moment a file is chosen.
        btn_row = ttk.Frame(outer)
        btn_row.pack(anchor="w", pady=(0, 24))
        RoundedButton(btn_row, text="Back Up Data…", style="Accent.TButton",
                      command=self._backup).pack(side="left")
        RoundedButton(btn_row, text="Restore from Backup…", style="Secondary.TButton",
                      command=self._restore).pack(side="left", padx=(8, 0))

        close_row = ttk.Frame(outer)
        close_row.pack(anchor="w", fill="x")
        RoundedButton(close_row, text="Close", style="Secondary.TButton",
                      command=self.on_close).pack(side="right")

    def _backup(self):
        default_name = f"free-timesheet-backup-{date.today().isoformat()}.db"
        path = filedialog.asksaveasfilename(
            title="Back Up Data", defaultextension=".db", initialfile=default_name,
            filetypes=[("Timesheet Backup", "*.db"), ("All files", "*.*")])
        if not path:
            return
        self.on_backup(path)

    def _restore(self):
        path = filedialog.askopenfilename(
            title="Restore from Backup",
            filetypes=[("Timesheet Backup", "*.db"), ("All files", "*.*")])
        if not path:
            return
        if not messagebox.askyesno(
                "Restore from Backup",
                "This replaces every project, activity, time block, and template entry "
                "currently in the app with what's in this backup file. This can't be "
                "undone. Continue?",
                icon="warning"):
            return
        self.on_restore(path)


# ---------------------------------------------------------------------------
# Export panel (choose date range)
# ---------------------------------------------------------------------------
class ExportPanel(tk.Frame):
    def __init__(self, master, family: str, on_close: Callable[[], None]):
        super().__init__(master, bg=theme.PANEL_BG)
        self.family = family
        self.on_close = on_close
        self.on_export: Optional[Callable[[str, str], None]] = None
        self.week_start: Optional[date] = None

        body = _scroll_body(self)
        outer = tk.Frame(body, bg=theme.PANEL_BG)
        outer.pack(fill="both", expand=True, padx=28, pady=24)

        tk.Label(outer, text="Export to Jira CSV", font=(self.family, 14, "bold"),
                 bg=theme.PANEL_BG, fg=theme.TEXT_PRIMARY).pack(anchor="w", pady=(0, 16))

        frm = ttk.Frame(outer)
        frm.pack(anchor="w")

        ttk.Label(frm, text="Export range", font=(self.family, 10, "bold")).grid(
            row=0, column=0, sticky="w", pady=(0, 8))
        self.scope_var = tk.StringVar(value="week")
        self.week_radio = ttk.Radiobutton(frm, text="", variable=self.scope_var, value="week",
                                           command=self._toggle)
        self.week_radio.grid(row=1, column=0, columnspan=2, sticky="w")
        ttk.Radiobutton(frm, text="Custom date range", variable=self.scope_var, value="custom",
                        command=self._toggle).grid(row=2, column=0, columnspan=2, sticky="w", pady=(4, 0))

        ttk.Label(frm, text="From (YYYY-MM-DD)").grid(row=3, column=0, sticky="w", pady=(10, 0))
        self.from_var = tk.StringVar()
        self.from_entry = ttk.Entry(frm, textvariable=self.from_var, width=14, state="disabled")
        self.from_entry.grid(row=3, column=1, sticky="w", pady=(10, 0))

        ttk.Label(frm, text="To (YYYY-MM-DD)").grid(row=4, column=0, sticky="w")
        self.to_var = tk.StringVar()
        self.to_entry = ttk.Entry(frm, textvariable=self.to_var, width=14, state="disabled")
        self.to_entry.grid(row=4, column=1, sticky="w")

        self.error_label = ttk.Label(frm, text="", foreground=theme.DANGER)
        self.error_label.grid(row=5, column=0, columnspan=2, sticky="w", pady=(8, 0))

        btns = ttk.Frame(frm)
        btns.grid(row=6, column=0, columnspan=2, sticky="ew", pady=(12, 0))
        RoundedButton(btns, text="Cancel", style="Secondary.TButton", command=self._cancel).pack(side="right")
        RoundedButton(btns, text="Export…", style="Accent.TButton", command=self._export).pack(
            side="right", padx=6)

    def load(self, week_start: date, on_export: Callable[[str, str], None]):
        self.week_start = week_start
        self.on_export = on_export
        self.scope_var.set("week")
        # config.week_end_offset() is 4 for a plain Mon-Fri week, 6 once
        # Settings' "Show weekends" is on -- matches whatever the
        # calendar itself currently shows instead of a Mon-Fri window
        # baked in regardless.
        week_end = week_start + timedelta(days=config.week_end_offset())
        self.week_radio.config(text=f"Current week ({week_start.strftime('%b %d')} - "
                                     f"{week_end.strftime('%b %d, %Y')})")
        self.from_var.set(week_start.isoformat())
        self.to_var.set(week_end.isoformat())
        self.from_entry.config(state="disabled")
        self.to_entry.config(state="disabled")
        self.error_label.config(text="")

    def _toggle(self):
        state = "normal" if self.scope_var.get() == "custom" else "disabled"
        self.from_entry.config(state=state)
        self.to_entry.config(state=state)

    def _export(self):
        assert self.week_start is not None
        if self.scope_var.get() == "week":
            start = self.week_start.isoformat()
            end = (self.week_start + timedelta(days=config.week_end_offset())).isoformat()
        else:
            start = self.from_var.get().strip()
            end = self.to_var.get().strip()
            try:
                date.fromisoformat(start)
                date.fromisoformat(end)
            except ValueError:
                self.error_label.config(text="Dates must be in YYYY-MM-DD format.")
                return
            if start > end:
                self.error_label.config(text="'From' date must be before 'To' date.")
                return
        cb = self.on_export
        self.on_close()
        assert cb is not None
        cb(start, end)

    def _cancel(self):
        self.on_close()
