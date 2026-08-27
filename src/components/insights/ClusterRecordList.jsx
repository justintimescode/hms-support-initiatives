import { Fragment, useState } from "react";
import { ChevronRight } from "lucide-react";
import { T, alpha } from "../../lib/theme.js";
import { priorityColor } from "../../lib/format.js";
import { CopyableNumber } from "../CopyableNumber.jsx";
import { AliasNote } from "../AliasNote.jsx";

/* Drill-down record lists for the Operations view — the bottom of every
 * click-through. Two tables, one for cases and one for Jira issues.
 *
 * WHY NOT `CaseDrilldown`: it re-derives the Age column from the wall clock
 * (`format.js` `ageDays` calls Date.now()) and expects raw enriched rows
 * (`r._created`, `r.assigned_to`). Reusing it here would put a wall-clocked
 * number next to a page full of snapshot-anchored ones — a visible discrepancy
 * on any import older than today, in the one view whose whole premise is that
 * the same import always renders identically. These lists read the already
 * anchored projections instead. Everything else on this page reuses the existing
 * primitives (Card, Pill, CopyableNumber, the T tokens).
 *
 * Both tables are read-only, so there is no keyboard-interaction gap to close:
 * nothing here is clickable except the Jira link, which is a real anchor. */

const JIRA_BROWSE_URL = "https://infor.atlassian.net/browse/";

const TH = {
  textAlign: "left",
  padding: "8px 12px",
  color: T.sub,
  fontWeight: 600,
  whiteSpace: "nowrap",
  borderBottom: `1px solid ${T.borderSoft}`,
};
const TD = { padding: "8px 12px", whiteSpace: "nowrap", verticalAlign: "top" };

function Shell({ title, count, noun, onClose, children }) {
  return (
    <div style={{ marginTop: 12, border: `1px solid ${T.border}`, borderRadius: 4, background: T.surface }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: `1px solid ${T.borderSoft}`, background: T.surfaceAlt }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span className="eyebrow" style={{ color: T.accent }}>{title}</span>
          <span className="mono" style={{ fontSize: 12, color: T.sub }}>
            {count} {noun}{count === 1 ? "" : "s"}
          </span>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", color: T.sub, cursor: "pointer", fontSize: 13, padding: 4 }}
            aria-label={`Close ${title}`}
          >
            ✕
          </button>
        )}
      </div>
      <div style={{ maxHeight: 360, overflowY: "auto" }} className="scrollbar">
        {children}
      </div>
    </div>
  );
}

/** The `<table>` of case rows, with no `Shell` chrome — shared by `CaseRecordList`
 *  and by `JiraCasesRecordList`'s expanded rows, so the two never drift apart on
 *  columns or formatting. */
