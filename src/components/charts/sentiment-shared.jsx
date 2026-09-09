import { useMemo, useState } from "react";
import { Smile, Meh, Frown, ChevronRight, Siren, Clock, MessageSquareWarning } from "lucide-react";
import { T } from "../../lib/theme.js";
import { Card } from "../layout/Card.jsx";
import { Pill } from "../Pill.jsx";
import { CopyableNumber } from "../CopyableNumber.jsx";
import {
  SENTIMENT_STYLE, sentColor, riskColor, riskLabel, thStyle, tdStyle, useExpand,
} from "./sentiment-tokens.js";

/* ============================================================================
 * Shared sentiment presentation — the pieces the Sentiment tab and My Day both
 * render, extracted so the escalation-risk table exists exactly once.
 *
 * Colour discipline (unchanged from the Sentiment block it came from): every
 * value here lands on TEXT, a pill or a small icon, so each token has to be
 * text-safe. T.ok is Infor Purple, so no good/bad pairing in this file is ever
 * red-and-green, and the saturated Infor Green/Yellow cores stay fill-only.
 * ========================================================================== */

export const SentIcon = ({ s, size = 14 }) =>
  s === "Positive" ? <Smile size={size} strokeWidth={2.25} /> : s === "Negative" ? <Frown size={size} strokeWidth={2.25} /> : <Meh size={size} strokeWidth={2.25} />;

export function Stat({ label, value, sub, color }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div className="eyebrow" style={{ marginBottom: 6 }}>{label}</div>
      {/* Montserrat 400 + tabular-nums (.display already sets both). */}
      <div className="display" style={{ fontSize: 26, lineHeight: 1, color: color || T.ink }}>{value}</div>
      {sub && <div style={{ color: T.sub, fontSize: 12, marginTop: 6, lineHeight: 1.45 }}>{sub}</div>}
    </div>
  );
}

export function RiskPill({ risk, escalated }) {
  const c = riskColor(risk, escalated);
  if (escalated) {
    return <Pill color={c}><Siren size={14} strokeWidth={2.25} /> Escalated</Pill>;
  }
  if (risk == null) return <span style={{ color: T.muted }}>—</span>;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span className="mono" style={{ fontWeight: 700, color: c, minWidth: 24, textAlign: "right" }}>{risk}</span>
      <span aria-hidden style={{ width: 44, height: 5, borderRadius: T.radiusSm, background: T.surfaceAlt, overflow: "hidden", display: "inline-block" }}>
        <span style={{ display: "block", width: `${Math.min(100, risk)}%`, height: "100%", background: c }} />
      </span>
      <span style={{ fontSize: 12, color: c, fontWeight: 600 }}>{riskLabel(risk)}</span>
    </span>
  );
}

/* Case owner. `assigned_to` is the CURRENT assignee, so on reassigned cases it is
 * not provably whoever handled the conversation being graded. */
export const AssigneeCell = ({ name }) => (
  <td style={{ ...tdStyle, color: T.sub, whiteSpace: "nowrap", maxWidth: 170, overflow: "hidden", textOverflow: "ellipsis" }}>
    {name || "Unassigned"}
  </td>
);

