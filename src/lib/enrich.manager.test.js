// Manager column (v12): the assignee's manager must map from every export
// layout (XLSX "Manager" label, CSV `manager` or dot-walked
// `assigned_to.manager`), bake IDENTICALLY across the two enrichment pipelines
// (enrichRow for the UI, enrichForSql for the DuckDB worker), and sit in
// SQL_COLUMNS so the worker's Arrow build carries it. Runs under `node --test`.
import test from "node:test";
import assert from "node:assert/strict";

import {
  enrichRow,
  enrichForSql,
  normalizeXlsxRow,
  managerOf,
  SQL_COLUMNS,
} from "./enrich.js";

const SNAP = 1_717_200_000_000; // fixed data-as-of anchor (no Date.now in tests)

/* ============================ XLSX mapping ============================ */

test("normalizeXlsxRow maps the 'Manager' display label to `manager`", () => {
  const out = normalizeXlsxRow({
    Number: "CS0001",
    "Assigned to": "Agent Name (Infor)",
    Manager: "Manager Name (Infor)",
    Created: "2026-05-30 09:00:00",
  });
  assert.equal(out.manager, "Manager Name (Infor)");
});

test("normalizeXlsxRow yields null manager when the export has no Manager column", () => {
  const out = normalizeXlsxRow({ Number: "CS0002", Created: "2026-05-30 09:00:00" });
  assert.equal(out.manager, null);
});

/* ============================= managerOf ============================== */

test("managerOf reads `manager` and falls back to the CSV dot-walked field", () => {
  assert.equal(managerOf({ manager: "M1 (Infor)" }), "M1 (Infor)");
  assert.equal(managerOf({ "assigned_to.manager": "M2 (Infor)" }), "M2 (Infor)");
  // Explicit `manager` wins over the dot-walked alias when both exist.
  assert.equal(managerOf({ manager: "M1", "assigned_to.manager": "M2" }), "M1");
  assert.equal(managerOf({}), null);
  // CSV blanks stay "" (falsy) — consumers bucket them as "No manager".
  assert.equal(managerOf({ manager: "" }), "");
});

/* =============================== parity =============================== */

const RAW_ROWS = [
  { number: "A-1", state: "Open", priority: "3 - Standard", sys_created_on: "2026-05-30 09:00:00", manager: "Manager Name (Infor)" },
  { number: "A-2", state: "Closed", priority: "2 - Major", sys_created_on: "2026-05-29 09:00:00", closed_at: "2026-05-30 09:00:00", "assigned_to.manager": "Other Manager (Infor)" },
  { number: "A-3", state: "Resolved", priority: "1 - Critical", sys_created_on: "2026-05-31 08:00:00" }, // no manager at all
];

test("parity: enrichRow and enrichForSql bake the same normalized manager", () => {
  for (const r of RAW_ROWS) {
    const ui = enrichRow(r, SNAP);
    const sql = enrichForSql(r, SNAP);
    assert.equal(ui.manager, sql.manager, `parity mismatch on ${r.number}`);
    assert.equal(ui.manager, managerOf(r));
  }
});

test("dot-walked CSV manager lands on the normalized `manager` key in both pipelines", () => {
  const ui = enrichRow(RAW_ROWS[1], SNAP);
  const sql = enrichForSql(RAW_ROWS[1], SNAP);
  assert.equal(ui.manager, "Other Manager (Infor)");
  assert.equal(sql.manager, "Other Manager (Infor)");
});

/* ============================ SQL schema ============================== */

test("SQL_COLUMNS carries `manager` and enrichForSql never emits undefined for it", () => {
  assert.ok(SQL_COLUMNS.includes("manager"));
  for (const r of RAW_ROWS) {
    const baked = enrichForSql(r, SNAP);
    assert.notEqual(baked.manager, undefined, `undefined manager on ${r.number}`);
  }
  // Missing column bakes NULL (not "", not undefined) so the "No manager" SQL
  // sentinel `(manager IS NULL OR manager = '')` matches it.
  assert.equal(enrichForSql(RAW_ROWS[2], SNAP).manager, null);
});
