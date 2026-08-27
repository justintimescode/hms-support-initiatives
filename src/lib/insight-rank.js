// Ranking, risk-cluster predicates, deterministic narratives, and the terminal
// `buildInsights` facade — the top of the insight-layer DAG.
//
// Two hard rules shape this file:
//
//   EXPLAINABLE. A score is never an opaque number. Every score ships
//   `factors: [{ label, weight, detail }]` whose weights sum to it, so a manager
//   can read WHY a cluster is #1 — the same "explainable signal chips" pattern
//   as `accountChurnRisk` and `sentiment_risk_factors`.
//
//   DETERMINISTIC. Narratives are templated from structural facts already
//   computed, the way sentiment.js's `buildCoachingNote` does. No model call in
//   this path: the app's honest-accuracy stance distinguishes structural facts
//   from model prose, and the AI proxy is optional and usually unconfigured.
//
// Pure ESM: no React, no network, no wall clock. Every time-dependent input
// arrives pre-anchored on the projections from insight-metrics.js.

import { splitNodeKey } from './correlate.js';
import {
  SIDE_CASE, SIDE_JIRA,
  correlateSources, projectCase, projectJiraNode, projectJira,
  clusterMetrics, maxOf,
} from './insight-metrics.js';
import { RISK_HIGH, RISK_ELEVATED } from './sentiment.js';
import {
  W_OPEN_CASE, CAP_OPEN_CASE,
  W_DISTINCT_ACCOUNT, CAP_DISTINCT_ACCOUNT,
  W_JIRA_AGE_PER_WEEK, CAP_JIRA_AGE,
  W_CASE_AGE_PER_WEEK, CAP_CASE_AGE,
  W_ESCALATION,
  W_SENTIMENT_HIGH, W_SENTIMENT_ELEVATED, W_SENTIMENT_PER_ESCALATED, CAP_SENTIMENT,
  W_URGENCY_AGE_INTERACTION, URGENCY_AGE_MIN_DAYS, URGENCY_HIGH_MIN,
  SCORE_MIN, SCORE_MAX,
  BAND_HIGH, BAND_MEDIUM, BAND_LOW, BAND_HIGH_MIN, BAND_MEDIUM_MIN,
  FLAG_STALE_JIRA_MULTI_CASE, FLAG_URGENCY_SENTIMENT_ESCALATION,
  MULTI_CASE_MIN, DAYS_PER_WEEK,
  ESC_ESCALATED, ESC_AT_RISK, ESC_WATCH,
} from './insight-thresholds.js';

const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/* --------------------------------- scoring -------------------------------- */

/**
 * Score a cluster 0..100 from its metrics, with a named, signed contribution for
 * every signal that fired.
 *
 * Signals that contribute nothing are OMITTED rather than listed with weight 0,
 * so `score === clamp(Σ factors.weight)` holds exactly and the UI has no
 * zero-value chips to filter out. `rawScore` is returned alongside so a caller
 * (or a test) can see when the clamp bit.
 *
 * Each term is individually capped. That is the whole point: the formula this
 * replaces (`cases.length * 2 + priorityWeight + min(20, oldestDays / 7)`) let
 * raw case count swamp every other signal, so a 20-case cluster of quiet P4s
 * outranked a 2-case cluster with a live customer escalation.
 *
 * @param {object} metrics  a `clusterMetrics` result
 * @returns {{score: number, rawScore: number, factors: {label: string, weight: number, detail: string}[]}}
 */
