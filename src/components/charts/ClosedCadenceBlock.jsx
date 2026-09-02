import { useMemo, useState } from "react";
import {
  Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Line, ComposedChart, Legend,
} from "recharts";
import { T, AXIS_TICK, BAR_RADIUS_V, LEGEND_STYLE, TOOLTIP_STYLE } from "../../lib/theme.js";
import { fmtFullDate } from "../../lib/format.js";
import { dailyClosed } from "../../lib/stats.js";
import { BUCKET_MS, SCOPE_RANGE, timeWindow } from "../../lib/time-axis.js";
import { Card } from "../layout/Card.jsx";
import { TimeScopeNote, TimeScopeToggle } from "./TimeScopeToggle.jsx";

/* ================= Cases Closed · daily cadence ================= */
// Cases ACTUALLY CLOSED per day, keyed off the ServiceNow close timestamp
// (`_closed`) — distinct from resolution time. Bars are the raw daily close
// count; the line is a trailing 7-day average to read through weekday/weekend
// spikiness. Shares the backlog-trajectory chart's daily x-axis grid so both
// cards land on the same window across the Trends page.
export function ClosedCadenceBlock({ rows, dateRange, snapshotMs }) {
  // Anchor the day-grid to the data snapshot (not the live clock) so a stale
  // import doesn't sprout a trailing run of zero-close days that drags the
  // 7-day average toward a fake "throughput collapse" — and so this grid stays
  // aligned with the backlog-trajectory chart above it. See dailyClosed.
  const data = useMemo(() => dailyClosed(rows, snapshotMs || undefined), [rows, snapshotMs]);
  const [scope, setScope] = useState(SCOPE_RANGE);
  // Zoom by SLICING the precomputed series, which is what keeps the 7-day
  // average honest: each point's `rollingAvg` was computed against full history,
  // so the first visible day still averages in the six days before the window.
  // Recomputing from the sliced rows would restart the average at the window
  // edge and invent a ramp-up that never happened.
  //
  // `rollingAvg` joins the emptiness test so a decaying tail of zero-close days
  // isn't trimmed away while the average is still saying something.
  const win = useMemo(
    () => timeWindow({
      data, key: "date", valueKeys: ["closed", "rollingAvg"],
      range: dateRange, scope, bucketMs: BUCKET_MS.day,
    }),
    [data, dateRange, scope],
  );

  if (!data.length) {
    return (
      <Card>
        <div style={{ color: T.sub, fontSize: 13, fontStyle: "italic" }}>Not enough date range to plot daily closures.</div>
      </Card>
    );
  }

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div className="eyebrow" style={{ textAlign: "left" }}>Cases closed · daily</div>
        <TimeScopeToggle scope={scope} onScopeChange={setScope} range={dateRange} />
      </div>
      <div style={{ color: T.sub, fontSize: 12, marginTop: 4, textAlign: "left" }}>
        Cases actually closed each day, by their ServiceNow close date (not resolution time). The line is a trailing 7-day average that smooths the weekday/weekend swing so the underlying throughput trend is readable; it carries in from before the visible window, so the left edge is not a ramp-up.
      </div>
      <div style={{ height: 280, marginTop: 12, background: T.vizWell, borderRadius: T.radiusMd }}>
        <ResponsiveContainer>
          <ComposedChart data={win.data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={T.vizGrid} vertical={false} />
            <XAxis
              dataKey="date"
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
              tick={AXIS_TICK}
              axisLine={{ stroke: T.vizAxis }}
              tickLine={{ stroke: T.vizAxis }}
              allowDecimals={false}
            />
            <Tooltip content={<ClosedTip />} cursor={{ fill: T.vizWell }} />
            <Legend wrapperStyle={LEGEND_STYLE} iconType="square" />
            {/* Single metric: solid purple lead bars under a neutral reference line. */}
            <Bar dataKey="closed" name="cases closed that day" fill={T.vizAccent} radius={BAR_RADIUS_V} />
            <Line type="monotone" dataKey="rollingAvg" name="7-day average" stroke={T.vizCat} strokeWidth={1.5} dot={false} strokeDasharray="4 3" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <TimeScopeNote win={win} unit="day" scope={scope} />
    </Card>
  );
}

function ClosedTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={TOOLTIP_STYLE}>
      <div style={{ fontWeight: 600 }}>{fmtFullDate(d.date)}</div>
      <div className="mono" style={{ color: T.sub }}>{d.closed} closed</div>
      <div className="mono" style={{ color: T.muted }}>7-day avg {d.rollingAvg}</div>
    </div>
  );
}
