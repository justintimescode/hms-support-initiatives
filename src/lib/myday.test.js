// My Day selection layer — the analyst view's SLA buckets, the manager view's
// per-report rollup, and the escalation watch that feeds both.
//
// Hostile treatment goes to the three things that would quietly produce a
// confident-looking wrong number on a manager's screen:
//
//   1. `flagged` counts DISTINCT cases. One case that is overdue AND breached
//      AND stuck AND escalated must count ONCE, or the column silently becomes
//      a weighted score nobody can explain.
//   2. Solution Proposed cases are live work for the escalation watch (reopen
//      risk / pushback) but must never be counted as truly-open work.
//   3. The clock is injected. Nothing here may read the wall clock, so the same
//      fixture must render identically forever.
//
// Fixed NOW anchor throughout. Runs under `node --test`.
import test from "node:test";
import assert from "node:assert/strict";

import {
  escalationWatch, teamDay, slaPressure, STUCK_DAYS, UNASSIGNED,
  RISK_HIGH, RISK_ELEVATED,
} from "./myday.js";

const NOW = Date.UTC(2026, 2, 15, 12, 0, 0); // 2026-03-15T12:00:00Z
const DAY = 864e5;
const HOUR = 36e5;
const ago = (days) => new Date(NOW - days * DAY);
const inHours = (h) => new Date(NOW + h * HOUR);

/** A row shaped like an enriched case, with the baked v11 sentiment columns
 *  present so summarizeSentiment reads them instead of live-grading a journal. */
function row(number, over = {}) {
  const {
    assignee = "Ann", lifecycle = "open", risk = null, escalated = false,
    confirm = null, unanswered = 0, waitDays = null, scoreable = true,
    created = ago(3), slaDue = null, jira = [],
  } = over;
  return {
    number,
    assigned_to: assignee,
    account: "Acme",
    priority: "3 - Medium",
    state: lifecycle === "open" ? "Work in Progress" : lifecycle === "closed" ? "Closed" : "Resolved",
    _lifecycle: lifecycle,
    _isOpen: lifecycle === "open",
    _isClosed: lifecycle === "closed",
    _created: created,
    _slaDueSop: slaDue,
    _jiraActiveTickets: jira,
    sentiment_scoreable: scoreable,
    sentiment_valence: -2,
    sentiment_label: "Negative",
    sentiment_risk: risk,
    sentiment_risk_factors: "3 unanswered messages",
    sentiment_escalated: escalated,
    sentiment_esc_reason: escalated ? "customer asked for a manager" : null,
    sentiment_confirm: confirm,
    sentiment_chases: 0,
    sentiment_unanswered: unanswered,
    sentiment_wait_days: waitDays,
    sentiment_last_quote: "this is still broken",
  };
}

/* ---------------------------- escalationWatch ---------------------------- */

test("escalationWatch: already-escalated cases come first, then risk desc", () => {
  const rows = [
    row("C1", { risk: 44 }),
    row("C2", { risk: 91 }),
    row("C3", { risk: 12, escalated: true }), // low risk but it already happened
    row("C4", { risk: 31 }),
  ];
  const { watch, counts } = escalationWatch(rows, {});
  assert.deepEqual(watch.map((g) => g.number), ["C3", "C2", "C1", "C4"]);
  assert.equal(counts.escalated, 1);
  assert.equal(counts.high, 1); // C2 only — C3 is escalated, not "high risk"
  assert.equal(counts.elevated, 2); // C1, C4
  assert.equal(counts.total, 4);
});

test("escalationWatch: calm cases are excluded, and the band is the documented one", () => {
  const rows = [
    row("CALM", { risk: RISK_ELEVATED - 1 }),
    row("EDGE", { risk: RISK_ELEVATED }),
    row("HIGH", { risk: RISK_HIGH }),
    row("NORISK", { risk: null }),
  ];
  const { watch } = escalationWatch(rows, {});
  assert.deepEqual(watch.map((g) => g.number), ["HIGH", "EDGE"]);
});

