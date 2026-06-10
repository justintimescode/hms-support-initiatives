import {
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie,
} from "recharts";
import { CheckCircle2, XCircle, Clock } from "lucide-react";
import { T } from "../../lib/theme.js";
import { fmtDuration, priorityColor } from "../../lib/format.js";
import { Card } from "../layout/Card.jsx";
import { CopyableNumber } from "../CopyableNumber.jsx";
import { Pill } from "../Pill.jsx";

/* ================= SLA ================= */
export function SlaBlock({ kpis, priorityData }) {
  const pct = kpis.slaRate == null ? 0 : kpis.slaRate;
  const hasData = kpis.slaEligible > 0;
  const missed = kpis.slaEligible - kpis.slaMet;
  // Health color for the headline number (green ≥ 95, amber ≥ 85, red below).
  const centerColor = pct >= 95 ? T.ok : pct >= 85 ? T.warn : T.danger;
  // Proportional donut: green = met, red = missed. Zero-value slices are dropped
  // so a 100%-met (or 0%) ring renders as a single clean arc.
  const donutData = !hasData
    ? [{ name: "No data", value: 1, fill: T.surfaceAlt }]
    : [
        kpis.slaMet > 0 && { name: "Met", value: kpis.slaMet, fill: T.ok },
        missed > 0 && { name: "Missed", value: missed, fill: T.danger },
      ].filter(Boolean);
  const missedInitial = kpis.slaMissedInitial ?? 0;
  const missedCadence = kpis.slaMissedCadence ?? 0;
  const nearestBreach = [...kpis.atRisk, ...kpis.breached]
    .sort((a, b) => (a._slaDueSop || 0) - (b._slaDueSop || 0))
    .slice(0, 6);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: 12 }}>
      <Card>
        <div className="eyebrow" style={{ color: T.muted }}>Overall SLA</div>
        <div style={{ color: T.sub, fontSize: 12, marginTop: 4 }}>The share of cases that held the Infor SOP response cadence — first response on target and no overdue update gaps. Green ring = met, red = missed. Headline color: green ≥ 95%, amber ≥ 85%, red below.</div>
        <div style={{ position: "relative", height: 240, marginTop: 12 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={donutData}
                dataKey="value"
                innerRadius="70%"
                outerRadius="95%"
                startAngle={90}
                endAngle={-270}
                stroke="none"
                isAnimationActive={false}
                paddingAngle={donutData.length > 1 ? 1.5 : 0}
                cornerRadius={4}
              >
                {donutData.map((d, i) => (<Cell key={i} fill={d.fill} />))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            <div className="display mono" style={{ fontSize: 48, fontWeight: 500, color: hasData ? centerColor : T.muted, lineHeight: 1 }}>
              {kpis.slaRate == null ? "—" : `${pct.toFixed(1)}%`}
            </div>
            <div style={{ fontSize: 12, color: T.sub, marginTop: 4 }}>within SLA</div>
          </div>
        </div>
        <div className="hairline" style={{ margin: "12px -20px 0", borderColor: T.borderSoft }} />
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12, fontSize: 12, color: T.sub }}>
          <span><CheckCircle2 size={12} style={{ color: T.ok, verticalAlign: "middle" }} /> Met: <span className="mono" style={{ color: T.ink }}>{kpis.slaMet}</span></span>
          <span><XCircle size={12} style={{ color: T.danger, verticalAlign: "middle" }} /> Missed: <span className="mono" style={{ color: T.ink }}>{missed}</span></span>
          <span><Clock size={12} style={{ color: T.muted, verticalAlign: "middle" }} /> Avg FRT: <span className="mono" style={{ color: T.ink }}>{fmtDuration(kpis.avgFrt)}</span></span>
        </div>
        {missed > 0 && (
          <>
            <div className="hairline" style={{ margin: "12px -20px 0", borderColor: T.borderSoft }} />
            <div className="eyebrow" style={{ color: T.muted, marginTop: 12 }}>Why cases missed</div>
            <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", marginTop: 8, background: T.surfaceAlt }}>
              {missedInitial > 0 && <div style={{ flex: missedInitial, background: T.warn }} title={`First response: ${missedInitial}`} />}
              {missedCadence > 0 && <div style={{ flex: missedCadence, background: T.danger }} title={`Cadence: ${missedCadence}`} />}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 12, color: T.sub }}>
              <span><Dot color={T.warn} /> First response: <span className="mono" style={{ color: T.ink }}>{missedInitial}</span></span>
              <span><Dot color={T.danger} /> Cadence: <span className="mono" style={{ color: T.ink }}>{missedCadence}</span></span>
            </div>
          </>
        )}
      </Card>

      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div className="eyebrow" style={{ color: T.muted }}>SLA compliance by priority</div>
          <div style={{ fontSize: 11, color: T.muted }}>closed + in-flight, cases with an SOP cadence</div>
        </div>
        <div style={{ color: T.sub, fontSize: 12, marginTop: 4 }}>Hit rate broken out per priority level — surfaces whether a single priority is dragging the overall number down.</div>
        <div style={{ height: 200, marginTop: 12 }}>
          <ResponsiveContainer>
            <BarChart data={priorityData} layout="vertical" margin={{ left: 0, right: 30, top: 10, bottom: 0 }}>
              <CartesianGrid stroke={T.borderSoft} horizontal={false} />
              <XAxis type="number" domain={[0, 100]} tick={{ fill: T.muted, fontSize: 11, fontFamily: "JetBrains Mono" }} axisLine={{ stroke: T.border }} tickLine={{ stroke: T.border }} unit="%" />
              <YAxis type="category" dataKey="priority" tick={{ fill: T.ink, fontSize: 12 }} width={90} axisLine={{ stroke: T.border }} tickLine={{ stroke: T.border }} />
              <Tooltip content={<SlaTip />} cursor={{ fill: T.surfaceAlt }} />
              <Bar dataKey="sla_pct" radius={[0, 3, 3, 0]}>
                {priorityData.map((p, i) => (
                  <Cell key={i} fill={p.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="hairline" style={{ margin: "8px -20px 12px", borderColor: T.borderSoft }} />
        <div className="eyebrow" style={{ color: T.muted, marginBottom: 4 }}>Open cases approaching or past SLA</div>
        <div style={{ color: T.sub, fontSize: 12, marginBottom: 8 }}>Up to six open cases sorted by SLA deadline. Amber = within 24h, red = already breached.</div>
        {nearestBreach.length === 0 ? (
          <div style={{ fontSize: 13, color: T.sub, fontStyle: "italic" }}>No open cases are at risk. Clean slate.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {nearestBreach.map((r) => {
              const now = new Date();
              const breached = r._slaDueSop && r._slaDueSop < now;
              const ms = r._slaDueSop ? Math.abs(r._slaDueSop - now) : 0;
              return (
                <div key={r.number} style={{ display: "grid", gridTemplateColumns: "100px 70px 1fr 120px", gap: 12, alignItems: "center", fontSize: 12, padding: "6px 0", borderBottom: `1px solid ${T.borderSoft}` }}>
                  <CopyableNumber value={r.number} className="mono" style={{ color: T.sub }} />
                  <Pill color={priorityColor(r.priority)}>{String(r.priority).split(" - ")[1] || r.priority}</Pill>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.short_description}</span>
                  <span className="mono" style={{ color: breached ? T.danger : T.warn, textAlign: "right" }}>
                    {breached ? `- ${fmtDuration(ms)}` : `in ${fmtDuration(ms)}`}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

function Dot({ color }) {
  return (
    <span
      aria-hidden
      style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: color, marginRight: 5, verticalAlign: "middle" }}
    />
  );
}

function SlaTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, padding: "8px 12px", borderRadius: 4, fontSize: 12 }}>
      <div style={{ fontWeight: 600 }}>{d.priority}</div>
      <div className="mono" style={{ color: T.sub }}>{d.sla_pct == null ? "no SLA data" : d.sla_pct.toFixed(1) + "% SLA"}</div>
      <div className="mono" style={{ color: T.sub }}>{d.sla_met}/{d.sla_total} met · {d.total} cases</div>
      {d.avg_res_h != null && <div className="mono" style={{ color: T.sub }}>avg resolve: {fmtDuration(d.avg_res_h * 36e5)}</div>}
    </div>
  );
}
