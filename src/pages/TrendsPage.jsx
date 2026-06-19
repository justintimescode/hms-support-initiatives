import { useOutletContext } from "react-router-dom"
import { Section } from "../components/layout/Section.jsx"
import { OwnedCasesBlock } from "../components/charts/OwnedCasesBlock.jsx"
import { TrajectoryBlock } from "../components/charts/TrajectoryBlock.jsx"
import { ClosedCadenceBlock } from "../components/charts/ClosedCadenceBlock.jsx"
import { BacklogForecastBlock } from "../components/charts/BacklogForecastBlock.jsx"
import { EmptyState } from "../components/EmptyState.jsx"

export default function TrendsPage() {
  const { rows: loadedRows, view, enrichedAnalyst, teamMembersAll, dateRange, snapshotMs } = useOutletContext()
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
          : "How the backlog has moved over time, and whether intake is outpacing resolution week to week. The daily line shows the open-case count from the oldest record to today; a daily bar chart tracks how many cases were actually closed each day; the weekly bars compare new cases versus resolved ones to surface backlog growth or recovery. The shaded band marks the active date filter, if any."
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <OwnedCasesBlock rows={rows} highlightRange={highlightRange} snapshotMs={snapshotMs} />
        <TrajectoryBlock rows={rows} highlightRange={highlightRange} snapshotMs={snapshotMs} />
        <ClosedCadenceBlock rows={rows} highlightRange={highlightRange} snapshotMs={snapshotMs} />
        <BacklogForecastBlock rows={rows} snapshotMs={snapshotMs} />
      </div>
    </Section>
  )
}
