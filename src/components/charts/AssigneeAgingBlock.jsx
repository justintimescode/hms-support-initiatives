import { useState, useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { T } from "../../lib/theme.js";
import { AGING_BUCKETS } from "../../lib/constants.js";
import { openByAssigneeAge } from "../../lib/stats.js";
import { Card } from "../layout/Card.jsx";
import { CaseDrilldown } from "../CaseDrilldown.jsx";

/* ================= Open Backlog · By Assignee (team view) ================= */
const AGING_STACK_COLORS = [T.ok, T.warn, T.accent, T.danger];

export function AssigneeAgingBlock({ members }) {
  const data = useMemo(() => openByAssigneeAge(members), [members]);
  const [selected, setSelected] = useState(null); // { name, bucketIdx }
  const drilldownRows = useMemo(() => {
    if (!selected) return [];
    const m = members.find((x) => x.name === selected.name);
    if (!m) return [];
    const now = Date.now();
    const bucket = AGING_BUCKETS[selected.bucketIdx];
    return m.rows
      .filter((r) => r._isOpen && r._created)
      .filter((r) => {
        const days = Math.floor((now - r._created.getTime()) / 864e5);
        return days >= bucket.min && days <= bucket.max;
      })
      .sort((a, b) => a._created - b._created);
  }, [members, selected]);

  if (!data.length) {
    return (
      <Card>
        <div className="eyebrow" style={{ color: T.muted }}>Open cases by assignee · stacked by age</div>
        <div style={{ color: T.sub, fontSize: 13, fontStyle: "italic", marginTop: 12 }}>No open cases on the team.</div>
      </Card>
    );
  }

  const height = Math.max(240, data.length * 30 + 40);

  return (
    <Card>
      <div className="eyebrow" style={{ color: T.muted }}>Open cases by assignee · stacked by age</div>
      <div style={{ color: T.sub, fontSize: 12, marginTop: 4, maxWidth: 720 }}>
        Each analyst's open queue, with the dark segments (31–90d / 90d+) showing where stale work is concentrated. Click any segment to drill into those cases.
      </div>
      <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 11, color: T.sub, flexWrap: "wrap" }}>
        {AGING_BUCKETS.map((b, i) => (
          <span key={b.name} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 12, height: 10, background: AGING_STACK_COLORS[i], borderRadius: 2 }} />
            {b.name}
          </span>
        ))}
      </div>
      <div style={{ height, marginTop: 12 }}>
        <ResponsiveContainer>
          <BarChart data={data} layout="vertical" margin={{ top: 10, right: 20, left: 8, bottom: 0 }}>
            <CartesianGrid stroke={T.borderSoft} horizontal={false} />
            <XAxis type="number" tick={{ fill: T.muted, fontSize: 11, fontFamily: "JetBrains Mono" }} axisLine={{ stroke: T.border }} tickLine={{ stroke: T.border }} allowDecimals={false} />
            <YAxis type="category" dataKey="name" tick={{ fill: T.ink, fontSize: 12 }} width={140} interval={0} axisLine={{ stroke: T.border }} tickLine={{ stroke: T.border }} />
            <Tooltip content={<AssigneeAgingTip />} cursor={{ fill: T.surfaceAlt }} />
            {AGING_BUCKETS.map((b, i) => (
              <Bar
                key={b.name}
                dataKey={b.name}
                stackId="age"
                fill={AGING_STACK_COLORS[i]}
                cursor="pointer"
                onClick={(d) => setSelected((prev) =>
                  prev && prev.name === d.name && prev.bucketIdx === i ? null : { name: d.name, bucketIdx: i }
                )}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      {selected && (
        <CaseDrilldown
          title={`${selected.name} · ${AGING_BUCKETS[selected.bucketIdx].name}`}
          rows={drilldownRows}
          onClose={() => setSelected(null)}
        />
      )}
    </Card>
  );
}

function AssigneeAgingTip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + (p.value || 0), 0);
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, padding: "8px 12px", borderRadius: 4, fontSize: 12 }}>
      <div style={{ fontWeight: 600 }}>{label}</div>
      <div className="mono" style={{ color: T.sub, marginBottom: 4 }}>{total} open</div>
      {payload.filter((p) => p.value > 0).map((p) => (
        <div key={p.dataKey} className="mono" style={{ color: T.sub, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 8, height: 8, background: p.color, borderRadius: 2 }} />
          {p.dataKey}: {p.value}
        </div>
      ))}
    </div>
  );
}
