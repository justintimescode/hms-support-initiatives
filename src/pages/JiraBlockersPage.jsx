import { useOutletContext } from "react-router-dom"
import { Section } from "../components/layout/Section.jsx"
import { JiraDashboard } from "../components/jira/JiraDashboard.jsx"
import { EmptyState } from "../components/EmptyState.jsx"
import { isJiraBlocked } from "../lib/enrich.js"

export default function JiraBlockersPage() {
  const { rows, view, enrichedAnalyst, teamMembers, jiraState } = useOutletContext()
  if (!rows) return <Section title="Cases w/ Jira Blockers"><EmptyState /></Section>
  // Case-side rows: team aggregate when no analyst is selected, otherwise
  // this analyst's slice.
  const allRows = view === "team"
    ? (teamMembers ? teamMembers.flatMap((m) => m.rows) : enrichedAnalyst)
    : enrichedAnalyst
  // A case counts as blocked when it references a Jira ticket OR its Status
  // hands it to engineering (Development Researching / Code Fix Pending / Code
  // Deployment Pending) — engineering owns it even before a Jira reference
  // lands in the journal.
  const blockerRows = (allRows || []).filter(isJiraBlocked)

  return (
    <Section title="Cases w/ Jira Blockers" subtitle="Open cases waiting on engineering work — those with a Jira reference plus those in a Development Researching, Code Fix Pending, or Code Deployment Pending status. Cases here are gated by engineering rather than analyst capacity, so they need a different intervention than the rest of the backlog.">
      <JiraDashboard rows={blockerRows} jiraConnected={jiraState?.status === "ready"} />
    </Section>
  )
}
