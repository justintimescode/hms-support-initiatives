import { useState, useMemo } from "react";
import { T } from "../lib/theme.js";
import { fmtDuration, priorityColor, ageDays } from "../lib/format.js";
import { stuckCases } from "../lib/stats.js";
import { Card } from "./layout/Card.jsx";
import { CopyableNumber } from "./CopyableNumber.jsx";

/* ================= Stuck Cases List ================= */
export function StuckCasesList({ rows, thresholdDays = 30, showAssignee = false }) {
  const stuck = useMemo(() => stuckCases(rows, thresholdDays), [rows, thresholdDays]);
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? stuck : stuck.slice(0, 10);

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div>
          <div className="eyebrow">Stuck cases · open more than {thresholdDays} days</div>
          <div style={{ color: T.sub, fontSize: 12, marginTop: 4, maxWidth: 720 }}>
            The single highest-signal-per-pixel view for 1:1s. Sorted oldest first. {showAssignee ? "Each row shows its assignee." : "Filtered to this analyst's queue."}
          </div>
        </div>
        <div className="mono" style={{ fontSize: 12, color: stuck.length ? T.danger : T.muted, fontWeight: 600 }}>
          {stuck.length} case{stuck.length === 1 ? "" : "s"}
        </div>
      </div>

      {stuck.length === 0 ? (
        <div style={{ color: T.sub, fontSize: 13, fontStyle: "italic", marginTop: 12 }}>Nothing stuck. Clean slate.</div>
      ) : (
        <>
          <div style={{ marginTop: 12, overflowX: "auto" }} className="scrollbar">
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: T.surfaceAlt }}>
                  <th style={{ textAlign: "left", padding: "8px 12px", color: T.sub, fontWeight: 600, borderBottom: `1px solid ${T.borderSoft}` }}>Case</th>
                  {showAssignee && (
                    <th style={{ textAlign: "left", padding: "8px 12px", color: T.sub, fontWeight: 600, borderBottom: `1px solid ${T.borderSoft}` }}>Assignee</th>
                  )}
                  <th style={{ textAlign: "left", padding: "8px 12px", color: T.sub, fontWeight: 600, borderBottom: `1px solid ${T.borderSoft}` }}>Priority</th>
                  <th style={{ textAlign: "left", padding: "8px 12px", color: T.sub, fontWeight: 600, borderBottom: `1px solid ${T.borderSoft}` }}>Account</th>
                  <th style={{ textAlign: "left", padding: "8px 12px", color: T.sub, fontWeight: 600, borderBottom: `1px solid ${T.borderSoft}` }}>Age</th>
                  <th style={{ textAlign: "left", padding: "8px 12px", color: T.sub, fontWeight: 600, borderBottom: `1px solid ${T.borderSoft}` }}>SLA</th>
                  <th style={{ textAlign: "left", padding: "8px 12px", color: T.sub, fontWeight: 600, borderBottom: `1px solid ${T.borderSoft}` }}>Description</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const age = ageDays(r._created);
                  const now = Date.now();
                  let slaText = "—";
                  let slaColor = T.muted;
                  if (r._slaDueSop) {
                    const ms = r._slaDueSop.getTime() - now;
                    if (ms < 0) { slaText = `breached ${fmtDuration(-ms)}`; slaColor = T.danger; }
                    else if (ms < 24 * 36e5) { slaText = `due in ${fmtDuration(ms)}`; slaColor = T.warn; }
                    else { slaText = `in ${fmtDuration(ms)}`; slaColor = T.sub; }
                  }
                  return (
                    <tr key={r.number} style={{ borderBottom: `1px solid ${T.borderSoft}` }}>
                      <td className="mono" style={{ padding: "8px 12px", whiteSpace: "nowrap", fontWeight: 600 }}><CopyableNumber value={r.number} /></td>
                      {showAssignee && (
                        <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>{r.assigned_to || "Unassigned"}</td>
                      )}
                      <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>
                        <span style={{ color: priorityColor(r.priority), fontWeight: 600 }}>{r.priority || "—"}</span>
                      </td>
                      <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>{r.account || "—"}</td>
                      <td className="mono" style={{ padding: "8px 12px", whiteSpace: "nowrap", color: age > 90 ? T.danger : age > 30 ? T.warn : T.sub }}>{age}d</td>
                      <td className="mono" style={{ padding: "8px 12px", whiteSpace: "nowrap", color: slaColor }}>{slaText}</td>
                      <td style={{ padding: "8px 12px", maxWidth: 380, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.short_description || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {stuck.length > 10 && (
            <div style={{ marginTop: 10 }}>
              <button
                onClick={() => setExpanded((v) => !v)}
                style={{ background: "none", border: `1px solid ${T.border}`, color: T.sub, padding: "6px 14px", borderRadius: T.radiusSm, cursor: "pointer", fontSize: 12 }}
              >
                {expanded ? "Show top 10" : `Show all ${stuck.length}`}
              </button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
