import { useOutletContext } from "react-router-dom"
import { T } from "../lib/theme.js"
import { Card } from "../components/layout/Card.jsx"
import { TeamView } from "./TeamView.jsx"
import { Section } from "../components/layout/Section.jsx"
import { EmptyState } from "../components/EmptyState.jsx"

/* The team leaderboard + member-profile + interaction-quality cluster.
 * Re-uses TeamView's existing "team" section verbatim; future cleanup
 * (Phase 6) will fold the inline JSX directly into this file. */
export default function TeamPage() {
  const ctx = useOutletContext()
  const { rows } = ctx
  const {
    analyst, manager,
    teamMembers, teamMembersAll, compareTeamKpis, compareWindow,
    dateRange, kpis, priorityData, categoryData, accountData, productData,
    enriched, enrichedAnalyst,
    aiState, runAiAnalysis, memberAi, runMemberAi, drillIntoMember,
    dbReady, snapshotMs, jiraState, syncJira, hydrateFromCache,
  } = ctx
  if (!rows) return <Section title="Team Leaderboard"><EmptyState /></Section>
  return (
    <>
      {analyst !== "__all__" && <TeamOnlyNote />}
      <TeamView
        page="team"
        printMode={null}
        manager={manager}
        members={teamMembers}
        allMembers={teamMembersAll}
        compareTotals={compareTeamKpis}
        compareWindow={compareWindow}
        highlightRange={dateRange}
        kpis={kpis}
        priorityData={priorityData}
        categoryData={categoryData}
        accountData={accountData}
        productData={productData}
        enriched={enriched}
        enrichedAnalyst={enrichedAnalyst}
        aiState={aiState}
        runAiAnalysis={runAiAnalysis}
        memberAi={memberAi}
        runMemberAi={runMemberAi}
        drillIntoMember={drillIntoMember}
        dbReady={dbReady}
        snapshotMs={snapshotMs}
        jiraState={jiraState}
        syncJira={syncJira}
        hydrateFromCache={hydrateFromCache}
      />
    </>
  )
}

function TeamOnlyNote() {
  return (
    <Card style={{ marginBottom: 12, borderLeft: `3px solid ${T.warn}` }}>
      <div className="eyebrow" style={{ color: T.warn }}>Team-wide view</div>
      <div style={{ fontSize: 12, color: T.sub, marginTop: 4 }}>
        The leaderboard, member profiles, and interaction quality are inherently team-scoped. The selected analyst is reflected only in the row highlight.
      </div>
    </Card>
  )
}