export function scoreCluster(metrics) {
  const factors = [];
  const add = (label, weight, detail) => {
    if (weight > 0) factors.push({ label, weight, detail });
  };

  const v = metrics.volume;
  const s = metrics.sentiment;
  const esc = metrics.escalation;

  // 1. Affected open cases — real customer impact, the headline term.
  add(
    'Open cases blocked',
    Math.min(CAP_OPEN_CASE, v.openCases * W_OPEN_CASE),
    `${plural(v.openCases, 'case', 'cases')} still open of ${v.totalCases} linked`,
  );

  // 2. Breadth across customers. Four accounts with one case each is a worse
  //    story than one account with four — it is four relationships, not one.
  const extraAccounts = Math.max(0, v.distinctAccounts - 1);
  add(
    'Accounts affected',
    Math.min(CAP_DISTINCT_ACCOUNT, extraAccounts * W_DISTINCT_ACCOUNT),
    `${plural(v.distinctAccounts, 'distinct account', 'distinct accounts')} affected`,
  );

  // 3. Engineering dwell on the oldest UNRESOLVED Jira.
  const jAge = metrics.oldestOpenJiraAgeDays;
  if (jAge != null) {
    add(
      'Jira age',
      Math.min(CAP_JIRA_AGE, Math.floor(jAge / DAYS_PER_WEEK) * W_JIRA_AGE_PER_WEEK),
      `oldest unresolved Jira open ${jAge}d`,
    );
  }

  // 4. The customer's actual wait, tracked separately — a Jira raised last week
  //    can sit under a case that has been open for eight months.
  const cAge = metrics.oldestOpenCaseAgeDays;
  if (cAge != null) {
    add(
      'Case age',
      Math.min(CAP_CASE_AGE, Math.floor(cAge / DAYS_PER_WEEK) * W_CASE_AGE_PER_WEEK),
      `oldest open case waiting ${cAge}d`,
    );
  }

  // 5. Derived escalation level.
  add(
    `Escalation: ${esc.level}`,
    W_ESCALATION[esc.level] ?? 0,
    esc.reasons.length ? esc.reasons[0] : esc.level,
  );

  // 6. Negative-sentiment pressure, read off the baked columns via the bands
  //    sentiment.js validated. A null risk (closed case) contributes nothing.
  let sentimentPts = 0;
  const detail = [];
  if (s.worstRisk != null && s.worstRisk >= RISK_HIGH) {
    sentimentPts += W_SENTIMENT_HIGH;
    detail.push(`escalation risk ${s.worstRisk}/100`);
  } else if (s.worstRisk != null && s.worstRisk >= RISK_ELEVATED) {
    sentimentPts += W_SENTIMENT_ELEVATED;
    detail.push(`elevated escalation risk ${s.worstRisk}/100`);
  }
  if (s.escalatedCount > 0) {
    sentimentPts += s.escalatedCount * W_SENTIMENT_PER_ESCALATED;
    detail.push(`${plural(s.escalatedCount, 'case', 'cases')} with an escalation event`);
  }
  if (s.negativeCount > 0) detail.push(`${plural(s.negativeCount, 'case', 'cases')} sounding negative`);
  add('Customer sentiment', Math.min(CAP_SENTIMENT, sentimentPts), detail.join(', '));

  // 7. The named interaction: urgent AND long-unresolved is worse than the sum,
  //    because that combination is what produces an escalation.
  const urgent = metrics.priorityNorm != null && metrics.priorityNorm >= URGENCY_HIGH_MIN;
  const longUnresolved = cAge != null && cAge >= URGENCY_AGE_MIN_DAYS;
  if (urgent && longUnresolved) {
    add(
      'High urgency, long unresolved',
      W_URGENCY_AGE_INTERACTION,
      `urgency ${metrics.priorityNorm}/100 with the oldest open case at ${cAge}d`,
    );
  }

  const rawScore = factors.reduce((sum, f) => sum + f.weight, 0);
  const score = Math.min(SCORE_MAX, Math.max(SCORE_MIN, rawScore));
  return { score, rawScore, factors };
}

/** Band from a score. Inclusive lower bounds, from named thresholds. */
export function bandOf(score) {
  if (score >= BAND_HIGH_MIN) return BAND_HIGH;
  if (score >= BAND_MEDIUM_MIN) return BAND_MEDIUM;
  return BAND_LOW;
}

/* --------------------------- risk-cluster predicates ---------------------- */

/**
 * Named risk cluster 1: a long-running Jira AND multiple unresolved cases.
 * Trigger is staleness plus breadth, not raw volume — a busy ticket someone is
 * actively working is not this shape.
 */
