import { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import { T } from "../../lib/theme.js";
import { workloadStats } from "../../lib/stats.js";
import { Card } from "../layout/Card.jsx";

export function WorkloadVolumeBlock({ members }) {
  const data = useMemo(
    () =>
      (members || [])
        .map((m) => ({ name: m.name, total: m.kpis.total }))
        .filter((d) => d.total > 0)
        .sort((a, b) => b.total - a.total),
    [members],
  );
  const stats = useMemo(() => workloadStats(members), [members]);

  if (!data.length) {
    return (
      <Card>
        <div className="eyebrow" style={{ color: T.muted }}>Cases per analyst</div>
        <div style={{ color: T.sub, fontSize: 13, fontStyle: "italic", marginTop: 12 }}>
          No cases in the current date range.
        </div>
      </Card>
    );
  }

  const height = Math.max(240, data.length * 30 + 40);

  return (
    <Card>
      <div className="eyebrow" style={{ color: T.muted }}>Cases per analyst</div>
      <div style={{ color: T.sub, fontSize: 12, marginTop: 4, maxWidth: 720 }}>
        Total cases handled per analyst in the selected window, sorted high to low. The dashed lines
        mark the team mean and median — bars far past them are the analysts pulling the curve.
      </div>
      <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 11, color: T.sub, flexWrap: "wrap" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 16, height: 2, background: T.accent, display: "inline-block" }} />
          Mean {stats.mean.toFixed(1)}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              width: 16,
              height: 0,
              borderTop: `2px dashed ${T.muted}`,
              display: "inline-block",
            }}
          />
          Median {stats.median.toFixed(0)}
        </span>
      </div>
      <div style={{ height, marginTop: 12 }}>
        <ResponsiveContainer>
          <BarChart data={data} layout="vertical" margin={{ top: 10, right: 20, left: 8, bottom: 0 }}>
            <CartesianGrid stroke={T.borderSoft} horizontal={false} />
            <XAxis
              type="number"
              tick={{ fill: T.muted, fontSize: 11, fontFamily: "JetBrains Mono" }}
              axisLine={{ stroke: T.border }}
              tickLine={{ stroke: T.border }}
              allowDecimals={false}
            />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fill: T.ink, fontSize: 12 }}
              width={140}
              interval={0}
              axisLine={{ stroke: T.border }}
              tickLine={{ stroke: T.border }}
            />
            <Tooltip content={<VolumeTip />} cursor={{ fill: T.surfaceAlt }} />
            <Bar dataKey="total" fill={T.accent} radius={[0, 2, 2, 0]} />
            <ReferenceLine
              x={stats.mean}
              stroke={T.accent}
              strokeWidth={1}
              ifOverflow="extendDomain"
            />
            <ReferenceLine
              x={stats.median}
              stroke={T.muted}
              strokeDasharray="4 4"
              strokeWidth={1}
              ifOverflow="extendDomain"
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function VolumeTip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const v = payload[0].value;
  return (
    <div
      style={{
        background: T.surface,
        border: `1px solid ${T.border}`,
        padding: "8px 12px",
        borderRadius: 4,
        fontSize: 12,
      }}
    >
      <div style={{ fontWeight: 600 }}>{label}</div>
      <div className="mono" style={{ color: T.sub }}>{v} cases</div>
    </div>
  );
}
