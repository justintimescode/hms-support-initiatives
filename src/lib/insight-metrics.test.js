// Combined-attribute tests: the SOURCE-AWARE half of the insight layer.
//
// Covers the two adapters (enriched ServiceNow rows / enriched Jira issues →
// graph), the one shared priority scale, the snapshot-anchored age and linkage
// helpers, and the metric rollups.
//
// Three things get hostile treatment, because getting any of them wrong would
// quietly produce a confident-looking wrong number:
//
//   1. A free-text MENTION must never assert linkage, and an `RN-` reference is
//      not an Atlassian ticket. Both are load-bearing across the whole app.
//   2. "Not linked" is null, NEVER 0. A fake 0 reads as "linked today".
//   3. Unknown priority is null, NEVER a default — `priorityRank` returns the
//      sentinel 99, and letting that reach a 0..100 urgency scale would rank
//      every unknown-priority cluster as maximally urgent.
//
// Fixed SNAP anchor throughout, no wall clock. Runs under `node --test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { enrichRow } from './enrich.js';
import { percentile } from './stats.js';
import { AGING_BUCKETS } from './constants.js';
import { JIRA_AGING_BUCKETS } from './jira-enrich.js';
import { RISK_HIGH, RISK_ELEVATED } from './sentiment.js';
import {
  SIDE_CASE, SIDE_JIRA,
  normalizePriority, medianOf, maxOf, daysBetween, ageBucketOfDays,
  caseAgeDaysOf, daysLinkedOf, projectCase, projectJira, projectJiraNode,
  buildIssueIndex, buildGraph, correlateSources, buildAliasMap,
  escalationOf, sentimentOf, volumeOf, agesOf, clusterUrgency, clusterMetrics,
  escalationRank,
} from './insight-metrics.js';
import { buildInsights } from './insight-rank.js';
import {
  ESC_NONE, ESC_WATCH, ESC_AT_RISK, ESC_ESCALATED,
  JIRA_STALE_DAYS, MAX_ESCALATION_REASONS,
  URGENCY_CRITICAL, URGENCY_HIGH, URGENCY_MEDIUM, URGENCY_LOW, URGENCY_LOWEST,
} from './insight-thresholds.js';

/* ------------------------------- fixtures -------------------------------- */

const DAY = 864e5;
// Fixed data-as-of anchor at NOON local: noon ± whole days never lands in a DST
// gap, so the ms → local-journal-string → ms round-trip is exact on any machine.
const SNAP = new Date(2026, 5, 24, 12, 0, 0, 0).getTime();

const pad = (n) => String(n).padStart(2, '0');
const fmtTs = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

// The System note ServiceNow writes when a Jira is linked to a case — the ONLY
// thing that establishes a link date (and therefore "Days linked").
const linkNote = (ms, id) =>
  `${fmtTs(ms)} - System\nJira Reference ID ${id} has been created and linked to this case.`;

/** Raw ServiceNow row → enriched row, through the real pipeline, so these tests
 *  exercise `parseJiraRefs` rather than a hand-made imitation of it. */
const row = (o) => enrichRow(o, SNAP);

const LINKED = row({
  number: 'CS000001', short_description: 'Folio total wrong', account: 'Acme Resorts',
  parent_account: 'Armed Forces - Navy (HQ)', product_line: 'HMS', assigned_to: 'Ana',
  manager: 'Mgr One', priority: '2 - Major', state: 'Open',
  sys_created_on: fmtTs(SNAP - 60 * DAY),
  work_notes: linkNote(SNAP - 40 * DAY, 'HMS-1001'),
});

const LINKED_SAME_JIRA = row({
  number: 'CS000002', short_description: 'Folio total wrong too', account: 'Beta Hotels',
  priority: '1 - Critical', state: 'Open',
  sys_created_on: fmtTs(SNAP - 20 * DAY),
  work_notes: linkNote(SNAP - 10 * DAY, 'HMS-1001'),
});

// Tickets from the `cause` field only: a real blocker assertion, but there is no
// System link note, so "Days linked" has no anchor and must report null.
const CAUSE_ONLY = row({
  number: 'CS000003', short_description: 'Night audit hangs', account: 'Acme Resorts',
  priority: '3 - Medium', state: 'Open',
  sys_created_on: fmtTs(SNAP - 15 * DAY),
  cause: 'HMS-2002',
});

// Prose name-drop only. Must produce NO edge and NO cluster.
const MENTION_ONLY = row({
  number: 'CS000004', short_description: 'Rate plan question', account: 'Gamma Inns',
  priority: '3 - Medium', state: 'Open',
  sys_created_on: fmtTs(SNAP - 5 * DAY),
  work_notes: `${fmtTs(SNAP - 4 * DAY)} - Guest Contact\nProbably the same thing as HMS-3003 but not related to this.`,
});

// `RN-` is a ServiceNow-internal Resolution Notes reference, not a Jira ticket.
// It sets a link date and DOES correlate (a real asserted engineering link), but
// is tagged non-Atlassian: never joined to the live map, never linkified.
const RN_ONLY = row({
  number: 'CS000005', short_description: 'Key encoder offline', account: 'Delta Suites',
  priority: '2 - Major', state: 'Open',
  sys_created_on: fmtTs(SNAP - 30 * DAY),
  work_notes: linkNote(SNAP - 25 * DAY, 'RN-500'),
});

// No Jira reference at all — not part of the Jira ecosystem, so not a node.
const NO_REFS = row({
  number: 'CS000006', short_description: 'Password reset', account: 'Acme Resorts',
  priority: '4 - Standard', state: 'Closed',
  sys_created_on: fmtTs(SNAP - 3 * DAY), closed_at: fmtTs(SNAP - 2 * DAY),
});

/** An `enrichIssue`-shaped Jira issue. `_ageDays` / `_isStale` are set to
 *  deliberately WRONG values: enrichIssue derives them from the wall clock at
 *  enrich time (CODEREVIEW(5-31).md P1 #5), and this layer must recompute rather
 *  than trust them. */
const issue = ({
  key, priority = 'High', status = 'In Progress', statusCategory = 'In Progress',
  createdMs = SNAP - 100 * DAY, updatedMs = SNAP - 2 * DAY,
  summary = 'Engineering fix', assignee = 'Dev One', fixVersions = [],
}) => ({
  key,
  url: `https://infor.atlassian.net/browse/${key}`,
  summary, issueType: 'Bug', status, statusCategory, priority, assignee, fixVersions,
  created: new Date(createdMs),
  updated: new Date(updatedMs),
  resolved: statusCategory === 'Done' ? new Date(updatedMs) : null,
  _ageDays: 99999,   // poison: must be ignored
  _isStale: false,   // poison: must be ignored
  _isOpen: statusCategory !== 'Done',
});

