import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { getTheme, systemPrefersDark, SYSTEM_THEME_ID, type PaletteSeeds } from "./palettes";

interface ThemeContextValue {
  themeId: string;
  customSeeds: PaletteSeeds;
  setThemeId: (id: string) => void;
  setCustomSeeds: (seeds: PaletteSeeds) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useThemeContext(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useThemeContext must be used within ThemeProvider");
  return ctx;
}

function applyPaletteToDocument(themeId: string, customSeeds: PaletteSeeds) {
  const { palette } = getTheme(themeId, customSeeds);
  const root = document.documentElement.style;
  for (const [key, value] of Object.entries(palette)) {
    root.setProperty(`--${key.toLowerCase().replace(/_/g, "-")}`, value);
  }
}

export function ThemeProvider({
  themeId,
  customSeeds,
  onThemeIdChange,
  onCustomSeedsChange,
  children,
}: {
  themeId: string;
  customSeeds: PaletteSeeds;
  onThemeIdChange: (id: string) => void;
  onCustomSeedsChange: (seeds: PaletteSeeds) => void;
  children: ReactNode;
}) {
  // Live-follows OS appearance changes while "System" is active. The
  // Python app only checks this once at startup (a Tk limitation); the
  // webview gets prefers-color-scheme change events for free, so this
  // rebuilds the palette live instead of requiring a restart.
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    if (themeId !== SYSTEM_THEME_ID || typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => forceUpdate((n) => n + 1);
    mq.addEventListener("change", listener);
    return () => mq.removeEventListener("change", listener);
  }, [themeId]);

  useEffect(() => {
    applyPaletteToDocument(themeId, customSeeds);
  }, [themeId, customSeeds]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      themeId,
      customSeeds,
      setThemeId: onThemeIdChange,
      setCustomSeeds: onCustomSeedsChange,
    }),
    [themeId, customSeeds, onThemeIdChange, onCustomSeedsChange],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export { systemPrefersDark };
