// Ranking, risk-cluster predicate, narrative and facade tests.
//
// The properties that matter here are the ones a manager's trust rests on:
//
//   EXPLAINABILITY — `score` must equal the clamped sum of its own `factors`.
//   If those can drift apart, the "why is this #1" chips are decoration.
//
//   BOUNDARIES — bands and both named risk predicates must hold at the EXACT
//   threshold, and stay silent on a near-miss. A predicate that fires loosely is
//   worse than no predicate.
//
//   DETERMINISM — same input, same output, in a stable order, with no
//   un-substituted template token ever reaching the screen.
//
// Fixed SNAP anchor, no wall clock. Runs under `node --test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { enrichRow } from './enrich.js';
import { RISK_HIGH, RISK_ELEVATED } from './sentiment.js';
import { SIDE_JIRA } from './insight-metrics.js';
import {
  scoreCluster, bandOf, isStaleJiraMultiCase, isUrgentNegativeEscalated,
  clusterFlagsOf, summarize, buildInsights, blockersByJira, effectiveTicketStatus,
} from './insight-rank.js';
import {
  ESC_NONE, ESC_WATCH, ESC_AT_RISK, ESC_ESCALATED,
  W_ESCALATION, W_OPEN_CASE, CAP_OPEN_CASE,
  W_DISTINCT_ACCOUNT, CAP_DISTINCT_ACCOUNT,
  W_URGENCY_AGE_INTERACTION, URGENCY_AGE_MIN_DAYS, URGENCY_HIGH_MIN,
  BAND_HIGH, BAND_MEDIUM, BAND_LOW, BAND_HIGH_MIN, BAND_MEDIUM_MIN,
  SCORE_MAX, MULTI_CASE_MIN,
  FLAG_STALE_JIRA_MULTI_CASE, FLAG_URGENCY_SENTIMENT_ESCALATION,
  URGENCY_CRITICAL, URGENCY_MEDIUM, JIRA_STALE_DAYS,
} from './insight-thresholds.js';

/* ------------------------------- fixtures -------------------------------- */

const DAY = 864e5;
const SNAP = new Date(2026, 5, 24, 12, 0, 0, 0).getTime();
const pad = (n) => String(n).padStart(2, '0');
const fmtTs = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};
const row = (o) => enrichRow(o, SNAP);

const metrics = (o = {}) => ({
  jiraAgeDays: { max: null, median: null, oldestKey: null },
  caseAgeDays: { max: null, median: null, oldestNumber: null },
  ageDelta: null,
  oldestOpenJiraAgeDays: null,
  oldestOpenCaseAgeDays: null,
  priorityNorm: null,
  escalation: { level: ESC_NONE, reasons: [] },
  sentiment: { worstRisk: null, negativeCount: 0, escalatedCount: 0, worstQuote: null, worstNumber: null },
  volume: { totalCases: 1, openCases: 1, distinctAccounts: 1, distinctJiras: 1, casesPerJira: 1 },
  ...o,
});

const pjira = (o = {}) => ({
  key: 'HMS-1', summary: 'Fix the thing', issueType: 'Bug', status: 'In Progress',
  statusCategory: 'In Progress', priority: 'High', priorityNorm: 75, assignee: 'Dev',
  fixVersions: [], ageDays: 10, ageBucket: '8–30d', daysSinceUpdate: 1, isStale: false,
  updated: null, url: null, hasLive: true, isOpen: true, isAtlassian: true, refActive: true,
  issue: null, ...o,
});

const pcase = (o = {}) => ({
  number: 'CS1', shortDescription: 'x', account: 'Acme', parentAccount: null,
  productLine: null, assignedTo: null, manager: null, priority: null, priorityNorm: null,
  category: null, lifecycle: 'open', isOpen: true, isClosed: false,
  createdMs: SNAP - 10 * DAY, closedMs: null,
  ageDays: 10, ageBucket: '8–30d', daysLinked: null, slaBreached: false, slaBreachReason: null,
  sentimentRisk: null, sentimentEscalated: false, sentimentEscReason: null,
  sentimentLabel: null, sentimentSignals: null, sentimentQuote: null, ...o,
});

/* ========================== score explainability ======================== */