const ISSUES = [
  issue({ key: 'HMS-1001', priority: 'Highest', createdMs: SNAP - 80 * DAY, updatedMs: SNAP - 45 * DAY }),
  issue({ key: 'HMS-2002', priority: 'Medium', createdMs: SNAP - 30 * DAY, updatedMs: SNAP - 1 * DAY }),
];

const ALL_ROWS = [LINKED, LINKED_SAME_JIRA, CAUSE_ONLY, MENTION_ONLY, RN_ONLY, NO_REFS];

// buildInsights must surface the same guard through the facade the pages use.
const buildInsightsDupCheck = () => buildInsights(ALL_ROWS, ISSUES, SNAP).duplicateCaseNumbers;

/* --------------------- projected-member shape builders -------------------- */

const pcase = (o = {}) => ({
  number: 'CS1', shortDescription: null, account: 'Acme', parentAccount: null,
  productLine: null, assignedTo: null, manager: null, priority: null, priorityNorm: null,
  lifecycle: 'open', isOpen: true, isClosed: false, ageDays: 10, ageBucket: '8–30d',
  daysLinked: null, slaBreached: false, slaBreachReason: null,
  sentimentRisk: null, sentimentEscalated: false, sentimentEscReason: null,
  sentimentLabel: null, sentimentSignals: null, sentimentQuote: null,
  ...o,
});

const pjira = (o = {}) => ({
  key: 'HMS-1', summary: '', issueType: null, status: null, statusCategory: 'In Progress',
  priority: null, priorityNorm: null, assignee: null, fixVersions: [],
  ageDays: 10, ageBucket: null, daysSinceUpdate: 1, isStale: false,
  updated: null, url: null, hasLive: true, isOpen: true,
  ...o,
});

/* ========================= priority normalization ======================== */

test('normalizePriority: ServiceNow ranks map onto the shared urgency scale', () => {
  const table = [
    ['1 - Critical', URGENCY_CRITICAL],
    ['2 - Major', URGENCY_HIGH],
    ['3 - Medium', URGENCY_MEDIUM],
    ['3 - Standard', URGENCY_MEDIUM], // the rank-3 label varies by export
    ['4 - Standard', URGENCY_LOW],
  ];
  for (const [raw, expected] of table) {
    assert.equal(normalizePriority(SIDE_CASE, raw), expected, `SN "${raw}"`);
  }
});

test('normalizePriority: Jira names map onto the same scale, case/space-insensitively', () => {
  const table = [
    ['Blocker', URGENCY_CRITICAL], ['Highest', URGENCY_CRITICAL],
    ['Critical', URGENCY_CRITICAL], ['Urgent', URGENCY_CRITICAL],
    ['High', URGENCY_HIGH], ['Major', URGENCY_HIGH],
    ['Medium', URGENCY_MEDIUM], ['Normal', URGENCY_MEDIUM],
    ['Low', URGENCY_LOW], ['Minor', URGENCY_LOW],
    ['Lowest', URGENCY_LOWEST], ['Trivial', URGENCY_LOWEST],
    ['  hIgH  ', URGENCY_HIGH],
  ];
  for (const [raw, expected] of table) {
    assert.equal(normalizePriority(SIDE_JIRA, raw), expected, `Jira "${raw}"`);
  }
});

test('normalizePriority: unknown is null on BOTH sides — never a silent default', () => {
  for (const bad of [null, undefined, '', '   ', 'P1', 'Unknown', 'whatever', '5 - Planning', '9']) {
    assert.equal(normalizePriority(SIDE_CASE, bad), null, `SN "${bad}" must be null`);
  }
  for (const bad of [null, undefined, 'Whatever', 'P1', '']) {
    assert.equal(normalizePriority(SIDE_JIRA, bad), null, `Jira "${bad}" must be null`);
  }
});

test('normalizePriority: the priorityRank 99 sentinel never leaks in as urgency', () => {
  // priorityRank returns 99 (not null) for an unparseable priority. If that
  // reached the 0..100 scale, every unknown-priority cluster would outrank a P1.
  assert.equal(normalizePriority(SIDE_CASE, 'Not A Priority'), null);
  assert.notEqual(normalizePriority(SIDE_CASE, 'Not A Priority'), 99);
});

test('normalizePriority: an unrecognized source fails loudly', () => {
  assert.throws(() => normalizePriority('gainsight', 'High'), TypeError);
  assert.throws(() => normalizePriority(undefined, 'High'), TypeError);
});

test('never-rank-unknown-as-urgent: a null-priority cluster does not outrank a known one', () => {
  const unknown = clusterUrgency([pcase({ priorityNorm: null })], [pjira({ priorityNorm: null })]);
  const critical = clusterUrgency([pcase({ priorityNorm: URGENCY_CRITICAL })], []);
  const low = clusterUrgency([pcase({ priorityNorm: URGENCY_LOW })], []);
  assert.equal(unknown, null, 'all-unknown must be null, not 0 and not a default');
  assert.equal(critical, URGENCY_CRITICAL);
  // Ordering: a known value always beats "unknown" (null sorts as absent).
  assert.ok((critical ?? -1) > (unknown ?? -1));
  assert.ok((low ?? -1) > (unknown ?? -1));
});

test('clusterUrgency: the most urgent member defines the cluster, across both sources', () => {
  const c = clusterUrgency(
    [pcase({ priorityNorm: URGENCY_LOW }), pcase({ priorityNorm: null })],
    [pjira({ priorityNorm: URGENCY_CRITICAL })],
  );
  assert.equal(c, URGENCY_CRITICAL, 'a Critical Jira makes the cluster critical');
});

/* ============================ percentiles / max ========================== */

test('medianOf agrees with stats.js percentile — and is NOT the biased-high form', () => {
  const vals = [1, 2, 3, 4];
  assert.equal(medianOf(vals), percentile([...vals].sort((a, b) => a - b), 50));
  // The interpolating median of [1,2,3,4] is 2.5.
  assert.equal(medianOf(vals), 2.5);
  // The old `Math.floor((p/100) * len)` form returned sorted[2] === 3 for this
  // input — every Jira median/p85/p90 skewed upward (CODEREVIEW(5-31).md P1 #1).
  const biasedHigh = vals[Math.min(vals.length - 1, Math.floor(0.5 * vals.length))];
  assert.equal(biasedHigh, 3);
  assert.notEqual(medianOf(vals), biasedHigh);
});

