import { useOutletContext } from "react-router-dom"
import {
  Plug, ExternalLink, Database, Heart, AlertTriangle, Settings,
} from "lucide-react"
import { T } from "../lib/theme.js"
import { fmtFullDateTime } from "../lib/format.js"
import { Section } from "../components/layout/Section.jsx"
import { Card } from "../components/layout/Card.jsx"
import { Pill } from "../components/Pill.jsx"
import { FilterLink } from "../components/FilterLink.jsx"
import { ImportsCard } from "../components/connections/ImportsCard.jsx"

/* All data sources in one place. ServiceNow imports (file manager) + Jira sync
 * are real; ServiceNow API + Gainsight are placeholders. */
export default function Connections() {
  const ctx = useOutletContext()
  const { jiraState, syncJira, jiraCreds } = ctx

  return (
    <Section
      title="Connections"
      subtitle="The data sources that feed every page in the app. Upload a ServiceNow case export to get started; everything else is optional."
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 12 }}>
        <ImportsCard {...ctx} />
        <JiraCard jiraState={jiraState} onSync={syncJira} jiraCreds={jiraCreds} />
        <PlaceholderCard
          title="ServiceNow API"
          icon={Database}
          subtitle="Direct ServiceNow connector — eliminates manual CSV/XLSX exports."
        />
        <PlaceholderCard
          title="Gainsight"
          icon={Heart}
          subtitle="Customer health + sentiment signals joined onto each case account."
        />
      </div>
    </Section>
  )
}


function JiraCard({ jiraState, onSync, jiraCreds }) {
  const status = jiraState?.status || "idle"
  const meta = jiraState?.meta
  const syncedAt = meta?.fetchedAt ? fmtFullDateTime(meta.fetchedAt) : null
  const syncing = status === "loading" || status === "hydrating"
  // Jira is optional, so "no credentials" is a neutral state, not an error —
  // only a genuine sync failure is styled as one.
  const needsCreds = status === "unconfigured" || (jiraCreds && !jiraCreds.configured)
  const pillTone = status === "ready" ? T.ok
    : status === "loading" || status === "hydrating" ? T.warn
    : status === "error" ? T.danger
    : T.muted
  const pillLabel = status === "ready" ? "connected"
    : status === "loading" ? "syncing…"
    : status === "hydrating" ? "loading cache…"
    : needsCreds ? "not connected"
    : status === "error" ? "error"
    : "idle"

  return (
    <Card style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <ExternalLink size={18} strokeWidth={1.9} style={{ color: T.accent }} />
          <span style={{ fontSize: 16, fontWeight: 600 }}>Jira (Atlassian)</span>
        </div>
        <Pill color={pillTone}>{pillLabel}</Pill>
      </div>
      <div style={{ fontSize: 13, color: T.sub }}>
        Optional. Live engineering data for the HMS project — used for blocker analysis on case rows and
        the standalone Jira project lens. Every other page works without it.
      </div>
      {status === "ready" && meta && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: T.sub }}>
          {meta.projectName && (
            <div>Project <strong style={{ color: T.ink }}>{meta.projectName}</strong>{meta.projectKey ? <span className="mono" style={{ color: T.muted }}> ({meta.projectKey})</span> : null}</div>
          )}
          {meta.count != null && <div className="mono">{meta.count} issues cached</div>}
          {syncedAt && <div>Synced {syncedAt}</div>}
          {meta.cacheSaved === false && (
            <div style={{ color: T.warn, display: "flex", alignItems: "center", gap: 6 }}>
              <AlertTriangle size={14} strokeWidth={2.25} /> cache did not persist
            </div>
          )}
        </div>
      )}
      {needsCreds && status !== "ready" && (
        <div style={{ fontSize: 12, color: T.sub, lineHeight: 1.55 }}>
          No Jira credentials yet. Add your Atlassian email and API token in Settings — takes a minute,
          no restart needed.
        </div>
      )}
      {status === "error" && jiraState?.error && (
        <div style={{ color: T.danger, fontSize: 12 }}>{jiraState.error}</div>
      )}
      {syncing && <JiraSyncProgress status={status} progress={jiraState?.progress} />}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {needsCreds && status !== "ready" ? (
          <FilterLink to="/settings" style={{ textDecoration: "none" }}>
            <span style={{ ...btnPrimary(false), display: "inline-flex" }}>
              <Settings size={14} strokeWidth={2.25} /> Connect Jira in Settings
            </span>
          </FilterLink>
        ) : (
          <>
            <button
              onClick={() => onSync("recent")}
              disabled={syncing}
              style={btnSecondary(syncing)}
            >
              Sync recent
            </button>
            <button
              onClick={() => onSync("full")}
              disabled={syncing}
              style={btnPrimary(syncing)}
            >
              {status === "ready" ? "Full re-sync" : "Sync Jira now"}
            </button>
          </>
        )}
      </div>
    </Card>
  )
}

