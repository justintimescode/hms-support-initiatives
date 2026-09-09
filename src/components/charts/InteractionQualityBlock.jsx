import { useState, useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import {
  T, AXIS_TICK, AXIS_TICK_CAT, BAR_RADIUS_H, TOOLTIP_STYLE,
} from "../../lib/theme.js";
import { Card } from "../layout/Card.jsx";

/* ================= Interaction Quality Block ================= */
const IX_HEADERS = [
  { key: "name",          label: "Analyst",       align: "left"  },
  { key: "total",         label: "Cases",         align: "right" },
  { key: "avgTurns",      label: "Avg Turns",     align: "right" },
  { key: "avgCustomer",   label: "Avg Customer",  align: "right" },
  { key: "avgAnalyst",    label: "Avg Analyst",   align: "right" },
  { key: "multiTouchPct", label: "Multi-touch %", align: "right" },
]

export function InteractionQualityBlock({ members }) {
  const [sort, setSort] = useState({ key: "avgTurns", dir: "desc" })

  const chartData = useMemo(() => {
    return [...members]
      .sort((a, b) => (b.interactionStats.avgTurns || 0) - (a.interactionStats.avgTurns || 0))
      .map((m) => ({
        name: m.name,
        customer: parseFloat((m.interactionStats.avgCustomer || 0).toFixed(2)),
        analyst: parseFloat((m.interactionStats.avgAnalyst || 0).toFixed(2)),
      }))
  }, [members])

  const sorted = useMemo(() => {
    return [...members].sort((a, b) => {
      const aVal = sort.key === "name"  ? a.name
                 : sort.key === "total" ? a.kpis.total
                 : (a.interactionStats[sort.key] ?? 0)
      const bVal = sort.key === "name"  ? b.name
                 : sort.key === "total" ? b.kpis.total
                 : (b.interactionStats[sort.key] ?? 0)
      if (typeof aVal === "string") return sort.dir === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
      return sort.dir === "asc" ? aVal - bVal : bVal - aVal
    })
  }, [members, sort])

  const toggleSort = (key) =>
    setSort((s) => s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "name" ? "asc" : "desc" })

  const hasClassified = members.some((m) => (m.interactionStats.avgCustomer + m.interactionStats.avgAnalyst) > 0)

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {chartData.length > 0 && (
        <Card>
          <div className="eyebrow" style={{ marginBottom: 12 }}>Avg turns per case by analyst</div>
          {!hasClassified && (
            <div style={{ color: T.sub, fontSize: 12, marginBottom: 8 }}>
              work_notes entries could not be classified — showing total turn counts only
            </div>
          )}
          <div style={{ height: Math.max(180, chartData.length * 36), background: T.vizWell, borderRadius: T.radiusMd }}>
            <ResponsiveContainer>
              <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 0 }}>
                <CartesianGrid stroke={T.vizGrid} horizontal={false} />
                <XAxis type="number" tick={AXIS_TICK} axisLine={{ stroke: T.vizAxis }} tickLine={{ stroke: T.vizAxis }} allowDecimals />
                <YAxis type="category" dataKey="name" tick={AXIS_TICK_CAT} width={140} interval={0} axisLine={{ stroke: T.vizAxis }} tickLine={{ stroke: T.vizAxis }} />
                <Tooltip
                  cursor={{ fill: T.vizWell }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null
                    const total = payload.reduce((s, p) => s + (p.value || 0), 0)
                    return (
                      <div style={TOOLTIP_STYLE}>
                        <div style={{ fontWeight: 600 }}>{label}</div>
                        <div className="mono" style={{ color: T.sub, marginBottom: 4 }}>{total.toFixed(1)} avg turns</div>
                        {payload.filter((p) => p.value > 0).map((p) => (
                          <div key={p.dataKey} className="mono" style={{ color: T.sub, display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ width: 8, height: 8, background: p.color, borderRadius: T.radiusChart }} />
                            {p.dataKey}: {p.value}
                          </div>
                        ))}
                      </div>
                    )
                  }}
                />
                {hasClassified ? (
                  <>
                    <Bar dataKey="customer" stackId="ix" fill={T.vizAccent} name="customer" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="analyst"  stackId="ix" fill={T.categorical[5]} stroke={T.vizStroke} strokeWidth={1} name="analyst"  radius={BAR_RADIUS_H} />
                  </>
                ) : (
                  <Bar dataKey="customer" stackId="ix" fill={T.vizAccent} name="turns" radius={BAR_RADIUS_H} />
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>
          {hasClassified && (
            <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 12 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 12, height: 10, background: T.vizAccent, border: `1px solid ${T.border}`, borderRadius: T.radiusChart }} />Customer turns</span>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 12, height: 10, background: T.categorical[5], border: `1px solid ${T.border}`, borderRadius: T.radiusChart }} />Analyst turns</span>
            </div>
          )}
        </Card>
      )}

      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }} className="scrollbar">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: T.surfaceAlt }}>
                {IX_HEADERS.map((h) => (
                  <th
                    key={h.key}
                    onClick={() => toggleSort(h.key)}
                    style={{ padding: "10px 14px", textAlign: h.align, fontWeight: 600, color: T.sub, cursor: "pointer", whiteSpace: "nowrap", borderBottom: `1px solid ${T.borderSoft}` }}
                  >
                    {h.label}
                    {sort.key === h.key && <span style={{ marginLeft: 4, color: T.vizAccent }}>{sort.dir === "asc" ? "▲" : "▼"}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((m) => {
                const ix = m.interactionStats
                return (
                  <tr key={m.name} style={{ borderBottom: `1px solid ${T.borderSoft}` }}>
                    <td style={{ padding: "10px 14px", fontWeight: 600 }}>{m.name}</td>
                    <td className="mono" style={{ padding: "10px 14px", textAlign: "right" }}>{m.kpis.total}</td>
                    <td className="mono" style={{ padding: "10px 14px", textAlign: "right" }}>{ix.avgTurns.toFixed(1)}</td>
                    <td className="mono" style={{ padding: "10px 14px", textAlign: "right", color: ix.avgCustomer > 0 ? T.ink : T.muted }}>{ix.avgCustomer.toFixed(1)}</td>
                    <td className="mono" style={{ padding: "10px 14px", textAlign: "right", color: ix.avgAnalyst > 0 ? T.ink : T.muted }}>{ix.avgAnalyst.toFixed(1)}</td>
                    <td className="mono" style={{ padding: "10px 14px", textAlign: "right", color: ix.multiTouchPct > 50 ? T.warn : T.ink }}>{ix.multiTouchPct.toFixed(0)}%</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
