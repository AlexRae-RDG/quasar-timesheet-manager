import { useMemo, useState } from "react";
import {
  clearJiraToken,
  saveJiraToken,
  saveSettings,
  verifyJiraCredentials,
  type AppSettings,
} from "../api/settings";
import { ThemeSwatch } from "../components/ThemeSwatch";
import { CUSTOM_THEME_ID, DEFAULT_CUSTOM_SEEDS, PRESETS, SYSTEM_THEME_ID } from "../theme/palettes";

const HEADER_STYLES: Array<{ id: AppSettings["headerStyle"]; label: string }> = [
  { id: "standard", label: "Standard" },
  { id: "compact", label: "Compact" },
  { id: "hidden", label: "Hidden" },
];

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => i);

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

  const groupedPresets = useMemo(() => {
    const groups = new Map<string, typeof PRESETS>();
    for (const preset of PRESETS) {
      const list = groups.get(preset.category) ?? [];
      list.push(preset);
      groups.set(preset.category, list);
    }
    return groups;
  }, []);

  const setThemeId = (id: string) => onChange({ themeMode: id });
  const setCustomSeeds = (seeds: AppSettings["customTheme"]) => onChange({ customTheme: seeds });

  async function handleSave() {
    setSaveState("saving");
    try {
      await saveSettings({
        displayName: settings.displayName,
        themeMode: settings.themeMode,
        customTheme: settings.customTheme,
        workStartHour: settings.workStartHour,
        workEndHour: settings.workEndHour,
        showWeekends: settings.showWeekends,
        headerStyle: settings.headerStyle,
        showTimerBar: settings.showTimerBar,
        jiraSiteUrl: settings.jiraSiteUrl,
        jiraEmail: settings.jiraEmail,
      });
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 1500);
    } catch (e) {
      setSaveState("error");
      console.error(e);
    }
  }

  async function handleVerifyAndSaveToken() {
    setJiraVerify({ kind: "verifying" });
    try {
      const displayName = await verifyJiraCredentials(
        settings.jiraSiteUrl,
        settings.jiraEmail,
        jiraTokenInput.trim() ? jiraTokenInput : null,
      );
      if (jiraTokenInput.trim()) {
        await saveJiraToken(jiraTokenInput);
        setJiraTokenInput("");
        onChange({ hasJiraToken: true });
      }
      onChange({ displayName });
      setJiraVerify({ kind: "success", displayName });
    } catch (e) {
      setJiraVerify({ kind: "error", message: String(e) });
    }
  }

  async function handleClearToken() {
    await clearJiraToken();
    onChange({ hasJiraToken: false });
    setJiraVerify({ kind: "idle" });
  }

  return (
    <div className="app-shell">
      <header className="page-header">
        <h1>Settings</h1>
        <button className="btn btn-accent" onClick={handleSave} disabled={saveState === "saving"}>
          {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : "Save Settings"}
        </button>
      </header>

      <section className="card">
        <h2>Profile</h2>
        <label className="field">
          <span>Display Name</span>
          <input
            type="text"
            value={settings.displayName}
            onChange={(e) => onChange({ displayName: e.target.value })}
            placeholder="Your name, as it should appear on exports"
          />
        </label>
      </section>

      <section className="card">
        <h2>Theme</h2>
        <div className="swatch-grid">
          <ThemeSwatch
            themeId={SYSTEM_THEME_ID}
            customSeeds={settings.customTheme}
            selected={settings.themeMode === SYSTEM_THEME_ID}
            onClick={() => setThemeId(SYSTEM_THEME_ID)}
          />
          {[...groupedPresets.entries()].map(([category, presets]) => (
            <div key={category} className="swatch-category">
              {presets.map((preset) => (
                <ThemeSwatch
                  key={preset.id}
                  themeId={preset.id}
                  customSeeds={settings.customTheme}
                  selected={settings.themeMode === preset.id}
                  onClick={() => setThemeId(preset.id)}
                />
              ))}
            </div>
          ))}
          <ThemeSwatch
            themeId={CUSTOM_THEME_ID}
            customSeeds={settings.customTheme}
            selected={settings.themeMode === CUSTOM_THEME_ID}
            onClick={() => setThemeId(CUSTOM_THEME_ID)}
          />
        </div>

        {settings.themeMode === CUSTOM_THEME_ID && (
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
        <h2>Jira Cloud Upload</h2>
        <p className="muted">
          Used to upload time entries directly to Jira, and to import QDMs by search. Your API
          token is stored in this machine's OS keychain -- never in the database, and never shown
          again after you save it.
        </p>
        <label className="field">
          <span>Jira Site URL</span>
          <input
            type="text"
            value={settings.jiraSiteUrl}
            onChange={(e) => onChange({ jiraSiteUrl: e.target.value })}
            placeholder="yourteam.atlassian.net"
          />
        </label>
        <label className="field">
          <span>Jira Account Email</span>
          <input
            type="text"
            value={settings.jiraEmail}
            onChange={(e) => onChange({ jiraEmail: e.target.value })}
            placeholder="firstname.lastname@example.com"
          />
        </label>
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
        <div className="row">
          <button
            type="button"
            className="btn btn-accent"
            onClick={handleVerifyAndSaveToken}
            disabled={jiraVerify.kind === "verifying"}
          >
            {jiraVerify.kind === "verifying" ? "Verifying…" : "Save & Verify"}
          </button>
          {settings.hasJiraToken && (
            <button type="button" className="btn btn-danger" onClick={handleClearToken}>
              Clear stored token
            </button>
          )}
        </div>
        {jiraVerify.kind === "success" && (
          <p className="status status-success">Connected to Jira as {jiraVerify.displayName}.</p>
        )}
        {jiraVerify.kind === "error" && <p className="status status-error">{jiraVerify.message}</p>}
      </section>

      {saveState === "error" && (
        <p className="status status-error">Couldn't save settings -- see the console for details.</p>
      )}
    </div>
  );
}
