import { useMemo, useState } from "react"
import { useOutletContext } from "react-router-dom"
import { AlertTriangle, Download, Timer } from "lucide-react"
import { T } from "../lib/theme.js"
import { fmtDuration, fmtFullDate, priorityColor } from "../lib/format.js"
import { useQuery } from "../lib/useQuery.js"
import { getSolutionProposedAutoClose } from "../lib/queries.js"
import { Section } from "../components/layout/Section.jsx"
import { Card } from "../components/layout/Card.jsx"
import { Pill } from "../components/Pill.jsx"
import { CopyableNumber } from "../components/CopyableNumber.jsx"
// SECURITY #7 — every exported cell passes through the formula-injection guard
// in csv-export.js before RFC-4180 quoting.
import { rowsToCsv, downloadCsv, csvTimestamp } from "../lib/csv-export.js"

const DAY = 24 * 60 * 60 * 1000

const TITLE = "Solution Proposed"
const SUBTITLE =
  "ServiceNow auto-closes Resolved cases 90 days after the resolution notes are saved if the customer never confirms. This is the countdown to that auto-close for the selected analyst, measured from when the case was resolved against the data-as-of snapshot below — system auto-close reminder notes are ignored. Solution Proposed cases no longer owe a recurring SOP cadence update — they're tracked here, not on the Update Queue.";

/* Urgency color for the time-remaining cell + summary buckets: danger when the
 * 90-day auto-close is within a week OR already elapsed against the snapshot,
 * warn within a month, normal otherwise, muted when we have no anchor. */
function urgencyColor(remainingMs) {
  if (remainingMs == null) return T.muted
  if (remainingMs <= 7 * DAY) return T.danger
  if (remainingMs <= 30 * DAY) return T.warn
  return T.ink
}

function remainingText(remainingMs) {
  if (remainingMs == null) return "—"
  if (remainingMs <= 0) return `${fmtDuration(Math.abs(remainingMs))} overdue`
  return fmtDuration(remainingMs)
}

const SORT_KEYS = {
  case: (r) => r.number || "",
  priority: (r) => (r.priorityRank == null ? null : r.priorityRank),
  account: (r) => (r.account || "").toLowerCase(),
  resolved: (r) => r.resolvedAtMs,
  autoCloses: (r) => r.autoCloseAtMs,
  remaining: (r) => r.remainingMs,
}

function sortRows(rows, key, dir) {
  const val = SORT_KEYS[key] || SORT_KEYS.remaining
  const copy = rows.slice()
  copy.sort((a, b) => {
    const av = val(a)
    const bv = val(b)
    // Nulls always sort last, regardless of direction.
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    const cmp = typeof av === "string" ? (av < bv ? -1 : av > bv ? 1 : 0) : av - bv
    return dir === "desc" ? -cmp : cmp
  })
  return copy
}

function exportCsv(rows, snapshotMs) {
  const headers = [
    "Case", "Priority", "Account", "Assignee", "Resolved",
    "Auto-closes", "Time remaining", "Days remaining", "State", "Status", "Description",
  ]
  const data = rows.map((r) => [
    r.number,
    r.priority || "",
    r.account || "",
    r.assignedTo || "Unassigned",
    r.resolvedAtMs == null ? "" : fmtFullDate(r.resolvedAtMs),
    r.autoCloseAtMs == null ? "" : fmtFullDate(r.autoCloseAtMs),
    remainingText(r.remainingMs),
    r.daysRemaining == null ? "" : r.daysRemaining.toFixed(1),
    r.state || "",
    r.status || "",
    r.shortDescription || "",
  ])
  const snapshotLabel = snapshotMs ? fmtFullDate(snapshotMs) : "unknown"
  const csv = [
    `# ${TITLE} auto-close — data as of ${snapshotLabel}`,
    "",
    rowsToCsv(headers, data),
  ].join("\r\n")
  downloadCsv(`solution-proposed-auto-close-${csvTimestamp()}.csv`, csv)
}

