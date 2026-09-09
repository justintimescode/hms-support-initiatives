import React, { useState, useMemo } from "react";
import DOMPurify from "dompurify";
import { Loader2, XCircle, Activity, Plug } from "lucide-react";
import { T } from "../../lib/theme.js";
import { fmtDuration, fmtDateTime, fmtAgo, priorityColor } from "../../lib/format.js";
import { fetchIssueDetail, PROJECT_KEY, FULL_SYNC_DAYS } from "../../lib/jira-client.js";
import { jiraSummary, recentlyCreated, recentlyResolved } from "../../lib/jira-enrich.js";
import { Card } from "../layout/Card.jsx";
import { FilterLink } from "../FilterLink.jsx";
import { InfoTip } from "../InfoTip.jsx";

/* ================= Jira Analysis (live project) ================= */

const jiraBtn = (primary, disabled) => ({
  padding: "6px 14px",
  borderRadius: 4,
  fontSize: 12,
  fontWeight: 600,
  cursor: disabled ? "default" : "pointer",
  opacity: disabled ? 0.55 : 1,
  border: `1px solid ${primary ? T.accent : T.border}`,
  background: primary ? T.accent : T.surface,
  color: primary ? T.onAccent : T.sub,
})

export function JiraSyncControls({ meta, onSync }) {
  const ago = fmtAgo(meta?.fetchedAt)
  const cacheFailed = meta?.cacheSaved === false
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <span style={{ fontSize: 12, color: T.sub }}>
        {meta?.projectName && (
          <>Project <strong style={{ color: T.ink, fontWeight: 600 }}>{meta.projectName}</strong>
            {meta.projectKey ? <span className="mono" style={{ color: T.muted }}> ({meta.projectKey})</span> : null}</>
        )}
        {ago && (
          <>{meta?.projectName ? " · " : ""}synced <span className="mono">{ago}</span>
            {meta?.count != null && ` · ${meta.count} issues`}</>
        )}
      </span>
      {cacheFailed && (
        <span title="Sync succeeded but the IndexedDB cache write failed — reloading will require another Full sync. Check the browser console for the error."
          style={{ fontSize: 11, fontWeight: 600, color: T.warn, background: T.warnSoft, padding: "3px 8px", borderRadius: 10, whiteSpace: "nowrap" }}>
          ⚠ cache not saved
        </span>
      )}
      <button onClick={() => onSync("24h")} style={jiraBtn(false, false)} title="Issues updated in the last 24 hours">Last 24h</button>
      <button onClick={() => onSync("5d")} style={jiraBtn(false, false)} title="Issues updated in the last 5 days">Last 5 days</button>
      <button onClick={() => onSync("14d")} style={jiraBtn(false, false)} title="Issues updated in the last 14 days">Last 14 days</button>
      <button onClick={() => onSync("30d")} style={jiraBtn(false, false)} title="Issues updated in the last 30 days">Last month</button>
      <button onClick={() => onSync("full")} style={jiraBtn(true, false)} title={`Issues updated in the last ${FULL_SYNC_DAYS} days — anything older is dropped from the cache`}>Full sync</button>
    </div>
  )
}

export function JiraKpiCard({ label, value, sub, mono, warn, info }) {
  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        <div className="eyebrow" style={{ color: T.muted }}>{label}</div>
        {info && <InfoTip label={label} side="left">{info}</InfoTip>}
      </div>
      <div className={mono ? "mono" : "display"}
        style={{ fontSize: mono ? 22 : 30, fontWeight: 500, marginTop: 4, color: warn ? T.warn : T.ink }}>
        {value}
      </div>
      {sub && <div style={{ color: T.sub, fontSize: 12, marginTop: 4 }}>{sub}</div>}
    </Card>
  )
}

// Module-level so it isn't re-created on every render (avoids the
// "create components during render" pitfall).
function JiraField({ label, children }) {
  return (
    <div>
      <div className="eyebrow" style={{ color: T.muted, fontSize: 10 }}>{label}</div>
      <div style={{ fontSize: 13, marginTop: 2, wordBreak: "break-word" }}>{children}</div>
    </div>
  )
}

