import type { ReactNode } from "react";
import { Logo } from "./Logo";

export interface Tab {
  id: string;
  label: string;
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
  children,
}: {
  tabs: Tab[];
  activeTab: string;
  onSelectTab: (id: string) => void;
  headerStyle: "standard" | "compact" | "hidden";
  children: ReactNode;
}) {
  const profile = HEADER_PROFILES[headerStyle === "compact" ? "compact" : "standard"];

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
            className={"btn " + (activeTab === tab.id ? "btn-accent" : "btn-secondary")}
            onClick={() => onSelectTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <main className="shell-content">{children}</main>
    </div>
  );
}
