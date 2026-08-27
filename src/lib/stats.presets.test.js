// Unit tests for the date-range preset helpers in src/lib/stats.js.
// The preset set must cover <=7d, >7d, >30d, >60d, and >90d spans
// (see PRESETS in constants.js). Run with `node --test`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { presetRange, matchPreset } from "./stats.js";

const DAY = 864e5;
const REF = new Date(2026, 7, 24, 15, 0); // fixed "today" so window math is deterministic
const startOfRef = new Date(2026, 7, 24).getTime();
const endOfRefDay = startOfRef + DAY - 1;

test("7d/30d/60d/90d are rolling windows anchored on today, each one tier longer than the last", () => {
  const r7 = presetRange("7d", REF);
  const r30 = presetRange("30d", REF);
  const r60 = presetRange("60d", REF);
  const r90 = presetRange("90d", REF);

  for (const r of [r7, r30, r60, r90]) assert.equal(r.to, endOfRefDay);

  assert.equal(r7.from, startOfRef - 6 * DAY);
  assert.equal(r30.from, startOfRef - 29 * DAY);
  assert.equal(r60.from, startOfRef - 59 * DAY);
  assert.equal(r90.from, startOfRef - 89 * DAY);

  // Span length in whole days (inclusive of today) satisfies each breakpoint.
  assert.equal(Math.round((r7.to - r7.from + 1) / DAY), 7);
  assert.equal(Math.round((r30.to - r30.from + 1) / DAY), 30);
  assert.equal(Math.round((r60.to - r60.from + 1) / DAY), 60);
  assert.equal(Math.round((r90.to - r90.from + 1) / DAY), 90);
});

test("older90 covers everything before the 90d cutoff with no lower bound, adjacent to Last 90 days", () => {
  const r90 = presetRange("90d", REF);
  const rOlder = presetRange("older90", REF);

  assert.equal(rOlder.from, null);
  assert.equal(rOlder.to, r90.from - 1);
});

test("all-time has no bounds", () => {
  const r = presetRange("all", REF);
  assert.equal(r.from, null);
  assert.equal(r.to, null);
});

test("matchPreset round-trips every non-custom preset key", () => {
  // matchPreset compares against presetRange(key) using the real "now", so
  // round-trip using the same (unspecified) refDate on both sides.
  for (const key of ["7d", "30d", "60d", "90d", "older90", "ytd"]) {
    const r = presetRange(key);
    assert.equal(matchPreset(r.from, r.to), key, `expected ${key} to round-trip`);
  }
});

test("matchPreset falls back to custom for an arbitrary historical range", () => {
  const from = new Date(2020, 0, 1).getTime();
  const to = new Date(2020, 11, 31).getTime();
  assert.equal(matchPreset(from, to), "custom");
});
