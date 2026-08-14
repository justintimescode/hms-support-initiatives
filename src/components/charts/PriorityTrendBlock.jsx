import { useMemo, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts";
import { T } from "../../lib/theme.js";
import { monthlyPriorityMix } from "../../lib/stats.js";
import { BUCKET_MS, SCOPE_RANGE, timeWindow } from "../../lib/time-axis.js";
import { Card } from "../layout/Card.jsx";
import { TimeScopeNote, TimeScopeToggle } from "./TimeScopeToggle.jsx";

// Fixed series order, bottom of the stack upward: the routine work forms the
// base, escalation-grade work sits on top where a swelling band is conspicuous.
// Colors are the app-wide priority tokens, so "Major" is the same color here,
// on the priority page's donut, and in the case register.
const SERIES = [
  { key: "standard", name: "Standard", color: T.priorityStandard },
  { key: "medium", name: "Medium", color: T.priorityMedium },
  { key: "major", name: "Major", color: T.priorityMajor },
  { key: "critical", name: "Critical", color: T.priorityCritical },
];

/* ================= Case mix by priority · monthly ================= */
// ServiceNow charts "cases by priority" as a snapshot donut; this is the same
// breakdown given a time axis, which is what turns it from inventory into an
// early-warning: total height is intake volume, and the mix shifting toward
// the top of the stack means the work is getting more severe, not just bigger.
export function PriorityTrendBlock({ rows, dateRange }) {
  const data = useMemo(() => monthlyPriorityMix(rows), [rows]);
  const [scope, setScope] = useState(SCOPE_RANGE);
  const win = useMemo(
    () => timeWindow({
      data, key: "month", valueKeys: ["total"],
      range: dateRange, scope, bucketMs: BUCKET_MS.month,
    }),
    [data, dateRange, scope],
  );

  const hasSignal = data.some((d) => d.total > 0);
  const hasOther = data.some((d) => d.other > 0);
  if (!hasSignal) {
    return (
      <Card>
        <div className="eyebrow" style={{ color: T.muted }}>Case mix by priority · monthly</div>
        <div style={{ color: T.sub, fontSize: 13, fontStyle: "italic", marginTop: 12 }}>
          No dated cases to bucket by month yet.
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div className="eyebrow" style={{ color: T.muted }}>Case mix by priority · monthly</div>
        <TimeScopeToggle scope={scope} onScopeChange={setScope} range={dateRange} />
      </div>
      <div style={{ color: T.sub, fontSize: 12, marginTop: 4, maxWidth: 720 }}>
        Cases created each month, stacked by priority in a fixed order — routine work at the base,
        Critical on top. Total height is intake volume; the mix is the severity story. A stack that
        grows from the top is telling you the work is getting harder, which a volume-only trend
        presents as merely "busier".
      </div>
      <div style={{ height: 280, marginTop: 12 }}>
        <ResponsiveContainer>
          <BarChart data={win.data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={T.borderSoft} vertical={false} />
            <XAxis
              dataKey="month"
              type="number"
              domain={win.domain}
              tickFormatter={win.tickFormatter}
              tick={{ fill: T.sub, fontSize: 11 }}
              axisLine={{ stroke: T.border }}
              tickLine={{ stroke: T.border }}
              ticks={win.ticks}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fill: T.muted, fontSize: 11, fontFamily: "JetBrains Mono" }}
              axisLine={{ stroke: T.border }}
              tickLine={{ stroke: T.border }}
              allowDecimals={false}
            />
            <Tooltip content={<MixTip hasOther={hasOther} />} cursor={{ fill: T.surfaceAlt }} />
            <Legend wrapperStyle={{ fontSize: 11, color: T.sub }} iconType="square" />
            {SERIES.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.name}
                stackId="mix"
                fill={s.color}
                fillOpacity={0.85}
                radius={i === SERIES.length - 1 && !hasOther ? [2, 2, 0, 0] : undefined}
              />
            ))}
            {hasOther && (
              <Bar dataKey="other" name="Unspecified" stackId="mix" fill={T.muted} fillOpacity={0.6} radius={[2, 2, 0, 0]} />
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <TimeScopeNote win={win} unit="month" scope={scope} />
    </Card>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function MixTip({ active, payload, hasOther }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const dte = new Date(d.month);
  const rows = [...SERIES].reverse().map((s) => ({ name: s.name, color: s.color, v: d[s.key] }));
  if (hasOther) rows.push({ name: "Unspecified", color: T.muted, v: d.other });
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, padding: "8px 12px", borderRadius: 4, fontSize: 12 }}>
      <div style={{ fontWeight: 600 }}>{MONTHS[dte.getMonth()]} {dte.getFullYear()}</div>
      {d.total ? (
        <>
          {rows.filter((r) => r.v > 0).map((r) => (
            <div key={r.name} className="mono" style={{ color: T.sub, display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 8, height: 8, background: r.color, borderRadius: 2, display: "inline-block" }} />
              {r.name}: {r.v}
            </div>
          ))}
          <div className="mono" style={{ color: T.muted, marginTop: 2 }}>{d.total} created</div>
        </>
      ) : (
        <div style={{ color: T.muted }}>No cases created this month</div>
      )}
    </div>
  );
}