/** Shared expandable row: header cells + a detail panel (factors, quote, coaching). */
export function CaseRow({ g, cols, colSpan, open, onToggle }) {
  const toggle = (e) => { e.stopPropagation(); onToggle(); };
  return (
    <>
      <tr className="sentiment-row" onClick={onToggle} style={{ borderBottom: `1px solid ${T.borderSoft}` }}>
        {/* Accent as TEXT is accentDeep — T.accent is a fill role. (CopyableNumber
            then paints the case number itself in the ServiceNow reference tint.) */}
        <td className="mono" style={{ ...tdStyle, color: T.accentDeep, whiteSpace: "nowrap" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <button
              type="button"
              className="sentiment-expand"
              aria-expanded={open}
              aria-label={`${open ? "Collapse" : "Expand"} case ${g.number}: details`}
              onClick={toggle}
            >
              <ChevronRight size={14} strokeWidth={2.25} aria-hidden className="sentiment-chev" style={{ transform: open ? "rotate(90deg)" : "none" }} />
            </button>
            <span onClick={(e) => e.stopPropagation()}>
              <CopyableNumber value={g.number} />
            </span>
          </span>
        </td>
        {cols}
      </tr>
      {open && (
        <tr style={{ background: T.surfaceAlt }}>
          <td colSpan={colSpan} style={{ padding: "12px 16px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: 12, color: T.sub }}>
                <span className="eyebrow" style={{ marginRight: 8 }}>Account</span>{g.account || "—"}
                <span className="mono" style={{ marginLeft: 14, color: T.muted }}>
                  · {g.custMsgs ?? "?"} customer / {g.myMsgs ?? "?"} analyst msgs
                  {g.start != null && <> · tone {g.start} → {g.end ?? "—"}</>}
                </span>
              </div>
              {g.escReason && (
                <div style={{ fontSize: 12, color: T.danger, lineHeight: 1.5 }}>
                  <span className="eyebrow" style={{ color: T.danger, marginRight: 8 }}>Escalation</span>{g.escReason}
                </div>
              )}
              {g.riskFactors && (
                <div style={{ fontSize: 12, color: T.ink, lineHeight: 1.5 }}>
                  <span className="eyebrow" style={{ marginRight: 8 }}>Why flagged</span>{g.riskFactors}
                </div>
              )}
              {g.quote && (
                <blockquote style={{ margin: 0, paddingLeft: 12, borderLeft: `3px solid ${sentColor(g.sentiment)}`, color: T.ink, fontSize: 13, fontStyle: "italic", lineHeight: 1.5 }}>
                  “{g.quote}”
                </blockquote>
              )}
              {g.coachingNote && (
                <div style={{ fontSize: 12, color: T.ink, lineHeight: 1.5 }}>
                  <span className="eyebrow" style={{ marginRight: 8 }}>Notes</span>{g.coachingNote}
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function ShowMore({ total, expanded, onToggle, cap = 12 }) {
  if (total <= cap) return null;
  return (
    <button type="button" onClick={onToggle} style={{ marginTop: 10, background: "none", border: "none", color: T.accentDeep, cursor: "pointer", fontSize: 12, padding: "4px 2px" }}>
      {expanded ? "Show less" : `Show all ${total} cases`}
    </button>
  );
}

const STAGE_META = {
  open: { label: "Open", color: T.sub },
  solution_proposed: { label: "Solution proposed", color: T.accentDeep },
  closed: { label: "Closed", color: T.muted },
};

/**
 * The escalation-risk triage table. One implementation, three callers: the
 * Sentiment tab's early-warning view (every open case, ranked) and My Day's
 * analyst + manager escalation watch (only the at-risk tail).
 *
 * `rows` arrives already selected and ranked — this component decides nothing
 * about who is at risk, it only draws it.
 *
 * @param {object[]} rows graded cases, pre-ranked
 * @param {string} eyebrow small-caps header
 * @param {React.ReactNode} [note] explanatory line under the header
 * @param {boolean} [hideAssignee] drop the owner column (single-analyst views)
 * @param {boolean} [showStage] add an Open / Solution-proposed column — use it
 *   whenever the list mixes lifecycles, because for a Solution Proposed case
 *   the risk number is REOPEN risk, not escalation risk
 * @param {number} [cap] rows shown before "show all"
 */
export function EscalationRiskTable({
  rows, eyebrow, note, hideAssignee = false, showStage = false,
  cap = 12, ariaLabel = "Cases by escalation risk", bare = false,
}) {
  const [openCase, toggleCase] = useExpand();
  const [expanded, setExpanded] = useState(false);
  const visible = useMemo(() => (expanded ? rows : rows.slice(0, cap)), [rows, expanded, cap]);

  // Case + [stage] + [assignee] + priority + risk + waiting + signals + quote
  const colSpan = 5 + (hideAssignee ? 0 : 1) + (showStage ? 1 : 0);

  const body = (
    <>
      {!bare && (
        <>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 4 }}>
            <div className="eyebrow">{eyebrow}</div>
            <div className="mono" style={{ fontSize: 12, color: T.sub }}>{rows.length} cases</div>
          </div>
          {note && (
            <div style={{ color: T.sub, fontSize: 12, lineHeight: 1.5, marginBottom: 12, maxWidth: 720 }}>{note}</div>
          )}
        </>
      )}
      <div style={{ overflowX: "auto" }} className="scrollbar">
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }} aria-label={ariaLabel}>
          <thead>
            <tr style={{ background: T.surfaceAlt }}>
              <th style={thStyle()}>Case</th>
              {showStage && <th style={thStyle()}>Stage</th>}
              {!hideAssignee && <th style={thStyle()}>Assignee</th>}
              <th style={thStyle()}>Priority</th>
              <th style={thStyle()}>Risk</th>
              <th style={thStyle()}>Waiting</th>
              <th style={thStyle()}>Signals</th>
              <th style={thStyle()}>Last customer message</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((g) => {
              const stage = STAGE_META[g.lifecycle] || STAGE_META.open;
              return (
                <CaseRow
                  key={g.number}
                  g={g}
                  colSpan={colSpan}
                  open={openCase === g.number}
                  onToggle={() => toggleCase(g.number)}
                  cols={
                    <>
                      {showStage && (
                        <td style={{ ...tdStyle, whiteSpace: "nowrap", color: stage.color, fontSize: 12, fontWeight: 600 }}>
                          {stage.label}
                        </td>
                      )}
                      {!hideAssignee && <AssigneeCell name={g.assignee} />}
                      <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{g.priority || "—"}</td>
                      <td style={{ ...tdStyle, whiteSpace: "nowrap" }}><RiskPill risk={g.risk} escalated={g.escalated} /></td>
                      <td style={{ ...tdStyle, whiteSpace: "nowrap", color: T.sub, fontSize: 12 }}>
                        {g.unanswered > 0 && (
                          <span style={{ color: T.warn, display: "inline-flex", alignItems: "center", gap: 4, marginRight: 8 }}>
                            <MessageSquareWarning size={14} strokeWidth={2.25} /> {g.unanswered} unanswered
                          </span>
                        )}
                        {g.waitDays != null && g.waitDays >= 1 && (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                            <Clock size={14} strokeWidth={2.25} /> {g.waitDays}d
                          </span>
                        )}
                        {g.unanswered === 0 && (g.waitDays == null || g.waitDays < 1) && "—"}
                      </td>
                      <td style={{ ...tdStyle, color: T.sub, fontSize: 12, whiteSpace: "nowrap" }}>
                        {g.chases > 0 && <span style={{ marginRight: 8 }}>{g.chases} chase{g.chases > 1 ? "s" : ""}</span>}
                        {g.signals || (g.chases ? "" : "—")}
                      </td>
                      <td style={{ ...tdStyle, color: T.sub, maxWidth: 380, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {g.lastQuote || "—"}
                      </td>
                    </>
                  }
                />
              );
            })}
          </tbody>
        </table>
      </div>
      <ShowMore total={rows.length} expanded={expanded} onToggle={() => setExpanded((e) => !e)} cap={cap} />
    </>
  );

  // `bare` renders inside a Card the caller already owns (My Day's ListCard).
  if (bare) return <>{body}</>;
  return (
    <Card>
      <style>{SENTIMENT_STYLE}</style>
      {body}
    </Card>
  );
}
