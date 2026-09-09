/* ---------- theme ----------
 * Infor brand palette. Neutral Gray-Tint canvas, Infor Red as the brand
 * signature, Infor Purple as the interactive and data-visualization accent.
 * Tokens are deliberately stable in NAME so the rest of the app keeps working
 * when the palette swings; only values move.
 *
 * Every color token is a var() reference resolved by src/index.css, where the
 * brand primitives and the light/dark/print palettes live. The [data-theme]
 * attribute on <html> picks the palette, which is what lets the theme toggle
 * restyle the whole app without re-rendering. Numeric tokens (radii) stay
 * literal. If you ever need a raw hex (canvas, color math), read the computed
 * style — don't paste hex here.
 *
 * THE ONE RULE THAT KEEPS THIS BRAND-COMPLIANT:
 *   `ok` / `warn` / `danger` are STATUS tokens — text, pills, dots, single-stat
 *   emphasis. They are NOT a categorical chart palette. Chart geometry uses the
 *   viz* / categorical / vizRamp tokens below. That separation is what stops
 *   charts from re-deriving the red+green pairing the brand prohibits.
 */
export const T = {
  // Surfaces
  bg: "var(--t-bg)",              // page background — Infor Gray Tint
  surface: "var(--t-surface)",    // cards, sidebars
  surfaceAlt: "var(--t-surface-alt)",   // raised wells, hover, segmented bg
  surfaceSunk: "var(--t-surface-sunk)", // pre-card wells (filter bar background, etc.)

  // Ink
  ink: "var(--t-ink)",            // primary text / strong numerals — Infor Charcoal
  sub: "var(--t-sub)",            // secondary text
  muted: "var(--t-muted)",        // tertiary / decorative labels
  border: "var(--t-border)",      // standard hairline
  borderSoft: "var(--t-border-soft)", // softer divider

  // Brand — Infor Red. `accent` is a FILL role: Infor Red is 4.51:1 on white
  // but only 4.06:1 on the tinted canvas, so it cannot carry small text.
  // Accent-colored TEXT uses `accentDeep` (Red Shade 01), and text sitting on
  // any red tint fill uses `onAccentSoft` (Red Shade 02).
  accent: "var(--t-accent)",          // primary accent fill / interactive emphasis
  accentDeep: "var(--t-accent-deep)", // pressed, dense red moments, AND accent text
  accentSoft: "var(--t-accent-soft)", // tinted fills
  accentTint: "var(--t-accent-tint)", // ultra-soft red wash for hovers
  onAccent: "var(--t-on-accent)",     // text/icons sitting on accent fills
  onAccentSoft: "var(--t-on-accent-soft)", // text sitting on ANY red tint fill

  // External-system reference tints — inline TEXT ONLY, never chart geometry.
  // Deliberate, documented brand exceptions: they tell an analyst at a glance
  // which system a reference belongs to, and collapsing both onto Infor Purple
  // would make CS… and HMS-… identical. Tune in index.css.
  snGreen: "var(--t-sn-green)",   // ServiceNow case numbers (CS…) — Infor Green Shade
  jiraBlue: "var(--t-jira-blue)", // ALL Jira/ticket keys (HMS-123…, RN-…). Closed
                                  // state is conveyed by strikethrough and non-Jira
                                  // (RN-) refs by tooltip, never by greying the id.

  // Semantic status. `ok` is Infor PURPLE, not green — see the note in
  // index.css: while `ok` was green and `danger` red, every good/bad pairing in
  // the app was automatically the brand's one absolute prohibition, and the
  // pair measured 1.01:1 under deuteranopia. Infor Green survives as `okFill`,
  // chart marks only.
  ok: "var(--t-ok)",
  okSoft: "var(--t-ok-soft)",
  warn: "var(--t-warn)",
  warnSoft: "var(--t-warn-soft)",
  danger: "var(--t-danger)",
  dangerSoft: "var(--t-danger-soft)",

  // Priority palette — TEXT positions. All four are text-safe in both themes.
  priorityCritical: "var(--t-priority-critical)",
  priorityMajor:    "var(--t-priority-major)",
  priorityMedium:   "var(--t-priority-medium)",
  priorityStandard: "var(--t-priority-standard)",

  // Priority CHART fills (the text tiers stay on priority* above).
  priorityCriticalFill: "var(--t-priority-critical-fill)",
  priorityMajorFill:    "var(--t-priority-major-fill)",
  priorityMediumFill:   "var(--t-priority-medium-fill)",
  priorityStandardFill: "var(--t-priority-standard-fill)",

  // Infor Purple data-viz accent — the brand's "PRIORITIZE PURPLE as the accent
  // color in data visualization over green/yellow", and the lead of the duotone
  // mode it names as the default for single-metric views.
  vizAccent: "var(--t-viz-accent)",
  vizAccentDeep: "var(--t-viz-accent-deep)",
  vizAccentSoft: "var(--t-viz-accent-soft)",
  onViz: "var(--t-on-viz)",       // text/icons on a purple fill

  // Fill-only members of the tertiary palette. NEVER use as text: Infor Green
  // is 2.49:1 on white and Infor Yellow 1.88:1.
  okFill: "var(--t-ok-fill)",
  warnFill: "var(--t-warn-fill)",
  dangerFill: "var(--t-danger-fill)",

  // Chart chrome — uniform across every charting file.
  vizWell: "var(--t-viz-well)",     // plot ground (the brand's "subtle Gray Tint")
  vizGrid: "var(--t-viz-grid)",     // CartesianGrid stroke
  vizAxis: "var(--t-viz-axis)",     // axisLine / tickLine / ReferenceLine
  vizTick: "var(--t-viz-tick)",     // numeric tick TEXT
  vizCat: "var(--t-viz-cat)",       // category tick + table header text
  vizStroke: "var(--t-viz-stroke)", // 1px perceivability stroke — mandatory on
                                    // any fill under 3:1 against its ground

  // Ordinal ramp, low → high. One family, strictly monotonic in luminance, so
  // it stays orderable in grayscale (the Monthly Summary prints) and under
  // deuteranomaly. Replaces the old green→yellow→red→red age ramps, whose last
  // two steps were visually identical.
  vizRamp: [
    "var(--t-viz-r1)",
    "var(--t-viz-r2)",
    "var(--t-viz-r3)",
    "var(--t-viz-r4)",
  ],

  // Categorical ramp — an ordered Infor Purple tint ladder, dark → light. ONE
  // color family however many categories there are, so the "max 3 color
  // families in any single data visualization" cap is satisfied outright.
  // Slot 8 is the achromatic residual ("Other"), not a hue.
  //
  // INDEX PAST THE END WITH `categoricalAt(i)`, NEVER `i % length` — modulo
  // would restart the ladder and hand two categories the same color; the
  // helper clamps onto the residual slot instead.
  categorical: [
    "var(--t-cat-1)",
    "var(--t-cat-2)",
    "var(--t-cat-3)",
    "var(--t-cat-4)",
    "var(--t-cat-5)",
    "var(--t-cat-6)",
    "var(--t-cat-7)",
    "var(--t-cat-8)",
  ],

  // Effects (additive — safe to ignore in older callsites)
  scrim: "var(--t-scrim)",        // modal/dialog backdrop
  shadowSm: "var(--t-shadow-sm)", // `none` — resting surfaces are defined by
                                  // their hairline, which is what satisfies the
                                  // brand's "largest shape never has a drop
                                  // shadow" companion clause
  shadowMd: "var(--t-shadow-md)", // the brand shadow: 15% / 10px / top-left
  shadowLg: "var(--t-shadow-lg)", // aliased to shadowMd — the brand specifies
                                  // ONE shadow and forbids mixing depths
  ring:     "var(--t-ring)",
  radiusSm: 6,
  radiusMd: 10,
  radiusLg: 14,
  radiusChart: 4,                 // chart marks — "rounded rectangular edges"
};

