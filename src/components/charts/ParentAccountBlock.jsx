import { useMemo } from "react";
import {
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import {
  T, AXIS_TICK, AXIS_TICK_CAT, BAR_RADIUS_V, LEGEND_STYLE, TOOLTIP_STYLE,
} from "../../lib/theme.js";
import { dodParentAccountStats } from "../../lib/dod.js";
import { Card } from "../layout/Card.jsx";

/* ============== DoD Parent Accounts (DoD tab) ==============
 * Case volume + lifecycle split across the four DoD branch parent accounts. Only
 * cases whose parent account is one of the branches are counted; all other / no
 * parent-account cases are excluded by design (this app is DoD-scoped).
 *
 * Both charts stay inside one color family. The branch fills come from dod.js
 * (four steps of the Infor Purple ladder, purely categorical); the lifecycle
 * stack uses the ordinal purple ramp, lightest for closed work through darkest
 * for still-open work, so the stack is orderable in grayscale. */
export function ParentAccountBlock({ rows }) {
  const stats = useMemo(() => dodParentAccountStats(rows || []), [rows]);
  const totalDod = stats.reduce((s, b) => s + b.total, 0);

  if (!totalDod) {
    return (
      <Card>
        <div className="eyebrow">DoD parent accounts</div>
        <div style={{ color: T.sub, fontSize: 13, fontStyle: "italic", marginTop: 8 }}>
          No cases from the four DoD branch parent accounts in the current view. (Cases with other or
          no parent account are not counted. Older imports without the Parent Account field will be
          empty until re-uploaded from a current export.)
        </div>
      </Card>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
      <Card>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
          <div className="eyebrow">Case volume by DoD parent account</div>
          <div className="mono" style={{ fontSize: 12, color: T.sub }}>{totalDod} DoD cases</div>
        </div>
        <div style={{ color: T.sub, fontSize: 12, marginTop: 4 }}>
          Total case count for each armed-forces branch HQ. Shows which branch is driving the most
          support load.
        </div>
        <div style={{ height: 260, marginTop: 12, background: T.vizWell, borderRadius: T.radiusMd }}>
          <ResponsiveContainer>
            <BarChart data={stats} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={T.vizGrid} vertical={false} />
              <XAxis dataKey="label" tick={AXIS_TICK_CAT} axisLine={{ stroke: T.vizAxis }} tickLine={{ stroke: T.vizAxis }} interval={0} />
              <YAxis tick={AXIS_TICK} axisLine={{ stroke: T.vizAxis }} tickLine={{ stroke: T.vizAxis }} allowDecimals={false} />
              <Tooltip content={<VolumeTip />} cursor={{ fill: T.vizWell }} />
              <Bar dataKey="total" radius={BAR_RADIUS_V} stroke={T.vizStroke} strokeWidth={1}>
                {stats.map((b) => <Cell key={b.id} fill={b.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card>
        <div className="eyebrow">Lifecycle by branch</div>
        <div style={{ color: T.sub, fontSize: 12, marginTop: 4 }}>
          How each branch's cases split across the lifecycle: open (active work), solution proposed
          (awaiting customer confirmation), and closed.
        </div>
        <div style={{ height: 260, marginTop: 12, background: T.vizWell, borderRadius: T.radiusMd }}>
          <ResponsiveContainer>
            <BarChart data={stats} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={T.vizGrid} vertical={false} />
              <XAxis dataKey="label" tick={AXIS_TICK_CAT} axisLine={{ stroke: T.vizAxis }} tickLine={{ stroke: T.vizAxis }} interval={0} />
              <YAxis tick={AXIS_TICK} axisLine={{ stroke: T.vizAxis }} tickLine={{ stroke: T.vizAxis }} allowDecimals={false} />
              <Tooltip content={<LifecycleTip />} cursor={{ fill: T.vizWell }} />
              <Legend wrapperStyle={LEGEND_STYLE} iconType="square" />
              {/* Ordinal ramp, closed -> open. The lightest step is 1.65:1 on the
                  well, so it carries the 1px perceivability stroke; only the
                  top-of-stack segment is rounded. */}
              <Bar stackId="lc" dataKey="closed" name="closed" fill={T.vizRamp[0]} stroke={T.vizStroke} strokeWidth={1} radius={[0, 0, 0, 0]} />
              <Bar stackId="lc" dataKey="solutionProposed" name="solution proposed" fill={T.vizRamp[1]} radius={[0, 0, 0, 0]} />
              <Bar stackId="lc" dataKey="open" name="open" fill={T.vizRamp[3]} radius={BAR_RADIUS_V} />
            </BarChart>
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
    <div style={TOOLTIP_STYLE}>
      <div style={{ fontWeight: 600 }}>{d.name}</div>
      <div className="mono" style={{ color: T.sub }}>{d.total} case{d.total === 1 ? "" : "s"}</div>
      <div className="mono" style={{ color: T.muted, marginTop: 4 }}>
        SLA {d.slaPct == null ? "—" : `${d.slaPct.toFixed(0)}%`}
        {d.slaEligible ? ` · ${d.slaMet}/${d.slaEligible} met` : ""}
      </div>
    </div>
  );
}

function LifecycleTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={TOOLTIP_STYLE}>
      <div style={{ fontWeight: 600 }}>{d.name}</div>
      <div className="mono" style={{ color: T.sub }}>{d.open} open · {d.solutionProposed} solution proposed · {d.closed} closed</div>
      <div className="mono" style={{ color: T.muted, marginTop: 4 }}>{d.total} total</div>
    </div>
  );
}
