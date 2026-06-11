import { useEffect, useRef } from "react";
import { X, ArrowRight, Sparkles, AlertTriangle } from "lucide-react";
import { T } from "../lib/theme.js";
import { fmtDuration, SLA_COLOR } from "../lib/format.js";
import { Card } from "./layout/Card.jsx";
import { Pill } from "./Pill.jsx";
import { SlaRiskBlock } from "./charts/SlaRiskBlock.jsx";
import { StuckCasesList } from "./StuckCasesList.jsx";

/* ============================================================================
 * Analyst Profile modal — the full per-analyst statistics + insights view that
 * opens when a member profile is clicked (instead of navigating to the filtered
 * dashboard; the "Open full dashboard" action still does that). Reuses the
 * precomputed `member` fields from teamMembers plus the SLA-risk and stuck-case
 * blocks, and wires the per-analyst AI insights path.
 * ========================================================================== */
export function AnalystProfileModal({ member, ai, onRunAi, onClose, onOpenDashboard }) {
  const closeRef = useRef(null);

  // Escape to close + lock background scroll while open.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  if (!member) return null;
  const k = member.kpis || {};
  const q = member.quality || {};
  const ix = member.interactionStats || {};
  const maxPriority = Math.max(1, ...(member.priorityMix || []).map((p) => p.count));

  const tiles = [
    { label: "Cases", value: (k.total ?? 0).toLocaleString(), sub: `${k.closed ?? 0} closed · ${k.open ?? 0} open` },
    { label: "SLA", value: k.slaRate == null ? "—" : `${k.slaRate.toFixed(1)}%`, sub: `${k.slaMet ?? 0}/${k.slaEligible ?? 0} met`, color: SLA_COLOR(k.slaRate) },
    { label: "Median resolution", value: fmtDuration(k.resP50), sub: `p90 ${fmtDuration(k.resP90)}` },
    { label: "Avg first response", value: fmtDuration(k.avgFrt), sub: `median ${fmtDuration(k.frtP50)}` },
    { label: "First-contact res", value: q.fcrRate == null ? "—" : `${q.fcrRate.toFixed(0)}%`, sub: `${q.fcr ?? 0}/${q.closed ?? 0} ≤1 touch` },
    { label: "Reopen rate", value: q.reopenRate == null ? "—" : `${q.reopenRate.toFixed(0)}%`, sub: `${q.reopened ?? 0} reopened`, color: q.reopenRate > 12 ? T.danger : undefined },
    { label: "Open at risk", value: `${(k.breached?.length ?? 0) + (k.atRisk?.length ?? 0)}`, sub: `${k.breached?.length ?? 0} breached · ${k.atRisk?.length ?? 0} <24h`, color: (k.breached?.length ?? 0) ? T.danger : (k.atRisk?.length ?? 0) ? T.warn : undefined },
    { label: "Avg turns / case", value: ix.avgTurns ? ix.avgTurns.toFixed(1) : "—", sub: `${(ix.multiTouchPct || 0).toFixed(0)}% multi-touch` },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${member.name} profile`}
      onClick={onClose}
      className="no-print"
      style={{
        position: "fixed", inset: 0, zIndex: 50,
        background: T.scrim,
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "40px 20px", overflowY: "auto",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="fade-in scrollbar"
        style={{
          width: "100%", maxWidth: 880, background: T.bg,
          border: `1px solid ${T.border}`, borderRadius: T.radiusLg || 12,
          boxShadow: T.shadowLg, maxHeight: "calc(100vh - 80px)", overflowY: "auto",
        }}
      >
        {/* header */}
        <div style={{ position: "sticky", top: 0, zIndex: 1, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "18px 22px", background: T.surface, borderBottom: `1px solid ${T.border}` }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, minWidth: 0 }}>
            <div className="display" style={{ fontSize: 24, color: T.ink, letterSpacing: "-0.015em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{member.name}</div>
            <Pill color={SLA_COLOR(k.slaRate)}>{k.slaRate == null ? "no SLA data" : `SLA ${k.slaRate.toFixed(0)}%`}</Pill>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <button
              onClick={onOpenDashboard}
              style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 12px", background: "transparent", color: T.sub, border: `1px solid ${T.border}`, borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: "Geist, DM Sans, sans-serif" }}
            >
              Open full dashboard <ArrowRight size={12} />
            </button>
            <button ref={closeRef} onClick={onClose} aria-label="Close" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, background: "transparent", color: T.sub, border: `1px solid ${T.border}`, borderRadius: 6, cursor: "pointer" }}>
              <X size={16} />
            </button>
          </div>
        </div>

        {/* body */}
        <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
          {/* KPI tiles */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
            {tiles.map((t) => (
              <div key={t.label} style={{ background: T.surfaceAlt, borderRadius: 8, padding: "12px 14px", border: `1px solid ${T.borderSoft}` }}>
                <div className="eyebrow" style={{ color: T.muted, fontSize: 9 }}>{t.label}</div>
                <div className="mono" style={{ fontSize: 22, fontWeight: 600, color: t.color || T.ink, marginTop: 4, lineHeight: 1 }}>{t.value}</div>
                <div style={{ color: T.sub, fontSize: 11, marginTop: 5 }}>{t.sub}</div>
              </div>
            ))}
          </div>

          {/* priority mix + top lists */}
          <Card>
            <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr", gap: 18 }}>
              <div>
                <div className="eyebrow" style={{ color: T.muted, marginBottom: 8 }}>Priority mix</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  {(member.priorityMix || []).map((p) => (
                    <div key={p.priority} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                      <div style={{ width: 84, color: T.sub, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.priority}</div>
                      <div style={{ flex: 1, height: 6, background: T.surfaceAlt, borderRadius: 3, overflow: "hidden" }}>
                        <div style={{ width: `${(p.count / maxPriority) * 100}%`, height: "100%", background: p.color }} />
                      </div>
                      <div className="mono" style={{ width: 26, textAlign: "right", color: T.sub }}>{p.count}</div>
                    </div>
                  ))}
                </div>
              </div>
              <MiniList label="Top categories" items={member.topCategories} />
              <MiniList label="Top accounts" items={member.topAccounts} />
            </div>
          </Card>

          {/* SLA risk on their open cases */}
          <SlaRiskBlock rows={member.rows} />

          {/* stuck cases */}
          <StuckCasesList rows={member.rows} />

          {/* AI insights */}
          <Card>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <div className="eyebrow" style={{ color: T.muted }}>AI insights</div>
              <button
                onClick={onRunAi}
                disabled={ai?.loading}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", background: ai?.loading ? T.surfaceAlt : T.ink, color: ai?.loading ? T.muted : T.surface, border: `1px solid ${T.ink}`, borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: ai?.loading ? "default" : "pointer", fontFamily: "Geist, DM Sans, sans-serif" }}
              >
                <Sparkles size={12} /> {ai?.loading ? "Analyzing…" : ai?.result ? "Re-run" : "Analyze with AI"}
              </button>
            </div>

            {ai?.notConfigured ? (
              <div style={{ fontSize: 12, color: T.muted, fontStyle: "italic", marginTop: 10, display: "flex", alignItems: "center", gap: 6 }}>
                <AlertTriangle size={12} style={{ color: T.warn }} /> AI insights are not configured in this environment.
              </div>
            ) : ai?.error ? (
              <div style={{ color: T.danger, fontSize: 12, marginTop: 10, display: "flex", alignItems: "center", gap: 6 }}>
                <AlertTriangle size={12} /> {ai.error}
              </div>
            ) : ai?.result ? (
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>
                <InsightList title="Themes" items={ai.result.themes?.map((t) => ({ h: t.title, b: t.description }))} />
                <InsightList title="Recurring issues" items={ai.result.recurring_issues?.map((t) => ({ h: t.issue, b: t.evidence }))} />
                <InsightList title="Skill opportunities" items={ai.result.skill_opportunities?.map((t) => ({ h: t.area, b: t.why }))} />
                <InsightList title="Knowledge base gaps" items={ai.result.kb_gaps?.map((t) => ({ h: t.gap, b: t.why }))} />
                {ai.result.watch_outs?.length > 0 && (
                  <div>
                    <div className="eyebrow" style={{ color: T.muted, marginBottom: 6 }}>Watch-outs</div>
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.5, color: T.sub }}>
                      {ai.result.watch_outs.map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: T.sub, marginTop: 10 }}>
                Run a qualitative read of this analyst's queue — themes, recurring issues, skill opportunities, and knowledge-base gaps. A sample of cases is anonymized before analysis.
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function MiniList({ label, items }) {
  return (
    <div>
      <div className="eyebrow" style={{ color: T.muted, marginBottom: 8 }}>{label}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {(!items || items.length === 0) ? (
          <div style={{ fontSize: 12, color: T.muted, fontStyle: "italic" }}>—</div>
        ) : items.map((it) => (
          <div key={it.name} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12 }}>
            <span style={{ color: T.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</span>
            <span className="mono" style={{ color: T.sub }}>{it.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function InsightList({ title, items }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <div className="eyebrow" style={{ color: T.muted, marginBottom: 6 }}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {items.map((it, i) => (
          <div key={i}>
            <div style={{ fontWeight: 600, fontSize: 12 }}>{it.h}</div>
            <div style={{ color: T.sub, fontSize: 12, marginTop: 2, lineHeight: 1.45 }}>{it.b}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
