import { useState, useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { T } from "../../lib/theme.js";
import { Card } from "../layout/Card.jsx";
import { CaseDrilldown } from "../CaseDrilldown.jsx";

/* ================= Resolved / Closed · By Assignee (team view) ================= */
// Stack order = bottom -> top; colors from theme tokens (never hardcode hex).
// "Resolved" = State="Resolved" (Solution Proposed, awaiting customer). "Closed" =
// State="Closed" (truly done). These are distinct lifecycle buckets, see enrich.js v8.
const SEGMENTS = [
  { key: "Closed", color: T.ok, match: (r) => r._isClosed },
  { key: "Resolved", color: T.accent, match: (r) => r._lifecycle === "solution_proposed" },
];

export function WorkloadResolvedBlock({ members }) {
  const data = useMemo(
    () =>
      (members || [])
        .map((m) => ({
          name: m.name,
          Closed: m.kpis.closed,
          Resolved: m.kpis.solutionProposed,
          _total: m.kpis.closed + m.kpis.solutionProposed,
        }))
        .filter((d) => d._total > 0)
        .sort((a, b) => b._total - a._total),
    [members],
  );

  const [selected, setSelected] = useState(null); // { name, segIdx }
  const drilldownRows = useMemo(() => {
    if (!selected) return [];
    const m = (members || []).find((x) => x.name === selected.name);
    if (!m) return [];
    const seg = SEGMENTS[selected.segIdx];
    return m.rows
      .filter(seg.match)
      .sort(
        (a, b) =>
          (b._closed?.getTime?.() || b._created?.getTime?.() || 0) -
          (a._closed?.getTime?.() || a._created?.getTime?.() || 0),
      );
  }, [members, selected]);

  if (!data.length) {
    return (
      <Card>
        <div className="eyebrow" style={{ color: T.muted }}>Resolved / closed cases by assignee</div>
        <div style={{ color: T.sub, fontSize: 13, fontStyle: "italic", marginTop: 12 }}>
          No resolved or closed cases in the current date range.
        </div>
      </Card>
    );
  }

  const height = Math.max(240, data.length * 30 + 40);

  return (
    <Card>
      <div className="eyebrow" style={{ color: T.muted }}>Resolved / closed cases by assignee</div>
      <div style={{ color: T.sub, fontSize: 12, marginTop: 4, maxWidth: 720 }}>
        Completed work per analyst — Closed (State=Closed) plus Resolved (Solution Proposed, awaiting
        customer confirmation), sorted high to low. Click a segment to drill into those cases.
      </div>
      <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 11, color: T.sub, flexWrap: "wrap" }}>
        {SEGMENTS.map((s) => (
          <span key={s.key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 12, height: 10, background: s.color, borderRadius: 2 }} />
            {s.key}
          </span>
        ))}
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
            <Tooltip content={<ResolvedTip />} cursor={{ fill: T.surfaceAlt }} />
            {SEGMENTS.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                stackId="rc"
                fill={s.color}
                cursor="pointer"
                onClick={(d) =>
                  setSelected((prev) =>
                    prev && prev.name === d.name && prev.segIdx === i ? null : { name: d.name, segIdx: i },
                  )
                }
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      {selected && (
        <CaseDrilldown
          title={`${selected.name} · ${SEGMENTS[selected.segIdx].key}`}
          rows={drilldownRows}
          onClose={() => setSelected(null)}
        />
      )}
    </Card>
  );
}

function ResolvedTip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + (p.value || 0), 0);
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, padding: "8px 12px", borderRadius: 4, fontSize: 12 }}>
      <div style={{ fontWeight: 600 }}>{label}</div>
      <div className="mono" style={{ color: T.sub, marginBottom: 4 }}>{total} resolved / closed</div>
      {payload.filter((p) => p.value > 0).map((p) => (
        <div key={p.dataKey} className="mono" style={{ color: T.sub, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 8, height: 8, background: p.color, borderRadius: 2 }} />
          {p.dataKey}: {p.value}
        </div>
      ))}
    </div>
  );
}
