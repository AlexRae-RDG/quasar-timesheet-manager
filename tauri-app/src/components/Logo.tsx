/** Simplified stand-in for theme.py's hand-drawn draw_logo_mark (a
 * clock-faced sphere wrapped in a tilted ring system) -- a full port of
 * that ~130-line canvas routine wasn't worth doing for the nav shell pass.
 * Keeps the same idea (a themed ring + core) using the live --accent
 * color so it re-themes along with everything else. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <ellipse
        cx="16"
        cy="17"
        rx="14"
        ry="4.5"
        transform="rotate(-20 16 17)"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2"
        opacity="0.55"
      />
      <circle cx="16" cy="14" r="7" fill="var(--accent)" />
      <circle cx="16" cy="14" r="5.2" fill="none" stroke="white" strokeOpacity="0.3" />
      <line x1="16" y1="14" x2="14" y2="10.5" stroke="white" strokeWidth="1.4" strokeLinecap="round" />
      <line x1="16" y1="14" x2="19" y2="12" stroke="white" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
