import { useMemo } from "react";
import {
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { T } from "../../lib/theme.js";
import { dodParentAccountStats } from "../../lib/dod.js";
import { Card } from "../layout/Card.jsx";

/* ============== DoD Parent Accounts (Accounts tab) ==============
 * Case volume + lifecycle split across the four DoD branch parent accounts. Only
 * cases whose parent account is one of the branches are counted; all other / no
 * parent-account cases are excluded by design (this app is DoD-scoped). */
export function ParentAccountBlock({ rows }) {
  const stats = useMemo(() => dodParentAccountStats(rows || []), [rows]);
  const totalDod = stats.reduce((s, b) => s + b.total, 0);

  if (!totalDod) {
    return (
      <Card>
        <div className="eyebrow" style={{ color: T.muted }}>DoD parent accounts</div>
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
          <div className="eyebrow" style={{ color: T.muted }}>Case volume by DoD parent account</div>
          <div className="mono" style={{ fontSize: 12, color: T.sub }}>{totalDod} DoD cases</div>
        </div>
        <div style={{ color: T.sub, fontSize: 12, marginTop: 4 }}>
          Total case count for each armed-forces branch HQ. Shows which branch is driving the most
          support load.
        </div>
        <div style={{ height: 260, marginTop: 12 }}>
          <ResponsiveContainer>
            <BarChart data={stats} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={T.borderSoft} vertical={false} />
              <XAxis dataKey="label" tick={{ fill: T.sub, fontSize: 11 }} axisLine={{ stroke: T.border }} tickLine={{ stroke: T.border }} interval={0} />
              <YAxis tick={{ fill: T.muted, fontSize: 11, fontFamily: "JetBrains Mono" }} axisLine={{ stroke: T.border }} tickLine={{ stroke: T.border }} allowDecimals={false} />
              <Tooltip content={<VolumeTip />} cursor={{ fill: T.surfaceAlt }} />
              <Bar dataKey="total" radius={[3, 3, 0, 0]}>
                {stats.map((b) => <Cell key={b.id} fill={b.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card>
        <div className="eyebrow" style={{ color: T.muted }}>Lifecycle by branch</div>
        <div style={{ color: T.sub, fontSize: 12, marginTop: 4 }}>
          How each branch's cases split across the lifecycle: open (active work), solution proposed
          (awaiting customer confirmation), and closed.
        </div>
        <div style={{ height: 260, marginTop: 12 }}>
          <ResponsiveContainer>
            <BarChart data={stats} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={T.borderSoft} vertical={false} />
              <XAxis dataKey="label" tick={{ fill: T.sub, fontSize: 11 }} axisLine={{ stroke: T.border }} tickLine={{ stroke: T.border }} interval={0} />
              <YAxis tick={{ fill: T.muted, fontSize: 11, fontFamily: "JetBrains Mono" }} axisLine={{ stroke: T.border }} tickLine={{ stroke: T.border }} allowDecimals={false} />
              <Tooltip content={<LifecycleTip />} cursor={{ fill: T.surfaceAlt }} />
              <Legend wrapperStyle={{ fontSize: 11, color: T.sub }} iconType="square" />
              <Bar stackId="lc" dataKey="closed" name="closed" fill={T.ok} radius={[0, 0, 0, 0]} />
              <Bar stackId="lc" dataKey="solutionProposed" name="solution proposed" fill={T.warn} />
              <Bar stackId="lc" dataKey="open" name="open" fill={T.accent} radius={[3, 3, 0, 0]} />
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
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, padding: "8px 12px", borderRadius: 4, fontSize: 12 }}>
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
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, padding: "8px 12px", borderRadius: 4, fontSize: 12 }}>
      <div style={{ fontWeight: 600 }}>{d.name}</div>
      <div className="mono" style={{ color: T.sub }}>{d.open} open · {d.solutionProposed} solution proposed · {d.closed} closed</div>
      <div className="mono" style={{ color: T.muted, marginTop: 4 }}>{d.total} total</div>
    </div>
  );
}
