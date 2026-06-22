// Export tests: build the workbook in Node, write it to a buffer, reload it,
// and assert it opens cleanly with both sheets, the EXACT per-case column order,
// the right content, and a working formula-injection guard. Runs under
// `node --test` (exceljs is a Node library, so the round-trip is real).
import test from "node:test";
import assert from "node:assert/strict";

import { enrichRow } from "./enrich.js";
import { buildSentimentWorkbook, PER_CASE_COLUMNS } from "./sentiment-export.js";

const SNAP = 1_717_200_000_000;
const journal = (entries) => entries.map((e) => `${e.ts} - ${e.author}\n${e.body}`).join("\n\n");
const CUST = "Guest Contact";
const ANALYST = "Agent Name (Infor) (Additional comments)";

const POS_J = journal([{ ts: "2026-05-31 10:00:00", author: CUST, body: "Perfect, that resolved it. Thank you!" }]);
const NEG_J = journal([{ ts: "2026-05-31 09:00:00", author: CUST, body: "Still broken, still failing, unacceptable." }]);
const SILENT_J = journal([{ ts: "2026-05-31 09:00:00", author: ANALYST, body: "Closed via phone, no reply needed." }]);

const RAW = [
  { number: "P-1", account: "Acme", contact: "Pat Guest", priority: "3 - Standard", state: "Closed", status: "Closed", product_line: "HMS", sys_created_on: "2026-05-30 09:00:00", closed_at: "2026-05-31 09:00:00", work_notes: POS_J },
  { number: "N-1", account: "Beta", contact: "Sam Guest", priority: "1 - Critical", state: "Open", status: "Open", product_line: "HMS", sys_created_on: "2026-05-31 08:00:00", work_notes: NEG_J },
  { number: "S-1", account: "Gamma", contact: "Lee Guest", priority: "3 - Standard", state: "Closed", status: "Closed", product_line: "HMS", sys_created_on: "2026-05-30 09:00:00", closed_at: "2026-05-31 09:00:00", work_notes: SILENT_J },
];

// The exact column order from the brief / review spreadsheet (hardcoded so the
// test validates against the SPEC, not just the module's own constant).
const EXPECTED_COLUMNS = [
  "Case", "Account", "Contact", "Priority", "Status", "Created", "Closed",
  "Product", "My msgs", "Cust msgs", "First reply (h)", "Valence (-5..+5)",
  "Sentiment", "Start", "End", "Arc", "Emotions", "Frustration target",
  "Representative customer quote", "Coaching note", "Auto-closed",
];

async function reload(rows) {
  const wb = await buildSentimentWorkbook(rows);
  const buf = await wb.xlsx.writeBuffer(); // proves it serializes cleanly
  const ExcelJS = (await import("exceljs")).default;
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(buf); // proves it re-opens cleanly
  return wb2;
}

test("module column constant matches the spec order exactly", () => {
  assert.deepStrictEqual(PER_CASE_COLUMNS, EXPECTED_COLUMNS);
});

test("workbook has both sheets, exact per-case column order, and round-trips cleanly", async () => {
  const rows = RAW.map((r) => enrichRow(r, SNAP));
  const wb = await reload(rows);

  assert.deepStrictEqual(wb.worksheets.map((ws) => ws.name), ["Headline Metrics", "Per-Case Detail"]);

  const pc = wb.getWorksheet("Per-Case Detail");
  assert.deepStrictEqual(pc.getRow(1).values.slice(1), EXPECTED_COLUMNS);
  assert.equal(pc.rowCount, 1 + RAW.length); // header + every analyzed case

  const idx = (name) => EXPECTED_COLUMNS.indexOf(name);
  const p1 = pc.getRow(2).values.slice(1); // graded order mirrors rows order
  assert.equal(p1[idx("Case")], "P-1");
  assert.equal(p1[idx("Contact")], "Pat Guest");
  assert.equal(p1[idx("Sentiment")], "Positive");
  assert.ok(p1[idx("Valence (-5..+5)")] > 0);
  assert.equal(p1[idx("Auto-closed")], ""); // closed but had a customer message

  const s1 = pc.getRow(4).values.slice(1);
  assert.equal(s1[idx("Case")], "S-1");
  assert.ok(!s1[idx("Sentiment")]); // silent → no sentiment
  assert.equal(s1[idx("Auto-closed")], "Yes"); // closed with no customer message
});

test("headline metrics sheet carries the coverage / distribution numbers", async () => {
  const rows = RAW.map((r) => enrichRow(r, SNAP));
  const wb = await reload(rows);
  const hm = wb.getWorksheet("Headline Metrics");

  assert.deepStrictEqual(hm.getRow(1).values.slice(1), ["Section", "Metric", "Value", "Detail"]);

  const metrics = {};
  hm.eachRow((row, i) => {
    if (i === 1) return;
    const v = row.values.slice(1); // [section, metric, value, detail]
    metrics[v[1]] = v[2];
  });
  assert.equal(metrics["Cases analyzed"], 3);
  assert.equal(metrics["Scoreable cases"], 2);
  assert.equal(metrics["Phone / silent (no written customer voice)"], 1);
  assert.equal(metrics["Auto-closed (closed, no customer message)"], 1);
  assert.equal(metrics["Positive"], 1);
  assert.equal(metrics["Negative"], 1);
});

test("auto-closed keys off the body-based signal, not the header count", async () => {
  // A closed case whose only customer entry has an EMPTY body → not scoreable
  // (no written customer voice) but customer_turns=1. Auto-closed must use
  // scoreable, not custMsgs===0, so this still counts as auto-closed.
  const row = enrichRow(
    { number: "Y-1", state: "Closed", status: "Closed", sys_created_on: "2026-05-30 09:00:00", closed_at: "2026-05-31 09:00:00", work_notes: "2026-05-31 09:00:00 - Guest Person\n" },
    SNAP,
  );
  const wb = await reload([row]);
  const pc = wb.getWorksheet("Per-Case Detail");
  const v = pc.getRow(2).values.slice(1);
  const idx = (n) => EXPECTED_COLUMNS.indexOf(n);
  assert.ok(!v[idx("Sentiment")]); // empty body → not scoreable → blank
  assert.equal(v[idx("Auto-closed")], "Yes");
});

test("formula-injection guard: a leading-= cell is escaped (SECURITY #7)", async () => {
  const rows = [enrichRow({ number: "X-1", account: "=cmd|'/c calc'!A1", state: "Open", sys_created_on: "2026-05-31 09:00:00", work_notes: POS_J }, SNAP)];
  const wb = await reload(rows);
  const pc = wb.getWorksheet("Per-Case Detail");
  const account = pc.getRow(2).values.slice(1)[EXPECTED_COLUMNS.indexOf("Account")];
  assert.ok(typeof account === "string" && account.startsWith("'="), `account not escaped: ${account}`);
});
