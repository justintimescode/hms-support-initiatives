import { useMemo, useState } from "react";
import {
  Area, AreaChart, Line, LineChart, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";
import { T, AXIS_TICK, LEGEND_STYLE, TOOLTIP_STYLE } from "../../lib/theme.js";
import { fmtFullDate } from "../../lib/format.js";
import { DOD_PARENT_ACCOUNTS, weeklyDodParentVolume, cumulativeDodParentVolume } from "../../lib/dod.js";
import { BUCKET_MS, SCOPE_RANGE, timeWindow } from "../../lib/time-axis.js";
import { Card } from "../layout/Card.jsx";
import { TimeScopeNote, TimeScopeToggle } from "./TimeScopeToggle.jsx";

/* ============== DoD Parent Accounts over time (DoD tab) ==============
 * Weekly case intake and cumulative book of cases per DoD branch parent account.
 * Only the four branches are plotted; other / no parent-account cases are
 * excluded by design. Week grid is anchored to the data snapshot so it lines up
 * with the other trend charts, and both charts zoom to the active date filter
 * rather than shading it — see time-axis.js.
 *
 * Branch colors come from dod.js — four steps of one Infor Purple ladder — so
 * the stacked bands read as shares of a single family and need no opacity to
 * separate. */

// Module scope, so the emptiness-test key list is a stable reference and the
// timeWindow memos below don't re-run on every render.
const BRANCH_KEYS = DOD_PARENT_ACCOUNTS.map((b) => b.id);

export function ParentAccountTrendBlock({ rows, dateRange, snapshotMs }) {
  const weekly = useMemo(() => weeklyDodParentVolume(rows, snapshotMs || undefined), [rows, snapshotMs]);
  const cumulative = useMemo(() => cumulativeDodParentVolume(rows, snapshotMs || undefined), [rows, snapshotMs]);
  const [scope, setScope] = useState(SCOPE_RANGE);

  const volWin = useMemo(
    () => timeWindow({
      data: weekly, key: "week", valueKeys: BRANCH_KEYS,
      range: dateRange, scope, bucketMs: BUCKET_MS.week, tickTarget: 10,
    }),
    [weekly, dateRange, scope],
  );
  // The cumulative chart is zoomed but NOT edge-trimmed on its own totals: a
  // running total is nonzero forever once the first case lands, so trimming is a
  // no-op after the first bucket. Windowing it to the filter is the whole point
  // here — a zoomed cumulative curve reads as slope (intake rate) instead of one
  // flat plateau.
  const cumWin = useMemo(
    () => timeWindow({
      data: cumulative, key: "week", valueKeys: BRANCH_KEYS,
      range: dateRange, scope, bucketMs: BUCKET_MS.week, tickTarget: 10,
    }),
    [cumulative, dateRange, scope],
  );

  if (!weekly.length) {
    return (
      <Card>
        <div className="eyebrow" style={{ textAlign: "left" }}>DoD parent accounts over time</div>
        <div style={{ color: T.sub, fontSize: 13, fontStyle: "italic", marginTop: 8 }}>
          No dated cases from the four DoD branch parent accounts in this view. (Older imports without
          the Parent Account field will be empty until re-uploaded from a current export.)
        </div>
      </Card>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Card>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <div className="eyebrow" style={{ textAlign: "left" }}>Weekly case volume by DoD parent account</div>
          <TimeScopeToggle scope={scope} onScopeChange={setScope} range={dateRange} />
        </div>
        <div style={{ color: T.sub, fontSize: 12, marginTop: 4, textAlign: "left" }}>
          New cases created each week (Monday-anchored), stacked by branch. Band height is total DoD
          intake; each colored layer is one branch's share.
        </div>
        <div style={{ height: 280, marginTop: 12, background: T.vizWell, borderRadius: T.radiusMd }}>
          <ResponsiveContainer>
            <AreaChart data={volWin.data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={T.vizGrid} vertical={false} />
              <XAxis
                dataKey="week"
                type="number"
                domain={volWin.domain}
                tickFormatter={volWin.tickFormatter}
                tick={AXIS_TICK}
                axisLine={{ stroke: T.vizAxis }}
                tickLine={{ stroke: T.vizAxis }}
                ticks={volWin.ticks}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={AXIS_TICK}
                axisLine={{ stroke: T.vizAxis }}
                tickLine={{ stroke: T.vizAxis }}
                allowDecimals={false}
              />
              <Tooltip content={<VolumeTip />} cursor={{ fill: T.vizWell }} />
              <Legend wrapperStyle={LEGEND_STYLE} iconType="square" />
              {DOD_PARENT_ACCOUNTS.map((b) => (
                <Area
                  key={b.id}
                  type="monotone"
                  stackId="vol"
                  dataKey={b.id}
                  name={b.label}
                  stroke={b.color}
                  fill={b.color}
                  strokeWidth={1.5}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <TimeScopeNote win={volWin} unit="week" scope={scope} />
      </Card>

      <Card>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <div className="eyebrow" style={{ textAlign: "left" }}>Cumulative cases by DoD parent account</div>
          <TimeScopeToggle scope={scope} onScopeChange={setScope} range={dateRange} />
        </div>
        <div style={{ color: T.sub, fontSize: 12, marginTop: 4, textAlign: "left" }}>
          Running total of cases per branch over time — counted from the first case in the import, so
          a zoomed view starts at each branch's standing total rather than at zero. Steeper slope = a
          branch generating cases faster; a flattening line = intake slowing.
        </div>
        <div style={{ height: 260, marginTop: 12, background: T.vizWell, borderRadius: T.radiusMd }}>
          <ResponsiveContainer>
            <LineChart data={cumWin.data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={T.vizGrid} vertical={false} />
              <XAxis
                dataKey="week"
                type="number"
                domain={cumWin.domain}
                tickFormatter={cumWin.tickFormatter}
                tick={AXIS_TICK}
                axisLine={{ stroke: T.vizAxis }}
                tickLine={{ stroke: T.vizAxis }}
                ticks={cumWin.ticks}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={AXIS_TICK}
                axisLine={{ stroke: T.vizAxis }}
                tickLine={{ stroke: T.vizAxis }}
                allowDecimals={false}
              />
              <Tooltip content={<CumulativeTip />} cursor={{ stroke: T.vizAxis }} />
              <Legend wrapperStyle={LEGEND_STYLE} iconType="plainline" />
              {DOD_PARENT_ACCOUNTS.map((b) => (
                <Line key={b.id} type="monotone" dataKey={b.id} name={b.label} stroke={b.color} strokeWidth={2} dot={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
        <TimeScopeNote win={cumWin} unit="week" scope={scope} />
      </Card>
    </div>
  );
}

function VolumeTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={TOOLTIP_STYLE}>
      <div style={{ fontWeight: 600 }}>Week of {fmtFullDate(d.week)}</div>
      {DOD_PARENT_ACCOUNTS.map((b) => (
        <div key={b.id} className="mono" style={{ color: T.sub, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 9, height: 9, background: b.color, borderRadius: T.radiusChart, display: "inline-block" }} />
          {b.label}: {d[b.id]}
        </div>
      ))}
      <div className="mono" style={{ color: T.muted, marginTop: 4 }}>{d.total} total this week</div>
    </div>
  );
}

function CumulativeTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={TOOLTIP_STYLE}>
      <div style={{ fontWeight: 600 }}>Through {fmtFullDate(d.week)}</div>
      {DOD_PARENT_ACCOUNTS.map((b) => (
        <div key={b.id} className="mono" style={{ color: T.sub, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 9, height: 9, background: b.color, borderRadius: T.radiusChart, display: "inline-block" }} />
          {b.label}: {d[b.id]}
        </div>
      ))}
      <div className="mono" style={{ color: T.muted, marginTop: 4 }}>{d.total} DoD cases to date</div>
    </div>
  );
}
