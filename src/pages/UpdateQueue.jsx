import { Fragment, useMemo, useState } from "react";
import { AlertTriangle, Clock, Download } from "lucide-react";
import { T } from "../lib/theme.js";
import { fmtDuration, fmtFullDate, priorityColor } from "../lib/format.js";
import { useQuery } from "../lib/useQuery.js";
import { getUpdateQueue } from "../lib/queries.js";
import { WARN_FRACTION } from "../lib/sop-thresholds.js";
import { Section } from "../components/layout/Section.jsx";
import { Card } from "../components/layout/Card.jsx";
import { Pill } from "../components/Pill.jsx";
import { CaseDrilldown } from "../components/CaseDrilldown.jsx";
import { CopyableNumber } from "../components/CopyableNumber.jsx";
// SECURITY #7 — rowsToCsv passes every exported cell through the formula-
// injection guard in csv-export.js before RFC-4180 quoting.
import { rowsToCsv, downloadCsv, csvTimestamp } from "../lib/csv-export.js";

function exportUpdateQueueCsv({
  overdue,
  dueSoon,
  initialResponseMisses,
  snapshotMs,
  title = "Update Queue",
  csvName = "open-case-update-que",
  showInitialResponse = true,
}) {
  const queueHeaders = ["Queue", "Case", "Type/Priority", "State", "Status", "Assignee", "Last Update", "Threshold", "Account", "Description"];
  const queueRows = [
    ...overdue.map((r) => [
      "Overdue",
      r.number,
      r.caseType === "development" ? "dev" : (r.priority || ""),
      r.state || "",
      r.status || "",
      r.assignedTo || "Unassigned",
      r.noInforUpdateYet ? "no analyst update yet" : `${fmtDuration(r.elapsedMs)} ago`,
      r.thresholdMs == null ? "" : fmtDuration(r.thresholdMs),
      r.account || "",
      r.shortDescription || "",
    ]),
    ...dueSoon.map((r) => [
      "Due Soon",
      r.number,
      r.caseType === "development" ? "dev" : (r.priority || ""),
      r.state || "",
      r.status || "",
      r.assignedTo || "Unassigned",
      r.noInforUpdateYet ? "no analyst update yet" : `${fmtDuration(r.elapsedMs)} ago`,
      r.thresholdMs == null ? "" : fmtDuration(r.thresholdMs),
      r.account || "",
      r.shortDescription || "",
    ]),
  ];

  const irHeaders = ["Case", "Priority", "State", "Status", "Assignee", "Age", "Target", "Account", "Description"];
  const irRows = initialResponseMisses.map((r) => [
    r.number,
    r.priority || "",
    r.state || "",
    r.status || "",
    r.assignedTo || "Unassigned",
    fmtDuration(r.ageMs),
    fmtDuration(r.targetMs),
    r.account || "",
    r.shortDescription || "",
  ]);

  const snapshotLabel = snapshotMs ? fmtFullDate(snapshotMs) : "unknown";
  const parts = [
    `# ${title} export — data as of ${snapshotLabel}`,
    "",
    "## Overdue & Due Soon",
    rowsToCsv(queueHeaders, queueRows),
  ];
  if (showInitialResponse) {
    parts.push("", "## Initial Response Misses", rowsToCsv(irHeaders, irRows));
  }
  const csv = parts.join("\r\n");
  downloadCsv(`${csvName}-${csvTimestamp()}.csv`, csv);
}

/* ================= Update Queue (analyst-facing) =================
 * Generalized so a second tab (Solution Proposed) can reuse the exact same
 * cadence logic and look-and-feel. Props default to the original Update Queue
 * behavior; pass `statusEquals` to scope the queue to a ServiceNow `status`,
 * and `showInitialResponse={false}` to drop the IR section + its summary stat. */
const DEFAULT_SUBTITLE =
  "Open cases overdue for an Infor-authored customer-facing update, plus initial-response misses. SOP-driven, computed against the data-as-of snapshot below.";

