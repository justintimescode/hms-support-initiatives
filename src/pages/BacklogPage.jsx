import { useOutletContext } from "react-router-dom"
import { Section } from "../components/layout/Section.jsx"
import { SlaRiskBlock } from "../components/charts/SlaRiskBlock.jsx"
import { AssigneeAgingBlock } from "../components/charts/AssigneeAgingBlock.jsx"
import { StuckCasesList } from "../components/StuckCasesList.jsx"
import { CaseInteractionList } from "../components/CaseInteractionList.jsx"
import { EmptyState } from "../components/EmptyState.jsx"

export default function BacklogPage() {
  const { rows, view, enriched, teamMembers, teamMembersAll } = useOutletContext()
  void teamMembersAll
  if (!rows) return <Section title="Open Backlog"><EmptyState /></Section>
  const allRows = (teamMembers || []).flatMap((m) => m.rows)
  const isTeam = view === "team"

  if (isTeam) {
    return (
      <Section title="Open Backlog" subtitle="Open cases across the team, sliced by who's holding them and how long they've been open. The stacked bars show whose queue is graying; the stuck-cases list calls out the actual cases sitting over 30 days, with assignee.">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <AssigneeAgingBlock members={teamMembers} />
          <StuckCasesList rows={allRows} showAssignee />
        </div>
      </Section>
    )
  }

  return (
    <>
      <Section title="Open Backlog" subtitle="What's still on this analyst's plate, framed by SLA pressure rather than calendar age. The SLA-risk chart shows what to work on next; the stuck-cases list surfaces individual cases that have been sitting longer than 30 days.">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <SlaRiskBlock rows={enriched} />
          <StuckCasesList rows={enriched} />
        </div>
      </Section>
      <Section title="Interaction Breakdown" subtitle="How many back-and-forth turns each case required, sorted by noisiest first. Cases with many customer turns may signal unclear workarounds or recurring issues; cases with many analyst turns may indicate complex investigation work.">
        <CaseInteractionList rows={enriched} />
      </Section>
    </>
  )
}
