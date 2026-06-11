/* ---------- theme ----------
 * Refined enterprise palette. Light, neutral canvas with Infor red as the
 * signature accent. Tokens are deliberately stable in NAME so the rest of
 * the app keeps working when the palette swings; only values move.
 *
 * Every color token is a var() reference resolved by src/index.css, where the
 * light and dark palettes live. The [data-theme] attribute on <html> picks the
 * palette, which is what lets the theme toggle restyle the whole app without
 * re-rendering. Numeric tokens (radii) stay literal. If you ever need a raw
 * hex (canvas, color math), read the computed style — don't paste hex here.
 */
export const T = {
  // Surfaces
  bg: "var(--t-bg)",              // page background — cool neutral
  surface: "var(--t-surface)",    // cards, sidebars
  surfaceAlt: "var(--t-surface-alt)",   // raised wells, hover, segmented bg
  surfaceSunk: "var(--t-surface-sunk)", // pre-card wells (filter bar background, etc.)

  // Ink
  ink: "var(--t-ink)",            // primary text / strong numerals
  sub: "var(--t-sub)",            // secondary text
  muted: "var(--t-muted)",        // tertiary / decorative labels
  border: "var(--t-border)",      // standard hairline
  borderSoft: "var(--t-border-soft)", // softer divider

  // Brand — Infor red
  accent: "var(--t-accent)",          // primary accent / interactive emphasis
  accentDeep: "var(--t-accent-deep)", // pressed / dense red moments
  accentSoft: "var(--t-accent-soft)", // tinted fills
  accentTint: "var(--t-accent-tint)", // ultra-soft red wash for hovers
  onAccent: "var(--t-on-accent)",     // text/icons sitting on accent fills

  // ServiceNow brand green — tints case numbers (CS…). Tune in index.css.
  snGreen: "var(--t-sn-green)",

  // Atlassian/Jira brand blue — tints ALL Jira/ticket keys (HMS-123…, RN-…):
  // closed state is conveyed by strikethrough and non-Jira (RN-) refs by
  // tooltip, never by greying the id. Tune in index.css.
  jiraBlue: "var(--t-jira-blue)",

  // Semantic
  ok: "var(--t-ok)",
  okSoft: "var(--t-ok-soft)",
  warn: "var(--t-warn)",
  warnSoft: "var(--t-warn-soft)",
  danger: "var(--t-danger)",
  dangerSoft: "var(--t-danger-soft)",

  // Priority palette — modernized tones
  priorityCritical: "var(--t-priority-critical)",
  priorityMajor:    "var(--t-priority-major)",
  priorityMedium:   "var(--t-priority-medium)",
  priorityStandard: "var(--t-priority-standard)",

  // Effects (additive — safe to ignore in older callsites)
  scrim: "var(--t-scrim)",        // modal/dialog backdrop
  shadowSm: "var(--t-shadow-sm)",
  shadowMd: "var(--t-shadow-md)",
  shadowLg: "var(--t-shadow-lg)",
  ring:     "var(--t-ring)",
  radiusSm: 6,
  radiusMd: 10,
  radiusLg: 14,
};

/* Translucent version of any token (or CSS color). Replaces the old
 * `T.accent + "22"` hex-alpha concatenation, which can't work now that token
 * values are var() references. */
export function alpha(color, fraction) {
  return `color-mix(in srgb, ${color} ${+(fraction * 100).toFixed(1)}%, transparent)`;
}
