"""
Embedded (non-popup) Time Block editor.

This used to be a separate pop-up window (a tk.Toplevel). On some macOS/Tk
combinations, pop-up windows can ignore explicit on-screen positioning
entirely and open wherever the window manager feels like -- no amount of
centering code fixes that, because the OS repositions the window after Tk
already placed it. The only fully reliable fix is to not open a separate
window at all: this panel lives inside the main window itself, shown as a
second tab ("Time Block") that appears next to the "Timesheet" tab only
while a block is being added or edited, and disappears again afterwards.
"""
import tkinter as tk
from tkinter import ttk
from typing import Callable, List, Optional

from . import theme
from .models import Activity
from .widgets import RoundedButton, ScrollArea


class TimeBlockPanel(tk.Frame):
    def __init__(self, master, family: str, on_close: Callable[[], None]):
        super().__init__(master, bg=theme.PANEL_BG)
        self.family = family
        self.on_close = on_close
        self.on_save: Optional[Callable[[dict], bool]] = None
        self.on_delete: Optional[Callable[[], None]] = None
        self.activities: List[Activity] = []
        self.activities_by_id = {}
        self.day_labels: List[str] = []
        self.day_key_by_label = {}
        self.day_label_by_key = {}
        self.time_options: List[str] = []

        # Wrapped in a borderless ScrollArea (see panels._scroll_body's
        # docstring for the same rationale) so this panel's Save/Cancel/
        # Delete row is always reachable even on a shorter window.
        self._scroll = ScrollArea(self, bg=theme.PANEL_BG, outline=False, pad=0)
        self._scroll.pack(fill="both", expand=True)
        outer = tk.Frame(self._scroll.content, bg=theme.PANEL_BG)
        outer.pack(fill="both", expand=True, padx=28, pady=24)

        self.heading = tk.Label(outer, text="Time Block", font=(self.family, 14, "bold"),
                                 bg=theme.PANEL_BG, fg=theme.TEXT_PRIMARY)
        self.heading.pack(anchor="w", pady=(0, 16))

        frm = ttk.Frame(outer)
        frm.pack(anchor="w")

        row = 0
        ttk.Label(frm, text="Activity").grid(row=row, column=0, sticky="w", pady=4)
        self.activity_var = tk.StringVar()
        self.activity_combo = ttk.Combobox(frm, textvariable=self.activity_var,
                                            state="readonly", width=30)
        self.activity_combo.grid(row=row, column=1, columnspan=2, sticky="ew", pady=4)
        self.activity_combo.bind("<<ComboboxSelected>>", self._on_activity_changed)
        row += 1

        ttk.Label(frm, text="Jira Issue Key").grid(row=row, column=0, sticky="w", pady=4)
        self.jira_key_var = tk.StringVar()
        ttk.Entry(frm, textvariable=self.jira_key_var, width=32).grid(
            row=row, column=1, columnspan=2, sticky="ew", pady=4)
        row += 1

        # Labeled "Jira Project" (not "Project" or "Activity") so it isn't
        # confused with the Activity chosen above -- this is specifically
        # the Jira project this block's CSV export row goes under (e.g.
        # "Quasar Delivery Management"), almost always the same for
        # everything.
        ttk.Label(frm, text="Jira Project").grid(row=row, column=0, sticky="w", pady=4)
        self.jira_project_var = tk.StringVar()
        ttk.Entry(frm, textvariable=self.jira_project_var, width=32).grid(
            row=row, column=1, columnspan=2, sticky="ew", pady=4)
        row += 1

        ttk.Label(frm, text="Issue Type").grid(row=row, column=0, sticky="w", pady=4)
        self.issue_type_var = tk.StringVar()
        ttk.Entry(frm, textvariable=self.issue_type_var, width=32).grid(
            row=row, column=1, columnspan=2, sticky="ew", pady=4)
        row += 1

        ttk.Label(frm, text="Day").grid(row=row, column=0, sticky="w", pady=4)
        self.day_var = tk.StringVar()
        self.day_combo = ttk.Combobox(frm, textvariable=self.day_var, state="readonly", width=30)
        self.day_combo.grid(row=row, column=1, columnspan=2, sticky="ew", pady=4)
        row += 1

        ttk.Label(frm, text="Start / End").grid(row=row, column=0, sticky="w", pady=4)
        time_row = ttk.Frame(frm)
        time_row.grid(row=row, column=1, columnspan=2, sticky="w", pady=4)
        self.start_var = tk.StringVar()
        self.start_combo = ttk.Combobox(time_row, textvariable=self.start_var,
                                         state="readonly", width=9)
        self.start_combo.pack(side="left")
        ttk.Label(time_row, text="  to  ").pack(side="left")
        self.end_var = tk.StringVar()
        self.end_combo = ttk.Combobox(time_row, textvariable=self.end_var,
                                       state="readonly", width=9)
        self.end_combo.pack(side="left")
        row += 1

        ttk.Label(frm, text="Notes").grid(row=row, column=0, sticky="nw", pady=4)
        self.notes_text = tk.Text(frm, width=34, height=5, font=(self.family, 10),
                                   relief="flat", highlightthickness=1,
                                   highlightbackground=theme.BORDER_STRONG, highlightcolor=theme.ACCENT,
                                   bg=theme.FIELD_BG, fg=theme.TEXT_PRIMARY,
                                   insertbackground=theme.TEXT_PRIMARY,
                                   padx=6, pady=4)
        self.notes_text.grid(row=row, column=1, columnspan=2, sticky="ew", pady=4)
        row += 1

        self.error_label = ttk.Label(frm, text="", foreground=theme.DANGER)
        self.error_label.grid(row=row, column=0, columnspan=3, sticky="w")
        row += 1

        # Rebuilt on every load() so the Delete button only appears when
        # editing an existing block, not when creating a new one.
        self.btns = ttk.Frame(frm)
        self.btns.grid(row=row, column=0, columnspan=3, sticky="ew", pady=(16, 0))

    # ------------------------------------------------------------------
    def _on_activity_changed(self, _event=None):
        name = self.activity_var.get()
        for a in self.activities:
            if a.name == name:
                self.jira_key_var.set(a.jira_key or "")
                self.jira_project_var.set(a.jira_project or "")
                self.issue_type_var.set(a.issue_type or "")
                break

    def _selected_activity(self) -> Optional[Activity]:
        name = self.activity_var.get()
        for a in self.activities:
            if a.name == name:
                return a
        return None

    # ------------------------------------------------------------------
    def load(self, activities: List[Activity], day_options,
              initial_day_idx: Optional[int], initial_start: Optional[str],
              initial_end: Optional[str], initial_activity_id: Optional[int],
              initial_notes: str, on_save: Callable[[dict], bool],
              on_delete: Optional[Callable[[], None]], start_hour: int, end_hour: int,
              slot_minutes: int, initial_jira_project: str = "", initial_issue_type: str = "",
              is_new: bool = True):
        self.activities = activities
        self.activities_by_id = {a.id: a for a in activities}
        self.on_save = on_save
        self.on_delete = on_delete

        self.heading.config(text="New Time Block" if is_new else "Edit Time Block")

        self.day_labels = [label for label, _key in day_options]
        self.day_key_by_label = {label: key for label, key in day_options}
        self.day_label_by_key = {key: label for label, key in day_options}
        self.day_combo.config(values=self.day_labels)

        activity_names = [a.name for a in activities] or ["(no activities yet)"]
        self.activity_combo.config(values=activity_names)

        self.time_options = []
        t = start_hour * 60
        end_total = end_hour * 60
        while t <= end_total:
            self.time_options.append(f"{t // 60:02d}:{t % 60:02d}")
            t += slot_minutes
        self.start_combo.config(values=self.time_options)
        self.end_combo.config(values=self.time_options)

        self.error_label.config(text="")
        self.notes_text.delete("1.0", "end")

        self.activity_var.set("")
        self.activity_combo.set("")
        self.jira_key_var.set("")
        if initial_activity_id is not None and initial_activity_id in self.activities_by_id:
            act = self.activities_by_id[initial_activity_id]
            self.activity_var.set(act.name)
            self.activity_combo.set(act.name)
            self.jira_key_var.set(act.jira_key or "")

        self.jira_project_var.set(initial_jira_project or "")
        self.issue_type_var.set(initial_issue_type or "")

        default_day = self.day_labels[0] if self.day_labels else ""
        day_label = self.day_label_by_key.get(initial_day_idx, default_day)
        self.day_var.set(day_label)
        self.day_combo.set(day_label)

        start_value = initial_start or (self.time_options[0] if self.time_options else "")
        end_value = initial_end or (
            self.time_options[min(2, len(self.time_options) - 1)] if self.time_options else "")
        self.start_var.set(start_value)
        self.start_combo.set(start_value)
        self.end_var.set(end_value)
        self.end_combo.set(end_value)

        if initial_notes:
            self.notes_text.insert("1.0", initial_notes)

        for child in self.btns.winfo_children():
            child.destroy()
        if on_delete:
            RoundedButton(self.btns, text="Delete", style="Danger.TButton",
                          command=self._delete).pack(side="left")
        RoundedButton(self.btns, text="Cancel", style="Secondary.TButton",
                      command=self._cancel).pack(side="right")
        RoundedButton(self.btns, text="Save", style="Accent.TButton",
                      command=self._save).pack(side="right", padx=6)
        self._scroll.bind_wheel_recursive(self.btns)

        self.activity_combo.focus_set()

    # ------------------------------------------------------------------
    def _save(self):
        act = self._selected_activity()
        if act is None:
            self.error_label.config(text="Please choose an activity.")
            return
        start = self.start_var.get()
        end = self.end_var.get()
        if start >= end:
            self.error_label.config(text="End time must be after start time.")
            return

        result = {
            "activity_id": act.id,
            "activity_name": act.name,
            "jira_key": (self.jira_key_var.get() or "").strip() or None,
            "color": act.color,
            "day_idx": self.day_key_by_label[self.day_var.get()],
            "start_time": start,
            "end_time": end,
            "notes": self.notes_text.get("1.0", "end").strip(),
            "jira_project": (self.jira_project_var.get() or "").strip() or None,
            "issue_type": (self.issue_type_var.get() or "").strip() or None,
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