test("escalationWatch: minRisk is honored", () => {
  const rows = [row("A", { risk: 35 }), row("B", { risk: 70 })];
  assert.deepEqual(
    escalationWatch(rows, { minRisk: RISK_HIGH }).watch.map((g) => g.number),
    ["B"],
  );
});

test("escalationWatch: Solution Proposed pushback is watched even at low risk", () => {
  const rows = [
    row("SP1", { lifecycle: "solution_proposed", risk: 5, confirm: "pushback" }),
    row("SP2", { lifecycle: "solution_proposed", risk: 5, confirm: "confirmed" }),
  ];
  const { watch } = escalationWatch(rows, {});
  assert.deepEqual(watch.map((g) => g.number), ["SP1"]);
});

test("escalationWatch: a quiet Solution Proposed case is NOT admitted by its risk", () => {
  // For an SP case `risk` is REOPEN risk, which a silent aging proposal earns
  // without the customer saying anything. Admitting those floods the list.
  const rows = [
    row("SP_SILENT", { lifecycle: "solution_proposed", risk: 88, confirm: "silent" }),
    row("SP_CONFIRMED", { lifecycle: "solution_proposed", risk: 88, confirm: "confirmed" }),
    row("SP_ESCALATED", { lifecycle: "solution_proposed", risk: 4, escalated: true }),
    row("OPEN_HIGH", { risk: 55 }),
  ];
  const { watch } = escalationWatch(rows, {});
  assert.deepEqual(watch.map((g) => g.number), ["SP_ESCALATED", "OPEN_HIGH"]);
});

test("escalationWatch: the bands partition the list exactly", () => {
  const rows = [
    row("E", { escalated: true, risk: 20 }),
    row("H", { risk: 70 }),
    row("V", { risk: 35 }),
    row("P", { lifecycle: "solution_proposed", risk: 3, confirm: "pushback" }),
  ];
  const { counts } = escalationWatch(rows, {});
  assert.deepEqual(
    [counts.escalated, counts.high, counts.elevated, counts.pushback],
    [1, 1, 1, 1],
  );
  assert.equal(counts.escalated + counts.high + counts.elevated + counts.pushback, counts.total);
});

test("escalationWatch: closed cases never appear, however bad they ended", () => {
  const rows = [
    row("CL", { lifecycle: "closed", risk: 99, escalated: true }),
    row("OP", { risk: 60 }),
  ];
  const { watch } = escalationWatch(rows, {});
  assert.deepEqual(watch.map((g) => g.number), ["OP"]);
});

test("escalationWatch: unanswered messages break a risk tie, then wait days", () => {
  const rows = [
    row("Q", { risk: 40, unanswered: 0, waitDays: 9 }),
    row("R", { risk: 40, unanswered: 2, waitDays: 1 }),
    row("S", { risk: 40, unanswered: 0, waitDays: 12 }),
  ];
  const { watch } = escalationWatch(rows, {});
  assert.deepEqual(watch.map((g) => g.number), ["R", "S", "Q"]);
});

test("escalationWatch: an empty / null input is not an error", () => {
  for (const input of [null, undefined, []]) {
    const { watch, counts } = escalationWatch(input, {});
    assert.deepEqual(watch, []);
    assert.equal(counts.total, 0);
  }
});

/* ------------------------------ slaPressure ------------------------------ */

test("slaPressure: buckets by the SOP due date and orders due-soonest first", () => {
  const rows = [
    row("W", { slaDue: new Date(NOW + 4 * DAY) }),
    row("B2", { slaDue: new Date(NOW - 2 * DAY) }),
    row("D", { slaDue: inHours(5) }),
    row("B1", { slaDue: new Date(NOW - 9 * DAY) }),
    row("NONE", { slaDue: null }),
    row("FAR", { slaDue: new Date(NOW + 40 * DAY) }),
  ];
  const p = slaPressure(rows, NOW);
  assert.deepEqual(p.breached.map((r) => r.number), ["B1", "B2"]);
  assert.deepEqual(p.due24.map((r) => r.number), ["D"]);
  assert.deepEqual(p.dueWeek.map((r) => r.number), ["W"]);
  // atRisk is breached → due24 → dueWeek; no-SLA and comfortable are excluded.
  assert.deepEqual(p.atRisk.map((r) => r.number), ["B1", "B2", "D", "W"]);
});