export function isStaleJiraMultiCase({ jira, metrics }) {
  const anyStale = (jira || []).some((j) => j.isStale);
  return anyStale && metrics.volume.openCases >= MULTI_CASE_MIN;
}

/**
 * Named risk cluster 2: high urgency AND negative sentiment AND escalation.
 * Strictly conjunctive — all three must hold. Kept that way deliberately so the
 * near-miss cases stay silent and the flag means something when it fires.
 */
export function isUrgentNegativeEscalated({ metrics }) {
  const m = metrics;
  const urgent = m.priorityNorm != null && m.priorityNorm >= URGENCY_HIGH_MIN;
  const negative =
    (m.sentiment.worstRisk != null && m.sentiment.worstRisk >= RISK_HIGH) ||
    m.sentiment.negativeCount >= 1;
  const escalated = m.escalation.level === ESC_ESCALATED || m.escalation.level === ESC_AT_RISK;
  return urgent && negative && escalated;
}

/** Every flag that fires on a cluster, in a stable order. */
export function clusterFlagsOf(cluster) {
  const flags = [];
  if (isStaleJiraMultiCase(cluster)) flags.push(FLAG_STALE_JIRA_MULTI_CASE);
  if (isUrgentNegativeEscalated(cluster)) flags.push(FLAG_URGENCY_SENTIMENT_ESCALATION);
  return flags;
}

/* -------------------------------- narrative ------------------------------- */

/**
 * A deterministic, templated summary composed from facts already computed.
 *
 * Every clause is either fully substituted from a non-null value or dropped
 * entirely, so no placeholder can reach the screen. Built with plain template
 * literals — there is no token syntax to leave unresolved.
 */
export function summarize({ jiraKeys, metrics, jira, cases }) {
  const v = metrics.volume;
  const sentences = [];

  // 1. What, and how wide.
  const subject =
    jiraKeys.length === 1
      ? `${jiraKeys[0]} is`
      : `${plural(jiraKeys.length, 'linked Jira ticket', 'linked Jira tickets')} are`;
  const breadth = v.distinctAccounts > 1 ? ` across ${plural(v.distinctAccounts, 'account', 'accounts')}` : '';
  if (v.openCases > 0) {
    sentences.push(`${subject} blocking ${plural(v.openCases, 'open case', 'open cases')}${breadth}.`);
  } else {
    sentences.push(`${subject} linked to ${plural(v.totalCases, 'case', 'cases')}${breadth}, none still open.`);
  }

  // 2. Who has been waiting longer — the point of the age comparison.
  const cAge = metrics.caseAgeDays.max;
  const jAge = metrics.jiraAgeDays.max;
  if (cAge != null && jAge != null && metrics.caseAgeDays.oldestNumber) {
    const d = metrics.ageDelta;
    if (d > 0) {
      sentences.push(
        `The oldest case (${metrics.caseAgeDays.oldestNumber}) has been open ${cAge}d — ${d}d longer than the oldest Jira has existed.`,
      );
    } else {
      sentences.push(`The oldest case (${metrics.caseAgeDays.oldestNumber}) has been open ${cAge}d; the oldest Jira has existed ${jAge}d.`);
    }
  } else if (cAge != null && metrics.caseAgeDays.oldestNumber) {
    sentences.push(`The oldest case (${metrics.caseAgeDays.oldestNumber}) has been open ${cAge}d.`);
  }

  // 3. Engineering has gone quiet.
  const staleJiras = (jira || []).filter((j) => j.isStale);
  if (staleJiras.length) {
    const worst = staleJiras.reduce((a, b) => ((b.daysSinceUpdate ?? 0) > (a.daysSinceUpdate ?? 0) ? b : a));
    sentences.push(`${worst.key} has had no Jira activity in ${worst.daysSinceUpdate}d.`);
  }

  // 4. What the customer is saying, and whether anyone has escalated.
  const s = metrics.sentiment;
  if (s.escalatedCount > 0) {
    sentences.push(`${plural(s.escalatedCount, 'case has', 'cases have')} an explicit customer escalation.`);
  } else if (s.worstRisk != null && s.worstRisk >= RISK_ELEVATED) {
    sentences.push(`Escalation risk is ${s.worstRisk}/100 on ${s.worstNumber}.`);
  }

  // 5. Nothing is being missed on the SLA side.
  const breached = (cases || []).filter((c) => c.slaBreached).length;
  if (breached > 0) {
    sentences.push(`${plural(breached, 'case has', 'cases have')} missed the SOP SLA.`);
  }

  return sentences.join(' ');
}

