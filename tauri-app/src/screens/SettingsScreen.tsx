import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  clearJiraToken,
  computeDefaultEmail,
  DEPARTMENTS,
  JIRA_API_TOKEN_URL,
  projectKeyForDepartment,
  saveJiraToken,
  saveSettings,
  verifyJiraCredentials,
  type AppSettings,
} from "../api/settings";
import { ThemeSwatch } from "../components/ThemeSwatch";
import { useStickyHeader } from "../lib/useStickyHeader";
import { APP_VERSION } from "../version";
import {
  CUSTOM_THEME_ID,
  DARK_THEME_ID,
  DEFAULT_CUSTOM_SEEDS,
  GLASSY_THEME_ID,
  LIGHT_THEME_ID,
  resolveThemeId,
} from "../theme/palettes";

const HEADER_STYLES: Array<{ id: AppSettings["headerStyle"]; label: string }> = [
  { id: "standard", label: "Standard" },
  { id: "compact", label: "Compact" },
  { id: "hidden", label: "Hidden" },
];

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => i);

const SHORTCUTS: Array<{ keys: string; description: string }> = [
  { keys: "Click + drag", description: "Create a time block (or move/resize an existing one)" },
  { keys: "Ctrl / Cmd + click a block", description: "Duplicate that block" },
  { keys: "Shift + click a block", description: "Duplicate that block and open it for editing" },
  { keys: "Double-click a block", description: "Edit its Activity and notes" },
  { keys: "Delete / Backspace", description: "Delete the selected block" },
  { keys: "Escape", description: "Deselect, disarm the current Activity, or close a dialog" },
  { keys: "Right-click", description: "Disarm the current Activity" },
  { keys: "Arrow keys", description: "Nudge the selected block (Timesheet only)" },
  { keys: "Ctrl / Cmd + Z", description: "Undo (Timesheet only)" },
  { keys: "Ctrl / Cmd + Shift + Z (or + Y)", description: "Redo (Timesheet only)" },
  { keys: "Enter in a text field", description: "Save the dialog" },
  { keys: "Shift + Enter in Notes", description: "Insert a newline instead of saving" },
];

type SaveState = "idle" | "saving" | "saved" | "error";
type JiraVerifyState =
  | { kind: "idle" }
  | { kind: "verifying" }
  | { kind: "success"; displayName: string }
  | { kind: "error"; message: string };

