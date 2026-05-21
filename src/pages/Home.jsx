import { useOutletContext, Link } from "react-router-dom"
import { FileSpreadsheet, ExternalLink, ClipboardList, Clock, Users } from "lucide-react"
import { T } from "../lib/theme.js"
import { fmtFullDate } from "../lib/format.js"
import { Section } from "../components/layout/Section.jsx"
import { Card } from "../components/layout/Card.jsx"
import { Pill } from "../components/Pill.jsx"
import { KpiRow } from "../components/KpiRow.jsx"
import { EmptyState } from "../components/EmptyState.jsx"
import { useQuery } from "../lib/useQuery.js"
import { getKpis, getCompareKpis } from "../lib/queries.js"
import { DevCompare } from "../components/dev/DevCompare.jsx"
import { kpiMetrics } from "../components/dev/devCompareUtils.js"

export default function Home() {
  const ctx = useOutletContext()
  const { rows, filename, snapshotMs, jiraState, kpis, compareKpis, analyst, dateRange, compareWindow } = ctx
  const dr = dateRange || { from: null, to: null, field: "_created" }
  const kpiSql = useQuery(() => getKpis({ analyst, dateRange: dr }), [analyst, dr.from, dr.to, dr.field], { enabled: !!rows })
  const cmpSql = useQuery(
    () => getCompareKpis({ analyst, compareWindow, field: dr.field }),
    [analyst, compareWindow?.from, compareWindow?.to, dr.field],
    { enabled: !!rows && !!compareWindow },
  )

  if (!rows) {
    return (
      <Section title="Dashboard">
        <EmptyState
          title="Welcome — load some data to begin"
          message="This is a local case-analytics tool for the ServiceNow case export. Drop a CSV or XLSX on the Connections page and every other tab populates automatically. Nothing leaves your browser."
        />
      </Section>
    )
  }

  return (
    <>
      <Section
        title="Dashboard"
        subtitle="Top-line numbers for the current view, plus quick access to every page."
      >
        <KpiRow kpis={kpis} compareKpis={compareKpis} />
        <DevCompare label="getKpis" note={`analyst: ${analyst === "__all__" ? "all" : analyst}`} metrics={kpiMetrics(kpis, kpiSql.data)} />
        {compareWindow && <DevCompare label="getCompareKpis" note={`analyst: ${analyst === "__all__" ? "all" : analyst}`} metrics={kpiMetrics(compareKpis, cmpSql.data)} />}
      </Section>

      <Section title="Connections">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
          <ConnectionStrip
            icon={FileSpreadsheet}
            title={filename || "ServiceNow case export"}
            sub={`${rows.length.toLocaleString()} rows${snapshotMs ? ` · loaded ${fmtFullDate(snapshotMs)}` : ""}`}
            pillTone={T.ok}
            pillLabel="loaded"
          />
          <ConnectionStrip
            icon={ExternalLink}
            title="Jira"
            sub={jiraSummary(jiraState)}
            pillTone={jiraPillTone(jiraState)}
            pillLabel={jiraPillLabel(jiraState)}
          />
        </div>
      </Section>

      <Section title="Jump to">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
          <ShortcutCard to="/update-queue" icon={ClipboardList} label="Update Queue" hint="Cases needing an Infor reply" />
          <ShortcutCard to="/sla" icon={Clock} label="SLA Performance" hint="Hit rate + breaches" />
          <ShortcutCard to="/team" icon={Users} label="Team Leaderboard" hint="Side-by-side metrics" />
        </div>
      </Section>
    </>
  )
}

function ConnectionStrip({ icon: Icon, title, sub, pillTone, pillLabel }) {
  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <Icon size={14} style={{ color: T.accent, flexShrink: 0 }} />
          <span style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
        </div>
        <Pill color={pillTone}>{pillLabel}</Pill>
      </div>
      <div style={{ color: T.sub, fontSize: 12, marginTop: 6 }}>{sub}</div>
    </Card>
  )
}

function ShortcutCard({ to, icon: Icon, label, hint }) {
  return (
    <Link
      to={to}
      style={{
        textDecoration: "none",
        color: T.ink,
      }}
    >
      <Card className="hoverlift" style={{ cursor: "pointer", display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Icon size={14} style={{ color: T.accent }} />
          <span style={{ fontWeight: 600, fontSize: 14 }}>{label}</span>
        </div>
        <div style={{ color: T.sub, fontSize: 12 }}>{hint}</div>
      </Card>
    </Link>
  )
}

function jiraSummary(jiraState) {
  if (!jiraState) return "Not configured"
  const { status, meta } = jiraState
  if (status === "ready" && meta?.count != null) return `${meta.count} issues cached`
  if (status === "unconfigured") return "Add a token in .env to sync"
  if (status === "error") return jiraState.error || "Sync failed"
  if (status === "loading") return "Syncing…"
  if (status === "hydrating") return "Loading cache…"
  return "Idle"
}
function jiraPillTone(jiraState) {
  const s = jiraState?.status
  if (s === "ready") return T.ok
  if (s === "loading" || s === "hydrating") return T.warn
  if (s === "unconfigured" || s === "error") return T.danger
  return T.muted
}
function jiraPillLabel(jiraState) {
  const s = jiraState?.status
  if (s === "ready") return "connected"
  if (s === "loading") return "syncing…"
  if (s === "hydrating") return "loading…"
  if (s === "unconfigured") return "needs token"
  if (s === "error") return "error"
  return "idle"
}
