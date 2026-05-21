import { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { T } from "../../lib/theme.js";
import { weekdayAnalytics } from "../../lib/stats.js";
import { Card } from "../layout/Card.jsx";

/* ================= Workload Cadence ================= */
export function WeekdayBlock({ rows }) {
  const data = useMemo(() => weekdayAnalytics(rows), [rows]);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
      <Card>
        <div className="eyebrow" style={{ color: T.muted }}>Avg open caseload by weekday</div>
        <div style={{ color: T.sub, fontSize: 12, marginTop: 4 }}>Average number of cases open on each day of the week, across the data range.</div>
        <div style={{ height: 240, marginTop: 12 }}>
          <ResponsiveContainer>
            <BarChart data={data.avgOpen} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={T.borderSoft} vertical={false} />
              <XAxis dataKey="name" tick={{ fill: T.sub, fontSize: 11 }} axisLine={{ stroke: T.border }} tickLine={{ stroke: T.border }} />
              <YAxis tick={{ fill: T.muted, fontSize: 11, fontFamily: "JetBrains Mono" }} axisLine={{ stroke: T.border }} tickLine={{ stroke: T.border }} />
              <Tooltip content={<WeekdayTip label="avg open" />} cursor={{ fill: T.surfaceAlt }} />
              <Bar dataKey="count" radius={[3, 3, 0, 0]} fill={T.accent} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Card>
        <div className="eyebrow" style={{ color: T.muted }}>Cases created by weekday</div>
        <div style={{ color: T.sub, fontSize: 12, marginTop: 4 }}>Which days of the week new cases get opened.</div>
        <div style={{ height: 240, marginTop: 12 }}>
          <ResponsiveContainer>
            <BarChart data={data.created} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={T.borderSoft} vertical={false} />
              <XAxis dataKey="name" tick={{ fill: T.sub, fontSize: 11 }} axisLine={{ stroke: T.border }} tickLine={{ stroke: T.border }} />
              <YAxis tick={{ fill: T.muted, fontSize: 11, fontFamily: "JetBrains Mono" }} axisLine={{ stroke: T.border }} tickLine={{ stroke: T.border }} />
              <Tooltip content={<WeekdayTip label="cases created" />} cursor={{ fill: T.surfaceAlt }} />
              <Bar dataKey="count" radius={[3, 3, 0, 0]} fill={T.accent} />
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
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, padding: "8px 12px", borderRadius: 4, fontSize: 12 }}>
      <div style={{ fontWeight: 600 }}>{d.name}</div>
      <div className="mono" style={{ color: T.sub }}>{d.count} {label}</div>
    </div>
  );
}
