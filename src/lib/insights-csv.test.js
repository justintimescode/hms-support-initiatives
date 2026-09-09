// CSV export tests for the Operations view.
//
// The one that matters most is FORMULA INJECTION. A ServiceNow free-text field
// can contain `=cmd|'/c calc'!A1`; inert in the browser, it executes when the
// .csv is opened in Excel. A past feature in this repo wrote its own `escapeCsv`
// that only did RFC-4180 quoting and shipped exactly that hole (SECURITY #7), so
// these builders must route every cell through `sanitizeCellForExport` via
// `rowsToCsv` — asserted here rather than assumed.
//
// Second: "Not linked" must be written as the WORD. A 0 in a spreadsheet column
// headed "Days linked" reads as "linked today", which is a false claim.
//
// Runs under `node --test`.
import test from 'node:test';
import assert from 'node:assert/strict';

import { enrichRow } from './enrich.js';
import { buildInsights } from './insight-rank.js';
import {
  CLUSTER_COLUMNS, CASE_COLUMNS, clusterCsvRows, caseCsvRows, clustersToCsv, casesToCsv,
} from './insights-csv.js';

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

// One case with a System link note (real "days linked"), one cause-only (null),
// and one carrying a spreadsheet formula payload in its free text.
const ROWS = [
  row({
    number: 'CS000001', account: 'Acme Resorts', priority: '2 - Major', state: 'Open',
    region: 'NA', assignment_group: 'Hospitality - HMS Support', product_line: 'HMS',
    assigned_to: 'Ana', manager: 'Mgr One', short_description: 'folio total wrong',
    sys_created_on: fmtTs(SNAP - 60 * DAY), work_notes: linkNote(SNAP - 40 * DAY, 'HMS-1'),
  }),
  row({
    number: 'CS000002', account: 'Beta Hotels', priority: '1 - Critical', state: 'Open',
    short_description: 'audit hangs', sys_created_on: fmtTs(SNAP - 20 * DAY), cause: 'HMS-1',
  }),
  row({
    number: 'CS000003', priority: '3 - Medium', state: 'Open',
    // Every classic injection prefix, plus a comma/quote/newline torture test.
    account: '=cmd|\'/c calc\'!A1',
    short_description: '+HYPERLINK("http://evil","click"), "quoted", line\nbreak',
    sys_created_on: fmtTs(SNAP - 5 * DAY), cause: 'HMS-2',
  }),
];

const ISSUES = [
  { key: 'HMS-1', url: 'u', summary: '@SUM(1,2)', issueType: 'Bug', status: 'In Progress', statusCategory: 'In Progress', priority: 'Highest', assignee: 'Dev', fixVersions: ['24.1'], created: new Date(SNAP - 90 * DAY), updated: new Date(SNAP - 50 * DAY) },
  { key: 'HMS-2', url: 'u', summary: 'Two', issueType: 'Bug', status: 'To Do', statusCategory: 'To Do', priority: 'Low', assignee: 'Dev', fixVersions: [], created: new Date(SNAP - 10 * DAY), updated: new Date(SNAP - 1 * DAY) },
];

const CLUSTERS = buildInsights(ROWS, ISSUES, SNAP).clusters;

/* =============================== shape ================================= */

test('fixtures produce clusters to export', () => {
  assert.ok(CLUSTERS.length >= 2);
});

test('every row has exactly one cell per declared column', () => {
  for (const r of clusterCsvRows(CLUSTERS)) assert.equal(r.length, CLUSTER_COLUMNS.length);
  for (const r of caseCsvRows(CLUSTERS)) assert.equal(r.length, CASE_COLUMNS.length);
});

test('the case CSV has one row per case across all clusters', () => {
  const expected = CLUSTERS.reduce((n, c) => n + c.cases.length, 0);
  assert.equal(caseCsvRows(CLUSTERS).length, expected);
});

