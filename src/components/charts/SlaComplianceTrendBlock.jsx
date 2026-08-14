import { useMemo, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import { T } from "../../lib/theme.js";
import { monthlySlaComposition } from "../../lib/stats.js";
import { BUCKET_MS, SCOPE_RANGE, timeWindow } from "../../lib/time-axis.js";
import { Card } from "../layout/Card.jsx";
import { TimeScopeNote, TimeScopeToggle } from "./TimeScopeToggle.jsx";

/* ================= SLA compliance · monthly trend ================= */
// The ServiceNow PA "SLA compliance" scorecard, rebuilt against the SOP
// cadence (this app's only SLA — see enrich.js) and split by WHY the misses
// missed: a blown initial response vs a blown update cadence. 100% stacked so
// months of different volume compare honestly; raw counts ride in the tooltip.
// Same met/initial/cadence colors as the headline SLA card above it.
export function SlaComplianceTrendBlock({ rows, dateRange }) {
  const data = useMemo(() => monthlySlaComposition(rows), [rows]);
  const [scope, setScope] = useState(SCOPE_RANGE);
  const win = useMemo(
    () => timeWindow({
      data, key: "month", valueKeys: ["total"],
      range: dateRange, scope, bucketMs: BUCKET_MS.month,
    }),
    [data, dateRange, scope],
  );

  const hasSignal = data.some((d) => d.total > 0);
  if (!hasSignal) {
    return (
      <Card>
        <div className="eyebrow" style={{ color: T.muted }}>SLA compliance · monthly</div>
        <div style={{ color: T.sub, fontSize: 13, fontStyle: "italic", marginTop: 12 }}>
          No SLA-eligible cases in the dataset yet.
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div className="eyebrow" style={{ color: T.muted }}>SLA compliance · monthly</div>
        <TimeScopeToggle scope={scope} onScopeChange={setScope} range={dateRange} />
      </div>
      <div style={{ color: T.sub, fontSize: 12, marginTop: 4, maxWidth: 720 }}>
        Each month's SLA-eligible cases (by creation month), split into met versus missed — and misses
        split by why: the first response came too late, or an update-cadence gap opened later in the
        case's life. Stacked to 100% so a quiet month and a flood month compare honestly; hover for the
        raw counts. A growing amber band is a triage problem; a growing red band is a follow-through problem.
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
              domain={[0, 100]}
              tick={{ fill: T.muted, fontSize: 11, fontFamily: "JetBrains Mono" }}
              axisLine={{ stroke: T.border }}
              tickLine={{ stroke: T.border }}
              tickFormatter={(v) => `${v}%`}
            />
            <Tooltip content={<SlaTrendTip />} cursor={{ fill: T.surfaceAlt }} />
            <Legend wrapperStyle={{ fontSize: 11, color: T.sub }} iconType="square" />
            <ReferenceLine y={90} stroke={T.muted} strokeDasharray="4 4" strokeWidth={1} />
            <Bar dataKey="metPct" name="met" stackId="sla" fill={T.ok} fillOpacity={0.85} />
            <Bar dataKey="initialPct" name="missed · first response" stackId="sla" fill={T.warn} fillOpacity={0.85} />
            <Bar dataKey="cadencePct" name="missed · update cadence" stackId="sla" fill={T.danger} fillOpacity={0.85} radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <TimeScopeNote win={win} unit="month" scope={scope} />
      <div style={{ color: T.muted, fontSize: 11, marginTop: 8 }}>
        Recent months judge open cases against the cadence up to the data snapshot, so the latest month
        can still degrade as its cases age — treat the right edge as provisional, not final.
      </div>
    </Card>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function SlaTrendTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const dte = new Date(d.month);
  const pct = (v) => (v == null ? "—" : `${Math.round(v)}%`);
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, padding: "8px 12px", borderRadius: 4, fontSize: 12 }}>
      <div style={{ fontWeight: 600 }}>{MONTHS[dte.getMonth()]} {dte.getFullYear()}</div>
      {d.total ? (
        <>
          <div className="mono" style={{ color: T.sub }}>met {d.met}/{d.total} ({pct(d.metPct)})</div>
          <div className="mono" style={{ color: T.sub }}>first response missed: {d.missedInitial}</div>
          <div className="mono" style={{ color: T.sub }}>cadence missed: {d.missedCadence}</div>
        </>
      ) : (
        <div style={{ color: T.muted }}>No eligible cases created this month</div>
      )}
    </div>
  );
}
