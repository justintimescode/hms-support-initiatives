import { useMemo, useState } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts";
import { T, alpha } from "../../lib/theme.js";
import { cumulativeFlow } from "../../lib/stats.js";
import { BUCKET_MS, SCOPE_RANGE, timeWindow } from "../../lib/time-axis.js";
import { Card } from "../layout/Card.jsx";
import { TimeScopeNote, TimeScopeToggle } from "./TimeScopeToggle.jsx";

/* ================= Cumulative flow · lifecycle over time ================= */
// The kanban-style cumulative flow diagram ServiceNow doesn't ship: every case
// in the dataset, partitioned each week by where its lifecycle sat (truly open /
// Solution Proposed / closed). The bands stack to the full case count, so the
// SHAPE is the story: a fattening open band is backlog growth, a fattening
// amber band is work parked on customers, and the closed band's slope is real
// throughput. Historical positions are reconstructed from the export's own
// timestamps (close time; Solution-Proposed entry via the resolution-notes /
// last-Infor-note anchor, same as the auto-close clock).
export function CumulativeFlowBlock({ rows, dateRange, snapshotMs }) {
  const data = useMemo(
    () => cumulativeFlow(rows, snapshotMs || undefined),
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
        <div className="eyebrow" style={{ color: T.muted }}>Cumulative flow · lifecycle over time</div>
        <div style={{ color: T.sub, fontSize: 13, fontStyle: "italic", marginTop: 12 }}>
          Not enough dated cases to reconstruct a weekly flow.
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div className="eyebrow" style={{ color: T.muted }}>Cumulative flow · lifecycle over time</div>
        <TimeScopeToggle scope={scope} onScopeChange={setScope} range={dateRange} />
      </div>
      <div style={{ color: T.sub, fontSize: 12, marginTop: 4, maxWidth: 720 }}>
        Every case in the dataset, split each week by where it sat: still open, resolved and waiting on
        the customer (Solution Proposed), or closed. Healthy flow keeps the open band a steady thickness
        while the closed band climbs — an open band that keeps thickening means intake is outrunning
        resolution, whatever any single week's numbers say.
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
            <Tooltip content={<FlowTip />} cursor={{ stroke: T.border }} />
            {/* Explicit payload: recharts 3 otherwise sorts legend items
              * alphabetically instead of matching the stack order. */}
            <Legend
              wrapperStyle={{ fontSize: 11, color: T.sub }}
              iconType="square"
              payload={[
                { value: "closed", type: "square", color: T.ok, id: "closed" },
                { value: "solution proposed", type: "square", color: T.warn, id: "solutionProposed" },
                { value: "open", type: "square", color: T.accent, id: "open" },
              ]}
            />
            <Area
              type="monotone" dataKey="closed" name="closed" stackId="flow"
              stroke={T.ok} fill={alpha(T.ok, 0.5)} strokeWidth={1.5}
            />
            <Area
              type="monotone" dataKey="solutionProposed" name="solution proposed" stackId="flow"
              stroke={T.warn} fill={alpha(T.warn, 0.5)} strokeWidth={1.5}
            />
            <Area
              type="monotone" dataKey="open" name="open" stackId="flow"
              stroke={T.accent} fill={alpha(T.accent, 0.5)} strokeWidth={1.5}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <TimeScopeNote win={win} unit="week" scope={scope} />
      <div style={{ color: T.muted, fontSize: 11, marginTop: 8 }}>
        Historical positions are rebuilt from case timestamps: the close date, and for Solution Proposed
        the resolution-notes-saved time (falling back to the last Infor note). Weeks before a case
        existed don't count it. The dataset only holds cases from this export, so the far-left weeks
        understate the true totals of their day.
      </div>
    </Card>
  );
}

const fmtWeek = (ts) => {
  const d = new Date(ts);
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `Week of ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
};

function FlowTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, padding: "8px 12px", borderRadius: 4, fontSize: 12 }}>
      <div style={{ fontWeight: 600 }}>{fmtWeek(d.week)}</div>
      <div className="mono" style={{ color: T.sub }}>open {d.open} · proposed {d.solutionProposed} · closed {d.closed}</div>
      <div className="mono" style={{ color: T.muted }}>{d.total} cases on the books</div>
    </div>
  );
}