test('medianOf: unsorted input, nulls and non-finite values are handled', () => {
  assert.equal(medianOf([4, 1, 3, 2]), 2.5, 'must sort before taking the percentile');
  assert.equal(medianOf([5, null, 5, undefined, NaN]), 5);
  assert.equal(medianOf([]), null);
  assert.equal(medianOf(null), null);
  assert.equal(medianOf([7]), 7);
});

test('maxOf skips nulls, returns null when empty, and survives a huge array', () => {
  assert.equal(maxOf([1, 9, 3]), 9);
  assert.equal(maxOf([null, 4, undefined, NaN]), 4);
  assert.equal(maxOf([]), null);
  assert.equal(maxOf(null), null);
  assert.equal(maxOf([null, null]), null);
  // `Math.max(...array)` throws RangeError around ~124k args — the confirmed
  // crash in JiraDashboard on exactly the hot tickets this feature surfaces.
  const big = new Array(200_000).fill(1);
  big[123_456] = 42;
  assert.equal(maxOf(big), 42);
});

/* ============================== age & buckets ============================ */

test('daysBetween is snapshot-anchored, floored, and null-safe', () => {
  assert.equal(daysBetween(SNAP - 40 * DAY, SNAP), 40);
  assert.equal(daysBetween(SNAP - 1, SNAP), 0);
  assert.equal(daysBetween(null, SNAP), null);
  assert.equal(daysBetween(SNAP, null), null);
  assert.equal(daysBetween(SNAP + DAY, SNAP), -1, 'a future date is negative, not clamped');
});

test('ageBucketOfDays holds at every boundary of the existing bucket tables', () => {
  const table = [
    [0, '0–7d'], [7, '0–7d'], [8, '8–30d'], [30, '8–30d'],
    [31, '31–90d'], [90, '31–90d'], [91, '90d+'], [100000, '90d+'],
  ];
  for (const [days, name] of table) {
    assert.equal(ageBucketOfDays(days, AGING_BUCKETS), name, `case ${days}d`);
    assert.equal(ageBucketOfDays(days, JIRA_AGING_BUCKETS), name, `jira ${days}d`);
  }
  assert.equal(ageBucketOfDays(null, AGING_BUCKETS), null);
  assert.equal(ageBucketOfDays(-1, AGING_BUCKETS), null, 'a negative age matches no bucket');
});

test('the case and Jira bucket tables are identical, so the charts cannot disagree', () => {
  assert.deepEqual(
    AGING_BUCKETS.map((b) => [b.name, b.min, b.max]),
    JIRA_AGING_BUCKETS.map((b) => [b.name, b.min, b.max]),
  );
});

test('caseAgeDaysOf recomputes from the snapshot', () => {
  assert.equal(caseAgeDaysOf(LINKED, SNAP), 60);
  assert.equal(caseAgeDaysOf(LINKED, SNAP + 10 * DAY), 70, 'age must move with the anchor');
  assert.equal(caseAgeDaysOf({ _created: null }, SNAP), null);
});

/* ===================== "Not linked" is null, never 0 ===================== */

test('daysLinked is a real number when a System link note exists', () => {
  assert.equal(daysLinkedOf(LINKED, SNAP), 40);
  assert.equal(daysLinkedOf(RN_ONLY, SNAP), 25, 'an RN- link note still sets a link date (by design)');
});

test('daysLinked is NULL — never 0 — for cause-only and mention-only cases', () => {
  for (const [label, r] of [['cause-only', CAUSE_ONLY], ['mention-only', MENTION_ONLY], ['no refs', NO_REFS]]) {
    const d = daysLinkedOf(r, SNAP);
    assert.equal(d, null, `${label} must report null`);
    assert.notEqual(d, 0, `${label} must NOT report a fake 0 (renders as "linked today")`);
  }
  // Same guarantee through the projection the UI actually reads.
  assert.equal(projectCase(CAUSE_ONLY, SNAP).daysLinked, null);
  assert.equal(projectCase(MENTION_ONLY, SNAP).daysLinked, null);
});

test('daysLinked ignores the wall-clock-derived _jiraDaysSinceLinked on the row', () => {
  // enrich.js computes _jiraDaysSinceLinked against the live clock, so it drifts
  // for any import older than today (PLAN(unified-insights).md C7).
  const poisoned = { ...LINKED, _jiraDaysSinceLinked: 99999 };
  assert.equal(daysLinkedOf(poisoned, SNAP), 40);
  assert.equal(projectCase(poisoned, SNAP).daysLinked, 40);
});

/* ============================== projections ============================== */

test('projectCase reads baked fields and honors the three-state lifecycle', () => {
  const p = projectCase(LINKED, SNAP);
  assert.equal(p.number, 'CS000001');
  assert.equal(p.account, 'Acme Resorts');
  assert.equal(p.parentAccount, 'Armed Forces - Navy (HQ)', 'parent account via dod.js');
  assert.equal(p.productLine, 'HMS');
  assert.equal(p.assignedTo, 'Ana');
  assert.equal(p.manager, 'Mgr One');
  assert.equal(p.priority, '2 - Major');
  assert.equal(p.priorityNorm, URGENCY_HIGH);
  assert.equal(p.lifecycle, 'open');
  assert.equal(p.isOpen, true);
  assert.equal(p.isClosed, false);
  assert.equal(p.ageDays, 60);
  assert.equal(p.ageBucket, '31–90d');
});

test('projectCase: a Solution Proposed case is neither open nor closed', () => {
  const sp = row({
    number: 'CS000009', priority: '2 - Major', state: 'Resolved',
    sys_created_on: fmtTs(SNAP - 10 * DAY), cause: 'HMS-1001',
  });
  const p = projectCase(sp, SNAP);
  assert.equal(p.lifecycle, 'solution_proposed');
  assert.equal(p.isOpen, false, 'Solution Proposed is not active engineering-blocked work');
  assert.equal(p.isClosed, false, 'and it is definitely not closed');
});

test('projectJira recomputes age and staleness, ignoring enrichIssue cached values', () => {
  const j = projectJira('HMS-1001', ISSUES[0], SNAP);
  assert.equal(j.hasLive, true);
  assert.equal(j.ageDays, 80, 'computed from created, not the poisoned _ageDays: 99999');
  assert.notEqual(j.ageDays, 99999);
  assert.equal(j.ageBucket, '31–90d');
  assert.equal(j.daysSinceUpdate, 45);
  assert.equal(j.isStale, true, 'open and quiet for 45d, despite the poisoned _isStale: false');
  assert.equal(j.priorityNorm, URGENCY_CRITICAL);
  assert.equal(j.isOpen, true);
});

