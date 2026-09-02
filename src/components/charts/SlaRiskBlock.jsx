import { useState, useMemo } from "react";
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import {
  T, AXIS_TICK, AXIS_TICK_CAT, TOOLTIP_STYLE, BAR_RADIUS_V,
} from "../../lib/theme.js";
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
      .filter((r) => r._isOpen && slaRiskOf(r, now) === selected)
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
          <div className="eyebrow">Open cases by SLA risk</div>
          <div style={{ color: T.sub, fontSize: 12, marginTop: 4, maxWidth: 640 }}>
            Open cases grouped by their SLA clock — what to work on next, not just what's old. Click any bar to drill in.
          </div>
        </div>
        <div className="mono" style={{ fontSize: 12, color: T.sub, textAlign: "right" }}>
          <div>{total} open</div>
          <div style={{ color: breached ? T.danger : T.muted, fontWeight: 600 }}>{breached} breached · {due24} due in 24h</div>
        </div>
      </div>
      <div style={{ height: 240, marginTop: 12, background: T.vizWell, borderRadius: T.radiusMd }}>
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={T.vizGrid} vertical={false} />
            <XAxis dataKey="label" tick={AXIS_TICK_CAT} axisLine={{ stroke: T.vizAxis }} tickLine={{ stroke: T.vizAxis }} />
            <YAxis tick={AXIS_TICK} axisLine={{ stroke: T.vizAxis }} tickLine={{ stroke: T.vizAxis }} allowDecimals={false} />
            <Tooltip content={<SlaRiskTip total={total} />} cursor={{ fill: T.vizWell }} />
            <Bar
              dataKey="count"
              radius={BAR_RADIUS_V}
              cursor="pointer"
              onClick={(d) => setSelected((prev) => (prev === d.key ? null : d.key))}
            >
              {data.map((d, i) => (
                /* De-emphasis of the unselected bars is a mix toward the plot
                 * ground rather than an opacity drop, and every bar keeps the
                 * 1px perceivability stroke the two achromatic risk steps need
                 * against that ground. Selection stays legible as the heavier,
                 * ink-colored outline. */
                <Cell
                  key={i}
                  fill={selected && selected !== d.key
                    ? `color-mix(in srgb, ${d.color} 40%, ${T.vizWell})`
                    : d.color}
                  stroke={selected === d.key ? T.ink : T.vizStroke}
                  strokeWidth={selected === d.key ? 1.5 : 1}
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
    <div style={TOOLTIP_STYLE}>
      <div style={{ fontWeight: 600 }}>{d.label}</div>
      <div className="mono" style={{ color: T.sub }}>{d.count} open · {pct.toFixed(1)}%</div>
      <div style={{ color: T.muted, marginTop: 4, maxWidth: 200 }}>{d.desc}</div>
    </div>
  );
}
