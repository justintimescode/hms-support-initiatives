import { useOutletContext } from "react-router-dom"
import { Section } from "../components/layout/Section.jsx"
import { JiraDashboard } from "../components/jira/JiraDashboard.jsx"
import { EmptyState } from "../components/EmptyState.jsx"

export default function JiraBlockersPage() {
  const { rows, view, enrichedAnalyst, teamMembers, jiraState } = useOutletContext()
  if (!rows) return <Section title="Cases w/ Jira Blockers"><EmptyState /></Section>
  // Case-side rows: team aggregate when no analyst is selected, otherwise
  // this analyst's slice.
  const allRows = view === "team"
    ? (teamMembers ? teamMembers.flatMap((m) => m.rows) : enrichedAnalyst)
    : enrichedAnalyst
  const blockerRows = (allRows || []).filter(
    (r) => !r._isClosed && r._jiraTickets && r._jiraTickets.length > 0,
  )

  return (
    <Section title="Cases w/ Jira Blockers" subtitle="Open cases waiting on engineering work. Cases here are gated by a Jira ticket rather than analyst capacity, so they need a different intervention than the rest of the backlog.">
      <JiraDashboard rows={blockerRows} jiraConnected={jiraState?.status === "ready"} />
    </Section>
  )
}
