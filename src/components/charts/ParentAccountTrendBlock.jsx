import { useMemo } from "react";
import {
  Area, AreaChart, Line, LineChart, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ReferenceArea,
} from "recharts";
import { T } from "../../lib/theme.js";
import { fmtWeekLabel, fmtFullDate } from "../../lib/format.js";
import { DOD_PARENT_ACCOUNTS, weeklyDodParentVolume, cumulativeDodParentVolume } from "../../lib/dod.js";
import { Card } from "../layout/Card.jsx";

/* ============== DoD Parent Accounts over time (Trends tab) ==============
 * Weekly case intake and cumulative book of cases per DoD branch parent account.
 * Only the four branches are plotted; other / no parent-account cases are
 * excluded by design. Week grid is anchored to the data snapshot so it lines up
 * with the other trend charts. */
export function ParentAccountTrendBlock({ rows, highlightRange, snapshotMs }) {
  const weekly = useMemo(() => weeklyDodParentVolume(rows, snapshotMs || undefined), [rows, snapshotMs]);
  const cumulative = useMemo(() => cumulativeDodParentVolume(rows, snapshotMs || undefined), [rows, snapshotMs]);
  const hl = highlightRange && highlightRange.from != null && highlightRange.to != null ? highlightRange : null;

  if (!weekly.length) {
    return (
      <Card>
        <div className="eyebrow" style={{ color: T.muted, textAlign: "left" }}>DoD parent accounts over time</div>
        <div style={{ color: T.sub, fontSize: 13, fontStyle: "italic", marginTop: 8 }}>
          No dated cases from the four DoD branch parent accounts in this view. (Older imports without
          the Parent Account field will be empty until re-uploaded from a current export.)
        </div>
      </Card>
    );
  }

  const weekPad = 3.5 * 864e5; // half a week buffer so end points don't clip the axis
  const tickInterval = Math.max(0, Math.floor(weekly.length / 10));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Card>
        <div className="eyebrow" style={{ color: T.muted, textAlign: "left" }}>Weekly case volume by DoD parent account</div>
        <div style={{ color: T.sub, fontSize: 12, marginTop: 4, textAlign: "left" }}>
          New cases created each week (Monday-anchored), stacked by branch. Band height is total DoD
          intake; each colored layer is one branch's share. The shaded band marks the active date filter.
        </div>
        <div style={{ height: 280, marginTop: 12 }}>
          <ResponsiveContainer>
            <AreaChart data={weekly} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={T.borderSoft} vertical={false} />
              <XAxis
                dataKey="week"
                type="number"
                domain={[(min) => min - weekPad, (max) => max + weekPad]}
                tickFormatter={fmtWeekLabel}
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
              <Tooltip content={<VolumeTip />} cursor={{ fill: T.surfaceAlt }} />
              <Legend wrapperStyle={{ fontSize: 11, color: T.sub }} iconType="square" />
              {hl && (
                <ReferenceArea x1={hl.from} x2={hl.to} fill={T.accent} fillOpacity={0.08} stroke={T.accent} strokeOpacity={0.35} ifOverflow="extendDomain" />
              )}
              {DOD_PARENT_ACCOUNTS.map((b) => (
                <Area
                  key={b.id}
                  type="monotone"
                  stackId="vol"
                  dataKey={b.id}
                  name={b.label}
                  stroke={b.color}
                  fill={b.color}
                  fillOpacity={0.55}
                  strokeWidth={1.5}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card>
        <div className="eyebrow" style={{ color: T.muted, textAlign: "left" }}>Cumulative cases by DoD parent account</div>
        <div style={{ color: T.sub, fontSize: 12, marginTop: 4, textAlign: "left" }}>
          Running total of cases per branch over time. Steeper slope = a branch generating cases
          faster; a flattening line = intake slowing.
        </div>
        <div style={{ height: 260, marginTop: 12 }}>
          <ResponsiveContainer>
            <LineChart data={cumulative} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={T.borderSoft} vertical={false} />
              <XAxis
                dataKey="week"
                type="number"
                domain={[(min) => min - weekPad, (max) => max + weekPad]}
                tickFormatter={fmtWeekLabel}
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
              <Tooltip content={<CumulativeTip />} cursor={{ stroke: T.border }} />
              <Legend wrapperStyle={{ fontSize: 11, color: T.sub }} iconType="plainline" />
              {hl && (
                <ReferenceArea x1={hl.from} x2={hl.to} fill={T.accent} fillOpacity={0.08} stroke={T.accent} strokeOpacity={0.35} ifOverflow="extendDomain" />
              )}
              {DOD_PARENT_ACCOUNTS.map((b) => (
                <Line key={b.id} type="monotone" dataKey={b.id} name={b.label} stroke={b.color} strokeWidth={2} dot={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}

function VolumeTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, padding: "8px 12px", borderRadius: 4, fontSize: 12 }}>
      <div style={{ fontWeight: 600 }}>Week of {fmtFullDate(d.week)}</div>
      {DOD_PARENT_ACCOUNTS.map((b) => (
        <div key={b.id} className="mono" style={{ color: T.sub, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 9, height: 9, background: b.color, borderRadius: 2, display: "inline-block" }} />
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
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, padding: "8px 12px", borderRadius: 4, fontSize: 12 }}>
      <div style={{ fontWeight: 600 }}>Through {fmtFullDate(d.week)}</div>
      {DOD_PARENT_ACCOUNTS.map((b) => (
        <div key={b.id} className="mono" style={{ color: T.sub, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 9, height: 9, background: b.color, borderRadius: 2, display: "inline-block" }} />
          {b.label}: {d[b.id]}
        </div>
      ))}
      <div className="mono" style={{ color: T.muted, marginTop: 4 }}>{d.total} DoD cases to date</div>
    </div>
  );
}