test('projectJira: staleness boundary is inclusive at JIRA_STALE_DAYS', () => {
  const atBoundary = projectJira('HMS-X', issue({ key: 'HMS-X', updatedMs: SNAP - JIRA_STALE_DAYS * DAY }), SNAP);
  const justUnder = projectJira('HMS-Y', issue({ key: 'HMS-Y', updatedMs: SNAP - (JIRA_STALE_DAYS - 1) * DAY }), SNAP);
  assert.equal(atBoundary.daysSinceUpdate, JIRA_STALE_DAYS);
  assert.equal(atBoundary.isStale, true, 'exactly 30 days counts as stale (matches staleWithImpact)');
  assert.equal(justUnder.isStale, false);
});

test('projectJira: a Done issue is never stale, however quiet', () => {
  const done = projectJira('HMS-D', issue({
    key: 'HMS-D', status: 'Done', statusCategory: 'Done', updatedMs: SNAP - 400 * DAY,
  }), SNAP);
  assert.equal(done.isOpen, false);
  assert.equal(done.isStale, false, 'a shipped fix going quiet is not a risk signal');
});

test('projectJira: an un-synced key reports unknown, not a guess', () => {
  const j = projectJira('HMS-9999', null, SNAP);
  assert.equal(j.key, 'HMS-9999');
  assert.equal(j.hasLive, false);
  assert.equal(j.isOpen, null, 'unknown, not "assume open"');
  assert.equal(j.ageDays, null);
  assert.equal(j.daysSinceUpdate, null);
  assert.equal(j.isStale, false);
  assert.equal(j.priorityNorm, null);
  assert.deepEqual(j.fixVersions, []);
});

/* ========================== the issue-key index ========================== */

test('buildIssueIndex normalizes the Jira side of the join, from an array or a Map', () => {
  const fromArray = buildIssueIndex([{ key: ' hms-7 ' }, { key: 'HMS-8' }, null, { key: null }]);
  assert.deepEqual([...fromArray.keys()], ['HMS-7', 'HMS-8']);
  // useAppData hands over a Map keyed by the RAW issue.key — re-keyed here. This
  // is the single boundary that fixes CODEREVIEW(5-31).md P1 #2.
  const raw = new Map([['hms-7', { key: 'hms-7' }]]);
  assert.ok(buildIssueIndex(raw).has('HMS-7'));
  assert.equal(buildIssueIndex(null).size, 0);
});

/* =============================== the adapter ============================= */

test('buildGraph: asserted links become edges, tagged with the source that asserted them', () => {
  const idx = buildIssueIndex(ISSUES);
  const g = buildGraph([LINKED, CAUSE_ONLY], idx);
  assert.equal(g.edges.length, 2);
  const kinds = g.edges.map((e) => e.kind).sort();
  assert.deepEqual(kinds, ['cause', 'work_notes']);
  // The live issue is attached to the Jira node when the cache has it.
  const jiraNodes = g.nodes.filter((n) => n.side === SIDE_JIRA);
  assert.deepEqual(jiraNodes.map((n) => n.id).sort(), ['HMS-1001', 'HMS-2002']);
  assert.ok(jiraNodes.every((n) => n.data && n.data.key));
});

test('a free-text MENTION creates no edge and no cluster', () => {
  const r = correlateSources([MENTION_ONLY], ISSUES);
  assert.equal(r.components.length, 0, 'a prose name-drop is not a linkage');
  assert.deepEqual(r.isolated.map((n) => n.id), ['CS000004']);
  assert.deepEqual(r.mentionsByCase.get('CS000004'), ['HMS-3003'], 'still carried, for display');
  assert.equal(r.droppedEdges.length, 0);
});

test('an RN- reference correlates (it IS an asserted link) but is never Atlassian', () => {
  // enrich.js counts an RN- System link note toward _jiraFirstLinked "by design"
  // — it marks when the case started waiting on engineering, whether the tracked
  // record is a Jira ticket or an internal Resolution Notes record. And neither
  // blastRadius nor ticketGroups skips a non-clickable ref today, so dropping it
  // here would silently delete rows from two existing tables.
  const r = correlateSources([RN_ONLY], ISSUES);
  assert.equal(r.components.length, 1, 'an RN- link is a real asserted linkage');
  const node = r.components[0].bySide[SIDE_JIRA][0];
  assert.equal(node.id, 'RN-500');
  assert.equal(node.isAtlassian, false, 'but it is not an Atlassian ticket');
  assert.equal(node.data, null, 'so it is never joined to the live Jira map');
  assert.deepEqual(r.internalByCase.get('CS000005'), ['RN-500'], 'still carried, for display');
  assert.equal(r.mentionsByCase.size, 0, 'and it is not a mention either');

  const p = projectJiraNode(node, SNAP);
  assert.equal(p.isAtlassian, false, 'the projection must not let the UI linkify it');
  assert.equal(p.hasLive, false);
  assert.equal(p.url, null);
});

test('two cases sharing one RN- record are correlated into a single cluster', () => {
  const second = row({
    number: 'CS000011', priority: '3 - Medium', state: 'Open',
    sys_created_on: fmtTs(SNAP - 20 * DAY),
    work_notes: linkNote(SNAP - 18 * DAY, 'RN-500'),
  });
  const r = correlateSources([RN_ONLY, second], ISSUES);
  assert.equal(r.components.length, 1);
  assert.deepEqual(r.components[0].bySide[SIDE_CASE].map((n) => n.id), ['CS000005', 'CS000011']);
});

test('an Atlassian ticket keeps isAtlassian true and still joins the live map', () => {
  const r = correlateSources([LINKED], ISSUES);
  const node = r.components[0].bySide[SIDE_JIRA][0];
  assert.equal(node.isAtlassian, true);
  assert.equal(node.data.key, 'HMS-1001');
  assert.equal(projectJiraNode(node, SNAP).hasLive, true);
});

test('two DIFFERENT rows sharing a case number are surfaced, not silently merged', () => {
  // A real ServiceNow export can repeat the "Number" header (case number in one
  // column, account number in another). Taking the wrong one makes every case
  // sharing an account look like one case, which would silently undercount blast
  // radius. `readXlsxRows` now takes the first occurrence; this guard makes the
  // remaining failure mode visible instead of quiet.
  const a = row({ number: 'ACCT9000004', priority: '2 - Major', state: 'Open',
    sys_created_on: fmtTs(SNAP - 30 * DAY), cause: 'HMS-1001' });
  const b = row({ number: 'ACCT9000004', priority: '1 - Critical', state: 'Open',
    sys_created_on: fmtTs(SNAP - 10 * DAY), cause: 'HMS-1001' });
  const r = correlateSources([a, b], ISSUES);
  assert.deepEqual(r.duplicateCaseNumbers, ['ACCT9000004'], 'the collision is reported');
  // It still degrades safely: one node, not a crash.
  assert.equal(r.components.length, 1);
  assert.equal(r.components[0].bySide[SIDE_CASE].length, 1);
});

