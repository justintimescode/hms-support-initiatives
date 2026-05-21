import { useOutletContext } from "react-router-dom"
import { Section } from "../components/layout/Section.jsx"
import { WeekdayBlock } from "../components/charts/WeekdayBlock.jsx"
import { IntakeHeatmap } from "../components/charts/IntakeHeatmap.jsx"
import { EmptyState } from "../components/EmptyState.jsx"

export default function CadencePage() {
  const { rows: loadedRows, view, enriched, teamMembers } = useOutletContext()
  if (!loadedRows) return <Section title="Workload Cadence"><EmptyState /></Section>
  const rows = view === "team"
    ? (teamMembers ? teamMembers.flatMap((m) => m.rows) : enriched)
    : enriched

  return (
    <Section
      title="Workload Cadence"
      subtitle={
        view === "team"
          ? "Team-wide weekly rhythm. The bars show average open caseload and case creation by weekday; the heatmap pinpoints the weekday-and-hour slots where intake concentrates. Useful for staffing decisions and on-call coverage. Click a heatmap tile to see the cases created in that slot."
          : "How workload distributes across the week. The first chart shows the average number of cases open on each weekday, the second shows when new cases get created, and the heatmap pinpoints the exact weekday-and-hour slots where intake concentrates. Useful for spotting Monday spikes, weekend backlogs, and shifts in staffing needs. Click any tile to see the cases created in that slot."
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <WeekdayBlock rows={rows} />
        <IntakeHeatmap rows={rows} />
      </div>
    </Section>
  )
}
