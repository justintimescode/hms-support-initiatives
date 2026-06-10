import { useState, useMemo } from "react";
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { T } from "../../lib/theme.js";
import { slaRiskSegments, slaRiskOf } from "../../lib/stats.js";
import { Card } from "../layout/Card.jsx";
import { CaseDrilldown } from "../CaseDrilldown.jsx";

/* ================= Open Backlog · SLA Risk (analyst view) ================= */
export function SlaRiskBlock({ rows }) {
  const data = useMemo(() => slaRiskSegments(rows), [rows]);
  const [selected, setSelected] = useState(null);
  const total = data.reduce((s, d) => s + d.count, 0);
  const breached = data.find((d) => d.key === "breached")?.count || 0;
  const due24 = data.find((d) => d.key === "due24")?.count || 0;
  const drilldownRows = useMemo(() => {
    if (!selected) return [];
    const now = Date.now();
    return rows
      .filter((r) => !r._isClosed && slaRiskOf(r, now) === selected)
      .sort((a, b) => {
        const ad = a._slaDueSop ? a._slaDueSop.getTime() : Infinity;
        const bd = b._slaDueSop ? b._slaDueSop.getTime() : Infinity;
        return ad - bd;
      });
  }, [rows, selected]);

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div>
          <div className="eyebrow" style={{ color: T.muted }}>Open cases by SLA risk</div>
          <div style={{ color: T.sub, fontSize: 12, marginTop: 4, maxWidth: 640 }}>
            Open cases grouped by their SLA clock — what to work on next, not just what's old. Click any bar to drill in.
          </div>
        </div>
        <div className="mono" style={{ fontSize: 12, color: T.sub, textAlign: "right" }}>
          <div>{total} open</div>
          <div style={{ color: breached ? T.danger : T.muted, fontWeight: 600 }}>{breached} breached · {due24} due in 24h</div>
        </div>
      </div>
      <div style={{ height: 240, marginTop: 12 }}>
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={T.borderSoft} vertical={false} />
            <XAxis dataKey="label" tick={{ fill: T.sub, fontSize: 11 }} axisLine={{ stroke: T.border }} tickLine={{ stroke: T.border }} />
            <YAxis tick={{ fill: T.muted, fontSize: 11, fontFamily: "JetBrains Mono" }} axisLine={{ stroke: T.border }} tickLine={{ stroke: T.border }} allowDecimals={false} />
            <Tooltip content={<SlaRiskTip total={total} />} cursor={{ fill: T.surfaceAlt }} />
            <Bar
              dataKey="count"
              radius={[3, 3, 0, 0]}
              cursor="pointer"
              onClick={(d) => setSelected((prev) => (prev === d.key ? null : d.key))}
            >
              {data.map((d, i) => (
                <Cell
                  key={i}
                  fill={d.color}
                  fillOpacity={!selected || selected === d.key ? 1 : 0.35}
                  stroke={selected === d.key ? T.ink : "none"}
                  strokeWidth={selected === d.key ? 1.5 : 0}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {selected && (
        <CaseDrilldown
          title={`Open · ${data.find((d) => d.key === selected)?.label}`}
          rows={drilldownRows}
          onClose={() => setSelected(null)}
        />
      )}
    </Card>
  );
}

function SlaRiskTip({ active, payload, total }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const pct = total ? (d.count / total) * 100 : 0;
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, padding: "8px 12px", borderRadius: 4, fontSize: 12 }}>
      <div style={{ fontWeight: 600 }}>{d.label}</div>
      <div className="mono" style={{ color: T.sub }}>{d.count} open · {pct.toFixed(1)}%</div>
      <div style={{ color: T.muted, marginTop: 4, maxWidth: 200 }}>{d.desc}</div>
    </div>
  );
}