test('score always equals the CLAMPED sum of its own factors', () => {
  const cases = [
    metrics(),
    metrics({ volume: { totalCases: 3, openCases: 3, distinctAccounts: 2, distinctJiras: 1, casesPerJira: 3 } }),
    metrics({ escalation: { level: ESC_ESCALATED, reasons: ['CS1 — escalation raised'] } }),
    metrics({ sentiment: { worstRisk: 90, negativeCount: 2, escalatedCount: 3, worstQuote: 'q', worstNumber: 'CS1' } }),
    metrics({ oldestOpenJiraAgeDays: 400, oldestOpenCaseAgeDays: 400 }),
    // Deliberately maxed out on every axis, to force the clamp.
    metrics({
      volume: { totalCases: 99, openCases: 99, distinctAccounts: 40, distinctJiras: 2, casesPerJira: 49 },
      escalation: { level: ESC_ESCALATED, reasons: ['x'] },
      sentiment: { worstRisk: 100, negativeCount: 9, escalatedCount: 9, worstQuote: 'q', worstNumber: 'CS1' },
      oldestOpenJiraAgeDays: 900, oldestOpenCaseAgeDays: 900, priorityNorm: URGENCY_CRITICAL,
    }),
  ];
  for (const m of cases) {
    const { score, rawScore, factors } = scoreCluster(m);
    const sum = factors.reduce((s, f) => s + f.weight, 0);
    assert.equal(rawScore, sum, 'rawScore must be the plain factor sum');
    assert.equal(score, Math.min(SCORE_MAX, Math.max(0, sum)), 'score must be the clamped sum');
    assert.ok(score >= 0 && score <= SCORE_MAX);
  }
});

test('the clamp actually engages on a maxed-out cluster (so the test above means something)', () => {
  const { score, rawScore } = scoreCluster(metrics({
    volume: { totalCases: 99, openCases: 99, distinctAccounts: 40, distinctJiras: 1, casesPerJira: 99 },
    escalation: { level: ESC_ESCALATED, reasons: ['x'] },
    sentiment: { worstRisk: 100, negativeCount: 9, escalatedCount: 9, worstQuote: 'q', worstNumber: 'CS1' },
    oldestOpenJiraAgeDays: 900, oldestOpenCaseAgeDays: 900, priorityNorm: URGENCY_CRITICAL,
  }));
  assert.ok(rawScore > SCORE_MAX, `raw ${rawScore} should exceed the ceiling`);
  assert.equal(score, SCORE_MAX);
});

test('every factor is named, positively weighted, and carries a human detail', () => {
  const { factors } = scoreCluster(metrics({
    volume: { totalCases: 4, openCases: 3, distinctAccounts: 3, distinctJiras: 1, casesPerJira: 4 },
    escalation: { level: ESC_AT_RISK, reasons: ['CS1 — SOP SLA breached (initial)'] },
    sentiment: { worstRisk: 70, negativeCount: 1, escalatedCount: 1, worstQuote: 'q', worstNumber: 'CS1' },
    oldestOpenJiraAgeDays: 40, oldestOpenCaseAgeDays: 90, priorityNorm: URGENCY_CRITICAL,
  }));
  assert.ok(factors.length >= 5);
  for (const f of factors) {
    assert.equal(typeof f.label, 'string');
    assert.ok(f.label.length > 0);
    assert.ok(f.weight > 0, `${f.label} must not be listed with a zero weight`);
    assert.equal(typeof f.detail, 'string');
  }
  // The named interaction term fires when both halves hold.
  assert.ok(factors.some((f) => f.label === 'High urgency, long unresolved'));
});

test('per-term caps hold, so volume alone cannot dominate', () => {
  const volumeOnly = scoreCluster(metrics({
    volume: { totalCases: 500, openCases: 500, distinctAccounts: 100, distinctJiras: 1, casesPerJira: 500 },
  }));
  const open = volumeOnly.factors.find((f) => f.label === 'Open cases blocked');
  const acct = volumeOnly.factors.find((f) => f.label === 'Accounts affected');
  assert.equal(open.weight, CAP_OPEN_CASE);
  assert.equal(acct.weight, CAP_DISTINCT_ACCOUNT);
  // 500 quiet cases cannot reach 'high' on volume alone — that is the point of
  // the caps, and it is what the old `cases.length * 2` formula got wrong.
  assert.ok(volumeOnly.score < BAND_HIGH_MIN, `volume-only scored ${volumeOnly.score}`);
  assert.notEqual(bandOf(volumeOnly.score), BAND_HIGH);
});