// Inline expanded panel for one Jira issue — field grid + lazily-loaded
// rendered description. `detail` is { loading } | { html } | { error } | undefined.
export function JiraIssueDetail({ issue, detail }) {
  return (
    <div style={{ background: T.surfaceAlt, borderRadius: 4, padding: "14px 16px", margin: "4px 0" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 14 }}>
        <JiraField label="Type">{issue.issueType}</JiraField>
        <JiraField label="Status">{issue.status}</JiraField>
        <JiraField label="Priority"><span style={{ color: priorityColor(issue.priority), fontWeight: 600 }}>{issue.priority || "—"}</span></JiraField>
        <JiraField label="Assignee">{issue.assignee}</JiraField>
        <JiraField label="Created">{fmtDateTime(issue.created)}</JiraField>
        <JiraField label="Updated">{fmtDateTime(issue.updated)}</JiraField>
        <JiraField label="Resolved">{issue.resolved ? fmtDateTime(issue.resolved) : "—"}</JiraField>
        <JiraField label="Time to resolve">{issue.resolved && issue._leadMs != null ? fmtDuration(issue._leadMs) : "—"}</JiraField>
        <JiraField label="Components">{issue.components.length ? issue.components.join(", ") : "—"}</JiraField>
        <JiraField label="Labels">{issue.labels.length ? issue.labels.join(", ") : "—"}</JiraField>
        <JiraField label="Fix versions">{issue.fixVersions.length ? issue.fixVersions.join(", ") : "—"}</JiraField>
        <JiraField label="Link">
          <a href={issue.url} target="_blank" rel="noopener noreferrer" className="mono" style={{ color: T.jiraBlue, textDecoration: "none", fontWeight: 600 }}>{issue.key} ↗</a>
        </JiraField>
      </div>
      <div className="eyebrow" style={{ color: T.muted, marginBottom: 6 }}>Description</div>
      {(!detail || detail.loading) && (
        <div style={{ color: T.sub, fontSize: 13, fontStyle: "italic" }}>Loading description…</div>
      )}
      {detail?.error && (
        <div style={{ color: T.danger, fontSize: 13 }}>Could not load description: {detail.error}</div>
      )}
      {detail && !detail.loading && !detail.error && (
        detail.html
          ? (
            <div
              className="scrollbar"
              style={{ fontSize: 13, color: T.ink, lineHeight: 1.55, maxHeight: 360, overflowY: "auto", wordBreak: "break-word" }}
              // SECURITY #10: Jira renders user-authored description content;
              // sanitize before injecting as HTML to block stored XSS.
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(detail.html) }}
            />
          )
          : <div style={{ color: T.muted, fontSize: 13, fontStyle: "italic" }}>No description.</div>
      )}
    </div>
  )
}

const JIRA_LIST_PAGE = 100