test('headers are unique and non-empty', () => {
  for (const cols of [CLUSTER_COLUMNS, CASE_COLUMNS]) {
    assert.equal(new Set(cols).size, cols.length);
    assert.ok(cols.every((c) => typeof c === 'string' && c.length > 0));
  }
});

/* ========================= formula injection ============================ */

test('SECURITY #7: a leading formula trigger is neutralized in the output', () => {
  const csv = casesToCsv(CLUSTERS);
  // The payload is present as TEXT...
  assert.ok(csv.includes("calc"), 'the value itself is still exported');
  // ...but never as a cell that a spreadsheet would evaluate. Every dangerous
  // leading character must be preceded by the single-quote guard.
  for (const bad of ['="', '"+HYPERLINK', '"@SUM', '"-', '"\t']) {
    assert.ok(!csv.includes(bad), `unguarded formula cell found: ${bad}`);
  }
  assert.ok(csv.includes('"\'=cmd'), 'the = payload is quote-prefixed');
  assert.ok(csv.includes('"\'+HYPERLINK'), 'the + payload is quote-prefixed');
});

test('SECURITY #7: a Jira summary starting with @ is neutralized too', () => {
  const csv = clustersToCsv(CLUSTERS);
  assert.ok(!/,"@SUM/.test(csv) && !/^"@SUM/m.test(csv), 'no bare @ cell');
});

