import { T, alpha } from "../lib/theme.js";
import { useQuery } from "../lib/useQuery.js";
import { getKpis } from "../lib/queries.js";
import { Card } from "./layout/Card.jsx";

/* ================= Dev side-by-side (Phase 3, getKpis gate) ================= */
export function DevKpiCompare({ jsKpis, analyst, manager, dateRange, dbReady }) {
  // Only render in dev, and only once DuckDB has data to query.
  const enabled = !!(import.meta?.env?.DEV && dbReady && jsKpis);
  const dr = dateRange || { from: null, to: null, field: "_created" };
  const { data: sqlKpis, loading, error } = useQuery(
    () => getKpis({ analyst, manager, dateRange: dr }),
    [analyst, manager, dr.from, dr.to, dr.field],
    { enabled }
  );

  if (!enabled) return null;
  if (loading) {
    return (
      <div style={{ marginTop: 12, padding: "8px 12px", border: `1px dashed ${T.warn}`, borderRadius: 4, color: T.muted, fontSize: 11 }}>
        DEV · loading SQL KPIs…
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ marginTop: 12, padding: "8px 12px", border: `1px dashed ${T.danger}`, borderRadius: 4, color: T.danger, fontSize: 11 }}>
        DEV · SQL getKpis failed: {error?.message || String(error)}
      </div>
    );
  }
  if (!sqlKpis) return null;

  const closeEnough = (a, b, eps = 0.05) => {
    if (a == null && b == null) return true;
    if (a == null || b == null) return false;
    return Math.abs(Number(a) - Number(b)) <= eps;
  };
  const jsAtRiskCount = (jsKpis.atRisk?.length ?? jsKpis.atRiskCount ?? 0);
  const jsBreachedCount = (jsKpis.breached?.length ?? jsKpis.breachedCount ?? 0);

  const rows = [
    ["total",        jsKpis.total,         sqlKpis.total],
    ["closed",       jsKpis.closed,        sqlKpis.closed],
    ["open",         jsKpis.open,          sqlKpis.open],
    ["slaEligible",  jsKpis.slaEligible,   sqlKpis.slaEligible],
    ["slaMet",       jsKpis.slaMet,        sqlKpis.slaMet],
    ["slaRate (%)",  jsKpis.slaRate,       sqlKpis.slaRate],
    ["avgRes (ms)",  jsKpis.avgRes,        sqlKpis.avgRes],
    ["avgFrt (ms)",  jsKpis.avgFrt,        sqlKpis.avgFrt],
    ["atRisk",       jsAtRiskCount,        sqlKpis.atRiskCount],
    ["breached",     jsBreachedCount,      sqlKpis.breachedCount],
  ];

  const fmt = (v) => {
    if (v == null) return "—";
    if (typeof v === "number") {
      if (!Number.isFinite(v)) return String(v);
      const abs = Math.abs(v);
      if (abs >= 1000) return Math.round(v).toLocaleString();
      if (Number.isInteger(v)) return String(v);
      return v.toFixed(2);
    }
    return String(v);
  };

  const anyDrift = rows.some(([, a, b]) => !closeEnough(a, b));

  return (
    <Card style={{ marginTop: 12, border: `2px dashed ${anyDrift ? T.danger : T.ok}`, background: alpha(anyDrift ? T.dangerSoft : T.okSoft, 0.2) }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div>
          <div className="eyebrow" style={{ color: anyDrift ? T.danger : T.ok }}>
            DEV · getKpis side-by-side {anyDrift ? "· drift detected" : "· match"}
          </div>
          <div style={{ color: T.sub, fontSize: 11, marginTop: 4 }}>
            JS pipeline vs SQL pipeline for the active analyst + date range.
            This widget is dev-only and disappears after Phase 3 ships.
          </div>
        </div>
        <div className="mono" style={{ fontSize: 11, color: T.muted }}>
          analyst: {analyst === "__all__" ? "all" : analyst} ·
          {" "}range: {dr.from ? new Date(dr.from).toISOString().slice(0, 10) : "—"}
          {" "}→ {dr.to ? new Date(dr.to).toISOString().slice(0, 10) : "—"} ·
          {" "}field: {dr.field}
        </div>
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
          {rows.map(([label, a, b]) => {
            const ok = closeEnough(a, b);
            const delta = (typeof a === "number" && typeof b === "number") ? (b - a) : null;
            return (
              <tr key={label} style={{ borderBottom: `1px solid ${T.borderSoft}` }}>
                <td style={{ padding: "6px 10px", color: T.ink }}>{label}</td>
                <td className="mono" style={{ padding: "6px 10px", textAlign: "right" }}>{fmt(a)}</td>
                <td className="mono" style={{ padding: "6px 10px", textAlign: "right" }}>{fmt(b)}</td>
                <td className="mono" style={{ padding: "6px 10px", textAlign: "right", color: ok ? T.ok : T.danger, fontWeight: 600 }}>
                  {ok ? "✓" : (delta != null ? (delta > 0 ? `+${fmt(delta)}` : fmt(delta)) : "≠")}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