test('a single open case with a live escalation outranks a large quiet cluster', () => {
  const quiet = scoreCluster(metrics({
    volume: { totalCases: 12, openCases: 12, distinctAccounts: 1, distinctJiras: 1, casesPerJira: 12 },
  }));
  const escalated = scoreCluster(metrics({
    volume: { totalCases: 1, openCases: 1, distinctAccounts: 1, distinctJiras: 1, casesPerJira: 1 },
    escalation: { level: ESC_ESCALATED, reasons: ['CS1 — escalation raised by the customer'] },
    sentiment: { worstRisk: 95, negativeCount: 1, escalatedCount: 1, worstQuote: 'q', worstNumber: 'CS1' },
    priorityNorm: URGENCY_CRITICAL, oldestOpenCaseAgeDays: 60,
  }));
  assert.ok(escalated.score > quiet.score, `${escalated.score} should beat ${quiet.score}`);
});

test('escalation weights are read from the named constants, not inlined', () => {
  for (const level of [ESC_NONE, ESC_WATCH, ESC_AT_RISK, ESC_ESCALATED]) {
    const { factors } = scoreCluster(metrics({ escalation: { level, reasons: [] } }));
    const f = factors.find((x) => x.label === `Escalation: ${level}`);
    if (W_ESCALATION[level] === 0) assert.equal(f, undefined, 'a zero weight is omitted');
    else assert.equal(f.weight, W_ESCALATION[level]);
  }
});

/* ============================ band boundaries =========================== */

test('band boundaries hold at the EXACT thresholds', () => {
  assert.equal(bandOf(BAND_HIGH_MIN), BAND_HIGH);
  assert.equal(bandOf(BAND_HIGH_MIN - 1), BAND_MEDIUM);
  assert.equal(bandOf(BAND_MEDIUM_MIN), BAND_MEDIUM);
  assert.equal(bandOf(BAND_MEDIUM_MIN - 1), BAND_LOW);
  assert.equal(bandOf(0), BAND_LOW);
  assert.equal(bandOf(SCORE_MAX), BAND_HIGH);
});

/* ======================== named risk-cluster shapes ===================== */

test('risk cluster 1 fires on a stale Jira with multiple unresolved cases', () => {
  const cluster = {
    jira: [pjira({ isStale: true, daysSinceUpdate: 60 })],
    metrics: metrics({ volume: { totalCases: 3, openCases: MULTI_CASE_MIN, distinctAccounts: 2, distinctJiras: 1, casesPerJira: 3 } }),
  };
  assert.equal(isStaleJiraMultiCase(cluster), true);
  assert.ok(clusterFlagsOf(cluster).includes(FLAG_STALE_JIRA_MULTI_CASE));
});

test('risk cluster 1 stays silent on each near-miss', () => {
  // Stale, but only one open case — nobody is queueing behind it.
  assert.equal(isStaleJiraMultiCase({
    jira: [pjira({ isStale: true, daysSinceUpdate: 60 })],
    metrics: metrics({ volume: { totalCases: 5, openCases: MULTI_CASE_MIN - 1, distinctAccounts: 1, distinctJiras: 1, casesPerJira: 5 } }),
  }), false);
  // Multiple open cases, but engineering is active on the ticket.
  assert.equal(isStaleJiraMultiCase({
    jira: [pjira({ isStale: false, daysSinceUpdate: JIRA_STALE_DAYS - 1 })],
    metrics: metrics({ volume: { totalCases: 5, openCases: 5, distinctAccounts: 2, distinctJiras: 1, casesPerJira: 5 } }),
  }), false);
});

