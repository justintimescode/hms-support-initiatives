import { useOutletContext } from "react-router-dom"
import { Section } from "../components/layout/Section.jsx"
import { OwnedCasesBlock } from "../components/charts/OwnedCasesBlock.jsx"
import { TrajectoryBlock } from "../components/charts/TrajectoryBlock.jsx"
import { ClosedCadenceBlock } from "../components/charts/ClosedCadenceBlock.jsx"
import { EmptyState } from "../components/EmptyState.jsx"

export default function TrendsPage() {
  const { rows: loadedRows, view, enrichedAnalyst, teamMembersAll, dateRange, snapshotMs } = useOutletContext()
  if (!loadedRows) return <Section title="Trends Over Time"><EmptyState /></Section>
  // Team view uses the unfiltered all-members slice so trajectory keeps the
  // full longitudinal arc (matches the legacy TeamView behavior).
  const rows = view === "team"
    ? (teamMembersAll ? teamMembersAll.flatMap((m) => m.rows) : enrichedAnalyst)
    : enrichedAnalyst
  // The charts still receive the UNFILTERED rows — they zoom by slicing their own
  // precomputed series, which is what keeps cumulative counts and rolling
  // averages correct at the left edge of the window. See lib/time-axis.js.
  const range = dateRange?.from != null ? dateRange : null

  return (
    <Section
      title="Trends Over Time"
      subtitle={
        view === "team"
          ? "Team-wide backlog trajectory and weekly intake-versus-resolved cadence. Use this to see whether the team is keeping pace with incoming work, or whether work is accumulating faster than it can be cleared. Charts zoom to the active date filter; switch any card to All time for the full arc."
          : "How the backlog has moved over time, and whether intake is outpacing resolution week to week. The daily line shows the open-case count; a daily bar chart tracks how many cases were actually closed each day; the weekly bars compare new cases versus resolved ones to surface backlog growth or recovery. Charts zoom to the active date filter; switch any card to All time for the full arc."
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <OwnedCasesBlock rows={rows} dateRange={range} snapshotMs={snapshotMs} />
        <TrajectoryBlock rows={rows} dateRange={range} snapshotMs={snapshotMs} />
        <ClosedCadenceBlock rows={rows} dateRange={range} snapshotMs={snapshotMs} />
      </div>
    </Section>
  )
}
