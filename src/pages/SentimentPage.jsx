import { useOutletContext } from "react-router-dom";
import { Section } from "../components/layout/Section.jsx";
import { EmptyState } from "../components/EmptyState.jsx";
import { SentimentBlock } from "../components/charts/SentimentBlock.jsx";

/* Customer sentiment, graded on device. Sources the current filtered rows
 * exactly like InsightsPage (individual vs team view) so the persistent filter
 * bar keeps working here. Sentiment is read from the baked `sentiment_*`
 * columns; nothing is sent to a model. */
export default function SentimentPage() {
  const { rows: loadedRows, view, enriched, teamMembers } = useOutletContext();
  if (!loadedRows) return <Section title="Customer Sentiment"><EmptyState /></Section>;
  const rows = view === "team"
    ? (teamMembers ? teamMembers.flatMap((m) => m.rows) : enriched)
    : enriched;
  return (
    <Section
      title="Customer Sentiment"
      subtitle="A deterministic, on-device read of the customer-visible comment stream — valence, arc, emotions, responsiveness and hygiene — reproducing the structured columns of the LLM sentiment review without sending any case to a model. Exact on coverage, responsiveness and hygiene; directional on tone."
    >
      <SentimentBlock rows={rows} />
    </Section>
  );
}
