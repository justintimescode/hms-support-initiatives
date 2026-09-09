// Migration proof: `blastRadius` is now a PROJECTION over the shared
// correlation engine rather than its own hand-rolled join.
//
// The point of this file is to prove the consolidation did not quietly change
// anyone's numbers. It carries a REFERENCE ORACLE — the pre-migration
// `blastRadius` body, reproduced verbatim except that its `Date.now()` is
// replaced by the fixed SNAP anchor — and asserts the new projection agrees with
// it field for field.
//
// Where the two are ALLOWED to differ, the difference is asserted explicitly so
// it can never drift silently:
//
//   * Ties. The old sort was `openCount desc, totalCount desc` with no final
//     tiebreak, so tied rows fell back to Map insertion order (i.e. row order).
//     Ties now break on `key`. No count changes; tied rows may reorder.
//   * Anchoring. `daysOpen` / `daysSinceUpdate` are measured against the import's
//     upload time rather than the wall clock. With the oracle pinned to the same
//     anchor, the values match exactly — which is the proof that anchoring is the
//     ONLY behavioral difference.
//   * Percentiles. `resolutionStatsByPriority` and `cycleLeadStats` now use the
//     interpolating percentile from stats.js. Those numbers DO change, downward,
//     and that is CODEREVIEW(5-31).md P1 #1 being fixed. Asserted below.
//
// Runs under `node --test`.
import test from 'node:test';
import assert from 'node:assert/strict';

import { enrichRow } from './enrich.js';
import { percentile } from './stats.js';
import { cycleLeadStats } from './jira-enrich.js';
import {
  blastRadius, blastRadiusSummary, openCasesHistogram, staleWithImpact,
  fixVersionPipeline, resolutionStatsByPriority,
} from './jira-stats.js';
import { buildInsights, blockersByJira } from './insight-rank.js';
import { JIRA_STALE_DAYS } from './insight-thresholds.js';

/* ------------------------------- fixtures -------------------------------- */

const DAY = 864e5;
const SNAP = new Date(2026, 5, 24, 12, 0, 0, 0).getTime();
const pad = (n) => String(n).padStart(2, '0');
const fmtTs = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};
const linkNote = (ms, id) =>
  `${fmtTs(ms)} - System\nJira Reference ID ${id} has been created and linked to this case.`;
const row = (o) => enrichRow(o, SNAP);

// Deliberately covers every shape the join has to handle: a shared ticket, a
// bridging case (transitive), a closed case, an RN- internal ref, a prose
// mention, a key with no live issue, and a case with no refs at all.
const ROWS = [
  row({ number: 'CS000001', account: 'Acme', short_description: 'folio wrong', priority: '1 - Critical',
    state: 'Open', sys_created_on: fmtTs(SNAP - 100 * DAY), work_notes: linkNote(SNAP - 90 * DAY, 'HMS-1') }),
  row({ number: 'CS000002', account: 'Beta', short_description: 'folio wrong too', priority: '2 - Major',
    state: 'Open', sys_created_on: fmtTs(SNAP - 40 * DAY), cause: 'HMS-1 HMS-2' }),
  row({ number: 'CS000003', account: 'Acme', short_description: 'audit hangs', priority: '3 - Medium',
    state: 'Closed', sys_created_on: fmtTs(SNAP - 70 * DAY), closed_at: fmtTs(SNAP - 6 * DAY), cause: 'HMS-2' }),
  row({ number: 'CS000004', account: 'Gamma', short_description: 'encoder offline', priority: '2 - Major',
    state: 'Open', sys_created_on: fmtTs(SNAP - 25 * DAY), work_notes: linkNote(SNAP - 20 * DAY, 'RN-500') }),
  row({ number: 'CS000005', account: 'Delta', short_description: 'rate question', priority: '4 - Standard',
    state: 'Open', sys_created_on: fmtTs(SNAP - 8 * DAY), work_notes: 'probably HMS-9999 but unrelated' }),
  row({ number: 'CS000006', account: 'Acme', short_description: 'unsynced blocker', priority: '2 - Major',
    state: 'Open', sys_created_on: fmtTs(SNAP - 12 * DAY), cause: 'HMS-404' }),
  row({ number: 'CS000007', account: 'Acme', short_description: 'no jira at all', priority: '4 - Standard',
    state: 'Open', sys_created_on: fmtTs(SNAP - 2 * DAY) }),
];

const issue = (key, o = {}) => ({
  key, url: `https://infor.atlassian.net/browse/${key}`,
  summary: `Summary ${key}`, issueType: 'Bug', status: 'In Progress', statusCategory: 'In Progress',
  priority: 'High', assignee: 'Dev', fixVersions: [],
  created: new Date(SNAP - 200 * DAY), updated: new Date(SNAP - 5 * DAY), resolved: null,
  _leadMs: null, _cycleMs: null,
  ...o,
});

