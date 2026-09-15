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
import webbrowser
from datetime import date, datetime, timedelta
from tkinter import colorchooser, filedialog, messagebox, ttk
from typing import Callable, Dict, List, Optional, Union

from . import config, jira_csv_import, theme
from .models import Activity, Project, TemplateEntry, TimeEntry
from .version import APP_VERSION
from .widgets import RoundedButton, ScrollArea, show_saved_toast

EntryLike = Union[TimeEntry, TemplateEntry]

# Shown read-only under Settings -> Keyboard Shortcuts (see SettingsPanel
# below). Kept as one list here rather than scattered across whichever
# file actually binds each one, so this stays the single place to update
# if a shortcut is ever added, changed, or removed -- see
# main_window.py._bind_global_shortcuts (undo/redo), calendar_view.py's
# _build_widgets (everything calendar-related), and ProjectPanel's own
# Name field below (Enter to save) for where they're actually wired up.
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
    ("Enter (in a form field)", "Save the current Add/Edit Project, QDM, or "
                                 "Time Block form without needing to click Save"),
]

# Stand-in shown in Settings' API Token field (see SettingsPanel below)
# whenever a token is already stored, so a glance at the field itself --
# not just the status text underneath -- tells you one's set. Any
# non-empty value here renders as dots either way (the Entry's own
# show="\u2022" masks every character regardless of what it actually is),
# so the length here is chosen purely to *look* like a plausible token,
# not to mean anything. Never sent anywhere as a real value -- see
# SettingsPanel._save's use of _token_field_is_placeholder for how a
# left-alone field is told apart from someone actually typing a new token.
_STORED_TOKEN_MASK = "•" * 24


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


def _configure_half_width_columns(outer: tk.Frame):
    """Split `outer` into two equal-weight grid columns. Most callers only
    use column 0 (real content) and leave column 1 as a spacer; Settings
    puts its Keyboard Shortcuts section in column 1 instead (see
    SettingsPanel.__init__) rather than leaving it empty. Either way,
    because the two columns always share outer's width equally, whatever
    sits in a column (gridded with sticky="new") grows with the window --
    to about half its width when there's a spacer, less than half when
    there's real content on both sides -- and shrinks back down toward
    its own natural minimum on a narrow one, rather than bunching up in
    the top-left corner with the rest of the tab left bare, which is what
    a plain pack(anchor="w") gives you regardless of how wide the window
    is."""
    outer.columnconfigure(0, weight=1)
    outer.columnconfigure(1, weight=1)


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
# Shown at the end of the Activity tab's Project dropdown as a way to
# create a project without leaving this tab (see ActivityPanel's
# create_project param) rather than needing the separate Add Project tab.
_NEW_PROJECT_OPTION = "+ New Project…"


