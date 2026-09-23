import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  computeDefaultEmail,
  DEPARTMENTS,
  JIRA_API_TOKEN_URL,
  projectKeyForDepartment,
  saveJiraToken,
  saveSettings,
  verifyJiraCredentials,
  type AppSettings,
} from "../api/settings";
import { createOutlookCalendar } from "../api/outlookCalendars";

type JiraVerifyState =
  | { kind: "idle" }
  | { kind: "verifying" }
  | { kind: "success"; displayName: string }
  | { kind: "error"; message: string };

/** Blocking, mandatory first-run form -- required fields must be filled and
 * the Jira connection verified before Continue is enabled. Everything here
 * remains editable later from Settings; this just makes sure it gets
 * filled in at all once, for every user (including existing installs
 * upgrading into onboarding for the first time -- see settings.rs's
 * onboarding_completed default). */
export function OnboardingForm({
  settings,
  onChange,
  onSubmit,
}: {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
  onSubmit: () => void;
}) {
  const [jiraTokenInput, setJiraTokenInput] = useState("");
  const [jiraVerify, setJiraVerify] = useState<JiraVerifyState>({ kind: "idle" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Settings can now hold several calendars (see Settings' own "Outlook
  // Calendars" card) -- onboarding just offers a quick single one to get
  // started with, kept as local state (not settings.outlookIcsUrl, which no
  // longer exists) and turned into a real outlook_calendars row on Continue.
  const [outlookIcsUrl, setOutlookIcsUrl] = useState("");
  const teamKey = projectKeyForDepartment(settings.department);

  const jiraSatisfied = settings.hasJiraToken || jiraVerify.kind === "success";
  const canContinue =
    settings.firstName.trim() !== "" &&
    settings.lastName.trim() !== "" &&
    settings.email.trim().includes("@") &&
    settings.department !== "" &&
    settings.jiraSiteUrl.trim() !== "" &&
    jiraSatisfied;

  // Same "auto-fill until the user diverges" behavior as Settings' Profile
  // section -- see api/settings.ts's computeDefaultEmail.
  function handleNameChange(patch: { firstName?: string; lastName?: string }) {
    const nextFirst = patch.firstName ?? settings.firstName;
    const nextLast = patch.lastName ?? settings.lastName;
    const wasAutoEmail =
      settings.email === "" || settings.email === computeDefaultEmail(settings.firstName, settings.lastName);
    onChange(wasAutoEmail ? { ...patch, email: computeDefaultEmail(nextFirst, nextLast) } : patch);
  }

  async function handleVerify() {
    setJiraVerify({ kind: "verifying" });
    try {
      const displayName = await verifyJiraCredentials(
        settings.jiraSiteUrl,
        settings.email,
        jiraTokenInput.trim() ? jiraTokenInput : null,
      );
      if (jiraTokenInput.trim()) {
        await saveJiraToken(jiraTokenInput);
        setJiraTokenInput("");
        onChange({ hasJiraToken: true, jiraEmail: settings.email });
      }
      setJiraVerify({ kind: "success", displayName });
    } catch (e) {
      setJiraVerify({ kind: "error", message: String(e) });
    }
  }

  async function handleContinue() {
    if (!canContinue) return;
    setSubmitting(true);
    setError(null);
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
        sidebarWidth: settings.sidebarWidth,
      });
      if (outlookIcsUrl.trim()) {
        await createOutlookCalendar({ label: "Outlook Calendar", icsUrl: outlookIcsUrl.trim() });
      }
      onSubmit();
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="onboarding-backdrop">
      <div className="onboarding-card card">
        <h1 className="onboarding-title">Welcome to QUASAR Timesheet Manager</h1>
        <p className="muted">
          Let's get your account set up -- this only takes a minute, and everything here stays
          editable later from Settings.
        </p>

        <div className="card-subsection">
          <h2>Your Details</h2>
          <div className="row">
            <label className="field field-inline">
              <span>First Name *</span>
              <input
                type="text"
                value={settings.firstName}
                onChange={(e) => handleNameChange({ firstName: e.target.value })}
                placeholder="First name"
              />
            </label>
            <label className="field field-inline">
              <span>Last Name *</span>
              <input
                type="text"
                value={settings.lastName}
                onChange={(e) => handleNameChange({ lastName: e.target.value })}
                placeholder="Last name"
              />
            </label>
          </div>
          <label className="field">
            <span>Email *</span>
            <input
              type="text"
              value={settings.email}
              onChange={(e) => onChange({ email: e.target.value })}
              placeholder="firstname.lastname@example.com"
            />
          </label>
          <label className="field">
            <span>Department *</span>
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
        </div>

        <div className="card-subsection">
          <h2>Jira Connection *</h2>
          <p className="muted">
            Needed to upload time entries and look up {teamKey}s, using your email above as the Jira
            account email. Your API token is stored in this machine's OS keychain, never in the
            database.
          </p>
          <label className="field">
            <span>API Token</span>
            <input
              type="password"
              value={jiraTokenInput}
              onChange={(e) => setJiraTokenInput(e.target.value)}
              placeholder={settings.hasJiraToken ? "•••••••• (saved)" : "Paste your Jira API token"}
            />
          </label>
          <button type="button" className="link-button" onClick={() => openUrl(JIRA_API_TOKEN_URL)}>
            Get an API token from Atlassian ↗
          </button>
          <div className="row">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleVerify}
              disabled={jiraVerify.kind === "verifying"}
            >
              {jiraVerify.kind === "verifying" ? "Verifying…" : "Verify Connection"}
            </button>
            {jiraSatisfied && (
              <span className="status status-success">
                Connected{jiraVerify.kind === "success" ? ` as ${jiraVerify.displayName}` : ""}.
              </span>
            )}
          </div>
          {jiraVerify.kind === "error" && <p className="status status-error">{jiraVerify.message}</p>}
        </div>

        <div className="card-subsection">
          <h2>Outlook Calendar Import</h2>
          <p className="muted">
            Optional -- paste your shared calendar's published link (Outlook: Calendar settings →
            Shared calendars → Publish a calendar → copy the ICS link) so the Timesheet's "Import
            from Outlook" can fetch it straight away. Skip this and set it later from Settings if you
            don't have it to hand.
          </p>
          <label className="field">
            <span>Calendar link (.ics)</span>
            <input
              type="text"
              value={outlookIcsUrl}
              onChange={(e) => setOutlookIcsUrl(e.target.value)}
              placeholder="https://outlook.office.com/owa/calendar/.../calendar.ics"
            />
          </label>
        </div>

        {error && <p className="status status-error">{error}</p>}

        <button
          type="button"
          className="btn btn-accent onboarding-continue"
          onClick={handleContinue}
          disabled={!canContinue || submitting}
        >
          {submitting ? "Saving…" : "Continue"}
        </button>
      </div>
    </div>
  );
}
