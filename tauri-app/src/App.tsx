import { useEffect, useState } from "react";
import { completeOnboarding, getSettings, type AppSettings } from "./api/settings";
import { checkForUpdate, type Update } from "./api/updater";
import { AppShell, type Tab } from "./components/AppShell";
import { OnboardingForm } from "./components/OnboardingForm";
import { OnboardingTour } from "./components/OnboardingTour";
import { UpdateAvailableModal } from "./components/UpdateAvailableModal";
import { ActivitiesScreen } from "./screens/ActivitiesScreen";
import { CalendarScreen } from "./screens/CalendarScreen";
import { NotesScreen } from "./screens/NotesScreen";
import { PomodoroScreen, PomodoroTabLabel } from "./screens/PomodoroScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { SummaryScreen } from "./screens/SummaryScreen";
import { TasksScreen } from "./screens/TasksScreen";
import { TemplateScreen } from "./screens/TemplateScreen";
import { pomodoro } from "./lib/pomodoro";
import { ThemeProvider } from "./theme/ThemeProvider";

// Tasks, Notes and Pomodoro are switchable from Settings → Optional Features
// (see buildTabs below); everything else is always shown.
const TIMESHEET_TABS: Tab[] = [
  { id: "timesheet", label: "Timesheet" },
  { id: "activities", label: "Activities" },
  { id: "template", label: "Template" },
];
const TASKS_TAB: Tab = { id: "tasks", label: "Tasks" };
const NOTES_TAB: Tab = { id: "notes", label: "Notes" };
const POMODORO_TAB: Tab = { id: "pomodoro", label: <PomodoroTabLabel /> };
const CLOSING_TABS: Tab[] = [
  { id: "summary", label: "Summary" },
  { id: "settings", label: "Settings" },
];

function buildTabs(settings: AppSettings): Tab[] {
  return [
    ...TIMESHEET_TABS,
    ...(settings.tasksEnabled ? [TASKS_TAB] : []),
    ...(settings.notesEnabled ? [NOTES_TAB] : []),
    ...(settings.pomodoroEnabled ? [POMODORO_TAB] : []),
    ...CLOSING_TABS,
  ];
}

// "form" blocks the whole app behind the mandatory-fields form; "tour"
// shows the real app with a guided spotlight overlay on top; "done" is
// normal operation. Every settings.onboardingCompleted === false database
// (brand new, or an existing one upgrading into this feature for the first
// time) starts at "form" -- see settings.rs's default.
type OnboardingStage = "form" | "tour" | "done";

function App() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("timesheet");
  const [onboardingStage, setOnboardingStage] = useState<OnboardingStage | null>(null);
  const [pendingUpdate, setPendingUpdate] = useState<Update | null>(null);
  // Set by OnboardingTour's onRequestModal while a step names one (see
  // TourStep's openModal) -- currently only "import-qdm", for the two
  // steps that walk through Import QDMs itself. Read by ActivitiesScreen's
  // tourOpenImportModal prop below.
  const [tourModalRequest, setTourModalRequest] = useState<string | null>(null);

  useEffect(() => {
    getSettings()
      .then((s) => {
        setSettings(s);
        setOnboardingStage(s.onboardingCompleted ? "done" : "form");
      })
      .catch((e) => setLoadError(String(e)));
  }, []);

  // Hands the Pomodoro engine its durations whenever Settings changes them
  // (and once settings first load) -- a timer mid-run keeps its end time,
  // so a change only takes effect from the next phase.
  const pomodoroConfig = settings && {
    focusMinutes: settings.pomodoroFocusMinutes,
    shortBreakMinutes: settings.pomodoroShortBreakMinutes,
    longBreakMinutes: settings.pomodoroLongBreakMinutes,
    sessionsBeforeLong: settings.pomodoroSessionsBeforeLong,
    soundEnabled: settings.pomodoroSound,
  };
  const pomodoroConfigKey = pomodoroConfig ? Object.values(pomodoroConfig).join(",") : "";
  useEffect(() => {
    if (pomodoroConfig) pomodoro.setConfig(pomodoroConfig);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pomodoroConfigKey]);

  // A few seconds after launch, not immediately -- same pacing the Python
  // app's own check used, so a slow/missing connection never delays
  // startup or competes with the initial data fetches above. Only once
  // onboarding is actually done: interrupting a brand-new install's
  // mandatory form/tour with an update popup would be a bad first
  // impression. Silent failure (offline, no releases published yet, or
  // running outside a real Tauri window) mirrors the Python app's own
  // "no internet right now" handling -- nothing shown, no error, just
  // tries again next launch.
  useEffect(() => {
    if (onboardingStage !== "done") return;
    const timer = setTimeout(() => {
      checkForUpdate()
        .then((update) => {
          if (!update) return;
          let declined: string | null = null;
          try {
            declined = localStorage.getItem("quasar-declined-update-version");
          } catch {
            // Private window / blocked storage -- treat as nothing declined.
          }
          if (declined !== update.version) setPendingUpdate(update);
        })
        .catch(() => {});
    }, 3000);
    return () => clearTimeout(timer);
  }, [onboardingStage]);

  if (loadError) {
    return <div className="app-shell error-banner">Couldn't load settings: {loadError}</div>;
  }
  if (!settings || onboardingStage === null) {
    return <div className="app-shell">Loading…</div>;
  }

  const updateSettings = (patch: Partial<AppSettings>) =>
    setSettings((prev) => (prev ? { ...prev, ...patch } : prev));

  async function finishTour() {
    setOnboardingStage("done");
    try {
      await completeOnboarding();
    } catch (e) {
      console.error(e);
    }
  }

  const tabs = buildTabs(settings);

  return (
    <ThemeProvider
      themeId={settings.themeMode}
      customSeeds={settings.customTheme}
      onThemeIdChange={(themeMode) => updateSettings({ themeMode })}
      onCustomSeedsChange={(customTheme) => updateSettings({ customTheme })}
    >
      {onboardingStage === "form" ? (
        <OnboardingForm settings={settings} onChange={updateSettings} onSubmit={() => setOnboardingStage("tour")} />
      ) : (
        <>
          <AppShell
            tabs={tabs}
            activeTab={activeTab}
            onSelectTab={setActiveTab}
            headerStyle={settings.headerStyle}
            settings={settings}
          >
            {activeTab === "timesheet" && <CalendarScreen settings={settings} onChange={updateSettings} />}
            {activeTab === "activities" && (
              <ActivitiesScreen settings={settings} tourOpenImportModal={tourModalRequest === "import-qdm"} />
            )}
            {activeTab === "template" && <TemplateScreen settings={settings} onChange={updateSettings} />}
            {activeTab === "tasks" && settings.tasksEnabled && <TasksScreen />}
            {activeTab === "notes" && settings.notesEnabled && <NotesScreen />}
            {activeTab === "pomodoro" && settings.pomodoroEnabled && <PomodoroScreen />}
            {activeTab === "summary" && <SummaryScreen settings={settings} />}
            {activeTab === "settings" && <SettingsScreen settings={settings} onChange={updateSettings} />}
          </AppShell>
          {onboardingStage === "tour" && (
            <OnboardingTour
              activeTab={activeTab}
              availableTabs={tabs.map((t) => t.id)}
              onSelectTab={setActiveTab}
              onRequestModal={setTourModalRequest}
              onFinish={finishTour}
            />
          )}
          {pendingUpdate && (
            <UpdateAvailableModal update={pendingUpdate} onDismiss={() => setPendingUpdate(null)} />
          )}
        </>
      )}
    </ThemeProvider>
  );
}

export default App;
