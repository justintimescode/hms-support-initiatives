import { useMemo } from "react";
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import {
  T, AXIS_TICK, AXIS_TICK_CAT, TOOLTIP_STYLE, BAR_RADIUS_V,
} from "../../lib/theme.js";
import { fmtDuration, priorityFill } from "../../lib/format.js";
import { resolutionDistribution } from "../../lib/stats.js";
import { Card } from "../layout/Card.jsx";

/* ================= Priority =================
 * The p50/p90/max trio is ORDINAL, not categorical, so it reads as three
 * consecutive steps of the one monotonic Infor Purple ramp (p50 palest, max
 * darkest) rather than the old green/amber/red triad. */
const DIST_COLORS = [T.vizRamp[1], T.vizRamp[2], T.vizRamp[3]];
export function PriorityBlock({ priorityData, rows }) {
  const distribution = useMemo(() => resolutionDistribution(rows || []), [rows]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Card>
          <div className="eyebrow">Volume by priority</div>
          <div style={{ color: T.sub, fontSize: 12, marginTop: 4 }}>Total case count at each priority level. Shows where the bulk of the work sits.</div>
          <div style={{ height: 240, marginTop: 12, background: T.vizWell, borderRadius: T.radiusMd }}>
            <ResponsiveContainer>
              <BarChart data={priorityData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={T.vizGrid} vertical={false} />
                <XAxis dataKey="priority" tick={AXIS_TICK_CAT} axisLine={{ stroke: T.vizAxis }} tickLine={{ stroke: T.vizAxis }} />
                <YAxis tick={AXIS_TICK} axisLine={{ stroke: T.vizAxis }} tickLine={{ stroke: T.vizAxis }} />
                <Tooltip content={<VolumeTip />} cursor={{ fill: T.vizWell }} />
                <Bar dataKey="total" radius={BAR_RADIUS_V}>
                  {priorityData.map((p, i) => <Cell key={i} fill={priorityFill(p.priority)} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card>
          <div className="eyebrow">Average resolution time by priority</div>
          <div style={{ color: T.sub, fontSize: 12, marginTop: 4 }}>How long it actually takes to close cases at each priority level (created → closed). Critical priorities should resolve fastest.</div>
          <div style={{ height: 240, marginTop: 12, background: T.vizWell, borderRadius: T.radiusMd }}>
            <ResponsiveContainer>
              <BarChart data={priorityData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={T.vizGrid} vertical={false} />
                <XAxis dataKey="priority" tick={AXIS_TICK_CAT} axisLine={{ stroke: T.vizAxis }} tickLine={{ stroke: T.vizAxis }} />
                <YAxis tick={AXIS_TICK} axisLine={{ stroke: T.vizAxis }} tickLine={{ stroke: T.vizAxis }} unit="h" />
                <Tooltip content={<ResTip />} cursor={{ fill: T.vizWell }} />
                <Bar dataKey="avg_res_h" radius={BAR_RADIUS_V}>
                  {priorityData.map((p, i) => <Cell key={i} fill={priorityFill(p.priority)} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <div>
            <div className="eyebrow">Resolution-time distribution by priority</div>
            <div style={{ color: T.sub, fontSize: 12, marginTop: 4 }}>
              The median (p50), 90th-percentile (p90), and worst-case resolution time per priority. Averages hide the long tail — the gap between p50 and p90/max shows how often things drag.
            </div>
          </div>
          <div className="mono" style={{ fontSize: 11, color: T.muted, display: "flex", gap: 12 }}>
            <span><span style={{ display: "inline-block", width: 10, height: 10, background: DIST_COLORS[0], border: `1px solid ${T.vizStroke}`, borderRadius: T.radiusChart, marginRight: 4, verticalAlign: "middle" }} />p50</span>
            <span><span style={{ display: "inline-block", width: 10, height: 10, background: DIST_COLORS[1], borderRadius: T.radiusChart, marginRight: 4, verticalAlign: "middle" }} />p90</span>
            <span><span style={{ display: "inline-block", width: 10, height: 10, background: DIST_COLORS[2], borderRadius: T.radiusChart, marginRight: 4, verticalAlign: "middle" }} />max</span>
          </div>
        </div>
        <div style={{ height: 280, marginTop: 12, background: T.vizWell, borderRadius: T.radiusMd }}>
          <ResponsiveContainer>
            <BarChart data={distribution} margin={{ top: 10, right: 20, left: 0, bottom: 0 }} barCategoryGap="20%">
              <CartesianGrid stroke={T.vizGrid} vertical={false} />
              <XAxis dataKey="priority" tick={AXIS_TICK_CAT} axisLine={{ stroke: T.vizAxis }} tickLine={{ stroke: T.vizAxis }} />
              <YAxis tick={AXIS_TICK} axisLine={{ stroke: T.vizAxis }} tickLine={{ stroke: T.vizAxis }} unit="h" />
              <Tooltip content={<DistTip />} cursor={{ fill: T.vizWell }} />
              <Bar dataKey="p50_h" name="p50" fill={DIST_COLORS[0]} stroke={T.vizStroke} strokeWidth={1} radius={BAR_RADIUS_V} />
              <Bar dataKey="p90_h" name="p90" fill={DIST_COLORS[1]} radius={BAR_RADIUS_V} />
              <Bar dataKey="max_h" name="max" fill={DIST_COLORS[2]} radius={BAR_RADIUS_V} />
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
    <div style={TOOLTIP_STYLE}>
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
    <div style={TOOLTIP_STYLE}>
      <div style={{ fontWeight: 600 }}>{d.priority}</div>
      <div className="mono" style={{ color: T.sub }}>{d.total} cases · {d.closed} closed</div>
    </div>
  );
}

function ResTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={TOOLTIP_STYLE}>
      <div style={{ fontWeight: 600 }}>{d.priority}</div>
      <div className="mono" style={{ color: T.sub }}>{d.avg_res_h == null ? "no data" : fmtDuration(d.avg_res_h * 36e5)} avg</div>
      <div className="mono" style={{ color: T.sub }}>from {d.res_n} resolved cases</div>
    </div>
  );
}
