import { useState, useMemo } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { T } from "../lib/theme.js";
import { priorityColor } from "../lib/format.js";
import { priorityRank } from "../lib/enrich.js";
import { Card } from "./layout/Card.jsx";
import { Pill } from "./Pill.jsx";
import { CopyableNumber } from "./CopyableNumber.jsx";

/* ================= Table ================= */
export function CaseTable({ rows }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState({ key: "sys_created_on", dir: "desc" });

  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = rows;
    if (q) {
      out = out.filter((r) =>
        [r.number, r.short_description, r.account, r.priority, r.state, r._category]
          .some((v) => String(v || "").toLowerCase().includes(q))
      );
    }
    const k = sort.key;
    out = [...out].sort((a, b) => {
      let av = a[k], bv = b[k];
      if (k === "sys_created_on" || k === "closed_at") {
        av = a[k === "sys_created_on" ? "_created" : "_closed"];
        bv = b[k === "sys_created_on" ? "_created" : "_closed"];
      }
      if (k === "priority") {
        av = priorityRank(av); bv = priorityRank(bv);
      }
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av < bv) return sort.dir === "asc" ? -1 : 1;
      if (av > bv) return sort.dir === "asc" ? 1 : -1;
      return 0;
    });
    return out;
  }, [rows, query, sort]);

  const toggleSort = (key) => {
    setSort((s) => s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" });
  };

  const cols = [
    { key: "number", label: "Case" },
    { key: "priority", label: "Priority" },
    { key: "state", label: "State" },
    { key: "_category", label: "Category" },
    { key: "account", label: "Account" },
    { key: "short_description", label: "Short description" },
    { key: "sys_created_on", label: "Created" },
    { key: "made_sla", label: "SLA" },
  ];

  return (
    <Card style={{ padding: 0 }}>
      <div style={{ padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${T.borderSoft}` }}>
        <input
          placeholder="Search case, account, description…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
            border: `1px solid ${T.border}`,
            borderRadius: 4,
            padding: "7px 10px",
            fontSize: 13,
            fontFamily: "DM Sans, sans-serif",
            background: T.surface,
            color: T.ink,
            width: 280,
          }}
        />
        <div className="mono" style={{ fontSize: 12, color: T.sub }}>{sorted.length} rows</div>
      </div>
      <div className="scrollbar" style={{ maxHeight: 520, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead style={{ position: "sticky", top: 0, background: T.surface, zIndex: 1 }}>
            <tr>
              {cols.map((c) => (
                <th
                  key={c.key}
                  onClick={() => toggleSort(c.key)}
                  style={{
                    textAlign: "left",
                    padding: "10px 14px",
                    fontFamily: "JetBrains Mono, monospace",
                    fontSize: 10,
                    textTransform: "uppercase",
                    letterSpacing: "0.12em",
                    color: T.muted,
                    cursor: "pointer",
                    borderBottom: `1px solid ${T.border}`,
                    userSelect: "none",
                  }}
                >
                  {c.label}{sort.key === c.key ? (sort.dir === "asc" ? " ↑" : " ↓") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.number} style={{ borderBottom: `1px solid ${T.borderSoft}` }}>
                <td className="mono" style={tdStyle}><CopyableNumber value={r.number} /></td>
                <td style={tdStyle}>
                  <Pill color={priorityColor(r.priority)}>{String(r.priority || "").split(" - ")[1] || r.priority || "—"}</Pill>
                </td>
                <td style={tdStyle}>{r.state}</td>
                <td style={tdStyle}>{r._category}</td>
                <td style={{ ...tdStyle, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.account}</td>
                <td style={{ ...tdStyle, maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.short_description}</td>
                <td className="mono" style={{ ...tdStyle, color: T.sub }}>{r._created ? r._created.toISOString().slice(0, 10) : "—"}</td>
                <td style={tdStyle}>
                  {r.made_sla === "" || r.made_sla == null ? "—" : r._madeSla ? (
                    <CheckCircle2 size={14} style={{ color: T.ok }} />
                  ) : (
                    <XCircle size={14} style={{ color: T.danger }} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

const tdStyle = { padding: "10px 14px", verticalAlign: "middle" };