test('risk cluster 2 requires ALL THREE of urgency, negative sentiment and escalation', () => {
  const positive = {
    jira: [pjira()],
    metrics: metrics({
      priorityNorm: URGENCY_HIGH_MIN,
      sentiment: { worstRisk: RISK_HIGH, negativeCount: 1, escalatedCount: 1, worstQuote: 'q', worstNumber: 'CS1' },
      escalation: { level: ESC_ESCALATED, reasons: ['x'] },
    }),
  };
  assert.equal(isUrgentNegativeEscalated(positive), true);
  assert.ok(clusterFlagsOf(positive).includes(FLAG_URGENCY_SENTIMENT_ESCALATION));

  // Drop each conjunct in turn — every one must silence the flag.
  const noUrgency = { ...positive, metrics: { ...positive.metrics, priorityNorm: URGENCY_MEDIUM } };
  const noNegative = {
    ...positive,
    metrics: { ...positive.metrics, sentiment: { worstRisk: 5, negativeCount: 0, escalatedCount: 0, worstQuote: null, worstNumber: null } },
  };
  const noEscalation = { ...positive, metrics: { ...positive.metrics, escalation: { level: ESC_WATCH, reasons: [] } } };
  assert.equal(isUrgentNegativeEscalated(noUrgency), false, 'urgency dropped');
  assert.equal(isUrgentNegativeEscalated(noNegative), false, 'negative sentiment dropped');
  assert.equal(isUrgentNegativeEscalated(noEscalation), false, 'escalation dropped');
});

test('risk cluster 2: unknown urgency is not treated as urgent', () => {
  assert.equal(isUrgentNegativeEscalated({
    jira: [pjira()],
    metrics: metrics({
      priorityNorm: null,
      sentiment: { worstRisk: 99, negativeCount: 3, escalatedCount: 2, worstQuote: 'q', worstNumber: 'CS1' },
      escalation: { level: ESC_ESCALATED, reasons: ['x'] },
    }),
  }), false);
});

test('a clean cluster carries no flags', () => {
  assert.deepEqual(clusterFlagsOf({ jira: [pjira()], metrics: metrics() }), []);
});

/* ============================== narrative =============================== */

const NARRATIVE_INPUTS = [
  {
    jiraKeys: ['HMS-1'],
    jira: [pjira({ isStale: true, daysSinceUpdate: 62 })],
    cases: [pcase({ number: 'CS1', slaBreached: true }), pcase({ number: 'CS2' })],
    metrics: metrics({
      volume: { totalCases: 2, openCases: 2, distinctAccounts: 2, distinctJiras: 1, casesPerJira: 2 },
      caseAgeDays: { max: 200, median: 120, oldestNumber: 'CS1' },
      jiraAgeDays: { max: 30, median: 30, oldestKey: 'HMS-1' },
      ageDelta: 170,
      sentiment: { worstRisk: 80, negativeCount: 1, escalatedCount: 1, worstQuote: 'q', worstNumber: 'CS1' },
    }),
  },
  // All closed, no ages, nothing escalated — the sparsest possible cluster.
  {
    jiraKeys: ['HMS-9', 'HMS-10'],
    jira: [pjira({ key: 'HMS-9', isStale: false }), pjira({ key: 'HMS-10', isStale: false })],
    cases: [pcase({ number: 'CS9', isOpen: false, isClosed: true, ageDays: null })],
    metrics: metrics({ volume: { totalCases: 1, openCases: 0, distinctAccounts: 1, distinctJiras: 2, casesPerJira: 0.5 } }),
  },
];

test('narratives are deterministic', () => {
  for (const input of NARRATIVE_INPUTS) {
    assert.equal(summarize(input), summarize(input));
  }
});

test('narratives contain no un-substituted template token and no stray null/undefined', () => {
  for (const input of NARRATIVE_INPUTS) {
    const s = summarize(input);
    assert.ok(s.length > 0, 'a cluster always gets at least one sentence');
    for (const bad of ['{', '}', '${', 'undefined', 'null', 'NaN', '[object']) {
      assert.ok(!s.includes(bad), `summary leaked "${bad}": ${s}`);
    }
  }
});

