import { useEffect, useState } from "react";
import { completeOnboarding, getSettings, type AppSettings } from "./api/settings";
import { AppShell, type Tab } from "./components/AppShell";
import { OnboardingForm } from "./components/OnboardingForm";
import { OnboardingTour } from "./components/OnboardingTour";
import { ActivitiesScreen } from "./screens/ActivitiesScreen";
import { CalendarScreen } from "./screens/CalendarScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { SummaryScreen } from "./screens/SummaryScreen";
import { TasksScreen } from "./screens/TasksScreen";
import { TemplateScreen } from "./screens/TemplateScreen";
import { ThemeProvider } from "./theme/ThemeProvider";

const TABS: Tab[] = [
  { id: "timesheet", label: "Timesheet" },
  { id: "activities", label: "Activities" },
  { id: "template", label: "Template" },
  { id: "tasks", label: "Tasks" },
  { id: "summary", label: "Summary" },
  { id: "settings", label: "Settings" },
];

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

  useEffect(() => {
    getSettings()
      .then((s) => {
        setSettings(s);
        setOnboardingStage(s.onboardingCompleted ? "done" : "form");
      })
      .catch((e) => setLoadError(String(e)));
  }, []);

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
            tabs={TABS}
            activeTab={activeTab}
            onSelectTab={setActiveTab}
            headerStyle={settings.headerStyle}
            settings={settings}
          >
            {activeTab === "timesheet" && <CalendarScreen settings={settings} />}
            {activeTab === "activities" && <ActivitiesScreen settings={settings} />}
            {activeTab === "template" && <TemplateScreen settings={settings} />}
            {activeTab === "tasks" && <TasksScreen />}
            {activeTab === "summary" && <SummaryScreen settings={settings} />}
            {activeTab === "settings" && <SettingsScreen settings={settings} onChange={updateSettings} />}
          </AppShell>
          {onboardingStage === "tour" && (
            <OnboardingTour activeTab={activeTab} onSelectTab={setActiveTab} onFinish={finishTour} />
          )}
        </>
      )}
    </ThemeProvider>
  );
}

export default App;
