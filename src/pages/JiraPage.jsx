import { useOutletContext } from "react-router-dom"
import { PROJECT_KEY } from "../lib/jira-client.js"
import { Section } from "../components/layout/Section.jsx"
import { JiraAnalysisBlock } from "../components/jira/JiraAnalysisBlock.jsx"
import { EmptyState } from "../components/EmptyState.jsx"

export default function JiraPage() {
  const { rows, analyst, jiraState, syncJira, hydrateFromCache } = useOutletContext()
  if (!rows) return <Section title="All HMS Jira's"><EmptyState /></Section>

  return (
    <Section title="All HMS Jira's" subtitle={`Live engineering analytics for the ${PROJECT_KEY} Jira project, pulled directly from Atlassian. This view covers the whole project — it is not filtered by the analyst selector or date range above.`}>
      <JiraAnalysisBlock
        jiraState={jiraState}
        onSync={syncJira}
        onLoadCache={hydrateFromCache}
        scopeNote={analyst !== "__all__" ? analyst : null}
      />
    </Section>
  )
}