const ISSUES = [
  issue('HMS-1', { updated: new Date(SNAP - 80 * DAY), fixVersions: ['24.1'], priority: 'Highest' }),
  issue('HMS-2', { updated: new Date(SNAP - 3 * DAY), fixVersions: ['24.1', '24.2'] }),
  // HMS-404 is deliberately ABSENT, and RN-500 can never be present.
];

// The Jira map exactly as useAppData used to build it: keyed by the RAW key.
const RAW_MAP = new Map(ISSUES.map((i) => [i.key, i]));

/* =========================== the reference oracle ======================== */

/** The pre-migration `blastRadius`, verbatim except `Date.now()` -> `now`. */
function legacyBlastRadius(rows, jiraIssueMap, now) {
  const counts = new Map();
  for (const r of rows || []) {
    const seen = new Set();
    for (const t of r._jiraTickets || []) {
      if (t.source === 'mention') continue;
      if (!t.id || seen.has(t.id)) continue;
      seen.add(t.id);
      const e = counts.get(t.id) || { total: 0, open: 0, cases: [] };
      e.total++;
      if (r._isOpen) e.open++;
      e.cases.push({
        number: r.number || '',
        isClosed: !!r._isClosed,
        account: r.account || '',
        shortDescription: r.short_description || '',
        daysOpen: r._created ? Math.floor((now - r._created.getTime()) / DAY) : null,
      });
      counts.set(t.id, e);
    }
  }
  return [...counts.entries()]
    .map(([key, c]) => {
      const issueObj = jiraIssueMap?.get(key) || null;
      const updated = issueObj?.updated || null;
      const cases = c.cases.sort((a, b) =>
        a.isClosed !== b.isClosed ? (a.isClosed ? 1 : -1) : String(a.number).localeCompare(String(b.number)),
      );
      return {
        key,
        openCount: c.open,
        totalCount: c.total,
        cases,
        issue: issueObj,
        summary: issueObj?.summary || '',
        issueType: issueObj?.issueType || '—',
        priority: issueObj?.priority || null,
        status: issueObj?.status || '—',
        statusCategory: issueObj?.statusCategory || null,
        fixVersions: issueObj?.fixVersions || [],
        url: issueObj?.url || null,
        updated,
        daysSinceUpdate: updated ? Math.floor((now - updated.getTime()) / DAY) : null,
        hasLive: !!issueObj,
      };
    })
    .sort((a, b) => b.openCount - a.openCount || b.totalCount - a.totalCount);
}