export function UpdateQueue({
  analyst,
  snapshotMs,
  dbReady,
  statusEquals = null,
  includeClosed = false,
  title = "Update Queue",
  subtitle = DEFAULT_SUBTITLE,
  showInitialResponse = true,
  csvName = "open-case-update-que",
}) {
  const enabled = !!(dbReady && snapshotMs);
  const { data, loading, error } = useQuery(
    () => getUpdateQueue({ analyst, snapshotMs, statusEquals, includeClosed }),
    [analyst, snapshotMs, statusEquals, includeClosed],
    { enabled }
  );
  const [selected, setSelected] = useState(null);

  if (!enabled) {
    return (
      <Section title={title} subtitle={subtitle}>
        <Card>
          <div style={{ color: T.sub, fontSize: 13, fontStyle: "italic" }}>
            Loading data…
          </div>
        </Card>
      </Section>
    );
  }
  if (loading) {
    return (
      <Section title={title}>
        <Card>
          <div style={{ color: T.sub, fontSize: 13 }}>Computing queue…</div>
        </Card>
      </Section>
    );
  }
  if (error) {
    return (
      <Section title={title}>
        <Card>
          <div style={{ color: T.danger, fontSize: 13 }}>
            <AlertTriangle size={14} style={{ verticalAlign: "middle", marginRight: 6 }} />
            {error?.message || "Failed to compute the queue."}
          </div>
        </Card>
      </Section>
    );
  }
  if (!data) return null;

  const { overdue, dueSoon, initialResponseMisses, summary } = data;

  return (
    <>
      <Section title={title} subtitle={subtitle}>
        {/* Summary counts */}
        <Card>
          <div style={{ display: "flex", alignItems: "baseline", gap: 24, flexWrap: "wrap" }}>
            <SummaryStat label="overdue" count={summary.overdue} accent={T.danger} />
            <SummaryStat label="due soon" count={summary.dueSoon} accent={T.warn} />
            {showInitialResponse && (
              <SummaryStat
                label="missed initial response"
                count={summary.initialMisses}
                accent={summary.initialMisses ? T.danger : T.ok}
              />
            )}
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 16 }}>
              <div style={{ fontSize: 11, color: T.muted }} className="mono">
                data as of {fmtFullDate(snapshotMs)}
              </div>
              <button
                onClick={() => exportUpdateQueueCsv({ overdue, dueSoon, initialResponseMisses, snapshotMs, title, csvName, showInitialResponse })}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12,
                  fontWeight: 600,
                  padding: "5px 12px",
                  borderRadius: 6,
                  border: `1px solid ${T.border}`,
                  background: T.surface,
                  color: T.ink,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                <Download size={13} />
                Export CSV
              </button>
            </div>
          </div>
        </Card>

        {/* Overdue + Due Soon */}
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>
          <QueueGroup
            title="Overdue"
            subtitle="Past their SOP cadence. Update with a customer-facing comment now."
            rows={overdue}
            tone="danger"
            onPick={setSelected}
            snapshotMs={snapshotMs}
            emptyMsg="No overdue cases. Nice."
          />
          <QueueGroup
            title="Due Soon"
            subtitle={`Within the final ${Math.round((1 - WARN_FRACTION) * 100)}% of the cadence deadline. A nudge, not a breach.`}
            rows={dueSoon}
            tone="warn"
            onPick={setSelected}
            snapshotMs={snapshotMs}
            emptyMsg="Nothing due soon."
          />
        </div>

        {selected && (
          <CaseDrilldown
            title={`Case ${selected.number}`}
            rows={[caseAsDrilldownRow(selected)]}
            onClose={() => setSelected(null)}
          />
        )}
      </Section>

      {showInitialResponse && (
        <Section title="Initial Response Misses" subtitle="Open cases that have no first response logged AND have been open longer than the priority's initial-response target.">
          <InitialResponseList rows={initialResponseMisses} />
        </Section>
      )}
    </>
  );
}

function SummaryStat({ label, count, accent }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
      <span className="display mono" style={{ fontSize: 28, fontWeight: 500, color: accent, lineHeight: 1 }}>
        {count}
      </span>
      <span style={{ fontSize: 12, color: T.sub }}>{label}</span>
    </div>
  );
}

const SORT_OPTIONS = [
  { value: "elapsed-desc", label: "Last update · longest ago" },
  { value: "elapsed-asc",  label: "Last update · most recent" },
  { value: "assignee",     label: "Group by assignee" },
];

