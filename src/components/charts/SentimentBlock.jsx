import { useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import {
  Download, ShieldCheck, ShieldQuestion, ShieldAlert, ShieldOff, CheckCircle2,
} from "lucide-react";
import { T, TOOLTIP_STYLE, AXIS_TICK, AXIS_TICK_CAT, BAR_RADIUS_V } from "../../lib/theme.js";
import { Card } from "../layout/Card.jsx";
import { Pill } from "../Pill.jsx";
import { EmptyState } from "../EmptyState.jsx";
import { SentimentDeepRead } from "../ai/SentimentDeepRead.jsx";
import { summarizeSentiment, RISK_HIGH, RISK_ELEVATED } from "../../lib/sentiment.js";
import { exportSentimentWorkbook } from "../../lib/sentiment-export.js";
import {
  EscalationRiskTable, CaseRow, AssigneeCell, Stat, SentIcon, ShowMore,
} from "./sentiment-shared.jsx";
import {
  SENTIMENT_STYLE, useExpand, thStyle, tdStyle, valColor, sentColor, riskColor,
} from "./sentiment-tokens.js";

/* ================= Customer Sentiment & Escalation Early-Warning =================
 * Three lifecycle views over the deterministic on-device engine (lib/sentiment.js):
 *
 *  1. EARLY WARNING (open + awaiting info): escalation-risk-ranked triage list.
 *     The risk model mirrors why customers actually escalate in this corpus —
 *     "Inactivity" and "Lack of Progress" — so unanswered messages, chases and
 *     analyst staleness outweigh raw tone. Cases where the customer has ALREADY
 *     escalated (workflow event in the journal) are badged, not predicted. The
 *     table itself lives in sentiment-shared.jsx — My Day renders the same one,
 *     trimmed to the at-risk tail.
 *  2. SOLUTION PROPOSED: reopen watch. Did the customer confirm the fix, push
 *     back, attach a condition, or go silent? Pushback = respond now, before
 *     the case is reopened.
 *  3. CLOSED REVIEW: retrospective for coaching — final tone, arcs, whether the
 *     customer ever confirmed the fix before the close.
 *
 * Reads the baked `sentiment_*` columns (summarizeSentiment prefers them; only
 * rows from pre-v11 imports are re-graded live). No case is sent to a model.
 */

const fmtH = (h) => (h == null ? "—" : h < 1 ? `${Math.round(h * 60)}m` : `${h.toFixed(1)}h`);
const fmtPct = (x) => `${Math.round((x || 0) * 100)}%`;

/* Solution-Proposed confirmation states. These colors land on Pill text, a
 * 22px count and an icon, so every one has to be text-safe: pushback = Infor
 * Red Shade, conditional = Infor Yellow Shade, silent = neutral,
 * confirmed = Infor Purple. */
const CONFIRM_META = {
  pushback: { label: "Pushback", color: T.danger, Icon: ShieldAlert, hint: "customer says the fix doesn't hold — respond before they reopen" },
  conditional: { label: "Verifying", color: T.warn, Icon: ShieldQuestion, hint: "customer is holding the case open to test/confirm" },
  silent: { label: "No confirmation", color: T.sub, Icon: ShieldOff, hint: "customer never confirmed — will auto-close unless they return" },
  confirmed: { label: "Confirmed", color: T.ok, Icon: ShieldCheck, hint: "customer confirmed the fix in writing" },
};

/* ---------------- View 1: Early warning (open work) ---------------- */

function EarlyWarningView({ open }) {
  const ranked = useMemo(() => {
    const scoreable = open.filter((g) => g.scoreable || g.escalated);
    // Escalated events first (they already happened), then by risk.
    scoreable.sort((a, b) => (b.escalated - a.escalated) || ((b.risk ?? -1) - (a.risk ?? -1)));
    return scoreable;
  }, [open]);

  if (!ranked.length) {
    return <EmptyState title="No open cases with customer dialogue" message="Open cases in the current view have no written customer messages to read." />;
  }

  return (
    <EscalationRiskTable
      rows={ranked}
      eyebrow="Escalation risk · open and awaiting-info cases, most urgent first"
      ariaLabel="Open cases by escalation risk"
      note={
        <>
          Risk is built from why customers here actually escalate — unanswered messages, repeated chasing, an issue they
          say keeps recurring, souring tone, urgency and business impact. <span style={{ color: riskColor(RISK_HIGH) }}>High ≥ {RISK_HIGH}</span> ·{" "}
          <span style={{ color: riskColor(RISK_ELEVATED) }}>Elevated ≥ {RISK_ELEVATED}</span>. Cases the customer already escalated are badged.
        </>
      }
    />
  );
}

/* ---------------- View 2: Solution proposed (reopen watch) ---------------- */

function SolutionProposedView({ proposed, rowsByNumber }) {
  const [openCase, toggleCase] = useExpand();
  const [expanded, setExpanded] = useState(false);

  const order = { pushback: 0, conditional: 1, silent: 2, confirmed: 3 };
  const ranked = useMemo(() => {
    const arr = [...proposed];
    arr.sort((a, b) => (order[a.confirmState] ?? 9) - (order[b.confirmState] ?? 9) || ((b.risk ?? 0) - (a.risk ?? 0)));
    return arr;
  }, [proposed]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!proposed.length) {
    return <EmptyState title="No Solution Proposed cases in view" message="No cases are awaiting customer confirmation under the current filters." />;
  }

  const counts = { pushback: 0, conditional: 0, silent: 0, confirmed: 0 };
  for (const g of proposed) if (g.confirmState) counts[g.confirmState]++;
  const visible = expanded ? ranked : ranked.slice(0, 12);
  const COLSPAN = 6;
  const fmtDate = (d) => (d instanceof Date && !isNaN(d) ? d.toISOString().slice(0, 10) : "—");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Card>
        <div className="eyebrow" style={{ marginBottom: 12 }}>Reopen watch · a solution was proposed — did the customer accept it?</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 18 }}>
          {["pushback", "conditional", "silent", "confirmed"].map((k) => {
            const m = CONFIRM_META[k];
            return (
              <div key={k} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <m.Icon size={18} strokeWidth={1.9} style={{ color: m.color, marginTop: 2, flexShrink: 0 }} />
                <div>
                  <div className="display" style={{ fontSize: 22, color: counts[k] ? m.color : T.muted, lineHeight: 1 }}>{counts[k]}</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: T.ink, marginTop: 4 }}>{m.label}</div>
                  <div style={{ fontSize: 12, color: T.sub, lineHeight: 1.4, marginTop: 2 }}>{m.hint}</div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <Card>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
          <div className="eyebrow">Cases, most at-risk of reopening first</div>
          <div className="mono" style={{ fontSize: 12, color: T.sub }}>{proposed.length} awaiting confirmation</div>
        </div>
        <div style={{ overflowX: "auto" }} className="scrollbar">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }} aria-label="Solution Proposed cases by reopen risk">
            <thead>
              <tr style={{ background: T.surfaceAlt }}>
                <th style={thStyle()}>Case</th>
                <th style={thStyle()}>Assignee</th>
                <th style={thStyle()}>Customer response</th>
                <th style={thStyle()}>Reopen risk</th>
                <th style={thStyle()}>Auto-closes</th>
                <th style={thStyle()}>Last customer message</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((g) => {
                const m = CONFIRM_META[g.confirmState] || CONFIRM_META.silent;
                const row = rowsByNumber.get(g.number);
                return (
                  <CaseRow
                    key={g.number}
                    g={g}
                    colSpan={COLSPAN}
                    open={openCase === g.number}
                    onToggle={() => toggleCase(g.number)}
                    cols={
                      <>
                        <AssigneeCell name={g.assignee} />
                        <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                          <Pill color={m.color}><m.Icon size={14} strokeWidth={2.25} /> {m.label}</Pill>
                        </td>
                        <td className="mono" style={{ ...tdStyle, fontWeight: 700, color: riskColor(g.risk, false), whiteSpace: "nowrap" }}>
                          {g.risk ?? "—"}
                        </td>
                        <td className="mono" style={{ ...tdStyle, color: T.sub, whiteSpace: "nowrap", fontSize: 12 }}>
                          {fmtDate(row?._autoCloseAt)}
                        </td>
                        <td style={{ ...tdStyle, color: T.sub, maxWidth: 380, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {g.lastQuote || "— (customer never replied)"}
                        </td>
                      </>
                    }
                  />
                );
              })}
            </tbody>
          </table>
        </div>
        <ShowMore total={ranked.length} expanded={expanded} onToggle={() => setExpanded((e) => !e)} />
      </Card>
    </div>
  );
}

