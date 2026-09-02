import { alpha, ALPHA_SOFT, ALPHA_MED } from "../lib/theme.js";

/* The status primitive the whole app leans on. Every status in this palette
 * carries at least TWO channels, because as text the approved status colors sit
 * within ~2:1 of each other: a hue-distinct tint chip plus a dot plus the label
 * itself. Keep all three.
 *
 * Type comes from `className="eyebrow"` (Inter, uppercase, 600) rather than a
 * local recipe — the retired monospace face is gone and the eyebrow class is
 * the one micro-label definition. `color` is set after the class so the
 * per-status hue still wins.
 *
 * The size and tracking ARE overridden locally, and deliberately: pills sit in
 * fixed-width table columns as narrow as 70px (SlaBlock's open-cases grid), and
 * the eyebrow class's 11px/0.08em makes the longest label ("Standard", plus the
 * dot and padding) overflow its column. 10px at 0.02em is what the pill has
 * always been sized at, and it keeps the widest label inside 70px.
 *
 * `alpha()` is deliberate here and not the forbidden decorative kind: `color`
 * is an arbitrary caller-supplied token, so no fixed tint token can match it.
 * The two fractions are the sanctioned ALPHA_SOFT / ALPHA_MED steps. */
export function Pill({ color, children }) {
  return (
    <span
      className="eyebrow"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "3px 7px",
        borderRadius: 999,
        background: alpha(color, ALPHA_SOFT),
        color,
        border: `1px solid ${alpha(color, ALPHA_MED)}`,
        fontSize: 10,
        letterSpacing: "0.02em",
        lineHeight: 1.4,
        whiteSpace: "nowrap",
      }}
    >
      <span
        aria-hidden
        style={{
          display: "inline-block",
          width: 5,
          height: 5,
          borderRadius: "50%",
          background: color,
        }}
      />
      {children}
    </span>
  );
}
