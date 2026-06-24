// v10 Solution Proposed (State="Resolved") behavior. Two coordinated rules, kept
// isolated from each other:
//
//  SLA cadence (computeSlaSop) — three distinct clock-stops: cadence trailing gap
//  stops at the last INFOR update (ts[last]); initial response is judged to the
//  snapshot/close; a resolved case idling no longer accrues a trailing-gap breach,
//  but pre-resolution gaps + missed initial responses still breach.
//
//  Auto-close countdown — starts when the RESOLUTION NOTES are saved (the
//  `<b>Resolution notes</b>` journal entry's timestamp = `resolved_at_ms`), NOT the
//  last activity. ServiceNow "Case Resolved - Reminder N" auto-close WARNING notes
//  do NOT move the anchor. Marker-less resolved rows fall back to the last Infor
//  note, then created; the anchor is clamped >= created.
//
//  System exclusion — auto-resolution / auto-close-reminder notes (authored
//  "System  Automatic Reminders (Infor)") are excluded from Infor-update detection
//  (parseInforUpdates) and interaction turns (parseInteractions); the "(Infor)" tag
//  used to mis-count them as analyst work.
//
// Parity is sacred: enrichRow and enrichForSql bake identical values. Runs under
// `node --test`.
import test from "node:test";
import assert from "node:assert/strict";

import {
  enrichRow,
  enrichForSql,
  computeSlaSop,
  parseResolutionTime,
  parseInforUpdates,
  parseInteractions,
} from "./enrich.js";
import {
  SOLUTION_PROPOSED_AUTOCLOSE_MS,
  SUPPORT_THRESHOLDS_MS,
  INITIAL_RESPONSE_MS,
} from "./sop-thresholds.js";

/* ----------------------------- fixtures ------------------------------ */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const P3_CADENCE = SUPPORT_THRESHOLDS_MS[3]; // 3 days
const P3_INITIAL = INITIAL_RESPONSE_MS[3]; // 2 hours

// Fixed data-as-of anchor at NOON local (no Date.now in tests). Noon ± whole
// days/hours never lands in a DST gap/overlap, so the ms → local-string → ms
// round-trip through the journal headers is exact regardless of machine TZ.
const SNAP = new Date(2026, 5, 24, 12, 0, 0, 0).getTime();

const pad = (n) => String(n).padStart(2, "0");
const fmtTs = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};
const INFOR = "Jane Doe (Infor) (Additional comments)"; // genuine analyst
const CUST = "Guest Contact"; // a customer turn (no "(Infor)")
// The polluting system author: leads with "System", but ServiceNow tags it "(Infor)".
const SYS = "System  Automatic Reminders (Infor) (Work notes)";
const REMINDER_BODY =
  "ServiceNow has automatically sent the 'Case Resolved - Reminder 1' email notification. It has been 30 business days since the Case transitioned to the 'Resolved' state.";
const RES_BODY = "[code]<b>Resolution notes</b>[/code]\nResolved per the customer.";

const entry = (ms, author, body = "update") => `${fmtTs(ms)} - ${author}\n${body}`;
const resEntry = (ms) => `${fmtTs(ms)} - ${INFOR}\n${RES_BODY}`; // Infor resolution-notes save
const journal = (entries) => entries.filter(Boolean).join("\n\n");

// A Solution-Proposed (state=Resolved) raw row. `resolveMs` injects an Infor
// resolution-notes entry (the auto-close anchor); `system` injects reminder notes.
const resolved = ({ number, createdMs, infor = [], cust = [], system = [], resolveMs = null, frtMs = null }) => {
  const all = journal([
    ...infor.map((ms) => entry(ms, INFOR)),
    ...cust.map((ms) => entry(ms, CUST)),
    ...system.map((ms) => entry(ms, SYS, REMINDER_BODY)),
    resolveMs == null ? null : resEntry(resolveMs),
  ]);
  return {
    number,
    state: "Resolved",
    status: "Solution Proposed",
    priority: "3 - Medium",
    sys_created_on: fmtTs(createdMs),
    work_notes: all || null,
    additional_comments: all || null,
    first_response_time: frtMs == null ? null : String(frtMs),
  };
};

/* --- rows under test (all P3 → 3d cadence, 2h initial) --- */

