import { useEffect } from "react"
import { T } from "../../lib/theme.js"
import { Card } from "../layout/Card.jsx"
import { closeEnough } from "./devCompareUtils.js"

/* Generalized dev-only side-by-side validator for the DuckDB migration.
 * The page computes BOTH the old in-memory value and the new SQL value for the
 * same filters and passes them in as metrics; this renders a purple/red diff
 * table and console.tables it. Dev-only — deleted in Phase 5 with the
 * in-memory pipeline. Replaces the single-purpose DevKpiCompare.
 * Pure helpers (closeEnough/flattenByKey/kpiMetrics) live in devCompareUtils.js. */

const DEV = !!import.meta?.env?.DEV

const fmt = (v) => {
  if (v == null) return "—"
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return String(v)
    if (Math.abs(v) >= 1000) return Math.round(v).toLocaleString()
    if (Number.isInteger(v)) return String(v)
    return v.toFixed(2)
  }
  return String(v)
}

/**
 * @param {string} label   what's being compared (e.g. "getPriorityData")
 * @param {{name,js,sql}[]} metrics  one row per metric, both sides precomputed
 * @param {number} [eps]   numeric tolerance (default 0.05)
 * @param {string} [note]  extra context line (analyst/date/field)
 */
export function DevCompare({ label, metrics, eps = 0.05, note }) {
  const rows = (metrics || []).filter(Boolean)
  const anyDrift = rows.some((m) => !closeEnough(m.js, m.sql, eps))
  const sig = JSON.stringify(rows.map((m) => [m.name, m.js, m.sql]))

  useEffect(() => {
    if (!DEV || !rows.length) return
    const table = {}
    for (const m of rows) {
      const delta = typeof m.js === "number" && typeof m.sql === "number" ? m.sql - m.js : null
      table[m.name] = { js: m.js, sql: m.sql, delta, ok: closeEnough(m.js, m.sql, eps) }
    }
    // THE ONE SANCTIONED RAW HEX IN src/: console `%c` CSS is evaluated by
    // devtools, outside the document, so it cannot resolve var(--t-*). These are
    // Infor Red (drift) and Infor Charcoal (match) as literals — do not "fix"
    // them to tokens, and do not copy the pattern into rendered markup.
    console.log(
      `%cDevCompare · ${label}${note ? " · " + note : ""} · ${anyDrift ? "DRIFT" : "match"}`,
      `color:${anyDrift ? "#ED0C0C" : "#15262E"};font-weight:600`,
    )
    console.table(table)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [label, note, sig, eps, anyDrift])

  if (!DEV || !rows.length) return null

  return (
    <Card style={{ marginTop: 12, border: `2px dashed ${anyDrift ? T.danger : T.ok}`, background: anyDrift ? T.dangerSoft : T.okSoft }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div className="eyebrow" style={{ color: anyDrift ? T.danger : T.ok }}>
          DEV · {label} {anyDrift ? "· drift detected" : "· match"}
        </div>
        {note && <div className="mono" style={{ fontSize: 11, color: T.muted }}>{note}</div>}
      </div>
      <table style={{ width: "100%", marginTop: 10, fontSize: 12, borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: T.surfaceAlt }}>
            <th style={{ textAlign: "left", padding: "6px 10px", color: T.sub, fontWeight: 600 }}>metric</th>
            <th style={{ textAlign: "right", padding: "6px 10px", color: T.sub, fontWeight: 600 }}>JS</th>
            <th style={{ textAlign: "right", padding: "6px 10px", color: T.sub, fontWeight: 600 }}>SQL</th>
            <th style={{ textAlign: "right", padding: "6px 10px", color: T.sub, fontWeight: 600 }}>Δ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => {
            const ok = closeEnough(m.js, m.sql, eps)
            const delta = typeof m.js === "number" && typeof m.sql === "number" ? m.sql - m.js : null
            return (
              <tr key={m.name} style={{ borderBottom: `1px solid ${T.borderSoft}` }}>
                <td style={{ padding: "6px 10px", color: T.ink }}>{m.name}</td>
                <td className="mono" style={{ padding: "6px 10px", textAlign: "right" }}>{fmt(m.js)}</td>
                <td className="mono" style={{ padding: "6px 10px", textAlign: "right" }}>{fmt(m.sql)}</td>
                <td className="mono" style={{ padding: "6px 10px", textAlign: "right", color: ok ? T.ok : T.danger, fontWeight: 600 }}>
                  {ok ? "✓" : delta != null ? (delta > 0 ? `+${fmt(delta)}` : fmt(delta)) : "≠"}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </Card>
  )
}
