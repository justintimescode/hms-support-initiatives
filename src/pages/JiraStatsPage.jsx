import React, { useMemo, useState } from "react"
import { useOutletContext } from "react-router-dom"
import {
  ComposedChart, BarChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts"
import { AlertTriangle } from "lucide-react"
import { T } from "../lib/theme.js"
import { fmtDuration, priorityColor, fmtFullDateTime } from "../lib/format.js"
import { fetchIssueDetail } from "../lib/jira-client.js"
import {
  jiraSummary, issueTypeMix, componentBreakdown, labelBreakdown, breakdownBy,
  cycleLeadStats, agingBuckets, statusMix,
} from "../lib/jira-enrich.js"
import {
  createdWithin, dailyCreation, weeklyCreatedResolved, weekdayCounts,
  blastRadius, blastRadiusSummary, openCasesHistogram,
  resolutionStatsByPriority, staleWithImpact, fixVersionPipeline,
} from "../lib/jira-stats.js"
import { Section } from "../components/layout/Section.jsx"
import { Card } from "../components/layout/Card.jsx"
import { EmptyState } from "../components/EmptyState.jsx"
import { JiraKpiCard, JiraSyncControls, JiraIssueDetail } from "../components/jira/JiraAnalysisBlock.jsx"
import { CopyableNumber } from "../components/CopyableNumber.jsx"

// Page-local fixed window for the "Composition" section. NOT the global filter
// — the user wants a stable recent-mix snapshot. Change here to retune.
const COMPOSITION_WINDOW_DAYS = 14

export default function JiraStatsPage() {
  const { jiraState, syncJira, rows, enrichedAllJoined } = useOutletContext()
  const issues = useMemo(() => jiraState?.issues || [], [jiraState?.issues])
  const ready = jiraState?.status === "ready" && issues.length > 0
  const jiraIssueMap = useMemo(() => {
    const m = new Map()
    for (const it of issues) m.set(it.key, it)
    return m
  }, [issues])
  // Blast radius is shared by the cross-source section and the lifecycle
  // section (stale-with-impact, fix-version impact). Computed once here.
  const blast = useMemo(
    () => (rows ? blastRadius(enrichedAllJoined, jiraIssueMap).filter((b) => b.openCount > 0) : []),
    [rows, enrichedAllJoined, jiraIssueMap],
  )

  if (!ready) {
    return (
      <Section title="Jira Statistics">
        <EmptyState
          title="No Jira data yet"
          message="Sync the HMS project from Connections to see project statistics, volume trends, and which Jira tickets are driving the most open ServiceNow cases."
        />
      </Section>
    )
  }

  return (
    <Section
      title="Jira Statistics"
      subtitle="The big picture for the HMS Jira project: how much work is coming in, what kind, and — on the cross-source view — which tickets are causing the most customer pain. This whole page covers the synced project and is not affected by the analyst selector."
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <span style={{ fontSize: 12, color: T.muted }}>
          {jiraState.meta?.fetchedAt ? <>Data as of <span style={{ color: T.sub }}>{fmtFullDateTime(jiraState.meta.fetchedAt)}</span></> : "Live project data"}
        </span>
        <JiraSyncControls meta={jiraState.meta} onSync={syncJira} />
      </div>

      <KpiStrip issues={issues} />
      <CreationVolume issues={issues} />
      <Composition issues={issues} />
      <CrossSource blast={blast} hasSn={!!rows} />
      <Lifecycle issues={issues} blast={blast} hasSn={!!rows} />
    </Section>
  )
}

/* --------------------- cross-source: blast radius ------------------------ */

const BLAST_TOP_N = 25
const STALE_DAYS = 30

function CrossSource({ blast, hasSn }) {
  const summary = useMemo(() => blastRadiusSummary(blast, STALE_DAYS), [blast])
  const histo = useMemo(() => openCasesHistogram(blast), [blast])

  const [sort, setSort] = useState({ key: "openCount", dir: "desc" })
  const [showAll, setShowAll] = useState(false)
  const [expanded, setExpanded] = useState(null)
  const [details, setDetails] = useState({})

  const heading = (
    <>
      <div className="eyebrow" style={{ color: T.muted, marginTop: 32, marginBottom: 4 }}>Blast radius · open ServiceNow cases per Jira</div>
      <div style={{ color: T.sub, fontSize: 12, marginBottom: 12 }}>
        Which Jira tickets are gating the most open customer cases right now. Counts use the live case register — not affected by the date filter.
      </div>
    </>
  )

  if (!hasSn) {
    return (
      <div>
        {heading}
        <Card style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <AlertTriangle size={16} style={{ color: T.warn }} />
          <span style={{ fontSize: 13, color: T.sub }}>
            Blast radius needs ServiceNow cases. Upload a case export on the Connections page to see which Jiras are driving open cases.
          </span>
        </Card>
      </div>
    )
  }

  if (blast.length === 0) {
    return (
      <div>
        {heading}
        <Card><div style={{ color: T.sub, fontSize: 13, fontStyle: "italic" }}>No open ServiceNow cases currently reference a Jira ticket.</div></Card>
      </div>
    )
  }

  const sorted = [...blast].sort((a, b) => {
    const dir = sort.dir === "asc" ? 1 : -1
    const av = a[sort.key], bv = b[sort.key]
    if (av == null) return 1
    if (bv == null) return -1
    if (typeof av === "string") return av.localeCompare(bv) * dir
    return (av - bv) * dir
  })
  const visible = showAll ? sorted : sorted.slice(0, BLAST_TOP_N)

  const toggleSort = (key) =>
    setSort((s) => s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" })

  const expandRow = (b) => {
    setExpanded((cur) => (cur === b.key ? null : b.key))
    // Only live Jiras have a fetchable description; RN-/unsynced keys just show
    // their linked-case list.
    if (b.hasLive && !details[b.key]) {
      setDetails((cur) => ({ ...cur, [b.key]: { loading: true } }))
      fetchIssueDetail(b.key)
        .then((res) => setDetails((cur) => ({ ...cur, [b.key]: { html: res.descriptionHtml } })))
        .catch((err) => setDetails((cur) => ({ ...cur, [b.key]: { error: err?.message || "fetch failed" } })))
    }
  }

  const cols = [
    { key: "key", label: "Key", align: "left" },
    { key: "summary", label: "Summary", align: "left" },
    { key: "issueType", label: "Type", align: "left" },
    { key: "priority", label: "Priority", align: "left" },
    { key: "status", label: "Status", align: "left" },
    { key: "openCount", label: "Open cases", align: "right" },
    { key: "totalCount", label: "Total", align: "right" },
    { key: "daysSinceUpdate", label: "Days idle", align: "right" },
  ]

  return (
    <div>
      {heading}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
        <SummaryPill>
          <strong style={{ color: T.ink }}>{summary.openCases}</strong> open ServiceNow {summary.openCases === 1 ? "case is" : "cases are"} waiting on <strong style={{ color: T.ink }}>{summary.jiraWithOpen}</strong> Jira {summary.jiraWithOpen === 1 ? "ticket" : "tickets"}
        </SummaryPill>
        {summary.staleImpact > 0 && (
          <SummaryPill tone="warn">
            <AlertTriangle size={13} style={{ color: T.warn }} /> <strong style={{ color: T.ink }}>{summary.staleImpact}</strong> of those {summary.staleImpact === 1 ? "Jira hasn't" : "Jiras haven't"} been updated in {STALE_DAYS}+ days
          </SummaryPill>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2.4fr) minmax(220px, 1fr)", gap: 12, alignItems: "start" }}>
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }} className="scrollbar">
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: T.surfaceAlt }}>
                  {cols.map((c) => (
                    <th key={c.key} onClick={() => toggleSort(c.key)}
                      style={{ padding: "10px 12px", textAlign: c.align, fontWeight: 600, color: T.sub, cursor: "pointer", whiteSpace: "nowrap", borderBottom: `1px solid ${T.borderSoft}` }}>
                      {c.label}{sort.key === c.key ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((b) => {
                  const isExpanded = expanded === b.key
                  // Action-required intersection: lots of open cases AND gone quiet.
                  const hot = b.openCount >= 3 && b.daysSinceUpdate != null && b.daysSinceUpdate >= STALE_DAYS
                  return (
                    <React.Fragment key={b.key}>
                      <tr onClick={() => expandRow(b)} className="hoverlift"
                        style={{ borderBottom: `1px solid ${T.borderSoft}`, cursor: "pointer", background: isExpanded ? T.surfaceAlt : "transparent" }}>
                        <td className="mono" style={{ padding: "9px 12px", color: T.jiraBlue, fontWeight: 600, whiteSpace: "nowrap" }}>{b.key}</td>
                        <td style={{ padding: "9px 12px", maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: T.ink }} title={b.summary}>{b.summary || (b.hasLive ? "" : "(not in synced project)")}</td>
                        <td style={{ padding: "9px 12px", color: T.sub, whiteSpace: "nowrap" }}>{b.issueType}</td>
                        <td style={{ padding: "9px 12px", whiteSpace: "nowrap", color: priorityColor(b.priority), fontWeight: 600 }}>{b.priority || "—"}</td>
                        <td style={{ padding: "9px 12px", color: T.sub, whiteSpace: "nowrap" }}>{b.status}</td>
                        <td className="mono" style={{ padding: "9px 12px", textAlign: "right", fontWeight: 700, color: hot ? T.danger : T.ink }}>{b.openCount}</td>
                        <td className="mono" style={{ padding: "9px 12px", textAlign: "right", color: T.sub }}>{b.totalCount}</td>
                        <td className="mono" style={{ padding: "9px 12px", textAlign: "right", color: b.daysSinceUpdate >= STALE_DAYS ? T.warn : T.sub }}>{b.daysSinceUpdate ?? "—"}</td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={cols.length} style={{ padding: "0 12px 12px", borderBottom: `1px solid ${T.borderSoft}`, background: T.surfaceAlt }}>
                            <LinkedCases cases={b.cases} openCount={b.openCount} totalCount={b.totalCount} />
                            {b.issue && <JiraIssueDetail issue={b.issue} detail={details[b.key]} />}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
          {sorted.length > BLAST_TOP_N && (
            <div style={{ padding: "10px 12px", borderTop: `1px solid ${T.borderSoft}` }}>
              <button onClick={() => setShowAll((v) => !v)}
                style={{ background: "none", border: "none", color: T.accent, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "DM Sans, sans-serif" }}>
                {showAll ? "Show top 25" : `Show all ${sorted.length}`}
              </button>
            </div>
          )}
        </Card>

        <Card>
          <div className="eyebrow" style={{ color: T.muted }}>Open cases per Jira</div>
          <div style={{ color: T.sub, fontSize: 12, marginTop: 4 }}>Is the pain concentrated in a few tickets or spread across many?</div>
          <div style={{ height: 240, marginTop: 12 }}>
            <ResponsiveContainer>
              <BarChart data={histo} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                <CartesianGrid stroke={T.borderSoft} vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: T.muted }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: T.muted }} />
                <Tooltip cursor={{ fill: T.surfaceAlt }} contentStyle={tipStyle} formatter={(v) => [`${v} Jiras`, "count"]} />
                <Bar dataKey="count" fill={T.accent} radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
    </div>
  )
}

/* Linked ServiceNow cases for one blast-radius Jira key. Open cases first and
 * emphasized; closed de-emphasized. Case numbers are click-to-copy. Scrolls
 * when a key has many cases (some have 100+). */
function LinkedCases({ cases, openCount, totalCount }) {
  if (!cases || cases.length === 0) {
    return <div style={{ padding: "12px 4px", color: T.muted, fontSize: 12, fontStyle: "italic" }}>No linked ServiceNow cases.</div>
  }
  return (
    <div style={{ padding: "12px 4px 4px" }}>
      <div className="eyebrow" style={{ color: T.muted, marginBottom: 8 }}>
        Linked ServiceNow cases · {totalCount} total · {openCount} open
      </div>
      <div className="scrollbar" style={{ maxHeight: 260, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
        {cases.map((c) => (
          <div key={c.number} style={{ display: "grid", gridTemplateColumns: "auto auto minmax(0, 1fr) auto", gap: 10, alignItems: "center", fontSize: 12, padding: "3px 4px" }}>
            <span title={c.isClosed ? "Closed" : "Open"}
              style={{ width: 7, height: 7, borderRadius: "50%", background: c.isClosed ? T.muted : T.warn, flex: "0 0 auto" }} />
            <CopyableNumber value={c.number} className="mono"
              style={{ color: c.isClosed ? T.muted : T.accent, fontWeight: 600 }} />
            <span style={{ color: c.isClosed ? T.muted : T.sub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              title={`${c.shortDescription}${c.account ? " · " + c.account : ""}`}>
              {c.shortDescription || "—"}{c.account ? <span style={{ color: T.muted }}> · {c.account}</span> : null}
            </span>
            <span className="mono" style={{ color: T.muted, textAlign: "right", whiteSpace: "nowrap" }}>
              {c.daysOpen != null ? `${c.daysOpen}d` : ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function SummaryPill({ children, tone }) {
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      fontSize: 13, color: T.sub,
      background: tone === "warn" ? T.warnSoft : T.surface,
      border: `1px solid ${tone === "warn" ? T.warn : T.border}`,
      borderRadius: 20, padding: "6px 14px",
    }}>
      {children}
    </div>
  )
}

/* --------------------- lifecycle, health, pipeline ----------------------- */

function Lifecycle({ issues, blast, hasSn }) {
  const resByPriority = useMemo(() => resolutionStatsByPriority(issues, 90), [issues])
  const aging = useMemo(() => agingBuckets(issues), [issues])
  const status = useMemo(() => statusMix(issues.filter((i) => i._isOpen)), [issues])
  const stale = useMemo(() => (hasSn ? staleWithImpact(blast, STALE_DAYS, 10) : []), [blast, hasSn])
  const pipeline = useMemo(() => fixVersionPipeline(issues, blast).slice(0, 8), [issues, blast])
  const [openVersion, setOpenVersion] = useState(null)

  const fmtDays = (ms) => `${Math.round(ms / 864e5)}d`

  return (
    <div style={{ marginTop: 32 }}>
      <div className="eyebrow" style={{ color: T.muted, marginBottom: 12 }}>Lifecycle & health</div>

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 12 }}>
        <Card>
          <div className="eyebrow" style={{ color: T.muted }}>Resolution time by priority · last 90 days</div>
          <div style={{ color: T.sub, fontSize: 12, marginTop: 4 }}>Median, 90th percentile, and worst-case time from created to resolved.</div>
          <div style={{ height: 260, marginTop: 12 }}>
            {resByPriority.length === 0 ? (
              <EmptyNote>No issues resolved in the last 90 days.</EmptyNote>
            ) : (
              <ResponsiveContainer>
                <BarChart data={resByPriority} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
                  <CartesianGrid stroke={T.borderSoft} vertical={false} />
                  <XAxis dataKey="priority" tick={{ fontSize: 11, fill: T.muted }} />
                  <YAxis tickFormatter={fmtDays} tick={{ fontSize: 11, fill: T.muted }} />
                  <Tooltip cursor={{ fill: T.surfaceAlt }} contentStyle={tipStyle} formatter={(v, n) => [fmtDuration(v), n]} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar name="Median" dataKey="p50" fill={T.ok} radius={[2, 2, 0, 0]} />
                  <Bar name="p90" dataKey="p90" fill={T.warn} radius={[2, 2, 0, 0]} />
                  <Bar name="Max" dataKey="max" fill={T.danger} radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <Card>
          <div className="eyebrow" style={{ color: T.muted }}>Open backlog aging</div>
          <div style={{ color: T.sub, fontSize: 12, marginTop: 4 }}>How long currently-open Jiras have been open.</div>
          <div style={{ height: 260, marginTop: 12 }}>
            <ResponsiveContainer>
              <BarChart data={aging} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                <CartesianGrid stroke={T.borderSoft} vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: T.muted }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: T.muted }} />
                <Tooltip cursor={{ fill: T.surfaceAlt }} contentStyle={tipStyle} />
                <Bar dataKey="count" fill={T.accent} radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginTop: 12 }}>
        <BarList title="Open by status" items={status} empty="No open issues" />

        <Card>
          <div className="eyebrow" style={{ color: T.muted }}>Stale Jiras with open cases</div>
          <div style={{ color: T.sub, fontSize: 12, marginTop: 4 }}>Quiet {STALE_DAYS}+ days but still gating live cases — chase these.</div>
          <div style={{ marginTop: 12 }}>
            {!hasSn ? (
              <EmptyNote>Needs ServiceNow cases.</EmptyNote>
            ) : stale.length === 0 ? (
              <EmptyNote>No stale tickets with open cases. 🎉</EmptyNote>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {stale.map((b) => (
                  <div key={b.key} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 10, alignItems: "center", fontSize: 12 }}>
                    {b.url
                      ? <a href={b.url} target="_blank" rel="noopener noreferrer" className="mono" style={{ color: T.jiraBlue, fontWeight: 600, textDecoration: "none" }}>{b.key}</a>
                      : <span className="mono" style={{ color: T.jiraBlue, fontWeight: 600 }}>{b.key}</span>}
                    <span className="mono" style={{ color: T.warn }}>{b.daysSinceUpdate}d idle</span>
                    <span className="mono" style={{ color: T.sub }}>{b.openCount} open</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>

        <Card>
          <div className="eyebrow" style={{ color: T.muted }}>Fix-version pipeline</div>
          <div style={{ color: T.sub, fontSize: 12, marginTop: 4 }}>Upcoming releases and the open-case impact riding on each. Click a release to see its Jiras.</div>
          <div style={{ marginTop: 12 }}>
            {pipeline.length === 0 ? (
              <EmptyNote>No open issues with a fix version.</EmptyNote>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ color: T.muted, textAlign: "left" }}>
                    <th style={{ padding: "4px 0", fontWeight: 600 }}>Version</th>
                    <th style={{ padding: "4px 0", fontWeight: 600, textAlign: "right" }}>Tickets</th>
                    <th style={{ padding: "4px 0", fontWeight: 600, textAlign: "right" }}>Open cases</th>
                  </tr>
                </thead>
                <tbody>
                  {pipeline.map((v) => {
                    const isOpen = openVersion === v.version
                    return (
                      <React.Fragment key={v.version}>
                        <tr
                          onClick={() => setOpenVersion(isOpen ? null : v.version)}
                          className="hoverlift"
                          style={{ borderTop: `1px solid ${T.borderSoft}`, cursor: "pointer", background: isOpen ? T.surfaceAlt : "transparent" }}
                        >
                          <td style={{ padding: "6px 0", color: T.ink, maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={v.version}>
                            <span style={{ color: T.muted, marginRight: 4 }}>{isOpen ? "▾" : "▸"}</span>{v.version}
                          </td>
                          <td className="mono" style={{ padding: "6px 0", textAlign: "right", color: T.sub }}>{v.ticketCount}</td>
                          <td className="mono" style={{ padding: "6px 0", textAlign: "right", fontWeight: 600, color: v.openCaseImpact > 0 ? T.ink : T.muted }}>{v.openCaseImpact}</td>
                        </tr>
                        {isOpen && (
                          <tr>
                            <td colSpan={3} style={{ padding: "2px 0 8px", background: T.surfaceAlt }}>
                              <div style={{ display: "flex", flexDirection: "column", gap: 5, padding: "4px 8px" }}>
                                {v.issues.map((it) => (
                                  <div key={it.key} style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 8, alignItems: "center" }}>
                                    {it.url
                                      ? <a href={it.url} target="_blank" rel="noopener noreferrer" className="mono" style={{ color: T.jiraBlue, fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap" }}>{it.key}</a>
                                      : <span className="mono" style={{ color: T.jiraBlue, fontWeight: 600, whiteSpace: "nowrap" }}>{it.key}</span>}
                                    <span style={{ color: T.sub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={it.summary}>{it.summary}</span>
                                    <span className="mono" style={{ color: it.openCount > 0 ? T.ink : T.muted, whiteSpace: "nowrap" }}>{it.openCount} open</span>
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}

function EmptyNote({ children }) {
  return <div style={{ color: T.sub, fontSize: 12, fontStyle: "italic" }}>{children}</div>
}

/* -------------------------------- KPIs ---------------------------------- */

function KpiStrip({ issues }) {
  const s = useMemo(() => jiraSummary(issues), [issues])
  const created90d = useMemo(() => createdWithin(issues, 90).length, [issues])
  const medianResolveMs = useMemo(
    () => cycleLeadStats(createdWithin(issues, 30, "resolved")).lead.median,
    [issues],
  )

  const cards = [
    { label: "Total Jiras", value: s.total.toLocaleString() },
    { label: "Created · 7d", value: s.created7d, sub: `${s.created30d} in 30d` },
    { label: "Created · 90d", value: created90d },
    { label: "Currently open", value: s.open, sub: `${s.openHighPriority} high-priority`, warn: s.openHighPriority > 0 },
    { label: "Resolved · 30d", value: s.resolved30d },
    { label: "Median resolve · 30d", value: medianResolveMs != null ? fmtDuration(medianResolveMs) : "—", mono: true },
  ]
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 8 }}>
      {cards.map((c) => <JiraKpiCard key={c.label} {...c} />)}
    </div>
  )
}

/* ----------------------------- creation volume --------------------------- */

function CreationVolume({ issues }) {
  const daily = useMemo(() => dailyCreation(issues, 90), [issues])
  const weekly = useMemo(() => weeklyCreatedResolved(issues, 12), [issues])
  const weekday = useMemo(() => weekdayCounts(issues), [issues])

  const fmtDay = (ts) => { const d = new Date(ts); return `${d.getMonth() + 1}/${d.getDate()}` }
  const fmtWeek = (ts) => { const d = new Date(ts); return `${d.getMonth() + 1}/${d.getDate()}` }

  return (
    <div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 12 }}>
      <Card>
        <div className="eyebrow" style={{ color: T.muted }}>Daily creation · last 90 days</div>
        <div style={{ color: T.sub, fontSize: 12, marginTop: 4 }}>New Jiras opened each day, with a 7-day rolling average to cut through the noise.</div>
        <div style={{ height: 280, marginTop: 12 }}>
          <ResponsiveContainer>
            <ComposedChart data={daily} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
              <CartesianGrid stroke={T.borderSoft} vertical={false} />
              <XAxis dataKey="date" tickFormatter={fmtDay} tick={{ fontSize: 11, fill: T.muted }} interval={6} minTickGap={16} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: T.muted }} />
              <Tooltip content={<DailyTip fmt={fmtDay} />} />
              <Bar dataKey="created" fill={T.accentSoft} radius={[2, 2, 0, 0]} />
              <Line dataKey="rolling7" stroke={T.accent} strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 12 }}>
        <Card>
          <div className="eyebrow" style={{ color: T.muted }}>Created vs resolved · last 12 weeks</div>
          <div style={{ color: T.sub, fontSize: 12, marginTop: 4 }}>Whether the project is keeping pace. The net line tracks created minus resolved per week — above zero means the backlog grew.</div>
          <div style={{ height: 260, marginTop: 12 }}>
            <ResponsiveContainer>
              <ComposedChart data={weekly} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                <CartesianGrid stroke={T.borderSoft} vertical={false} />
                <XAxis dataKey="week" tickFormatter={fmtWeek} tick={{ fontSize: 11, fill: T.muted }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: T.muted }} />
                <Tooltip content={<WeeklyTip fmt={fmtWeek} />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar name="Created" dataKey="created" fill={T.accent} radius={[2, 2, 0, 0]} />
                <Bar name="Resolved" dataKey="resolved" fill={T.ok} radius={[2, 2, 0, 0]} />
                <Line name="Net" dataKey="net" stroke={T.warn} strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card>
          <div className="eyebrow" style={{ color: T.muted }}>Intake by weekday</div>
          <div style={{ color: T.sub, fontSize: 12, marginTop: 4 }}>Which days new Jiras tend to land.</div>
          <div style={{ height: 260, marginTop: 12 }}>
            <ResponsiveContainer>
              <BarChart data={weekday} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                <CartesianGrid stroke={T.borderSoft} vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: T.muted }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: T.muted }} />
                <Tooltip cursor={{ fill: T.surfaceAlt }} contentStyle={tipStyle} />
                <Bar dataKey="count" fill={T.accent} radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
    </div>
  )
}

/* ------------------------------ composition ------------------------------ */

function Composition({ issues }) {
  const win = useMemo(() => createdWithin(issues, COMPOSITION_WINDOW_DAYS), [issues])
  const types = useMemo(() => issueTypeMix(win), [win])
  const priorities = useMemo(() => breakdownBy(win, (i) => i.priority || "None"), [win])
  const components = useMemo(() => componentBreakdown(win).slice(0, 8), [win])
  const labels = useMemo(() => labelBreakdown(win).filter((l) => l.name !== "(none)").slice(0, 8), [win])

  return (
    <div style={{ marginTop: 24 }}>
      <div className="eyebrow" style={{ color: T.muted, marginBottom: 4 }}>Composition · last {COMPOSITION_WINDOW_DAYS} days</div>
      <div style={{ color: T.sub, fontSize: 12, marginBottom: 12 }}>What the most recent intake is made of. Fixed {COMPOSITION_WINDOW_DAYS}-day window — independent of the date filter above.</div>
      {win.length === 0 ? (
        <Card><div style={{ color: T.sub, fontSize: 13, fontStyle: "italic" }}>No Jiras created in the last {COMPOSITION_WINDOW_DAYS} days.</div></Card>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
          <BarList title="Issue type" items={types} />
          <BarList title="Priority" items={priorities} />
          <BarList title="Top components" items={components} empty="No components tagged" />
          <BarList title="Top labels" items={labels} empty="No labels in this window" />
        </div>
      )}
    </div>
  )
}

/* Reusable horizontal bar list (matches the Accounts-page visual style). */
function BarList({ title, items, empty = "No data" }) {
  const max = Math.max(...items.map((i) => i.count), 1)
  return (
    <Card>
      <div className="eyebrow" style={{ color: T.muted }}>{title}</div>
      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        {items.length === 0 ? (
          <div style={{ color: T.sub, fontSize: 12, fontStyle: "italic" }}>{empty}</div>
        ) : items.map((it) => (
          <div key={it.name} style={{ display: "grid", gridTemplateColumns: "1fr 40px", alignItems: "center", gap: 10, fontSize: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ flex: "0 0 110px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={it.name}>{it.name}</span>
              <div style={{ flex: 1, height: 6, background: T.surfaceAlt, borderRadius: 2, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${(it.count / max) * 100}%`, background: T.accent }} />
              </div>
            </div>
            <span className="mono" style={{ color: T.sub, textAlign: "right" }}>{it.count}</span>
          </div>
        ))}
      </div>
    </Card>
  )
}

/* -------------------------------- tooltips ------------------------------- */

const tipStyle = { background: T.surface, border: `1px solid ${T.border}`, borderRadius: 4, fontSize: 12 }

function DailyTip({ active, payload, label, fmt }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div style={{ ...tipStyle, padding: "8px 12px" }}>
      <div style={{ fontWeight: 600 }}>{fmt(label)}</div>
      <div className="mono" style={{ color: T.sub }}>{d.created} created · {d.rolling7} avg</div>
    </div>
  )
}

function WeeklyTip({ active, payload, label, fmt }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div style={{ ...tipStyle, padding: "8px 12px" }}>
      <div style={{ fontWeight: 600 }}>Week of {fmt(label)}</div>
      <div className="mono" style={{ color: T.accent }}>{d.created} created</div>
      <div className="mono" style={{ color: T.ok }}>{d.resolved} resolved</div>
      <div className="mono" style={{ color: T.warn }}>net {d.net > 0 ? "+" : ""}{d.net}</div>
    </div>
  )
}
