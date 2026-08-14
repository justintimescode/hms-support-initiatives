import { useMemo, useState } from "react";
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts";
import { T } from "../../lib/theme.js";
import { monthlyResolutionTrend } from "../../lib/stats.js";
import { BUCKET_MS, SCOPE_RANGE, timeWindow } from "../../lib/time-axis.js";
import { Card } from "../layout/Card.jsx";
import { TimeScopeNote, TimeScopeToggle } from "./TimeScopeToggle.jsx";

/* ================= Time to Resolve · monthly trend ================= */
// The ServiceNow PA "Average time to resolve" indicator, rebuilt from the
// export — but told with the median and P90 instead of the mean, so one
// six-month whale can't disguise itself as a slow month. Cases land in the
// month they CLOSED (that's when the resolution time became a fact).
export function ResolutionTimeTrendBlock({ rows, dateRange, snapshotMs }) {
  void snapshotMs; // resolution time needs no snapshot anchor — closes are historical facts
  const data = useMemo(() => monthlyResolutionTrend(rows), [rows]);
  const [scope, setScope] = useState(SCOPE_RANGE);
  const win = useMemo(
    () => timeWindow({
      data, key: "month", valueKeys: ["medianDays", "p90Days"],
      range: dateRange, scope, bucketMs: BUCKET_MS.month,
    }),
    [data, dateRange, scope],
  );

  const hasSignal = data.some((d) => d.n > 0);
  if (!hasSignal) {
    return (
      <Card>
        <div className="eyebrow" style={{ color: T.muted }}>Time to resolve · monthly</div>
        <div style={{ color: T.sub, fontSize: 13, fontStyle: "italic", marginTop: 12 }}>
          No closed cases with a measurable resolution time yet.
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div className="eyebrow" style={{ color: T.muted }}>Time to resolve · monthly</div>
        <TimeScopeToggle scope={scope} onScopeChange={setScope} range={dateRange} />
      </div>
      <div style={{ color: T.sub, fontSize: 12, marginTop: 4, maxWidth: 720 }}>
        How long cases closed in each month took to resolve, creation to close. The solid line is the
        median (the typical case); the dashed line is the 90th percentile (the slow tail). A widening
        gap between them means a minority of cases is dragging badly even while the typical case is fine.
        Months with no closes draw as gaps, not zeroes.
      </div>
      <div style={{ height: 280, marginTop: 12 }}>
        <ResponsiveContainer>
          <ComposedChart data={win.data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
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
              label={{ value: "days", angle: -90, position: "insideLeft", fill: T.muted, fontSize: 11 }}
            />
            <Tooltip content={<ResTip />} cursor={{ stroke: T.border }} />
            <Legend wrapperStyle={{ fontSize: 11, color: T.sub }} iconType="plainline" />
            <Line
              type="monotone" dataKey="medianDays" name="median"
              stroke={T.accent} strokeWidth={2} dot={{ r: 2 }} connectNulls={false}
            />
            <Line
              type="monotone" dataKey="p90Days" name="90th percentile"
              stroke={T.warn} strokeWidth={1.5} strokeDasharray="5 3" dot={false} connectNulls={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <TimeScopeNote win={win} unit="month" scope={scope} />
    </Card>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtMonth = (ts) => {
  const d = new Date(ts);
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};

function ResTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, padding: "8px 12px", borderRadius: 4, fontSize: 12 }}>
      <div style={{ fontWeight: 600 }}>{fmtMonth(d.month)}</div>
      {d.n ? (
        <>
          <div className="mono" style={{ color: T.sub }}>median {d.medianDays}d · p90 {d.p90Days}d</div>
          <div className="mono" style={{ color: T.muted }}>avg {d.avgDays}d · {d.n} case{d.n === 1 ? "" : "s"} closed</div>
        </>
      ) : (
        <div style={{ color: T.muted }}>No cases closed this month</div>
      )}
    </div>
  );
}