class ActivityPanel(tk.Frame):
    def __init__(self, master, family: str, on_close: Callable[[], None],
                 get_projects: Callable[[], List[Project]],
                 create_project: Callable[[str], Project],
                 on_import_via_api: Optional[Callable[[], None]] = None):
        super().__init__(master, bg=theme.PANEL_BG)
        self.family = family
        self.on_close = on_close
        self.get_projects = get_projects
        self.create_project = create_project
        # Optional -- lets the Add QDM screen also be the "fresh install,
        # zero QDMs yet" starting point (see main_window.py's
        # _open_jira_api_import) without every other caller needing to
        # know or care about the Jira import feature. The CSV-based
        # manual alternatives (export a filtered Jira list in the
        # browser, then import that CSV) used to live here too, but now
        # live under Settings -> Manual Import instead -- this screen
        # only ever shows the one-click, no-file-picker way in, to keep
        # it to a single obvious action rather than three competing
        # buttons.
        self.on_import_via_api = on_import_via_api
        self.on_save: Optional[Callable[[dict], bool]] = None
        self.on_delete: Optional[Callable[[], None]] = None
        self.project_id_by_label: Dict[str, Optional[int]] = {}

        body = _scroll_body(self)
        outer = tk.Frame(body, bg=theme.PANEL_BG)
        outer.pack(fill="both", expand=True, padx=28, pady=24)
        _configure_half_width_columns(outer)

        # Row 0 holds the panel heading AND the "Import QDM via API"
        # shortcut side by side -- this is the fastest way into bulk
        # import right from the screen that otherwise adds QDMs one at a
        # time, and it's the entry point a fresh install (no QDMs, no
        # Projects yet -- see db.py's removed _seed_defaults_if_empty)
        # leans on instead of a File-menu item. The same button also
        # sits on the main tab row (see main_window.py's _build_body) so
        # it's reachable without opening this screen at all -- this copy
        # stays too since it's still useful mid-review here.
        header_row = tk.Frame(outer, bg=theme.PANEL_BG)
        header_row.grid(row=0, column=0, columnspan=2, sticky="ew", pady=(0, 24))
        header_row.columnconfigure(0, weight=1)

        self.heading = tk.Label(header_row, text="Add QDM", font=(self.family, 20, "bold"),
                                 bg=theme.PANEL_BG, fg=theme.TEXT_PRIMARY)
        self.heading.grid(row=0, column=0, sticky="w")

        if self.on_import_via_api is not None:
            # Accent (not Secondary) -- brighter fill and bigger padding
            # than a plain Secondary button (see widgets._BUTTON_STYLES),
            # so this, the only shortcut on an otherwise one-at-a-time
            # form, actually reads as the standout action on the screen.
            # Needs a saved Jira API token (Settings -> Jira Cloud
            # Upload) to work -- clicking without one set up explains
            # that and points at Settings -> Manual Import as the
            # no-token-needed alternative (see
            # main_window.py's _open_jira_api_import).
            RoundedButton(header_row, text="Import QDM via API", style="Accent.TButton",
                          command=self.on_import_via_api).grid(row=0, column=1, sticky="e")

        frm = ttk.Frame(outer)
        frm.grid(row=1, column=0, sticky="new")
        frm.columnconfigure(1, weight=1)

        row = 0
        ttk.Label(frm, text="Name", style="Big.TLabel").grid(row=row, column=0, sticky="w", pady=10)
        self.name_var = tk.StringVar()
        name_entry = ttk.Entry(frm, textvariable=self.name_var, width=32, style="Big.TEntry")
        name_entry.grid(row=row, column=1, sticky="ew", pady=10)
        name_entry.bind("<Return>", lambda e: self._save())
        row += 1

        ttk.Label(frm, text="Jira Issue Key", style="Big.TLabel").grid(row=row, column=0, sticky="w", pady=10)
        # Every key in this app starts with the same fixed "QDM-" prefix
        # (see app/config.py's JIRA_KEY_PREFIX), so this only asks for the
        # number after it -- the static "QDM-" label makes what's being
        # typed (and what the full key will be) obvious at a glance.
        key_row = tk.Frame(frm, bg=theme.PANEL_BG)
        key_row.grid(row=row, column=1, sticky="w", pady=10)
        tk.Label(key_row, text=config.JIRA_KEY_PREFIX, font=(self.family, 12, "bold"),
                 bg=theme.PANEL_BG, fg=theme.TEXT_SECONDARY).pack(side="left")
        self.jira_key_number_var = tk.StringVar()
        jira_key_entry = ttk.Entry(key_row, textvariable=self.jira_key_number_var, width=10,
                                    style="Big.TEntry")
        jira_key_entry.pack(side="left")
        jira_key_entry.bind("<Return>", lambda e: self._save())
        row += 1

        ttk.Label(frm, text="Project", style="Big.TLabel").grid(row=row, column=0, sticky="w", pady=10)
        self.project_var = tk.StringVar()
        self.project_combo = ttk.Combobox(frm, textvariable=self.project_var,
                                           state="readonly", width=30, style="Big.TCombobox")
        self.project_combo.grid(row=row, column=1, sticky="ew", pady=10)
        self.project_combo.bind("<<ComboboxSelected>>", self._on_project_changed)
        self.project_combo.bind("<Return>", lambda e: self._save())
        row += 1

        # Hidden unless "+ New Project..." is selected above (see
        # _on_project_changed) -- lets a user create a project without
        # leaving this tab, via the create_project callback.
        self.new_project_label = ttk.Label(frm, text="New Project Name", style="Big.TLabel")
        self.new_project_label.grid(row=row, column=0, sticky="w", pady=10)
        self.new_project_name_var = tk.StringVar()
        self.new_project_entry = ttk.Entry(frm, textvariable=self.new_project_name_var, width=32,
                                            style="Big.TEntry")
        self.new_project_entry.grid(row=row, column=1, sticky="ew", pady=10)
        self.new_project_entry.bind("<Return>", lambda e: self._save())
        self._set_new_project_field_visible(False)
        row += 1

        # Every Activity belongs to exactly one Project -- there's no
        # "(No project)" option -- since a time block's color always comes
        # from its Activity's Project rather than being set here.
        tk.Label(frm, text="Color comes from the Project this activity belongs to -- set it "
                            "from the Project's own edit panel.",
                 fg=theme.TEXT_MUTED, bg=theme.PANEL_BG, justify="left", wraplength=420,
                 font=(self.family, 9)).grid(row=row, column=0, columnspan=2, sticky="w", pady=(0, 14))
        row += 1

        # Jira Project and Issue Type are deliberately NOT editable
        # per-activity (or anywhere else in the UI) -- this app always
        # exports into the same fixed Jira project and issue type (see
        # app/config.py's DEFAULT_JIRA_PROJECT/DEFAULT_ISSUE_TYPE). Export
        # still fills them in automatically (see app/export_csv.py's
        # build_row) -- a time block can still override either one
        # individually if it ever needs to differ, via its own Time Block
        # tab.

        ttk.Label(frm, text="Default Duration (min)", style="Big.TLabel").grid(
            row=row, column=0, sticky="w", pady=10)
        self.duration_var = tk.StringVar()
        duration_entry = ttk.Entry(frm, textvariable=self.duration_var, width=10, style="Big.TEntry")
        duration_entry.grid(row=row, column=1, sticky="w", pady=10)
        duration_entry.bind("<Return>", lambda e: self._save())
        row += 1

        self.error_label = ttk.Label(frm, text="", foreground=theme.DANGER, style="Big.TLabel")
        self.error_label.grid(row=row, column=0, columnspan=2, sticky="w")
        row += 1

        self.btns = ttk.Frame(frm)
        self.btns.grid(row=row, column=0, columnspan=2, sticky="ew", pady=(24, 0))

    def load(self, activity: Optional[Activity], on_save: Callable[[dict], bool],
              on_delete: Optional[Callable[[], None]] = None):
        self.on_save = on_save
        self.on_delete = on_delete
        self.heading.config(text="Edit QDM" if activity else "Add QDM")

        projects = self.get_projects()
        labels = [p.name for p in projects]
        self.project_id_by_label = {p.name: p.id for p in projects}
        self.project_combo.config(values=labels + [_NEW_PROJECT_OPTION])
        current_project_id = activity.project_id if activity else (projects[0].id if projects else None)
        current_label = next((p.name for p in projects if p.id == current_project_id),
                              (labels[0] if labels else ""))
        self.project_var.set(current_label)
        self.project_combo.set(current_label)
        self.new_project_name_var.set("")
        self._set_new_project_field_visible(False)

        self.name_var.set(activity.name if activity else "")
        self.jira_key_number_var.set(config.jira_key_number(activity.jira_key) if activity else "")
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

    def _set_new_project_field_visible(self, visible: bool):
        if visible:
            self.new_project_label.grid()
            self.new_project_entry.grid()
        else:
            self.new_project_label.grid_remove()
            self.new_project_entry.grid_remove()

    def _on_project_changed(self, _event=None):
        self._set_new_project_field_visible(self.project_var.get() == _NEW_PROJECT_OPTION)

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

        selected_project = self.project_var.get()
        if selected_project == _NEW_PROJECT_OPTION:
            new_project_name = self.new_project_name_var.get().strip()
            if not new_project_name:
                self.error_label.config(text="Enter a name for the new project.")
                return
            project_id = self.create_project(new_project_name).id
        else:
            project_id = self.project_id_by_label.get(selected_project)
            if project_id is None:
                self.error_label.config(text="Choose a project.")
                return

        result = {
            "name": name,
            "jira_key": config.jira_key_from_number(self.jira_key_number_var.get()),
            "default_duration_minutes": duration,
            "project_id": project_id,
            # No longer editable per-activity (see the comment near the
            # fields above) -- Jira Project/Issue Type come from
            # app/config.py's fixed defaults at export time instead.
            "jira_project": None,
            "issue_type": None,
        }
        assert self.on_save is not None
        ok = self.on_save(result)
        if ok is not False:
            show_saved_toast(self)
            self.on_close()

    def _cancel(self):
        self.on_close()

    def _delete(self):
        cb = self.on_delete
        self.on_close()
        if cb:
            cb()


