import { useMemo, useState } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts";
import { T, alpha } from "../../lib/theme.js";
import { AGING_BUCKETS } from "../../lib/constants.js";
import { backlogAgeTrend } from "../../lib/stats.js";
import { BUCKET_MS, SCOPE_RANGE, timeWindow } from "../../lib/time-axis.js";
import { Card } from "../layout/Card.jsx";
import { TimeScopeNote, TimeScopeToggle } from "./TimeScopeToggle.jsx";

// Same bucket colors as the per-assignee aging chart, so "31–90d" reads
// identically everywhere it appears.
const AGE_COLORS = [T.ok, T.warn, T.accent, T.danger];

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
        <div className="eyebrow" style={{ color: T.muted }}>Backlog age composition · weekly</div>
        <div style={{ color: T.sub, fontSize: 13, fontStyle: "italic", marginTop: 12 }}>
          Not enough dated cases to reconstruct the backlog's history.
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div className="eyebrow" style={{ color: T.muted }}>Backlog age composition · weekly</div>
        <TimeScopeToggle scope={scope} onScopeChange={setScope} range={dateRange} />
      </div>
      <div style={{ color: T.sub, fontSize: 12, marginTop: 4, maxWidth: 720 }}>
        The open backlog at the end of each week, split by how old each case was at that moment — the
        same age buckets as the per-assignee chart. Total height is backlog size; the mix is backlog
        health. A green-dominated stack is a queue turning over; thickening amber-to-red bands mean the
        backlog is graying, with old cases accumulating under the fresh intake.
      </div>
      <div style={{ height: 300, marginTop: 12 }}>
        <ResponsiveContainer>
          <AreaChart data={win.data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={T.borderSoft} vertical={false} />
            <XAxis
              dataKey="week"
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
            <Tooltip content={<AgeTip />} cursor={{ stroke: T.border }} />
            {/* Explicit payload: recharts 3 otherwise sorts legend items
              * alphabetically, which shuffles "31–90d" ahead of "8–30d". */}
            <Legend
              wrapperStyle={{ fontSize: 11, color: T.sub }}
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
                stroke={AGE_COLORS[i]}
                fill={alpha(AGE_COLORS[i], 0.55)}
                strokeWidth={1.5}
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
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, padding: "8px 12px", borderRadius: 4, fontSize: 12 }}>
      <div style={{ fontWeight: 600 }}>Week of {MONTHS[dte.getMonth()]} {dte.getDate()}, {dte.getFullYear()}</div>
      {AGING_BUCKETS.map((b, i) => (
        <div key={b.name} className="mono" style={{ color: T.sub, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 8, height: 8, background: AGE_COLORS[i], borderRadius: 2, display: "inline-block" }} />
          {b.name}: {d[b.name] ?? 0}
        </div>
      ))}
      <div className="mono" style={{ color: T.muted, marginTop: 2 }}>{d.total} open in total</div>
    </div>
  );
}