// (1) Resolved, healthy cadence, resolution notes saved 40d before the snapshot.
const SP_HEALTHY = resolved({
  number: "SP-HEALTHY",
  createdMs: SNAP - 50 * DAY,
  infor: [SNAP - 50 * DAY + HOUR, SNAP - 48 * DAY, SNAP - 46 * DAY, SNAP - 44 * DAY, SNAP - 42 * DAY],
  resolveMs: SNAP - 40 * DAY,
});

// (2) Resolved, first response took 5h (> 2h P3 initial). Still breaches.
const SP_INITIAL_MISS = resolved({
  number: "SP-INITIAL",
  createdMs: SNAP - 50 * DAY,
  infor: [SNAP - 50 * DAY + 5 * HOUR],
  resolveMs: SNAP - 49 * DAY,
  frtMs: 5 * HOUR,
});

// (3) Resolved, >cadence gap (~11d) between the first Infor reply and the
//     resolution. Still breaches cadence.
const SP_GAP = resolved({
  number: "SP-GAP",
  createdMs: SNAP - 50 * DAY,
  infor: [SNAP - 50 * DAY + HOUR],
  resolveMs: SNAP - 39 * DAY,
  frtMs: HOUR,
});

// (4) Regression: a truly-open case (no resolution). Cadence runs to snapshot.
const OPEN = {
  number: "OPEN-1",
  state: "Open",
  status: "Open",
  priority: "3 - Medium",
  sys_created_on: fmtTs(SNAP - 50 * DAY),
  work_notes: journal([entry(SNAP - 40 * DAY, INFOR)]),
  additional_comments: journal([entry(SNAP - 40 * DAY, INFOR)]),
  first_response_time: String(HOUR),
};

// (6) Resolved 85d ago → auto-close 5d in the FUTURE (≤7d).
const SP_SOON = resolved({
  number: "SP-SOON",
  createdMs: SNAP - 86 * DAY,
  infor: [SNAP - 86 * DAY + HOUR],
  resolveMs: SNAP - 85 * DAY,
  frtMs: HOUR,
});

// (6) Resolved 95d ago → auto-close already PAST the snapshot.
const SP_PAST = resolved({
  number: "SP-PAST",
  createdMs: SNAP - 96 * DAY,
  infor: [SNAP - 96 * DAY + HOUR],
  resolveMs: SNAP - 95 * DAY,
  frtMs: HOUR,
});

// (7) Resolved with NO journal → no resolution marker, no Infor note; auto-close
//     falls back to creation. Infor never responded → 'initial' miss.
const SP_NULLJ = {
  number: "SP-NULLJ",
  state: "Resolved",
  status: "Solution Proposed",
  priority: "3 - Medium",
  sys_created_on: fmtTs(SNAP - 10 * DAY),
  work_notes: null,
  additional_comments: null,
  first_response_time: null,
};

// (F1) Resolved, Infor NEVER replied, only an early customer post, no resolution
//      marker. Auto-close falls back to created; SLA still breaches 'initial'.
const SP_CUST_ONLY = resolved({
  number: "SP-CUSTONLY",
  createdMs: SNAP - 50 * DAY,
  cust: [SNAP - 50 * DAY + HOUR],
});

// (F2) Resolution saved early (+2h), then a LATE customer reply 40d later. The
//      auto-close anchor must STAY at the resolution time (the late reply, and the
//      system reminder below, must not move it), and cadence must not breach.
const SP_LATE_CUST = resolved({
  number: "SP-LATECUST",
  createdMs: SNAP - 50 * DAY,
  infor: [SNAP - 50 * DAY + HOUR],
  cust: [SNAP - 10 * DAY],
  system: [SNAP - 20 * DAY], // a "30 business days" reminder note, post-resolution
  resolveMs: SNAP - 50 * DAY + 2 * HOUR,
  frtMs: HOUR,
});

// (F3) CSV-style divergence: the resolution marker is in additional_comments; a
//      later System reminder lives only in work_notes. Neither work_notes nor the
//      reminder may move the resolution anchor.
const SP_DIVERGENT = {
  number: "SP-DIVERGENT",
  state: "Resolved",
  status: "Solution Proposed",
  priority: "3 - Medium",
  sys_created_on: fmtTs(SNAP - 50 * DAY),
  additional_comments: journal([
    entry(SNAP - 50 * DAY + HOUR, INFOR),
    entry(SNAP - 50 * DAY + 2 * HOUR, INFOR),
    resEntry(SNAP - 48 * DAY),
  ]),
  work_notes: journal([entry(SNAP - 30 * DAY, SYS, REMINDER_BODY)]), // reminder, later, Work notes only
  first_response_time: String(HOUR),
};

