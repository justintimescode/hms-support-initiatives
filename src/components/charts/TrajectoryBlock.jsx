import { useMemo } from "react";
import {
  Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Line, ComposedChart, Legend, ReferenceArea,
} from "recharts";
import { T } from "../../lib/theme.js";
import { fmtAxisDate, fmtWeekLabel, fmtFullDate } from "../../lib/format.js";
import { dailyTrajectory, weeklyIntakeResolved } from "../../lib/stats.js";
import { Card } from "../layout/Card.jsx";

/* ================= Trends Over Time ================= */
export function TrajectoryBlock({ rows, highlightRange, snapshotMs }) {
  // Anchor the day/week grid to the data snapshot rather than the live clock so
  // the trajectory is deterministic for a given import (and its grid lines up
  // with the daily-closed chart below it). Falls back to "now" when no snapshot.
  const trajectory = useMemo(() => dailyTrajectory(rows, snapshotMs || undefined), [rows, snapshotMs]);
  const weekly = useMemo(() => weeklyIntakeResolved(rows, snapshotMs || undefined), [rows, snapshotMs]);
  const hl = highlightRange && highlightRange.from != null && highlightRange.to != null ? highlightRange : null;

  if (!trajectory.length) {
    return (
      <Card>
        <div style={{ color: T.sub, fontSize: 13, fontStyle: "italic" }}>Not enough date range to plot a trajectory.</div>
      </Card>
    );
  }

  const tickInterval = Math.max(1, Math.floor(trajectory.length / 8));
  const dayPad = 12 * 36e5; // half a day buffer so end-bars don't clip the axis
  const weekPad = 3.5 * 864e5; // half a week buffer for the weekly chart

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Card>
        <div className="eyebrow" style={{ color: T.muted, textAlign: "left" }}>Backlog trajectory · daily</div>
        <div style={{ color: T.sub, fontSize: 12, marginTop: 4, textAlign: "left" }}>
          Open-case count per day from the oldest case to today. Faint bars behind the line show how many new cases were created that day. Rising line + steady bars = backlog growing; falling line = catching up.
        </div>
        <div style={{ height: 280, marginTop: 12 }}>
          <ResponsiveContainer>
            <ComposedChart data={trajectory} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
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
                yAxisId="left"
                tick={{ fill: T.muted, fontSize: 11, fontFamily: "JetBrains Mono" }}
                axisLine={{ stroke: T.border }}
                tickLine={{ stroke: T.border }}
                allowDecimals={false}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fill: T.muted, fontSize: 11, fontFamily: "JetBrains Mono" }}
                axisLine={{ stroke: T.border }}
                tickLine={{ stroke: T.border }}
                allowDecimals={false}
              />
              <Tooltip content={<TrajectoryTip />} cursor={{ fill: T.surfaceAlt }} />
              <Legend wrapperStyle={{ fontSize: 11, color: T.sub }} iconType="square" />
              {hl && (
                <ReferenceArea
                  yAxisId="left"
                  x1={hl.from}
                  x2={hl.to}
                  fill={T.accent}
                  fillOpacity={0.08}
                  stroke={T.accent}
                  strokeOpacity={0.35}
                  ifOverflow="extendDomain"
                />
              )}
              <Bar yAxisId="right" dataKey="created" name="new cases created that day (right axis)" fill="#2563EB" fillOpacity={0.55} radius={[2, 2, 0, 0]} />
              <Line yAxisId="left" type="monotone" dataKey="open" name="open backlog (left axis)" stroke={T.accent} strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card>
        <div className="eyebrow" style={{ color: T.muted, textAlign: "left" }}>Weekly intake vs. resolved</div>
        <div style={{ color: T.sub, fontSize: 12, marginTop: 4, textAlign: "left" }}>
          Cases created and cases resolved per week (Monday-anchored). The line is a rolling 4-week net (created − resolved): above zero = backlog growing, below zero = shrinking.
        </div>
        <div style={{ height: 260, marginTop: 12 }}>
          <ResponsiveContainer>
            <ComposedChart data={weekly} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={T.borderSoft} vertical={false} />
              <XAxis
                dataKey="week"
                type="number"
                domain={[(min) => min - weekPad, (max) => max + weekPad]}
                tickFormatter={fmtWeekLabel}
                tick={{ fill: T.sub, fontSize: 11 }}
                axisLine={{ stroke: T.border }}
                tickLine={{ stroke: T.border }}
                interval={Math.max(0, Math.floor(weekly.length / 10))}
              />
              <YAxis
                yAxisId="left"
                tick={{ fill: T.muted, fontSize: 11, fontFamily: "JetBrains Mono" }}
                axisLine={{ stroke: T.border }}
                tickLine={{ stroke: T.border }}
                allowDecimals={false}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fill: T.muted, fontSize: 11, fontFamily: "JetBrains Mono" }}
                axisLine={{ stroke: T.border }}
                tickLine={{ stroke: T.border }}
              />
              <Tooltip content={<WeeklyTip />} cursor={{ fill: T.surfaceAlt }} />
              <Legend wrapperStyle={{ fontSize: 11, color: T.sub }} />
              {hl && (
                <ReferenceArea
                  yAxisId="left"
                  x1={hl.from}
                  x2={hl.to}
                  fill={T.accent}
                  fillOpacity={0.08}
                  stroke={T.accent}
                  strokeOpacity={0.35}
                  ifOverflow="extendDomain"
                />
              )}
              <Bar yAxisId="left" dataKey="created" name="created" fill={T.accent} radius={[2, 2, 0, 0]} />
              <Bar yAxisId="left" dataKey="resolved" name="resolved" fill={T.ok} radius={[2, 2, 0, 0]} />
              <Line yAxisId="right" type="monotone" dataKey="rollingNet" name="rolling net (4wk avg)" stroke={T.ink} strokeWidth={1.5} dot={false} strokeDasharray="4 3" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}

function TrajectoryTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, padding: "8px 12px", borderRadius: 4, fontSize: 12 }}>
      <div style={{ fontWeight: 600 }}>{fmtFullDate(d.date)}</div>
      <div className="mono" style={{ color: T.sub }}>{d.open} open</div>
      <div className="mono" style={{ color: T.sub }}>{d.created} created · {d.closed} closed</div>
    </div>
  );
}

function WeeklyTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const netColor = d.net > 0 ? T.danger : d.net < 0 ? T.ok : T.muted;
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, padding: "8px 12px", borderRadius: 4, fontSize: 12 }}>
      <div style={{ fontWeight: 600 }}>Week of {fmtFullDate(d.week)}</div>
      <div className="mono" style={{ color: T.sub }}>{d.created} created · {d.resolved} resolved</div>
      <div className="mono" style={{ color: netColor }}>net {d.net > 0 ? "+" : ""}{d.net} · 4wk avg {d.rollingNet > 0 ? "+" : ""}{d.rollingNet}</div>
    </div>
  );
}
