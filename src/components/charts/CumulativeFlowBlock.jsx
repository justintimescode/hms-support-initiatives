import { useMemo, useState } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts";
import { T, AXIS_TICK, LEGEND_STYLE, TOOLTIP_STYLE } from "../../lib/theme.js";
import { cumulativeFlow } from "../../lib/stats.js";
import { BUCKET_MS, SCOPE_RANGE, timeWindow } from "../../lib/time-axis.js";
import { Card } from "../layout/Card.jsx";
import { TimeScopeNote, TimeScopeToggle } from "./TimeScopeToggle.jsx";

/* ================= Cumulative flow · lifecycle over time ================= */
// The kanban-style cumulative flow diagram ServiceNow doesn't ship: every case
// in the dataset, partitioned each week by where its lifecycle sat (truly open /
// Solution Proposed / closed). The bands stack to the full case count, so the
// SHAPE is the story: a fattening open band is backlog growth, a fattening
// Solution-Proposed band is work parked on customers, and the closed band's
// slope is real throughput. The three bands are steps 1/2/4 of the one ordinal
// purple ramp, running from the ramp's low step (settled) to its high step
// (still open) — the luminance direction flips between the light and dark
// palettes, so the legend, not lightness, is what names a band.
// Historical positions are reconstructed from the export's own timestamps
// (close time; Solution-Proposed entry via the resolution-notes /
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
        <div className="eyebrow">Cumulative flow · lifecycle over time</div>
        <div style={{ color: T.sub, fontSize: 13, fontStyle: "italic", marginTop: 12 }}>
          Not enough dated cases to reconstruct a weekly flow.
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div className="eyebrow">Cumulative flow · lifecycle over time</div>
        <TimeScopeToggle scope={scope} onScopeChange={setScope} range={dateRange} />
      </div>
      <div style={{ color: T.sub, fontSize: 12, marginTop: 4, maxWidth: 720 }}>
        Every case in the dataset, split each week by where it sat: still open, resolved and waiting on
        the customer (Solution Proposed), or closed. Healthy flow keeps the open band a steady thickness
        while the closed band climbs — an open band that keeps thickening means intake is outrunning
        resolution, whatever any single week's numbers say.
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
            <Tooltip content={<FlowTip />} cursor={{ fill: T.vizWell }} />
            {/* Explicit payload: recharts 3 otherwise sorts legend items
              * alphabetically instead of matching the stack order. */}
            <Legend
              wrapperStyle={LEGEND_STYLE}
              iconType="square"
              payload={[
                { value: "closed", type: "square", color: T.vizRamp[0], id: "closed" },
                { value: "solution proposed", type: "square", color: T.vizRamp[1], id: "solutionProposed" },
                { value: "open", type: "square", color: T.vizRamp[3], id: "open" },
              ]}
            />
            <Area
              type="monotone" dataKey="closed" name="closed" stackId="flow"
              stroke={T.vizStroke} fill={T.vizRamp[0]} strokeWidth={1}
            />
            <Area
              type="monotone" dataKey="solutionProposed" name="solution proposed" stackId="flow"
              stroke={T.vizStroke} fill={T.vizRamp[1]} strokeWidth={1}
            />
            <Area
              type="monotone" dataKey="open" name="open" stackId="flow"
              stroke={T.vizStroke} fill={T.vizRamp[3]} strokeWidth={1}
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
    <div style={TOOLTIP_STYLE}>
      <div style={{ fontWeight: 600 }}>{fmtWeek(d.week)}</div>
      <div className="mono" style={{ color: T.sub }}>open {d.open} · proposed {d.solutionProposed} · closed {d.closed}</div>
      <div className="mono" style={{ color: T.muted }}>{d.total} cases on the books</div>
    </div>
  );
}