// Searchable / sortable / expandable issue table. mode 'created' is sorted by
// created date; mode 'resolved' is sorted by resolved date and adds a
// time-to-resolve column. Expanding a row lazily fetches its full description.
function JiraIssueList({ issues, mode }) {
  const dateKey = mode === "resolved" ? "resolved" : "created"
  const [query, setQuery] = useState("")
  const [sort, setSort] = useState({ key: dateKey, dir: "desc" })
  const [expandedKey, setExpandedKey] = useState(null)
  const [showAll, setShowAll] = useState(false)
  const [details, setDetails] = useState({})

  const cols = useMemo(() => {
    const base = [
      { key: "key", label: "Key" },
      { key: "issueType", label: "Type" },
      { key: "priority", label: "Priority" },
      { key: "summary", label: "Summary" },
      { key: "status", label: "Status" },
      { key: "assignee", label: "Assignee" },
      { key: "components", label: "Components" },
      { key: dateKey, label: mode === "resolved" ? "Resolved" : "Created", align: "right" },
      { key: "updated", label: "Updated", align: "right" },
    ]
    if (mode === "resolved") base.push({ key: "_leadMs", label: "Time to resolve", align: "right" })
    return base
  }, [mode, dateKey])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return issues
    return issues.filter((i) =>
      (i.key && i.key.toLowerCase().includes(q)) ||
      (i.summary && i.summary.toLowerCase().includes(q))
    )
  }, [issues, query])

  const sorted = useMemo(() => {
    const arr = [...filtered]
    arr.sort((a, b) => {
      const av = a[sort.key], bv = b[sort.key]
      const an = av instanceof Date ? av.getTime() : av
      const bn = bv instanceof Date ? bv.getTime() : bv
      if (typeof an === "number" && typeof bn === "number") return sort.dir === "asc" ? an - bn : bn - an
      const as = String(av ?? ""), bs = String(bv ?? "")
      return sort.dir === "asc" ? as.localeCompare(bs) : bs.localeCompare(as)
    })
    return arr
  }, [filtered, sort])

  const visible = showAll ? sorted : sorted.slice(0, JIRA_LIST_PAGE)

  const toggleSort = (key) =>
    setSort((s) => s.key === key
      ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
      : { key, dir: ["created", "resolved", "updated", "_leadMs"].includes(key) ? "desc" : "asc" })

  const expandRow = (key) => {
    setExpandedKey((cur) => (cur === key ? null : key))
    setDetails((d) => {
      if (d[key]) return d
      fetchIssueDetail(key)
        .then((res) => setDetails((cur) => ({ ...cur, [key]: { html: res.descriptionHtml } })))
        .catch((err) => setDetails((cur) => ({ ...cur, [key]: { error: err?.message || "fetch failed" } })))
      return { ...d, [key]: { loading: true } }
    })
  }

  const renderCell = (it, key) => {
    if (key === "key") return it.url
      ? <a href={it.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="mono" style={{ color: T.jiraBlue, fontWeight: 600, textDecoration: "none" }}>{it.key}</a>
      : <span className="mono" style={{ color: T.jiraBlue, fontWeight: 600 }}>{it.key}</span>
    if (key === "priority") return <span style={{ color: priorityColor(it.priority), fontWeight: 600 }}>{it.priority || "—"}</span>
    if (key === "created" || key === "resolved" || key === "updated") return fmtDateTime(it[key])
    if (key === "_leadMs") return it._leadMs != null ? fmtDuration(it._leadMs) : "—"
    if (key === "components") return it.components?.length ? it.components.join(", ") : "—"
    return it[key] || "—"
  }

  return (
    <Card style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ padding: "16px 20px 12px", borderBottom: `1px solid ${T.borderSoft}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div className="eyebrow" style={{ color: T.muted }}>{mode === "resolved" ? "Recently resolved" : "Recently created"}</div>
          <div style={{ color: T.sub, fontSize: 12, marginTop: 4 }}>
            {mode === "resolved"
              ? "Issues closed most recently. Click a row for the full description and detail."
              : "Newest issues in the project. Click a row for the full description and detail."}
          </div>
        </div>
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setShowAll(false); setExpandedKey(null) }}
          placeholder="Search key or summary…"
          style={{ fontSize: 12, padding: "6px 10px", border: `1px solid ${T.border}`, borderRadius: 4, background: T.surface, color: T.ink, minWidth: 220 }}
        />
      </div>
      <div style={{ overflowX: "auto" }} className="scrollbar">
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: T.surfaceAlt }}>
              {cols.map((c) => (
                <th key={c.key} onClick={() => toggleSort(c.key)}
                  style={{ padding: "10px 14px", textAlign: c.align || "left", fontWeight: 600, color: T.sub, cursor: "pointer", whiteSpace: "nowrap", borderBottom: `1px solid ${T.borderSoft}` }}>
                  {c.label}
                  {sort.key === c.key && <span style={{ marginLeft: 4, color: T.accent }}>{sort.dir === "asc" ? "▲" : "▼"}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr><td colSpan={cols.length} style={{ padding: "20px", color: T.sub, fontStyle: "italic" }}>
                {query ? "No issues match your search." : "No issues."}
              </td></tr>
            )}
            {visible.map((it) => {
              const isExpanded = expandedKey === it.key
              return (
                <React.Fragment key={it.key}>
                  <tr onClick={() => expandRow(it.key)} className="hoverlift"
                    style={{ borderBottom: `1px solid ${T.borderSoft}`, cursor: "pointer", background: isExpanded ? T.surfaceAlt : "transparent" }}>
                    {cols.map((c) => {
                      const isSummary = c.key === "summary"
                      const isComponents = c.key === "components"
                      const isMono = c.key === "created" || c.key === "resolved" || c.key === "updated" || c.key === "_leadMs"
                      return (
                        <td key={c.key}
                          className={isMono ? "mono" : undefined}
                          title={isSummary ? it.summary : isComponents ? (it.components?.join(", ") || undefined) : undefined}
                          style={{
                            padding: "10px 14px",
                            textAlign: c.align || "left",
                            whiteSpace: "nowrap",
                            color: c.align === "right" ? T.sub : isComponents ? T.sub : T.ink,
                            // Summary is the flexible column: it wraps and absorbs
                            // the leftover width so the table always fits the
                            // container (no horizontal scroll) and shows full text.
                            ...(isSummary ? { whiteSpace: "normal", wordBreak: "break-word", minWidth: 260 } : {}),
                            ...(isComponents ? { maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis" } : {}),
                          }}>
                          {renderCell(it, c.key)}
                        </td>
                      )
                    })}
                  </tr>
                  {isExpanded && (
                    <tr>
                      <td colSpan={cols.length} style={{ padding: "0 14px 12px", borderBottom: `1px solid ${T.borderSoft}`, background: T.surfaceAlt }}>
                        <JiraIssueDetail issue={it} detail={details[it.key]} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      {sorted.length > JIRA_LIST_PAGE && (
        <div style={{ padding: "10px 20px", borderTop: `1px solid ${T.borderSoft}` }}>
          <button onClick={() => setShowAll((v) => !v)} style={jiraBtn(false, false)}>
            {showAll ? `Show top ${JIRA_LIST_PAGE}` : `Show all ${sorted.length}`}
          </button>
        </div>
      )}
    </Card>
  )
}

function JiraTimeStat({ label, v }) {
  return (
    <div>
      <div className="eyebrow" style={{ color: T.muted, fontSize: 10 }}>{label}</div>
      <div className="mono" style={{ fontSize: 15, marginTop: 2 }}>{v}</div>
    </div>
  )
}

function JiraAnalysisReady({ issues, meta, onSync, scopeNote }) {
  const summary = useMemo(() => jiraSummary(issues), [issues])
  const created = useMemo(() => recentlyCreated(issues), [issues])
  const resolved = useMemo(() => recentlyResolved(issues), [issues])

  if (issues.length === 0) {
    return (
      <Card>
        <JiraSyncControls meta={meta} onSync={onSync} />
        <div style={{ color: T.sub, fontSize: 14, fontStyle: "italic", textAlign: "center", padding: "24px 8px" }}>
          The sync returned no issues for project {PROJECT_KEY}. Confirm the project key in
          {" "}<span className="mono">src/lib/jira-client.js</span>.
        </div>
      </Card>
    )
  }

  const openPct = summary.total ? ((summary.open / summary.total) * 100).toFixed(0) : 0

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontSize: 12, color: T.muted }}>
          {scopeNote
            ? `Whole ${PROJECT_KEY} project (last ${FULL_SYNC_DAYS} days) — not filtered to ${scopeNote}.`
            : `Whole ${PROJECT_KEY} project · last ${FULL_SYNC_DAYS} days.`}
        </div>
        <JiraSyncControls meta={meta} onSync={onSync} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 12 }}>
        <JiraKpiCard label={`Issues (${FULL_SYNC_DAYS}d)`} value={summary.total} />
        <JiraKpiCard label="Open now" value={summary.open} sub={`${openPct}% of total`} />
        <JiraKpiCard label="Created" value={summary.created30d} sub={`${summary.created7d} in last 7d`} />
        <JiraKpiCard label="Resolved" value={summary.resolved30d} sub={`${summary.resolved7d} in last 7d`} />
        <JiraKpiCard label="Median time to resolve" value={fmtDuration(summary.lead.median)}
          info="The middle time from creation to resolution across resolved Jiras (the 50th percentile) — half resolved faster, half slower. The sub-line adds p85, where the slowest 15% begin."
          sub={`p85 ${fmtDuration(summary.lead.p85)}`} mono />
        <JiraKpiCard label="Open high-priority" value={summary.openHighPriority} sub="needs attention"
          warn={summary.openHighPriority > 0} />
      </div>

      <Card>
        <div className="eyebrow" style={{ color: T.muted }}>Cycle &amp; lead time</div>
        <div style={{ color: T.sub, fontSize: 12, marginTop: 4 }}>
          Cycle time runs from the first "In Progress" transition to "Done" — the active engineering
          window. Lead time runs from created to resolved — the total customer-visible wait. p85 is the
          85th percentile: the long tail most customers never hit but some do.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12, marginTop: 14 }}>
          {[["Cycle time", summary.cycle], ["Lead time", summary.lead]].map(([name, s]) => (
            <div key={name} style={{ border: `1px solid ${T.borderSoft}`, borderRadius: 4, padding: "12px 14px" }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>
                {name} <span style={{ color: T.muted, fontWeight: 400 }}>· {s.n} issues</span>
              </div>
              <div style={{ display: "flex", gap: 20 }}>
                <JiraTimeStat label="Median" v={fmtDuration(s.median)} />
                <JiraTimeStat label="Average" v={fmtDuration(s.avg)} />
                <JiraTimeStat label="p85" v={fmtDuration(s.p85)} />
              </div>
            </div>
          ))}
        </div>
      </Card>

      <JiraIssueList issues={created} mode="created" />
      <JiraIssueList issues={resolved} mode="resolved" />
    </div>
  )
}

export function JiraAnalysisBlock({ jiraState, onSync, onLoadCache, scopeNote }) {
  const { status, issues, meta, error, progress } = jiraState
  // Local message for the idle screen's "Load cached data" button when the
  // cache file is empty / missing. Lives in the block so it survives the brief
  // status transitions a click triggers.
  const [cacheMsg, setCacheMsg] = useState(null)

  if (status === "ready") {
    return <JiraAnalysisReady issues={issues || []} meta={meta} onSync={onSync} scopeNote={scopeNote} />
  }

  const handleLoadCache = async () => {
    setCacheMsg(null)
    const found = onLoadCache ? await onLoadCache() : false
    if (!found) {
      setCacheMsg("No cached data found on disk — run Sync Jira now to populate the cache.")
    }
  }

  let body
  if (status === "hydrating") {
    body = (
      <>
        <Loader2 size={28} style={{ color: T.accent, animation: "spin 1s linear infinite" }} />
        <div style={{ fontWeight: 600, marginTop: 12 }}>Restoring cached Jira data…</div>
        <div style={{ color: T.sub, fontSize: 13, marginTop: 4 }}>Reading the file-backed cache from your last sync.</div>
      </>
    )
  } else if (status === "loading") {
    body = (
      <>
        <Loader2 size={28} style={{ color: T.accent, animation: "spin 1s linear infinite" }} />
        <div style={{ fontWeight: 600, marginTop: 12 }}>Syncing Jira…</div>
        <div style={{ color: T.sub, fontSize: 13, marginTop: 4 }}>
          {progress
            ? `Fetched ${progress.fetched}${progress.total ? ` of ${progress.total}` : ""} issues`
            : "Contacting Atlassian…"}
        </div>
      </>
    )
  } else if (status === "unconfigured") {
    body = (
      <>
        <Plug size={28} style={{ color: T.accent }} />
        <div style={{ fontWeight: 600, marginTop: 12 }}>Jira isn't connected yet</div>
        <div style={{ color: T.sub, fontSize: 13, marginTop: 4, maxWidth: 460, lineHeight: 1.55 }}>
          This page needs live Jira data. Add your Atlassian email and API token in Settings — it applies
          immediately, and the rest of the app keeps working either way. Live sync runs through the local
          proxy, so it needs the desktop app or <span className="mono">npm run dev</span>.
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap", justifyContent: "center" }}>
          <FilterLink to="/settings" style={{ textDecoration: "none" }}>
            <span style={{ ...jiraBtn(true, false), display: "inline-block" }}>Connect Jira in Settings</span>
          </FilterLink>
          <button onClick={() => onSync("full")} style={jiraBtn(false, false)}>Retry</button>
        </div>
      </>
    )
  } else if (status === "error") {
    body = (
      <>
        <XCircle size={28} style={{ color: T.danger }} />
        <div style={{ fontWeight: 600, marginTop: 12 }}>Jira sync failed</div>
        <div style={{ color: T.sub, fontSize: 13, marginTop: 4, maxWidth: 460 }}>{error || "Unknown error."}</div>
        <button onClick={() => onSync("full")} style={{ ...jiraBtn(true, false), marginTop: 16 }}>Try again</button>
      </>
    )
  } else {
    body = (
      <>
        <Activity size={28} style={{ color: T.accent }} />
        <div style={{ fontWeight: 600, marginTop: 12 }}>Connect to Jira</div>
        <div style={{ color: T.sub, fontSize: 13, marginTop: 4, maxWidth: 460 }}>
          Pull live issue data from the Hospitality Management Solution project to see cycle time,
          throughput, backlog flow, aging WIP, and workload distribution. Data is cached locally and
          refreshed on demand.
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap", justifyContent: "center" }}>
          <button onClick={() => onSync("full")} style={jiraBtn(true, false)}>Sync Jira now</button>
          <button onClick={handleLoadCache} style={jiraBtn(false, false)} title="Load issues from the cached cache.json file without contacting Jira">
            Load cached data
          </button>
        </div>
        {cacheMsg && (
          <div style={{ marginTop: 10, fontSize: 12, color: T.warn, fontStyle: "italic", maxWidth: 460 }}>
            {cacheMsg}
          </div>
        )}
      </>
    )
  }

  return (
    <Card>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "32px 16px" }}>
        {body}
      </div>
    </Card>
  )
}
