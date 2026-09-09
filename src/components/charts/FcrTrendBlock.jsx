import { useMemo, useState } from "react";
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from "recharts";
import { T, AXIS_TICK, TOOLTIP_STYLE } from "../../lib/theme.js";
import { monthlyFcrTrend, qualityMetrics } from "../../lib/stats.js";
import { BUCKET_MS, SCOPE_RANGE, timeWindow } from "../../lib/time-axis.js";
import { Card } from "../layout/Card.jsx";
import { TimeScopeNote, TimeScopeToggle } from "./TimeScopeToggle.jsx";

/* ================= First-contact resolution · monthly trend ================= */
// ServiceNow's headline FCR KPI, made longitudinal. Same definition as the
// team quality card (qualityMetrics): a closed case that needed at most one
// Infor-authored journal turn. The trend answers what the single number can't:
// is resolution quality drifting, or did one bad month set the reputation?
export function FcrTrendBlock({ rows, dateRange }) {
  const data = useMemo(() => monthlyFcrTrend(rows), [rows]);
  const quality = useMemo(() => qualityMetrics(rows), [rows]);
  const [scope, setScope] = useState(SCOPE_RANGE);
  const win = useMemo(
    () => timeWindow({
      data, key: "month", valueKeys: ["closed"],
      range: dateRange, scope, bucketMs: BUCKET_MS.month,
    }),
    [data, dateRange, scope],
  );

  const hasSignal = data.some((d) => d.closed > 0);
  if (!hasSignal) {
    return (
      <Card>
        <div className="eyebrow">First-contact resolution · monthly</div>
        <div style={{ color: T.sub, fontSize: 13, fontStyle: "italic", marginTop: 12 }}>
          No closed cases to measure yet.
        </div>
      </Card>
    );
  }

  const fmtPct = (v) => (v == null ? "—" : `${Math.round(v)}%`);

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div className="eyebrow">First-contact resolution · monthly</div>
        <TimeScopeToggle scope={scope} onScopeChange={setScope} range={dateRange} />
      </div>
      <div style={{ color: T.sub, fontSize: 12, marginTop: 4, maxWidth: 720 }}>
        Of the cases closed each month, the share resolved in at most one Infor journal turn — the
        proxy for "solved on first contact". A falling line means cases are taking more back-and-forth
        to land, before that ever shows up in resolution time.
      </div>
      <div style={{ display: "flex", gap: 24, marginTop: 10, flexWrap: "wrap" }}>
        <Stat label="FCR rate · all closed" value={fmtPct(quality.fcrRate)} color={T.ink} />
        <Stat
          label="Currently reopened"
          value={`${quality.reopened}${quality.everClosed ? ` of ${quality.everClosed} ever-closed` : ""}`}
          color={quality.reopened > 0 ? T.warn : T.ink}
        />
      </div>
      <div style={{ height: 240, marginTop: 12, background: T.vizWell, borderRadius: T.radiusMd }}>
        <ResponsiveContainer>
          <ComposedChart data={win.data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={T.vizGrid} vertical={false} />
            <XAxis
              dataKey="month"
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
              domain={[0, 100]}
              tick={AXIS_TICK}
              axisLine={{ stroke: T.vizAxis }}
              tickLine={{ stroke: T.vizAxis }}
              tickFormatter={(v) => `${v}%`}
            />
            <Tooltip content={<FcrTip />} cursor={{ stroke: T.vizAxis }} />
            {/* Single metric: the duotone lead, Infor Purple. */}
            <Line
              type="monotone" dataKey="fcrPct" name="FCR rate"
              stroke={T.vizAccent} strokeWidth={2} dot={{ r: 2 }} connectNulls={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <TimeScopeNote win={win} unit="month" scope={scope} />
    </Card>
  );
}

function Stat({ label, value, color }) {
  return (
    <div>
      <div className="eyebrow">{label}</div>
      <div className="mono" style={{ color, fontSize: 18, fontWeight: 600, marginTop: 2 }}>{value}</div>
    </div>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function FcrTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const dte = new Date(d.month);
  return (
    <div style={TOOLTIP_STYLE}>
      <div style={{ fontWeight: 600 }}>{MONTHS[dte.getMonth()]} {dte.getFullYear()}</div>
      {d.closed ? (
        <div className="mono" style={{ color: T.sub }}>
          {d.fcr}/{d.closed} first-contact ({Math.round(d.fcrPct)}%)
        </div>
      ) : (
        <div style={{ color: T.muted }}>No cases closed this month</div>
      )}
    </div>
  );
}
