import { useMemo, useState } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts";
import { T, AXIS_TICK, LEGEND_STYLE, TOOLTIP_STYLE } from "../../lib/theme.js";
import { AGING_BUCKETS } from "../../lib/constants.js";
import { backlogAgeTrend } from "../../lib/stats.js";
import { BUCKET_MS, SCOPE_RANGE, timeWindow } from "../../lib/time-axis.js";
import { Card } from "../layout/Card.jsx";
import { TimeScopeNote, TimeScopeToggle } from "./TimeScopeToggle.jsx";

// Same bucket colors as the per-assignee aging chart, so "31–90d" reads
// identically everywhere it appears. One ordinal purple ramp indexed by age —
// strictly monotonic in luminance in BOTH themes (light theme runs pale→deep
// with age, dark inverts), so the buckets stay orderable in grayscale and under
// deuteranomaly. Never describe the bands by lightness in user-facing copy: the
// direction flips with the theme. Name the bucket instead.
const AGE_COLORS = T.vizRamp;

/* ================= Backlog age composition · weekly ================= */
// ServiceNow shows how old the backlog is TODAY; this rebuilds that answer for
// every past week from the export's timestamps. The question it answers is the
// one a size-only trend hides: is the backlog merely big, or is it GRAYING —
// the same old cases sliding into ever-older buckets while fresh intake churns
// on top of them?
export function BacklogAgeTrendBlock({ rows, dateRange, snapshotMs }) {
  const data = useMemo(
    () => backlogAgeTrend(rows, snapshotMs || undefined),
    [rows, snapshotMs],
  );
  const [scope, setScope] = useState(SCOPE_RANGE);
  const win = useMemo(
    () => timeWindow({
      data, key: "week", valueKeys: ["total"],
      range: dateRange, scope, bucketMs: BUCKET_MS.week,
    }),
    [data, dateRange, scope],
  );

  if (!data.length) {
    return (
      <Card>
        <div className="eyebrow">Backlog age composition · weekly</div>
        <div style={{ color: T.sub, fontSize: 13, fontStyle: "italic", marginTop: 12 }}>
          Not enough dated cases to reconstruct the backlog's history.
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div className="eyebrow">Backlog age composition · weekly</div>
        <TimeScopeToggle scope={scope} onScopeChange={setScope} range={dateRange} />
      </div>
      <div style={{ color: T.sub, fontSize: 12, marginTop: 4, maxWidth: 720 }}>
        The open backlog at the end of each week, split by how old each case was at that moment — the
        same age buckets as the per-assignee chart. Total height is backlog size; the mix is backlog
        health. A stack dominated by the 0–7d band is a queue turning over; thickening 31–90d and 90d+
        bands mean the backlog is graying, with old cases accumulating under the fresh intake.
      </div>
      <div style={{ height: 300, marginTop: 12, background: T.vizWell, borderRadius: T.radiusMd }}>
        <ResponsiveContainer>
          <AreaChart data={win.data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={T.vizGrid} vertical={false} />
            <XAxis
              dataKey="week"
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
            <Tooltip content={<AgeTip />} cursor={{ fill: T.vizWell }} />
            {/* Explicit payload: recharts 3 otherwise sorts legend items
              * alphabetically, which shuffles "31–90d" ahead of "8–30d". */}
            <Legend
              wrapperStyle={LEGEND_STYLE}
              iconType="square"
              payload={AGING_BUCKETS.map((b, i) => ({
                value: b.name, type: "square", color: AGE_COLORS[i], id: b.name,
              }))}
            />
            {AGING_BUCKETS.map((b, i) => (
              <Area
                key={b.name}
                type="monotone"
                dataKey={b.name}
                name={b.name}
                stackId="age"
                stroke={T.vizStroke}
                fill={AGE_COLORS[i]}
                strokeWidth={1}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <TimeScopeNote win={win} unit="week" scope={scope} />
      <div style={{ color: T.muted, fontSize: 11, marginTop: 8 }}>
        "Open" at each week excludes cases already closed or sitting in Solution Proposed by then, using
        the same lifecycle anchors as the cumulative-flow chart. The export only holds cases created in
        its window, so the earliest weeks understate the backlog that actually existed then.
      </div>
    </Card>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function AgeTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const dte = new Date(d.week);
  return (
    <div style={TOOLTIP_STYLE}>
      <div style={{ fontWeight: 600 }}>Week of {MONTHS[dte.getMonth()]} {dte.getDate()}, {dte.getFullYear()}</div>
      {AGING_BUCKETS.map((b, i) => (
        <div key={b.name} className="mono" style={{ color: T.sub, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 8, height: 8, background: AGE_COLORS[i], borderRadius: T.radiusChart, display: "inline-block" }} />
          {b.name}: {d[b.name] ?? 0}
        </div>
      ))}
      <div className="mono" style={{ color: T.muted, marginTop: 2 }}>{d.total} open in total</div>
    </div>
  );
}
