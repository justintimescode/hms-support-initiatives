import { useMemo, useState } from "react";
import { TrendingUp, TrendingDown, Ban, AlertTriangle } from "lucide-react";
import { T, alpha } from "../../lib/theme.js";
import { accountChurnRisk } from "../../lib/stats.js";
import { Card } from "../layout/Card.jsx";

const WINDOW_DAYS = 90;
const CAP = 15;

/* ================= Account Churn-Risk =================
 * Ranks accounts by a transparent composite of three pressures: rising case
 * volume (last 90 days vs the prior 90), falling SLA over the same comparison,
 * and open Jira-blocked / breached cases right now. The contributing signals
 * are shown as chips so the ranking is explainable, not a black box. Uses the
 * full dataset (all analysts) and is anchored to the data snapshot. */
export function AccountRiskBlock({ rows, snapshotMs }) {
  const [expanded, setExpanded] = useState(false);
  const ranked = useMemo(
    () => accountChurnRisk(rows || [], snapshotMs || undefined, WINDOW_DAYS),
    [rows, snapshotMs],
  );
  const visible = expanded ? ranked : ranked.slice(0, CAP);

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div>
          <div className="eyebrow" style={{ color: T.muted }}>Account churn-risk signal</div>
          <div style={{ color: T.sub, fontSize: 12, marginTop: 4, maxWidth: 700 }}>
            Accounts trending the wrong way — rising case volume, falling SLA, and open work blocked on engineering. Compares the last {WINDOW_DAYS} days against the prior {WINDOW_DAYS}, across all analysts (independent of the filters above). The chips show which signals fired.
          </div>
        </div>
      </div>

      {ranked.length === 0 ? (
        <div style={{ color: T.sub, fontSize: 13, fontStyle: "italic", marginTop: 14 }}>
          No accounts are showing elevated churn-risk signals in this dataset.
        </div>
      ) : (
        <>
          <div style={{ marginTop: 12, overflowX: "auto" }} className="scrollbar">
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: T.surfaceAlt }}>
                  <th style={TH}>Account</th>
                  <th style={{ ...TH, textAlign: "right" }}>Cases (90d vs prev)</th>
                  <th style={{ ...TH, textAlign: "right" }}>SLA (90d vs prev)</th>
                  <th style={{ ...TH, textAlign: "right" }}>Open blocked</th>
                  <th style={{ ...TH, textAlign: "right" }}>Open breached</th>
                  <th style={TH}>Signals</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((a) => (
                  <tr key={a.account} style={{ borderBottom: `1px solid ${T.borderSoft}` }}>
                    <td style={{ ...TD, fontWeight: 600, maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis" }}>{a.account}</td>
                    <td className="mono" style={{ ...TD, textAlign: "right" }}>
                      <span style={{ fontWeight: 600 }}>{a.casesNow}</span>
                      <span style={{ color: T.muted }}> vs {a.casesPrev}</span>
                      <Trend up={a.volDelta > 0} flat={a.volDelta === 0} badWhenUp />
                    </td>
                    <td className="mono" style={{ ...TD, textAlign: "right" }}>
                      {a.slaNow == null ? "—" : `${a.slaNow.toFixed(0)}%`}
                      <span style={{ color: T.muted }}> vs {a.slaPrev == null ? "—" : `${a.slaPrev.toFixed(0)}%`}</span>
                      {a.slaNow != null && a.slaPrev != null && (
                        <Trend up={a.slaDrop < 0} flat={Math.abs(a.slaDrop) < 0.5} badWhenUp={false} />
                      )}
                    </td>
                    <td className="mono" style={{ ...TD, textAlign: "right", color: a.openBlockers ? T.accent : T.muted }}>{a.openBlockers}</td>
                    <td className="mono" style={{ ...TD, textAlign: "right", color: a.breachedOpen ? T.danger : T.muted }}>{a.breachedOpen}</td>
                    <td style={TD}>
                      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                        {a.risingVolume && <Chip icon={TrendingUp} label="volume" tone={T.warn} />}
                        {a.fallingSla && <Chip icon={TrendingDown} label="SLA" tone={T.danger} />}
                        {a.openBlockers > 0 && <Chip icon={Ban} label={`${a.openBlockers} blocked`} tone={T.accent} />}
                        {a.breachedOpen > 0 && <Chip icon={AlertTriangle} label={`${a.breachedOpen} breached`} tone={T.danger} />}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {ranked.length > CAP && (
            <div style={{ marginTop: 10, textAlign: "center" }}>
              <button
                onClick={() => setExpanded((v) => !v)}
                style={{ background: "none", border: `1px solid ${T.border}`, color: T.sub, padding: "6px 14px", borderRadius: 4, cursor: "pointer", fontSize: 12 }}
              >
                {expanded ? `Show top ${CAP}` : `Show all ${ranked.length}`}
              </button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

const TH = { textAlign: "left", padding: "8px 12px", color: T.sub, fontWeight: 600, borderBottom: `1px solid ${T.borderSoft}`, whiteSpace: "nowrap" };
const TD = { padding: "8px 12px", whiteSpace: "nowrap" };

/** Directional arrow. `badWhenUp` controls coloring: for volume, up is bad
 *  (red); for SLA we pass the already-direction-corrected `up`. */
function Trend({ up, flat, badWhenUp }) {
  if (flat) return <span style={{ color: T.muted, marginLeft: 5 }}>→</span>;
  const good = badWhenUp ? !up : up;
  const color = good ? T.ok : T.danger;
  const Icon = up ? TrendingUp : TrendingDown;
  return <Icon size={12} style={{ color, marginLeft: 5, verticalAlign: "middle" }} />;
}

function Chip({ icon: Icon, label, tone }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 7px", borderRadius: 4, background: alpha(tone, 0.1), color: tone, fontSize: 10.5, fontWeight: 600 }}>
      <Icon size={11} /> {label}
    </span>
  );
}
