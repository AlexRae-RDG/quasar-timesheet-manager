"""
Embedded (non-popup) first-run setup panel.

Shown once, automatically, the very first time the app is opened with
nothing saved yet (see main_window.MainWindow.__init__'s onboarding-
completed detection). Same "tab instead of a pop-up" pattern as every
other panel in this app -- see app/panels.py's own module docstring for
why: pop-up windows can get mis-positioned by the OS on some macOS/Tk
setups, so this lives inside the main window as a tab instead, shown
automatically on first launch and hidden again once it's done.

Four fields, all visible up front rather than tucked behind an
"Advanced" disclosure -- Site URL and Email both come pre-filled with a
sensible guess (Site URL from config.DEFAULT_JIRA_SITE_URL, Email
guessed from the name you type, same "firstname.lastname@..." pattern
as config.DEFAULT_JIRA_EMAIL_TEMPLATE), but stay right there to check
or correct rather than requiring an extra click to even find them.
"""
import tkinter as tk
import webbrowser
from tkinter import ttk
from typing import Callable, Tuple

from . import theme
from .widgets import RoundedButton, ScrollArea


class OnboardingPanel(tk.Frame):
    def __init__(self, master, family: str, default_site_url: str, email_domain: str,
                 on_complete: Callable[[str, str, str, str], Tuple[bool, bool, str]],
                 on_skip: Callable[[], None]):
        super().__init__(master, bg=theme.PANEL_BG)
        self.family = family
        self.default_site_url = default_site_url
        self.email_domain = email_domain
        self.on_complete = on_complete
        self.on_skip = on_skip
        # Becomes True the moment someone types into Email directly -- same
        # "stop guessing once it's real" rule panels.SettingsPanel's own
        # _maybe_derive_jira_email uses for the same field.
        self._email_edited_by_user = False

        # Wrapped in a borderless ScrollArea (see panels._scroll_body's
        # docstring for the same rationale) so the buttons at the bottom
        # are always reachable even on a shorter window.
        self._scroll = ScrollArea(self, bg=theme.PANEL_BG, outline=False, pad=0)
        self._scroll.pack(fill="both", expand=True)
        outer = tk.Frame(self._scroll.content, bg=theme.PANEL_BG)
        outer.pack(fill="both", expand=True, padx=40, pady=32)

        tk.Label(outer, text="Welcome to QUASAR Timesheet Manager",
                 font=(self.family, 18, "bold"), bg=theme.PANEL_BG,
                 fg=theme.TEXT_PRIMARY).pack(anchor="w", pady=(0, 6))
        tk.Label(outer, text="A few quick things, then you're straight into importing your QDMs.",
                 font=(self.family, 11), bg=theme.PANEL_BG, fg=theme.TEXT_SECONDARY,
                 justify="left", wraplength=460).pack(anchor="w", pady=(0, 28))

        # ---- Step 1: name, email, site url -----------------------------
        ttk.Label(outer, text="1. Your Jira details", style="Heading.TLabel").pack(
            anchor="w", pady=(0, 4))
        tk.Label(outer, text="Your name is used as your Jira display name on exported "
                             "worklogs, and guesses your Jira email below -- check both "
                             "before continuing.",
                 font=(self.family, 9), bg=theme.PANEL_BG, fg=theme.TEXT_MUTED,
                 justify="left", wraplength=460).pack(anchor="w", pady=(0, 8))

        ttk.Label(outer, text="Name", style="Big.TLabel").pack(anchor="w", pady=(0, 2))
        self.name_var = tk.StringVar()
        name_entry = ttk.Entry(outer, textvariable=self.name_var, width=36, style="Big.TEntry")
        name_entry.pack(anchor="w", pady=(0, 10))
        name_entry.bind("<FocusOut>", self._derive_email)
        name_entry.bind("<KeyRelease>", self._derive_email)
        name_entry.focus_set()

        ttk.Label(outer, text="Email", style="Big.TLabel").pack(anchor="w", pady=(0, 2))
        self.email_var = tk.StringVar()
        email_entry = ttk.Entry(outer, textvariable=self.email_var, width=36, style="Big.TEntry")
        email_entry.pack(anchor="w", pady=(0, 10))
        email_entry.bind("<Key>", lambda e: setattr(self, "_email_edited_by_user", True))

        ttk.Label(outer, text="Site URL", style="Big.TLabel").pack(anchor="w", pady=(0, 2))
        tk.Label(outer, text="Pre-filled with the shared company Jira instance -- only "
                             "change this if you're on a different one.",
                 font=(self.family, 9), bg=theme.PANEL_BG, fg=theme.TEXT_MUTED,
                 justify="left", wraplength=460).pack(anchor="w", pady=(0, 2))
        self.site_url_var = tk.StringVar(value=self.default_site_url)
        ttk.Entry(outer, textvariable=self.site_url_var, width=36, style="Big.TEntry").pack(
            anchor="w", pady=(0, 4))

        # ---- Step 2: token ----------------------------------------------
        ttk.Label(outer, text="2. A Jira API Token", style="Heading.TLabel").pack(
            anchor="w", pady=(24, 4))
        tk.Label(outer, text="Lets the app read and upload your timesheet directly -- takes "
                             "about 30 seconds to create.",
                 font=(self.family, 9), bg=theme.PANEL_BG, fg=theme.TEXT_MUTED,
                 justify="left", wraplength=460).pack(anchor="w", pady=(0, 8))
        get_token_label = tk.Label(outer, text="Get an API token →", fg=theme.ACCENT,
                                    bg=theme.PANEL_BG, cursor="hand2",
                                    font=(self.family, 10, "underline"))
        get_token_label.pack(anchor="w", pady=(0, 8))
        get_token_label.bind("<Button-1>", lambda e: webbrowser.open(
            "https://id.atlassian.com/manage-profile/security/api-tokens"))
        self.token_var = tk.StringVar()
        token_entry = ttk.Entry(outer, textvariable=self.token_var, width=36,
                                 style="Big.TEntry", show="•")
        token_entry.pack(anchor="w", pady=(0, 4))
        token_entry.bind("<Return>", lambda e: self._submit())

        # ---- status + buttons ---------------------------------------------
        self.status_label = tk.Label(outer, text="", font=(self.family, 9), bg=theme.PANEL_BG,
                                      fg=theme.TEXT_MUTED, justify="left", wraplength=460)
        self.status_label.pack(anchor="w", pady=(20, 10))

        btn_row = tk.Frame(outer, bg=theme.PANEL_BG)
        btn_row.pack(anchor="w")
        RoundedButton(btn_row, text="Connect and import my QDMs", style="Accent.TButton",
                      command=self._submit).pack(side="left")
        RoundedButton(btn_row, text="Skip for now", style="Secondary.TButton",
                      command=self._skip).pack(side="left", padx=(8, 0))

    def _derive_email(self, event=None):
        # Same guard as panels.SettingsPanel._maybe_derive_jira_email:
        # only ever fill in a guess, never overwrite something the person
        # actually typed themselves.
        if self._email_edited_by_user and self.email_var.get().strip():
            return
        words = self.name_var.get().strip().split()
        if len(words) != 2 or not all(w.isalpha() for w in words):
            return
        first, last = words
        self.email_var.set(f"{first.lower()}.{last.lower()}@{self.email_domain}")

    def _set_status(self, text: str, is_error: bool = False):
        self.status_label.config(text=text, fg=theme.DANGER if is_error else theme.TEXT_MUTED)

    def _submit(self):
        name = self.name_var.get().strip()
        token = self.token_var.get().strip()
        if not name:
            self._set_status("Enter your name first.", is_error=True)
            return
        if not token:
            self._set_status("Paste your API token first.", is_error=True)
            return
        self._derive_email()
        site_url = self.site_url_var.get().strip() or self.default_site_url
        email = self.email_var.get().strip()
        if not email:
            self._set_status("Enter your Jira email address.", is_error=True)
            return
        self._set_status("Connecting to Jira…")
        self.update_idletasks()
        # on_complete (main_window._on_onboarding_complete) does the actual
        # saving/verifying and, on full success, tears this tab down and
        # jumps straight into "Import QDM via API" itself -- there's
        # nothing left for this panel to do in that case.
        saved, verified, message = self.on_complete(name, site_url, email, token)
        if saved and verified:
            return
        self._set_status(message, is_error=True)

    def _skip(self):
        self.on_skip()
