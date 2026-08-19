// Unit tests for the two Monthly Summary helpers in src/lib/stats.js:
// `monthlyScorecard` (calendar-month grid with created-month vs close-month
// attribution) and `openWorkHealth` (snapshot-anchored open-queue triage
// counts). Run with `node --test`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { monthlyScorecard, openWorkHealth } from "./stats.js";

// Fixed local-time dates so month bucketing is deterministic regardless of the
// runner's timezone.
const d = (y, m, day, h = 10) => new Date(y, m, day, h);
const HOUR = 36e5;
const DAY = 864e5;

/* A case created in Jan and closed in Feb: intake lands on Jan, throughput on
 * Feb. Everything else varies one dimension at a time. */
const ROWS = [
  { // Jan intake, Feb close, met cadence, FCR
    _created: d(2026, 0, 10), _closed: d(2026, 1, 3), _isClosed: true, _isOpen: false,
    _lifecycle: "closed", _resolvedMs: 24 * DAY, _frtMs: 2 * HOUR,
    _slaEligible: true, _slaBreached: false, _analystTurns: 1,
  },
  { // Jan intake, Jan close, missed initial response, not FCR
    _created: d(2026, 0, 20), _closed: d(2026, 0, 25), _isClosed: true, _isOpen: false,
    _lifecycle: "closed", _resolvedMs: 5 * DAY, _frtMs: 40 * HOUR,
    _slaEligible: true, _slaBreached: true, _slaBreachReason: "initial", _analystTurns: 4,
  },
  { // Feb intake, missed update cadence, still open
    _created: d(2026, 1, 5), _closed: null, _isClosed: false, _isOpen: true,
    _lifecycle: "open", _resolvedMs: null, _frtMs: 6 * HOUR,
    _slaEligible: true, _slaBreached: true, _slaBreachReason: "cadence", _analystTurns: 3,
  },
  { // Feb intake, not cadence-eligible, still open
    _created: d(2026, 1, 18), _closed: null, _isClosed: false, _isOpen: true,
    _lifecycle: "open", _resolvedMs: null, _frtMs: null, _slaEligible: false, _analystTurns: 2,
  },
];

test("monthlyScorecard attributes intake by created month and throughput by close month", () => {
  const sc = monthlyScorecard(ROWS);
  assert.equal(sc.length, 2, "Jan + Feb");
  const [jan, feb] = sc;

  assert.equal(jan.created, 2);
  assert.equal(jan.closed, 1, "only the Jan-closed case counts as Jan throughput");
  assert.equal(jan.net, 1);
  assert.equal(feb.created, 2);
  assert.equal(feb.closed, 1, "the Jan-created case closed in Feb lands on Feb");
  assert.equal(feb.net, 1);
});

test("monthlyScorecard splits SLA misses by reason and leaves empty rates null", () => {
  const [jan, feb] = monthlyScorecard(ROWS);

  assert.equal(jan.slaEligible, 2);
  assert.equal(jan.slaMet, 1);
  assert.equal(jan.slaRate, 50);
  assert.equal(jan.missedInitial, 1);
  assert.equal(jan.missedCadence, 0);

  assert.equal(feb.slaEligible, 1, "the non-eligible Feb case is excluded");
  assert.equal(feb.slaMet, 0);
  assert.equal(feb.slaRate, 0);
  assert.equal(feb.missedInitial, 0);
  assert.equal(feb.missedCadence, 1);

  // Percentiles: Jan has one closed case (5d), Feb one (24d).
  assert.equal(jan.resP50, 5 * DAY);
  assert.equal(feb.resP50, 24 * DAY);
  // FRT is a created-month measure: Jan saw 2h and 40h, Feb 6h (the null skipped).
  assert.equal(jan.frtP50, 21 * HOUR);
  assert.equal(feb.frtP50, 6 * HOUR);
  // FCR by close month: Jan's close had 4 analyst turns, Feb's had 1.
  assert.equal(jan.fcrRate, 0);
  assert.equal(feb.fcrRate, 100);
});

test("monthlyScorecard yields a gap, not a zero, for a month with no observations", () => {
  const sparse = [
    { ...ROWS[1] },
    { // Mar intake, still open — nothing closes in Feb or Mar
      _created: d(2026, 2, 4), _closed: null, _isClosed: false, _isOpen: true,
      _lifecycle: "open", _resolvedMs: null, _frtMs: null, _slaEligible: false,
    },
  ];
  const sc = monthlyScorecard(sparse);
  assert.deepEqual(sc.map((m) => m.month), [
    d(2026, 0, 1, 0).getTime(), d(2026, 1, 1, 0).getTime(), d(2026, 2, 1, 0).getTime(),
  ], "the grid is continuous across the empty Feb");
  const feb = sc[1];
  assert.equal(feb.created, 0);
  assert.equal(feb.closed, 0);
  assert.equal(feb.slaRate, null, "no eligible cases -> null, never 0%");
  assert.equal(feb.resP50, null);
  assert.equal(feb.fcrRate, null);
});

