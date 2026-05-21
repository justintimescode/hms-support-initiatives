import { useState, useMemo } from "react";
import { T } from "../lib/theme.js";
import { Card } from "./layout/Card.jsx";
import { CopyableNumber } from "./CopyableNumber.jsx";

/* ================= Case Interaction List ================= */
export function CaseInteractionList({ rows }) {
  const sorted = useMemo(
    () => [...rows].sort((a, b) => (b._interactionCount || 0) - (a._interactionCount || 0)),
    [rows]
  )
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? sorted : sorted.slice(0, 10)
  const hasClassified = rows.some((r) => (r._customerTurns || 0) + (r._analystTurns || 0) > 0)

  if (!rows.length) return null

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        <div>
          <div className="eyebrow" style={{ color: T.muted }}>Interaction breakdown · per case</div>
          <div style={{ color: T.sub, fontSize: 12, marginTop: 4 }}>
            Sorted by total turns. Cases with more back-and-forth may indicate complexity or unclear resolution paths.
          </div>
        </div>
        <div className="mono" style={{ fontSize: 12, color: T.sub }}>{sorted.length} cases</div>
      </div>
      <div style={{ overflowX: "auto" }} className="scrollbar">
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: T.surfaceAlt }}>
              <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, color: T.sub, borderBottom: `1px solid ${T.borderSoft}` }}>Case</th>
              <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, color: T.sub, borderBottom: `1px solid ${T.borderSoft}` }}>Priority</th>
              <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, color: T.sub, borderBottom: `1px solid ${T.borderSoft}` }}>Account</th>
              <th style={{ padding: "8px 12px", textAlign: "right", fontWeight: 600, color: T.sub, borderBottom: `1px solid ${T.borderSoft}` }}>Turns</th>
              {hasClassified && <>
                <th style={{ padding: "8px 12px", textAlign: "right", fontWeight: 600, color: T.sub, borderBottom: `1px solid ${T.borderSoft}` }}>Customer</th>
                <th style={{ padding: "8px 12px", textAlign: "right", fontWeight: 600, color: T.sub, borderBottom: `1px solid ${T.borderSoft}` }}>Analyst</th>
              </>}
              <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, color: T.sub, borderBottom: `1px solid ${T.borderSoft}` }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.number} style={{ borderBottom: `1px solid ${T.borderSoft}` }}>
                <td className="mono" style={{ padding: "8px 12px", color: T.accent }}><CopyableNumber value={r.number} /></td>
                <td style={{ padding: "8px 12px" }}>{r.priority || "—"}</td>
                <td style={{ padding: "8px 12px", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.account || "—"}</td>
                <td className="mono" style={{ padding: "8px 12px", textAlign: "right", fontWeight: 600 }}>{r._interactionCount || 0}</td>
                {hasClassified && <>
                  <td className="mono" style={{ padding: "8px 12px", textAlign: "right", color: T.accent }}>{r._customerTurns || 0}</td>
                  <td className="mono" style={{ padding: "8px 12px", textAlign: "right", color: T.ok }}>{r._analystTurns || 0}</td>
                </>}
                <td style={{ padding: "8px 12px", color: r._isClosed ? T.muted : T.ink }}>{r._isClosed ? "Closed" : "Open"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sorted.length > 10 && (
        <button
          onClick={() => setExpanded((e) => !e)}
          style={{ marginTop: 10, background: "none", border: "none", color: T.accent, cursor: "pointer", fontSize: 12, padding: 0 }}
        >
          {expanded ? "Show less" : `Show all ${sorted.length} cases`}
        </button>
      )}
    </Card>
  )
}
