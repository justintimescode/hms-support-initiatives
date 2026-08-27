import { useCallback, useMemo } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import { Download } from "lucide-react";
import { T } from "../lib/theme.js";
import { fmtFullDateTime } from "../lib/format.js";
import { Section } from "../components/layout/Section.jsx";
import { Card } from "../components/layout/Card.jsx";
import { EmptyState } from "../components/EmptyState.jsx";
import { downloadCsv, csvTimestamp } from "../lib/csv-export.js";
import { clustersToCsv, casesToCsv } from "../lib/insights-csv.js";
import { buildInsights, blockersByJira } from "../lib/insight-rank.js";
import {
  filterClusters, matchedCasesOf, facetsOf, bandCounts,
  filterableDimensions, resolveDimensions, decodeDimTokens, encodeDimToken,
} from "../lib/insight-filters.js";
import { ClusterCard } from "../components/insights/ClusterCard.jsx";
import { OperationsFilterBar } from "../components/insights/OperationsFilterBar.jsx";
import {
  AgeComparisonBlock, ImpactHistogramBlock, EscalationHeatmapBlock, BandBreakdownBlock,
  JiraStatusBandHeatmapBlock, AccountJiraHeatmapBlock, BlockerQuadrantBlock,
} from "../components/insights/InsightCharts.jsx";

/* Impact Clusters — the unified Jira <-> ServiceNow correlation view.
 *
 * The link between a Jira ticket and a ServiceNow case lives IN the ServiceNow
 * case: `parseJiraRefs` extracts it from the journals and the `cause` field. This
 * page correlates those references into connected components, so one Jira
 * spanning several cases, one case blocked by several Jiras, and the transitive
 * groups that fall out of both all appear as single ecosystems ranked by real
 * customer impact rather than by ticket age.
 *
 * Two structural rules the code here follows:
 *
 *   CORRELATE ONCE. `buildInsights` is memoized on [rows, issues, snapshotMs] —
 *   the filters are NOT in that key. Every filter below selects from the result.
 *   Per PERF_BASELINE §3 the aggregation layer is ~5 ms while per-row enrichment
 *   is ~664 ms, so the cost that matters is upstream; re-correlating per keystroke
 *   would still be pure waste.
 *
 *   NO METRIC MATH IN JSX. Everything rendered is finished data from the pure
 *   modules. No component on this page reads a clock — every figure is anchored
 *   to the active import, so the same upload always renders identically. */

const RENDER_LIMIT = 60;

