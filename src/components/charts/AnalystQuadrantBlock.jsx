import { useMemo } from "react";
import {
  ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, LabelList,
} from "recharts";
import { T, AXIS_TICK, TOOLTIP_STYLE } from "../../lib/theme.js";
import { analystEfficiency } from "../../lib/stats.js";
import { Card } from "../layout/Card.jsx";

/* ================= Throughput vs speed · analyst quadrants ================= */
// ServiceNow ranks agents on single-metric leaderboards; this puts the two
// metrics that trade off against each other on ONE plot. Right of the vertical
// line = closes more than the median analyst; below the horizontal line =
// resolves faster than the median. Bubble area is the open load still being
// carried — a big bubble in the slow-and-few quadrant is a queue quietly in
// trouble, not a performance verdict on its own.
export function AnalystQuadrantBlock({ members }) {
  const { points, medClosed, medDays } = useMemo(
    () => analystEfficiency(members),
    [members],
  );

  // Selective direct labels: naming every bubble collides in the dense
  // cluster near the origin, so only the points someone would ask about get a
  // name — the extremes of each axis and the biggest open load. Everyone else
  // is identified on hover.
  const labeled = useMemo(() => {
    const set = new Set();
    const take = (key, n = 2) =>
      [...points].sort((a, b) => b[key] - a[key]).slice(0, n).forEach((p) => set.add(p.name));
    take("closed");
    take("medianDays");
    take("open");
    return set;
  }, [points]);

  if (points.length < 2) {
    return (
      <Card>
        <div className="eyebrow">Throughput vs resolution speed</div>
        <div style={{ color: T.sub, fontSize: 13, fontStyle: "italic", marginTop: 12 }}>
          Needs at least two analysts with closed cases in the current window.
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="eyebrow">Throughput vs resolution speed</div>
      <div style={{ color: T.sub, fontSize: 12, marginTop: 4, maxWidth: 720 }}>
        Each bubble is an analyst: how many cases they closed in the window (right = more) against
        their median days-to-resolve (down = faster). Bubble size is the open load they're still
        carrying. The dashed lines are team medians, so the quadrants read: bottom-right — high volume,
        fast; top-right — high volume but slow, often a mix-of-work signal; bottom-left — fast but few,
        capacity to check; top-left — few and slow, worth a conversation, not a conclusion. Case
        difficulty is not evenly dealt, so read this next to the priority and category mix.
      </div>
      <div style={{ height: 340, marginTop: 12, background: T.vizWell, borderRadius: T.radiusMd }}>
        <ResponsiveContainer>
          <ScatterChart margin={{ top: 16, right: 30, left: 0, bottom: 4 }}>
            <CartesianGrid stroke={T.vizGrid} />
            <XAxis
              type="number"
              dataKey="closed"
              name="cases closed"
              tick={AXIS_TICK}
              axisLine={{ stroke: T.vizAxis }}
              tickLine={{ stroke: T.vizAxis }}
              allowDecimals={false}
              label={{ value: "cases closed", position: "insideBottom", offset: -2, fill: T.vizTick, fontSize: 11 }}
            />
            <YAxis
              type="number"
              dataKey="medianDays"
              name="median days to resolve"
              tick={AXIS_TICK}
              axisLine={{ stroke: T.vizAxis }}
              tickLine={{ stroke: T.vizAxis }}
              label={{ value: "median days", angle: -90, position: "insideLeft", fill: T.vizTick, fontSize: 11 }}
            />
            <ZAxis type="number" dataKey="open" range={[60, 400]} name="open load" />
            <Tooltip content={<QuadrantTip />} cursor={{ stroke: T.vizAxis }} />
            {medClosed != null && (
              <ReferenceLine x={medClosed} stroke={T.vizAxis} strokeDasharray="4 4" strokeWidth={1} />
            )}
            {medDays != null && (
              <ReferenceLine y={medDays} stroke={T.vizAxis} strokeDasharray="4 4" strokeWidth={1} />
            )}
            {/* Duotone bubbles: Purple Tint 02 body, Infor Purple outline. The
                outline is what keeps overlapping bubbles readable now that the
                fill is a solid ramp step rather than a composited alpha. */}
            <Scatter data={points} fill={T.categorical[5]} stroke={T.vizAccent} strokeWidth={1}>
              <LabelList
                dataKey="name"
                position="top"
                style={{ fill: T.vizCat, fontSize: 10 }}
                formatter={(name) => (labeled.has(name) ? name : "")}
              />
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <div style={{ color: T.muted, fontSize: 11, marginTop: 8 }}>
        Dashed lines: team median closes ({medClosed != null ? Math.round(medClosed) : "—"}) and median
        resolution days ({medDays != null ? medDays.toFixed(1) : "—"}). Labels mark the outliers on each
        axis; hover any bubble for its analyst. Only analysts with at least one measurable close appear.
      </div>
    </Card>
  );
}

function QuadrantTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={TOOLTIP_STYLE}>
      <div style={{ fontWeight: 600 }}>{d.name}</div>
      <div className="mono" style={{ color: T.sub }}>{d.closed} closed · median {d.medianDays}d</div>
      <div className="mono" style={{ color: T.muted }}>{d.open} still open · {d.total} total in window</div>
    </div>
  );
}
