// Dimension-registry and selector tests.
//
// The load-bearing properties:
//
//   FILTERING NEVER RE-CORRELATES. Proven by object IDENTITY: a filtered list
//   must contain the very same cluster objects, by reference. If a selector ever
//   maps or clones, this test fails and the "correlate once" guarantee is gone.
//
//   AGGREGATES RECONCILE WITH THEIR DRILL-DOWN. Every count on screen must equal
//   the length of the list it opens. A number that does not match its own
//   drill-down is worse than no number.
//
//   AN ABSENT DIMENSION SAYS SO. `available` is resolved from the ACTIVE import,
//   so a column this export lacks renders as unavailable rather than as a zero.
//   (`region` and `assignmentGroup` turned out to be REAL columns that were
//   merely unmapped — they are now ordinary dimensions, and are never aliased
//   onto `parentAccount` or `manager`.)
//
// Fixed SNAP anchor, no wall clock. Runs under `node --test`.
import test from 'node:test';
import assert from 'node:assert/strict';

import { enrichRow } from './enrich.js';
import { AGING_BUCKETS } from './constants.js';
import { buildInsights, blockersByJira } from './insight-rank.js';
import { SIDE_CASE, SIDE_JIRA } from './insight-metrics.js';
import {
  DIMENSIONS, dimensionById, resolveDimensions, valuesOf,
  filterClusters, matchedCasesOf, matchedJiraOf,
  facetsOf, drillFacet, bandCounts, escalationCounts,
  urgencyBandOf, escalationUrgencyMatrix, URGENCY_BANDS, ageComparison,
  NO_MANAGER, UNASSIGNED, BANDS,
  facetValuesOf, encodeDimToken, decodeDimTokens, filterableDimensions,
  JIRA_STATUS_CATEGORIES, jiraStatusBandMatrix, accountJiraMatrix, blockerQuadrant,
} from './insight-filters.js';
import {
  ESCALATION_LEVELS, URGENCY_CRITICAL, URGENCY_HIGH, URGENCY_MEDIUM, URGENCY_LOW, URGENCY_LOWEST,
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

// Four cases over three tickets, with deliberately varied dimensions.
const ROWS = [
  row({
    number: 'CS000001', account: 'Acme', parent_account: 'Armed Forces - Navy (HQ)',
    product_line: 'HMS', assigned_to: 'Ana', manager: 'Mgr One', priority: '1 - Critical',
    region: 'NA', assignment_group: 'Hospitality - HMS Support',
    short_description: 'folio invoice billing wrong', state: 'Open',
    sys_created_on: fmtTs(SNAP - 100 * DAY), cause: 'HMS-1',
  }),
  row({
    number: 'CS000002', account: 'Beta', parent_account: 'Armed Forces - Army (HQ)',
    product_line: 'HMS', assigned_to: 'Bo', manager: 'Mgr Two', priority: '3 - Medium',
    region: 'EMEA', assignment_group: 'Hospitality - Infor POS Product Support',
    short_description: 'night audit hangs', state: 'Open',
    sys_created_on: fmtTs(SNAP - 20 * DAY), cause: 'HMS-1',
  }),
  row({
    number: 'CS000003', account: 'Acme', product_line: 'HMS',
    assigned_to: 'Ana', priority: '2 - Major',
    short_description: 'housekeeping room status', state: 'Closed',
    sys_created_on: fmtTs(SNAP - 60 * DAY), closed_at: fmtTs(SNAP - 5 * DAY), cause: 'HMS-2',
  }),
  row({
    number: 'CS000004', account: 'Gamma', product_line: 'Other',
    assigned_to: 'Cy', manager: 'Mgr One', priority: '4 - Standard',
    short_description: 'printer offline', state: 'Open',
    sys_created_on: fmtTs(SNAP - 3 * DAY), cause: 'HMS-3',
  }),
];

const ISSUES = [
  { key: 'HMS-1', url: 'u', summary: 'One', issueType: 'Bug', status: 'In Progress', statusCategory: 'In Progress', priority: 'Highest', assignee: 'Dev A', fixVersions: ['24.1', '24.2'], created: new Date(SNAP - 120 * DAY), updated: new Date(SNAP - 60 * DAY) },
  { key: 'HMS-2', url: 'u', summary: 'Two', issueType: 'Task', status: 'Done', statusCategory: 'Done', priority: 'Low', assignee: 'Dev B', fixVersions: ['24.1'], created: new Date(SNAP - 40 * DAY), updated: new Date(SNAP - 30 * DAY) },
  { key: 'HMS-3', url: 'u', summary: 'Three', issueType: 'Bug', status: 'To Do', statusCategory: 'To Do', priority: 'Medium', assignee: 'Dev A', fixVersions: [], created: new Date(SNAP - 8 * DAY), updated: new Date(SNAP - 1 * DAY) },
];

const built = buildInsights(ROWS, ISSUES, SNAP);
const CLUSTERS = built.clusters;

/* ============================ sanity of fixtures ======================== */

test('fixtures produce three independent clusters', () => {
  assert.equal(CLUSTERS.length, 3);
  assert.deepEqual(
    CLUSTERS.map((c) => c.jiraKeys.join(',')).sort(),
    ['HMS-1', 'HMS-2', 'HMS-3'],
  );
});

/* ===================== identity: no re-correlation ====================== */

test('filterClusters returns the SAME objects by reference — never re-correlates', () => {
  const criteria = [
    {},
    { analyst: 'Ana' },
    { manager: 'Mgr One' },
    { dimensions: { account: ['Acme'] } },
    { bands: BANDS },
    { search: 'folio' },
    { dateRange: { from: SNAP - 200 * DAY, to: SNAP, field: '_created' } },
  ];
  for (const crit of criteria) {
    for (const cl of filterClusters(CLUSTERS, crit)) {
      assert.ok(
        CLUSTERS.some((orig) => orig === cl),
        `filtered cluster must be identical (===) to the pre-filter object, criteria ${JSON.stringify(crit)}`,
      );
    }
  }
});

test('a filter never mutates or recomputes a cluster metrics block', () => {
  const before = JSON.stringify(CLUSTERS.map((c) => c.metrics.volume));
  filterClusters(CLUSTERS, { analyst: 'Ana', dimensions: { account: ['Acme'] } });
  assert.equal(JSON.stringify(CLUSTERS.map((c) => c.metrics.volume)), before);
});

test('metrics describe the WHOLE cluster even when the filter matches one case', () => {
  // HMS-1 blocks CS1 (Ana) and CS2 (Bo). Filtering to Ana must keep the cluster
  // and must still report two cases — a Jira blocking two cases blocks two
  // cases regardless of who is looking.
  const [hms1] = filterClusters(CLUSTERS, { analyst: 'Ana' }).filter((c) => c.jiraKeys.includes('HMS-1'));
  assert.ok(hms1, 'the cluster survives on one matching case');
  assert.equal(hms1.metrics.volume.totalCases, 2);
  assert.equal(hms1.metrics.volume.openCases, 2);
  // ...and the UI gets the matched subset separately for its "N of M" chip.
  assert.deepEqual(matchedCasesOf(hms1, { analyst: 'Ana' }).map((c) => c.number), ['CS000001']);
});

/* ============================== selectors =============================== */

test('analyst / manager filters use the same sentinels as the global filter bar', () => {
  assert.equal(filterClusters(CLUSTERS, { analyst: '__all__' }).length, 3);
  assert.equal(filterClusters(CLUSTERS, { analyst: 'Ana' }).length, 2, 'CS1 (HMS-1) and CS3 (HMS-2)');
  assert.equal(filterClusters(CLUSTERS, { analyst: 'Nobody' }).length, 0);
  assert.equal(filterClusters(CLUSTERS, { manager: 'Mgr One' }).length, 2, 'CS1 and CS4');
  // CS000003 has no manager cell — it must be reachable via the sentinel.
  assert.equal(filterClusters(CLUSTERS, { manager: NO_MANAGER }).length, 1);
  assert.deepEqual(
    filterClusters(CLUSTERS, { manager: NO_MANAGER })[0].caseNumbers,
    ['CS000003'],
  );
});

test('case-side criteria must be satisfied by ONE case simultaneously, not spread across the cluster', () => {
  // HMS-1: CS1 is (Ana, Critical); CS2 is (Bo, Medium). No single case is
  // (Bo, Critical), so the cluster must NOT survive that combination.
  const both = filterClusters(CLUSTERS, { analyst: 'Bo', dimensions: { priority: ['1 - Critical'] } });
  assert.equal(both.length, 0, 'Ana-is-critical and Bo-is-medium must not combine');
  const real = filterClusters(CLUSTERS, { analyst: 'Ana', dimensions: { priority: ['1 - Critical'] } });
  assert.equal(real.length, 1);
});

test('Jira-side and case-side criteria compose', () => {
  assert.equal(filterClusters(CLUSTERS, { dimensions: { statusCategory: ['Done'] } }).length, 1);
  assert.equal(
    filterClusters(CLUSTERS, { dimensions: { statusCategory: ['Done'], account: ['Gamma'] } }).length,
    0,
    'the Done ticket does not belong to Gamma',
  );
  assert.deepEqual(
    matchedJiraOf(CLUSTERS.find((c) => c.jiraKeys.includes('HMS-2')), { dimensions: { statusCategory: ['Done'] } })
      .map((j) => j.key),
    ['HMS-2'],
  );
});

test('a multi-valued dimension (fix versions) matches on any value', () => {
  assert.equal(filterClusters(CLUSTERS, { dimensions: { fixVersion: ['24.2'] } }).length, 1);
  assert.equal(filterClusters(CLUSTERS, { dimensions: { fixVersion: ['24.1'] } }).length, 2);
  assert.equal(filterClusters(CLUSTERS, { dimensions: { fixVersion: ['99.9'] } }).length, 0);
});

test('the date range selects on the projection, honoring the created/closed field', () => {
  const recent = { from: SNAP - 30 * DAY, to: SNAP, field: '_created' };
  assert.deepEqual(
    filterClusters(CLUSTERS, { dateRange: recent }).flatMap((c) => c.caseNumbers).sort(),
    ['CS000001', 'CS000002', 'CS000004'],
    'HMS-1 survives via CS2; HMS-3 via CS4. CS1 is old but shares HMS-1 with CS2.',
  );
  // By CLOSED date only CS000003 has a timestamp at all.
  const closed = { from: SNAP - 10 * DAY, to: SNAP, field: '_closed' };
  assert.deepEqual(filterClusters(CLUSTERS, { dateRange: closed }).flatMap((c) => c.caseNumbers), ['CS000003']);
});

test('an empty filter set is a no-op, and unknown dimension ids are ignored', () => {
  assert.equal(filterClusters(CLUSTERS, {}).length, 3);
  assert.equal(filterClusters(CLUSTERS, { dimensions: { account: [] } }).length, 3);
  assert.equal(filterClusters(CLUSTERS, { dimensions: { notADimension: ['x'] } }).length, 3);
  assert.equal(filterClusters(null, {}).length, 0);
});

test('search spans case number, description, account and Jira key/summary', () => {
  assert.equal(filterClusters(CLUSTERS, { search: 'CS000004' }).length, 1);
  assert.equal(filterClusters(CLUSTERS, { search: 'night audit' }).length, 1);
  assert.equal(filterClusters(CLUSTERS, { search: 'acme' }).length, 2, 'case-insensitive');
  assert.equal(filterClusters(CLUSTERS, { search: 'hms-3' }).length, 1);
  assert.equal(filterClusters(CLUSTERS, { search: 'Three' }).length, 1, 'Jira summary');
  assert.equal(filterClusters(CLUSTERS, { search: 'zzz' }).length, 0);
  assert.equal(filterClusters(CLUSTERS, { search: '   ' }).length, 3, 'blank search is a no-op');
});

/* ========================== dimension registry ========================== */

test('every dimension declares the fields the UI needs', () => {
  for (const d of DIMENSIONS) {
    assert.equal(typeof d.id, 'string');
    assert.equal(typeof d.label, 'string');
    assert.ok([SIDE_CASE, SIDE_JIRA].includes(d.side), `${d.id} side`);
    assert.equal(typeof d.needs, 'string');
    assert.ok(d.needs.length > 0, `${d.id} must say what would light it up`);
    assert.equal(typeof d.valuesOfMember, 'function');
  }
  assert.equal(new Set(DIMENSIONS.map((d) => d.id)).size, DIMENSIONS.length, 'ids unique');
});

test('availability is resolved from the active import', () => {
  const resolved = resolveDimensions(CLUSTERS);
  const by = new Map(resolved.map((d) => [d.id, d]));
  // Present in these fixtures.
  for (const id of ['account', 'parentAccount', 'productLine', 'assignedTo', 'manager',
    'priority', 'category', 'lifecycle', 'caseAgeBucket', 'region', 'assignmentGroup',
    'jiraAssignee', 'jiraPriority', 'fixVersion', 'statusCategory', 'jiraAgeBucket']) {
    assert.equal(by.get(id).available, true, `${id} should be available`);
  }
});

test('a dimension whose column is absent from the export reports unavailable', () => {
  // Same rows with no parent_account and no manager anywhere.
  const bare = buildInsights(
    [row({ number: 'CS1', account: 'Acme', priority: '2 - Major', state: 'Open', sys_created_on: fmtTs(SNAP - DAY), cause: 'HMS-1' })],
    ISSUES, SNAP,
  ).clusters;
  const by = new Map(resolveDimensions(bare).map((d) => [d.id, d]));
  assert.equal(by.get('parentAccount').available, false);
  assert.match(by.get('parentAccount').needs, /Parent Account/);
  // `manager` still resolves available, because a blank cell maps to the
  // "No manager" sentinel — which IS a real, filterable value.
  assert.equal(by.get('manager').available, true);
  assert.equal(by.get('account').available, true);
});

test('an unsynced Jira makes the Jira-side dimensions unavailable, honestly', () => {
  const noJira = buildInsights(ROWS, [], SNAP).clusters;
  const by = new Map(resolveDimensions(noJira).map((d) => [d.id, d]));
  for (const id of ['jiraAssignee', 'jiraPriority', 'fixVersion', 'statusCategory', 'jiraAgeBucket']) {
    assert.equal(by.get(id).available, false, `${id} needs a sync`);
    assert.match(by.get(id).needs, /synced Jira/);
  }
  // The clusters themselves still exist — the link lives in the ServiceNow case.
  assert.equal(noJira.length, 3);
});

test('region and assignmentGroup are REAL dimensions, resolved from the export', () => {
  // These were originally declared permanently unavailable on the stated premise
  // that no ServiceNow layout provides them. A real export disproved that: both
  // columns are present ("Region" = "NA", "Assignment group" =
  // "Hospitality - HMS Support") and were merely never mapped.
  const by = new Map(resolveDimensions(CLUSTERS).map((d) => [d.id, d]));
  for (const id of ['region', 'assignmentGroup']) {
    assert.notEqual(by.get(id).declaredOnly, true, `${id} is not a phantom dimension`);
    assert.equal(by.get(id).available, true, `${id} must light up when the column has data`);
  }
  assert.deepEqual(facetsOf(CLUSTERS, by.get('region')).map((f) => f.value), ['NA', 'EMEA'].sort());
  assert.deepEqual(
    facetsOf(CLUSTERS, by.get('assignmentGroup')).map((f) => f.value).sort(),
    ['Hospitality - HMS Support', 'Hospitality - Infor POS Product Support'],
  );
  // They actually filter.
  assert.equal(filterClusters(CLUSTERS, { dimensions: { region: ['NA'] } }).length, 1);
  assert.equal(filterClusters(CLUSTERS, { dimensions: { region: ['APAC'] } }).length, 0);
  assert.equal(
    filterClusters(CLUSTERS, { dimensions: { assignmentGroup: ['Hospitality - HMS Support'] } }).length, 1);
});

test('region is never conflated with parentAccount, nor assignmentGroup with manager', () => {
  const by = new Map(resolveDimensions(CLUSTERS).map((d) => [d.id, d]));
  // CS000001 and CS000002 both link HMS-1, so they share a cluster and it
  // carries both of their values on every case-side dimension.
  const cl = CLUSTERS.find((c) => c.caseNumbers.includes('CS000001'));
  assert.deepEqual(cl.caseNumbers, ['CS000001', 'CS000002']);
  assert.deepEqual(valuesOf(cl, by.get('region')), ['EMEA', 'NA']);
  assert.deepEqual(valuesOf(cl, by.get('parentAccount')),
    ['Armed Forces - Army (HQ)', 'Armed Forces - Navy (HQ)']);
  assert.notDeepEqual(valuesOf(cl, by.get('region')), valuesOf(cl, by.get('parentAccount')));
  assert.deepEqual(valuesOf(cl, by.get('assignmentGroup')),
    ['Hospitality - HMS Support', 'Hospitality - Infor POS Product Support']);
  assert.deepEqual(valuesOf(cl, by.get('manager')), ['Mgr One', 'Mgr Two']);
  assert.notDeepEqual(valuesOf(cl, by.get('assignmentGroup')), valuesOf(cl, by.get('manager')));
});

test('an export WITHOUT region / assignment group reports them unavailable, not zero', () => {
  const bare = buildInsights(
    [row({ number: 'CS1', account: 'Acme', priority: '2 - Major', state: 'Open',
      sys_created_on: fmtTs(SNAP - DAY), cause: 'HMS-1' })],
    ISSUES, SNAP,
  ).clusters;
  const by = new Map(resolveDimensions(bare).map((d) => [d.id, d]));
  assert.equal(by.get('region').available, false);
  assert.match(by.get('region').needs, /`Region` column/);
  assert.equal(by.get('assignmentGroup').available, false);
  assert.match(by.get('assignmentGroup').needs, /`Assignment group` column/);
  assert.deepEqual(facetsOf(bare, by.get('region')), [], 'no invented values');
});

test('dimensionById resolves known ids and nothing else', () => {
  assert.equal(dimensionById('account').label, 'Account');
  assert.equal(dimensionById('nope'), null);
});

test('unassigned / no-manager sentinels appear as real facet values', () => {
  const vals = valuesOf(CLUSTERS.find((c) => c.caseNumbers.includes('CS000003')), dimensionById('manager'));
  assert.deepEqual(vals, [NO_MANAGER]);
  assert.ok(UNASSIGNED.length > 0);
});

/* ==================== aggregates reconcile with drill-down =============== */

test('every facet count reconciles exactly with its own drill-down list', () => {
  for (const dim of DIMENSIONS.filter((d) => !d.declaredOnly)) {
    for (const facet of facetsOf(CLUSTERS, dim)) {
      const drill = drillFacet(CLUSTERS, dim, facet.value);
      assert.equal(drill.clusters.length, facet.clusters,
        `${dim.id}="${facet.value}" cluster count must match its drill-down`);
      const members = dim.side === SIDE_JIRA ? drill.jira : drill.cases;
      assert.equal(members.length, facet.cases,
        `${dim.id}="${facet.value}" member count must match its drill-down`);
      assert.ok(members.length > 0, 'a facet that exists must open onto real records');
    }
  }
});

test('facet drill-down returns the actual member objects, not copies', () => {
  const dim = dimensionById('account');
  const drill = drillFacet(CLUSTERS, dim, 'Acme');
  const allCases = CLUSTERS.flatMap((c) => c.cases);
  for (const c of drill.cases) assert.ok(allCases.some((x) => x === c));
});

test('facets are ordered by cluster count then value, and count open cases separately', () => {
  const facets = facetsOf(CLUSTERS, dimensionById('account'));
  assert.deepEqual(facets.map((f) => f.value), ['Acme', 'Beta', 'Gamma']);
  const acme = facets.find((f) => f.value === 'Acme');
  assert.equal(acme.cases, 2, 'CS000001 and CS000003');
  assert.equal(acme.openCases, 1, 'CS000003 is closed');
});

test('facetsOf on an empty cluster list is empty, not a crash', () => {
  assert.deepEqual(facetsOf([], dimensionById('account')), []);
  assert.deepEqual(drillFacet([], dimensionById('account'), 'x'), { clusters: [], cases: [], jira: [] });
});

/* ============================ band / risk rollups ======================= */

test('bandCounts always returns all three bands and sums to the cluster count', () => {
  const counts = bandCounts(CLUSTERS);
  assert.deepEqual(counts.map((c) => c.band), BANDS);
  assert.equal(counts.reduce((s, c) => s + c.count, 0), CLUSTERS.length);
  // An empty band renders as zero rather than vanishing.
  assert.deepEqual(bandCounts([]).map((c) => c.count), [0, 0, 0]);
});

test('escalationCounts covers every level, most severe first, and sums correctly', () => {
  const counts = escalationCounts(CLUSTERS);
  assert.deepEqual(counts.map((c) => c.level), [...ESCALATION_LEVELS].reverse());
  assert.equal(counts.reduce((s, c) => s + c.count, 0), CLUSTERS.length);
});

/* ========================= escalation x urgency ========================= */

test('urgencyBandOf maps the shared scale, and unknown gets its OWN band', () => {
  assert.equal(urgencyBandOf(URGENCY_CRITICAL), 'critical');
  assert.equal(urgencyBandOf(URGENCY_HIGH), 'high');
  assert.equal(urgencyBandOf(URGENCY_MEDIUM), 'medium');
  assert.equal(urgencyBandOf(URGENCY_LOW), 'low');
  assert.equal(urgencyBandOf(URGENCY_LOWEST), 'low');
  // Unknown is NOT lumped in with Low — it is unknown, not low.
  assert.equal(urgencyBandOf(null), 'unknown');
  assert.notEqual(urgencyBandOf(null), 'low');
});

test('the heatmap is rectangular, sums to the cluster count, and every cell drills down', () => {
  const m = escalationUrgencyMatrix(CLUSTERS);
  assert.equal(m.cells.length, ESCALATION_LEVELS.length * URGENCY_BANDS.length,
    'every cell exists, so an empty cell reads as zero rather than missing');
  let total = 0;
  for (const level of m.escalationLevels) {
    for (const band of m.urgencyBands) {
      const cell = m.cell(level, band.id);
      assert.ok(cell, `cell ${level}/${band.id} must exist`);
      assert.equal(cell.count, cell.clusters.length, 'the count IS the drill-down length');
      total += cell.count;
    }
  }
  assert.equal(total, CLUSTERS.length, 'every cluster lands in exactly one cell');
});

test('heatmap cells carry the real cluster objects for click-through', () => {
  const m = escalationUrgencyMatrix(CLUSTERS);
  for (const cell of m.cells) {
    for (const cl of cell.clusters) assert.ok(CLUSTERS.some((x) => x === cl));
  }
});

/* ============================ age comparison ============================ */

test('ageComparison puts Jira and case ages on the SAME bucket axis', () => {
  const rows = ageComparison(CLUSTERS, AGING_BUCKETS);
  assert.deepEqual(rows.map((r) => r.name), AGING_BUCKETS.map((b) => b.name));
  const totalCases = rows.reduce((s, r) => s + r.cases, 0);
  const totalJira = rows.reduce((s, r) => s + r.jira, 0);
  assert.equal(totalCases, CLUSTERS.flatMap((c) => c.cases).length);
  assert.equal(totalJira, CLUSTERS.flatMap((c) => c.jira).length);
});

test('ageComparison keeps every bucket row so an empty bucket is a zero bar', () => {
  const rows = ageComparison([], AGING_BUCKETS);
  assert.equal(rows.length, AGING_BUCKETS.length);
  assert.ok(rows.every((r) => r.cases === 0 && r.jira === 0));
});

/* =============== per-Jira-key cross-cuts (Impact Clusters) ============== */

const BLOCKER_ROWS = blockersByJira(CLUSTERS, SNAP);

test('jiraStatusBandMatrix is rectangular and every cell drills down to itself', () => {
  const m = jiraStatusBandMatrix(BLOCKER_ROWS);
  assert.equal(m.cells.length, JIRA_STATUS_CATEGORIES.length * BANDS.length);
  let total = 0;
  for (const sc of m.statusCategories) {
    for (const band of m.bands) {
      const cell = m.cell(sc.id, band);
      assert.ok(cell, `cell ${sc.id}/${band} must exist`);
      assert.equal(cell.count, cell.rows.length);
      total += cell.count;
    }
  }
  assert.equal(total, BLOCKER_ROWS.length, 'every key lands in exactly one cell');
});

test('jiraStatusBandMatrix buckets a live key by its REAL status category, not "unsynced"', () => {
  const m = jiraStatusBandMatrix(BLOCKER_ROWS);
  const hms1 = BLOCKER_ROWS.find((r) => r.key === 'HMS-1');
  const cell = m.cell('In Progress', hms1.band);
  assert.ok(cell.rows.some((r) => r.key === 'HMS-1'));
});

test('jiraStatusBandMatrix falls back to "unsynced" when a key has no live Jira record', () => {
  const m = jiraStatusBandMatrix([{ key: 'HMS-99', jira: { statusCategory: null }, band: 'low', metrics: { volume: { openCases: 0 } } }]);
  const cell = m.cell('unsynced', 'low');
  assert.equal(cell.count, 1);
});

test('accountJiraMatrix ranks accounts by volume WITHIN the scoped keys, and every cell is real cases', () => {
  const m = accountJiraMatrix(BLOCKER_ROWS);
  assert.deepEqual(m.accounts, ['Acme', 'Beta', 'Gamma']);
  assert.deepEqual(m.cell('Acme', 'HMS-1').map((c) => c.number), ['CS000001']);
  assert.deepEqual(m.cell('Acme', 'HMS-2').map((c) => c.number), ['CS000003']);
  assert.deepEqual(m.cell('Beta', 'HMS-1').map((c) => c.number), ['CS000002']);
  assert.deepEqual(m.cell('Gamma', 'HMS-3').map((c) => c.number), ['CS000004']);
  assert.deepEqual(m.cell('Acme', 'HMS-3'), [], 'Acme has no case on HMS-3');
});

test('accountJiraMatrix caps to the busiest keys and accounts', () => {
  const m = accountJiraMatrix(BLOCKER_ROWS, { maxAccounts: 1, maxKeys: 1 });
  assert.equal(m.accounts.length, 1);
  assert.equal(m.keys.length, 1);
});

test('blockerQuadrant excludes keys with no live Jira record and carries real per-key fields', () => {
  const q = blockerQuadrant(BLOCKER_ROWS);
  assert.equal(q.points.length, BLOCKER_ROWS.filter((r) => r.jira?.daysSinceUpdate != null).length);
  const hms1 = q.points.find((p) => p.key === 'HMS-1');
  assert.equal(hms1.accounts, 2, 'HMS-1 blocks Acme and Beta');
  assert.equal(hms1.openCases, 2, 'both HMS-1 cases are open');
  const hms2 = q.points.find((p) => p.key === 'HMS-2');
  assert.equal(hms2.openCases, 0, 'HMS-2\'s only case is closed');
  assert.ok(q.medDaysSinceUpdate != null && q.medOpenCases != null);
});

test('blockerQuadrant degrades quietly when nothing has a live Jira record', () => {
  const q = blockerQuadrant([{ key: 'HMS-99', jira: { daysSinceUpdate: null } }]);
  assert.deepEqual(q.points, []);
  assert.equal(q.medDaysSinceUpdate, null);
  assert.equal(q.medOpenCases, null);
});

/* ====================== URL tokens (SECURITY #3 / #8) =================== */

test('facetValuesOf is ordered by VALUE, so a token cannot silently re-point', () => {
  // `facetsOf` sorts by cluster count for display. The token index space must
  // NOT use that ordering: a count change would repoint every existing token.
  const dim = dimensionById('account');
  assert.deepEqual(facetValuesOf(CLUSTERS, dim), ['Acme', 'Beta', 'Gamma']);
  const byCount = facetsOf(CLUSTERS, dim).map((f) => f.value);
  assert.deepEqual([...facetValuesOf(CLUSTERS, dim)].sort(), [...byCount].sort(),
    'same value set, different ordering contract');
});

test('a dimension token carries an INDEX, never the value itself', () => {
  const token = encodeDimToken('account', 'Beta', CLUSTERS);
  assert.equal(token, 'account:1');
  // The point: no customer name, region or personal name reaches the URL.
  assert.ok(!token.includes('Beta'));
  assert.equal(encodeDimToken('region', 'EMEA', CLUSTERS), 'region:0');
  assert.ok(!encodeDimToken('region', 'EMEA', CLUSTERS).includes('EMEA'));
});

test('tokens round-trip back to values', () => {
  const tokens = [
    encodeDimToken('account', 'Acme', CLUSTERS),
    encodeDimToken('account', 'Gamma', CLUSTERS),
    encodeDimToken('region', 'NA', CLUSTERS),
  ];
  assert.deepEqual(decodeDimTokens(tokens, CLUSTERS), {
    account: ['Acme', 'Gamma'],
    region: ['NA'],
  });
});

test('a decoded token actually drives the filter', () => {
  const tokens = [encodeDimToken('account', 'Gamma', CLUSTERS)];
  const picked = filterClusters(CLUSTERS, { dimensions: decodeDimTokens(tokens, CLUSTERS) });
  assert.equal(picked.length, 1);
  assert.deepEqual(picked[0].caseNumbers, ['CS000004']);
});

test('an unresolvable token is IGNORED, never guessed at', () => {
  // Same treatment `useFilters` gives an out-of-range `?a=` token. A shared URL
  // against a different import degrades to "no filter", not to a wrong filter.
  for (const bad of [
    'account:999',       // out of range
    'account:-1',        // negative
    'account:abc',       // non-numeric
    'account:',          // empty index
    'notADimension:0',   // unknown dimension
    ':0',                // no dimension id
    'account',           // no separator
    '',
  ]) {
    assert.deepEqual(decodeDimTokens([bad], CLUSTERS), {}, `must ignore "${bad}"`);
  }
  assert.deepEqual(decodeDimTokens(null, CLUSTERS), {});
});

test('an unknown value cannot be encoded', () => {
  assert.equal(encodeDimToken('account', 'NotAnAccount', CLUSTERS), null);
  assert.equal(encodeDimToken('notADimension', 'x', CLUSTERS), null);
});

test('duplicate tokens collapse', () => {
  const t = encodeDimToken('account', 'Acme', CLUSTERS);
  assert.deepEqual(decodeDimTokens([t, t, t], CLUSTERS), { account: ['Acme'] });
});

test('the view-local bar never offers Analyst or Manager — the global bar owns them', () => {
  // Those two are serialized by useFilters as opaque tokens specifically so a
  // person's name never lands in a URL. Offering them again here would either
  // duplicate that or leak the name.
  const offered = filterableDimensions(CLUSTERS).map((d) => d.id);
  assert.ok(!offered.includes('assignedTo'), 'Analyst is global-only');
  assert.ok(!offered.includes('manager'), 'Manager is global-only');
  // But they remain in the registry, because faceting and the analyst/manager
  // criteria both use them.
  assert.ok(dimensionById('assignedTo').globalOnly);
  assert.ok(dimensionById('manager').globalOnly);
  assert.ok(offered.includes('account') && offered.includes('region'));
  // And only AVAILABLE dimensions are offered.
  assert.ok(filterableDimensions([]).length === 0);
});
