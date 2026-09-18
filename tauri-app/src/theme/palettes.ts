/**
 * Theme system: derivePalette() turns four seed colors into a full palette
 * (still the same mix()-based approach ported from the Python app's
 * app/theme.py), backing four theme choices -- Light, Dark, Custom
 * (user-picked seeds), and Glassy (a hand-built translucent palette, not
 * seed-derived -- see GLASS_PALETTE below).
 */

export interface PaletteSeeds {
  appBg: string;
  panelBg: string;
  textPrimary: string;
  accent: string;
  danger?: string;
  nowLine?: string;
}

export interface Palette {
  APP_BG: string;
  PANEL_BG: string;
  BORDER: string;
  BORDER_STRONG: string;
  TEXT_PRIMARY: string;
  TEXT_SECONDARY: string;
  TEXT_MUTED: string;
  ACCENT: string;
  ACCENT_HOVER: string;
  ACCENT_SOFT: string;
  DANGER: string;
  DANGER_SOFT: string;
  DANGER_SOFT_ACTIVE: string;
  GRID_LINE: string;
  GRID_LINE_HOUR: string;
  HEADER_BG: string;
  TODAY_TINT: string;
  NOW_LINE: string;
  BLOCK_BORDER: string;
  SELECTION_OUTLINE: string;
  PREVIEW_FILL: string;
  PREVIEW_OUTLINE: string;
  FIELD_BG: string;
  SURFACE: string;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function rgbToHex([r, g, b]: number[]): string {
  const clamp = (c: number) => Math.max(0, Math.min(255, Math.round(c)));
  return (
    "#" +
    [clamp(r), clamp(g), clamp(b)]
      .map((c) => c.toString(16).toUpperCase().padStart(2, "0"))
      .join("")
  );
}

function mix(colorA: string, colorB: string, t: number): string {
  const a = hexToRgb(colorA);
  const b = hexToRgb(colorB);
  return rgbToHex(a.map((av, i) => av + (b[i] - av) * t));
}

function darken(color: string, amount: number): string {
  const [r, g, b] = hexToRgb(color);
  const factor = 1.0 - amount;
  return rgbToHex([r * factor, g * factor, b * factor]);
}

function isDark(color: string): boolean {
  const [r, g, b] = hexToRgb(color);
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance < 128;
}

export const BLOCK_TEXT_DARK = "#1A1A1A";
export const BLOCK_TEXT_LIGHT = "#FFFFFF";

export function blockTextColor(bgHex: string): string {
  return isDark(bgHex) ? BLOCK_TEXT_LIGHT : BLOCK_TEXT_DARK;
}

export function derivePalette(seeds: PaletteSeeds): Palette {
  const { appBg, panelBg, textPrimary, accent } = seeds;
  const dark = isDark(panelBg);
  const danger = seeds.danger ?? (dark ? "#E5484D" : "#D6334C");
  const nowLine = seeds.nowLine ?? (dark ? "#FF9500" : "#FF5A36");

  const fieldBg = dark ? mix(panelBg, textPrimary, 0.035) : panelBg;
  const accentHover = darken(accent, 0.17);
  const accentSoft = mix(panelBg, accent, 0.11);

  return {
    APP_BG: appBg,
    PANEL_BG: panelBg,
    BORDER: mix(panelBg, textPrimary, 0.065),
    BORDER_STRONG: mix(panelBg, textPrimary, 0.12),
    TEXT_PRIMARY: textPrimary,
    TEXT_SECONDARY: mix(textPrimary, panelBg, 0.38),
    TEXT_MUTED: mix(textPrimary, panelBg, 0.63),
    ACCENT: accent,
    ACCENT_HOVER: accentHover,
    ACCENT_SOFT: accentSoft,
    DANGER: danger,
    DANGER_SOFT: mix(panelBg, danger, 0.08),
    DANGER_SOFT_ACTIVE: mix(panelBg, danger, 0.16),
    GRID_LINE: mix(panelBg, textPrimary, 0.04),
    GRID_LINE_HOUR: mix(panelBg, textPrimary, 0.1),
    HEADER_BG: mix(panelBg, textPrimary, 0.045),
    TODAY_TINT: accentSoft,
    NOW_LINE: nowLine,
    BLOCK_BORDER: panelBg,
    SELECTION_OUTLINE: textPrimary,
    PREVIEW_FILL: accent,
    PREVIEW_OUTLINE: accentHover,
    FIELD_BG: fieldBg,
    SURFACE: dark ? fieldBg : appBg,
  };
}

export const LIGHT_THEME_ID = "light";
export const DARK_THEME_ID = "dark";
export const CUSTOM_THEME_ID = "custom";
export const GLASSY_THEME_ID = "glassy";
export const DEFAULT_THEME_ID = DARK_THEME_ID;

export const THEME_ORDER = [LIGHT_THEME_ID, DARK_THEME_ID, GLASSY_THEME_ID, CUSTOM_THEME_ID];

const LIGHT_SEEDS: PaletteSeeds = {
  appBg: "#F4F6FA",
  panelBg: "#FFFFFF",
  textPrimary: "#161B22",
  accent: "#2F6FED",
};
const DARK_SEEDS: PaletteSeeds = {
  appBg: "#0B0E14",
  panelBg: "#12161F",
  textPrimary: "#EAF0FF",
  accent: "#2F6FED",
};

// Hand-built rather than seed-derived: derivePalette()'s mix()/darken() math
// assumes solid #RRGGBB seeds, which can't express the translucency a glass
// look depends on. APP_BG is a rich, colorful gradient (rather than a flat
// hex) so the blurred, semi-transparent panels have something worth
// refracting -- see global.css's [data-glass="true"] rules, which add the
// actual backdrop-filter blur on top of these colors.
const GLASS_PALETTE: Palette = {
  APP_BG: "linear-gradient(135deg, #2b1657 0%, #12295c 45%, #0b3a4a 100%)",
  PANEL_BG: "rgba(255, 255, 255, 0.10)",
  BORDER: "rgba(255, 255, 255, 0.16)",
  BORDER_STRONG: "rgba(255, 255, 255, 0.30)",
  TEXT_PRIMARY: "#F5F7FF",
  TEXT_SECONDARY: "rgba(245, 247, 255, 0.70)",
  TEXT_MUTED: "rgba(245, 247, 255, 0.48)",
  ACCENT: "#0A84FF",
  ACCENT_HOVER: "#3396FF",
  ACCENT_SOFT: "rgba(10, 132, 255, 0.22)",
  DANGER: "#FF6B6B",
  DANGER_SOFT: "rgba(255, 107, 107, 0.16)",
  DANGER_SOFT_ACTIVE: "rgba(255, 107, 107, 0.26)",
  GRID_LINE: "rgba(255, 255, 255, 0.08)",
  GRID_LINE_HOUR: "rgba(255, 255, 255, 0.16)",
  HEADER_BG: "rgba(255, 255, 255, 0.06)",
  TODAY_TINT: "rgba(10, 132, 255, 0.16)",
  NOW_LINE: "#FFB454",
  BLOCK_BORDER: "rgba(255, 255, 255, 0.14)",
  SELECTION_OUTLINE: "#FFFFFF",
  PREVIEW_FILL: "#0A84FF",
  PREVIEW_OUTLINE: "#3396FF",
  FIELD_BG: "rgba(255, 255, 255, 0.14)",
  SURFACE: "rgba(255, 255, 255, 0.09)",
};

// Anyone with a database from an earlier theme era (the old 7-mode set, or
// the later 18-preset + System set) gets mapped onto whichever of the four
// current themes is the closer match -- light background presets fall to
// Light, dark ones to Dark. "system" (used to follow OS light/dark live)
// has no real equivalent now that theme-following was dropped in favor of
// an explicit choice, so it falls to Dark like any other unrecognized id.
const LEGACY_MODE_MAP: Record<string, string> = {
  light: LIGHT_THEME_ID,
  dark: DARK_THEME_ID,
  sleek_indigo: DARK_THEME_ID,
  neon_cyan: DARK_THEME_ID,
  crisp_light: LIGHT_THEME_ID,
  emerald_terminal: DARK_THEME_ID,
  warm_amber: LIGHT_THEME_ID,
  violet_nebula: DARK_THEME_ID,
  mac_glass: LIGHT_THEME_ID,
  stormy_morning: DARK_THEME_ID,
  mossy_hollow: DARK_THEME_ID,
  ink_wash: LIGHT_THEME_ID,
  blooming_romance: LIGHT_THEME_ID,
  lavender_fields: LIGHT_THEME_ID,
  evening_rose: DARK_THEME_ID,
  zesty_lemon: LIGHT_THEME_ID,
  bubblegum_pop: DARK_THEME_ID,
  electric_kiwi: DARK_THEME_ID,
  cobalt_rush: DARK_THEME_ID,
  magenta_pulse: DARK_THEME_ID,
  slate_graphite: DARK_THEME_ID,
  sandstone: LIGHT_THEME_ID,
  ocean_mist: LIGHT_THEME_ID,
  sage_retreat: LIGHT_THEME_ID,
  midnight_lagoon: DARK_THEME_ID,
  autumn_harvest: DARK_THEME_ID,
  winter_frost: LIGHT_THEME_ID,
  system: DARK_THEME_ID,
};

export function resolveThemeId(value: string | null | undefined): string {
  if (value === LIGHT_THEME_ID || value === DARK_THEME_ID || value === CUSTOM_THEME_ID || value === GLASSY_THEME_ID) {
    return value;
  }
  if (value && LEGACY_MODE_MAP[value]) {
    return LEGACY_MODE_MAP[value];
  }
  return DEFAULT_THEME_ID;
}

export interface ThemeInfo {
  label: string;
  description: string;
  palette: Palette;
}

export function getTheme(themeId: string, customSeeds: PaletteSeeds): ThemeInfo {
  const resolved = resolveThemeId(themeId);
  if (resolved === CUSTOM_THEME_ID) {
    return {
      label: "Custom",
      description:
        "Your own palette -- pick a background, panel, text, and accent color below and the rest is filled in to match.",
      palette: derivePalette(customSeeds),
    };
  }
  if (resolved === GLASSY_THEME_ID) {
    return {
      label: "Glassy",
      description: "Translucent, frosted panels over a rich gradient backdrop.",
      palette: GLASS_PALETTE,
    };
  }
  if (resolved === LIGHT_THEME_ID) {
    return {
      label: "Light",
      description: "Clean and bright, dark text on white panels.",
      palette: derivePalette(LIGHT_SEEDS),
    };
  }
  return {
    label: "Dark",
    description: "Low-glare dark panels with a cool blue accent.",
    palette: derivePalette(DARK_SEEDS),
  };
}

export const DEFAULT_CUSTOM_SEEDS: PaletteSeeds = {
  appBg: "#05070F",
  panelBg: "#0B1020",
  textPrimary: "#EAF0FF",
  accent: "#2F6FED",
};