function CaseTable({ cases, highlight }) {
  const rows = cases || [];
  const hot = new Set(highlight || []);
  if (rows.length === 0) {
    return <div style={{ padding: "16px 14px", color: T.muted, fontSize: 13 }}>No cases here.</div>;
  }
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
      <thead>
        <tr style={{ background: T.surface, position: "sticky", top: 0 }}>
          <th style={TH}>Case</th>
          <th style={TH}>Account</th>
          <th style={TH}>Analyst</th>
          <th style={TH}>Priority</th>
          <th style={TH}>State</th>
          <th style={{ ...TH, textAlign: "right" }}>Age</th>
          <th style={{ ...TH, textAlign: "right" }}>Days linked</th>
          <th style={{ ...TH, textAlign: "right" }}>Risk</th>
          <th style={TH}>Description</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((c) => (
          <tr
            key={c.number}
            style={{
              borderBottom: `1px solid ${T.borderSoft}`,
              background: hot.has(c.number) ? alpha(T.accent, 0.05) : "transparent",
            }}
          >
            <td className="mono" style={{ ...TD, fontWeight: 600 }}>
              <CopyableNumber value={c.number} />
            </td>
            <td style={TD}>{c.account || "—"}</td>
            <td style={TD}>{c.assignedTo || "Unassigned"}</td>
            <td style={TD}>
              <span style={{ color: priorityColor(c.priority || ""), fontWeight: 600 }}>{c.priority || "—"}</span>
            </td>
            <td style={TD}>
              {/* Three-state lifecycle: Solution Proposed is neither open nor closed. */}
              {c.lifecycle === "solution_proposed" ? "Solution proposed" : c.isClosed ? "Closed" : "Open"}
              {c.slaBreached && (
                <span style={{ color: T.danger, marginLeft: 6, fontSize: 11 }} title={`SOP SLA breached (${c.slaBreachReason || "cadence"})`}>
                  SLA
                </span>
              )}
            </td>
            <td className="mono" style={{ ...TD, textAlign: "right", color: c.ageDays != null && c.ageDays > 30 ? T.danger : T.sub }}>
              {c.ageDays == null ? "—" : `${c.ageDays}d`}
            </td>
            <td className="mono" style={{ ...TD, textAlign: "right", color: T.sub }}>
              {/* null = no System "Jira Reference ID … linked" note. */}
              {c.daysLinked == null ? <span style={{ color: T.muted }}>Not linked</span> : `${c.daysLinked}d`}
            </td>
            <td className="mono" style={{ ...TD, textAlign: "right" }} title={c.sentimentQuote || ""}>
              {c.sentimentRisk == null ? <span style={{ color: T.muted }}>—</span> : c.sentimentRisk}
              {c.sentimentEscalated && <span style={{ color: T.danger, marginLeft: 5 }} title={c.sentimentEscReason || "Escalation event"}>!</span>}
            </td>
            <td style={{ ...TD, maxWidth: 340, overflow: "hidden", textOverflow: "ellipsis" }}>
              {c.shortDescription || "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Cases behind an aggregate. Ages and "days linked" are already anchored to the
 *  import — `daysLinked` renders "Not linked" for null, never a fake 0. */
export function CaseRecordList({ title = "Cases", cases, onClose, highlight }) {
  const rows = cases || [];
  return (
    <Shell title={title} count={rows.length} noun="case" onClose={onClose}>
      <CaseTable cases={rows} highlight={highlight} />
    </Shell>
  );
}

/** Jira issues behind an aggregate. A key with no live issue says so rather than
 *  rendering blanks that read as "no data exists". */
export function JiraRecordList({ title = "Jira tickets", jira, onClose }) {
  const rows = jira || [];
  return (
    <Shell title={title} count={rows.length} noun="ticket" onClose={onClose}>
      {rows.length === 0 ? (
        <div style={{ padding: "16px 14px", color: T.muted, fontSize: 13 }}>No tickets here.</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: T.surface, position: "sticky", top: 0 }}>
              <th style={TH}>Key</th>
              <th style={TH}>Summary</th>
              <th style={TH}>Status</th>
              <th style={TH}>Priority</th>
              <th style={TH}>Assignee</th>
              <th style={{ ...TH, textAlign: "right" }}>Age</th>
              <th style={{ ...TH, textAlign: "right" }}>Idle</th>
              <th style={TH}>Fix versions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((j) => (
              <tr key={j.key} style={{ borderBottom: `1px solid ${T.borderSoft}` }}>
                <td className="mono" style={{ ...TD, fontWeight: 600 }}>
                  {j.isAtlassian ? (
                    <a href={JIRA_BROWSE_URL + j.key} target="_blank" rel="noopener noreferrer" style={{ color: T.jiraBlue, textDecoration: "none" }}>
                      {j.key}
                    </a>
                  ) : (
                    <span style={{ color: T.jiraBlue }} title="ServiceNow Resolution Notes reference — a real engineering link, but not an Atlassian ticket">
                      {j.key}
                    </span>
                  )}
                  <AliasNote keys={j.aliasedFrom} />
                </td>
                <td style={{ ...TD, maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {j.hasLive ? (j.summary || "—") : (
                    <span style={{ color: T.muted, fontStyle: "italic" }}>
                      {j.isAtlassian ? "not in the synced project" : "ServiceNow-internal reference"}
                    </span>
                  )}
                </td>
                <td style={TD}>{j.status || "—"}</td>
                <td style={TD}>{j.priority || "—"}</td>
                <td style={TD}>{j.assignee || "—"}</td>
                <td className="mono" style={{ ...TD, textAlign: "right", color: T.sub }}>
                  {j.ageDays == null ? "—" : `${j.ageDays}d`}
                </td>
                <td className="mono" style={{ ...TD, textAlign: "right", color: j.isStale ? T.warn : T.sub }}>
                  {j.daysSinceUpdate == null ? "—" : `${j.daysSinceUpdate}d`}
                </td>
                <td style={TD}>{(j.fixVersions || []).join(", ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Shell>
  );
}

/** Jira tickets behind an aggregate, each expandable to the ServiceNow cases
 *  actually linked to THAT key (via `blockersByJira` rows — see insight-rank.js).
 *  Jira is the lead entity here rather than the case, because a heatmap cell full
 *  of cases attached to one hot ticket should read as "one ticket, N cases", not
 *  as a flat list that hides the concentration. */
export function JiraCasesRecordList({ title = "Jira tickets", rows, onClose }) {
  const list = rows || [];
  const [expanded, setExpanded] = useState(() => new Set(list.length === 1 ? [list[0].key] : []));

  const toggle = (key) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <Shell title={title} count={list.length} noun="ticket" onClose={onClose}>
      {list.length === 0 ? (
        <div style={{ padding: "16px 14px", color: T.muted, fontSize: 13 }}>No tickets here.</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: T.surface, position: "sticky", top: 0 }}>
              <th style={{ ...TH, width: 22 }} />
              <th style={TH}>Key</th>
              <th style={TH}>Summary</th>
              <th style={TH}>Status</th>
              <th style={TH}>Priority</th>
              <th style={TH}>Assignee</th>
              <th style={{ ...TH, textAlign: "right" }}>Age</th>
              <th style={{ ...TH, textAlign: "right" }}>Idle</th>
              <th style={{ ...TH, textAlign: "right" }}>Cases</th>
            </tr>
          </thead>
          <tbody>
            {list.map((row) => {
              const j = row.jira;
              const isOpen = expanded.has(row.key);
              const openCases = row.metrics?.volume?.openCases ?? 0;
              return (
                <Fragment key={row.key}>
                  <tr
                    onClick={() => toggle(row.key)}
                    style={{ borderBottom: isOpen ? "none" : `1px solid ${T.borderSoft}`, cursor: "pointer" }}
                  >
                    <td style={{ ...TD, textAlign: "center" }}>
                      <ChevronRight
                        size={13}
                        style={{ color: T.sub, transform: isOpen ? "rotate(90deg)" : "none", transition: "transform 120ms" }}
                      />
                    </td>
                    <td className="mono" style={{ ...TD, fontWeight: 600 }}>
                      {j.isAtlassian ? (
                        <a
                          href={JIRA_BROWSE_URL + j.key}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          style={{ color: T.jiraBlue, textDecoration: "none" }}
                        >
                          {j.key}
                        </a>
                      ) : (
                        <span style={{ color: T.jiraBlue }} title="ServiceNow Resolution Notes reference — a real engineering link, but not an Atlassian ticket">
                          {j.key}
                        </span>
                      )}
                      <AliasNote keys={j.aliasedFrom} />
                    </td>
                    <td style={{ ...TD, maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis" }}>
                      {j.hasLive ? (j.summary || "—") : (
                        <span style={{ color: T.muted, fontStyle: "italic" }}>
                          {j.isAtlassian ? "not in the synced project" : "ServiceNow-internal reference"}
                        </span>
                      )}
                    </td>
                    <td style={TD}>{j.status || "—"}</td>
                    <td style={TD}>{j.priority || "—"}</td>
                    <td style={TD}>{j.assignee || "—"}</td>
                    <td className="mono" style={{ ...TD, textAlign: "right", color: T.sub }}>
                      {j.ageDays == null ? "—" : `${j.ageDays}d`}
                    </td>
                    <td className="mono" style={{ ...TD, textAlign: "right", color: j.isStale ? T.warn : T.sub }}>
                      {j.daysSinceUpdate == null ? "—" : `${j.daysSinceUpdate}d`}
                    </td>
                    <td className="mono" style={{ ...TD, textAlign: "right", fontWeight: 600 }}>
                      {row.cases.length}
                      {openCases > 0 && <span style={{ color: T.sub, fontWeight: 400 }}> ({openCases} open)</span>}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr style={{ borderBottom: `1px solid ${T.borderSoft}` }}>
                      <td colSpan={9} style={{ padding: "0 0 8px 30px", background: T.surfaceAlt }}>
                        <CaseTable cases={row.cases} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </Shell>
  );
}