function JiraSyncProgress({ status, progress }) {
  const total = progress?.total
  const fetched = progress?.fetched ?? 0
  const determinate = status === "loading" && total > 0
  const pct = determinate ? Math.min(100, Math.round((fetched / total) * 100)) : 0

  const label = status === "hydrating"
    ? "Restoring cached data…"
    : determinate
      ? `Fetched ${fetched.toLocaleString()} of ${total.toLocaleString()} issues`
      : progress
        ? `Fetched ${fetched.toLocaleString()} issues…`
        : "Contacting Atlassian…"

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 12, color: T.sub }}>{label}</div>
      <div style={{ position: "relative", height: 6, background: T.surfaceAlt, borderRadius: T.radiusSm, overflow: "hidden" }}>
        {determinate ? (
          <div style={{ height: "100%", width: `${pct}%`, background: T.accent, borderRadius: T.radiusSm, transition: "width 0.3s ease" }} />
        ) : (
          <div style={{ position: "absolute", top: 0, bottom: 0, width: "45%", background: T.accent, borderRadius: T.radiusSm, animation: "indeterminate 1.2s linear infinite" }} />
        )}
      </div>
    </div>
  )
}

function PlaceholderCard({ title, icon: Icon, subtitle }) {
  return (
    <Card style={{ background: T.surfaceAlt, borderStyle: "dashed", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Icon size={18} strokeWidth={1.9} style={{ color: T.muted }} />
          <span style={{ fontSize: 16, fontWeight: 600, color: T.sub }}>{title}</span>
        </div>
        <Pill color={T.muted}>coming soon</Pill>
      </div>
      <div style={{ fontSize: 13, color: T.sub }}>{subtitle}</div>
      <button
        disabled
        style={{
          alignSelf: "flex-start",
          padding: "8px 14px",
          background: "transparent",
          color: T.muted,
          border: `1px solid ${T.border}`,
          borderRadius: T.radiusSm,
          fontSize: 13,
          cursor: "not-allowed",
        }}
      >
        <Plug size={14} strokeWidth={2.25} style={{ verticalAlign: "middle", marginRight: 4 }} /> Configure
      </button>
    </Card>
  )
}

function btnPrimary(disabled) {
  return {
    display: "inline-flex", alignItems: "center", gap: 6,
    padding: "8px 14px",
    background: disabled ? T.surfaceAlt : T.accent,
    color: disabled ? T.muted : T.onAccent,
    border: `1px solid ${disabled ? T.border : T.accent}`,
    borderRadius: T.radiusSm,
    fontSize: 13, fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
  }
}
function btnSecondary(disabled) {
  return {
    display: "inline-flex", alignItems: "center", gap: 6,
    padding: "8px 14px",
    background: "transparent",
    color: disabled ? T.muted : T.sub,
    border: `1px solid ${T.border}`,
    borderRadius: T.radiusSm,
    fontSize: 13, fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
  }
}

