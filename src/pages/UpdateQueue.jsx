import { useState } from "react";
import { AlertTriangle, Clock } from "lucide-react";
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

/* ================= Update Queue (analyst-facing) ================= */
export function UpdateQueue({ analyst, snapshotMs, dbReady }) {
  const enabled = !!(dbReady && snapshotMs);
  const { data, loading, error } = useQuery(
    () => getUpdateQueue({ analyst, snapshotMs }),
    [analyst, snapshotMs],
    { enabled }
  );
  const [selected, setSelected] = useState(null);

  if (!enabled) {
    return (
      <Section title="Update Queue" subtitle="Open cases overdue for an Infor-authored customer-facing update, plus initial-response misses. SOP-driven, computed against the data-as-of snapshot below.">
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
      <Section title="Update Queue">
        <Card>
          <div style={{ color: T.sub, fontSize: 13 }}>Computing queue…</div>
        </Card>
      </Section>
    );
  }
  if (error) {
    return (
      <Section title="Update Queue">
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
      <Section title="Update Queue" subtitle="Open cases overdue for an Infor-authored customer-facing update, plus initial-response misses. SOP-driven, computed against the data-as-of snapshot below.">
        {/* Summary counts */}
        <Card>
          <div style={{ display: "flex", alignItems: "baseline", gap: 24, flexWrap: "wrap" }}>
            <SummaryStat label="overdue" count={summary.overdue} accent={T.danger} />
            <SummaryStat label="due soon" count={summary.dueSoon} accent={T.warn} />
            <SummaryStat
              label="missed initial response"
              count={summary.initialMisses}
              accent={summary.initialMisses ? T.danger : T.ok}
            />
            <div style={{ marginLeft: "auto", fontSize: 11, color: T.muted }} className="mono">
              data as of {fmtFullDate(snapshotMs)}
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

      <Section title="Initial Response Misses" subtitle="Open cases that have no first response logged AND have been open longer than the priority's initial-response target.">
        <InitialResponseList rows={initialResponseMisses} />
      </Section>
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

function QueueGroup({ title, subtitle, rows, tone, onPick, snapshotMs, emptyMsg }) {
  const headerColor = tone === "danger" ? T.danger : T.warn;
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
        <div className="mono" style={{ fontSize: 12, color: headerColor, fontWeight: 600 }}>
          {rows.length} case{rows.length === 1 ? "" : "s"}
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
            {rows.map((r) => (
              <tr
                key={r.number}
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
            ))}
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
