import { useMemo, useState } from "react";
import {
  BarChart, Bar, Line, LineChart, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from "recharts";
import { T } from "../../lib/theme.js";
import { fmtFullDate } from "../../lib/format.js";
import { coverageTrend } from "../../lib/ai-tags.js";
import { OUTCOME_COLOR, UNTAGGED_COLOR } from "../../lib/ai-tag-colors.js";
import { BUCKET_MS, SCOPE_RANGE, timeWindow } from "../../lib/time-axis.js";
import { Card } from "../layout/Card.jsx";
import { TimeScopeNote, TimeScopeToggle } from "./TimeScopeToggle.jsx";

/* ============== AI tagging over time (AI Assisted? tab) ==============
 * Two x-aligned charts in one card, NOT a dual axis: intake volume (counts) on
 * top, rates (percent) below. Mixing a count axis and a percent axis on one plot
 * lets the reader infer a relationship the data doesn't support.
 *
 * MONTHLY BY DEFAULT, and that is a data decision rather than a style one. The
 * reference export holds ~487 tagged cases spread over ~18 months; weekly buckets
 * average a handful of tagged cases each, where a single case swings the rate by
 * tens of points. Months are the smallest bucket in which a RATE is readable. The
 * week option is there for a dense, recent date filter. Note that zooming does
 * NOT weaken this: the window narrows how many buckets you see, not how many
 * cases land in each, so a weekly rate is exactly as thin when zoomed in.
 *
 * Both charts zoom to the active date filter instead of shading it (time-axis.js)
 * and share one window, which is what keeps the syncId cursor meaningful — two
 * different windows under one syncId would pair a month in the top chart with a
 * different month in the bottom.
 *
 * The assist-rate line BREAKS (connectNulls={false}) in any bucket with fewer than
 * MIN_ATTEMPTED attempted cases rather than plotting 0%/100% from an n of one.
 * Coverage has no such floor — it is measured against total intake, which is never
 * that thin. */
const MIN_ATTEMPTED = 5;

const GRANULARITIES = [
  { value: "month", label: "Monthly" },
  { value: "week", label: "Weekly" },
];

export function AiTagTrendBlock({ rows, dateRange, snapshotMs }) {
  const [granularity, setGranularity] = useState("month");
  const [scope, setScope] = useState(SCOPE_RANGE);
  const data = useMemo(
    () => coverageTrend(rows || [], snapshotMs || undefined, granularity, MIN_ATTEMPTED),
    [rows, snapshotMs, granularity],
  );
  // Trim on `total` (all case intake), NOT on `tagged`. Buckets that hold real
  // cases but no tagged ones are exactly the pre-adoption baseline the coverage
  // line exists to measure against — dropping them would flatter the rollout by
  // hiding where it started. Only buckets with no cases at all get cut, which is
  // what clears the grid the builder extends back to the oldest case.
  const win = useMemo(
    () => timeWindow({
      data, key: "bucket", valueKeys: ["total"],
      range: dateRange, scope,
      bucketMs: granularity === "week" ? BUCKET_MS.week : BUCKET_MS.month,
      tickTarget: 10,
    }),
    [data, dateRange, scope, granularity],
  );

  if (!data.length) {
    return (
      <Card>
        <div className="eyebrow" style={{ color: T.muted }}>AI tagging over time</div>
        <div style={{ color: T.sub, fontSize: 13, fontStyle: "italic", marginTop: 12 }}>
          No dated cases to plot — the trend needs case creation dates.
        </div>
      </Card>
    );
  }

  // Counted over the VISIBLE buckets so the footnote describes the chart on
  // screen rather than the whole import.
  const thin = win.data.filter((b) => b.attempted > 0 && b.attempted < MIN_ATTEMPTED).length;

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div className="eyebrow" style={{ color: T.muted }}>AI tagging over time</div>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <TimeScopeToggle scope={scope} onScopeChange={setScope} range={dateRange} />
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: T.sub }}>
            <span className="eyebrow" style={{ color: T.muted }}>Bucket</span>
            <select
              value={granularity}
              onChange={(e) => setGranularity(e.target.value)}
              style={{
                fontSize: 12,
                padding: "4px 8px",
                border: `1px solid ${T.border}`,
                borderRadius: 6,
                background: T.surface,
                color: T.ink,
                cursor: "pointer",
              }}
            >
              {GRANULARITIES.map((g) => (
                <option key={g.value} value={g.value}>{g.label}</option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <div style={{ color: T.sub, fontSize: 12, marginTop: 4, maxWidth: 760 }}>
        Top: cases created per {granularity === "week" ? "week" : "month"}, split by whether they
        ended up tagged. Bottom: coverage (tagged ÷ all cases created) and assist rate (helped ÷ AI
        attempted) on one percent axis. The assist line breaks where a bucket has fewer than{" "}
        {MIN_ATTEMPTED} attempted cases — too thin for a rate.
      </div>

      <div style={{ height: 190, marginTop: 12 }}>
        <ResponsiveContainer>
          <BarChart data={win.data} margin={{ top: 10, right: 24, left: 0, bottom: 0 }} syncId="aiTagTrend">
            <CartesianGrid stroke={T.borderSoft} vertical={false} />
            <XAxis
              dataKey="bucket"
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
            <Tooltip content={<TrendTip granularity={granularity} />} cursor={{ fill: T.surfaceAlt }} />
            <Bar stackId="v" dataKey="tagged" name="tagged" fill={T.accent} fillOpacity={0.85} />
            <Bar stackId="v" dataKey="untagged" name="untagged" fill={UNTAGGED_COLOR} radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div style={{ display: "flex", gap: 16, marginTop: 4, fontSize: 11, color: T.sub, flexWrap: "wrap" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 14, height: 2, background: T.accent }} /> tagging coverage
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 14, height: 2, background: OUTCOME_COLOR.helpful }} /> assist rate
          (of attempted)
        </span>
      </div>

      <div style={{ height: 170, marginTop: 4 }}>
        <ResponsiveContainer>
          <LineChart data={win.data} margin={{ top: 6, right: 24, left: 0, bottom: 0 }} syncId="aiTagTrend">
            <CartesianGrid stroke={T.borderSoft} vertical={false} />
            <XAxis
              dataKey="bucket"
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
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              tickFormatter={(v) => `${v}%`}
              tick={{ fill: T.muted, fontSize: 11, fontFamily: "JetBrains Mono" }}
              axisLine={{ stroke: T.border }}
              tickLine={{ stroke: T.border }}
            />
            <Tooltip content={<TrendTip granularity={granularity} />} cursor={{ stroke: T.border }} />
            <Line
              type="monotone"
              dataKey="coveragePct"
              name="tagging coverage"
              stroke={T.accent}
              strokeWidth={2}
              dot={false}
              connectNulls={false}
            />
            <Line
              type="monotone"
              dataKey="assistRatePct"
              name="assist rate"
              stroke={OUTCOME_COLOR.helpful}
              strokeWidth={2}
              dot={{ r: 2, fill: OUTCOME_COLOR.helpful, strokeWidth: 0 }}
              connectNulls={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <TimeScopeNote win={win} unit={granularity === "week" ? "week" : "month"} scope={scope} />

      {thin > 0 && (
        <div style={{ color: T.muted, fontSize: 11, marginTop: 8 }}>
          {thin} {granularity === "week" ? "week" : "month"}
          {thin === 1 ? "" : "s"} in view had between 1 and {MIN_ATTEMPTED - 1} attempted cases; the
          assist line is intentionally absent there rather than showing a rate drawn from a handful
          of cases.
        </div>
      )}
    </Card>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtMonthLabel = (ts) => {
  const d = new Date(ts);
  return `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
};

function TrendTip({ active, payload, granularity }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, padding: "8px 12px", borderRadius: 4, fontSize: 12 }}>
      <div style={{ fontWeight: 600 }}>
        {granularity === "week" ? `Week of ${fmtFullDate(d.bucket)}` : fmtMonthLabel(d.bucket)}
      </div>
      <div className="mono" style={{ color: T.sub }}>
        {d.total} case{d.total === 1 ? "" : "s"} created · {d.tagged} tagged
        {d.coveragePct == null ? "" : ` (${d.coveragePct.toFixed(0)}%)`}
      </div>
      <div className="mono" style={{ color: T.muted, marginTop: 4 }}>
        {d.attempted} AI attempted · assist rate{" "}
        {d.assistRatePct == null
          ? d.attempted > 0
            ? `— (only ${d.attempted}, too few)`
            : "—"
          : `${d.assistRatePct.toFixed(0)}%`}
      </div>
      {d.attempted > 0 && (
        <div className="mono" style={{ color: T.muted }}>
          {d.helpful} helped · {d.unhelpful} didn't · {d.harmful} hallucinated
        </div>
      )}
    </div>
  );
}
