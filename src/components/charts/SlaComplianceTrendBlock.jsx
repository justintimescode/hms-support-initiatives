import { useMemo, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import {
  T, AXIS_TICK, LEGEND_STYLE, TOOLTIP_STYLE, BAR_RADIUS_V,
} from "../../lib/theme.js";
import { monthlySlaComposition } from "../../lib/stats.js";
import { BUCKET_MS, SCOPE_RANGE, timeWindow } from "../../lib/time-axis.js";
import { Card } from "../layout/Card.jsx";
import { TimeScopeNote, TimeScopeToggle } from "./TimeScopeToggle.jsx";

/* ================= SLA compliance · monthly trend ================= */
// The ServiceNow PA "SLA compliance" scorecard, rebuilt against the SOP
// cadence (this app's only SLA — see enrich.js) and split by WHY the misses
// missed: a blown initial response vs a blown update cadence. 100% stacked so
// months of different volume compare honestly; raw counts ride in the tooltip.
// Met / initial / cadence read as one three-stop ramp: Infor Purple carries
// the met base, yellow the triage miss, red the follow-through miss.
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
        <div className="eyebrow">SLA compliance · monthly</div>
        <div style={{ color: T.sub, fontSize: 13, fontStyle: "italic", marginTop: 12 }}>
          No SLA-eligible cases in the dataset yet.
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div className="eyebrow">SLA compliance · monthly</div>
        <TimeScopeToggle scope={scope} onScopeChange={setScope} range={dateRange} />
      </div>
      <div style={{ color: T.sub, fontSize: 12, marginTop: 4, maxWidth: 720 }}>
        Each month's SLA-eligible cases (by creation month), split into met versus missed — and misses
        split by why: the first response came too late, or an update-cadence gap opened later in the
        case's life. Stacked to 100% so a quiet month and a flood month compare honestly; hover for the
        raw counts. A growing amber band is a triage problem; a growing red band is a follow-through problem.
      </div>
      <div style={{ height: 280, marginTop: 12, background: T.vizWell, borderRadius: T.radiusMd }}>
        <ResponsiveContainer>
          <BarChart data={win.data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={T.vizGrid} vertical={false} />
            <XAxis
              dataKey="month"
              type="number"
              domain={win.domain}
              tickFormatter={win.tickFormatter}
              tick={AXIS_TICK}
              axisLine={{ stroke: T.vizAxis }}
              tickLine={{ stroke: T.vizAxis }}
              ticks={win.ticks}
              interval="preserveStartEnd"
            />
            <YAxis
              domain={[0, 100]}
              tick={AXIS_TICK}
              axisLine={{ stroke: T.vizAxis }}
              tickLine={{ stroke: T.vizAxis }}
              tickFormatter={(v) => `${v}%`}
            />
            <Tooltip content={<SlaTrendTip />} cursor={{ fill: T.vizWell }} />
            <Legend wrapperStyle={LEGEND_STYLE} iconType="square" />
            <ReferenceLine y={90} stroke={T.vizAxis} strokeDasharray="4 4" strokeWidth={1} />
            <Bar dataKey="metPct" name="met" stackId="sla" fill={T.vizAccent} />
            <Bar dataKey="initialPct" name="missed · first response" stackId="sla" fill={T.warnFill} />
            <Bar dataKey="cadencePct" name="missed · update cadence" stackId="sla" fill={T.dangerFill} radius={BAR_RADIUS_V} />
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
    <div style={TOOLTIP_STYLE}>
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
