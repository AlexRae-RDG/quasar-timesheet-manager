import { getTheme, type PaletteSeeds } from "../theme/palettes";

/** Small live preview card for one theme id -- div/CSS equivalent of the
 * Python app's theme.draw_theme_swatch (a hand-drawn Tk Canvas widget). */
export function ThemeSwatch({
  themeId,
  customSeeds,
  selected,
  onClick,
}: {
  themeId: string;
  customSeeds: PaletteSeeds;
  selected: boolean;
  onClick: () => void;
}) {
  const { label, palette } = getTheme(themeId, customSeeds);

  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      style={{
        width: 132,
        height: 88,
        padding: 0,
        borderRadius: 10,
        border: selected ? `3px solid ${palette.ACCENT}` : `1px solid ${palette.BORDER_STRONG}`,
        background: palette.APP_BG,
        cursor: "pointer",
        position: "relative",
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 10,
          bottom: 12,
          borderRadius: 6,
          background: palette.PANEL_BG,
          border: `1px solid ${palette.BORDER}`,
        }}
      >
        <div
          style={{
            margin: "12px 8px 0 8px",
            height: 14,
            borderRadius: 3,
            background: palette.ACCENT,
          }}
        />
        <div
          style={{
            margin: "6px 8px 0 8px",
            width: "62%",
            height: 14,
            borderRadius: 3,
            background: palette.BORDER_STRONG,
          }}
        />
      </div>
      {selected && (
        <div
          style={{
            position: "absolute",
            top: 5,
            right: 5,
            width: 18,
            height: 18,
            borderRadius: "50%",
            background: palette.ACCENT,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "white",
            fontSize: 11,
            lineHeight: 1,
          }}
        >
          ✓
        </div>
      )}
    </button>
  );
}