test('narrative says who has been waiting longer, and pluralizes correctly', () => {
  const s = summarize(NARRATIVE_INPUTS[0]);
  assert.match(s, /HMS-1 is blocking 2 open cases across 2 accounts\./);
  assert.match(s, /oldest case \(CS1\) has been open 200d — 170d longer than the oldest Jira has existed/);
  assert.match(s, /HMS-1 has had no Jira activity in 62d\./);
  assert.match(s, /1 case has an explicit customer escalation\./);
  assert.match(s, /1 case has missed the SOP SLA\./);
});

test('narrative handles the all-closed cluster without claiming open work', () => {
  const s = summarize(NARRATIVE_INPUTS[1]);
  assert.match(s, /2 linked Jira tickets are linked to 1 case, none still open\./);
  assert.ok(!/blocking/.test(s), 'nothing is being blocked when nothing is open');
});

/* ============================ buildInsights ============================= */

const CS1 = row({ number: 'CS000001', account: 'Acme', priority: '2 - Major', state: 'Open', sys_created_on: fmtTs(SNAP - 50 * DAY), cause: 'HMS-1' });
const CS2 = row({ number: 'CS000002', account: 'Beta', priority: '1 - Critical', state: 'Open', sys_created_on: fmtTs(SNAP - 30 * DAY), cause: 'HMS-1 HMS-2' });
const CS3 = row({ number: 'CS000003', account: 'Acme', priority: '3 - Medium', state: 'Open', sys_created_on: fmtTs(SNAP - 10 * DAY), cause: 'HMS-2' });
const LONER = row({ number: 'CS000004', account: 'Gamma', priority: '3 - Medium', state: 'Open', sys_created_on: fmtTs(SNAP - 5 * DAY), work_notes: 'looks like HMS-777 maybe' });

const ISSUES = [
  { key: 'HMS-1', url: 'u1', summary: 'One', issueType: 'Bug', status: 'In Progress', statusCategory: 'In Progress', priority: 'High', assignee: 'Dev', fixVersions: ['24.1'], created: new Date(SNAP - 120 * DAY), updated: new Date(SNAP - 60 * DAY) },
  { key: 'HMS-2', url: 'u2', summary: 'Two', issueType: 'Bug', status: 'To Do', statusCategory: 'To Do', priority: 'Medium', assignee: 'Dev', fixVersions: [], created: new Date(SNAP - 20 * DAY), updated: new Date(SNAP - 2 * DAY) },
];

test('buildInsights returns one transitive cluster, fully decorated', () => {
  const { clusters, mentionOnly } = buildInsights([CS1, CS2, CS3, LONER], ISSUES, SNAP);
  assert.equal(clusters.length, 1, 'CS000002 bridges HMS-1 and HMS-2');
  const c = clusters[0];
  assert.deepEqual(c.jiraKeys, ['HMS-1', 'HMS-2']);
  assert.deepEqual(c.caseNumbers, ['CS000001', 'CS000002', 'CS000003']);
  assert.equal(c.edges.length, 4);
  assert.equal(typeof c.score, 'number');
  assert.ok(Array.isArray(c.factors) && c.factors.length > 0);
  assert.ok([BAND_HIGH, BAND_MEDIUM, BAND_LOW].includes(c.band));
  assert.ok(Array.isArray(c.clusterFlags));
  assert.ok(c.summary.length > 0);
  // The mention-only case is reported separately, never as a cluster.
  assert.deepEqual(mentionOnly.map((m) => m.number), ['CS000004']);
  assert.deepEqual(mentionOnly[0].mentionedKeys, ['HMS-777']);
});

test('buildInsights: a mentioned key is display-only metadata, never an edge', () => {
  const withMention = row({
    number: 'CS000010', account: 'Acme', priority: '2 - Major', state: 'Open',
    sys_created_on: fmtTs(SNAP - 9 * DAY),
    cause: 'HMS-1',
    work_notes: 'Might also relate to HMS-4242, unconfirmed.',
  });
  const { clusters } = buildInsights([withMention], ISSUES, SNAP);
  const c = clusters[0];
  assert.deepEqual(c.jiraKeys, ['HMS-1'], 'only the asserted key is a member');
  assert.deepEqual(c.mentionedOnlyKeys, ['HMS-4242']);
  assert.deepEqual(c.mentionEdges, [{ caseNumber: 'CS000010', jiraKey: 'HMS-4242' }]);
  assert.ok(!c.edges.some((e) => e.jiraKey === 'HMS-4242'), 'and it is NOT an edge');
});

