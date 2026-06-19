import { useMemo } from "react";
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Line, LineChart, ReferenceArea, Legend,
} from "recharts";
import { T } from "../../lib/theme.js";
import { fmtAxisDate, fmtFullDate } from "../../lib/format.js";
import { dailyTrajectory } from "../../lib/stats.js";
import { Card } from "../layout/Card.jsx";

/* ================= Cases we own · daily ================= */
// Total cases ON OUR BOOKS each day — created by that day and not yet closed.
// Unlike the "open backlog" line (which counts TRULY-open cases only since v8),
// this includes Solution-Proposed cases: a proposed solution awaiting customer
// confirmation is still ours until it closes. A single line, count over time.
//
// Shares the backlog-trajectory chart's snapshot-anchored daily x-axis grid so
// the active-filter highlight band lines up across the Trends page.
export function OwnedCasesBlock({ rows, highlightRange, snapshotMs }) {
  const data = useMemo(() => dailyTrajectory(rows, snapshotMs || undefined), [rows, snapshotMs]);
  const hl = highlightRange && highlightRange.from != null && highlightRange.to != null ? highlightRange : null;

  if (!data.length) {
    return (
      <Card>
        <div style={{ color: T.sub, fontSize: 13, fontStyle: "italic" }}>Not enough date range to plot owned cases.</div>
      </Card>
    );
  }

  const tickInterval = Math.max(1, Math.floor(data.length / 8));
  const dayPad = 12 * 36e5; // half a day buffer so the line doesn't clip the axis

  return (
    <Card>
      <div className="eyebrow" style={{ color: T.muted, textAlign: "left" }}>Cases we own · daily</div>
      <div style={{ color: T.sub, fontSize: 12, marginTop: 4, textAlign: "left" }}>
        Total cases still on our books each day, from the oldest record to today — every case created and not yet closed. The total splits into <span style={{ color: T.accent, fontWeight: 600 }}>open</span> (active work) and <span style={{ color: T.warn, fontWeight: 600 }}>solution proposed</span> (awaiting customer); the two add up to the <span style={{ color: T.ink, fontWeight: 600 }}>total owned</span> line.
      </div>
      <div style={{ height: 280, marginTop: 12 }}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
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
            <Tooltip content={<OwnedTip />} cursor={{ stroke: T.border }} />
            <Legend wrapperStyle={{ fontSize: 11, color: T.sub }} iconType="plainline" />
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
            <Line type="monotone" dataKey="owned" name="total owned" stroke={T.ink} strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="open" name="open" stroke={T.accent} strokeWidth={1.5} dot={false} />
            <Line type="monotone" dataKey="solutionProposed" name="solution proposed" stroke={T.warn} strokeWidth={1.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function OwnedTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, padding: "8px 12px", borderRadius: 4, fontSize: 12 }}>
      <div style={{ fontWeight: 600 }}>{fmtFullDate(d.date)}</div>
      <div className="mono" style={{ color: T.ink }}>{d.owned} total owned</div>
      <div className="mono" style={{ color: T.accent }}>{d.open} open</div>
      <div className="mono" style={{ color: T.warn }}>{d.solutionProposed ?? 0} solution proposed</div>
    </div>
  );
}