// The legacy field set the downstream consumers read. `score`/`factors`/`band`/
// `clusterId`/`isAtlassian` are additive and excluded from the comparison.
const LEGACY_FIELDS = [
  'key', 'openCount', 'totalCount', 'cases', 'issue', 'summary', 'issueType',
  'priority', 'status', 'statusCategory', 'fixVersions', 'url', 'updated',
  'daysSinceUpdate', 'hasLive',
];
const pickLegacy = (r) => Object.fromEntries(LEGACY_FIELDS.map((k) => [k, r[k]]));
const byKeyAsc = (a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/* ============================== equivalence ============================= */

test('the new projection emits EXACTLY the legacy field set — nothing removed, nothing renamed', () => {
  const rows = blastRadius(ROWS, ISSUES, SNAP);
  assert.ok(rows.length > 0);
  for (const r of rows) {
    for (const f of LEGACY_FIELDS) {
      assert.ok(Object.hasOwn(r, f), `missing legacy field "${f}" on ${r.key}`);
    }
  }
});

test('projection matches the pre-migration implementation field for field', () => {
  const now = blastRadius(ROWS, ISSUES, SNAP).map(pickLegacy).sort(byKeyAsc);
  const old = legacyBlastRadius(ROWS, RAW_MAP, SNAP).map(pickLegacy).sort(byKeyAsc);
  assert.deepStrictEqual(now, old, 'no count, case list or display field may change');
});

test('the same key set is produced — including RN- and unsynced keys', () => {
  const keys = blastRadius(ROWS, ISSUES, SNAP).map((r) => r.key).sort();
  assert.deepEqual(keys, legacyBlastRadius(ROWS, RAW_MAP, SNAP).map((r) => r.key).sort());
  // RN-500 is a ServiceNow-internal ref: the old join counted it, so the new one
  // must too. Dropping it would have silently deleted a row from this table.
  assert.ok(keys.includes('RN-500'));
  // A key nobody has synced still gets a row, reported as not live.
  assert.ok(keys.includes('HMS-404'));
  assert.equal(blastRadius(ROWS, ISSUES, SNAP).find((r) => r.key === 'HMS-404').hasLive, false);
  // A prose mention is NOT a key.
  assert.ok(!keys.includes('HMS-9999'));
});

test('primary ordering is preserved; ties now break on key (the only order change)', () => {
  const now = blastRadius(ROWS, ISSUES, SNAP);
  // Primary/secondary keys unchanged: openCount desc, then totalCount desc.
  for (let i = 1; i < now.length; i++) {
    const a = now[i - 1];
    const b = now[i];
    assert.ok(
      a.openCount > b.openCount ||
      (a.openCount === b.openCount && a.totalCount > b.totalCount) ||
      (a.openCount === b.openCount && a.totalCount === b.totalCount && a.key <= b.key),
      `ordering violated at ${i}`,
    );
  }
  // Reproducible from the same import regardless of input row order — which the
  // old insertion-order tiebreak could not promise.
  const shuffled = [...ROWS].reverse();
  assert.deepEqual(now.map((r) => r.key), blastRadius(shuffled, ISSUES, SNAP).map((r) => r.key));
});

test('the join key is normalized on both sides (P1 #2), unlike the old raw-keyed map', () => {
  const lowerIssues = ISSUES.map((i) => ({ ...i, key: i.key.toLowerCase() }));
  const viaNew = blastRadius(ROWS, lowerIssues, SNAP).find((r) => r.key === 'HMS-1');
  assert.equal(viaNew.hasLive, true, 'a differently-cased live key still joins');
  // The old raw-keyed map would have missed it entirely.
  const viaOld = legacyBlastRadius(ROWS, new Map(lowerIssues.map((i) => [i.key, i])), SNAP)
    .find((r) => r.key === 'HMS-1');
  assert.equal(viaOld.hasLive, false, 'documenting the old behavior this fixes');
});

/* ========================= per-key case attribution ===================== */

test('a per-key row lists ONLY the cases linked to that key', () => {
  // CS000002 bridges HMS-1 and HMS-2, so the two keys share exactly one case.
  const rows = blastRadius(ROWS, ISSUES, SNAP);
  const hms1 = rows.find((r) => r.key === 'HMS-1');
  const hms2 = rows.find((r) => r.key === 'HMS-2');
  assert.deepEqual(hms1.cases.map((c) => c.number), ['CS000001', 'CS000002']);
  assert.deepEqual(hms2.cases.map((c) => c.number), ['CS000002', 'CS000003']);
  assert.equal(hms1.totalCount, 2);
  assert.equal(hms2.totalCount, 2);
  assert.equal(hms2.openCount, 1, 'CS000003 is closed');
});

test('those two keys are ONE cluster, but still two blast-radius rows', () => {
  const { clusters } = buildInsights(ROWS, ISSUES, SNAP);
  const bridged = clusters.find((c) => c.jiraKeys.includes('HMS-1'));
  assert.deepEqual(bridged.jiraKeys, ['HMS-1', 'HMS-2'], 'transitively one ecosystem');
  const perKey = blockersByJira([bridged], SNAP);
  assert.deepEqual(perKey.map((r) => r.key).sort(), ['HMS-1', 'HMS-2']);
  assert.ok(perKey.every((r) => r.clusterId === bridged.id));
});

test('open cases sort first inside a per-key case list, then by case number', () => {
  const hms2 = blastRadius(ROWS, ISSUES, SNAP).find((r) => r.key === 'HMS-2');
  assert.deepEqual(hms2.cases.map((c) => c.isClosed), [false, true]);
});

/* ====================== downstream consumers unchanged ================== */

test('blastRadiusSummary consumes the projection unchanged', () => {
  const nowRows = blastRadius(ROWS, ISSUES, SNAP);
  const oldRows = legacyBlastRadius(ROWS, RAW_MAP, SNAP);
  assert.deepStrictEqual(
    blastRadiusSummary(nowRows, JIRA_STALE_DAYS),
    blastRadiusSummary(oldRows, JIRA_STALE_DAYS),
  );
});

test('openCasesHistogram consumes the projection unchanged', () => {
  assert.deepStrictEqual(
    openCasesHistogram(blastRadius(ROWS, ISSUES, SNAP)),
    openCasesHistogram(legacyBlastRadius(ROWS, RAW_MAP, SNAP)),
  );
});

test('staleWithImpact consumes the projection unchanged', () => {
  const a = staleWithImpact(blastRadius(ROWS, ISSUES, SNAP), JIRA_STALE_DAYS, 10).map((r) => r.key);
  const b = staleWithImpact(legacyBlastRadius(ROWS, RAW_MAP, SNAP), JIRA_STALE_DAYS, 10).map((r) => r.key);
  assert.deepEqual(a, b);
  assert.ok(a.includes('HMS-1'), 'HMS-1 is 80d idle with an open case behind it');
});

test('fixVersionPipeline consumes the projection unchanged', () => {
  const strip = (p) => p.map(({ version, ticketCount, openCaseImpact }) => ({ version, ticketCount, openCaseImpact }));
  assert.deepStrictEqual(
    strip(fixVersionPipeline(ISSUES, blastRadius(ROWS, ISSUES, SNAP))),
    strip(fixVersionPipeline(ISSUES, legacyBlastRadius(ROWS, RAW_MAP, SNAP))),
  );
});

/* ======================= snapshot anchoring (P1 #5) ==================== */

test('daysOpen and daysSinceUpdate follow the snapshot, not the wall clock', () => {
  const at = (snap) => blastRadius(ROWS, ISSUES, snap).find((r) => r.key === 'HMS-1');
  const early = at(SNAP);
  const later = at(SNAP + 30 * DAY);
  assert.equal(early.daysSinceUpdate, 80);
  assert.equal(later.daysSinceUpdate, 110);
  assert.equal(early.cases.find((c) => c.number === 'CS000001').daysOpen, 100);
  assert.equal(later.cases.find((c) => c.number === 'CS000001').daysOpen, 130);
});

test('the same import always produces byte-identical rows', () => {
  const a = JSON.stringify(blastRadius(ROWS, ISSUES, SNAP).map(pickLegacy));
  const b = JSON.stringify(blastRadius(ROWS, ISSUES, SNAP).map(pickLegacy));
  assert.equal(a, b);
});

/* ================== percentile consolidation (P1 #1) =================== */

test('resolutionStatsByPriority now interpolates — the documented downward shift', () => {
  // Four resolved issues at one priority with lead times 1..4 days.
  const resolvedIssues = [1, 2, 3, 4].map((d, i) =>
    issue(`HMS-R${i}`, {
      priority: 'High',
      statusCategory: 'Done',
      resolved: new Date(SNAP - 1 * DAY),
      _leadMs: d * DAY,
    }));
  const [stat] = resolutionStatsByPriority(resolvedIssues, 90);
  assert.equal(stat.n, 4);
  // Interpolating median of [1,2,3,4] days.
  assert.equal(stat.p50, 2.5 * DAY);
  assert.equal(stat.p50, percentile([1, 2, 3, 4].map((d) => d * DAY), 50));
  // The old `Math.floor((p/100) * len)` form returned sorted[2] === 3 days: every
  // Jira median / p85 / p90 skewed HIGH. This is P1 #1, and the fix moves these
  // numbers DOWN on the /jira and /jira-stats pages.
  const oldForm = [1, 2, 3, 4].map((d) => d * DAY)[Math.min(3, Math.floor(0.5 * 4))];
  assert.equal(oldForm, 3 * DAY);
  assert.ok(stat.p50 < oldForm, 'the corrected median is lower than the biased one');
});

test('cycleLeadStats uses the same shared percentile', () => {
  const issues = [1, 2, 3, 4].map((d, i) => issue(`HMS-C${i}`, { _cycleMs: d * DAY, _leadMs: d * DAY }));
  const { cycle, lead } = cycleLeadStats(issues);
  assert.equal(cycle.median, 2.5 * DAY);
  assert.equal(lead.median, 2.5 * DAY);
  assert.equal(cycle.n, 4);
  assert.equal(cycle.p85, percentile([1, 2, 3, 4].map((d) => d * DAY), 85));
  // Unsorted input must still be handled (statOf sorts first).
  const shuffled = [3, 1, 4, 2].map((d, i) => issue(`HMS-S${i}`, { _cycleMs: d * DAY }));
  assert.equal(cycleLeadStats(shuffled).cycle.median, 2.5 * DAY);
});

/* ============================== edge cases ============================== */

test('no ServiceNow rows, no Jira issues, or neither — all degrade quietly', () => {
  assert.deepEqual(blastRadius([], ISSUES, SNAP), []);
  assert.deepEqual(blastRadius(null, null, SNAP), []);
  // Rows but no sync: the clusters still exist, because the LINK lives in the
  // ServiceNow case journal, not in Jira.
  const noSync = blastRadius(ROWS, [], SNAP);
  assert.ok(noSync.length > 0);
  assert.ok(noSync.every((r) => r.hasLive === false));
  assert.deepStrictEqual(
    noSync.map(pickLegacy).sort(byKeyAsc),
    legacyBlastRadius(ROWS, new Map(), SNAP).map(pickLegacy).sort(byKeyAsc),
  );
});

test('a null snapshot yields null ages rather than inventing them', () => {
  const rows = blastRadius(ROWS, ISSUES, null);
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r) => r.daysSinceUpdate === null));
  assert.ok(rows.every((r) => r.cases.every((c) => c.daysOpen === null)));
});