test('buildInsights is deterministic and stably ordered under input permutation', () => {
  const rowsA = [CS1, CS2, CS3, LONER];
  const rowsB = [LONER, CS3, CS2, CS1];
  const shape = (r) => r.clusters.map((c) => [c.id, c.score, c.band, c.summary, c.jiraKeys.join(','), c.caseNumbers.join(',')]);
  assert.deepStrictEqual(shape(buildInsights(rowsA, ISSUES, SNAP)), shape(buildInsights(rowsB, ISSUES, SNAP)));
  assert.deepStrictEqual(shape(buildInsights(rowsA, ISSUES, SNAP)), shape(buildInsights(rowsA, ISSUES, SNAP)));
});

test('buildInsights output shifts with the snapshot anchor', () => {
  const early = buildInsights([CS1], ISSUES, SNAP).clusters[0];
  const later = buildInsights([CS1], ISSUES, SNAP + 60 * DAY).clusters[0];
  assert.equal(early.metrics.caseAgeDays.max, 50);
  assert.equal(later.metrics.caseAgeDays.max, 110);
  assert.notEqual(early.summary, later.summary);
});

test('buildInsights sorts by score, then open cases, then id', () => {
  const { clusters } = buildInsights([CS1, CS3, LONER], ISSUES, SNAP);
  for (let i = 1; i < clusters.length; i++) {
    const a = clusters[i - 1];
    const b = clusters[i];
    const ok =
      a.score > b.score ||
      (a.score === b.score && a.metrics.volume.openCases > b.metrics.volume.openCases) ||
      (a.score === b.score && a.metrics.volume.openCases === b.metrics.volume.openCases && a.id <= b.id);
    assert.ok(ok, `ordering violated at ${i}`);
  }
});

test('buildInsights degrades quietly on empty input', () => {
  for (const args of [[[], [], SNAP], [null, null, SNAP], [[], ISSUES, null]]) {
    const r = buildInsights(...args);
    assert.deepEqual(r.clusters, []);
    assert.deepEqual(r.mentionOnly, []);
  }
});

/* =========================== per-key projection ========================= */

test('blockersByJira splits a multi-Jira cluster into per-key rows with the RIGHT cases', () => {
  // Edges: CS1-HMS1, CS2-HMS1, CS2-HMS2, CS3-HMS2. One cluster, two keys.
  const { clusters } = buildInsights([CS1, CS2, CS3], ISSUES, SNAP);
  assert.equal(clusters.length, 1);
  const rows = blockersByJira(clusters, SNAP);
  assert.equal(rows.length, 2);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  assert.deepEqual(byKey.get('HMS-1').cases.map((c) => c.number), ['CS000001', 'CS000002']);
  assert.deepEqual(byKey.get('HMS-2').cases.map((c) => c.number), ['CS000002', 'CS000003']);
  // Each row is scored over its OWN slice by the same function.
  for (const r of rows) {
    assert.equal(r.clusterId, clusters[0].id, 'rows remember which cluster they came from');
    const sum = r.factors.reduce((s, f) => s + f.weight, 0);
    assert.equal(r.score, Math.min(SCORE_MAX, sum));
  }
});

test('caseNumbers[] and edges[].caseNumber share ONE value space', () => {
  // Found by adversarial review of this layer, not by the oracle test — every
  // fixture there used canonical case numbers. The graph keys case nodes by
  // normalizeKey(number), so the projection must too; otherwise `blockersByJira`
  // joins `cases` to `edges` across two value spaces, finds nothing, and reports
  // ZERO cases for a ticket that has some. A silent undercount, not a cosmetic
  // slip.
  const messy = row({
    number: '  cs000099 ', priority: '2 - Major', state: 'Open',
    sys_created_on: fmtTs(SNAP - 12 * DAY), cause: 'HMS-1',
  });
  const { clusters } = buildInsights([messy], ISSUES, SNAP);
  const c = clusters[0];
  assert.deepEqual(c.caseNumbers, ['CS000099']);
  assert.deepEqual(c.edges.map((e) => e.caseNumber), ['CS000099']);
  assert.equal(c.caseNumbers[0], c.edges[0].caseNumber, 'the two MUST be joinable');

  // ...and the join that depends on it actually finds the case.
  const rows = blockersByJira(clusters, SNAP);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cases.length, 1, 'a non-canonical number must not vanish');
  assert.equal(rows[0].metrics.volume.totalCases, 1);
  assert.equal(rows[0].metrics.volume.openCases, 1);
});

