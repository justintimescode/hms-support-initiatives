import { ClipboardList, CheckCircle2, Clock, AlertTriangle } from "lucide-react";
import { T } from "../lib/theme.js";
import { fmtDuration, deltaColor, fmtDeltaCount, fmtDeltaPct, fmtDeltaDuration } from "../lib/format.js";
import { Card } from "./layout/Card.jsx";

/* ================= KPI Row ================= */
// "higher is better" by default. For metrics where lower is better, color flips.
export function DeltaLine({ text, color }) {
  if (!text) return null;
  return (
    <div className="mono" style={{ color, fontSize: 11, marginTop: 4, fontWeight: 500 }}>
      {text}
    </div>
  );
}

export function KpiRow({ kpis, compareKpis }) {
  const cmp = compareKpis;
  const cards = [
    {
      label: "Cases in view",
      value: kpis.total.toLocaleString(),
      sub: `${kpis.closed} closed · ${kpis.open} open`,
      icon: <ClipboardList size={14} />,
      accent: T.ink,
      delta: cmp ? { text: fmtDeltaCount(kpis.total, cmp.total), color: deltaColor(kpis.total - cmp.total, "up") } : null,
    },
    {
      label: "SLA compliance",
      value: kpis.slaRate == null ? "—" : `${kpis.slaRate.toFixed(1)}%`,
      sub: kpis.slaEligible ? `${kpis.slaMet} / ${kpis.slaEligible} within SLA` : "no data",
      icon: <CheckCircle2 size={14} />,
      accent: kpis.slaRate != null && kpis.slaRate >= 95 ? T.ok : kpis.slaRate != null && kpis.slaRate >= 85 ? T.warn : T.danger,
      delta: cmp ? { text: fmtDeltaPct(kpis.slaRate, cmp.slaRate), color: deltaColor((kpis.slaRate ?? 0) - (cmp.slaRate ?? 0), "up") } : null,
    },
    {
      label: "Avg resolution",
      value: fmtDuration(kpis.avgRes),
      sub: "from created to closed",
      icon: <Clock size={14} />,
      accent: T.ink,
      delta: cmp ? { text: fmtDeltaDuration(kpis.avgRes, cmp.avgRes), color: deltaColor((kpis.avgRes ?? 0) - (cmp.avgRes ?? 0), "down") } : null,
    },
    {
      label: "Open at risk",
      value: (kpis.atRisk.length + kpis.breached.length).toString(),
      sub: `${kpis.breached.length} breached · ${kpis.atRisk.length} due in 24h`,
      icon: <AlertTriangle size={14} />,
      accent: kpis.breached.length > 0 ? T.danger : kpis.atRisk.length > 0 ? T.warn : T.ok,
      delta: cmp ? {
        text: fmtDeltaCount(kpis.atRisk.length + kpis.breached.length, cmp.atRisk.length + cmp.breached.length),
        color: deltaColor((kpis.atRisk.length + kpis.breached.length) - (cmp.atRisk.length + cmp.breached.length), "down"),
      } : null,
    },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
      {cards.map((c) => (
        <Card key={c.label} className="hoverlift">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div className="eyebrow" style={{ color: T.muted }}>{c.label}</div>
            <span style={{ color: c.accent }}>{c.icon}</span>
          </div>
          <div className="display mono" style={{ fontSize: 40, fontWeight: 500, marginTop: 10, color: c.accent, lineHeight: 1 }}>
            {c.value}
          </div>
          <div style={{ color: T.sub, fontSize: 12, marginTop: 8 }}>{c.sub}</div>
          {c.delta && <DeltaLine text={c.delta.text} color={c.delta.color} />}
        </Card>
      ))}
    </div>
  );
}