/* ---------------------------- the Insight facade -------------------------- */

/**
 * Correlate, project, measure, score, flag and narrate — the one call a page
 * makes.
 *
 * MEMOIZE THIS on `[rows, issues, snapshotMs]` and filter the RESULT. Per
 * PERF_BASELINE.md §3 the aggregation layer is ~5 ms while per-row enrichment is
 * ~664 ms, so the cost that matters is upstream; but re-correlating on every
 * filter change is still pure waste, and `insight-filters.js` exists so it never
 * has to happen.
 *
 * @param {object[]} rows        enriched SN rows (`enrichedAllJoined`)
 * @param {Map<string,object>|object[]} issues  enriched Jira issues, or the
 *                               `jiraIssueMap` (re-keyed normalized internally)
 * @param {number|null} snapshotMs  the active import's upload time
 * @param {object} [opts]
 * @param {object[]} [opts.aliasRows]  the FULL corpus, used ONLY to derive the
 *   `RN-` → Jira alias map (see `buildAliasMap`). Pass it whenever `rows` is a
 *   filtered view, so a ticket's identity does not change with the filters.
 *   Defaults to `rows`.
 * @returns {{clusters: object[], mentionOnly: object[], snapshotMs: number|null, issueIndex: Map}}
 */
export function buildInsights(rows, issues, snapshotMs, { aliasRows } = {}) {
  const correlated = correlateSources(rows, issues, aliasRows);
  const { components, isolated, mentionsByCase, internalByCase, issueIndex, duplicateCaseNumbers } = correlated;

  const clusters = [];
  for (const comp of components) {
    const caseNodes = comp.bySide[SIDE_CASE] || [];
    const jiraNodes = comp.bySide[SIDE_JIRA] || [];
    const cases = caseNodes.map((n) => projectCase(n.data, snapshotMs));
    const jira = jiraNodes.map((n) => projectJiraNode(n, snapshotMs));
    const jiraKeys = jira.map((j) => j.key);
    const caseNumbers = cases.map((c) => c.number);

    const edges = comp.edges.map((e) => ({
      caseNumber: splitNodeKey(e.from).id,
      jiraKey: splitNodeKey(e.to).id,
      source: e.kind,
    }));

    // Display-only: prose name-drops by this cluster's cases. A mentioned key
    // that is ALSO asserted somewhere in the cluster is not "mention only".
    const asserted = new Set(jiraKeys);
    const mentionEdges = [];
    const mentionedOnly = new Set();
    for (const n of caseNodes) {
      for (const key of mentionsByCase.get(n.id) || []) {
        mentionEdges.push({ caseNumber: n.id, jiraKey: key });
        if (!asserted.has(key)) mentionedOnly.add(key);
      }
    }

    const metrics = clusterMetrics(cases, jira);
    const { score, rawScore, factors } = scoreCluster(metrics);
    const base = { id: comp.id, jiraKeys, caseNumbers, jira, cases, metrics };
    clusters.push({
      ...base,
      mentionedOnlyKeys: [...mentionedOnly].sort(cmpStr),
      edges,
      mentionEdges,
      score,
      rawScore,
      factors,
      band: bandOf(score),
      clusterFlags: clusterFlagsOf(base),
      summary: summarize({ jiraKeys, metrics, jira, cases }),
    });
  }

  // Deterministic: score desc, then open cases desc, then id — so screenshots
  // and CSV exports reproduce from the same import.
  clusters.sort(
    (a, b) =>
      b.score - a.score ||
      b.metrics.volume.openCases - a.metrics.volume.openCases ||
      cmpStr(a.id, b.id),
  );

  // Cases that reference a ticket but assert no linkage — prose mentions only.
  // Surfaced separately so the UI can say so honestly rather than either hiding
  // them or counting them as blocked.
  const mentionOnly = isolated
    .filter((n) => n.side === SIDE_CASE)
    .map((n) => ({
      ...projectCase(n.data, snapshotMs),
      mentionedKeys: (mentionsByCase.get(n.id) || []).slice().sort(cmpStr),
      internalKeys: (internalByCase.get(n.id) || []).slice().sort(cmpStr),
    }));

  return {
    clusters,
    mentionOnly,
    snapshotMs: snapshotMs ?? null,
    issueIndex,
    // Non-empty means the ingest mapped a non-unique column as the case number
    // (see the guard in `buildGraph`). Empty on a healthy import.
    duplicateCaseNumbers,
  };
}