test('a healthy import reports no duplicate case numbers', () => {
  assert.deepEqual(correlateSources(ALL_ROWS, ISSUES).duplicateCaseNumbers, []);
  assert.deepEqual(buildInsightsDupCheck(), []);
});

test('a case with no Jira reference at all becomes no node', () => {
  const g = buildGraph([NO_REFS], buildIssueIndex(ISSUES));
  assert.equal(g.nodes.length, 0, 'not part of the Jira ecosystem — not the caller’s problem to filter');
  assert.equal(g.edges.length, 0);
});

test('adapter + engine end-to-end: 1 -> N, isolation, and no dangling edges', () => {
  const r = correlateSources(ALL_ROWS, ISSUES);
  // HMS-1001 blocks two cases; HMS-2002 blocks one (via `cause`); RN-500 blocks
  // one (a non-Atlassian but genuinely asserted engineering link).
  assert.equal(r.components.length, 3);
  const byKey = new Map(r.components.map((c) => [c.bySide[SIDE_JIRA][0].id, c]));
  assert.deepEqual(byKey.get('HMS-1001').bySide[SIDE_CASE].map((n) => n.id), ['CS000001', 'CS000002']);
  assert.deepEqual(byKey.get('HMS-2002').bySide[SIDE_CASE].map((n) => n.id), ['CS000003']);
  assert.deepEqual(byKey.get('RN-500').bySide[SIDE_CASE].map((n) => n.id), ['CS000005']);
  assert.equal(byKey.get('RN-500').bySide[SIDE_JIRA][0].isAtlassian, false);
  // ONLY the mention-only case is isolated; the case with no refs is absent.
  assert.deepEqual(r.isolated.map((n) => n.id), ['CS000004']);
  assert.equal(r.droppedEdges.length, 0, 'both sides of every edge must resolve');
});

test('adapter + engine: a shared case fuses two tickets into one transitive cluster', () => {
  const bridge = row({
    number: 'CS000010', priority: '2 - Major', state: 'Open',
    sys_created_on: fmtTs(SNAP - 12 * DAY),
    cause: 'HMS-2002',
    work_notes: linkNote(SNAP - 8 * DAY, 'HMS-1001'),
  });
  const r = correlateSources([LINKED, CAUSE_ONLY, bridge], ISSUES);
  assert.equal(r.components.length, 1, 'the bridging case makes this one ecosystem');
  assert.deepEqual(r.components[0].bySide[SIDE_JIRA].map((n) => n.id), ['HMS-1001', 'HMS-2002']);
  assert.deepEqual(
    r.components[0].bySide[SIDE_CASE].map((n) => n.id),
    ['CS000001', 'CS000003', 'CS000010'],
  );
});

test('correlation is time-free: the same rows correlate identically at any snapshot', () => {
  // Only the projections and metrics need an anchor. Who links to what does not
  // depend on when you ask.
  const a = correlateSources(ALL_ROWS, ISSUES);
  const b = correlateSources(ALL_ROWS, ISSUES);
  assert.deepEqual(a.components.map((c) => c.id), b.components.map((c) => c.id));
  assert.deepEqual(a.components.map((c) => c.keys), b.components.map((c) => c.keys));
});

test('projections DO shift with the snapshot anchor', () => {
  const early = projectCase(LINKED, SNAP);
  const later = projectCase(LINKED, SNAP + 30 * DAY);
  assert.equal(early.ageDays, 60);
  assert.equal(later.ageDays, 90);
  assert.equal(early.daysLinked, 40);
  assert.equal(later.daysLinked, 70);
  const jEarly = projectJira('HMS-1001', ISSUES[0], SNAP);
  const jLater = projectJira('HMS-1001', ISSUES[0], SNAP + 30 * DAY);
  assert.equal(jEarly.ageDays, 80);
  assert.equal(jLater.ageDays, 110);
});

/* ============================== escalation =============================== */

test('escalationOf: an explicit customer escalation is the top level', () => {
  const e = escalationOf(
    [pcase({ number: 'CS1', sentimentEscalated: true, sentimentEscReason: 'Property cannot check guests in' })],
    [],
  );
  assert.equal(e.level, ESC_ESCALATED);
  assert.match(e.reasons[0], /^CS1 — escalation raised by the customer: Property cannot check guests in$/);
});

test('escalationOf: an SLA breach is at-risk, and names which clock was missed', () => {
  const e = escalationOf([pcase({ number: 'CS1', slaBreached: true, slaBreachReason: 'initial' })], []);
  assert.equal(e.level, ESC_AT_RISK);
  assert.match(e.reasons[0], /SOP SLA breached \(initial\)/);
});

test('escalationOf: sentiment risk at RISK_HIGH is at-risk; at RISK_ELEVATED is watch', () => {
  assert.equal(escalationOf([pcase({ sentimentRisk: RISK_HIGH })], []).level, ESC_AT_RISK);
  assert.equal(escalationOf([pcase({ sentimentRisk: RISK_HIGH + 20 })], []).level, ESC_AT_RISK);
  assert.equal(escalationOf([pcase({ sentimentRisk: RISK_ELEVATED })], []).level, ESC_WATCH);
  assert.equal(escalationOf([pcase({ sentimentRisk: RISK_HIGH - 1 })], []).level, ESC_WATCH);
});

test('escalationOf: near-misses stay silent', () => {
  assert.equal(escalationOf([pcase({ sentimentRisk: RISK_ELEVATED - 1 })], []).level, ESC_NONE);
  assert.equal(escalationOf([pcase()], []).level, ESC_NONE);
  assert.equal(escalationOf([], []).level, ESC_NONE);
  assert.deepEqual(escalationOf([pcase()], []).reasons, []);
});