test('jiraKeys[] and edges[].jiraKey share one value space too', () => {
  const { clusters } = buildInsights([CS1], ISSUES, SNAP);
  const c = clusters[0];
  for (const e of c.edges) {
    assert.ok(c.jiraKeys.includes(e.jiraKey), `${e.jiraKey} must be a declared member`);
    assert.ok(c.caseNumbers.includes(e.caseNumber), `${e.caseNumber} must be a declared member`);
  }
});

test('blockersByJira carries accounts and the null-safe oldest days linked', () => {
  const rows = blockersByJira(buildInsights([CS1, CS2, CS3], ISSUES, SNAP).clusters, SNAP);
  const hms1 = rows.find((r) => r.key === 'HMS-1');
  assert.deepEqual(hms1.accounts, ['Acme', 'Beta']);
  // All three fixtures link via `cause`, so no System link note exists anywhere.
  assert.equal(hms1.oldestDaysLinked, null, 'must be null, never a fake 0');
  assert.notEqual(hms1.oldestDaysLinked, 0);
});

test('blockersByJira is ordered by score, then open cases, then key', () => {
  const rows = blockersByJira(buildInsights([CS1, CS2, CS3], ISSUES, SNAP).clusters, SNAP);
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1];
    const b = rows[i];
    assert.ok(
      a.score > b.score ||
      (a.score === b.score && a.metrics.volume.openCases > b.metrics.volume.openCases) ||
      (a.score === b.score && a.metrics.volume.openCases === b.metrics.volume.openCases && a.key <= b.key),
      `ordering violated at ${i}`,
    );
  }
});

test('effectiveTicketStatus prefers the live category, falls back to the journal', () => {
  assert.equal(effectiveTicketStatus(pjira({ hasLive: true, statusCategory: 'Done' })), 'jira_closed');
  assert.equal(effectiveTicketStatus(pjira({ hasLive: true, statusCategory: 'In Progress' })), 'active');
  assert.equal(effectiveTicketStatus(pjira({ hasLive: false, refActive: true })), 'active');
  assert.equal(effectiveTicketStatus(pjira({ hasLive: false, refActive: false })), 'jira_closed');
  assert.equal(effectiveTicketStatus(null), 'active');
});

/* ========================= no wall clock, by source ===================== */

const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

test('insight-rank.js and insight-filters.js read no clock', () => {
  for (const file of ['./insight-rank.js', './insight-filters.js']) {
    const code = stripComments(readFileSync(new URL(file, import.meta.url), 'utf8'));
    assert.ok(!/Date\s*\.\s*now\s*\(/.test(code), `${file} must not call the wall clock`);
    assert.ok(!/new\s+Date\s*\(\s*\)/.test(code), `${file} must not construct an unanchored Date`);
    assert.ok(!/Math\.(max|min)\s*\(\s*\.\.\./.test(code), `${file} must not spread an array into Math.max/min`);
  }
});

test('no new module spreads a data-dependent array into Math.max/min', () => {
  for (const file of ['./correlate.js', './insight-metrics.js', './insight-thresholds.js']) {
    const code = stripComments(readFileSync(new URL(file, import.meta.url), 'utf8'));
    assert.ok(!/Math\.(max|min)\s*\(\s*\.\.\./.test(code), `${file} must not spread into Math.max/min`);
  }
});

test('SIDE_JIRA is the side the cluster id prefix is drawn from', () => {
  const { clusters } = buildInsights([CS1], ISSUES, SNAP);
  assert.match(clusters[0].id, /^c:HMS-1:/);
  assert.equal(clusters[0].jira[0].key, 'HMS-1');
  assert.ok(SIDE_JIRA);
});
