import { useEffect, useState } from "react";
import { getSettings, type AppSettings } from "./api/settings";
import { AppShell, type Tab } from "./components/AppShell";
import { ActivitiesScreen } from "./screens/ActivitiesScreen";
import { CalendarScreen } from "./screens/CalendarScreen";
import { PlaceholderScreen } from "./screens/PlaceholderScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { ThemeProvider } from "./theme/ThemeProvider";

const TABS: Tab[] = [
  { id: "timesheet", label: "Timesheet" },
  { id: "activities", label: "Activities" },
  { id: "template", label: "Template" },
  { id: "summary", label: "Summary" },
  { id: "settings", label: "Settings" },
];

function App() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("timesheet");

  useEffect(() => {
    getSettings()
      .then(setSettings)
      .catch((e) => setLoadError(String(e)));
  }, []);

  if (loadError) {
    return <div className="app-shell error-banner">Couldn't load settings: {loadError}</div>;
  }
  if (!settings) {
    return <div className="app-shell">Loading…</div>;
  }

  const updateSettings = (patch: Partial<AppSettings>) =>
    setSettings((prev) => (prev ? { ...prev, ...patch } : prev));

  return (
    <ThemeProvider
      themeId={settings.themeMode}
      customSeeds={settings.customTheme}
      onThemeIdChange={(themeMode) => updateSettings({ themeMode })}
      onCustomSeedsChange={(customTheme) => updateSettings({ customTheme })}
    >
      <AppShell
        tabs={TABS}
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        headerStyle={settings.headerStyle}
      >
        {activeTab === "timesheet" && <CalendarScreen settings={settings} />}
        {activeTab === "activities" && <ActivitiesScreen />}
        {activeTab === "template" && (
          <PlaceholderScreen
            title="Template"
            description="Recurring Mon-Fri time blocks, with an 'Apply Template to This Week' action. Not built yet."
          />
        )}
        {activeTab === "summary" && (
          <PlaceholderScreen
            title="Summary"
            description="Week/month totals grouped by Activity or Project. Not built yet."
          />
        )}
        {activeTab === "settings" && <SettingsScreen settings={settings} onChange={updateSettings} />}
      </AppShell>
    </ThemeProvider>
  );
}

export default App;