# ---------------------------------------------------------------------------
# Import QDMs from a Jira CSV export -- bulk alternative to ActivityPanel's
# one-at-a-time "Add QDM" above, for someone with a long backlog of Jira
# issues assigned to them and none of them in this app yet. See
# app/jira_csv_import.py for the actual CSV parsing (this panel is purely
# the review UI: main_window.py's _open_jira_csv_import_dialog does the
# file picking + parsing + dedup-against-existing-Activities, and hands
# this panel the resulting candidates to review before anything is
# created) and the README's "Importing QDMs from Jira" section for the
# JQL/export walkthrough this whole feature is meant to consume.
# ---------------------------------------------------------------------------
class ImportQdmPanel(tk.Frame):
    def __init__(self, master, family: str, on_close: Callable[[], None],
                 get_projects: Callable[[], List[Project]],
                 create_project: Callable[[str], Project]):
        super().__init__(master, bg=theme.PANEL_BG)
        self.family = family
        self.on_close = on_close
        self.get_projects = get_projects
        self.create_project = create_project
        # Callable[[List[Tuple[name, jira_key, project_id]]], None] --
        # set fresh by every load(), same convention as ActivityPanel's
        # on_save/on_delete.
        self.on_import: Optional[Callable[[list], None]] = None
        # One dict per candidate row, built fresh by load() -- each row
        # is otherwise an independent copy of ActivityPanel's own
        # Project-dropdown block (project_var/combo/id-by-label plus the
        # hideable "+ New Project..." fields), just keyed by row instead
        # of held directly on self, since there can be any number of them.
        self.rows: List[dict] = []

        body = _scroll_body(self)
        outer = tk.Frame(body, bg=theme.PANEL_BG)
        outer.pack(fill="both", expand=True, padx=28, pady=24)

        tk.Label(outer, text="Import QDMs from Jira", font=(self.family, 20, "bold"),
                 bg=theme.PANEL_BG, fg=theme.TEXT_PRIMARY).pack(anchor="w", pady=(0, 6))

        self.summary_label = tk.Label(outer, text="", font=(self.family, 10), justify="left",
                                       wraplength=520, bg=theme.PANEL_BG, fg=theme.TEXT_SECONDARY)
        self.summary_label.pack(anchor="w", pady=(0, 14))

        quick_row = ttk.Frame(outer)
        quick_row.pack(anchor="w", pady=(0, 10))
        RoundedButton(quick_row, text="Select all", style="Secondary.TButton",
                      command=self._select_all).pack(side="left")
        RoundedButton(quick_row, text="Select none", style="Secondary.TButton",
                      command=self._select_none).pack(side="left", padx=6)

        self.rows_frame = ttk.Frame(outer)
        self.rows_frame.pack(fill="x", anchor="w")

        self.error_label = ttk.Label(outer, text="", foreground=theme.DANGER, style="Big.TLabel")
        self.error_label.pack(anchor="w", pady=(10, 0))

        self.btns = ttk.Frame(outer)
        self.btns.pack(anchor="w", fill="x", pady=(16, 0))

    def load(self, candidates: List[jira_csv_import.ImportCandidate],
              skipped_duplicate: int, skipped_not_a_qdm_key: int, skipped_blank_key: int,
              on_import: Callable[[list], None]):
        self.on_import = on_import

        parts = [f"{len(candidates)} new QDM(s) found."]
        if skipped_duplicate:
            parts.append(f"{skipped_duplicate} already in your QDMs (skipped).")
        if skipped_not_a_qdm_key:
            parts.append(f"{skipped_not_a_qdm_key} row(s) didn’t look like a "
                          f"{config.JIRA_KEY_PREFIX}<number> issue key (skipped).")
        if skipped_blank_key:
            parts.append(f"{skipped_blank_key} row(s) had no Issue Key at all (skipped).")
        parts.append("Pick a Project for each one below, then Import All -- untick any you "
                      "don’t want to add yet.")
        self.summary_label.config(text=" ".join(parts))

        projects = self.get_projects()
        labels = [p.name for p in projects]
        project_id_by_label: Dict[str, Optional[int]] = {p.name: p.id for p in projects}
        default_label = labels[0] if labels else _NEW_PROJECT_OPTION

        for child in self.rows_frame.winfo_children():
            child.destroy()
        self.rows = []

        for i, candidate in enumerate(candidates):
            if i > 0:
                # Between this row and the previous one -- packed before
                # row_frame below, not after, so it lands between them
                # rather than one row late (with a stray extra line
                # trailing the last row).
                tk.Frame(self.rows_frame, bg=theme.BORDER, height=1).pack(fill="x", pady=(14, 14))
            row_frame = ttk.Frame(self.rows_frame)
            row_frame.pack(fill="x")
            row_frame.columnconfigure(1, weight=1)

            include_var = tk.BooleanVar(value=True)
            head = ttk.Frame(row_frame)
            head.grid(row=0, column=0, columnspan=2, sticky="ew")
            head.columnconfigure(0, weight=1)
            tk.Label(head, text=candidate.jira_key, font=(self.family, 12, "bold"),
                     bg=theme.PANEL_BG, fg=theme.TEXT_PRIMARY).grid(row=0, column=0, sticky="w")
            ttk.Checkbutton(head, text="Include", variable=include_var).grid(row=0, column=1, sticky="e")

            ttk.Label(row_frame, text="Name", style="Big.TLabel").grid(
                row=1, column=0, sticky="w", pady=6)
            name_var = tk.StringVar(value=candidate.name)
            ttk.Entry(row_frame, textvariable=name_var, width=32, style="Big.TEntry").grid(
                row=1, column=1, sticky="ew", pady=6)

            ttk.Label(row_frame, text="Project", style="Big.TLabel").grid(
                row=2, column=0, sticky="w", pady=6)
            project_var = tk.StringVar(value=default_label)
            project_combo = ttk.Combobox(row_frame, textvariable=project_var, state="readonly",
                                          width=30, style="Big.TCombobox")
            project_combo.config(values=labels + [_NEW_PROJECT_OPTION])
            project_combo.grid(row=2, column=1, sticky="ew", pady=6)

            new_project_label = ttk.Label(row_frame, text="New Project Name", style="Big.TLabel")
            new_project_label.grid(row=3, column=0, sticky="w", pady=6)
            new_project_name_var = tk.StringVar()
            new_project_entry = ttk.Entry(row_frame, textvariable=new_project_name_var, width=32,
                                           style="Big.TEntry")
            new_project_entry.grid(row=3, column=1, sticky="ew", pady=6)

            row = {
                "jira_key": candidate.jira_key,
                "include_var": include_var,
                "name_var": name_var,
                "project_var": project_var,
                "project_id_by_label": project_id_by_label,
                "new_project_label": new_project_label,
                "new_project_entry": new_project_entry,
                "new_project_name_var": new_project_name_var,
            }
            self._set_row_new_project_visible(row, default_label == _NEW_PROJECT_OPTION)
            project_combo.bind("<<ComboboxSelected>>", lambda e, r=row: self._on_row_project_changed(r))
            self.rows.append(row)

        _rebind_wheel(self.rows_frame)

        self.error_label.config(text="")
        for child in self.btns.winfo_children():
            child.destroy()
        RoundedButton(self.btns, text="Cancel", style="Secondary.TButton",
                      command=self._cancel).pack(side="right")
        RoundedButton(self.btns, text="Import All", style="Accent.TButton",
                      command=self._import_all).pack(side="right", padx=6)
        _rebind_wheel(self.btns)

    def _select_all(self):
        for row in self.rows:
            row["include_var"].set(True)

    def _select_none(self):
        for row in self.rows:
            row["include_var"].set(False)

    @staticmethod
    def _set_row_new_project_visible(row: dict, visible: bool):
        if visible:
            row["new_project_label"].grid()
            row["new_project_entry"].grid()
        else:
            row["new_project_label"].grid_remove()
            row["new_project_entry"].grid_remove()

    def _on_row_project_changed(self, row: dict):
        self._set_row_new_project_visible(row, row["project_var"].get() == _NEW_PROJECT_OPTION)

    def _import_all(self):
        # Validated in two passes on purpose, rather than creating each
        # row's Project as its own row is checked: if row 3 of 5 fails
        # validation after rows 1-2 already created a "+ New Project..."
        # entry, fixing row 3 and clicking Import All again would create
        # rows 1-2's projects a SECOND time (create_project has no
        # "already exists" check of its own -- see
        # Database.add_project_with_default_color). Checking every
        # included row first, and only creating anything once the whole
        # batch is known-good, means a validation failure never leaves a
        # half-applied import behind to retry into duplicates.
        included = [row for row in self.rows if row["include_var"].get()]
        if not included:
            self.error_label.config(text="Nothing ticked to import -- tick at least one QDM, "
                                          "or Cancel.")
            return

        for row in included:
            selected = row["project_var"].get()
            if selected == _NEW_PROJECT_OPTION:
                if not row["new_project_name_var"].get().strip():
                    self.error_label.config(
                        text=f"Enter a project name for {row['jira_key']}, or untick it.")
                    return
            elif row["project_id_by_label"].get(selected) is None:
                self.error_label.config(text=f"Choose a project for {row['jira_key']}.")
                return

        # Two rows both choosing "+ New Project..." with the same typed
        # name create that project once, not twice -- same "don't leave
        # someone with two identically-named Projects" concern
        # ActivityPanel's single-row version doesn't need to worry about,
        # since it only ever creates at most one project per Save.
        created_project_ids_by_name: Dict[str, Optional[int]] = {}
        to_import = []
        for row in included:
            selected = row["project_var"].get()
            if selected == _NEW_PROJECT_OPTION:
                new_name = row["new_project_name_var"].get().strip()
                if new_name in created_project_ids_by_name:
                    project_id = created_project_ids_by_name[new_name]
                else:
                    project_id = self.create_project(new_name).id
                    created_project_ids_by_name[new_name] = project_id
            else:
                project_id = row["project_id_by_label"].get(selected)
            name = row["name_var"].get().strip() or row["jira_key"]
            to_import.append((name, row["jira_key"], project_id))

        cb = self.on_import
        self.on_close()
        assert cb is not None
        cb(to_import)

    def _cancel(self):
        self.on_close()


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
        _configure_half_width_columns(outer)

        self.heading = tk.Label(outer, text="Add Project", font=(self.family, 20, "bold"),
                                 bg=theme.PANEL_BG, fg=theme.TEXT_PRIMARY)
        self.heading.grid(row=0, column=0, columnspan=2, sticky="w", pady=(0, 10))

        self.subheading = tk.Label(
            outer, text="Projects group your activities in the sidebar and set the color "
                        "every one of their time blocks shows.",
            font=(self.family, 10), justify="left", wraplength=420,
            bg=theme.PANEL_BG, fg=theme.TEXT_SECONDARY)
        self.subheading.grid(row=1, column=0, columnspan=2, sticky="w", pady=(0, 20))

        frm = ttk.Frame(outer)
        frm.grid(row=2, column=0, sticky="new")
        frm.columnconfigure(1, weight=1)

        row = 0
        ttk.Label(frm, text="Name *", style="Big.TLabel").grid(row=row, column=0, sticky="w", pady=10)
        self.name_var = tk.StringVar()
        entry = ttk.Entry(frm, textvariable=self.name_var, width=32, style="Big.TEntry")
        entry.grid(row=row, column=1, sticky="ew", pady=10)
        entry.bind("<Return>", lambda e: self._save())
        row += 1

        ttk.Label(frm, text="Color", style="Big.TLabel").grid(row=row, column=0, sticky="w", pady=10)
        color_frame = ttk.Frame(frm)
        color_frame.grid(row=row, column=1, sticky="w", pady=10)
        self.swatch = tk.Canvas(color_frame, width=32, height=32, highlightthickness=1,
                                 highlightbackground=theme.BORDER_STRONG, bg=theme.PANEL_BG)
        self.swatch.pack(side="left", padx=(0, 10))
        self._draw_swatch()
        RoundedButton(color_frame, text="Choose…", style="Secondary.TButton",
                      command=self._pick_color).pack(side="left")
        row += 1

        palette = ttk.Frame(frm)
        palette.grid(row=row, column=0, columnspan=2, sticky="w", pady=(4, 12))
        for c in config.DEFAULT_PROJECT_COLORS:
            sw = tk.Canvas(palette, width=24, height=24, bg=c, highlightthickness=1,
                            highlightbackground=theme.BORDER_STRONG, cursor="hand2")
            sw.pack(side="left", padx=3)
            sw.bind("<Button-1>", lambda e, col=c: self._set_color(col))
        row += 1

        # This project's color is the ONLY place a color gets set -- every
        # time block for every activity in this project just inherits it
        # (and stays in sync if it's changed here later, see
        # Sidebar._edit_project -> db.update_project), rather than each
        # activity or block having its own color.
        tk.Label(frm, text="This color is used for every time block for every activity in this project.",
                 fg=theme.TEXT_MUTED, bg=theme.PANEL_BG, justify="left", wraplength=420,
                 font=(self.family, 9)).grid(row=row, column=0, columnspan=2, sticky="w", pady=(0, 14))
        row += 1

        self.error_label = ttk.Label(frm, text="", foreground=theme.DANGER, style="Big.TLabel")
        self.error_label.grid(row=row, column=0, columnspan=2, sticky="w")
        row += 1

        self.btns = ttk.Frame(frm)
        self.btns.grid(row=row, column=0, columnspan=2, sticky="ew", pady=(24, 0))

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
            show_saved_toast(self)
            self.on_close()

    def _cancel(self):
        self.on_close()

    def _delete(self):
        cb = self.on_delete
        self.on_close()
        if cb:
            cb()