// (F4) Backdated: the resolution marker entry is dated 5d BEFORE creation. The
//      auto-close anchor must clamp to creation (not start before the case existed).
const SP_BACKDATED = {
  number: "SP-BACKDATED",
  state: "Resolved",
  status: "Solution Proposed",
  priority: "3 - Medium",
  sys_created_on: fmtTs(SNAP - 40 * DAY),
  additional_comments: journal([resEntry(SNAP - 45 * DAY)]),
  work_notes: journal([resEntry(SNAP - 45 * DAY)]),
  first_response_time: String(HOUR),
};

const ALL_ROWS = [
  SP_HEALTHY, SP_INITIAL_MISS, SP_GAP, OPEN, SP_SOON, SP_PAST, SP_NULLJ,
  SP_CUST_ONLY, SP_LATE_CUST, SP_DIVERGENT, SP_BACKDATED,
];

/* =================== direct computeSlaSop (cadence, unchanged) =================== */

test("computeSlaSop: clock-stop — identical inputs breach when OPEN but not when Solution Proposed", () => {
  const base = {
    createdMs: 0, closedMs: null, frtMs: HOUR, updateTimes: [HOUR],
    cadenceMs: P3_CADENCE, initialMs: P3_INITIAL, snapshotMs: 40 * DAY,
  };
  const open = computeSlaSop({ ...base, isClosed: false, isSolutionProposed: false });
  assert.equal(open.breached, true, "open: 40d trailing gap to snapshot breaches");
  assert.equal(open.breachReason, "cadence");
  assert.equal(open.dueSop, HOUR + P3_CADENCE);

  const sp = computeSlaSop({ ...base, isClosed: false, isSolutionProposed: true });
  assert.equal(sp.breached, false, "resolved: cadence clock stops at last Infor update");
  assert.equal(sp.dueSop, null);
});

test("computeSlaSop: Solution Proposed still breaches a pre-resolution inter-update gap", () => {
  const out = computeSlaSop({
    createdMs: 0, closedMs: null, isClosed: false, isSolutionProposed: true,
    frtMs: HOUR, updateTimes: [HOUR, 11 * DAY], cadenceMs: P3_CADENCE, initialMs: P3_INITIAL, snapshotMs: 40 * DAY,
  });
  assert.equal(out.breached, true);
  assert.equal(out.breachReason, "cadence");
});

test("computeSlaSop: Solution Proposed never answered breaches 'initial' against the snapshot", () => {
  const out = computeSlaSop({
    createdMs: 0, closedMs: null, isClosed: false, isSolutionProposed: true,
    frtMs: null, updateTimes: [], cadenceMs: P3_CADENCE, initialMs: P3_INITIAL, snapshotMs: 40 * DAY,
  });
  assert.equal(out.breached, true);
  assert.equal(out.breachReason, "initial");
  assert.equal(out.dueSop, null);
});

/* ============== system-author exclusion (parseInforUpdates / parseInteractions) ============== */

test("parseInforUpdates excludes System auto-reminder authors (the '(Infor)' tag must not count them)", () => {
  const j = journal([
    entry(SNAP - 10 * DAY, INFOR),
    entry(SNAP - 5 * DAY, SYS, REMINDER_BODY), // "System  Automatic Reminders (Infor)"
    entry(SNAP - 3 * DAY, CUST),
  ]);
  const u = parseInforUpdates(j);
  assert.equal(u.count, 1, "only the genuine Infor entry counts");
  assert.equal(u.times.length, 1);
  assert.equal(u.lastTs.getTime(), SNAP - 10 * DAY, "the System reminder is NOT the last Infor update");
});

test("parseInteractions skips System notes entirely (neither analyst nor customer)", () => {
  const j = journal([
    entry(SNAP - 10 * DAY, INFOR),
    entry(SNAP - 9 * DAY, CUST),
    entry(SNAP - 5 * DAY, SYS, REMINDER_BODY),
  ]);
  const ix = parseInteractions(j);
  assert.equal(ix.analystTurns, 1);
  assert.equal(ix.customerTurns, 1);
  assert.equal(ix.totalTurns, 2, "System note excluded from the turn count");
});

/* =============================== parseResolutionTime ============================ */

