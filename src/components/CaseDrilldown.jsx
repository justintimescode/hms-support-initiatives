import { T } from "../lib/theme.js";
import { fmtDate, ageDays, priorityColor } from "../lib/format.js";
import { CopyableNumber } from "./CopyableNumber.jsx";

/* ================= Drilldown ================= */
export function CaseDrilldown({ title, rows, onClose }) {
  return (
    <div style={{ marginTop: 12, border: `1px solid ${T.border}`, borderRadius: 4, background: T.surface }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: `1px solid ${T.borderSoft}`, background: T.surfaceAlt }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span className="eyebrow" style={{ color: T.accent }}>{title}</span>
          <span className="mono" style={{ fontSize: 12, color: T.sub }}>{rows.length} case{rows.length === 1 ? "" : "s"}</span>
        </div>
        <button
          onClick={onClose}
          style={{ background: "none", border: "none", color: T.sub, cursor: "pointer", fontSize: 13, padding: 4 }}
          aria-label="Close drilldown"
        >
          ✕
        </button>
      </div>
      <div style={{ maxHeight: 320, overflowY: "auto" }} className="scrollbar">
        {rows.length === 0 ? (
          <div style={{ padding: "16px 14px", color: T.muted, fontSize: 13 }}>No cases in this bucket.</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: T.surface, position: "sticky", top: 0 }}>
                <th style={{ textAlign: "left", padding: "8px 12px", color: T.sub, fontWeight: 600, borderBottom: `1px solid ${T.borderSoft}` }}>Case</th>
                <th style={{ textAlign: "left", padding: "8px 12px", color: T.sub, fontWeight: 600, borderBottom: `1px solid ${T.borderSoft}` }}>Assignee</th>
                <th style={{ textAlign: "left", padding: "8px 12px", color: T.sub, fontWeight: 600, borderBottom: `1px solid ${T.borderSoft}` }}>Priority</th>
                <th style={{ textAlign: "left", padding: "8px 12px", color: T.sub, fontWeight: 600, borderBottom: `1px solid ${T.borderSoft}` }}>Account</th>
                <th style={{ textAlign: "left", padding: "8px 12px", color: T.sub, fontWeight: 600, borderBottom: `1px solid ${T.borderSoft}` }}>Created</th>
                <th style={{ textAlign: "left", padding: "8px 12px", color: T.sub, fontWeight: 600, borderBottom: `1px solid ${T.borderSoft}` }}>Age</th>
                <th style={{ textAlign: "left", padding: "8px 12px", color: T.sub, fontWeight: 600, borderBottom: `1px solid ${T.borderSoft}` }}>Description</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const age = ageDays(r._created);
                return (
                  <tr key={r.number || i} style={{ borderBottom: `1px solid ${T.borderSoft}` }}>
                    <td className="mono" style={{ padding: "8px 12px", whiteSpace: "nowrap", fontWeight: 600 }}><CopyableNumber value={r.number} /></td>
                    <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>{r.assigned_to || "Unassigned"}</td>
                    <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>
                      <span style={{ color: priorityColor(r.priority), fontWeight: 600 }}>{r.priority || "—"}</span>
                    </td>
                    <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>{r.account || "—"}</td>
                    <td className="mono" style={{ padding: "8px 12px", whiteSpace: "nowrap", color: T.sub }}>{fmtDate(r._created)}</td>
                    <td className="mono" style={{ padding: "8px 12px", whiteSpace: "nowrap", color: age != null && age > 30 ? T.danger : T.sub }}>{age == null ? "—" : `${age}d`}</td>
                    <td style={{ padding: "8px 12px", maxWidth: 380, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.short_description || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