export default function OperationsPage() {
  const {
    rows, enrichedAllJoined, jiraState, snapshotMs, analyst, manager, dateRange,
  } = useOutletContext();
  const [params, setParams] = useSearchParams();

  const issues = jiraState?.issues;

  /* ---------------- correlate ONCE ---------------- */
  const built = useMemo(
    () => buildInsights(enrichedAllJoined, issues, snapshotMs),
    [enrichedAllJoined, issues, snapshotMs],
  );
  const all = built.clusters;

  /* ---------------- URL-backed view filters ---------------- */
  // Opaque index tokens only — see insight-filters.js. Global params (?a, ?m,
  // ?from, ?to, ?field, ?compare) are never touched here.
  const dimTokens = useMemo(() => params.getAll("od"), [params]);
  const selectedDims = useMemo(() => decodeDimTokens(dimTokens, all), [dimTokens, all]);
  const bands = useMemo(() => params.getAll("ob"), [params]);
  const escalation = useMemo(() => params.getAll("oe"), [params]);
  const flags = useMemo(() => params.getAll("of"), [params]);
  const search = params.get("oq") || "";

  const setMulti = useCallback(
    (key, value) => {
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        const have = next.getAll(key);
        next.delete(key);
        const after = have.includes(value) ? have.filter((v) => v !== value) : [...have, value];
        for (const v of after) next.append(key, v);
        return next;
      }, { replace: true });
    },
    [setParams],
  );

  const toggleDimension = useCallback(
    (dimId, value) => {
      const token = encodeDimToken(dimId, value, all);
      if (token) setMulti("od", token);
    },
    [all, setMulti],
  );

  const onSearch = useCallback(
    (v) => {
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        if (v) next.set("oq", v);
        else next.delete("oq");
        return next;
      }, { replace: true });
    },
    [setParams],
  );

  const clearViewFilters = useCallback(() => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const k of ["od", "ob", "oe", "of", "oq"]) next.delete(k);
      return next;
    }, { replace: true });
  }, [setParams]);

  const criteria = useMemo(
    () => ({ analyst, manager, dateRange, dimensions: selectedDims, bands, escalation, flags, search }),
    [analyst, manager, dateRange, selectedDims, bands, escalation, flags, search],
  );

  /* ---------------- select (never re-correlate) ---------------- */
  const shown = useMemo(() => filterClusters(all, criteria), [all, criteria]);

  const dimsAvailable = useMemo(() => filterableDimensions(all), [all]);
  const dimsUnavailable = useMemo(
    () => resolveDimensions(all).filter((d) => !d.available && !d.globalOnly),
    [all],
  );
  // Memoized ONCE per correlation, not per render. `facetsOf` walks every member
  // of every cluster; called live from the filter bar it re-ran on every
  // keystroke (measured 80ms for a 20k-case import across 15 dimensions).
  const facetsByDim = useMemo(() => {
    const map = new Map();
    for (const d of dimsAvailable) map.set(d.id, facetsOf(all, d));
    return map;
  }, [all, dimsAvailable]);
  const facetsFor = useCallback((dim) => facetsByDim.get(dim.id) || [], [facetsByDim]);
  const bands3 = useMemo(() => bandCounts(shown), [shown]);
  // Per-Jira-key rows, computed ONCE for every chart below that needs the
  // ticket (rather than cluster) as its unit — same CORRELATE-ONCE discipline
  // as `built`/`shown` above, just one level down.
  const blockerRows = useMemo(() => blockersByJira(shown, snapshotMs), [shown, snapshotMs]);

  const matchedByCluster = useMemo(() => {
    const map = new Map();
    for (const c of shown) map.set(c.id, matchedCasesOf(c, criteria).map((x) => x.number));
    return map;
  }, [shown, criteria]);

  const totals = useMemo(() => {
    let openCases = 0, escalated = 0, flagged = 0;
    const accounts = new Set();
    for (const c of shown) {
      openCases += c.metrics.volume.openCases;
      if (c.metrics.escalation.level === "escalated") escalated++;
      if (c.clusterFlags.length) flagged++;
      for (const k of c.cases) if (k.account) accounts.add(k.account);
    }
    return { clusters: shown.length, openCases, accounts: accounts.size, escalated, flagged };
  }, [shown]);

  const activeCount =
    dimTokens.length + bands.length + escalation.length + flags.length + (search ? 1 : 0);
  const filterActive = activeCount > 0 || analyst !== "__all__" || manager !== "__all__";

  const exportClusters = () =>
    downloadCsv(`impact-clusters-${csvTimestamp()}.csv`, clustersToCsv(shown));
  const exportCases = () =>
    downloadCsv(`impact-cluster-cases-${csvTimestamp()}.csv`, casesToCsv(shown));

  /* ---------------- render ---------------- */
  if (!rows) {
    return (
      <Section title="Impact Clusters">
        <EmptyState message="Upload a ServiceNow case export to correlate cases with the Jira tickets they are waiting on. Jira is optional — the links are parsed from the case journals, so clusters appear with or without a Jira sync." />
      </Section>
    );
  }

  const jiraFetched = jiraState?.fetchedAt ? fmtFullDateTime(jiraState.fetchedAt) : null;

  return (
    <Section
      title="Impact Clusters"
      subtitle="Linked Jira and ServiceNow ecosystems, ranked by real customer impact rather than ticket age. Every score shows what it is made of, and every number is reproducible from this import. Free-text mentions of a ticket are shown but never counted as blocking — only the cause field and System link notes assert a real linkage."
    >
      {/* data-as-of, stated plainly: one anchor for the whole view */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 14, fontSize: 11.5, color: T.muted }}>
        <span>
          Cases as of{" "}
          <strong style={{ color: T.sub, fontWeight: 600 }}>
            {snapshotMs ? fmtFullDateTime(snapshotMs) : "—"}
          </strong>{" "}
          (every age and countdown here is measured against that, not the clock)
        </span>
        <span>
          Jira{" "}
          <strong style={{ color: T.sub, fontWeight: 600 }}>
            {jiraFetched ? `synced ${jiraFetched}` : "not synced"}
          </strong>
        </span>
      </div>

      {built.duplicateCaseNumbers.length > 0 && (
        <Card style={{ borderLeft: `3px solid ${T.warn}`, marginBottom: 14 }}>
          <div className="eyebrow" style={{ color: T.warn }}>Duplicate case numbers in this import</div>
          <div style={{ fontSize: 12, color: T.sub, marginTop: 5, lineHeight: 1.5 }}>
            {built.duplicateCaseNumbers.length} case number{built.duplicateCaseNumbers.length === 1 ? " is" : "s are"} claimed
            by more than one row, so those rows correlate as a single case and the counts below
            understate the real blast radius. This usually means the export repeated a column
            header. Re-export from ServiceNow, or rebuild this import from source.
            <span className="mono" style={{ display: "block", marginTop: 6, color: T.muted }}>
              {built.duplicateCaseNumbers.slice(0, 8).join(", ")}
              {built.duplicateCaseNumbers.length > 8 ? ` +${built.duplicateCaseNumbers.length - 8} more` : ""}
            </span>
          </div>
        </Card>
      )}

      {/* ---------- headline counts ---------- */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 16 }}>
        {[
          { label: "Clusters", value: totals.clusters, hint: `of ${all.length} in this import` },
          { label: "Open cases blocked", value: totals.openCases, hint: "truly open only" },
          { label: "Accounts affected", value: totals.accounts, hint: "distinct customers" },
          { label: "Escalated clusters", value: totals.escalated, hint: "explicit customer escalation", tone: totals.escalated ? T.danger : null },
          { label: "Named risk shapes", value: totals.flagged, hint: "matched a risk cluster", tone: totals.flagged ? T.warn : null },
        ].map((k) => (
          <Card key={k.label}>
            <div className="eyebrow" style={{ color: T.muted }}>{k.label}</div>
            <div className="display" style={{ fontSize: 30, fontWeight: 500, marginTop: 4, color: k.tone || T.ink }}>
              {k.value.toLocaleString()}
            </div>
            <div style={{ color: T.sub, fontSize: 11.5, marginTop: 3 }}>{k.hint}</div>
          </Card>
        ))}
      </div>

      <OperationsFilterBar
        dimensions={dimsAvailable}
        unavailable={dimsUnavailable}
        facetsFor={facetsFor}
        selected={selectedDims}
        bands={bands}
        escalation={escalation}
        flags={flags}
        search={search}
        onToggleDimension={toggleDimension}
        onToggleBand={(b) => setMulti("ob", b)}
        onToggleEscalation={(l) => setMulti("oe", l)}
        onToggleFlag={(f) => setMulti("of", f)}
        onSearch={onSearch}
        onClear={clearViewFilters}
        activeCount={activeCount}
      />

      {/* ---------- visualizations ---------- */}
      {/* Escalation x urgency leads, full width and its own row: it is the one
          chart that answers "where should attention go right now", and the
          three below it are supporting context, not equals. */}
      <div style={{ marginTop: 16 }}>
        <EscalationHeatmapBlock clusters={shown} snapshotMs={snapshotMs} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 12, marginTop: 12 }}>
        <AgeComparisonBlock clusters={shown} />
        <ImpactHistogramBlock clusters={shown} />
        <BandBreakdownBlock counts={bands3} onPick={(b) => b && setMulti("ob", b)} active={bands.length === 1 ? bands[0] : null} />
      </div>

      {/* ---------- Jira <-> ServiceNow cross-cuts (per-Jira-key) ---------- */}
      <div style={{ marginTop: 12 }}>
        <AccountJiraHeatmapBlock blockerRows={blockerRows} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: 12, marginTop: 12 }}>
        <JiraStatusBandHeatmapBlock blockerRows={blockerRows} />
        <BlockerQuadrantBlock blockerRows={blockerRows} />
      </div>

      {/* ---------- ranked clusters ---------- */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, marginTop: 28, marginBottom: 12, flexWrap: "wrap" }}>
        <div>
          <div className="eyebrow" style={{ color: T.muted }}>Ranked clusters</div>
          <div style={{ color: T.sub, fontSize: 12, marginTop: 4, maxWidth: 720 }}>
            Highest impact first. Ties break on open cases, then on cluster id, so this order is
            reproducible from the same import.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={exportClusters} title="One row per cluster"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, padding: "5px 12px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.surface, color: T.ink, cursor: "pointer" }}>
            <Download size={13} /> Clusters CSV
          </button>
          <button type="button" onClick={exportCases} title="One row per case"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, padding: "5px 12px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.surface, color: T.ink, cursor: "pointer" }}>
            <Download size={13} /> Cases CSV
          </button>
        </div>
      </div>

      {shown.length === 0 ? (
        <Card>
          <div style={{ color: T.sub, fontSize: 13, fontStyle: "italic", textAlign: "center", padding: "26px 8px" }}>
            {all.length === 0
              ? "No ServiceNow case in this import asserts a link to a Jira ticket. Links come from the cause field and the System “Jira Reference ID … linked” note — free-text mentions alone do not create one."
              : "No cluster matches these filters."}
          </div>
        </Card>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {shown.slice(0, RENDER_LIMIT).map((c) => (
            <ClusterCard
              key={c.id}
              cluster={c}
              matchedCaseNumbers={matchedByCluster.get(c.id)}
              filterActive={filterActive}
            />
          ))}
          {shown.length > RENDER_LIMIT && (
            <Card>
              <div style={{ fontSize: 12, color: T.sub, textAlign: "center", padding: "10px 8px" }}>
                Showing the top {RENDER_LIMIT} of {shown.length} clusters. Narrow the filters to see
                the rest — or use the CSV export, which contains <strong>all {shown.length}</strong>.
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ---------- mention-only disclosure ---------- */}
      {built.mentionOnly.length > 0 && (
        <Card style={{ marginTop: 16 }}>
          <div className="eyebrow" style={{ color: T.muted }}>
            Mentioned in prose only — {built.mentionOnly.length} case{built.mentionOnly.length === 1 ? "" : "s"}
          </div>
          <div style={{ color: T.sub, fontSize: 12, marginTop: 5, lineHeight: 1.5, maxWidth: 760 }}>
            These cases name a Jira ticket in their notes but carry no cause-field reference and no
            System link note, so nothing asserts they are actually blocked — even a note reading
            &ldquo;not related to HMS-123&rdquo; would match. They are listed here for visibility and
            excluded from every count above, deliberately.
          </div>
          <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8 }}>
            {built.mentionOnly.slice(0, 24).map((c) => (
              <span key={c.number} className="mono" style={{ fontSize: 11, color: T.sub, background: T.surfaceAlt, border: `1px solid ${T.borderSoft}`, borderRadius: 5, padding: "3px 8px" }}>
                {c.number}
                <span style={{ color: T.muted }}> → {c.mentionedKeys.join(", ")}</span>
              </span>
            ))}
            {built.mentionOnly.length > 24 && (
              <span style={{ fontSize: 11, color: T.muted }}>+{built.mentionOnly.length - 24} more</span>
            )}
          </div>
        </Card>
      )}
    </Section>
  );
}
