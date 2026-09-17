/**
 * Port of the Python app's app/theme.py color system: derive_palette(), the
 * eighteen curated presets, "system" (follows OS light/dark), and "custom"
 * (user-picked seeds). Ported value-for-value from theme.py rather than
 * re-designed, so an existing user's saved theme_mode / custom seed colors
 * resolve to the same look.
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

export interface ThemePreset {
  id: string;
  label: string;
  category: string;
  description: string;
  seeds: PaletteSeeds;
}

// Eighteen curated palettes, ported verbatim from theme.py's _PRESETS.
export const PRESETS: ThemePreset[] = [
  {
    id: "stormy_morning",
    label: "Stormy Morning",
    category: "Monochromatic",
    description: "Charcoal and slate-blue in one family -- calm, restrained, all business.",
    seeds: { appBg: "#0B0E13", panelBg: "#12161D", textPrimary: "#EDEFF3", accent: "#5B7CA3" },
  },
  {
    id: "mossy_hollow",
    label: "Mossy Hollow",
    category: "Monochromatic",
    description: "Deep forest green throughout, one quiet hue from background to accent.",
    seeds: { appBg: "#0A0F0B", panelBg: "#101712", textPrimary: "#E9F2EA", accent: "#4C7A58" },
  },
  {
    id: "ink_wash",
    label: "Ink Wash",
    category: "Monochromatic",
    description: "Paper white and charcoal ink -- a light monochrome, nothing but gray and near-black.",
    seeds: {
      appBg: "#F3F3F4",
      panelBg: "#FFFFFF",
      textPrimary: "#17181C",
      accent: "#3A3D46",
      danger: "#C4314B",
      nowLine: "#E4572E",
    },
  },
  {
    id: "blooming_romance",
    label: "Blooming Romance",
    category: "Romantic",
    description: "Soft blush pink on white -- warm and romantic without tipping into saccharine.",
    seeds: {
      appBg: "#FDF4F6",
      panelBg: "#FFFFFF",
      textPrimary: "#3A1420",
      accent: "#D6537B",
      danger: "#C0293F",
      nowLine: "#E08A2E",
    },
  },
  {
    id: "lavender_fields",
    label: "Lavender Fields",
    category: "Romantic",
    description: "Pale lavender and soft violet -- gentle, a little dreamy.",
    seeds: {
      appBg: "#F6F3FC",
      panelBg: "#FFFFFF",
      textPrimary: "#2A1F3D",
      accent: "#8B6FD6",
      danger: "#D6455E",
      nowLine: "#E0932E",
    },
  },
  {
    id: "evening_rose",
    label: "Evening Rose",
    category: "Romantic",
    description: "Deep rose on near-black -- the same romantic pink family, after dark.",
    seeds: {
      appBg: "#170D12",
      panelBg: "#21131A",
      textPrimary: "#F7E9EE",
      accent: "#E8608A",
      danger: "#FF6B6B",
      nowLine: "#FFB454",
    },
  },
  {
    id: "zesty_lemon",
    label: "Zesty Lemon",
    category: "Playful",
    description: "Bright and citrusy -- a mustard-gold accent on a warm cream background.",
    seeds: {
      appBg: "#FDFBEF",
      panelBg: "#FFFFFF",
      textPrimary: "#2B2610",
      accent: "#C99A00",
      danger: "#D6334C",
      nowLine: "#2F6FED",
    },
  },
  {
    id: "bubblegum_pop",
    label: "Bubblegum Pop",
    category: "Playful",
    description: "Hot pink on near-black -- loud, neon, unmistakably playful.",
    seeds: {
      appBg: "#0F0A14",
      panelBg: "#17101F",
      textPrimary: "#FBEFFF",
      accent: "#FF4FD8",
      danger: "#FF4D6D",
      nowLine: "#7CFF6B",
    },
  },
  {
    id: "electric_kiwi",
    label: "Electric Kiwi",
    category: "Playful",
    description: "Lime green on near-black -- sharp, energetic, a little irreverent.",
    seeds: {
      appBg: "#0A0F08",
      panelBg: "#10160D",
      textPrimary: "#EFFCE9",
      accent: "#84C400",
      danger: "#FF5D5D",
      nowLine: "#FF9F1C",
    },
  },
  {
    id: "cobalt_rush",
    label: "Cobalt Rush",
    category: "Vibrant",
    description: "Electric blue on near-black -- high-contrast and confident.",
    seeds: {
      appBg: "#05070F",
      panelBg: "#0B1020",
      textPrimary: "#EAF0FF",
      accent: "#2F6FED",
      danger: "#FF3B5C",
      nowLine: "#FF9500",
    },
  },
  {
    id: "magenta_pulse",
    label: "Magenta Pulse",
    category: "Vibrant",
    description: "Rich magenta on deep violet-black -- vivid and a little electric.",
    seeds: {
      appBg: "#0F0714",
      panelBg: "#180D22",
      textPrimary: "#F5EAFB",
      accent: "#C93BE0",
      danger: "#FF4D6D",
      nowLine: "#FFB454",
    },
  },
  {
    id: "slate_graphite",
    label: "Slate Graphite",
    category: "Neutral",
    description: "Cool graphite gray with a muted steel accent -- quiet and professional.",
    seeds: {
      appBg: "#0E0F11",
      panelBg: "#16181B",
      textPrimary: "#EDEEF0",
      accent: "#6E7681",
      danger: "#E5484D",
      nowLine: "#F2994A",
    },
  },
  {
    id: "sandstone",
    label: "Sandstone",
    category: "Neutral",
    description: "Warm sand tones with a muted clay accent -- soft daylight neutrality.",
    seeds: {
      appBg: "#F5EFE6",
      panelBg: "#FFFDF9",
      textPrimary: "#2E2A22",
      accent: "#B08A5A",
      danger: "#C1442E",
      nowLine: "#4C7A58",
    },
  },
  {
    id: "ocean_mist",
    label: "Ocean Mist",
    category: "Tranquil",
    description: "Pale sea-glass teal on white -- light, airy, easy on the eyes.",
    seeds: {
      appBg: "#F0F6F6",
      panelBg: "#FFFFFF",
      textPrimary: "#123435",
      accent: "#2A9D8F",
      danger: "#C0293F",
      nowLine: "#E76F51",
    },
  },
  {
    id: "sage_retreat",
    label: "Sage Retreat",
    category: "Tranquil",
    description: "Soft sage green on white -- calm, natural, unhurried.",
    seeds: {
      appBg: "#F3F6F1",
      panelBg: "#FFFFFF",
      textPrimary: "#1F2E1A",
      accent: "#6E9B6B",
      danger: "#C1442E",
      nowLine: "#D97706",
    },
  },
  {
    id: "midnight_lagoon",
    label: "Midnight Lagoon",
    category: "Tranquil",
    description: "Deep teal on near-black -- the same calm sea-glass family, after dark.",
    seeds: {
      appBg: "#060F11",
      panelBg: "#0C1A1D",
      textPrimary: "#E4F5F5",
      accent: "#17A6A0",
      danger: "#FF5D5D",
      nowLine: "#FFB454",
    },
  },
  {
    id: "autumn_harvest",
    label: "Autumn Harvest",
    category: "Seasonal",
    description: "Toasted brown and burnt orange -- a cozy, low-light autumn palette.",
    seeds: {
      appBg: "#140D08",
      panelBg: "#1F140C",
      textPrimary: "#FBEEE1",
      accent: "#E08A2E",
      danger: "#C1442E",
      nowLine: "#7CA84C",
    },
  },
  {
    id: "winter_frost",
    label: "Winter Frost",
    category: "Seasonal",
    description: "Icy pale blue on white -- crisp, clean, a little wintry.",
    seeds: {
      appBg: "#F2F7FB",
      panelBg: "#FFFFFF",
      textPrimary: "#142433",
      accent: "#4E7CB8",
      danger: "#C0293F",
      nowLine: "#E0932E",
    },
  },
];

export const CUSTOM_THEME_ID = "custom";
export const SYSTEM_THEME_ID = "system";
export const DEFAULT_THEME_ID = SYSTEM_THEME_ID;

export const THEME_ORDER = [SYSTEM_THEME_ID, ...PRESETS.map((p) => p.id)];

const PRESET_BY_ID: Record<string, ThemePreset> = Object.fromEntries(
  PRESETS.map((p) => [p.id, p]),
);

// Anyone with a database from the old 7-palette era gets mapped to the
// closest match among the current twenty, same table as theme.py's
// _LEGACY_MODE_MAP.
const LEGACY_MODE_MAP: Record<string, string> = {
  light: "winter_frost",
  dark: "stormy_morning",
  sleek_indigo: "stormy_morning",
  neon_cyan: "cobalt_rush",
  crisp_light: "winter_frost",
  emerald_terminal: "mossy_hollow",
  warm_amber: "sandstone",
  violet_nebula: "magenta_pulse",
  mac_glass: "ocean_mist",
};

export function resolveThemeId(value: string | null | undefined): string {
  if (value === CUSTOM_THEME_ID || value === SYSTEM_THEME_ID || (value && PRESET_BY_ID[value])) {
    return value as string;
  }
  if (value && LEGACY_MODE_MAP[value]) {
    return LEGACY_MODE_MAP[value];
  }
  return DEFAULT_THEME_ID;
}

const SYSTEM_SEEDS_LIGHT: PaletteSeeds = {
  appBg: "#F4F6FA",
  panelBg: "#FFFFFF",
  textPrimary: "#161B22",
  accent: "#2F6FED",
};
const SYSTEM_SEEDS_DARK: PaletteSeeds = {
  appBg: "#0B0E14",
  panelBg: "#12161F",
  textPrimary: "#EAF0FF",
  accent: "#2F6FED",
};

export function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return true;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export interface ThemeInfo {
  label: string;
  description: string;
  category?: string;
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
  if (resolved === SYSTEM_THEME_ID) {
    const seeds = systemPrefersDark() ? SYSTEM_SEEDS_DARK : SYSTEM_SEEDS_LIGHT;
    return {
      label: "System",
      description:
        'Match System Appearance -- follows your Mac or Windows light/dark setting.',
      palette: derivePalette(seeds),
    };
  }
  const preset = PRESET_BY_ID[resolved];
  return {
    label: preset.label,
    description: preset.description,
    category: preset.category,
    palette: derivePalette(preset.seeds),
  };
}

export const DEFAULT_CUSTOM_SEEDS: PaletteSeeds = {
  appBg: "#05070F",
  panelBg: "#0B1020",
  textPrimary: "#EAF0FF",
  accent: "#2F6FED",
};