export function SettingsScreen({
  settings,
  onChange,
}: {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
}) {
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [jiraTokenInput, setJiraTokenInput] = useState("");
  const [jiraVerify, setJiraVerify] = useState<JiraVerifyState>({ kind: "idle" });
  const teamKey = projectKeyForDepartment(settings.department);
  const headerRef = useStickyHeader<HTMLElement>();

  const resolvedThemeId = resolveThemeId(settings.themeMode);

  const setThemeId = (id: string) => onChange({ themeMode: id });
  const setCustomSeeds = (seeds: AppSettings["customTheme"]) => onChange({ customTheme: seeds });

  // Sends the mandatory form + guided tour back through as if this were a
  // Keeps Email auto-filled as firstname.lastname@raildeliverygroup.com
  // while it's still in sync with the current name -- the moment someone
  // types their own value into Email directly, it stops following further
  // name edits (see the field's own onChange below).
  function handleNameChange(patch: { firstName?: string; lastName?: string }) {
    const nextFirst = patch.firstName ?? settings.firstName;
    const nextLast = patch.lastName ?? settings.lastName;
    const wasAutoEmail =
      settings.email === "" || settings.email === computeDefaultEmail(settings.firstName, settings.lastName);
    onChange(wasAutoEmail ? { ...patch, email: computeDefaultEmail(nextFirst, nextLast) } : patch);
  }

  // One button does both jobs now -- profile/theme/etc. always save, and if
  // there's text in API Token it's also verified and stored in the same
  // click. These used to be two separate buttons (a "Save & Verify" lower
  // down, under the general "Save Settings" at the top); merging Jira into
  // the Profile card made that second button easy to miss entirely, so
  // someone could type a token, click the big "Save Settings" up top, and
  // walk away thinking they were connected when the token was never
  // actually verified or written to the keychain.
  async function handleSave() {
    setSaveState("saving");
    try {
      await saveSettings({
        displayName: `${settings.firstName} ${settings.lastName}`.trim(),
        firstName: settings.firstName,
        lastName: settings.lastName,
        email: settings.email,
        department: settings.department,
        themeMode: settings.themeMode,
        customTheme: settings.customTheme,
        workStartHour: settings.workStartHour,
        workEndHour: settings.workEndHour,
        showWeekends: settings.showWeekends,
        headerStyle: settings.headerStyle,
        showTimerBar: settings.showTimerBar,
        jiraSiteUrl: settings.jiraSiteUrl,
        jiraEmail: settings.email,
        outlookIcsUrl: settings.outlookIcsUrl,
      });

      if (jiraTokenInput.trim()) {
        setJiraVerify({ kind: "verifying" });
        try {
          const displayName = await verifyJiraCredentials(settings.jiraSiteUrl, settings.email, jiraTokenInput);
          await saveJiraToken(jiraTokenInput);
          setJiraTokenInput("");
          onChange({ hasJiraToken: true });
          setJiraVerify({ kind: "success", displayName });
        } catch (e) {
          setJiraVerify({ kind: "error", message: String(e) });
        }
      }

      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 1500);
    } catch (e) {
      setSaveState("error");
      console.error(e);
    }
  }

  async function handleClearToken() {
    await clearJiraToken();
    onChange({ hasJiraToken: false });
    setJiraVerify({ kind: "idle" });
  }

  return (
    <div className="app-shell">
      <header ref={headerRef} className="page-header page-header-sticky">
        <h1>Settings</h1>
        <button className="btn btn-accent" onClick={handleSave} disabled={saveState === "saving"}>
          {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : "Save Settings"}
        </button>
      </header>

      <section className="card">
        <h2>Profile</h2>
        <div className="row">
          <label className="field field-inline">
            <span>First Name</span>
            <input
              type="text"
              value={settings.firstName}
              onChange={(e) => handleNameChange({ firstName: e.target.value })}
              placeholder="First name"
            />
          </label>
          <label className="field field-inline">
            <span>Last Name</span>
            <input
              type="text"
              value={settings.lastName}
              onChange={(e) => handleNameChange({ lastName: e.target.value })}
              placeholder="Last name"
            />
          </label>
        </div>
        <label className="field">
          <span>Email</span>
          <input
            type="text"
            value={settings.email}
            onChange={(e) => onChange({ email: e.target.value })}
            placeholder="firstname.lastname@example.com"
          />
        </label>
        <label className="field">
          <span>Department</span>
          <div className="segmented">
            {DEPARTMENTS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={"segment" + (settings.department === opt.id ? " segment-active" : "")}
                onClick={() => onChange({ department: opt.id })}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </label>

        <div className="card-subsection">
          <div className="card-subsection-header">
            <h2>Jira Cloud Upload</h2>
            <span className={"jira-status" + (settings.hasJiraToken ? " jira-status-connected" : "")}>
              {settings.hasJiraToken ? "● Connected" : "○ Not connected"}
            </span>
          </div>
          <p className="muted">
            Used to upload time entries directly to Jira, and to import {teamKey}s by search. Your
            account email above doubles as your Jira account email. Paste a token below, then hit{" "}
            <strong>Save Settings</strong> above to verify and store it -- your API token is kept
            in this machine's OS keychain, never in the database, and never shown again once
            saved.
          </p>
          <label className="field">
            <span>API Token</span>
            <input
              type="password"
              value={jiraTokenInput}
              onChange={(e) => setJiraTokenInput(e.target.value)}
              placeholder={
                settings.hasJiraToken ? "•••••••• (saved -- enter a new token to replace)" : "Paste your Jira API token"
              }
            />
          </label>
          <button type="button" className="link-button" onClick={() => openUrl(JIRA_API_TOKEN_URL)}>
            Get an API token from Atlassian ↗
          </button>
          {settings.hasJiraToken && (
            <div className="row">
              <button type="button" className="btn btn-danger" onClick={handleClearToken}>
                Clear stored token
              </button>
            </div>
          )}
          {jiraVerify.kind === "verifying" && <p className="muted">Verifying…</p>}
          {jiraVerify.kind === "success" && (
            <p className="status status-success">Connected to Jira as {jiraVerify.displayName}.</p>
          )}
          {jiraVerify.kind === "error" && <p className="status status-error">{jiraVerify.message}</p>}
        </div>
      </section>

      <section className="card">
        <h2>Outlook Calendar Import</h2>
        <p className="muted">
          Paste your shared calendar's published link so <strong>Import from Outlook</strong> on the
          Timesheet can fetch it straight away. In Outlook: Calendar settings → Shared calendars →
          Publish a calendar → copy the ICS link.
        </p>
        <label className="field">
          <span>Calendar link (.ics)</span>
          <input
            type="text"
            value={settings.outlookIcsUrl}
            onChange={(e) => onChange({ outlookIcsUrl: e.target.value })}
            placeholder="https://outlook.office.com/owa/calendar/.../calendar.ics"
          />
        </label>
      </section>

      <section className="card" data-tour="settings-theme">
        <h2>Theme</h2>
        <div className="swatch-grid">
          <ThemeSwatch
            themeId={LIGHT_THEME_ID}
            customSeeds={settings.customTheme}
            selected={resolvedThemeId === LIGHT_THEME_ID}
            onClick={() => setThemeId(LIGHT_THEME_ID)}
          />
          <ThemeSwatch
            themeId={DARK_THEME_ID}
            customSeeds={settings.customTheme}
            selected={resolvedThemeId === DARK_THEME_ID}
            onClick={() => setThemeId(DARK_THEME_ID)}
          />
          <ThemeSwatch
            themeId={GLASSY_THEME_ID}
            customSeeds={settings.customTheme}
            selected={resolvedThemeId === GLASSY_THEME_ID}
            onClick={() => setThemeId(GLASSY_THEME_ID)}
          />
          <ThemeSwatch
            themeId={CUSTOM_THEME_ID}
            customSeeds={settings.customTheme}
            selected={resolvedThemeId === CUSTOM_THEME_ID}
            onClick={() => setThemeId(CUSTOM_THEME_ID)}
          />
        </div>

        {resolvedThemeId === CUSTOM_THEME_ID && (
          <div className="custom-colors">
            {(
              [
                ["appBg", "Background"],
                ["panelBg", "Panel"],
                ["textPrimary", "Text"],
                ["accent", "Accent"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="field field-color">
                <span>{label}</span>
                <input
                  type="color"
                  value={settings.customTheme[key]}
                  onChange={(e) =>
                    setCustomSeeds({ ...settings.customTheme, [key]: e.target.value.toUpperCase() })
                  }
                />
              </label>
            ))}
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setCustomSeeds(DEFAULT_CUSTOM_SEEDS)}
            >
              Reset to default
            </button>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Work Hours</h2>
        <div className="row">
          <label className="field field-inline">
            <span>Start</span>
            <select
              value={settings.workStartHour}
              onChange={(e) => onChange({ workStartHour: Number(e.target.value) })}
            >
              {HOUR_OPTIONS.map((h) => (
                <option key={h} value={h}>
                  {h.toString().padStart(2, "0")}:00
                </option>
              ))}
            </select>
          </label>
          <label className="field field-inline">
            <span>End</span>
            <select
              value={settings.workEndHour}
              onChange={(e) => onChange({ workEndHour: Number(e.target.value) })}
            >
              {HOUR_OPTIONS.map((h) => (
                <option key={h} value={h}>
                  {h.toString().padStart(2, "0")}:00
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field field-checkbox">
          <input
            type="checkbox"
            checked={settings.showWeekends}
            onChange={(e) => onChange({ showWeekends: e.target.checked })}
          />
          <span>Show weekends on the calendar</span>
        </label>
        <label className="field field-checkbox">
          <input
            type="checkbox"
            checked={settings.showTimerBar}
            onChange={(e) => onChange({ showTimerBar: e.target.checked })}
          />
          <span>Show the timer bar</span>
        </label>
      </section>

      <section className="card">
        <h2>Header Style</h2>
        <div className="segmented">
          {HEADER_STYLES.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className={"segment" + (settings.headerStyle === opt.id ? " segment-active" : "")}
              onClick={() => onChange({ headerStyle: opt.id })}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>Keyboard Shortcuts</h2>
        <ul className="shortcut-list">
          {SHORTCUTS.map((s) => (
            <li key={s.keys} className="shortcut-row">
              <span className="shortcut-keys">{s.keys}</span>
              <span className="muted">{s.description}</span>
            </li>
          ))}
        </ul>
      </section>

      {saveState === "error" && (
        <p className="status status-error">Couldn't save settings -- see the console for details.</p>
      )}

      <p className="muted settings-version">QUASAR Timesheet Manager v{APP_VERSION}</p>
    </div>
  );
}