# ---------------------------------------------------------------------------
# Settings panel (Display Name, work hours, theme)
# ---------------------------------------------------------------------------
class SettingsPanel(tk.Frame):
    def __init__(self, master, family: str, on_close: Callable[[], None],
                 has_stored_token: Callable[[], bool],
                 on_save_token: Callable[[str, str, str], bool],
                 on_clear_token: Callable[[], None],
                 on_export_worklog_csv: Optional[Callable[[], None]] = None,
                 on_export_qdms_from_jira: Optional[Callable[[], None]] = None,
                 on_import_qdms_from_csv: Optional[Callable[[], None]] = None):
        super().__init__(master, bg=theme.PANEL_BG)
        self.family = family
        self.on_close = on_close
        # The API Token field's three standalone actions (see the "Save
        # API Token"/"Clear stored token" buttons and _refresh_jira_token_
        # field below) go straight through these rather than the big
        # on_save round trip -- same reasoning as BackupPanel's on_backup/
        # on_restore: this panel never holds a Database reference itself.
        self.has_stored_token = has_stored_token
        self.on_save_token = on_save_token
        self.on_clear_token = on_clear_token
        # "Manual Import" section (below, in the right column) -- the
        # CSV-based ways to move data between this app and Jira, kept
        # separate from the automatic API buttons on the main screens
        # (the tab row's "Upload to JIRA via API"/"Import QDM via API")
        # so those stay the only Jira-related buttons someone sees day to
        # day, with the manual fallbacks tucked away here for anyone who
        # hasn't set up (or doesn't want) a saved API token. All three
        # are just entry points into panels/actions main_window.py
        # already owns -- same "this panel never touches the database or
        # Jira itself" separation as the token callbacks above.
        self.on_export_worklog_csv = on_export_worklog_csv
        self.on_export_qdms_from_jira = on_export_qdms_from_jira
        self.on_import_qdms_from_csv = on_import_qdms_from_csv
        self.on_save: Optional[Callable[[str, str, int, int, bool, str, str, str], None]] = None
        self.theme_var = tk.StringVar(value=theme.DEFAULT_THEME_ID)
        self.theme_swatch_canvases: Dict[str, tk.Canvas] = {}
        # True whenever the API Token field is showing _STORED_TOKEN_MASK
        # rather than something the person actually typed -- see that
        # constant's own comment for why this needs tracking separately
        # from "the field is non-empty" (a masked Entry can't tell those
        # apart just by looking at its own displayed value).
        self._token_field_is_placeholder = False

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
        _configure_half_width_columns(outer)

        tk.Label(outer, text="Settings", font=(self.family, 20, "bold"),
                 bg=theme.PANEL_BG, fg=theme.TEXT_PRIMARY).grid(
            row=0, column=0, columnspan=2, sticky="w", pady=(0, 24))

        # Left column: Display Name, Work Hours, Theme -- the settings
        # someone actually edits. Right column: Keyboard Shortcuts --
        # reference material glanced at rather than changed, so it doesn't
        # need to sit above the fold underneath everything else; putting
        # it beside the settings instead uses the space
        # _configure_half_width_columns opened up on the right rather than
        # leaving it empty.
        left = ttk.Frame(outer)
        left.grid(row=1, column=0, sticky="new", padx=(0, 36))
        left.columnconfigure(0, weight=1)

        right = ttk.Frame(outer)
        right.grid(row=1, column=1, sticky="new")

        # `left` and `right` split `outer` into two equal-*weight* columns
        # (_configure_half_width_columns), but neither one's actual
        # content can shrink to fit a narrower share of that split: the
        # theme preview grid below is a fixed matrix of swatch cards, and
        # the Keyboard Shortcuts table is two fixed-wraplength label
        # columns. Below some window width, evenly splitting the space
        # forces both columns narrower than that fixed content needs --
        # the content itself doesn't get smaller, it just spills past its
        # own column's boundary into the other one, which is what showed
        # up as the shortcuts table visually overlapping the theme grid.
        # _reflow_settings_columns watches outer's actual rendered width
        # (which tracks the window's width -- see ScrollArea's own
        # canvas-forced-width binding in widgets.py) and switches
        # Keyboard Shortcuts from beside the settings fields to below
        # them, full width, the moment there isn't room for both at their
        # natural size -- ScrollArea's existing vertical scrolling then
        # handles the extra height exactly like it already does for a
        # tall left column on its own.
        self._settings_left = left
        self._settings_right = right
        self._settings_outer = outer
        self._settings_stacked = False
        outer.bind("<Configure>", self._reflow_settings_columns)
        outer.after_idle(self._reflow_settings_columns)

        ttk.Label(left, text="Display Name", style="Heading.TLabel").grid(
            row=0, column=0, columnspan=2, sticky="w", pady=(0, 6))
        tk.Label(left, text="Appears in every exported row.",
                 fg=theme.TEXT_MUTED, bg=theme.PANEL_BG, justify="left", wraplength=420,
                 font=(self.family, 9)).grid(row=1, column=0, columnspan=2, sticky="w", pady=(0, 10))
        self.display_name_var = tk.StringVar()
        display_name_entry = ttk.Entry(left, textvariable=self.display_name_var, width=36,
                                        style="Big.TEntry")
        display_name_entry.grid(row=2, column=0, sticky="ew", pady=(0, 28))
        # Fires once someone tabs/clicks away from Display Name (not on every
        # keystroke -- a partial name like "Alex R" mid-type would otherwise
        # get guessed at and then "lock in" before "Rae" is even typed; see
        # _maybe_derive_jira_email's own docstring for the full guard logic).
        display_name_entry.bind("<FocusOut>", self._maybe_derive_jira_email)

        ttk.Label(left, text="Work Hours", style="Heading.TLabel").grid(
            row=3, column=0, columnspan=2, sticky="w", pady=(0, 6))
        tk.Label(left, text="Which hours the calendar grid shows, and whether it includes "
                            "Saturday/Sunday. Applies to the Timesheet and Template tabs alike.",
                 fg=theme.TEXT_MUTED, bg=theme.PANEL_BG, justify="left", wraplength=420,
                 font=(self.family, 9)).grid(row=4, column=0, columnspan=2, sticky="w", pady=(0, 10))

        hours_row = tk.Frame(left, bg=theme.PANEL_BG)
        hours_row.grid(row=5, column=0, columnspan=2, sticky="w", pady=(0, 14))
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

        ttk.Label(hours_row, text="From", style="Big.TLabel").pack(side="left")
        self.work_start_var = tk.StringVar()
        self.work_start_combo = ttk.Combobox(hours_row, textvariable=self.work_start_var,
                                              values=start_labels, state="readonly", width=8,
                                              style="Big.TCombobox")
        self.work_start_combo.pack(side="left", padx=(8, 20))

        ttk.Label(hours_row, text="To", style="Big.TLabel").pack(side="left")
        self.work_end_var = tk.StringVar()
        self.work_end_combo = ttk.Combobox(hours_row, textvariable=self.work_end_var,
                                            values=end_labels, state="readonly", width=8,
                                            style="Big.TCombobox")
        self.work_end_combo.pack(side="left", padx=(8, 0))

        self.show_weekends_var = tk.BooleanVar(value=False)
        ttk.Checkbutton(left, text="Show weekends (Saturday & Sunday)",
                         variable=self.show_weekends_var, style="Big.TCheckbutton").grid(
            row=6, column=0, columnspan=2, sticky="w", pady=(0, 14))

        # Checked = hidden (not "shown"): this is an opt-*in* away from the
        # default, so "Hide the Timer bar" reads more naturally as the
        # thing you're turning on than a double-negative "Don't show the
        # Timer bar" would -- _save() below inverts it back to the
        # show_timer_bar bool main_window.py actually persists/reads.
        self.hide_timer_var = tk.BooleanVar(value=False)
        ttk.Checkbutton(left, text="Hide the Timer bar",
                         variable=self.hide_timer_var, style="Big.TCheckbutton").grid(
            row=7, column=0, columnspan=2, sticky="w", pady=(0, 2))
        tk.Label(left, text="Frees up space above the calendar. Turn back on here any time.",
                 fg=theme.TEXT_MUTED, bg=theme.PANEL_BG, justify="left", wraplength=420,
                 font=(self.family, 9)).grid(row=8, column=0, columnspan=2, sticky="w", pady=(0, 20))

        ttk.Label(left, text="Heading", style="Heading.TLabel").grid(
            row=9, column=0, columnspan=2, sticky="w", pady=(0, 6))
        tk.Label(left, text="Standard shows the full title bar. Compact shrinks it. Hidden "
                            "removes it -- the calendar gets that space back either way.",
                 fg=theme.TEXT_MUTED, bg=theme.PANEL_BG, justify="left", wraplength=420,
                 font=(self.family, 9)).grid(row=10, column=0, columnspan=2, sticky="w", pady=(0, 8))
        self.header_style_row = tk.Frame(left, bg=theme.PANEL_BG)
        self.header_style_row.grid(row=11, column=0, columnspan=2, sticky="w", pady=(0, 28))
        self.header_style_choice = "standard"
        self.header_style_buttons: Dict[str, RoundedButton] = {}
        for key, label in (("standard", "Standard"), ("compact", "Compact"), ("hidden", "Hidden")):
            btn = RoundedButton(self.header_style_row, text=label, style="Secondary.TButton",
                                 command=lambda k=key: self._select_header_style(k))
            btn.pack(side="left", padx=(0, 6))
            self.header_style_buttons[key] = btn

        ttk.Label(left, text="Theme", style="Heading.TLabel").grid(
            row=12, column=0, columnspan=2, sticky="w", pady=(0, 6))
        self.theme_description_label = tk.Label(
            left, text="", fg=theme.TEXT_MUTED, bg=theme.PANEL_BG, justify="left",
            wraplength=480, font=(self.family, 9))
        self.theme_description_label.grid(row=13, column=0, columnspan=2, sticky="w", pady=(0, 10))

        self.theme_grid = ttk.Frame(left)
        self.theme_grid.grid(row=14, column=0, columnspan=2, sticky="w", pady=(0, 12))
        self._build_theme_grid()

        # Only visible while "Custom" is the selected card above (toggled
        # in _refresh_theme_selection via grid()/grid_remove(), which Tk
        # remembers the row/col/sticky/pady for automatically -- no need
        # to repeat them at toggle time).
        self.custom_controls_frame = tk.Frame(left, bg=theme.PANEL_BG)
        self.custom_controls_frame.grid(row=15, column=0, columnspan=2, sticky="w", pady=(0, 16))
        self._build_custom_controls()

        ttk.Label(right, text="Keyboard Shortcuts", style="Heading.TLabel").grid(
            row=0, column=0, sticky="w", pady=(0, 10))
        shortcuts = tk.Frame(right, bg=theme.PANEL_BG)
        shortcuts.grid(row=1, column=0, sticky="new")
        for i, (keys, description) in enumerate(_SHORTCUTS):
            tk.Label(shortcuts, text=keys, font=(self.family, 10, "bold"),
                     bg=theme.PANEL_BG, fg=theme.TEXT_PRIMARY, anchor="nw",
                     justify="left", wraplength=260).grid(
                row=i, column=0, sticky="nw", padx=(0, 16), pady=5)
            tk.Label(shortcuts, text=description, font=(self.family, 10),
                     bg=theme.PANEL_BG, fg=theme.TEXT_SECONDARY, anchor="nw",
                     justify="left", wraplength=360).grid(row=i, column=1, sticky="nw", pady=5)

        # Jira Cloud Upload -- only needed for the two automatic API
        # buttons on the tab row (app/jira_client.py): "Upload to JIRA
        # via API" and "Import QDM via API". The manual, CSV-based
        # alternatives under Settings -> Manual Import don't read any of
        # this. Lives in the right column, under Keyboard Shortcuts,
        # rather than competing with Display Name/Work Hours/Theme on the
        # left for space above the fold -- this is a one-time setup step
        # for most people, not something revisited often.
        ttk.Label(right, text="Jira Cloud Upload", style="Heading.TLabel").grid(
            row=2, column=0, sticky="w", pady=(28, 6))
        tk.Label(right, text="Needed for the \u201cUpload to JIRA via API\u201d and \u201cImport "
                             "QDM via API\u201d buttons on the tab row. Jira Server/Data "
                             "Center aren't supported -- Jira Cloud only.",
                 fg=theme.TEXT_MUTED, bg=theme.PANEL_BG, justify="left", wraplength=360,
                 font=(self.family, 9)).grid(row=3, column=0, sticky="w", pady=(0, 10))

        jira_frame = ttk.Frame(right)
        jira_frame.grid(row=4, column=0, sticky="new")

        ttk.Label(jira_frame, text="Site URL", style="Big.TLabel").grid(row=0, column=0, sticky="w")
        self.jira_site_url_var = tk.StringVar()
        ttk.Entry(jira_frame, textvariable=self.jira_site_url_var, width=34,
                  style="Big.TEntry").grid(row=1, column=0, sticky="ew", pady=(2, 10))

        ttk.Label(jira_frame, text="Email", style="Big.TLabel").grid(row=2, column=0, sticky="w")
        self.jira_email_var = tk.StringVar()
        ttk.Entry(jira_frame, textvariable=self.jira_email_var, width=34,
                  style="Big.TEntry").grid(row=3, column=0, sticky="ew", pady=(2, 10))

        ttk.Label(jira_frame, text="API Token", style="Big.TLabel").grid(row=4, column=0, sticky="w")
        self.jira_api_token_var = tk.StringVar()
        # show="•" (a masked password-style entry) -- this is the one field
        # here that's a real secret. The real stored value never round-
        # trips back into a plain Tk widget just to redisplay it; when one
        # is already stored, load() fills this with _STORED_TOKEN_MASK
        # instead (a placeholder, not the real token) purely so the field
        # itself -- not just the status text below -- shows dots at a
        # glance. Clicking into the field clears that placeholder (see
        # _on_jira_token_focus_in) so typing starts from empty, the same
        # as any other "enter a new secret" field.
        self.jira_api_token_entry = ttk.Entry(
            jira_frame, textvariable=self.jira_api_token_var, width=34,
            style="Big.TEntry", show="\u2022")
        self.jira_api_token_entry.grid(row=5, column=0, sticky="ew", pady=(2, 4))
        self.jira_api_token_entry.bind("<FocusIn>", self._on_jira_token_focus_in)
        self.jira_token_status_label = tk.Label(
            jira_frame, text="", fg=theme.TEXT_MUTED, bg=theme.PANEL_BG, justify="left",
            wraplength=320, font=(self.family, 9))
        self.jira_token_status_label.grid(row=6, column=0, sticky="w", pady=(0, 6))

        token_btns = tk.Frame(jira_frame, bg=theme.PANEL_BG)
        token_btns.grid(row=7, column=0, sticky="w", pady=(0, 4))
        get_token_label = tk.Label(token_btns, text="Get an API token", fg=theme.ACCENT,
                                    bg=theme.PANEL_BG, cursor="hand2",
                                    font=(self.family, 9, "underline"))
        get_token_label.pack(side="left")
        get_token_label.bind("<Button-1>", lambda e: webbrowser.open(
            "https://id.atlassian.com/manage-profile/security/api-tokens"))
        # A dedicated save just for this one field -- paste a token and
        # click this without needing the big Save button below (which
        # also touches Display Name/Work Hours/Theme and rebuilds the
        # whole window). See _save_jira_token for what counts as "a real
        # new token was typed" here, same rule the big Save uses.
        RoundedButton(token_btns, text="Save API Token", style="Secondary.TButton",
                      command=self._save_jira_token).pack(side="left")
        RoundedButton(token_btns, text="Clear stored token", style="Secondary.TButton",
                      command=self._clear_jira_token).pack(side="left", padx=(8, 0))

        # Manual Import -- row=5/6/7 (below jira_frame's row=4) so this
        # sits under Jira Cloud Upload rather than colliding with it.
        # The CSV-based fallbacks for anyone who hasn't set up (or
        # doesn't want) a saved API token above: exporting a worklog CSV
        # for Jira's own importer, and the two-step "open a filtered
        # Jira list in the browser, then import the CSV you export from
        # it" way of bulk-adding QDMs. The automatic, no-file-picker
        # versions of both jobs ("Upload to JIRA via API" and "Import QDM
        # via API", both on the tab row) are what most people should
        # reach for day to day -- these three only show up here, not on
        # those main screens, so they don't compete for attention with
        # the one-click option once a token's saved.
        ttk.Label(right, text="Manual Import", style="Heading.TLabel").grid(
            row=5, column=0, sticky="w", pady=(28, 6))
        tk.Label(right, text="CSV-based alternatives that don’t need a Jira API "
                             "token — useful before you’ve set one up above, or if "
                             "you’d rather not.",
                 fg=theme.TEXT_MUTED, bg=theme.PANEL_BG, justify="left", wraplength=360,
                 font=(self.family, 9)).grid(row=6, column=0, sticky="w", pady=(0, 10))

        manual_frame = ttk.Frame(right)
        manual_frame.grid(row=7, column=0, sticky="new")

        if self.on_export_worklog_csv is not None:
            RoundedButton(manual_frame, text="Export to Jira CSV…", style="Secondary.TButton",
                          command=self.on_export_worklog_csv).pack(anchor="w", pady=(0, 8))

        if self.on_export_qdms_from_jira is not None:
            RoundedButton(manual_frame, text="Export QDMs from JIRA", style="Secondary.TButton",
                          command=self.on_export_qdms_from_jira).pack(anchor="w", pady=(0, 8))

        if self.on_import_qdms_from_csv is not None:
            RoundedButton(manual_frame, text="Import QDM’s from JIRA…",
                          style="Secondary.TButton",
                          command=self.on_import_qdms_from_csv).pack(anchor="w")

        # row=10 (not row=2) so this sits below the Jira Cloud Upload/
        # Manual Import sections above rather than colliding with the
        # row=2 heading -- "right"'s own grid, unrelated to the
        # outer/btns row=20 mentioned below.
        tk.Label(right, text=f"QUASAR Timesheet Manager v{APP_VERSION}",
                 font=(self.family, 9), bg=theme.PANEL_BG, fg=theme.TEXT_MUTED).grid(
            row=10, column=0, sticky="w", pady=(20, 0))

        # row=20 (not row=2) so this stays below Keyboard Shortcuts either
        # way -- beside the settings fields at row=1 (the normal, wide-
        # window layout) or stacked below them at row=2 (see
        # _reflow_settings_columns) -- without needing to move this row
        # to match whichever layout is currently active. An unused grid
        # row number doesn't reserve any space, so this doesn't add a gap.
        btns = ttk.Frame(outer)
        btns.grid(row=20, column=0, columnspan=2, sticky="ew", pady=(10, 0))
        RoundedButton(btns, text="Cancel", style="Secondary.TButton", command=self._cancel).pack(side="right")
        RoundedButton(btns, text="Save", style="Accent.TButton", command=self._save).pack(side="right", padx=6)

    def _select_header_style(self, key: str):
        """Click handler for the Standard/Compact/Hidden segmented row --
        same selected/unselected style convention as the tab bar and
        SummaryPanel's Week/Month toggle (Accent for the chosen one,
        Secondary for the rest)."""
        self.header_style_choice = key
        for btn_key, btn in self.header_style_buttons.items():
            btn.config(style="Accent.TButton" if btn_key == key else "Secondary.TButton")

    def _reflow_settings_columns(self, event=None):
        """Bound to outer's <Configure> (plus one after_idle call so a
        Settings tab opened directly at a narrow window size starts
        stacked instead of waiting for the next resize) -- see the long
        comment where self._settings_left/right/outer are set, in
        __init__, for why this exists at all."""
        left = self._settings_left
        right = self._settings_right
        outer = self._settings_outer
        # 36 matches the padx gap __init__ gives `left` in the side-by-
        # side layout -- the actual space that gap needs, so it's part of
        # "how much width do both columns need together".
        needed = left.winfo_reqwidth() + right.winfo_reqwidth() + 36
        available = outer.winfo_width()
        # available <= 1 means outer hasn't been given a real size by its
        # own parent yet (still mid-construction) -- wait for the next
        # <Configure> instead of guessing from a meaningless width.
        if available <= 1:
            return
        should_stack = available < needed
        if should_stack == self._settings_stacked:
            return
        self._settings_stacked = should_stack
        if should_stack:
            # Collapse column 1's weight to 0 too -- otherwise, even with
            # `right` moved out of it, outer's two equal-weight columns
            # would still split the width evenly between them, leaving
            # `left` (now the only thing at row 1) stuck at half-width
            # with an empty gap beside it instead of using the space
            # `right` just vacated.
            outer.columnconfigure(1, weight=0)
            left.grid_configure(padx=0, pady=(0, 24))
            right.grid_configure(row=2, column=0, columnspan=2, pady=(0, 0))
        else:
            outer.columnconfigure(1, weight=1)
            left.grid_configure(padx=(0, 36), pady=0)
            right.grid_configure(row=1, column=1, columnspan=1, pady=0)

    def _build_theme_grid(self):
        # A fixed 4-columns-wide grid of theme preview cards -- "System"
        # first, then the eighteen curated palettes, then a "Custom" card
        # at the end, wrapping to a tidy 4-per-row layout. Built once (not
        # rebuilt on every load()); only the selection ring and
        # description text change after that, via
        # _refresh_theme_selection().
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

    def load(self, display_name: str, current_theme_id: str, work_start_hour: int,
              work_end_hour: int, show_weekends: bool, show_timer_bar: bool, header_style: str,
              jira_site_url: str, jira_email: str,
              on_save: Callable[[str, str, int, int, bool, bool, str, str, str, str], None]):
        self.on_save = on_save
        self.display_name_var.set(display_name)
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
        self.hide_timer_var.set(not show_timer_bar)
        self._select_header_style(header_style if header_style in self.header_style_buttons else "standard")

        self.jira_site_url_var.set(jira_site_url)
        self.jira_email_var.set(jira_email)
        self._refresh_jira_token_field()

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
        new_token = self._resolve_typed_token()
        self.on_save(
            self.display_name_var.get().strip(),
            self.theme_var.get(),
            work_start_hour,
            work_end_hour,
            self.show_weekends_var.get(),
            not self.hide_timer_var.get(),
            self.header_style_choice,
            self.jira_site_url_var.get().strip(),
            self.jira_email_var.get().strip(),
            new_token,  # blank = "keep whatever's already stored"
        )
        self._refresh_jira_token_field()
        show_saved_toast(self)
        self.on_close()

    def _cancel(self):
        # Revert any custom-color edits made this time the panel was open
        # but never saved -- otherwise an abandoned tweak would still show
        # up as "current" the next time Settings is reopened, even though
        # it was never actually applied or persisted.
        if self.custom_seeds != self._custom_seeds_on_load:
            theme.set_custom_seeds(**self._custom_seeds_on_load)
        self._refresh_jira_token_field()
        self.on_close()

    def _on_jira_token_focus_in(self, event=None):
        if self._token_field_is_placeholder:
            self.jira_api_token_var.set("")
            self._token_field_is_placeholder = False

    def _maybe_derive_jira_email(self, event=None):
        """Auto-fills Email from Display Name (e.g. "Alex Rae" ->
        "alex.rae@<company domain>") once someone tabs/clicks away from
        Display Name having typed a two-word name -- so most people never
        have to type their Jira email by hand at all. Deliberately
        conservative about when it kicks in:

        - Only touches Email while it's still blank or still showing the
          unedited "firstname.lastname@..." default template (see
          config.DEFAULT_JIRA_EMAIL_TEMPLATE / _load_settings_panel's
          get_setting fallback in main_window.py). The moment someone has
          typed or saved a real email of their own, this stops touching the
          field for good -- a saved value is never that exact default
          string, so this one check is enough; no separate "has the user
          edited this" flag is needed.
        - Only fires for a Display Name that splits into exactly two
          alphabetic words ("Alex Rae") -- one name, three names, a
          hyphenated or accented name, a nickname in quotes, and so on all
          just leave Email alone rather than guess wrong.

        A wrong guess is still only ever a starting point, never silently
        trusted: the connection test that runs when "Save API Token" is
        clicked (see main_window.py's _verify_jira_connection_and_report)
        is what actually catches a wrong email before it causes a confusing
        failure later, the same way it catches a wrong Site URL or token."""
        current_email = self.jira_email_var.get().strip()
        if current_email and current_email != config.DEFAULT_JIRA_EMAIL_TEMPLATE:
            return
        words = self.display_name_var.get().strip().split()
        if len(words) != 2 or not all(w.isalpha() for w in words):
            return
        first, last = words
        domain = config.DEFAULT_JIRA_EMAIL_TEMPLATE.split("@")[-1]
        self.jira_email_var.set(f"{first.lower()}.{last.lower()}@{domain}")

    def _resolve_typed_token(self) -> str:
        """A left-alone field is either still showing _STORED_TOKEN_MASK
        (never focused) or was cleared by _on_jira_token_focus_in but
        never typed into again -- both mean "no change", same as leaving
        it blank always has. Only a value the person actually typed
        counts as a real new token; used by both the big Save (below) and
        the dedicated "Save API Token" button (_save_jira_token)."""
        raw_token = self.jira_api_token_var.get()
        if self._token_field_is_placeholder or raw_token == _STORED_TOKEN_MASK:
            return ""
        return raw_token

    def _save_jira_token(self):
        new_token = self._resolve_typed_token()
        if not new_token:
            messagebox.showinfo("Nothing to save", "Paste a token into the field first.")
            return
        site_url = self.jira_site_url_var.get().strip()
        email = self.jira_email_var.get().strip()
        if not site_url or not email:
            messagebox.showwarning(
                "Site URL and Email needed",
                "Enter your Jira Site URL and Email above first -- both are needed, "
                "together with the API Token, to connect to Jira and verify it works.")
            return
        # on_save_token reports whether it actually saved -- e.g.
        # main_window.py's _save_jira_api_token returns False (after its
        # own warning dialog) rather than raising, when the machine can't
        # encrypt right now. Skip the "saved" toast in that case; it
        # already told the user what happened. main_window.py also runs an
        # immediate Jira connection test against these same three values and
        # reports the result in its own messagebox, so a new user finds out
        # right here whether the credentials actually work.
        if self.on_save_token(new_token, site_url, email):
            self._refresh_jira_token_field()
            show_saved_toast(self)

    def _clear_jira_token(self):
        if not self.has_stored_token():
            messagebox.showinfo("No token stored", "There's no Jira API token currently stored.")
            return
        if not messagebox.askyesno(
                "Clear stored Jira API token",
                "You'll need to paste it again (or a new one) before \u201cUpload to JIRA "
                "via API\u201d or \u201cImport QDM via API\u201d will work. Continue?"):
            return
        self.on_clear_token()
        self._refresh_jira_token_field()

    def _refresh_jira_token_field(self):
        """Syncs both the API Token entry and the status text underneath
        it to whether a token is actually stored right now -- called
        after load(), save, cancel, and clearing the stored token, so the
        field never shows stale state from before any of those. See
        _STORED_TOKEN_MASK's own comment for why the entry itself (not
        just this status text) reflects "a token is stored"."""
        if self.has_stored_token():
            self.jira_api_token_var.set(_STORED_TOKEN_MASK)
            self._token_field_is_placeholder = True
            self.jira_token_status_label.config(
                text="A token is stored. Click the field and type a new one to replace it, "
                     "or leave it as-is to keep it.")
        else:
            self.jira_api_token_var.set("")
            self._token_field_is_placeholder = False
            self.jira_token_status_label.config(text="No token stored yet.")


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