test("parseResolutionTime: null/no-marker → null; latest marker wins; ignores reminders", () => {
  assert.equal(parseResolutionTime(null), null);
  assert.equal(parseResolutionTime(journal([entry(SNAP - 5 * DAY, INFOR)])), null, "no marker → null");
  // a system reminder note (no marker) does not count as a resolution
  assert.equal(parseResolutionTime(journal([entry(SNAP - 5 * DAY, SYS, REMINDER_BODY)])), null);
  // single marker
  assert.equal(parseResolutionTime(journal([resEntry(SNAP - 7 * DAY)])), SNAP - 7 * DAY);
  // re-resolved: latest marker wins
  assert.equal(
    parseResolutionTime(journal([resEntry(SNAP - 30 * DAY), entry(SNAP - 20 * DAY, CUST), resEntry(SNAP - 10 * DAY)])),
    SNAP - 10 * DAY,
  );
});

/* ====================== (1)-(3) cadence behavior ====================== */

test("(1) Resolved, healthy cadence, resolved 40d ago — no cadence breach, _slaDueSop null", () => {
  const row = enrichRow(SP_HEALTHY, SNAP);
  assert.equal(row._lifecycle, "solution_proposed");
  assert.equal(row._slaEligible, true);
  assert.equal(row._slaBreached, false);
  assert.notEqual(row._slaBreachReason, "cadence");
  assert.equal(row._slaDueSop, null);
  assert.equal(row._resolvedAt.getTime(), SNAP - 40 * DAY);
});

test("(2) Resolved that missed initial response still breaches (reason: initial)", () => {
  const row = enrichRow(SP_INITIAL_MISS, SNAP);
  assert.equal(row._slaBreached, true);
  assert.equal(row._slaBreachReason, "initial");
});

test("(3) Resolved with a >cadence gap before resolution still breaches (cadence)", () => {
  const row = enrichRow(SP_GAP, SNAP);
  assert.equal(row._slaBreached, true);
  assert.equal(row._slaBreachReason, "cadence");
});

test("(4) Regression: an open case still judges the trailing gap to snapshot and keeps _slaDueSop", () => {
  const row = enrichRow(OPEN, SNAP);
  assert.equal(row._lifecycle, "open");
  assert.equal(row._slaBreached, true);
  assert.equal(row._slaBreachReason, "cadence");
  assert.equal(row._slaDueSop.getTime(), SNAP - 40 * DAY + P3_CADENCE);
  assert.equal(row._autoCloseAt, null, "auto-close is Solution-Proposed-only");
  assert.equal(row._resolvedAt, null, "open case has no resolution time");
});

/* ====================== (5) parity ====================== */

test("(5) Parity: enrichRow and enrichForSql bake identical SLA fields + resolved_at_ms", () => {
  for (const r of ALL_ROWS) {
    const mem = enrichRow(r, SNAP);
    const sql = enrichForSql(r, SNAP);
    assert.equal(mem._slaEligible, sql.sla_eligible, `${r.number}: sla_eligible`);
    assert.equal(mem._slaBreached, sql.sla_breached, `${r.number}: sla_breached`);
    const memDue = mem._slaDueSop ? mem._slaDueSop.getTime() : null;
    const sqlDue = sql.sla_due_sop ? sql.sla_due_sop.getTime() : null;
    assert.equal(memDue, sqlDue, `${r.number}: sla_due_sop`);
    const memRes = mem._resolvedAt ? mem._resolvedAt.getTime() : null;
    const sqlRes = sql.resolved_at_ms == null ? null : Number(sql.resolved_at_ms);
    assert.equal(memRes, sqlRes, `${r.number}: resolved_at_ms`);
  }
});

test("(5b) Parity types: resolved_at_ms is BigInt|null in SQL, Date|null in memory", () => {
  assert.equal(typeof enrichForSql(SP_HEALTHY, SNAP).resolved_at_ms, "bigint");
  assert.equal(enrichForSql(SP_NULLJ, SNAP).resolved_at_ms, null);
  assert.equal(enrichRow(SP_NULLJ, SNAP)._resolvedAt, null);
});

/* ====================== (6) auto-close anchored to RESOLUTION time ====================== */

