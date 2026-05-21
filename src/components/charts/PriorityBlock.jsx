import { useMemo } from "react";
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { T } from "../../lib/theme.js";
import { fmtDuration } from "../../lib/format.js";
import { resolutionDistribution } from "../../lib/stats.js";
import { Card } from "../layout/Card.jsx";

/* ================= Priority ================= */
export function PriorityBlock({ priorityData, rows }) {
  const distribution = useMemo(() => resolutionDistribution(rows || []), [rows]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Card>
          <div className="eyebrow" style={{ color: T.muted }}>Volume by priority</div>
          <div style={{ color: T.sub, fontSize: 12, marginTop: 4 }}>Total case count at each priority level. Shows where the bulk of the work sits.</div>
          <div style={{ height: 240, marginTop: 12 }}>
            <ResponsiveContainer>
              <BarChart data={priorityData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={T.borderSoft} vertical={false} />
                <XAxis dataKey="priority" tick={{ fill: T.sub, fontSize: 11 }} axisLine={{ stroke: T.border }} tickLine={{ stroke: T.border }} />
                <YAxis tick={{ fill: T.muted, fontSize: 11, fontFamily: "JetBrains Mono" }} axisLine={{ stroke: T.border }} tickLine={{ stroke: T.border }} />
                <Tooltip content={<VolumeTip />} cursor={{ fill: T.surfaceAlt }} />
                <Bar dataKey="total" radius={[3, 3, 0, 0]}>
                  {priorityData.map((p, i) => <Cell key={i} fill={p.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card>
          <div className="eyebrow" style={{ color: T.muted }}>Average resolution time by priority</div>
          <div style={{ color: T.sub, fontSize: 12, marginTop: 4 }}>How long it actually takes to close cases at each priority level (created → closed). Critical priorities should resolve fastest.</div>
          <div style={{ height: 240, marginTop: 12 }}>
            <ResponsiveContainer>
              <BarChart data={priorityData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={T.borderSoft} vertical={false} />
                <XAxis dataKey="priority" tick={{ fill: T.sub, fontSize: 11 }} axisLine={{ stroke: T.border }} tickLine={{ stroke: T.border }} />
                <YAxis tick={{ fill: T.muted, fontSize: 11, fontFamily: "JetBrains Mono" }} axisLine={{ stroke: T.border }} tickLine={{ stroke: T.border }} unit="h" />
                <Tooltip content={<ResTip />} cursor={{ fill: T.surfaceAlt }} />
                <Bar dataKey="avg_res_h" radius={[3, 3, 0, 0]}>
                  {priorityData.map((p, i) => <Cell key={i} fill={p.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <div>
            <div className="eyebrow" style={{ color: T.muted }}>Resolution-time distribution by priority</div>
            <div style={{ color: T.sub, fontSize: 12, marginTop: 4 }}>
              The median (p50), 90th-percentile (p90), and worst-case resolution time per priority. Averages hide the long tail — the gap between p50 and p90/max shows how often things drag.
            </div>
          </div>
          <div className="mono" style={{ fontSize: 11, color: T.muted, display: "flex", gap: 12 }}>
            <span><span style={{ display: "inline-block", width: 10, height: 10, background: T.ok, borderRadius: 2, marginRight: 4, verticalAlign: "middle" }} />p50</span>
            <span><span style={{ display: "inline-block", width: 10, height: 10, background: T.warn, borderRadius: 2, marginRight: 4, verticalAlign: "middle" }} />p90</span>
            <span><span style={{ display: "inline-block", width: 10, height: 10, background: T.danger, borderRadius: 2, marginRight: 4, verticalAlign: "middle" }} />max</span>
          </div>
        </div>
        <div style={{ height: 280, marginTop: 12 }}>
          <ResponsiveContainer>
            <BarChart data={distribution} margin={{ top: 10, right: 20, left: 0, bottom: 0 }} barCategoryGap="20%">
              <CartesianGrid stroke={T.borderSoft} vertical={false} />
              <XAxis dataKey="priority" tick={{ fill: T.sub, fontSize: 11 }} axisLine={{ stroke: T.border }} tickLine={{ stroke: T.border }} />
              <YAxis tick={{ fill: T.muted, fontSize: 11, fontFamily: "JetBrains Mono" }} axisLine={{ stroke: T.border }} tickLine={{ stroke: T.border }} unit="h" />
              <Tooltip content={<DistTip />} cursor={{ fill: T.surfaceAlt }} />
              <Bar dataKey="p50_h" name="p50" fill={T.ok} radius={[3, 3, 0, 0]} />
              <Bar dataKey="p90_h" name="p90" fill={T.warn} radius={[3, 3, 0, 0]} />
              <Bar dataKey="max_h" name="max" fill={T.danger} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        {distribution.length === 0 && (
          <div style={{ color: T.sub, fontSize: 13, fontStyle: "italic", marginTop: 8 }}>No closed cases with resolution times yet.</div>
        )}
      </Card>
    </div>
  );
}

function DistTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, padding: "8px 12px", borderRadius: 4, fontSize: 12 }}>
      <div style={{ fontWeight: 600 }}>{d.priority}</div>
      <div className="mono" style={{ color: T.sub }}>p50: {d.p50_ms == null ? "—" : fmtDuration(d.p50_ms)}</div>
      <div className="mono" style={{ color: T.sub }}>p90: {d.p90_ms == null ? "—" : fmtDuration(d.p90_ms)}</div>
      <div className="mono" style={{ color: T.sub }}>max: {d.max_ms == null ? "—" : fmtDuration(d.max_ms)}</div>
      <div className="mono" style={{ color: T.muted, marginTop: 4 }}>from {d.n} resolved case{d.n === 1 ? "" : "s"}</div>
    </div>
  );
}

function VolumeTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, padding: "8px 12px", borderRadius: 4, fontSize: 12 }}>
      <div style={{ fontWeight: 600 }}>{d.priority}</div>
      <div className="mono" style={{ color: T.sub }}>{d.total} cases · {d.closed} closed</div>
    </div>
  );
}

function ResTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, padding: "8px 12px", borderRadius: 4, fontSize: 12 }}>
      <div style={{ fontWeight: 600 }}>{d.priority}</div>
      <div className="mono" style={{ color: T.sub }}>{d.avg_res_h == null ? "no data" : fmtDuration(d.avg_res_h * 36e5)} avg</div>
      <div className="mono" style={{ color: T.sub }}>from {d.res_n} resolved cases</div>
    </div>
  );
}