/* Categorical color for series index `i`, clamped onto the residual slot once
 * the ladder runs out. Encoding the fallback here rather than at each callsite
 * is what stops a newly-added product line or parent account from introducing a
 * new hue and blowing the 3-family cap. */
export function categoricalAt(i) {
  return T.categorical[Math.min(i, T.categorical.length - 1)];
}

/* Translucent version of any token (or CSS color). Replaces the old
 * `T.accent + "22"` hex-alpha concatenation, which can't work now that token
 * values are var() references.
 *
 * Prefer a real tint token (accentTint, okSoft, vizAccentSoft, vizWell) for
 * background fills — the brand forbids ad-hoc opacity tricks, and a tint token
 * is theme-correct where a composited alpha is only theme-lucky. alpha() stays
 * for the cases that genuinely need it: scrims, focus glows, and hover washes
 * over unknown grounds. Keep fractions on the documented ladder below. */
export function alpha(color, fraction) {
  return `color-mix(in srgb, ${color} ${+(fraction * 100).toFixed(1)}%, transparent)`;
}

/* The three sanctioned alpha steps, replacing 22 ad-hoc fractions. */
export const ALPHA_SOFT = 0.08;
export const ALPHA_MED = 0.15;
export const ALPHA_STRONG = 0.4;

/* Sequential intensity ramp for "how much" heatmaps (case volume, mix share)
 * as opposed to "how risky" ones (which should keep using warn/danger through
 * `alpha()` or the ordinal vizRamp).
 *
 * SIGNATURE AND MATH UNCHANGED — callers pass the same fraction and get the
 * same monotonic ramp. Only the two endpoints moved, and they are tokens rather
 * than literals so the function stays theme-reactive.
 *
 * The ramp is bounded deliberately short of full Infor Purple so that ONE text
 * color works on EVERY cell: T.ink reads 14.02:1 at the low end and 8.52:1 at
 * the high end in light, 10.78:1 → 5.53:1 in dark. That is what lets callers
 * drop the old conditional white-text flip, which had a 50–70% band where
 * neither ink nor white cleared 4.5:1. */