test("(6) Auto-close = resolution time + 90d; countdown sign vs snapshot is correct", () => {
  const healthy = enrichRow(SP_HEALTHY, SNAP); // resolved 40d ago → +50d out
  assert.equal(healthy._autoCloseAt.getTime(), (SNAP - 40 * DAY) + SOLUTION_PROPOSED_AUTOCLOSE_MS);
  assert.ok(healthy._autoCloseAt.getTime() > SNAP);

  const soon = enrichRow(SP_SOON, SNAP); // resolved 85d ago → +5d (≤7d)
  assert.equal(soon._autoCloseAt.getTime(), (SNAP - 85 * DAY) + SOLUTION_PROPOSED_AUTOCLOSE_MS);
  const soonDays = (soon._autoCloseAt.getTime() - SNAP) / DAY;
  assert.ok(soonDays > 0 && soonDays <= 7, `expected 0<days<=7, got ${soonDays}`);

  const past = enrichRow(SP_PAST, SNAP); // resolved 95d ago → already past
  assert.equal(past._autoCloseAt.getTime(), (SNAP - 95 * DAY) + SOLUTION_PROPOSED_AUTOCLOSE_MS);
  assert.ok(past._autoCloseAt.getTime() < SNAP);
});

/* ====================== (7) null-journal fallback ====================== */

test("(7) Null-journal resolved case: auto-close falls back to created, resolved_at_ms null, breaches initial", () => {
  const createdMs = SNAP - 10 * DAY;
  const row = enrichRow(SP_NULLJ, SNAP);
  assert.equal(row._resolvedAt, null, "no resolution marker → no resolved time");
  assert.equal(row._autoCloseAt.getTime(), createdMs + SOLUTION_PROPOSED_AUTOCLOSE_MS, "auto-close falls back to created");
  assert.equal(row._slaBreached, true);
  assert.equal(row._slaBreachReason, "initial");
  assert.equal(enrichForSql(SP_NULLJ, SNAP).resolved_at_ms, null);
});

/* ====================== (F1)-(F4) the user's caveat + adversarial regressions ====================== */

test("(F1) Resolved with only an early customer post (Infor never replied) still breaches 'initial'", () => {
  const row = enrichRow(SP_CUST_ONLY, SNAP);
  assert.equal(row._slaBreached, true);
  assert.equal(row._slaBreachReason, "initial");
  assert.equal(row._resolvedAt, null, "no resolution marker");
  // no marker + no Infor note → auto-close anchors to created
  assert.equal(row._autoCloseAt.getTime(), (SNAP - 50 * DAY) + SOLUTION_PROPOSED_AUTOCLOSE_MS);
});

test("(F2) Late customer reply AND a system reminder do NOT move the auto-close anchor off resolution", () => {
  const row = enrichRow(SP_LATE_CUST, SNAP);
  const resolvedMs = SNAP - 50 * DAY + 2 * HOUR;
  assert.equal(row._resolvedAt.getTime(), resolvedMs, "anchor = resolution time, not the SNAP-10d customer reply or the SNAP-20d reminder");
  assert.equal(row._autoCloseAt.getTime(), resolvedMs + SOLUTION_PROPOSED_AUTOCLOSE_MS);
  assert.equal(row._slaBreached, false, "Infor stopped correctly at resolution; customer talking late is not a breach");
  assert.notEqual(row._slaBreachReason, "cadence");
});

test("(F3) Resolution marker in additional_comments; a later Work-notes reminder must not move the anchor", () => {
  const row = enrichRow(SP_DIVERGENT, SNAP);
  assert.equal(row._resolvedAt.getTime(), SNAP - 48 * DAY, "anchor = marker (additional_comments), not the SNAP-30d work_notes reminder");
  assert.equal(row._slaBreached, false);
  assert.notEqual(row._slaBreachReason, "cadence");
  // parity even when the two journal fields diverge
  const sql = enrichForSql(SP_DIVERGENT, SNAP);
  assert.equal(sql.sla_breached, row._slaBreached);
  assert.equal(Number(sql.resolved_at_ms), row._resolvedAt.getTime());
});

test("(F4) Backdated resolution marker (before creation): auto-close clamps to created", () => {
  const createdMs = SNAP - 40 * DAY;
  const row = enrichRow(SP_BACKDATED, SNAP);
  assert.equal(row._resolvedAt.getTime(), SNAP - 45 * DAY, "raw resolved time is honestly before creation");
  assert.equal(row._autoCloseAt.getTime(), createdMs + SOLUTION_PROPOSED_AUTOCLOSE_MS, "clamped to created");
});
