import { useOutletContext } from "react-router-dom"
import { Section } from "../components/layout/Section.jsx"
import { TrajectoryBlock } from "../components/charts/TrajectoryBlock.jsx"
import { EmptyState } from "../components/EmptyState.jsx"

export default function TrendsPage() {
  const { rows: loadedRows, view, enrichedAnalyst, teamMembersAll, dateRange } = useOutletContext()
  if (!loadedRows) return <Section title="Trends Over Time"><EmptyState /></Section>
  // Team view uses the unfiltered all-members slice so trajectory keeps the
  // full longitudinal arc (matches the legacy TeamView behavior).
  const rows = view === "team"
    ? (teamMembersAll ? teamMembersAll.flatMap((m) => m.rows) : enrichedAnalyst)
    : enrichedAnalyst
  const highlightRange = dateRange?.from != null ? dateRange : null

  return (
    <Section
      title="Trends Over Time"
      subtitle={
        view === "team"
          ? "Team-wide backlog trajectory and weekly intake-versus-resolved cadence. Use this to see whether the team is keeping pace with incoming work, or whether work is accumulating faster than it can be cleared. The shaded band marks the active date filter, if any."
          : "How the backlog has moved over time, and whether intake is outpacing resolution week to week. The daily line shows the open-case count from the oldest record to today; the weekly bars compare new cases versus resolved ones to surface backlog growth or recovery. The shaded band marks the active date filter, if any."
      }
    >
      <TrajectoryBlock rows={rows} highlightRange={highlightRange} />
    </Section>
  )
}