test('escalationOf: a stale Jira is watch ONLY while a case is still open', () => {
  const staleJira = pjira({ key: 'HMS-1', isStale: true, daysSinceUpdate: 60 });
  const withOpen = escalationOf([pcase({ isOpen: true })], [staleJira]);
  assert.equal(withOpen.level, ESC_WATCH);
  assert.match(withOpen.reasons[0], /HMS-1 — no Jira activity in 60d with 1 case still open/);

  // Near-miss: nobody is waiting, so a quiet ticket is not a risk.
  const noneOpen = escalationOf([pcase({ isOpen: false, lifecycle: 'closed', isClosed: true })], [staleJira]);
  assert.equal(noneOpen.level, ESC_NONE);
  assert.deepEqual(noneOpen.reasons, []);
});

test('escalationOf: the most severe signal wins, and reasons are severity-first', () => {
  const e = escalationOf(
    [
      pcase({ number: 'CS1', slaBreached: true, slaBreachReason: 'cadence' }),
      pcase({ number: 'CS2', sentimentEscalated: true }),
      pcase({ number: 'CS3', sentimentRisk: RISK_ELEVATED }),
    ],
    [],
  );
  assert.equal(e.level, ESC_ESCALATED);
  assert.match(e.reasons[0], /^CS2 — escalation raised/, 'escalated reasons come first');
  assert.match(e.reasons[1], /^CS1 — SOP SLA breached/);
  assert.match(e.reasons[2], /^CS3 — elevated escalation risk/);
});

test('escalationOf: reasons are capped, and the overflow is counted not dropped', () => {
  const many = [];
  for (let i = 0; i < 10; i++) many.push(pcase({ number: `CS${i}`, sentimentEscalated: true }));
  const e = escalationOf(many, []);
  assert.equal(e.reasons.length, MAX_ESCALATION_REASONS + 1);
  assert.equal(e.reasons.at(-1), `+${10 - MAX_ESCALATION_REASONS} more`);
});

test('escalationOf: a closed case with null sentiment risk contributes nothing', () => {
  // sentiment.js returns risk === null for closed cases by design.
  const e = escalationOf([pcase({ isOpen: false, isClosed: true, lifecycle: 'closed', sentimentRisk: null })], []);
  assert.equal(e.level, ESC_NONE);
});

test('escalationRank orders the enum by severity', () => {
  assert.ok(escalationRank(ESC_ESCALATED) > escalationRank(ESC_AT_RISK));
  assert.ok(escalationRank(ESC_AT_RISK) > escalationRank(ESC_WATCH));
  assert.ok(escalationRank(ESC_WATCH) > escalationRank(ESC_NONE));
});

/* =============================== sentiment =============================== */

test('sentimentOf: a null risk is SKIPPED, never read as a safe 0', () => {
  const s = sentimentOf([
    pcase({ number: 'CS1', sentimentRisk: null, sentimentLabel: 'Negative' }),
    pcase({ number: 'CS2', sentimentRisk: null }),
  ]);
  assert.equal(s.worstRisk, null, 'unmeasured is null — a 0 would read as "measured, and safe"');
  assert.notEqual(s.worstRisk, 0);
  assert.equal(s.negativeCount, 1);
});

test('sentimentOf: worst risk wins and brings its quote; ties resolve to the first case', () => {
  const s = sentimentOf([
    pcase({ number: 'CS1', sentimentRisk: 40, sentimentQuote: 'mild' }),
    pcase({ number: 'CS2', sentimentRisk: 80, sentimentQuote: 'this is unacceptable' }),
    pcase({ number: 'CS3', sentimentRisk: 80, sentimentQuote: 'also bad' }),
  ]);
  assert.equal(s.worstRisk, 80);
  assert.equal(s.worstNumber, 'CS2', 'a tie resolves to the first in case-number order — stable');
  assert.equal(s.worstQuote, 'this is unacceptable');
});

test('sentimentOf: negative and escalated counts are independent tallies', () => {
  const s = sentimentOf([
    pcase({ sentimentLabel: 'Negative' }),
    pcase({ sentimentLabel: 'Negative', sentimentEscalated: true }),
    pcase({ sentimentLabel: 'Positive' }),
    pcase({ sentimentLabel: null }),
  ]);
  assert.equal(s.negativeCount, 2);
  assert.equal(s.escalatedCount, 1);
});

test('projectCase prefers the last customer line for the quote, falling back to the representative one', () => {
  assert.equal(projectCase({ sentiment_last_quote: 'last', sentiment_quote: 'rep' }, SNAP).sentimentQuote, 'last');
  assert.equal(projectCase({ sentiment_quote: 'rep' }, SNAP).sentimentQuote, 'rep');
  assert.equal(projectCase({}, SNAP).sentimentQuote, null);
});

test('projectCase coerces BIGINT-shaped sentiment risk without inventing a value', () => {
  assert.equal(projectCase({ sentiment_risk: 42n }, SNAP).sentimentRisk, 42);
  assert.equal(projectCase({ sentiment_risk: null }, SNAP).sentimentRisk, null);
  assert.equal(projectCase({}, SNAP).sentimentRisk, null);
});

/* ================================ volume ================================ */

test('volumeOf: openCases is TRULY open — Solution Proposed and closed excluded', () => {
  const v = volumeOf(
    [
      pcase({ number: 'CS1', isOpen: true, account: 'Acme' }),
      pcase({ number: 'CS2', isOpen: false, lifecycle: 'solution_proposed', account: 'Acme' }),
      pcase({ number: 'CS3', isOpen: false, isClosed: true, lifecycle: 'closed', account: 'Beta' }),
      pcase({ number: 'CS4', isOpen: true, account: null }),
    ],
    ['HMS-1', 'HMS-2'],
  );
  assert.equal(v.totalCases, 4);
  assert.equal(v.openCases, 2);
  assert.equal(v.distinctAccounts, 2, 'a blank account is not an account');
  assert.equal(v.distinctJiras, 2);
  assert.equal(v.casesPerJira, 2);
});

test('volumeOf: casesPerJira is null (not 0, not Infinity) with no Jiras', () => {
  assert.equal(volumeOf([pcase()], []).casesPerJira, null);
});

/* ================================= ages ================================= */

test('agesOf reports both sides plus the delta — who has been waiting longer', () => {
  const a = agesOf(
    [pcase({ number: 'CS1', ageDays: 200, isOpen: true }), pcase({ number: 'CS2', ageDays: 100, isOpen: false })],
    [pjira({ key: 'HMS-1', ageDays: 30, isOpen: true }), pjira({ key: 'HMS-2', ageDays: 10, isOpen: true })],
  );
  assert.equal(a.caseAgeDays.max, 200);
  assert.equal(a.caseAgeDays.oldestNumber, 'CS1');
  assert.equal(a.caseAgeDays.median, 150);
  assert.equal(a.jiraAgeDays.max, 30);
  assert.equal(a.jiraAgeDays.oldestKey, 'HMS-1');
  assert.equal(a.jiraAgeDays.median, 20);
  // Positive: the customer was already waiting 170 days before the Jira existed.
  assert.equal(a.ageDelta, 170);
});

