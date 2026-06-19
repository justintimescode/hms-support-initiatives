import { useMemo } from "react";
import {
  Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Line, ComposedChart, Legend, ReferenceArea,
} from "recharts";
import { T } from "../../lib/theme.js";
import { fmtAxisDate, fmtFullDate } from "../../lib/format.js";
import { dailyClosed } from "../../lib/stats.js";
import { Card } from "../layout/Card.jsx";

/* ================= Cases Closed · daily cadence ================= */
// Cases ACTUALLY CLOSED per day, keyed off the ServiceNow close timestamp
// (`_closed`) — distinct from resolution time. Bars are the raw daily close
// count; the line is a trailing 7-day average to read through weekday/weekend
// spikiness. Shares the backlog-trajectory chart's daily x-axis grid so the
// active-filter highlight band lines up across the Trends page.
export function ClosedCadenceBlock({ rows, highlightRange, snapshotMs }) {
  // Anchor the day-grid to the data snapshot (not the live clock) so a stale
  // import doesn't sprout a trailing run of zero-close days that drags the
  // 7-day average toward a fake "throughput collapse" — and so this grid stays
  // aligned with the backlog-trajectory chart above it. See dailyClosed.
  const data = useMemo(() => dailyClosed(rows, snapshotMs || undefined), [rows, snapshotMs]);
  const hl = highlightRange && highlightRange.from != null && highlightRange.to != null ? highlightRange : null;

  if (!data.length) {
    return (
      <Card>
        <div style={{ color: T.sub, fontSize: 13, fontStyle: "italic" }}>Not enough date range to plot daily closures.</div>
      </Card>
    );
  }

  const tickInterval = Math.max(1, Math.floor(data.length / 8));
  const dayPad = 12 * 36e5; // half a day buffer so end-bars don't clip the axis

  return (
    <Card>
      <div className="eyebrow" style={{ color: T.muted, textAlign: "left" }}>Cases closed · daily</div>
      <div style={{ color: T.sub, fontSize: 12, marginTop: 4, textAlign: "left" }}>
        Cases actually closed each day, by their ServiceNow close date (not resolution time). The line is a trailing 7-day average that smooths the weekday/weekend swing so the underlying throughput trend is readable.
      </div>
      <div style={{ height: 280, marginTop: 12 }}>
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={T.borderSoft} vertical={false} />
            <XAxis
              dataKey="date"
              type="number"
              domain={[(min) => min - dayPad, (max) => max + dayPad]}
              tickFormatter={fmtAxisDate}
              tick={{ fill: T.sub, fontSize: 11 }}
              axisLine={{ stroke: T.border }}
              tickLine={{ stroke: T.border }}
              interval={tickInterval}
            />
            <YAxis
              tick={{ fill: T.muted, fontSize: 11, fontFamily: "JetBrains Mono" }}
              axisLine={{ stroke: T.border }}
              tickLine={{ stroke: T.border }}
              allowDecimals={false}
            />
            <Tooltip content={<ClosedTip />} cursor={{ fill: T.surfaceAlt }} />
            <Legend wrapperStyle={{ fontSize: 11, color: T.sub }} iconType="square" />
            {hl && (
              <ReferenceArea
                x1={hl.from}
                x2={hl.to}
                fill={T.accent}
                fillOpacity={0.08}
                stroke={T.accent}
                strokeOpacity={0.35}
                ifOverflow="extendDomain"
              />
            )}
            <Bar dataKey="closed" name="cases closed that day" fill={T.ok} fillOpacity={0.7} radius={[2, 2, 0, 0]} />
            <Line type="monotone" dataKey="rollingAvg" name="7-day average" stroke={T.ink} strokeWidth={1.5} dot={false} strokeDasharray="4 3" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function ClosedTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, padding: "8px 12px", borderRadius: 4, fontSize: 12 }}>
      <div style={{ fontWeight: 600 }}>{fmtFullDate(d.date)}</div>
      <div className="mono" style={{ color: T.sub }}>{d.closed} closed</div>
      <div className="mono" style={{ color: T.muted }}>7-day avg {d.rollingAvg}</div>
    </div>
  );
}