/* -------------------------------- teamDay -------------------------------- */

test("teamDay: one row per analyst holding live work, worst first", () => {
  const rows = [
    row("A1", { assignee: "Ann", risk: 80 }),
    row("A2", { assignee: "Ann" }),
    row("B1", { assignee: "Bob" }),
    row("B2", { assignee: "Bob" }),
    row("B3", { assignee: "Bob" }),
  ];
  const { members, totals, memberCount } = teamDay(rows, null, { now: NOW });
  assert.equal(memberCount, 2);
  // Ann has one flagged case; Bob has none, despite more open work.
  assert.deepEqual(members.map((m) => m.name), ["Ann", "Bob"]);
  assert.equal(members[0].flagged, 1);
  assert.equal(members[0].highRisk, 1);
  assert.equal(members[1].flagged, 0);
  assert.equal(totals.open, 5);
});

test("teamDay: a case tripping four signals is flagged exactly once", () => {
  const rows = [
    row("MULTI", {
      assignee: "Ann",
      risk: 95,
      escalated: true,
      created: ago(STUCK_DAYS + 10),
      slaDue: new Date(NOW - DAY),
    }),
  ];
  const queue = { overdue: [{ number: "MULTI", assignedTo: "Ann" }], dueSoon: [] };
  const [ann] = teamDay(rows, queue, { now: NOW }).members;
  assert.equal(ann.escalated, 1);
  assert.equal(ann.slaBreached, 1);
  assert.equal(ann.stuck, 1);
  assert.equal(ann.overdue, 1);
  assert.equal(ann.flagged, 1, "one case, one flag");
});

test("teamDay: distinct flagged cases add up", () => {
  const rows = [
    row("F1", { assignee: "Ann", slaDue: new Date(NOW - DAY) }),
    row("F2", { assignee: "Ann", created: ago(STUCK_DAYS + 1) }),
    row("F3", { assignee: "Ann", risk: 60 }),
    row("OK", { assignee: "Ann" }),
  ];
  const [ann] = teamDay(rows, null, { now: NOW }).members;
  assert.equal(ann.open, 4);
  assert.equal(ann.flagged, 3);
});

test("teamDay: dueSoon is tracked but does not flag a case", () => {
  const rows = [row("S1", { assignee: "Ann" })];
  const queue = { overdue: [], dueSoon: [{ number: "S1", assignedTo: "Ann" }] };
  const [ann] = teamDay(rows, queue, { now: NOW }).members;
  assert.equal(ann.dueSoon, 1);
  assert.equal(ann.flagged, 0, "coming due is not yet a problem");
});

test("teamDay: Solution Proposed work is watched but is not open work", () => {
  const rows = [
    row("SP", { assignee: "Cat", lifecycle: "solution_proposed", risk: 8, confirm: "pushback" }),
  ];
  const { members, totals } = teamDay(rows, null, { now: NOW });
  assert.equal(members.length, 1, "an SP-only analyst still gets a row");
  assert.equal(members[0].open, 0);
  assert.equal(members[0].flagged, 1);
  // On the list for what the customer said, not for the risk number.
  assert.equal(members[0].pushback, 1);
  assert.equal(members[0].elevatedRisk, 0);
  assert.equal(members[0].escalationWatch, 1);
  assert.equal(totals.open, 0);
});

test("teamDay: a silent Solution Proposed backlog does not inflate the roster", () => {
  const rows = [
    ...Array.from({ length: 20 }, (_, i) =>
      row(`SP${i}`, { assignee: "Ann", lifecycle: "solution_proposed", risk: 50, confirm: "silent" })),
    row("OPEN1", { assignee: "Ann", risk: 60 }),
  ];
  const [ann] = teamDay(rows, null, { now: NOW }).members;
  assert.equal(ann.escalationWatch, 1, "only the genuinely at-risk open case");
  assert.equal(ann.flagged, 1);
});