/* ------------------------- per-Jira-key projection ------------------------ */

/**
 * Project clusters back into PER-JIRA-KEY rows — the shape the blast-radius
 * table and the "Tickets blocking multiple cases" panel both need.
 *
 * This is why an Insight carries its `edges` (PLAN(unified-insights).md
 * Decision 2): a cluster with three Jiras and five cases must yield three rows,
 * each listing only the cases actually linked to THAT key. Membership arrays
 * alone cannot recover that.
 *
 * Each row is scored with the SAME `scoreCluster` used for whole clusters, just
 * over the key's own slice. One formula, two granularities — which is what makes
 * it impossible for the Blockers page and the new view to disagree.
 */
export function blockersByJira(clusters, snapshotMs) {
  const out = [];
  for (const ins of clusters || []) {
    const caseByNumber = new Map(ins.cases.map((c) => [c.number, c]));
    const jiraByKey = new Map(ins.jira.map((j) => [j.key, j]));

    const perKey = new Map();
    for (const e of ins.edges) {
      let g = perKey.get(e.jiraKey);
      if (!g) {
        g = { cases: [], sources: new Set() };
        perKey.set(e.jiraKey, g);
      }
      g.sources.add(e.source);
      const c = caseByNumber.get(e.caseNumber);
      if (c && !g.cases.includes(c)) g.cases.push(c);
    }

    for (const key of [...perKey.keys()].sort(cmpStr)) {
      const g = perKey.get(key);
      const j = jiraByKey.get(key) || projectJira(key, null, snapshotMs, { isAtlassian: true });
      const metrics = clusterMetrics(g.cases, [j]);
      const { score, rawScore, factors } = scoreCluster(metrics);
      out.push({
        key,
        jira: j,
        cases: g.cases,
        sources: [...g.sources].sort(cmpStr),
        metrics,
        score,
        rawScore,
        factors,
        band: bandOf(score),
        // Max "days linked" across this key's cases. Null — never 0 — when no
        // case carries a System link note (the "Not linked" contract).
        oldestDaysLinked: maxOf(g.cases.map((c) => c.daysLinked)),
        accounts: [...new Set(g.cases.map((c) => c.account).filter(Boolean))].sort(cmpStr),
        clusterId: ins.id,
      });
    }
  }
  out.sort(
    (a, b) =>
      b.score - a.score ||
      b.metrics.volume.openCases - a.metrics.volume.openCases ||
      cmpStr(a.key, b.key),
  );
  return out;
}

/** Effective ticket status: the live Jira category when synced, otherwise the
 *  status inferred from the ServiceNow journal. Centralizes the logic that was
 *  duplicated as `jiraTicketStatusOf` inside JiraDashboard. */
export function effectiveTicketStatus(j) {
  if (!j) return 'active';
  if (j.hasLive) return j.statusCategory === 'Done' ? 'jira_closed' : 'active';
  return j.refActive === false ? 'jira_closed' : 'active';
}

export { ESC_ESCALATED, ESC_AT_RISK, ESC_WATCH, BAND_HIGH, BAND_MEDIUM, BAND_LOW };