/* Route-level page: the Solution Proposed (state=Resolved) auto-close countdown,
 * scoped to the globally-selected analyst. Replaces the former cadence-overdue
 * reuse of the Update Queue (Solution Proposed cases no longer owe cadence
 * updates — see enrich.js v10). */
export default function SolutionProposedQueuePage() {
  const { analyst, manager, snapshotMs, dbReady } = useOutletContext()
  const enabled = !!(dbReady && snapshotMs)
  const { data, loading, error } = useQuery(
    () => getSolutionProposedAutoClose({ analyst, manager, snapshotMs }),
    [analyst, manager, snapshotMs],
    { enabled },
  )
  const [sort, setSort] = useState({ key: "remaining", dir: "asc" })

  // Sort client-side so the column headers work without re-querying. `data` is a
  // stable reference between renders (useQuery only swaps it on resolution), so
  // this recomputes only when the rows or the sort change.
  const sorted = useMemo(() => sortRows(data?.rows ?? [], sort.key, sort.dir), [data, sort])

  if (!enabled) {
    return (
      <Section title={TITLE} subtitle={SUBTITLE}>
        <Card>
          <div style={{ color: T.sub, fontSize: 13, fontStyle: "italic" }}>Loading data…</div>
        </Card>
      </Section>
    )
  }
  if (loading) {
    return (
      <Section title={TITLE}>
        <Card>
          <div style={{ color: T.sub, fontSize: 13 }}>Computing countdown…</div>
        </Card>
      </Section>
    )
  }
  if (error) {
    return (
      <Section title={TITLE}>
        <Card>
          <div style={{ color: T.danger, fontSize: 13 }}>
            <AlertTriangle size={14} style={{ verticalAlign: "middle", marginRight: 6 }} />
            {error?.message || "Failed to compute the auto-close countdown."}
          </div>
          <div style={{ color: T.sub, fontSize: 12, marginTop: 8 }}>
            If this import was created before the auto-close update, rebuild it from the Connections
            page (it will show a “Rebuild needed” badge) to populate the last-activity data.
          </div>
        </Card>
      </Section>
    )
  }
  if (!data) return null

  const { summary } = data

  return (
    <Section title={TITLE} subtitle={SUBTITLE}>
      {/* Summary counts + export */}
      <Card>
        <div style={{ display: "flex", alignItems: "baseline", gap: 24, flexWrap: "wrap" }}>
          <SummaryStat label="solution proposed" count={summary.total} accent={T.ink} />
          <SummaryStat label="closing within 7 days" count={summary.within7} accent={summary.within7 ? T.danger : T.ok} />
          <SummaryStat label="within 30 days" count={summary.within30} accent={summary.within30 ? T.warn : T.ok} />
          {summary.past > 0 && (
            <SummaryStat label="auto-close elapsed" count={summary.past} accent={T.danger} />
          )}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ fontSize: 11, color: T.muted }} className="mono">
              data as of {fmtFullDate(snapshotMs)}
            </div>
            <button
              onClick={() => exportCsv(sorted, snapshotMs)}
              disabled={!sorted.length}
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
                color: sorted.length ? T.ink : T.muted,
                cursor: sorted.length ? "pointer" : "not-allowed",
                whiteSpace: "nowrap",
              }}
            >
              <Download size={13} />
              Export CSV
            </button>
          </div>
        </div>
      </Card>

      {/* The countdown table */}
      <div style={{ marginTop: 12 }}>
        {sorted.length === 0 ? (
          <Card>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Timer size={15} color={T.ok} />
              <div className="eyebrow" style={{ color: T.muted }}>No Solution Proposed cases</div>
            </div>
            <div style={{ color: T.sub, fontSize: 13, fontStyle: "italic", marginTop: 10 }}>
              {analyst && analyst !== "__all__"
                ? `${analyst} has no cases awaiting customer confirmation.`
                : "No cases are currently awaiting customer confirmation."}
            </div>
          </Card>
        ) : (
          <Card>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <div>
                <div className="eyebrow" style={{ color: T.muted }}>
                  <Timer size={11} style={{ verticalAlign: "middle", marginRight: 4 }} />
                  Time until 90-day auto-close
                </div>
                <div style={{ color: T.sub, fontSize: 12, marginTop: 4, maxWidth: 720 }}>
                  Sorted soonest-to-close. Click a column header to re-sort.
                </div>
              </div>
              <div className="mono" style={{ fontSize: 12, color: T.muted, fontWeight: 600 }}>
                {sorted.length} case{sorted.length === 1 ? "" : "s"}
              </div>
            </div>

            <div style={{ marginTop: 12, overflowX: "auto" }} className="scrollbar">
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: T.surfaceAlt }}>
                    <SortHeader label="Case" sortKey="case" sort={sort} setSort={setSort} />
                    <SortHeader label="Priority" sortKey="priority" sort={sort} setSort={setSort} />
                    <SortHeader label="Account" sortKey="account" sort={sort} setSort={setSort} />
                    <SortHeader label="Resolved" sortKey="resolved" sort={sort} setSort={setSort} />
                    <SortHeader label="Auto-closes" sortKey="autoCloses" sort={sort} setSort={setSort} />
                    <SortHeader label="Time remaining" sortKey="remaining" sort={sort} setSort={setSort} />
                    <th style={thStyle}>Description</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r) => (
                    <tr key={r.number} style={{ borderBottom: `1px solid ${T.borderSoft}` }}>
                      <td className="mono" style={{ padding: "8px 12px", whiteSpace: "nowrap", fontWeight: 600 }}>
                        <CopyableNumber value={r.number} />
                      </td>
                      <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>
                        {r.priority ? <Pill color={priorityColor(r.priority)}>{r.priority}</Pill> : <span style={{ color: T.muted }}>—</span>}
                      </td>
                      <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>{r.account || "—"}</td>
                      <td className="mono" style={{ padding: "8px 12px", whiteSpace: "nowrap", color: T.sub }}>
                        {r.resolvedAtMs == null ? "—" : fmtFullDate(r.resolvedAtMs)}
                      </td>
                      <td className="mono" style={{ padding: "8px 12px", whiteSpace: "nowrap", color: T.sub }}>
                        {r.autoCloseAtMs == null ? "—" : fmtFullDate(r.autoCloseAtMs)}
                      </td>
                      <td className="mono" style={{ padding: "8px 12px", whiteSpace: "nowrap", color: urgencyColor(r.remainingMs), fontWeight: 600 }}>
                        {remainingText(r.remainingMs)}
                      </td>
                      <td style={{ padding: "8px 12px", maxWidth: 380, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {r.shortDescription || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </Section>
  )
}

function SummaryStat({ label, count, accent }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
      <span className="display mono" style={{ fontSize: 28, fontWeight: 500, color: accent, lineHeight: 1 }}>
        {count}
      </span>
      <span style={{ fontSize: 12, color: T.sub }}>{label}</span>
    </div>
  )
}

function SortHeader({ label, sortKey, sort, setSort }) {
  const active = sort.key === sortKey
  const toggle = () =>
    setSort((s) => ({ key: sortKey, dir: s.key === sortKey && s.dir === "asc" ? "desc" : "asc" }))
  return (
    <th
      style={thStyle}
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <span
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle() } }}
        style={{
          cursor: "pointer",
          userSelect: "none",
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          color: active ? T.ink : T.sub,
        }}
      >
        {label}
        <span aria-hidden style={{ fontSize: 9, opacity: active ? 1 : 0.3 }}>
          {active ? (sort.dir === "asc" ? "▲" : "▼") : "▲"}
        </span>
      </span>
    </th>
  )
}

const thStyle = {
  textAlign: "left",
  padding: "8px 12px",
  color: T.sub,
  fontWeight: 600,
  borderBottom: `1px solid ${T.borderSoft}`,
  whiteSpace: "nowrap",
}
