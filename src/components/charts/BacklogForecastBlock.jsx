import { useMemo } from "react";
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { TrendingDown, TrendingUp, Target } from "lucide-react";
import { T } from "../../lib/theme.js";
import { fmtAxisDate, fmtFullDate } from "../../lib/format.js";
import { backlogForecast } from "../../lib/stats.js";
import { Card } from "../layout/Card.jsx";

/* ================= Backlog Burn-down Forecast =================
 * Monte Carlo projection: bootstrap recent mature weeks of (created, resolved)
 * flow, walk the open backlog forward many times, and chart the p10–p90 cone
 * around the median. Honest about uncertainty rather than a single straight
 * line. Snapshot-anchored. See `backlogForecast` in lib/stats.js. */
export function BacklogForecastBlock({ rows, snapshotMs }) {
  const f = useMemo(() => backlogForecast(rows || [], snapshotMs || undefined), [rows, snapshotMs]);

  const hasForecast = f.series.some((p) => p.band != null);
  if (!f.series.length || !hasForecast) {
    return (
      <Card>
        <div className="eyebrow" style={{ color: T.muted }}>Backlog burn-down forecast</div>
        <div style={{ color: T.sub, fontSize: 13, fontStyle: "italic", marginTop: 12 }}>
          Not enough mature history to simulate a burn-down.
        </div>
      </Card>
    );
  }

  const netColor = f.weeklyNet < 0 ? T.ok : f.weeklyNet > 0 ? T.danger : T.muted;
  const transition = f.series.find((p) => p.band != null)?.date ?? null;
  const horizonWeeks = f.projHorizon?.weeks ?? 13;
  const horizonMs = transition != null ? transition + horizonWeeks * 7 * 864e5 : null;

  const projColor = f.projHorizon
    ? (f.projHorizon.mid < f.currentOpen ? T.ok : f.projHorizon.mid > f.currentOpen ? T.danger : T.muted)
    : T.muted;
  const clearPct = f.pClear != null ? Math.round(f.pClear * 100) : null;
  const clearColor = clearPct == null ? T.muted : clearPct >= 50 ? T.ok : clearPct > 0 ? T.ink : T.danger;

  return (
    <Card>
      <div className="eyebrow" style={{ color: T.muted }}>Backlog burn-down forecast</div>
      <div style={{ color: T.sub, fontSize: 12, marginTop: 4, maxWidth: 760 }}>
        Monte Carlo projection over {horizonWeeks} weeks. Each of thousands of simulated futures replays a random recent
        week of intake vs. resolution (resolution capped by what's open), giving a range of outcomes rather than a single
        line. The band is the p10–p90 spread; the dashed line is the median. A sustained change in intake or staffing will
        move it.
      </div>

      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 14 }}>
        <StatTile label="Open now" value={f.currentOpen.toLocaleString()} color={T.ink} icon={Target} />
        <StatTile
          label={`Net / week (${f.sampleWeeks}-wk avg)`}
          value={`${f.weeklyNet > 0 ? "+" : ""}${f.weeklyNet.toFixed(1)}`}
          color={netColor}
          icon={f.weeklyNet < 0 ? TrendingDown : TrendingUp}
          hint={f.weeklyNet < 0 ? "resolving faster than intake" : f.weeklyNet > 0 ? "intake exceeds resolution" : "intake ≈ resolution"}
        />
        {f.projHorizon && (
          <StatTile
            label={`Open in ${horizonWeeks} wks`}
            value={f.projHorizon.mid.toLocaleString()}
            color={projColor}
            hint={`likely ${f.projHorizon.lo.toLocaleString()}–${f.projHorizon.hi.toLocaleString()} (p10–p90)`}
          />
        )}
        <StatTile
          label="Chance of clearing"
          value={clearPct != null ? `${clearPct}%` : "—"}
          color={clearColor}
          hint={
            clearPct == null ? null
              : clearPct >= 50 && f.clearDate ? `median ~${fmtFullDate(f.clearDate)}`
                : `reaches 0 within ${horizonWeeks} wks`
          }
        />
      </div>

      <div style={{ height: 260, marginTop: 16 }}>
        <ResponsiveContainer>
          <ComposedChart data={f.series} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={T.borderSoft} vertical={false} />
            <XAxis
              dataKey="date"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              tickFormatter={fmtAxisDate}
              tick={{ fill: T.sub, fontSize: 11 }}
              axisLine={{ stroke: T.border }}
              tickLine={{ stroke: T.border }}
            />
            <YAxis
              tick={{ fill: T.muted, fontSize: 11, fontFamily: "JetBrains Mono" }}
              axisLine={{ stroke: T.border }}
              tickLine={{ stroke: T.border }}
              allowDecimals={false}
            />
            <Tooltip content={<ForecastTip />} cursor={{ stroke: T.border }} />
            {transition != null && (
              <ReferenceLine x={transition} stroke={T.muted} strokeDasharray="3 3" label={{ value: "now", position: "top", fill: T.muted, fontSize: 10 }} />
            )}
            {horizonMs != null && (
              <ReferenceLine x={horizonMs} stroke={T.borderSoft} label={{ value: `+${horizonWeeks}w`, position: "top", fill: T.muted, fontSize: 10 }} />
            )}
            <Area type="monotone" dataKey="band" name="p10–p90" stroke="none" fill={netColor} fillOpacity={0.14} connectNulls dot={false} activeDot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="open" name="open backlog" stroke={T.accent} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="mid" name="median forecast" stroke={netColor} strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function StatTile({ label, value, color, hint, icon: Icon }) {
  return (
    <div>
      <div className="eyebrow" style={{ color: T.muted, display: "flex", alignItems: "center", gap: 6 }}>
        {Icon && <Icon size={12} style={{ color }} />} {label}
      </div>
      <div className="mono" style={{ fontSize: 26, fontWeight: 600, color, lineHeight: 1, marginTop: 6 }}>{value}</div>
      {hint && <div style={{ color: T.sub, fontSize: 11.5, marginTop: 5 }}>{hint}</div>}
    </div>
  );
}

function ForecastTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, padding: "8px 12px", borderRadius: 4, fontSize: 12 }}>
      <div style={{ fontWeight: 600 }}>{fmtFullDate(d.date)}</div>
      {d.open != null ? (
        <div className="mono" style={{ color: T.sub }}>{d.open} open <span style={{ color: T.muted }}>(actual)</span></div>
      ) : (
        <>
          <div className="mono" style={{ color: T.sub }}>{d.mid} open <span style={{ color: T.muted }}>(median)</span></div>
          {Array.isArray(d.band) && (
            <div className="mono" style={{ color: T.muted }}>{d.band[0]}–{d.band[1]} (p10–p90)</div>
          )}
        </>
      )}
    </div>
  );
}
