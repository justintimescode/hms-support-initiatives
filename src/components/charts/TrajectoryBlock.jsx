import { useMemo, useState } from "react";
import {
  Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Line, ComposedChart, Legend,
} from "recharts";
import { T } from "../../lib/theme.js";
import { fmtFullDate } from "../../lib/format.js";
import { dailyTrajectory, weeklyIntakeResolved } from "../../lib/stats.js";
import { BUCKET_MS, SCOPE_RANGE, liveGridEnd, timeWindow } from "../../lib/time-axis.js";
import { Card } from "../layout/Card.jsx";
import { TimeScopeNote, TimeScopeToggle } from "./TimeScopeToggle.jsx";

/* ================= Trends Over Time ================= */
export function TrajectoryBlock({ rows, dateRange, snapshotMs }) {
  // COUNTS are anchored to the data snapshot (deterministic for a given import);
  // the GRID runs on to today, so the axis doesn't end on the day the export was
  // uploaded. Days past the snapshot carry the backlog forward with null
  // created/closed — see dailyTrajectory + liveGridEnd.
  const gridEnd = useMemo(() => liveGridEnd(snapshotMs), [snapshotMs]);
  const trajectory = useMemo(
    () => dailyTrajectory(rows, snapshotMs || undefined, gridEnd),
    [rows, snapshotMs, gridEnd],
  );
  const weekly = useMemo(
    () => weeklyIntakeResolved(rows, snapshotMs || undefined),
    [rows, snapshotMs],
  );

  // One scope for both charts in the card: they answer the same question at two
  // granularities, so letting them drift to different windows would invite
  // reading a daily spike against a weekly total that doesn't contain it.
  const [scope, setScope] = useState(SCOPE_RANGE);
  // `open` is the standing backlog, so it is nonzero across the whole arc and
  // effectively suppresses edge-trimming here — correct, because a day with no
  // intake still carries a real backlog worth plotting.
  const dayWin = useMemo(
    () => timeWindow({
      data: trajectory, key: "date", valueKeys: ["open", "created"],
      range: dateRange, scope, bucketMs: BUCKET_MS.day,
    }),
    [trajectory, dateRange, scope],
  );
  const weekWin = useMemo(
    () => timeWindow({
      data: weekly, key: "week", valueKeys: ["created", "resolved"],
      range: dateRange, scope, bucketMs: BUCKET_MS.week, tickTarget: 10,
    }),
    [weekly, dateRange, scope],
  );

  if (!trajectory.length) {
    return (
      <Card>
        <div style={{ color: T.sub, fontSize: 13, fontStyle: "italic" }}>Not enough date range to plot a trajectory.</div>
      </Card>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Card>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <div className="eyebrow" style={{ color: T.muted, textAlign: "left" }}>Backlog trajectory · daily</div>
          <TimeScopeToggle scope={scope} onScopeChange={setScope} range={dateRange} />
        </div>
        <div style={{ color: T.sub, fontSize: 12, marginTop: 4, textAlign: "left" }}>
          Open-case count per day. Faint bars behind the line show how many new cases were created that day. Rising line + steady bars = backlog growing; falling line = catching up.
        </div>
        <div style={{ height: 280, marginTop: 12 }}>
          <ResponsiveContainer>
            <ComposedChart data={dayWin.data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={T.borderSoft} vertical={false} />
              <XAxis
                dataKey="date"
                type="number"
                domain={dayWin.domain}
                tickFormatter={dayWin.tickFormatter}
                tick={{ fill: T.sub, fontSize: 11 }}
                axisLine={{ stroke: T.border }}
                tickLine={{ stroke: T.border }}
                ticks={dayWin.ticks}
                interval="preserveStartEnd"
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
              <Bar yAxisId="right" dataKey="created" name="new cases created that day (right axis)" fill="#2563EB" fillOpacity={0.55} radius={[2, 2, 0, 0]} />
              <Line yAxisId="left" type="monotone" dataKey="open" name="open backlog (left axis)" stroke={T.accent} strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <TimeScopeNote win={dayWin} unit="day" scope={scope} />
      </Card>

      <Card>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <div className="eyebrow" style={{ color: T.muted, textAlign: "left" }}>Weekly intake vs. resolved</div>
          <TimeScopeToggle scope={scope} onScopeChange={setScope} range={dateRange} />
        </div>
        <div style={{ color: T.sub, fontSize: 12, marginTop: 4, textAlign: "left" }}>
          Cases created and cases resolved per week (Monday-anchored). The line is a rolling 4-week net (created − resolved): above zero = backlog growing, below zero = shrinking.
        </div>
        <div style={{ height: 260, marginTop: 12 }}>
          <ResponsiveContainer>
            <ComposedChart data={weekWin.data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={T.borderSoft} vertical={false} />
              <XAxis
                dataKey="week"
                type="number"
                domain={weekWin.domain}
                tickFormatter={weekWin.tickFormatter}
                tick={{ fill: T.sub, fontSize: 11 }}
                axisLine={{ stroke: T.border }}
                tickLine={{ stroke: T.border }}
                ticks={weekWin.ticks}
                interval="preserveStartEnd"
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
              <Bar yAxisId="left" dataKey="created" name="created" fill={T.accent} radius={[2, 2, 0, 0]} />
              <Bar yAxisId="left" dataKey="resolved" name="resolved" fill={T.ok} radius={[2, 2, 0, 0]} />
              <Line yAxisId="right" type="monotone" dataKey="rollingNet" name="rolling net (4wk avg)" stroke={T.ink} strokeWidth={1.5} dot={false} strokeDasharray="4 3" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <TimeScopeNote win={weekWin} unit="week" scope={scope} />
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
      {d.stale ? (
        // Past the import: the backlog is carried forward, but no intake/close
        // events have been observed — say so rather than showing "0 created".
        <div className="mono" style={{ color: T.muted }}>carried forward · no import yet</div>
      ) : (
        <div className="mono" style={{ color: T.sub }}>{d.created} created · {d.closed} closed</div>
      )}
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
