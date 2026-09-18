import { createContext, useContext, useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import { getTheme, GLASSY_THEME_ID, resolveThemeId, type PaletteSeeds } from "./palettes";

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
  // Flags the frosted-glass CSS in global.css ([data-glass="true"]) --
  // backdrop-filter blur is a real CSS property, not a color, so it can't
  // ride along as a custom-property value the way the rest of the palette
  // does.
  if (resolveThemeId(themeId) === GLASSY_THEME_ID) {
    document.documentElement.setAttribute("data-glass", "true");
  } else {
    document.documentElement.removeAttribute("data-glass");
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
