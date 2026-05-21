import { useMemo } from "react";
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from "recharts";
import { T } from "../../lib/theme.js";
import { workloadConcentration } from "../../lib/stats.js";
import { Card } from "../layout/Card.jsx";

/* ================= Workload Distribution ================= */
export function WorkloadDistributionBlock({ members }) {
  const lorenz = useMemo(() => workloadConcentration(members), [members]);

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div>
          <div className="eyebrow" style={{ color: T.muted, textAlign: "left" }}>Workload concentration</div>
          <div style={{ color: T.sub, fontSize: 12, marginTop: 4, textAlign: "left", maxWidth: 600 }}>
            How evenly cases are distributed across the team. The dashed diagonal is perfect equality; the further the curve sags below it, the more concentrated the workload — meaning a few analysts carry most of the cases.
          </div>
          <div style={{ color: T.muted, fontSize: 11, marginTop: 6, textAlign: "left", maxWidth: 600, fontStyle: "italic" }}>
            Gini score summarizes that gap in a single number: <strong style={{ color: T.sub }}>0</strong> = perfectly even (every analyst handles the same share), <strong style={{ color: T.sub }}>1</strong> = one analyst handles everything. Rough read: under 0.3 is balanced, 0.3–0.4 leans uneven, 0.4+ typically signals real concentration worth investigating.
          </div>
        </div>
        <div className="mono" style={{ fontSize: 12, color: T.sub, textAlign: "right" }}>
          <div>Top 20% carries <span style={{ color: lorenz.top20Share >= 60 ? T.danger : lorenz.top20Share >= 40 ? T.warn : T.ink, fontWeight: 600 }}>{lorenz.top20Share.toFixed(0)}%</span></div>
          <div>Top 50% carries <span style={{ color: T.ink, fontWeight: 600 }}>{lorenz.top50Share.toFixed(0)}%</span></div>
          <div>Gini <span style={{ color: T.ink, fontWeight: 600 }}>{lorenz.gini.toFixed(2)}</span></div>
        </div>
      </div>
      <div style={{ height: 280, marginTop: 12 }}>
        <ResponsiveContainer>
          <LineChart margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={T.borderSoft} />
            <XAxis
              type="number"
              dataKey="x"
              domain={[0, 1]}
              ticks={[0, 0.25, 0.5, 0.75, 1]}
              tickFormatter={(v) => `${Math.round(v * 100)}%`}
              tick={{ fill: T.sub, fontSize: 11 }}
              axisLine={{ stroke: T.border }}
              tickLine={{ stroke: T.border }}
            />
            <YAxis
              type="number"
              dataKey="y"
              domain={[0, 1]}
              ticks={[0, 0.25, 0.5, 0.75, 1]}
              tickFormatter={(v) => `${Math.round(v * 100)}%`}
              tick={{ fill: T.muted, fontSize: 11, fontFamily: "JetBrains Mono" }}
              axisLine={{ stroke: T.border }}
              tickLine={{ stroke: T.border }}
            />
            <Tooltip content={<LorenzTip total={lorenz.totalCases} />} />
            <Line
              data={[{ x: 0, y: 0 }, { x: 1, y: 1 }]}
              dataKey="y"
              stroke={T.muted}
              strokeWidth={1}
              strokeDasharray="4 4"
              dot={false}
              isAnimationActive={false}
              name="equality"
            />
            <Line
              data={lorenz.points}
              dataKey="y"
              stroke={T.accent}
              strokeWidth={2}
              type="monotone"
              dot={false}
              isAnimationActive={false}
              name="actual"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {lorenz.nAnalysts <= 1 && (
        <div style={{ color: T.sub, fontSize: 13, fontStyle: "italic", marginTop: 8 }}>Need at least 2 analysts to compare distribution.</div>
      )}
    </Card>
  );
}

function LorenzTip({ active, payload, total }) {
  if (!active || !payload?.length) return null;
  // The chart has two overlapping lines (equality + Lorenz). Prefer the entry
  // that carries actual analyst data, not the equality reference.
  const entry = payload.find((p) => p.payload && p.payload.name) || payload[0];
  const d = entry.payload;
  if (d.x === 0 && d.y === 0) return null;
  const xPct = (d.x * 100).toFixed(0);
  const yPct = (d.y * 100).toFixed(0);
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, padding: "8px 12px", borderRadius: 4, fontSize: 12 }}>
      {d.name && <div style={{ fontWeight: 600 }}>{d.name}</div>}
      <div className="mono" style={{ color: T.sub }}>Bottom {xPct}% of analysts</div>
      <div className="mono" style={{ color: T.sub }}>handle {yPct}% of cases</div>
      {d.count != null && <div className="mono" style={{ color: T.muted, marginTop: 4 }}>{d.count} of {total} total</div>}
    </div>
  );
}