# ---------------------------------------------------------------------------
# Upload-to-Jira panel (choose date range) -- same date-range picker as
# ExportPanel above, kept as a separate class rather than a shared base
# because the two are already this short and their button labels/actions
# diverge enough (a network call + duplicate-protection summary here vs. a
# plain file save there) that a shared base would mostly be indirection.
# ---------------------------------------------------------------------------
class JiraUploadPanel(tk.Frame):
    def __init__(self, master, family: str, on_close: Callable[[], None]):
        super().__init__(master, bg=theme.PANEL_BG)
        self.family = family
        self.on_close = on_close
        self.on_upload: Optional[Callable[[str, str], None]] = None
        self.week_start: Optional[date] = None

        body = _scroll_body(self)
        outer = tk.Frame(body, bg=theme.PANEL_BG)
        outer.pack(fill="both", expand=True, padx=28, pady=24)

        tk.Label(outer, text="Upload to JIRA via API", font=(self.family, 14, "bold"),
                 bg=theme.PANEL_BG, fg=theme.TEXT_PRIMARY).pack(anchor="w", pady=(0, 6))
        tk.Label(outer, text="Sends worklogs straight to Jira over its API -- no CSV file, "
                             "no manual import. Entries already uploaded before are skipped "
                             "automatically, so this is always safe to re-run.",
                 fg=theme.TEXT_MUTED, bg=theme.PANEL_BG, justify="left", wraplength=420,
                 font=(self.family, 9)).pack(anchor="w", pady=(0, 16))

        frm = ttk.Frame(outer)
        frm.pack(anchor="w")

        ttk.Label(frm, text="Upload range", font=(self.family, 10, "bold")).grid(
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
        RoundedButton(btns, text="Upload…", style="Accent.TButton", command=self._upload).pack(
            side="right", padx=6)

    def load(self, week_start: date, on_upload: Callable[[str, str], None]):
        self.week_start = week_start
        self.on_upload = on_upload
        self.scope_var.set("week")
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

    def _upload(self):
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
        cb = self.on_upload
        self.on_close()
        assert cb is not None
        cb(start, end)

    def _cancel(self):
        self.on_close()
