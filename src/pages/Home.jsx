import { useMemo, useState } from "react"
import { useOutletContext } from "react-router-dom"
import { FilterLink } from "../components/FilterLink.jsx"
import { FileSpreadsheet, ExternalLink, ClipboardList, Clock, Users } from "lucide-react"
import { T } from "../lib/theme.js"
import { fmtFullDate } from "../lib/format.js"
import { Section } from "../components/layout/Section.jsx"
import { Card } from "../components/layout/Card.jsx"
import { Pill } from "../components/Pill.jsx"
import { KpiRow } from "../components/KpiRow.jsx"
import { CaseListModal } from "../components/CaseListModal.jsx"
import { UploadScreen } from "../components/UploadScreen.jsx"
import { useQuery } from "../lib/useQuery.js"
import { getKpis, getCompareKpis } from "../lib/queries.js"
import { DevCompare } from "../components/dev/DevCompare.jsx"
import { kpiMetrics } from "../components/dev/devCompareUtils.js"

export default function Home() {
  const ctx = useOutletContext()
  const {
    rows, filename, snapshotMs, jiraState, kpis, compareKpis, analyst, manager, dateRange,
    compareWindow, enriched, handleFile, uploading, uploadError, inputRef,
    analystSel, managerSel, productSel, prioritySel, regionSel,
  } = ctx
  const dr = dateRange || { from: null, to: null, field: "_created" }
  const [showMissedSla, setShowMissedSla] = useState(false)
  // The complement of the card's "met" count: SLA-eligible cases in the
  // current slice that breached the SOP cadence (open or closed).
  const missedSlaRows = useMemo(
    () => (enriched || []).filter((r) => r._slaEligible && r._slaBreached),
    [enriched],
  )
  // Dev-only JS-vs-SQL parity check. Feed it the SAME multi-selects the
  // in-memory KPIs use so the two agree under multi-select. `region` is
  // in-memory only (not in the SQL schema), so the SQL side can't apply it —
  // the DevCompare intentionally diverges while a region filter is active.
  const selKey = (a) => (a || []).join(".")
  const kpiSql = useQuery(
    () => getKpis({ analyst: analystSel, manager: managerSel, product: productSel, priority: prioritySel, dateRange: dr }),
    [selKey(analystSel), selKey(managerSel), selKey(productSel), selKey(prioritySel), dr.from, dr.to, dr.field],
    { enabled: !!rows },
  )
  const cmpSql = useQuery(
    () => getCompareKpis({ analyst: analystSel, manager: managerSel, product: productSel, priority: prioritySel, compareWindow, field: dr.field }),
    [selKey(analystSel), selKey(managerSel), selKey(productSel), selKey(prioritySel), compareWindow?.from, compareWindow?.to, dr.field],
    { enabled: !!rows && !!compareWindow },
  )

  // First run: no import yet. This is the whole onboarding — one required step
  // (drop an export), with Jira called out as the optional extra it is.
  if (!rows) {
    return (
      <UploadScreen
        onPick={handleFile}
        uploading={uploading}
        error={uploadError}
        inputRef={inputRef}
      />
    )
  }


  return (
    <>
      <Section
        title="Dashboard"
        subtitle="Top-line numbers for the current view, plus quick access to every page."
      >
        <KpiRow kpis={kpis} compareKpis={compareKpis} onSlaClick={() => setShowMissedSla(true)} />
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

      {showMissedSla && (
        <CaseListModal
          title="Cases that missed SLA"
          subtitle={`${missedSlaRows.length} of ${kpis.slaEligible} SLA-eligible cases in the current view breached the SOP response cadence.`}
          rows={missedSlaRows}
          onClose={() => setShowMissedSla(false)}
        />
      )}
    </>
  )
}

function ConnectionStrip({ icon: Icon, title, sub, pillTone, pillLabel }) {
  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <Icon size={14} strokeWidth={2.25} style={{ color: T.accent, flexShrink: 0 }} />
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
    <FilterLink
      to={to}
      style={{
        textDecoration: "none",
        color: T.ink,
      }}
    >
      <Card className="hoverlift" style={{ cursor: "pointer", display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Icon size={14} strokeWidth={2.25} style={{ color: T.accent }} />
          <span style={{ fontWeight: 600, fontSize: 14 }}>{label}</span>
        </div>
        <div style={{ color: T.sub, fontSize: 12 }}>{hint}</div>
      </Card>
    </FilterLink>
  )
}

// Jira is an optional source, so an absent connection reads as neutral
// ("not connected", muted) rather than as a problem to fix.
function jiraSummary(jiraState) {
  if (!jiraState) return "Optional — connect in Settings"
  const { status, meta } = jiraState
  if (status === "ready" && meta?.count != null) return `${meta.count} issues cached`
  if (status === "unconfigured") return "Optional — connect in Settings"
  if (status === "error") return jiraState.error || "Sync failed"
  if (status === "loading") return "Syncing…"
  if (status === "hydrating") return "Loading cache…"
  return "Idle"
}
function jiraPillTone(jiraState) {
  const s = jiraState?.status
  if (s === "ready") return T.ok
  if (s === "loading" || s === "hydrating") return T.warn
  if (s === "error") return T.danger
  return T.muted
}
function jiraPillLabel(jiraState) {
  const s = jiraState?.status
  if (s === "ready") return "connected"
  if (s === "loading") return "syncing…"
  if (s === "hydrating") return "loading…"
  if (s === "unconfigured") return "not connected"
  if (s === "error") return "error"
  return "idle"
}