/* ---------------- View 3: Closed review (retrospective) ---------------- */

function ClosedReviewView({ closed, summary }) {
  const [openCase, toggleCase] = useExpand();
  const [expanded, setExpanded] = useState(false);

  const scoreable = useMemo(() => {
    const arr = closed.filter((g) => g.scoreable);
    // Most negative endings first — the coaching material.
    arr.sort((a, b) => ((a.end ?? a.valence ?? 0) - (b.end ?? b.valence ?? 0)));
    return arr;
  }, [closed]);

  const dist = useMemo(() => {
    const pos = scoreable.filter((g) => g.valence > 0).length;
    const neu = scoreable.filter((g) => g.valence === 0).length;
    const neg = scoreable.filter((g) => g.valence < 0).length;
    // Chart geometry takes the viz tokens, not the status text tokens: Infor
    // Red fill for negative, the achromatic categorical residual for neutral,
    // Infor Purple for positive. Purple + red + neutral = three families.
    return [
      { name: "Negative", count: neg, color: T.dangerFill },
      { name: "Neutral", count: neu, color: T.categorical[7] },
      { name: "Positive", count: pos, color: T.vizAccent },
    ];
  }, [scoreable]);

  if (!closed.length) {
    return <EmptyState title="No closed cases in view" message="No closed cases match the current filters." />;
  }
  if (!scoreable.length) {
    return <EmptyState title="No scoreable closed cases" message="Every closed case here was handled by phone or closed silently — nothing written to review." />;
  }
  const visible = expanded ? scoreable : scoreable.slice(0, 12);
  const COLSPAN = 7;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Card>
        <div className="eyebrow" style={{ marginBottom: 12 }}>How closed cases ended · {scoreable.length} with written customer dialogue</div>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 1fr) minmax(260px, 1.4fr)", gap: 20, alignItems: "center" }}>
          <div style={{ height: 150, background: T.vizWell, borderRadius: T.radiusMd }}>
            <ResponsiveContainer>
              <BarChart data={dist} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={T.vizGrid} vertical={false} />
                <XAxis dataKey="name" tick={AXIS_TICK_CAT} axisLine={{ stroke: T.vizAxis }} tickLine={{ stroke: T.vizAxis }} />
                <YAxis allowDecimals={false} tick={AXIS_TICK} axisLine={{ stroke: T.vizAxis }} tickLine={{ stroke: T.vizAxis }} width={28} />
                <Tooltip cursor={{ fill: T.vizWell }} contentStyle={TOOLTIP_STYLE} />
                <Bar dataKey="count" radius={BAR_RADIUS_V}>
                  {/* 1px perceivability stroke: the achromatic neutral bar is
                      under 3:1 against the plot ground. */}
                  {dist.map((d) => <Cell key={d.name} fill={d.color} stroke={T.vizStroke} strokeWidth={1} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 16 }}>
            <Stat label="Ended negative" value={summary.closedNegative} color={summary.closedNegative ? T.danger : T.sub} sub="last customer message still unhappy" />
            <Stat label="Recovered" value={summary.recovered} color={T.ok} sub="frustrated opening → positive close" />
            <Stat label="Declined" value={summary.declined} color={summary.declined ? T.warn : T.sub} sub="tone got worse over the case" />
            <Stat label="Fix confirmed" value={`${summary.confirmedClose}`} color={T.ok} sub={`${fmtPct(summary.confirmedCloseShare)} closed with written customer confirmation`} />
          </div>
        </div>
      </Card>

      <Card>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
          <div className="eyebrow">Per-case review · worst endings first — activate a row for the quote &amp; notes</div>
          <div className="mono" style={{ fontSize: 12, color: T.sub }}>{scoreable.length} cases</div>
        </div>
        <div style={{ overflowX: "auto" }} className="scrollbar">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }} aria-label="Closed cases by ending tone">
            <thead>
              <tr style={{ background: T.surfaceAlt }}>
                <th style={thStyle()}>Case</th>
                <th style={thStyle()}>Assignee</th>
                <th style={thStyle()}>Priority</th>
                <th style={thStyle("right")}>Valence</th>
                <th style={thStyle()}>Sentiment</th>
                <th style={thStyle()}>Arc</th>
                <th style={thStyle()}>Fix confirmed?</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((g) => (
                <CaseRow
                  key={g.number}
                  g={g}
                  colSpan={COLSPAN}
                  open={openCase === g.number}
                  onToggle={() => toggleCase(g.number)}
                  cols={
                    <>
                      <AssigneeCell name={g.assignee} />
                      <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{g.priority || "—"}</td>
                      <td className="mono" style={{ ...tdStyle, textAlign: "right", fontWeight: 700, color: valColor(g.valence) }}>
                        {g.valence > 0 ? `+${g.valence}` : g.valence}
                      </td>
                      <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                        <Pill color={sentColor(g.sentiment)}><SentIcon s={g.sentiment} size={14} /> {g.sentiment}</Pill>
                      </td>
                      <td style={{ ...tdStyle, color: T.sub, whiteSpace: "nowrap" }}>{g.arc || "—"}</td>
                      <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                        {g.confirmState === "confirmed"
                          ? <span style={{ color: T.ok, display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12 }}><CheckCircle2 size={14} strokeWidth={2.25} /> yes</span>
                          : <span style={{ color: T.muted, fontSize: 12 }}>{g.confirmState === "pushback" ? "pushed back" : "no"}</span>}
                      </td>
                    </>
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
        <ShowMore total={scoreable.length} expanded={expanded} onToggle={() => setExpanded((e) => !e)} />
      </Card>
    </div>
  );
}

/* ---------------- Main block ---------------- */

export function SentimentBlock({ rows }) {
  const [view, setView] = useState("open");
  const [downloading, setDownloading] = useState(false);

  const { open, proposed, closed, scoreable, summary } = useMemo(() => summarizeSentiment(rows || []), [rows]);
  const rowsByNumber = useMemo(() => new Map((rows || []).map((r) => [r.number, r])), [rows]);

  const onExport = async () => {
    setDownloading(true);
    try {
      await exportSentimentWorkbook(rows);
    } finally {
      setDownloading(false);
    }
  };

  if (!rows || rows.length === 0) {
    return (
      <EmptyState
        title="No cases in view"
        message="No cases match the current filters. Adjust the filter bar above, or load a ServiceNow export to read customer sentiment."
      />
    );
  }

  const VIEWS = [
    { key: "open", label: `Early warning (${summary.openTotal})` },
    { key: "proposed", label: `Solution proposed (${summary.spTotal})` },
    { key: "closed", label: `Closed review (${summary.closedTotal})` },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <style>{SENTIMENT_STYLE}</style>

      {/* ---- Headline ---- */}
      <Card>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 18 }}>
          <div>
            <div className="eyebrow" style={{ color: T.accentDeep }}>Customer voice · read on device, no model calls</div>
            <div style={{ color: T.sub, fontSize: 12, marginTop: 4, maxWidth: 620, lineHeight: 1.5 }}>
              Only what the customer actually wrote is scored — Infor replies, System notes and internal work notes are
              attributed and excluded. Escalation requests and customer priority raises in the journal are surfaced as events.
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <span className="mono" style={{ fontSize: 12, color: T.sub }}>{summary.analyzed} cases</span>
            <button
              type="button"
              onClick={onExport}
              disabled={downloading}
              style={{
                display: "inline-flex", alignItems: "center", gap: 7,
                padding: "7px 13px", background: T.surface, color: T.ink,
                border: `1px solid ${T.border}`, borderRadius: T.radiusSm, fontSize: 12,
                fontWeight: 600, cursor: downloading ? "default" : "pointer",
                opacity: downloading ? 0.6 : 1,
              }}
            >
              <Download size={14} strokeWidth={2.25} /> {downloading ? "Preparing…" : "Download workbook"}
            </button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 22 }}>
          <Stat
            label="Escalation events"
            value={summary.escalatedOpen}
            color={summary.escalatedOpen ? T.danger : T.sub}
            sub={summary.escalatedOpenCases.slice(0, 3).join(", ") || "no open case has an escalation request"}
          />
          <Stat
            label="High risk (open)"
            value={summary.highRisk}
            color={summary.highRisk ? T.danger : T.sub}
            sub={summary.highRiskCases.slice(0, 3).join(", ") || `no open case at risk ≥ ${RISK_HIGH}`}
          />
          <Stat
            label="Elevated risk"
            value={summary.elevatedRisk}
            color={summary.elevatedRisk ? T.warn : T.sub}
            sub={`risk ${RISK_ELEVATED}–${RISK_HIGH - 1} · worth a look this week`}
          />
          <Stat
            label="Awaiting reply"
            value={summary.unansweredTotal}
            color={summary.unansweredTotal ? T.warn : T.sub}
            sub="customer messages in open cases with no analyst response yet"
          />
          <Stat
            label="Pushback after solution"
            value={summary.spPushback}
            color={summary.spPushback ? T.danger : T.sub}
            sub="Solution Proposed cases where the customer says it isn't fixed"
          />
          <Stat
            label="Avg valence"
            value={summary.avgValence >= 0 ? `+${summary.avgValence.toFixed(2)}` : summary.avgValence.toFixed(2)}
            color={valColor(summary.avgValence)}
            sub={`${summary.scoreableCount} scoreable (${fmtPct(summary.scoreableShare)}) · median first reply ${fmtH(summary.medianFrtH)}`}
          />
        </div>
      </Card>

      {/* ---- View switcher ---- */}
      <div role="group" aria-label="Sentiment views" style={{ display: "flex" }}>
        {VIEWS.map((v) => (
          <button
            key={v.key}
            type="button"
            className="sentiment-seg"
            aria-pressed={view === v.key}
            onClick={() => setView(v.key)}
          >
            {v.label}
          </button>
        ))}
      </div>

      {view === "open" && <EarlyWarningView open={open} />}
      {view === "proposed" && <SolutionProposedView proposed={proposed} rowsByNumber={rowsByNumber} />}
      {view === "closed" && <ClosedReviewView closed={closed} summary={summary} />}

      {/* ---- Optional, opt-in LLM deep-read (gated on aiClient.isConfigured) ---- */}
      <SentimentDeepRead scoreable={scoreable} rows={rows} />
    </div>
  );
}
