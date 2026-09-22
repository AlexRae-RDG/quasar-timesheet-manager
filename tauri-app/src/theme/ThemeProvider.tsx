import { createContext, useContext, useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import { getTheme, GLASSY_THEME_ID, isDark, resolveThemeId, type PaletteSeeds } from "./palettes";

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
  const resolved = resolveThemeId(themeId);
  const { palette } = getTheme(themeId, customSeeds);
  const root = document.documentElement.style;
  for (const [key, value] of Object.entries(palette)) {
    root.setProperty(`--${key.toLowerCase().replace(/_/g, "-")}`, value);
  }
  // Flags the frosted-glass CSS in global.css ([data-glass="true"]) --
  // backdrop-filter blur is a real CSS property, not a color, so it can't
  // ride along as a custom-property value the way the rest of the palette
  // does.
  if (resolved === GLASSY_THEME_ID) {
    document.documentElement.setAttribute("data-glass", "true");
  } else {
    document.documentElement.removeAttribute("data-glass");
  }
  // Tells the browser's own native form-control rendering (a <select>'s
  // dropdown list, scrollbars, etc.) whether it's sitting on a dark or
  // light background -- without this, Chromium in particular renders that
  // popup with light-mode colors regardless of this app's own CSS, which
  // on a dark theme meant white list-item text on the popup's own default
  // white background: unreadable, and nothing to do with the custom
  // chevron styling (that only ever reaches the closed select box, never
  // this native popup). Glassy isn't run through derivePalette (its
  // PANEL_BG is a translucent rgba(), which isDark() -- built for solid
  // #RRGGBB seeds -- can't parse), but it's always the dark-styled one of
  // the four themes regardless, so it's hardcoded true here rather than
  // fed through that check.
  const dark = resolved === GLASSY_THEME_ID ? true : isDark(palette.PANEL_BG);
  root.setProperty("color-scheme", dark ? "dark" : "light");
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
