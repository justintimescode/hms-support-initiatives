/* ---------- theme ----------
 * Refined enterprise palette. Light, neutral canvas with Infor red as the
 * signature accent. Tokens are deliberately stable in NAME so the rest of
 * the app keeps working when the palette swings; only values move.
 */
export const T = {
  // Surfaces
  bg: "#F6F6F7",          // page background — cool neutral
  surface: "#FFFFFF",     // cards, sidebars
  surfaceAlt: "#F1F2F4",  // raised wells, hover, segmented bg
  surfaceSunk: "#FAFAFB", // pre-card wells (filter bar background, etc.)

  // Ink
  ink: "#0E0E10",         // primary text / strong numerals
  sub: "#52525B",         // secondary text
  muted: "#9A9AA3",       // tertiary / decorative labels
  border: "#E4E4E7",      // standard hairline
  borderSoft: "#EEEEF0",  // softer divider

  // Brand — Infor red
  accent: "#DA291C",      // primary accent / interactive emphasis
  accentDeep: "#B11E14",  // pressed / dense red moments
  accentSoft: "#FBE3E0",  // tinted fills
  accentTint: "#FEF3F2",  // ultra-soft red wash for hovers

  // Semantic
  ok: "#137A4D",
  okSoft: "#DCF1E4",
  warn: "#B45309",
  warnSoft: "#FCE9C5",
  danger: "#B91C1C",
  dangerSoft: "#FBDDDB",

  // Priority palette — modernized tones
  priorityCritical: "#B91C1C",
  priorityMajor:    "#B45309",
  priorityMedium:   "#137A4D",
  priorityStandard: "#475569",

  // Effects (additive — safe to ignore in older callsites)
  shadowSm: "0 1px 2px rgba(15, 15, 17, 0.04), 0 1px 1px rgba(15, 15, 17, 0.03)",
  shadowMd: "0 4px 12px rgba(15, 15, 17, 0.06), 0 1px 3px rgba(15, 15, 17, 0.04)",
  shadowLg: "0 12px 32px rgba(15, 15, 17, 0.08), 0 2px 6px rgba(15, 15, 17, 0.04)",
  ring:     "0 0 0 3px rgba(218, 41, 28, 0.18)",
  radiusSm: 6,
  radiusMd: 10,
  radiusLg: 14,
};
