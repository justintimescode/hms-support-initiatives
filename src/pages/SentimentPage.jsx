import { useOutletContext } from "react-router-dom";
import { Section } from "../components/layout/Section.jsx";
import { EmptyState } from "../components/EmptyState.jsx";
import { SentimentBlock } from "../components/charts/SentimentBlock.jsx";

/* Customer sentiment & escalation early-warning. Sources the current filtered
 * rows exactly like InsightsPage (individual vs team view) so the persistent
 * filter bar keeps working here. Reads the baked `sentiment_*` columns; nothing
 * is sent to a model. */
export default function SentimentPage() {
  const { rows: loadedRows, view, enriched, teamMembers } = useOutletContext();
  if (!loadedRows) return <Section title="Case Sentiment"><EmptyState /></Section>;
  const rows = view === "team"
    ? (teamMembers ? teamMembers.flatMap((m) => m.rows) : enriched)
    : enriched;
  return (
    <Section
      title="Case Sentiment"
      subtitle="What the customer is telling us, read deterministically on device from their own messages. Open cases are ranked by escalation risk (unanswered messages, chasing, recurring issues, souring tone) so trouble surfaces before an escalation lands; Solution Proposed cases are watched for reopen signals; closed cases are reviewed for how they ended."
    >
      <SentimentBlock rows={rows} />
    </Section>
  );
}
