import { ClipboardList, CheckCircle2, Clock, AlertTriangle } from "lucide-react";
import { T } from "../lib/theme.js";
import { fmtDuration, deltaColor, fmtDeltaCount, fmtDeltaPct, fmtDeltaDuration } from "../lib/format.js";
import { Card } from "./layout/Card.jsx";

/* ================= KPI Row ================= */
// "higher is better" by default. For metrics where lower is better, color flips.
export function DeltaLine({ text, color }) {
  if (!text) return null;
  return (
    <div
      className="mono"
      style={{
        color,
        fontSize: 11,
        marginTop: 6,
        fontWeight: 600,
        letterSpacing: "0.02em",
      }}
    >
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
      label: "Median resolution",
      value: fmtDuration(kpis.resP50),
      sub: `p90 ${fmtDuration(kpis.resP90)} · avg ${fmtDuration(kpis.avgRes)}`,
      icon: <Clock size={14} />,
      accent: T.ink,
      delta: cmp ? { text: fmtDeltaDuration(kpis.resP50, cmp.resP50), color: deltaColor((kpis.resP50 ?? 0) - (cmp.resP50 ?? 0), "down") } : null,
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
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 14 }}>
      {cards.map((c) => (
        <Card
          key={c.label}
          className="hoverlift"
          style={{
            position: "relative",
            overflow: "hidden",
            padding: "20px 22px 22px",
          }}
        >
          {/* top accent bar */}
          <div
            aria-hidden
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: 2,
              background: c.accent,
              opacity: 0.85,
            }}
          />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div className="eyebrow" style={{ color: T.muted }}>{c.label}</div>
            <span
              style={{
                color: c.accent,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 26,
                height: 26,
                borderRadius: 7,
                background: c.accent + "10",
              }}
            >
              {c.icon}
            </span>
          </div>
          <div
            className="display"
            style={{
              fontSize: 48,
              lineHeight: 1.02,
              marginTop: 12,
              color: c.accent,
              letterSpacing: "-0.02em",
              fontFeatureSettings: '"tnum"',
            }}
          >
            {c.value}
          </div>
          <div style={{ color: T.sub, fontSize: 12.5, marginTop: 10, lineHeight: 1.45 }}>{c.sub}</div>
          {c.delta && <DeltaLine text={c.delta.text} color={c.delta.color} />}
        </Card>
      ))}
    </div>
  );
}
