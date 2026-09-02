import { useMemo } from "react";
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { T, AXIS_TICK, AXIS_TICK_CAT, TOOLTIP_STYLE, BAR_RADIUS_V } from "../../lib/theme.js";
import { fmtDuration } from "../../lib/format.js";
import { frtDistribution } from "../../lib/stats.js";
import { Card } from "../layout/Card.jsx";

/* ================= First-Response-Time Distribution =================
 * The mean FRT hides shape — a few very slow responses can drag it while most
 * cases are answered quickly (or vice-versa). This shows the full histogram
 * plus p50/p90 so you can see the typical response and the slow tail. */
export function FrtDistributionBlock({ rows }) {
  const dist = useMemo(() => frtDistribution(rows || []), [rows]);
  const peak = Math.max(0, ...dist.buckets.map((b) => b.count));

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div>
          <div className="eyebrow">First response time — distribution</div>
          <div style={{ color: T.sub, fontSize: 12, marginTop: 4, maxWidth: 640 }}>
            How long cases wait for their first Infor response. The spread matters more than the average — a long right tail means a minority of customers wait much longer than typical.
          </div>
        </div>
        <div style={{ display: "flex", gap: 18 }}>
          <Stat label="Median" value={fmtDuration(dist.p50)} accent={T.ink} />
          <Stat label="p90" value={fmtDuration(dist.p90)} accent={T.warn} />
          <Stat label="Average" value={fmtDuration(dist.avg)} accent={T.muted} />
          <Stat label="Measured" value={dist.n.toLocaleString()} accent={T.muted} />
        </div>
      </div>

      {dist.n === 0 ? (
        <div style={{ color: T.sub, fontSize: 13, fontStyle: "italic", marginTop: 12 }}>
          No first-response times in this view. (CSV exports often omit this column — XLSX is more reliable.)
        </div>
      ) : (
        <div style={{ height: 240, marginTop: 12, background: T.vizWell, borderRadius: T.radiusMd }}>
          <ResponsiveContainer>
            <BarChart data={dist.buckets} margin={{ top: 10, right: 20, left: 0, bottom: 0 }} barCategoryGap="22%">
              <CartesianGrid stroke={T.vizGrid} vertical={false} />
              <XAxis dataKey="name" tick={AXIS_TICK_CAT} axisLine={{ stroke: T.vizAxis }} tickLine={{ stroke: T.vizAxis }} />
              <YAxis tick={AXIS_TICK} axisLine={{ stroke: T.vizAxis }} tickLine={{ stroke: T.vizAxis }} allowDecimals={false} />
              <Tooltip content={<FrtTip total={dist.n} />} cursor={{ fill: T.vizWell }} />
              <Bar dataKey="count" radius={BAR_RADIUS_V}>
                {/* Duotone: Infor Purple leads on the modal bucket, Purple Tint 02
                    carries the rest. De-emphasis is the lighter ramp step, not
                    opacity; the tint is under 3:1 on the well so it takes the
                    1px perceivability stroke. */}
                {dist.buckets.map((b, i) => (
                  <Cell
                    key={i}
                    fill={b.count === peak ? T.vizAccent : T.categorical[5]}
                    stroke={b.count === peak ? undefined : T.vizStroke}
                    strokeWidth={b.count === peak ? 0 : 1}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

function Stat({ label, value, accent }) {
  return (
    <div style={{ textAlign: "right" }}>
      <div className="eyebrow">{label}</div>
      <div className="mono" style={{ fontSize: 16, fontWeight: 600, color: accent || T.ink, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function FrtTip({ active, payload, total }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const pct = total ? ((d.count / total) * 100).toFixed(0) : 0;
  return (
    <div style={TOOLTIP_STYLE}>
      <div style={{ fontWeight: 600 }}>{d.name}</div>
      <div className="mono" style={{ color: T.sub }}>{d.count} case{d.count === 1 ? "" : "s"} · {pct}%</div>
    </div>
  );
}
