import { useState } from "react";
import { T } from "../../lib/theme.js";
import { RISK_HIGH, RISK_ELEVATED } from "../../lib/sentiment.js";

/* Sentiment presentation tokens and helpers — the non-component half of
 * sentiment-shared.jsx, kept in a plain module so Fast Refresh stays happy
 * (a file that exports both components and constants breaks it).
 *
 * Colour discipline: every value here lands on TEXT, a pill or a small icon, so
 * each token has to be text-safe. T.ok is Infor Purple, so no good/bad pairing
 * is ever red-and-green, and the saturated Infor Green/Yellow cores stay
 * fill-only. */

export const SENTIMENT_STYLE = `
  .sentiment-expand {
    appearance: none; background: none; border: none; margin: 0;
    font: inherit; color: inherit; cursor: pointer;
    display: inline-flex; align-items: center; gap: 4px;
    padding: 2px; border-radius: ${T.radiusSm}px; color: ${T.muted};
  }
  .sentiment-expand:hover { color: ${T.vizAccent}; }
  .sentiment-row { cursor: pointer; transition: background 0.14s ease; }
  .sentiment-row:hover { background: ${T.vizWell}; }
  .sentiment-chev { transition: transform 0.15s ease; }
  .sentiment-seg {
    appearance: none; border: 1px solid ${T.border}; background: ${T.surface};
    color: ${T.sub}; font: inherit; font-size: 12px; font-weight: 600;
    padding: 7px 14px; cursor: pointer;
  }
  /* Pressed segment is the Infor Purple interactive colorway on real tint
     tokens — Purple Tint 01 ground, Purple Shade ink, Infor Purple hairline. */
  .sentiment-seg[aria-pressed="true"] { background: ${T.vizAccentSoft}; color: ${T.vizAccentDeep}; border-color: ${T.vizAccent}; }
  .sentiment-seg:first-child { border-radius: ${T.radiusSm}px 0 0 ${T.radiusSm}px; }
  .sentiment-seg:last-child { border-radius: 0 ${T.radiusSm}px ${T.radiusSm}px 0; }
  .sentiment-seg + .sentiment-seg { border-left: none; }
  @media (prefers-reduced-motion: reduce) {
    .sentiment-row, .sentiment-chev { transition: none; }
  }
`;

/* Diverging TEXT scale: Infor Purple (good) / neutral gray (middle) / Infor Red
 * Shade (bad). */
export const valColor = (v) => (v == null ? T.muted : v > 0 ? T.ok : v < 0 ? T.danger : T.sub);
export const sentColor = (s) => (s === "Positive" ? T.ok : s === "Negative" ? T.danger : T.sub);
/* Risk ramp, low → high: purple (calm) → neutral (watch) → Infor Yellow Shade
 * (elevated) → Infor Red Shade (high/escalated). Purple carries the base stop,
 * so yellow is never red's only partner. */
export const riskColor = (r, escalated) =>
  escalated ? T.danger : r == null ? T.muted : r >= RISK_HIGH ? T.danger : r >= RISK_ELEVATED ? T.warn : r >= 15 ? T.sub : T.ok;
export const riskLabel = (r) =>
  r >= RISK_HIGH ? "High" : r >= RISK_ELEVATED ? "Elevated" : r >= 15 ? "Watch" : "Calm";


export const thStyle = (align = "left") => ({
  padding: "8px 12px", textAlign: align, fontWeight: 600, color: T.sub,
  borderBottom: `1px solid ${T.borderSoft}`, whiteSpace: "nowrap", fontSize: 12,
});
export const tdStyle = { padding: "8px 12px", verticalAlign: "top" };


export function useExpand() {
  const [openCase, setOpenCase] = useState(null);
  return [openCase, (n) => setOpenCase((c) => (c === n ? null : n))];
}