test('every dangerous STRING cell appears in the document only in guarded form', () => {
  // Safety is a property of the DOCUMENT, not of the row arrays — the builders
  // pass values through verbatim and `rowsToCsv` is the single choke point (see
  // the next test). So: take each string cell that starts with a formula
  // trigger, and require the document to contain its quote-prefixed form and
  // NOT its bare form.
  //
  // Only strings are checked, deliberately: `sanitizeCellForExport` leaves
  // non-strings alone because a numeric cell cannot carry a payload — Excel
  // parses `-30` (a negative age delta) as the number -30, never as a formula.
  const DANGEROUS = ['=', '+', '-', '@', '\t', '\r', '\n'];
  let checked = 0;
  for (const [rows, doc] of [
    [clusterCsvRows(CLUSTERS), clustersToCsv(CLUSTERS)],
    [caseCsvRows(CLUSTERS), casesToCsv(CLUSTERS)],
  ]) {
    for (const cell of rows.flat()) {
      if (typeof cell !== 'string' || cell.length === 0) continue;
      if (!DANGEROUS.includes(cell[0])) continue;
      checked++;
      const quoted = cell.replace(/"/g, '""');
      assert.ok(doc.includes(`"'${quoted}"`), `not neutralized: ${JSON.stringify(cell.slice(0, 40))}`);
      assert.ok(!doc.includes(`"${quoted}"`), `bare payload present: ${JSON.stringify(cell.slice(0, 40))}`);
    }
  }
  assert.ok(checked >= 2, `the scan must find real payloads to check (found ${checked})`);
});

test('the guard is applied by the writer, not by the builders', () => {
  // The builders pass values through verbatim — `rowsToCsv` is the single choke
  // point. Proven by finding a RAW payload in the builder output and its
  // NEUTRALIZED form in the document, so nobody can later "helpfully" sanitize
  // in the builder and leave a second, divergent guard behind.
  const raw = caseCsvRows(CLUSTERS).flat().find((c) => typeof c === 'string' && c.startsWith('=cmd'));
  assert.ok(raw, 'the builder emits the value unmodified');
  assert.ok(casesToCsv(CLUSTERS).includes(`"'${raw.split(',')[0]}`.slice(0, 8)), 'the document neutralizes it');
});

test('commas, quotes and newlines inside a value do not break the row structure', () => {
  const csv = casesToCsv(CLUSTERS);
  // RFC-4180: internal quotes doubled. The torture-test description contains a
  // quoted phrase, so the doubled form must appear.
  assert.ok(csv.includes('""quoted""'), 'internal quotes are doubled');
  // Header + one line per case, with the embedded newline safely inside quotes:
  // counting CRLF row separators (which the builder uses) is exact.
  const dataRows = csv.split('\r\n').length - 1;
  assert.equal(dataRows, caseCsvRows(CLUSTERS).length);
});

/* ====================== "Not linked" is never 0 ========================= */

test('a case with no System link note exports the WORD "Not linked", never 0', () => {
  const rows = caseCsvRows(CLUSTERS);
  const idx = CASE_COLUMNS.indexOf('Days linked');
  const byNumber = new Map(rows.map((r) => [r[0], r]));
  // CS000001 has a real link note 40 days before the snapshot.
  assert.equal(byNumber.get('CS000001')[idx], 40);
  // CS000002 / CS000003 came from `cause` only — no link date exists.
  for (const n of ['CS000002', 'CS000003']) {
    assert.equal(byNumber.get(n)[idx], 'Not linked', `${n} must export the word`);
    assert.notEqual(byNumber.get(n)[idx], 0);
  }
  assert.ok(clustersToCsv(CLUSTERS).length > 0);
});

test('an unknown numeric metric exports as blank, not as a misleading 0', () => {
  const rows = clusterCsvRows(CLUSTERS);
  const urgency = CLUSTER_COLUMNS.indexOf('Urgency (0-100)');
  const worst = CLUSTER_COLUMNS.indexOf('Worst escalation risk');
  for (const r of rows) {
    for (const i of [urgency, worst]) {
      assert.ok(r[i] === '' || typeof r[i] === 'number', `cell ${i} must be a number or blank, got ${r[i]}`);
      assert.notEqual(r[i], null);
      assert.notEqual(r[i], 'null');
    }
  }
});

/* ====================== per-case linkage attribution ==================== */

test('each case row lists only ITS OWN linked keys, not the whole cluster', () => {
  // CS000001 and CS000002 both link HMS-1; CS000003 links HMS-2 separately.
  const rows = caseCsvRows(CLUSTERS);
  const keyIdx = CASE_COLUMNS.indexOf('Linked Jira keys');
  const byNumber = new Map(rows.map((r) => [r[0], r]));
  assert.equal(byNumber.get('CS000001')[keyIdx], 'HMS-1');
  assert.equal(byNumber.get('CS000002')[keyIdx], 'HMS-1');
  assert.equal(byNumber.get('CS000003')[keyIdx], 'HMS-2');
});

test('the newly mapped Region and Assignment group columns are exported', () => {
  const rows = caseCsvRows(CLUSTERS);
  const r = rows.find((x) => x[0] === 'CS000001');
  assert.equal(r[CASE_COLUMNS.indexOf('Region')], 'NA');
  assert.equal(r[CASE_COLUMNS.indexOf('Assignment group')], 'Hospitality - HMS Support');
});

test('the explainable score is exported alongside it, so a CSV reader sees WHY', () => {
  const rows = clusterCsvRows(CLUSTERS);
  const why = CLUSTER_COLUMNS.indexOf('Why it ranks here');
  const score = CLUSTER_COLUMNS.indexOf('Impact score');
  for (const r of rows) {
    assert.ok(String(r[why]).includes('+'), 'factor weights must be spelled out');
    assert.equal(typeof r[score], 'number');
  }
});

/* ============================ determinism ============================== */

test('the same clusters export byte-identically', () => {
  assert.equal(clustersToCsv(CLUSTERS), clustersToCsv(CLUSTERS));
  assert.equal(casesToCsv(CLUSTERS), casesToCsv(CLUSTERS));
});

test('empty input yields a header-only document rather than throwing', () => {
  assert.equal(clustersToCsv([]), clustersToCsv([]));
  assert.ok(clustersToCsv([]).startsWith('"Cluster"'));
  assert.equal(clustersToCsv([]).split('\r\n').length, 1);
  assert.ok(casesToCsv(null).startsWith('"Case"'));
});