export function neutralHeat(frac) {
  return `color-mix(in srgb, var(--t-heat-to) ${Math.round(frac * 100)}%, var(--t-heat-from))`;
}

/* ---------- shared chart specs ----------
 * One definition each, imported by the chart blocks, so 35 tooltips and 42 axis
 * tick objects can never drift apart again. */

/* Floating chart panel (tooltips). Replaces 33 copy-pasted divs at three
 * different radii. */
export const TOOLTIP_STYLE = {
  background: T.surface,
  border: `1px solid ${T.vizAxis}`,
  borderRadius: T.radiusMd,
  boxShadow: T.shadowMd,
  padding: "10px 14px",
  fontSize: 12,
  color: T.ink,
};

/* recharts axis tick spec. `tabular-nums` is the functional replacement for the
 * monospace face the brand does not sanction — Inter ships genuine tnum. */
export const AXIS_TICK = {
  fill: T.vizTick,
  fontSize: 11,
  fontFamily: "var(--sans)",
  fontVariantNumeric: "tabular-nums",
};

/* Category (non-numeric) axis ticks read as labels, not figures. */
export const AXIS_TICK_CAT = {
  fill: T.vizCat,
  fontSize: 11,
  fontFamily: "var(--sans)",
};

/* recharts Legend. `textAlign: left` is required — recharts centers by default
 * and the brand mandates left-aligned type. */
export const LEGEND_STYLE = {
  fontSize: 11,
  color: T.vizTick,
  textAlign: "left",
  paddingLeft: 8,
};

/* Bar corner rounding — "rounded rectangular edges". Apply to the TERMINAL bar
 * or top-of-stack segment only; interior stack segments stay square. Never
 * change a radius array's LENGTH, only its values, so no recharts layout moves. */
export const BAR_RADIUS_V = [4, 4, 0, 0];
export const BAR_RADIUS_H = [0, 4, 4, 0];

/* One pie/donut spec. Separating slices with a surface-colored stroke is what
 * guarantees no two fills ever sit directly adjacent. */
export const PIE_SPEC = {
  cornerRadius: 4,
  paddingAngle: 3,
  stroke: "var(--t-surface)",
  strokeWidth: 2,
};
