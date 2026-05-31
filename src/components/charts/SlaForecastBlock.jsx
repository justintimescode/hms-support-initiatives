import { useMemo, useState } from "react";
import { AlertTriangle, Clock } from "lucide-react";
import { T } from "../../lib/theme.js";
import { fmtDuration, fmtFullDate, priorityColor } from "../../lib/format.js";
import { slaBreachForecast } from "../../lib/stats.js";
import { Card } from "../layout/Card.jsx";
import { Pill } from "../Pill.jsx";
import { CopyableNumber } from "../CopyableNumber.jsx";

const HORIZON_DAYS = 7;
const CAP = 15;

/* ================= SLA Breach Forecast =================
 * A forward-looking complement to the Update Queue: open cases NOT yet breached
 * whose SLA deadline lands within the next 7 days, ranked soonest-first. The
 * "momentum" read (time since last Infor update) flags cases that, on current
 * cadence, are unlikely to get attention before they breach. Snapshot-anchored
 * so it's deterministic for a given dataset. */
export function SlaForecastBlock({ rows, snapshotMs }) {
  const [expanded, setExpanded] = useState(false);
  const forecast = useMemo(
    () => slaBreachForecast(rows || [], snapshotMs || undefined, HORIZON_DAYS),
    [rows, snapshotMs],
  );

  const summary = useMemo(() => {
    let next24 = 0, in3d = 0, later = 0, stalled = 0;
    for (const f of forecast) {
      if (f.timeToBreach <= 24 * 36e5) next24++;
      else if (f.timeToBreach <= 3 * 864e5) in3d++;
      else later++;
      if (f.stalled || f.noResponseYet) stalled++;
    }
    return { next24, in3d, later, stalled };
  }, [forecast]);

  const visible = expanded ? forecast : forecast.slice(0, CAP);

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div>
          <div className="eyebrow" style={{ color: T.muted }}>SLA breach forecast · next {HORIZON_DAYS} days</div>
          <div style={{ color: T.sub, fontSize: 12, marginTop: 4, maxWidth: 680 }}>
            Open cases due to breach within the window, soonest first — act on these before they show up as misses. <strong style={{ color: T.danger }}>Stalled</strong> = no update in longer than the time remaining, so on current cadence it's heading for a breach.
          </div>
        </div>
        {snapshotMs && (
          <span style={{ color: T.muted, fontSize: 11 }}>as of {fmtFullDate(snapshotMs)}</span>
        )}
      </div>

      {/* horizon summary */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
        <HorizonChip label="Next 24h" value={summary.next24} tone={T.danger} />
        <HorizonChip label="2–3 days" value={summary.in3d} tone={T.warn} />
        <HorizonChip label="4–7 days" value={summary.later} tone={T.sub} />
        <HorizonChip label="At momentum risk" value={summary.stalled} tone={T.danger} icon={AlertTriangle} />
      </div>

      {forecast.length === 0 ? (
        <div style={{ color: T.sub, fontSize: 13, fontStyle: "italic", marginTop: 14 }}>
          No open case is on track to breach within {HORIZON_DAYS} days. Breathing room.
        </div>
      ) : (
        <>
          <div style={{ marginTop: 12, overflowX: "auto" }} className="scrollbar">
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: T.surfaceAlt }}>
                  <th style={TH}>Case</th>
                  <th style={TH}>Priority</th>
                  <th style={TH}>Breaches in</th>
                  <th style={TH}>Last update</th>
                  <th style={TH}>Assignee</th>
                  <th style={TH}>Account</th>
                  <th style={TH}>Description</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(({ row: r, timeToBreach, sinceTouch, stalled, noResponseYet }) => {
                  const soon = timeToBreach <= 24 * 36e5;
                  return (
                    <tr key={r.number} style={{ borderBottom: `1px solid ${T.borderSoft}` }}>
                      <td className="mono" style={{ ...TD, fontWeight: 600 }}><CopyableNumber value={r.number} /></td>
                      <td style={TD}><Pill color={priorityColor(r.priority)}>{String(r.priority || "").split(" - ")[1] || r.priority || "—"}</Pill></td>
                      <td className="mono" style={{ ...TD, color: soon ? T.danger : T.warn, fontWeight: 600 }}>
                        <Clock size={11} style={{ verticalAlign: "middle", marginRight: 4 }} />{fmtDuration(timeToBreach)}
                      </td>
                      <td className="mono" style={{ ...TD, color: stalled ? T.danger : T.sub }}>
                        {sinceTouch == null ? "—" : `${fmtDuration(sinceTouch)} ago`}
                        {stalled && <RiskTag label="stalled" tone={T.danger} />}
                        {!stalled && noResponseYet && <RiskTag label="no response" tone={T.warn} />}
                      </td>
                      <td style={TD}>{r.assigned_to || "Unassigned"}</td>
                      <td style={TD}>{r.account || "—"}</td>
                      <td style={TD_DESC}>{r.short_description || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {forecast.length > CAP && (
            <div style={{ marginTop: 10, textAlign: "center" }}>
              <button
                onClick={() => setExpanded((v) => !v)}
                style={{ background: "none", border: `1px solid ${T.border}`, color: T.sub, padding: "6px 14px", borderRadius: 4, cursor: "pointer", fontSize: 12 }}
              >
                {expanded ? `Show top ${CAP}` : `Show all ${forecast.length}`}
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
const TD_DESC = { padding: "8px 12px", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

function HorizonChip({ label, value, tone, icon: Icon }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", borderRadius: 8, background: T.surfaceAlt, border: `1px solid ${T.borderSoft}` }}>
      {Icon && <Icon size={13} style={{ color: tone }} />}
      <span className="mono" style={{ fontSize: 18, fontWeight: 600, color: value ? tone : T.muted, lineHeight: 1 }}>{value}</span>
      <span className="eyebrow" style={{ color: T.muted }}>{label}</span>
    </div>
  );
}

function RiskTag({ label, tone }) {
  return (
    <span style={{ marginLeft: 6, padding: "1px 6px", borderRadius: 4, background: tone + "1a", color: tone, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
      {label}
    </span>
  );
}
