/** Small stylized mark for buttons that talk to Jira (upload, import) --
 * three overlapping rounded diamonds evoking the real mark without tracing
 * it exactly. Uses `currentColor` rather than Jira's own blue: every theme's
 * accent color (what .btn-accent's background is drawn from) is itself some
 * shade of blue, so a fixed Jira-blue icon sat on top with too little
 * contrast in every theme, not just one. Inheriting the button's own text
 * color (white, in .btn-accent) matches how the button's label already
 * solves the same problem. A thin dark stroke is added on top of that fill
 * -- still too low-contrast on its own against some accent shades, since a
 * white-on-light-blue fill has little to work with regardless of hue; the
 * stroke gives each diamond a defined edge independent of exactly how much
 * the fill itself stands out. `fillOpacity` (not the whole element's
 * `opacity`) keeps the second diamond's stroke at full strength even though
 * its own fill is intentionally lighter. */
export function JiraIcon({ size = 14, color = "currentColor" }: { size?: number; color?: string }) {
  const strokeColor = "rgba(0, 0, 0, 0.55)";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 2 L21.5 11.5 C22 12 22 12.6 21.5 13.1 L18 16.6 L12 10.6 Z"
        fill={color}
        stroke={strokeColor}
        strokeWidth="1"
        strokeLinejoin="round"
      />
      <path
        d="M12 8 L17.5 13.5 C18 14 18 14.6 17.5 15.1 L12 20.6 L6.5 15.1 C6 14.6 6 14 6.5 13.5 Z"
        fill={color}
        fillOpacity="0.75"
        stroke={strokeColor}
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </svg>
  );
}