function sortQueueRows(rows, mode) {
  const elapsedOf = (r) => (r.noInforUpdateYet ? Number.POSITIVE_INFINITY : (r.elapsedMs ?? 0));
  const assigneeOf = (r) => (r.assignedTo || "￿Unassigned").toLowerCase();
  const copy = rows.slice();
  if (mode === "elapsed-asc") {
    copy.sort((a, b) => elapsedOf(a) - elapsedOf(b));
  } else if (mode === "assignee") {
    copy.sort((a, b) => {
      const ax = assigneeOf(a), bx = assigneeOf(b);
      if (ax !== bx) return ax < bx ? -1 : 1;
      return elapsedOf(b) - elapsedOf(a);
    });
  } else {
    copy.sort((a, b) => elapsedOf(b) - elapsedOf(a));
  }
  return copy;
}

function QueueGroup({ title, subtitle, rows, tone, onPick, emptyMsg }) {
  const headerColor = tone === "danger" ? T.danger : T.warn;
  const [sortMode, setSortMode] = useState("elapsed-desc");
  const sortedRows = useMemo(() => sortQueueRows(rows, sortMode), [rows, sortMode]);
  if (rows.length === 0) {
    return (
      <Card>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <div>
            <div className="eyebrow" style={{ color: T.muted }}>{title}</div>
            {subtitle && <div style={{ color: T.sub, fontSize: 12, marginTop: 4 }}>{subtitle}</div>}
          </div>
          <div className="mono" style={{ fontSize: 12, color: T.muted, fontWeight: 600 }}>0 cases</div>
        </div>
        <div style={{ color: T.sub, fontSize: 13, fontStyle: "italic", marginTop: 12 }}>{emptyMsg}</div>
      </Card>
    );
  }
  return (
    <Card>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div>
          <div className="eyebrow" style={{ color: headerColor }}>{title}</div>
          {subtitle && <div style={{ color: T.sub, fontSize: 12, marginTop: 4, maxWidth: 720 }}>{subtitle}</div>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: T.sub }}>
            <span className="eyebrow" style={{ color: T.muted }}>Sort</span>
            <select
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value)}
              style={{
                fontSize: 12,
                padding: "4px 8px",
                border: `1px solid ${T.border}`,
                borderRadius: 6,
                background: T.surface,
                color: T.ink,
                cursor: "pointer",
              }}
            >
              {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <div className="mono" style={{ fontSize: 12, color: headerColor, fontWeight: 600 }}>
            {rows.length} case{rows.length === 1 ? "" : "s"}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 12, overflowX: "auto" }} className="scrollbar">
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: T.surfaceAlt }}>
              <th style={thStyle}>Case</th>
              <th style={thStyle}>Type / Priority</th>
              <th style={thStyle}>State</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Assignee</th>
              <th style={thStyle}>Last update</th>
              <th style={thStyle}>Threshold</th>
              <th style={thStyle}>Account</th>
              <th style={thStyle}>Description</th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((r, i) => {
              const prev = i > 0 ? sortedRows[i - 1] : null;
              const showAssigneeHeader =
                sortMode === "assignee" &&
                (!prev || (prev.assignedTo || "Unassigned") !== (r.assignedTo || "Unassigned"));
              return (
              <Fragment key={r.number}>
              {showAssigneeHeader && (
                <tr style={{ background: T.surfaceSunk }}>
                  <td colSpan={9} style={{ padding: "6px 12px", fontSize: 11, fontWeight: 600, color: T.sub, letterSpacing: 0.4, textTransform: "uppercase" }}>
                    {r.assignedTo || "Unassigned"}
                  </td>
                </tr>
              )}
              <tr
                onClick={() => onPick(r)}
                className="hoverlift"
                style={{ borderBottom: `1px solid ${T.borderSoft}`, cursor: "pointer" }}
              >
                <td className="mono" style={{ padding: "8px 12px", whiteSpace: "nowrap", fontWeight: 600, color: T.accent }}>
                  <CopyableNumber value={r.number} />
                </td>
                <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>
                  {r.caseType === "development" ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <Pill color={T.accent}>dev</Pill>
                      {r.jiraCheckRecommended && <Pill color={T.warn}>jira check</Pill>}
                    </span>
                  ) : (
                    <span style={{ color: priorityColor(r.priority), fontWeight: 600 }}>{r.priority || "—"}</span>
                  )}
                </td>
                <td style={{ padding: "8px 12px", whiteSpace: "nowrap", color: T.ink }}>{r.state || "—"}</td>
                <td style={{ padding: "8px 12px", whiteSpace: "nowrap", color: T.sub }}>{r.status || "—"}</td>
                <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>{r.assignedTo || "Unassigned"}</td>
                <td className="mono" style={{ padding: "8px 12px", whiteSpace: "nowrap", color: tone === "danger" ? T.danger : T.warn }}>
                  {r.noInforUpdateYet ? (
                    <em style={{ color: T.muted, fontStyle: "italic" }}>no analyst update yet</em>
                  ) : (
                    `${fmtDuration(r.elapsedMs)} ago`
                  )}
                </td>
                <td className="mono" style={{ padding: "8px 12px", whiteSpace: "nowrap", color: T.sub }}>
                  {r.thresholdMs == null ? "—" : fmtDuration(r.thresholdMs)}
                </td>
                <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>{r.account || "—"}</td>
                <td style={{ padding: "8px 12px", maxWidth: 380, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.shortDescription || "—"}
                </td>
              </tr>
              </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function InitialResponseList({ rows }) {
  if (rows.length === 0) {
    return (
      <Card>
        <div style={{ color: T.sub, fontSize: 13, fontStyle: "italic" }}>
          No initial-response misses. Every open case has either responded already or is still inside its target window.
        </div>
      </Card>
    );
  }
  return (
    <Card>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div className="eyebrow" style={{ color: T.danger }}>
          <Clock size={11} style={{ verticalAlign: "middle", marginRight: 4 }} />
          Missed initial response
        </div>
        <div className="mono" style={{ fontSize: 12, color: T.danger, fontWeight: 600 }}>
          {rows.length} case{rows.length === 1 ? "" : "s"}
        </div>
      </div>
      <div style={{ marginTop: 12, overflowX: "auto" }} className="scrollbar">
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: T.surfaceAlt }}>
              <th style={thStyle}>Case</th>
              <th style={thStyle}>Priority</th>
              <th style={thStyle}>State</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Assignee</th>
              <th style={thStyle}>Age</th>
              <th style={thStyle}>Target</th>
              <th style={thStyle}>Account</th>
              <th style={thStyle}>Description</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.number} style={{ borderBottom: `1px solid ${T.borderSoft}` }}>
                <td className="mono" style={{ padding: "8px 12px", whiteSpace: "nowrap", fontWeight: 600, color: T.accent }}>
                  <CopyableNumber value={r.number} />
                </td>
                <td style={{ padding: "8px 12px", whiteSpace: "nowrap", color: priorityColor(r.priority), fontWeight: 600 }}>
                  {r.priority || "—"}
                </td>
                <td style={{ padding: "8px 12px", whiteSpace: "nowrap", color: T.ink }}>{r.state || "—"}</td>
                <td style={{ padding: "8px 12px", whiteSpace: "nowrap", color: T.sub }}>{r.status || "—"}</td>
                <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>{r.assignedTo || "Unassigned"}</td>
                <td className="mono" style={{ padding: "8px 12px", whiteSpace: "nowrap", color: T.danger }}>{fmtDuration(r.ageMs)}</td>
                <td className="mono" style={{ padding: "8px 12px", whiteSpace: "nowrap", color: T.sub }}>{fmtDuration(r.targetMs)}</td>
                <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>{r.account || "—"}</td>
                <td style={{ padding: "8px 12px", maxWidth: 380, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.shortDescription || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

const thStyle = {
  textAlign: "left",
  padding: "8px 12px",
  color: T.sub,
  fontWeight: 600,
  borderBottom: `1px solid ${T.borderSoft}`,
  whiteSpace: "nowrap",
};

// Reshape a queue row into the shape CaseDrilldown expects (underscore-prefixed
// fields). One row at a time, since the drilldown can also list many.
function caseAsDrilldownRow(r) {
  return {
    number: r.number,
    assigned_to: r.assignedTo,
    priority: r.priority,
    account: r.account,
    _created: r.createdAt,
    short_description: r.shortDescription,
  };
}
