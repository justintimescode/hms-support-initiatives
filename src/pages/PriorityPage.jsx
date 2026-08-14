import { useOutletContext } from "react-router-dom"
import { Section } from "../components/layout/Section.jsx"
import { PriorityBlock } from "../components/charts/PriorityBlock.jsx"
import { PriorityTrendBlock } from "../components/charts/PriorityTrendBlock.jsx"
import { EmptyState } from "../components/EmptyState.jsx"
import { useQuery } from "../lib/useQuery.js"
import { getPriorityData } from "../lib/queries.js"
import { DevCompare } from "../components/dev/DevCompare.jsx"
import { flattenByKey } from "../components/dev/devCompareUtils.js"

export default function PriorityPage() {
  const { rows: loadedRows, view, priorityData, enriched, enrichedAnalyst, teamMembers, teamMembersAll, analyst, manager, dateRange } = useOutletContext()
  // Phase 1 validation: SQL getPriorityData vs in-memory priorityData.
  const dr = dateRange || { from: null, to: null, field: "_created" }
  const sql = useQuery(
    () => getPriorityData({ analyst, manager, dateRange: dr }),
    [analyst, manager, dr.from, dr.to, dr.field],
    { enabled: !!loadedRows },
  )
  if (!loadedRows) return <Section title="Priority Analysis"><EmptyState /></Section>
  const rows = view === "team"
    ? (teamMembers ? teamMembers.flatMap((m) => m.rows) : enriched)
    : enriched

  return (
    <Section
      title="Priority Analysis"
      subtitle={
        view === "team"
          ? "How case priority shapes both volume and resolution time across the team."
          : "How case priority shapes both volume and resolution time. Helps confirm whether high-priority work is actually being handled faster than lower-priority work, and where the biggest workload sits."
      }
    >
      <DevCompare
        label="getPriorityData"
        note={`analyst: ${analyst === "__all__" ? "all" : analyst}`}
        metrics={flattenByKey(priorityData, sql.data, "priority", ["total", "closed", "sla_met", "sla_total", "avg_res_h"])}
      />
      <PriorityBlock priorityData={priorityData} rows={rows} />
      <div style={{ marginTop: 12 }}>
        <PriorityTrendBlock
          rows={view === "team"
            ? (teamMembersAll ? teamMembersAll.flatMap((m) => m.rows) : enrichedAnalyst)
            : enrichedAnalyst}
          dateRange={dateRange?.from != null || dateRange?.to != null ? dateRange : null}
        />
      </div>
    </Section>
  )
}