test("teamDay: closed cases contribute nothing", () => {
  const rows = [
    row("C1", { assignee: "Ann", lifecycle: "closed", risk: 99, escalated: true, created: ago(400) }),
  ];
  const { members, totals } = teamDay(rows, null, { now: NOW });
  assert.deepEqual(members, []);
  assert.equal(totals.flagged, 0);
});

test("teamDay: an unowned case rolls up under the Unassigned sentinel", () => {
  const rows = [row("U1", { assignee: null }), row("U2", { assignee: "" })];
  const { members } = teamDay(rows, null, { now: NOW });
  assert.deepEqual(members.map((m) => m.name), [UNASSIGNED]);
  assert.equal(members[0].open, 2);
});

test("teamDay: derived columns are sums of their parts", () => {
  const rows = [
    row("X1", { assignee: "Ann", slaDue: new Date(NOW - DAY) }),      // breached
    row("X2", { assignee: "Ann", slaDue: inHours(3) }),               // due24
    row("X3", { assignee: "Ann", slaDue: new Date(NOW + 3 * DAY) }),  // dueWeek
    row("X4", { assignee: "Ann", risk: 90 }),                         // high
    row("X5", { assignee: "Ann", risk: 40 }),                         // elevated
    row("X6", { assignee: "Ann", escalated: true, risk: 10 }),        // escalated
    row("X7", { assignee: "Ann", jira: ["HMS-1"] }),                  // blocked
  ];
  const [ann] = teamDay(rows, null, { now: NOW }).members;
  assert.equal(ann.slaAtRisk, 3);
  assert.equal(ann.escalationWatch, 3);
  assert.equal(ann.jiraBlocked, 1);
  // X3 (dueWeek) and X7 (jira-blocked) are informational, not flags.
  assert.equal(ann.flagged, 5);
});

test("teamDay: the stuck threshold is inclusive and configurable", () => {
  const rows = [
    row("EDGE", { assignee: "Ann", created: ago(STUCK_DAYS) }),
    row("YOUNG", { assignee: "Ann", created: ago(STUCK_DAYS - 1) }),
  ];
  assert.equal(teamDay(rows, null, { now: NOW }).members[0].stuck, 1);
  assert.equal(teamDay(rows, null, { now: NOW, stuckDays: 7 }).members[0].stuck, 2);
});

test("teamDay: a null queue means pending, not zero overdue everywhere else", () => {
  const rows = [row("A", { assignee: "Ann", risk: 60 })];
  const { totals } = teamDay(rows, null, { now: NOW });
  assert.equal(totals.overdue, 0);
  assert.equal(totals.highRisk, 1, "the rest of the rollup still computes");
});

test("teamDay: an overdue case for an analyst with no in-memory rows still lands", () => {
  const queue = { overdue: [{ number: "Z9", assignedTo: "Zoe" }], dueSoon: [] };
  const { members } = teamDay([], queue, { now: NOW });
  assert.deepEqual(members.map((m) => m.name), ["Zoe"]);
  assert.equal(members[0].overdue, 1);
  assert.equal(members[0].open, 0);
});

test("teamDay: equally-flagged analysts are ordered by open volume then name", () => {
  const rows = [
    row("P1", { assignee: "Zed" }),
    row("P2", { assignee: "Zed" }),
    row("P3", { assignee: "Ann" }),
    row("P4", { assignee: "Moe" }),
    row("P5", { assignee: "Moe" }),
  ];
  const { members } = teamDay(rows, null, { now: NOW });
  assert.deepEqual(members.map((m) => m.name), ["Moe", "Zed", "Ann"]);
});

test("teamDay: no rows at all is an empty team, not a crash", () => {
  const { members, totals, memberCount } = teamDay(null, null, { now: NOW });
  assert.deepEqual(members, []);
  assert.equal(memberCount, 0);
  assert.equal(totals.flagged, 0);
});
