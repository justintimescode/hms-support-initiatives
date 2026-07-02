// Unit tests for the DoD parent-account grouping (src/lib/dod.js): branch
// matching (including whitespace/case tolerance and exact-string, not-substring,
// discrimination), the raw-field extraction + CSV fallbacks, and the Accounts /
// Trends aggregations. Run with `node --test`.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DOD_PARENT_ACCOUNTS,
  parentAccountRaw,
  dodBranchOf,
  filterDodRows,
  dodParentAccountStats,
  dodTotal,
  weeklyDodParentVolume,
  cumulativeDodParentVolume,
} from "./dod.js";

// Fixed, local-time dates so week bucketing is deterministic regardless of the
// runner's timezone. 2026-01-05 / -12 / -19 are Mondays.
const cA = new Date(2026, 0, 7, 10); // week of Mon Jan 5
const cB = new Date(2026, 0, 14, 10); // week of Mon Jan 12
const cC = new Date(2026, 0, 21, 10); // week of Mon Jan 19
const SNAP = new Date(2026, 0, 25, 12).getTime(); // Sun Jan 25 → endWeek = Jan 19

const ROWS = [
  { parent_account: "Armed Forces - Air Force (HQ)", _created: cA, _lifecycle: "closed", _slaEligible: true, _slaBreached: false },
  { parent_account: "  Armed Forces - Air Force  (HQ) ", _created: cA, _lifecycle: "open", _slaEligible: true, _slaBreached: true }, // messy whitespace
  { parent_account: "armed forces - army (hq)", _created: cB, _lifecycle: "solution_proposed", _slaEligible: false }, // lowercase
  { parent_account: "Armed Forces - Navy (HQ)", _created: cB, _lifecycle: "open", _slaEligible: true, _slaBreached: false },
  { parent_account: "Armed Forces - Navy Lodges (HQ)", _created: cC, _lifecycle: "closed", _slaEligible: false },
  { parent_account: "Commercial - Hotels Inc", _created: cA, _lifecycle: "open" }, // non-DoD → excluded
  { _created: cA, _lifecycle: "open" }, // no parent account → excluded
];

test("dodBranchOf matches the four branches, tolerant of case/whitespace; null otherwise", () => {
  assert.equal(dodBranchOf({ parent_account: "Armed Forces - Air Force (HQ)" }).id, "airforce");
  assert.equal(dodBranchOf({ parent_account: "  Armed Forces - Air Force  (HQ) " }).id, "airforce");
  assert.equal(dodBranchOf({ parent_account: "armed forces - army (hq)" }).id, "army");
  assert.equal(dodBranchOf({ parent_account: "Armed Forces - Navy (HQ)" }).id, "navy");
  // exact-string, not substring: "Navy" must not swallow "Navy Lodges" and vice versa
  assert.equal(dodBranchOf({ parent_account: "Armed Forces - Navy Lodges (HQ)" }).id, "navylodges");
  assert.equal(dodBranchOf({ parent_account: "Commercial - Hotels Inc" }), null);
  assert.equal(dodBranchOf({ parent_account: "" }), null);
  assert.equal(dodBranchOf({}), null);
  assert.equal(dodBranchOf(null), null);
});

test("parentAccountRaw reads parent_account first, then CSV header fallbacks; trims; null when empty", () => {
  assert.equal(parentAccountRaw({ parent_account: "  X  " }), "X");
  assert.equal(parentAccountRaw({ "Parent Account": "Y" }), "Y");
  assert.equal(parentAccountRaw({ "Parent account": "Z" }), "Z");
  assert.equal(parentAccountRaw({ parent: "W" }), "W");
  assert.equal(parentAccountRaw({ parent_account: "   " }), null);
  assert.equal(parentAccountRaw({}), null);
  assert.equal(parentAccountRaw(null), null);
});

test("filterDodRows / dodTotal drop other + missing parent accounts", () => {
  assert.equal(filterDodRows(ROWS).length, 5);
  assert.equal(dodTotal(ROWS), 5);
  assert.equal(dodTotal([]), 0);
});

test("dodParentAccountStats: all four branches, in order, with lifecycle + SLA split", () => {
  const stats = dodParentAccountStats(ROWS);
  assert.deepEqual(stats.map((s) => s.id), DOD_PARENT_ACCOUNTS.map((b) => b.id));

  const af = stats.find((s) => s.id === "airforce");
  assert.equal(af.total, 2);
  assert.equal(af.closed, 1);
  assert.equal(af.open, 1);
  assert.equal(af.slaEligible, 2);
  assert.equal(af.slaMet, 1);
  assert.equal(af.slaPct, 50);

  const army = stats.find((s) => s.id === "army");
  assert.equal(army.total, 1);
  assert.equal(army.solutionProposed, 1);
  assert.equal(army.slaEligible, 0);
  assert.equal(army.slaPct, null); // no eligible cases → null, not 0

  const navy = stats.find((s) => s.id === "navy");
  assert.equal(navy.total, 1);
  assert.equal(navy.open, 1);
  assert.equal(navy.slaPct, 100);

  const lodges = stats.find((s) => s.id === "navylodges");
  assert.equal(lodges.total, 1);
  assert.equal(lodges.closed, 1);
});

test("dodParentAccountStats on empty input → four zeroed branches", () => {
  const stats = dodParentAccountStats([]);
  assert.equal(stats.length, 4);
  assert.ok(stats.every((s) => s.total === 0 && s.slaPct === null));
});

test("weeklyDodParentVolume: Monday-anchored weekly intake per branch, deterministic via snapshot", () => {
  const weekly = weeklyDodParentVolume(ROWS, SNAP);
  assert.equal(weekly.length, 3); // Jan 5, Jan 12, Jan 19
  assert.deepEqual(weekly.map((w) => w.week), weekly.map((w) => w.week).slice().sort((a, b) => a - b)); // sorted

  const [w1, w2, w3] = weekly;
  assert.equal(w1.airforce, 2);
  assert.equal(w1.total, 2);
  assert.equal(w2.army, 1);
  assert.equal(w2.navy, 1);
  assert.equal(w2.total, 2);
  assert.equal(w3.navylodges, 1);
  assert.equal(w3.total, 1);
});

test("weeklyDodParentVolume with no dated DoD cases → []", () => {
  assert.deepEqual(weeklyDodParentVolume([{ parent_account: "Commercial - X", _created: cA }], SNAP), []);
  assert.deepEqual(weeklyDodParentVolume([], SNAP), []);
});

test("cumulativeDodParentVolume: running totals per branch and overall", () => {
  const cum = cumulativeDodParentVolume(ROWS, SNAP);
  assert.equal(cum.length, 3);
  const [c1, c2, c3] = cum;
  assert.equal(c1.airforce, 2);
  assert.equal(c1.total, 2);
  assert.equal(c2.airforce, 2); // carried forward
  assert.equal(c2.army, 1);
  assert.equal(c2.navy, 1);
  assert.equal(c2.total, 4);
  assert.equal(c3.navylodges, 1);
  assert.equal(c3.total, 5);
});