test('agesOf: the oldestOpen* scalars ignore work nobody is waiting on', () => {
  const a = agesOf(
    [pcase({ number: 'CS1', ageDays: 500, isOpen: false, isClosed: true }), pcase({ number: 'CS2', ageDays: 20, isOpen: true })],
    [pjira({ key: 'HMS-1', ageDays: 400, isOpen: false }), pjira({ key: 'HMS-2', ageDays: 15, isOpen: true })],
  );
  assert.equal(a.caseAgeDays.max, 500, 'the distribution still describes every member');
  assert.equal(a.oldestOpenCaseAgeDays, 20, 'but the ranking term only counts open work');
  assert.equal(a.oldestOpenJiraAgeDays, 15);
});

test('agesOf: ageDelta is null when either side has no known age', () => {
  assert.equal(agesOf([pcase({ ageDays: 10 })], []).ageDelta, null);
  assert.equal(agesOf([], [pjira({ ageDays: 10 })]).ageDelta, null);
  assert.equal(agesOf([pcase({ ageDays: null })], [pjira({ ageDays: null })]).ageDelta, null);
  assert.equal(agesOf([], []).oldestOpenCaseAgeDays, null);
});

/* ============================ metrics assembly =========================== */

test('clusterMetrics assembles the documented block from a real correlated cluster', () => {
  const r = correlateSources(ALL_ROWS, ISSUES);
  const cluster = r.components.find((c) => c.bySide[SIDE_JIRA][0].id === 'HMS-1001');
  const cases = cluster.bySide[SIDE_CASE].map((n) => projectCase(n.data, SNAP));
  const jiras = cluster.bySide[SIDE_JIRA].map((n) => projectJira(n.id, n.data, SNAP));
  const m = clusterMetrics(cases, jiras);

  assert.equal(m.volume.totalCases, 2);
  assert.equal(m.volume.openCases, 2);
  assert.equal(m.volume.distinctAccounts, 2);
  assert.equal(m.volume.casesPerJira, 2);
  assert.equal(m.priorityNorm, URGENCY_CRITICAL, 'CS000002 is a P1, and HMS-1001 is Highest');
  assert.equal(m.caseAgeDays.max, 60);
  assert.equal(m.jiraAgeDays.max, 80);
  assert.equal(m.ageDelta, -20, 'here the Jira predates the oldest case');
  // at-risk, not watch: these fixtures carry no Infor-authored journal entries, so
  // the real SOP-SLA engine breaches them on the initial response. That outranks
  // the stale-Jira watch signal, and it proves the escalation derivation is
  // reading `_slaBreached` off the actual pipeline rather than a stand-in.
  assert.equal(m.escalation.level, ESC_AT_RISK);
  assert.ok(cases.every((c) => c.slaBreached && c.slaBreachReason === 'initial'));
  assert.ok(m.escalation.reasons.some((r) => /SOP SLA breached \(initial\)/.test(r)));
  assert.ok(m.escalation.reasons.some((r) => /HMS-1001 — no Jira activity in 45d/.test(r)),
    'the stale-Jira reason still rides along, it just does not set the level');
  // 0, not null: an open case with no scoreable customer message IS scored, and
  // scores zero. Null is reserved for "not scored at all" (closed cases). The
  // two must stay distinguishable — see the null-is-skipped test above.
  assert.equal(m.sentiment.worstRisk, 0);
  assert.notEqual(m.sentiment.worstRisk, null);
  // Shape contract.
  assert.deepEqual(Object.keys(m).sort(), [
    'ageDelta', 'caseAgeDays', 'escalation', 'jiraAgeDays',
    'oldestOpenCaseAgeDays', 'oldestOpenJiraAgeDays', 'priorityNorm', 'sentiment', 'volume',
  ]);
});

test('clusterMetrics is deterministic across repeated calls', () => {
  const r = correlateSources(ALL_ROWS, ISSUES);
  const build = () => r.components.map((c) => clusterMetrics(
    c.bySide[SIDE_CASE].map((n) => projectCase(n.data, SNAP)),
    c.bySide[SIDE_JIRA].map((n) => projectJira(n.id, n.data, SNAP)),
  ));
  assert.deepStrictEqual(build(), build());
});

/* ========================= no wall clock, by source ====================== */

const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