test("monthlyScorecard drops a leading empty month but keeps interior gaps", () => {
  // One stray Jan case, a silent Feb, then real Mar/Apr activity. Slicing to the
  // last 3 months would otherwise open the table on an all-zero Feb row.
  const straggler = [
    { _created: d(2026, 0, 5), _closed: d(2026, 0, 6), _isClosed: true, _isOpen: false,
      _lifecycle: "closed", _resolvedMs: DAY, _frtMs: HOUR, _slaEligible: false, _analystTurns: 1 },
    { _created: d(2026, 2, 9), _closed: null, _isClosed: false, _isOpen: true,
      _lifecycle: "open", _resolvedMs: null, _frtMs: null, _slaEligible: false },
    { _created: d(2026, 3, 9), _closed: null, _isClosed: false, _isOpen: true,
      _lifecycle: "open", _resolvedMs: null, _frtMs: null, _slaEligible: false },
  ];
  const sliced = monthlyScorecard(straggler, { months: 3 });
  assert.deepEqual(sliced.map((m) => m.month), [
    d(2026, 2, 1, 0).getTime(), d(2026, 3, 1, 0).getTime(),
  ], "the empty Feb that led the 3-month slice is gone");

  // The same silent Feb sitting *between* two active months is preserved.
  const full = monthlyScorecard(straggler);
  assert.equal(full.length, 4);
  assert.equal(full[1].month, d(2026, 1, 1, 0).getTime());
  assert.equal(full[1].created, 0);
});

test("monthlyScorecard keeps only the most recent N months when asked", () => {
  const sc = monthlyScorecard(ROWS, { months: 1 });
  assert.equal(sc.length, 1);
  assert.equal(sc[0].month, d(2026, 1, 1, 0).getTime(), "newest month survives");
  assert.equal(monthlyScorecard([]).length, 0, "no dated rows -> empty grid");
});

/* ------------------------------ openWorkHealth ------------------------------ */

const SNAP = d(2026, 1, 20, 12).getTime();
const QUEUE = [
  { // open, breached (due in the past), stuck (created 60d before the snapshot)
    _isOpen: true, _lifecycle: "open", _created: new Date(SNAP - 60 * DAY),
    _slaDueSop: new Date(SNAP - 2 * DAY), _jiraTickets: [], status: "Work in progress",
  },
  { // open, due inside 24h, Jira-blocked
    _isOpen: true, _lifecycle: "open", _created: new Date(SNAP - 3 * DAY),
    _slaDueSop: new Date(SNAP + 6 * HOUR), _jiraTickets: ["HMS-1"], status: "Work in progress",
  },
  { // open, comfortable, no Jira
    _isOpen: true, _lifecycle: "open", _created: new Date(SNAP - 1 * DAY),
    _slaDueSop: new Date(SNAP + 5 * DAY), _jiraTickets: [], status: "Work in progress",
  },
  { // open, no cadence at all
    _isOpen: true, _lifecycle: "open", _created: new Date(SNAP - 10 * DAY),
    _slaDueSop: null, _jiraTickets: [], status: "Work in progress",
  },
  { // solution proposed — counted separately, never as open work
    _isOpen: false, _lifecycle: "solution_proposed", _created: new Date(SNAP - 40 * DAY),
    _slaDueSop: new Date(SNAP - 20 * DAY), _jiraTickets: ["HMS-2"], status: "Resolved",
  },
  { // closed — invisible to every tally
    _isOpen: false, _isClosed: true, _lifecycle: "closed", _created: new Date(SNAP - 90 * DAY),
    _slaDueSop: null, _jiraTickets: [], status: "Closed",
  },
];

test("openWorkHealth counts the open queue at the snapshot, not the wall clock", () => {
  const h = openWorkHealth(QUEUE, SNAP);
  assert.equal(h.open, 4);
  assert.equal(h.solutionProposed, 1, "tracked alongside, not folded into open");
  assert.equal(h.breached, 1);
  assert.equal(h.due24, 1);
  assert.equal(h.noSla, 1);
  assert.equal(h.jiraBlocked, 1, "the Solution-Proposed Jira case is not open work");
  assert.equal(h.stuck, 1, "only the 60d case clears the default 30d threshold");
  assert.equal(h.oldestAgeMs, 60 * DAY);
  assert.equal(h.avgAgeMs, ((60 + 3 + 1 + 10) / 4) * DAY);
});

test("openWorkHealth honors a custom stuck threshold and an empty queue", () => {
  assert.equal(openWorkHealth(QUEUE, SNAP, { stuckDays: 2 }).stuck, 3);
  assert.equal(openWorkHealth(QUEUE, SNAP, { stuckDays: 2 }).stuckDays, 2);
  const empty = openWorkHealth([], SNAP);
  assert.equal(empty.open, 0);
  assert.equal(empty.avgAgeMs, null);
  assert.equal(empty.oldestAgeMs, null);
});
