import { useMemo, useState } from "react";
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Line, LineChart, Legend,
} from "recharts";
import { T } from "../../lib/theme.js";
import { fmtFullDate } from "../../lib/format.js";
import { dailyTrajectory } from "../../lib/stats.js";
import { BUCKET_MS, SCOPE_RANGE, liveGridEnd, timeWindow } from "../../lib/time-axis.js";
import { Card } from "../layout/Card.jsx";
import { TimeScopeNote, TimeScopeToggle } from "./TimeScopeToggle.jsx";

/* ================= Cases we own · daily ================= */
// Total cases ON OUR BOOKS each day — created by that day and not yet closed.
// Unlike the "open backlog" line (which counts TRULY-open cases only since v8),
// this includes Solution-Proposed cases: a proposed solution awaiting customer
// confirmation is still ours until it closes. A single line, count over time.
//
// Shares the backlog-trajectory chart's snapshot-anchored daily grid, and zooms
// to the active date filter rather than shading it — see time-axis.js. Slicing
// is safe here because `owned`/`open`/`solutionProposed` are each a standing
// count for that day, not a value derived from neighbouring points.
export function OwnedCasesBlock({ rows, dateRange, snapshotMs }) {
  // Same grid as the trajectory card: counts anchored to the snapshot, axis run
  // on to today with the standing counts carried forward (see liveGridEnd).
  const gridEnd = useMemo(() => liveGridEnd(snapshotMs), [snapshotMs]);
  const data = useMemo(
    () => dailyTrajectory(rows, snapshotMs || undefined, gridEnd),
    [rows, snapshotMs, gridEnd],
  );
  const [scope, setScope] = useState(SCOPE_RANGE);
  // `owned` alone decides emptiness: it is the total the other two partition,
  // so a day with zero owned has nothing to plot on any series.
  const win = useMemo(
    () => timeWindow({
      data, key: "date", valueKeys: ["owned"],
      range: dateRange, scope, bucketMs: BUCKET_MS.day,
    }),
    [data, dateRange, scope],
  );

  if (!data.length) {
    return (
      <Card>
        <div style={{ color: T.sub, fontSize: 13, fontStyle: "italic" }}>Not enough date range to plot owned cases.</div>
      </Card>
    );
  }

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div className="eyebrow" style={{ color: T.muted, textAlign: "left" }}>Cases we own · daily</div>
        <TimeScopeToggle scope={scope} onScopeChange={setScope} range={dateRange} />
      </div>
      <div style={{ color: T.sub, fontSize: 12, marginTop: 4, textAlign: "left" }}>
        Total cases still on our books each day — every case created and not yet closed. The total splits into <span style={{ color: T.accent, fontWeight: 600 }}>open</span> (active work) and <span style={{ color: T.warn, fontWeight: 600 }}>solution proposed</span> (awaiting customer); the two add up to the <span style={{ color: T.ink, fontWeight: 600 }}>total owned</span> line.
      </div>
      <div style={{ height: 280, marginTop: 12 }}>
        <ResponsiveContainer>
          <LineChart data={win.data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={T.borderSoft} vertical={false} />
            <XAxis
              dataKey="date"
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
            <Tooltip content={<OwnedTip />} cursor={{ stroke: T.border }} />
            <Legend wrapperStyle={{ fontSize: 11, color: T.sub }} iconType="plainline" />
            <Line type="monotone" dataKey="owned" name="total owned" stroke={T.ink} strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="open" name="open" stroke={T.accent} strokeWidth={1.5} dot={false} />
            <Line type="monotone" dataKey="solutionProposed" name="solution proposed" stroke={T.warn} strokeWidth={1.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <TimeScopeNote win={win} unit="day" scope={scope} />
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
      {d.stale && <div className="mono" style={{ color: T.muted }}>carried forward · no import yet</div>}
    </div>
  );
}
