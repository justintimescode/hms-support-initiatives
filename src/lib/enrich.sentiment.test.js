// Phase-2 bake tests: the sentiment_* columns must be IDENTICAL across the two
// enrichment pipelines (enrichRow for the UI, enrichForSql for the DuckDB
// worker), must match a direct gradeCase call, and must survive the worker's
// Arrow column build for silent (null-scalar) cases. Runs under `node --test`.
import test from "node:test";
import assert from "node:assert/strict";
import * as arrow from "apache-arrow";

import { enrichRow, enrichForSql, SQL_COLUMNS, SCHEMA_VERSION } from "./enrich.js";
import { gradeCase } from "./sentiment.js";

const SNAP = 1_717_200_000_000; // fixed data-as-of anchor (no Date.now in tests)
const SENTIMENT_KEYS = SQL_COLUMNS.filter((k) => k.startsWith("sentiment_"));

const journal = (entries) => entries.map((e) => `${e.ts} - ${e.author}\n${e.body}`).join("\n\n");
const CUST = "Guest Contact";
const ANALYST = "Agent Name (Infor) (Additional comments)";

const POS_J = journal([{ ts: "2026-05-31 10:00:00", author: CUST, body: "Perfect, that resolved it. Thank you!" }]);
const RECOVERY_J = journal([
  { ts: "2026-05-31 09:00:00", author: CUST, body: "This is broken and not working, very frustrating." },
  { ts: "2026-05-31 16:00:00", author: CUST, body: "Resolved now, thank you very much!" },
]);
const NEG_J = journal([{ ts: "2026-05-31 09:00:00", author: CUST, body: "Still broken, still failing, unacceptable." }]);
const SILENT_J = journal([{ ts: "2026-05-31 09:00:00", author: ANALYST, body: "Closed via phone, no reply needed." }]);

// Representative raw rows (pre-enrichment), mirroring normalizeXlsxRow output.
const ROWS = [
  { number: "P-1", account: "Acme", priority: "3 - Standard", state: "Closed", sys_created_on: "2026-05-30 09:00:00", closed_at: "2026-05-31 09:00:00", work_notes: POS_J },
  { number: "R-1", account: "Beta", priority: "2 - Major", state: "Resolved", sys_created_on: "2026-05-29 09:00:00", work_notes: RECOVERY_J, first_response_time: "2 Hours" },
  { number: "N-1", account: "Gamma", priority: "1 - Critical", state: "Open", sys_created_on: "2026-05-31 08:00:00", work_notes: NEG_J },
  { number: "S-1", account: "Delta", priority: "3 - Standard", state: "Closed", sys_created_on: "2026-05-30 09:00:00", closed_at: "2026-05-31 09:00:00", work_notes: SILENT_J },
  { number: "F-1", account: "Epsilon", work_notes: null, additional_comments: POS_J }, // exercises the additional_comments fallback
];

const pickSentiment = (obj) => Object.fromEntries(SENTIMENT_KEYS.map((k) => [k, obj[k]]));

// The expected snake_case shape from a direct gradeCase call.
const fromGradeCase = (g) => ({
  sentiment_scoreable: g.scoreable,
  sentiment_valence: g.valence,
  sentiment_label: g.sentiment,
  sentiment_start: g.start,
  sentiment_end: g.end,
  sentiment_arc: g.arc,
  sentiment_emotions: g.emotions,
  sentiment_target: g.frustrationTarget,
  sentiment_quote: g.quote,
  sentiment_coaching: g.coachingNote,
  sentiment_pii: g.pii,
  sentiment_dup: g.dup,
});

/* ============================ schema sanity =========================== */

test("schema: version bumped to '9' and all 12 sentiment columns present, unique", () => {
  assert.equal(SCHEMA_VERSION, "9");
  assert.equal(SENTIMENT_KEYS.length, 12);
  assert.equal(new Set(SQL_COLUMNS).size, SQL_COLUMNS.length); // no dupes
});

/* =============================== parity =============================== */

test("parity: enrichRow(r).sentiment_* deep-equals enrichForSql(r).sentiment_*", () => {
  for (const r of ROWS) {
    const fromRow = pickSentiment(enrichRow(r, SNAP));
    const fromSql = pickSentiment(enrichForSql(r, SNAP));
    assert.deepStrictEqual(fromRow, fromSql, `parity mismatch on ${r.number}`);
  }
});

test("parity: types are identical (no BigInt/Number drift) on the numeric columns", () => {
  for (const r of ROWS) {
    const a = enrichRow(r, SNAP);
    const b = enrichForSql(r, SNAP);
    for (const k of ["sentiment_valence", "sentiment_start", "sentiment_end"]) {
      assert.equal(typeof a[k], typeof b[k], `${k} type drift on ${r.number}`);
      // plain Number | null — never BigInt (that would break the deep-equal)
      assert.ok(a[k] === null || typeof a[k] === "number", `${k} not Number|null`);
    }
  }
});

/* ===================== baked == direct gradeCase ====================== */

test("baked sentiment fields match a direct gradeCase call (no first_response_time → identical coaching)", () => {
  for (const r of ROWS.filter((r) => r.first_response_time == null)) {
    const baked = pickSentiment(enrichForSql(r, SNAP));
    assert.deepStrictEqual(baked, fromGradeCase(gradeCase(r)), `gradeCase mismatch on ${r.number}`);
  }
});

/* ===================== silent row: null survival ===================== */

test("silent row → scoreable:false, null scalars, false hygiene, no undefined columns", () => {
  const out = enrichForSql(ROWS[3], SNAP); // S-1, analyst-only
  assert.equal(out.sentiment_scoreable, false);
  for (const k of ["sentiment_valence", "sentiment_label", "sentiment_start", "sentiment_end", "sentiment_arc", "sentiment_emotions", "sentiment_target", "sentiment_quote"]) {
    assert.equal(out[k], null, `${k} should be null for a silent case`);
  }
  assert.equal(typeof out.sentiment_coaching, "string"); // coaching note is always a string
  assert.equal(out.sentiment_pii, false);
  assert.equal(out.sentiment_dup, false);

  // No column may be `undefined` — buildArrowTable reads r[k] for every
  // SQL_COLUMNS key and undefined would muddle Arrow type inference.
  for (const k of SQL_COLUMNS) {
    assert.notEqual(typeof out[k], "undefined", `${k} is undefined`);
  }
});

/* =============== Arrow column build (the worker's path) =============== */

test("Arrow: mixed scored/silent rows build cleanly and round-trip (nullable BIGINT/VARCHAR/BOOLEAN)", () => {
  const scored = enrichForSql(ROWS[0], SNAP); // P-1, positive
  const silent = enrichForSql(ROWS[3], SNAP); // S-1, null scalars

  // Replicate buildArrowTable (db.worker.js) for the sentiment columns + number.
  const cols = {};
  for (const k of [...SENTIMENT_KEYS, "number"]) cols[k] = [scored[k], silent[k]];
  const table = arrow.tableFromArrays(cols);

  assert.equal(table.numRows, 2);

  const valence = table.getChild("sentiment_valence");
  assert.equal(Number(valence.get(0)), scored.sentiment_valence); // scored int round-trips
  assert.equal(valence.get(1), null); // silent → null survives

  const label = table.getChild("sentiment_label");
  assert.equal(label.get(0), scored.sentiment_label);
  assert.equal(label.get(1), null);

  const scoreable = table.getChild("sentiment_scoreable");
  assert.equal(scoreable.get(0), true);
  assert.equal(scoreable.get(1), false);
});
