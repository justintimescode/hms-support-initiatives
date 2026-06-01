import { useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { TrendingDown, TrendingUp, Target } from "lucide-react";
import { T } from "../../lib/theme.js";
import { fmtAxisDate, fmtFullDate } from "../../lib/format.js";
import { backlogForecast } from "../../lib/stats.js";
import { Card } from "../layout/Card.jsx";

/* ================= Backlog Burn-down Forecast =================
 * A simple linear projection: take the recent 4-week net (created − resolved)
 * and extend the current open backlog forward. If the team is net-resolving,
 * project a clear date; otherwise call out that the backlog isn't clearing at
 * the current pace. Snapshot-anchored. */
export function BacklogForecastBlock({ rows, snapshotMs }) {
  const f = useMemo(() => backlogForecast(rows || [], snapshotMs || undefined), [rows, snapshotMs]);

  if (!f.series.length) {
    return (
      <Card>
        <div className="eyebrow" style={{ color: T.muted }}>Backlog burn-down forecast</div>
        <div style={{ color: T.sub, fontSize: 13, fontStyle: "italic", marginTop: 12 }}>Not enough history to project a burn-down.</div>
      </Card>
    );
  }

  const netColor = f.weeklyNet < 0 ? T.ok : f.weeklyNet > 0 ? T.danger : T.muted;
  const transition = f.series.find((p) => p.projected != null)?.date ?? null;

  return (
    <Card>
      <div className="eyebrow" style={{ color: T.muted }}>Backlog burn-down forecast</div>
      <div style={{ color: T.sub, fontSize: 12, marginTop: 4, maxWidth: 720 }}>
        Linear projection of the open backlog at the current pace (4-week average net of created − resolved). The dashed line is the forecast; it is a straight-line estimate, not a model — a sustained change in intake or staffing will move it.
      </div>

      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 14 }}>
        <StatTile label="Open now" value={f.currentOpen.toLocaleString()} color={T.ink} icon={Target} />
        <StatTile
          label="Net / week (4-wk avg)"
          value={`${f.weeklyNet > 0 ? "+" : ""}${f.weeklyNet.toFixed(1)}`}
          color={netColor}
          icon={f.weeklyNet < 0 ? TrendingDown : TrendingUp}
          hint={f.shrinking ? `resolving ${f.weeklyBurn.toFixed(1)} more/wk than created` : "intake ≥ resolution"}
        />
        {f.shrinking ? (
          <StatTile
            label="Projected to clear"
            value={`~${Math.ceil(f.weeksToClear)} wk${Math.ceil(f.weeksToClear) === 1 ? "" : "s"}`}
            color={T.ok}
            hint={f.clearDate ? `around ${fmtFullDate(f.clearDate)}` : null}
          />
        ) : (
          <StatTile
            label="Projected to clear"
            value="Not clearing"
            color={T.danger}
            hint="backlog flat or growing at this pace"
          />
        )}
      </div>

      <div style={{ height: 260, marginTop: 16 }}>
        <ResponsiveContainer>
          <LineChart data={f.series} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
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
            <Line type="monotone" dataKey="open" name="open backlog" stroke={T.accent} strokeWidth={2} dot={false} connectNulls={false} />
            <Line type="monotone" dataKey="projected" name="projected" stroke={netColor} strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls />
          </LineChart>
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
  const v = d.open != null ? d.open : d.projected;
  const kind = d.open != null ? "actual" : "projected";
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, padding: "8px 12px", borderRadius: 4, fontSize: 12 }}>
      <div style={{ fontWeight: 600 }}>{fmtFullDate(d.date)}</div>
      <div className="mono" style={{ color: T.sub }}>{v} open <span style={{ color: T.muted }}>({kind})</span></div>
    </div>
  );
}
