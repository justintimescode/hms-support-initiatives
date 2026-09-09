import { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import {
  T, AXIS_TICK, AXIS_TICK_CAT, BAR_RADIUS_V, TOOLTIP_STYLE,
} from "../../lib/theme.js";
import { weekdayAnalytics } from "../../lib/stats.js";
import { Card } from "../layout/Card.jsx";

/* ================= Workload Cadence =================
 * Two single-metric views, so both take the duotone treatment: the Infor Purple
 * lead on the subtle Gray Tint plot ground. */
export function WeekdayBlock({ rows }) {
  const data = useMemo(() => weekdayAnalytics(rows), [rows]);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
      <Card>
        <div className="eyebrow">Avg open caseload by weekday</div>
        <div style={{ color: T.sub, fontSize: 12, marginTop: 4 }}>Average number of cases open on each day of the week, across the data range.</div>
        <div style={{ height: 240, marginTop: 12, background: T.vizWell, borderRadius: T.radiusMd }}>
          <ResponsiveContainer>
            <BarChart data={data.avgOpen} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={T.vizGrid} vertical={false} />
              <XAxis dataKey="name" tick={AXIS_TICK_CAT} axisLine={{ stroke: T.vizAxis }} tickLine={{ stroke: T.vizAxis }} />
              <YAxis tick={AXIS_TICK} axisLine={{ stroke: T.vizAxis }} tickLine={{ stroke: T.vizAxis }} />
              <Tooltip content={<WeekdayTip label="avg open" />} cursor={{ fill: T.vizWell }} />
              <Bar dataKey="count" radius={BAR_RADIUS_V} fill={T.vizAccent} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Card>
        <div className="eyebrow">Cases created by weekday</div>
        <div style={{ color: T.sub, fontSize: 12, marginTop: 4 }}>Which days of the week new cases get opened.</div>
        <div style={{ height: 240, marginTop: 12, background: T.vizWell, borderRadius: T.radiusMd }}>
          <ResponsiveContainer>
            <BarChart data={data.created} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={T.vizGrid} vertical={false} />
              <XAxis dataKey="name" tick={AXIS_TICK_CAT} axisLine={{ stroke: T.vizAxis }} tickLine={{ stroke: T.vizAxis }} />
              <YAxis tick={AXIS_TICK} axisLine={{ stroke: T.vizAxis }} tickLine={{ stroke: T.vizAxis }} />
              <Tooltip content={<WeekdayTip label="cases created" />} cursor={{ fill: T.vizWell }} />
              <Bar dataKey="count" radius={BAR_RADIUS_V} fill={T.vizAccent} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}

function WeekdayTip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={TOOLTIP_STYLE}>
      <div style={{ fontWeight: 600 }}>{d.name}</div>
      <div className="mono" style={{ color: T.sub }}>{d.count} {label}</div>
    </div>
  );
}