test('insight-metrics.js and insight-thresholds.js read no clock', () => {
  for (const file of ['./insight-metrics.js', './insight-thresholds.js']) {
    const code = stripComments(readFileSync(new URL(file, import.meta.url), 'utf8'));
    assert.ok(!/Date\s*\.\s*now\s*\(/.test(code), `${file} must not call the wall clock`);
    assert.ok(!/new\s+Date\s*\(\s*\)/.test(code), `${file} must not construct an unanchored Date`);
  }
});

/* ----------------- RN- -> Jira aliasing (buildAliasMap) ------------------ *
 * A ServiceNow `RN-` handle and the `HMS-` key in the `cause` field are ONE
 * defect written down twice, from the two sides of the same workflow:
 *
 *   [Work notes] Jira Reference ID RN-9732370 has been linked to this case.
 *   [Cause]      External Defect ID: HMS-97290
 *
 * Neither note names the other, so the pairing has to be learned from
 * co-occurrence pooled over the whole import. These tests pin both halves: that
 * it collapses the duplicate, and — the part that matters more — that it refuses
 * to guess when the evidence is ambiguous. Measured on the two cached imports it
 * resolves 213 of 298 `RN-` rows; the rest genuinely cannot be resolved. */

/** A case linked to `ref` by a System note, optionally naming a key in `cause`. */
const pairRow = (number, ref, cause) =>
  row({
    number, priority: '2 - Major', state: 'Open',
    sys_created_on: fmtTs(SNAP - 30 * DAY),
    work_notes: linkNote(SNAP - 25 * DAY, ref),
    ...(cause ? { cause } : {}),
  });

test('buildAliasMap resolves an RN- ref to the Jira key it co-occurs with', () => {
  const m = buildAliasMap([pairRow('CS100001', 'RN-9732370', 'External Defect ID: HMS-97290')]);
  assert.equal(m.get('RN-9732370'), 'HMS-97290');
  assert.equal(m.size, 1, 'and nothing else is invented');
});

test('a strict plurality wins: one dissenting case cannot outvote eight', () => {
  // The real shape of the ambiguity in the corpus: RN-9732370 pairs with
  // HMS-97290 on 8 cases and with HMS-97333 on one — and that one case reads
  // `cause: HMS-97290/HMS-97333`, i.e. a case blocked on TWO defects. That is
  // not evidence about what the RN is, so it must not swing the result.
  const rows = [];
  for (let i = 0; i < 8; i++) {
    rows.push(pairRow('CS10001' + i, 'RN-9732370', 'External Defect ID: HMS-97290'));
  }
  rows.push(pairRow('CS100099', 'RN-9732370', 'External Defect ID: HMS-97290/HMS-97333'));
  assert.equal(buildAliasMap(rows).get('RN-9732370'), 'HMS-97290');
});

test('a TIE is left unresolved rather than broken alphabetically', () => {
  // RN-9651814 in the real corpus: HMS-96993 x2, HMS-97002 x2. Attributing a
  // case to the wrong defect is a worse failure than showing one extra row, and
  // an alphabetical tie-break would silently pick HMS-96993 every time.
  const m = buildAliasMap([
    pairRow('CS100201', 'RN-9651814', 'HMS-97002/HMS-96993'),
    pairRow('CS100202', 'RN-9651814', 'HMS-97002/HMS-96993'),
  ]);
  assert.equal(m.has('RN-9651814'), false);
});

test('a free-text MENTION is never evidence for an alias', () => {
  // The app-wide rule is that prose asserts nothing. Resolving an alias from a
  // mention would launder a name-drop into an edge for EVERY case carrying that
  // ref — the exact failure that rule exists to prevent.
  const mentionLine = fmtTs(SNAP - 20 * DAY) + ' - Guest\nLooks like HMS-4242 but probably not related.';
  const m = buildAliasMap([
    row({
      number: 'CS100301', priority: '2 - Major', state: 'Open',
      sys_created_on: fmtTs(SNAP - 30 * DAY),
      work_notes: linkNote(SNAP - 25 * DAY, 'RN-777') + '\n' + mentionLine,
    }),
  ]);
  assert.equal(m.size, 0);
});

test('an RN- and its Jira key on ONE case collapse to one node and one edge', () => {
  // The reported bug: the cluster listed HMS-97290 and RN-9732370 as two
  // separate tickets, double-counting one defect in distinctJiras.
  const r = correlateSources([pairRow('CS100401', 'RN-9732370', 'External Defect ID: HMS-97290')], []);
  assert.equal(r.components.length, 1);
  assert.deepEqual(
    r.components[0].bySide[SIDE_JIRA].map((n) => n.id),
    ['HMS-97290'],
    'one defect is one ticket',
  );
  assert.equal(r.components[0].edges.length, 1, 'one edge — a duplicate would double-list it in the CSV');

  const p = projectJiraNode(r.components[0].bySide[SIDE_JIRA][0], SNAP);
  assert.equal(p.isAtlassian, true, 'the surviving key IS an Atlassian ticket');
  assert.deepEqual(p.aliasedFrom, ['RN-9732370'], 'provenance is kept so the RN is still findable');
});

test('a case carrying ONLY the RN- is bucketed onto the aliased Jira', () => {
  // The second half of the ask: an analyst who never filled in the cause field
  // still lands on the right ticket, because the mapping is pooled across cases.
  const r = correlateSources([
    pairRow('CS100501', 'RN-9732370', 'External Defect ID: HMS-97290'),
    pairRow('CS100502', 'RN-9732370', null),
  ], []);
  assert.equal(r.components.length, 1);
  assert.deepEqual(r.components[0].bySide[SIDE_JIRA].map((n) => n.id), ['HMS-97290']);
  assert.deepEqual(
    r.components[0].bySide[SIDE_CASE].map((n) => n.id),
    ['CS100501', 'CS100502'],
    'both cases sit under the one real ticket',
  );
  // The raw ref is still recorded per case — it is what the work notes say.
  assert.deepEqual(r.internalByCase.get('CS100502'), ['RN-9732370']);
});

test('several RN- handles pooling onto one key are all kept', () => {
  // 3 refs point at HMS-95326 in the real corpus.
  const r = correlateSources([
    pairRow('CS100601', 'RN-9209301', 'HMS-95326'),
    pairRow('CS100602', 'RN-9214888', 'HMS-95326'),
  ], []);
  assert.equal(r.components.length, 1);
  const p = projectJiraNode(r.components[0].bySide[SIDE_JIRA][0], SNAP);
  assert.equal(p.key, 'HMS-95326');
  assert.deepEqual(p.aliasedFrom, ['RN-9209301', 'RN-9214888'], 'sorted, and both kept');
});

test('an unresolvable RN- keeps its own node and stays non-Atlassian', () => {
  // Nothing to resolve it to — so behaviour is exactly what it was before
  // aliasing existed. 76 of the corpus's 317 refs are in this state.
  const r = correlateSources([RN_ONLY], ISSUES);
  const node = r.components[0].bySide[SIDE_JIRA][0];
  assert.equal(node.id, 'RN-500');
  assert.equal(node.isAtlassian, false);
  assert.deepEqual(projectJiraNode(node, SNAP).aliasedFrom, []);
});

test('the edge source stays the one that NAMES the ticket', () => {
  // blockersByJira surfaces `sources`. A key the cause field names must keep
  // reading 'cause', not flip to 'work_notes' because an RN- resolved onto it.
  const rows = [pairRow('CS100701', 'RN-9732370', 'External Defect ID: HMS-97290')];
  const g = buildGraph(rows, buildIssueIndex([]), buildAliasMap(rows));
  assert.equal(g.edges.length, 1);
  assert.equal(g.edges[0].kind, 'cause');
});

test('aliasing is deterministic regardless of row order', () => {
  const a = pairRow('CS100801', 'RN-1', 'HMS-11');
  const b = pairRow('CS100802', 'RN-1', 'HMS-11');
  const c = pairRow('CS100803', 'RN-1', null);
  const shape = (rows) =>
    JSON.stringify(correlateSources(rows, []).components.map((x) => [x.id, x.keys]));
  assert.equal(shape([a, b, c]), shape([c, b, a]));
  assert.equal(shape([a, b, c]), shape([b, c, a]));
});

test('buildGraph without an alias map keeps every raw id (aliasing is opt-in)', () => {
  const g = buildGraph([pairRow('CS100901', 'RN-9732370', 'External Defect ID: HMS-97290')], buildIssueIndex([]));
  assert.deepEqual(
    g.nodes.filter((n) => n.side === SIDE_JIRA).map((n) => n.id).sort(),
    ['HMS-97290', 'RN-9732370'],
  );
});
