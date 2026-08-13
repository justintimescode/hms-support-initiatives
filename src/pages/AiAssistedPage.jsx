import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { T } from "../lib/theme.js";
import { ALL_CASES, hasAnyTagData } from "../lib/ai-tags.js";
import { Section } from "../components/layout/Section.jsx";
import { Card } from "../components/layout/Card.jsx";
import { EmptyState } from "../components/EmptyState.jsx";
import { AiTagSummaryBlock } from "../components/charts/AiTagSummaryBlock.jsx";
import { AiTagDistributionBlock } from "../components/charts/AiTagDistributionBlock.jsx";
import { AiAnalystAdoptionBlock } from "../components/charts/AiAnalystAdoptionBlock.jsx";
import { AiTagTrendBlock } from "../components/charts/AiTagTrendBlock.jsx";
import { AiEffectivenessBlock } from "../components/charts/AiEffectivenessBlock.jsx";
import { AiCaseExplorer } from "../components/AiCaseExplorer.jsx";

/* Everything the ServiceNow `Tags` column can tell us about AI assistance, in one
 * place: how much of the book is tagged at all (a compliance measure), what the
 * tags say happened when AI was tried, who is recording it, how that has moved,
 * and the cases behind any of it.
 *
 * The tab is built entirely on the in-memory enriched rows — `tags` is a raw
 * passthrough with no SQL column (see lib/ai-tags.js), so nothing here queries
 * DuckDB and no import needs rebuilding.
 *
 * Two guards, and the second one matters: an import whose export layout has no
 * `Tags` column would otherwise render a wall of zeros reading as "this team never
 * uses AI" instead of "this export can't tell you". */
export default function AiAssistedPage() {
  const {
    rows, view, enriched, enrichedAnalyst, teamMembers, teamMembersAll, dateRange, snapshotMs,
  } = useOutletContext();
  const [selection, setSelection] = useState(ALL_CASES);

  // Point-in-time slice: analyst + date filtered, matching every other tab.
  const viewRows = useMemo(
    () => (view === "team" ? (teamMembers ? teamMembers.flatMap((m) => m.rows) : enriched) : enriched),
    [view, teamMembers, enriched],
  );
  // Trend slice: date-unfiltered on purpose. The chart zooms by slicing its own
  // precomputed buckets, so it needs the complete arc to slice FROM — and the
  // "All time" toggle needs it to fall back to (same idiom as DodPage /
  // TrendsPage). See lib/time-axis.js.
  const trendRows = useMemo(
    () =>
      view === "team"
        ? (teamMembersAll ? teamMembersAll.flatMap((m) => m.rows) : enrichedAnalyst)
        : enrichedAnalyst,
    [view, teamMembersAll, enrichedAnalyst],
  );
  const range = dateRange?.from != null ? dateRange : null;

  if (!rows) {
    return (
      <Section title="AI Assisted?">
        <EmptyState />
      </Section>
    );
  }

  const anyTagData = hasAnyTagData(trendRows?.length ? trendRows : viewRows || []);

  return (
    <Section
      title="AI Assisted?"
      subtitle={
        view === "team"
          ? "What the ServiceNow Tags column says about AI assistance across the team. Coverage first — how much of the book is tagged at all — then what the tags report when AI was actually tried, who is recording it, and how both have moved over time. Percentages always name their denominator; untagged cases are counted as unknown, never as a failure."
          : "What the ServiceNow Tags column says about AI assistance on your cases. Coverage first — how much of your book carries a tag at all — then what those tags report when AI was actually tried, and how that has moved over time. Percentages always name their denominator; untagged cases are counted as unknown, never as a failure. Switch the analyst filter to Team to compare adoption across the team."
      }
    >
      {!anyTagData ? (
        <Card>
          <div className="eyebrow" style={{ color: T.warn }}>No AI tags in this import</div>
          <div style={{ color: T.sub, fontSize: 13, marginTop: 8, maxWidth: 700, lineHeight: 1.6 }}>
            Not one case in this import carries a value in the ServiceNow{" "}
            <span className="mono">Tags</span> column. Either the export predates the column — older
            report layouts don't include it — or no case has been tagged yet.
            <br />
            <br />
            To fix the first case, re-export from ServiceNow with <span className="mono">Tags</span>{" "}
            selected and import it from <strong>Connections</strong>. Existing imports pick the
            column up automatically when re-activated, as long as the stored file had it.
          </div>
        </Card>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <AiTagSummaryBlock rows={viewRows} onSelect={setSelection} />
          <AiTagDistributionBlock rows={viewRows} />
          {view === "team" ? (
            <AiAnalystAdoptionBlock rows={viewRows} />
          ) : (
            <Card>
              <div className="eyebrow" style={{ color: T.muted }}>AI tagging adoption by analyst</div>
              <div style={{ color: T.sub, fontSize: 13, marginTop: 8, maxWidth: 700 }}>
                Adoption is a team comparison — set the analyst filter to{" "}
                <strong>All analysts</strong> in the bar above to rank every analyst by how much of
                their case load carries a tag.
              </div>
            </Card>
          )}
          <AiTagTrendBlock rows={trendRows} dateRange={range} snapshotMs={snapshotMs} />
          <AiEffectivenessBlock rows={viewRows} />
          <AiCaseExplorer rows={viewRows} selection={selection} onSelectionChange={setSelection} />
        </div>
      )}
    </Section>
  );
}
