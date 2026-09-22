import { createContext, useContext, useState, type ReactNode } from "react";
import type { AppSettings } from "../api/settings";
import { Logo } from "./Logo";
import { TimerBar } from "./TimerBar";

export interface Tab {
  id: string;
  label: string;
}

// Lets a screen (e.g. CalendarScreen's "Upload to Jira") render a button
// into the persistent top nav row, right-aligned alongside the tabs,
// instead of its own screen-specific toolbar -- via a portal to this DOM
// node, so the button's own state/handlers stay owned by that screen and
// only ever exist while it's actually mounted.
const NavActionsSlotContext = createContext<HTMLDivElement | null>(null);

export function useNavActionsSlot(): HTMLDivElement | null {
  return useContext(NavActionsSlotContext);
}

// Sizes ported from main_window.py's _HEADER_PROFILES.
const HEADER_PROFILES = {
  standard: { logoSize: 28, padding: "14px 20px", titlePt: 16 },
  compact: { logoSize: 16, padding: "6px 20px", titlePt: 12 },
} as const;

export function AppShell({
  tabs,
  activeTab,
  onSelectTab,
  headerStyle,
  settings,
  children,
}: {
  tabs: Tab[];
  activeTab: string;
  onSelectTab: (id: string) => void;
  headerStyle: "standard" | "compact" | "hidden";
  settings: AppSettings;
  children: ReactNode;
}) {
  const profile = HEADER_PROFILES[headerStyle === "compact" ? "compact" : "standard"];
  const [navActionsSlot, setNavActionsSlot] = useState<HTMLDivElement | null>(null);

  return (
    <div className="shell">
      {headerStyle !== "hidden" && (
        <header className="shell-header" style={{ padding: profile.padding }}>
          <Logo size={profile.logoSize} />
          <span style={{ fontSize: profile.titlePt, fontWeight: 700 }}>QUASAR Timesheet Manager</span>
        </header>
      )}

      <nav className="shell-tab-row">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            data-tour={`tab-${tab.id}`}
            className={"btn " + (activeTab === tab.id ? "btn-accent" : "btn-secondary")}
            onClick={() => onSelectTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
        <div className="shell-nav-actions" ref={setNavActionsSlot} />
      </nav>

      <TimerBar settings={settings} />

      <main className="shell-content">
        <NavActionsSlotContext.Provider value={navActionsSlot}>{children}</NavActionsSlotContext.Provider>
      </main>
    </div>
  );
}
