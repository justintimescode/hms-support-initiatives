// Unit tests for the time-series viewport helpers (src/lib/time-axis.js):
// dead-edge trimming, bucket-aware window slicing, span-adaptive tick
// formatting/density, and the timeWindow() composition. Run with `node --test`.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  trimEmptyEdges,
  sliceWindow,
  tickFormatterForSpan,
  pickTicks,
  timeWindow,
  BUCKET_MS,
  SCOPE_ALL,
  SCOPE_RANGE,
} from "./time-axis.js";

const DAY = 864e5;
// Fixed local-time dates so bucketing is deterministic regardless of TZ.
const d = (y, m, day) => new Date(y, m - 1, day).getTime();

/** Daily series of `counts`, starting at 2026-02-01. */
const daily = (counts) =>
  counts.map((closed, i) => ({ date: d(2026, 2, 1) + i * DAY, closed }));

/* ============================ trimEmptyEdges ============================ */

test("trimEmptyEdges drops leading and trailing zero buckets", () => {
  const out = trimEmptyEdges(daily([0, 0, 3, 0, 5, 0, 0]), ["closed"]);
  assert.deepEqual(out.map((p) => p.closed), [3, 0, 5]);
});

test("trimEmptyEdges keeps interior gaps — a mid-series zero is information", () => {
  const out = trimEmptyEdges(daily([1, 0, 0, 0, 2]), ["closed"]);
  assert.deepEqual(out.map((p) => p.closed), [1, 0, 0, 0, 2]);
});

test("trimEmptyEdges treats null and undefined as empty", () => {
  const data = [
    { date: 1, v: null },
    { date: 2, v: undefined },
    { date: 3, v: 7 },
    { date: 4, v: null },
  ];
  assert.deepEqual(trimEmptyEdges(data, ["v"]).map((p) => p.date), [3]);
});

test("trimEmptyEdges needs ALL value keys empty to drop a point", () => {
  const data = [
    { date: 1, a: 0, b: 0 },
    { date: 2, a: 0, b: 4 }, // b carries signal — keep
    { date: 3, a: 1, b: 0 },
  ];
  assert.deepEqual(trimEmptyEdges(data, ["a", "b"]).map((p) => p.date), [2, 3]);
});

test("trimEmptyEdges returns an all-empty series untouched rather than nothing", () => {
  const data = daily([0, 0, 0]);
  assert.equal(trimEmptyEdges(data, ["closed"]), data); // same reference
});

test("trimEmptyEdges is referentially stable when there is nothing to trim", () => {
  const data = daily([1, 2, 3]);
  assert.equal(trimEmptyEdges(data, ["closed"]), data);
});

test("trimEmptyEdges tolerates empty input and missing keys", () => {
  assert.deepEqual(trimEmptyEdges([], ["v"]), []);
  assert.deepEqual(trimEmptyEdges(null, ["v"]), []);
  const data = daily([1, 2]);
  assert.equal(trimEmptyEdges(data, []), data);
});

/* ============================ sliceWindow ============================ */

test("sliceWindow keeps only points inside the range", () => {
  const data = daily([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const out = sliceWindow(data, "date", d(2026, 2, 4), d(2026, 2, 7) + DAY - 1, 0);
  assert.deepEqual(out.map((p) => p.closed), [4, 5, 6, 7]);
});

test("sliceWindow keeps a bucket that STRADDLES the range start", () => {
  // Weekly buckets keyed by Monday. 2026-02-02 is a Monday; a filter starting
  // Wed 2026-02-04 still needs that week — it holds cases inside the range.
  const weeks = [0, 1, 2].map((i) => ({ week: d(2026, 2, 2) + i * 7 * DAY, created: 5 }));
  const out = sliceWindow(weeks, "week", d(2026, 2, 4), d(2026, 2, 20), BUCKET_MS.week);
  assert.equal(out.length, 3);
  assert.equal(out[0].week, d(2026, 2, 2));
});

test("sliceWindow with bucketMs=0 excludes a point before the range start", () => {
  const data = daily([1, 2, 3]);
  const out = sliceWindow(data, "date", d(2026, 2, 2), d(2026, 2, 3), 0);
  assert.deepEqual(out.map((p) => p.closed), [2, 3]);
});

test("sliceWindow falls back to the full series when the window is too thin", () => {
  const data = daily([1, 2, 3, 4, 5]);
  // A range matching a single point would render as one lonely dot.
  const out = sliceWindow(data, "date", d(2026, 2, 3), d(2026, 2, 3), 0);
  assert.equal(out, data);
});

test("sliceWindow honours an open-ended range", () => {
  const data = daily([1, 2, 3, 4, 5]);
  assert.deepEqual(
    sliceWindow(data, "date", d(2026, 2, 3), null, 0).map((p) => p.closed),
    [3, 4, 5],
  );
  assert.deepEqual(
    sliceWindow(data, "date", null, d(2026, 2, 2), 0).map((p) => p.closed),
    [1, 2],
  );
});

test("sliceWindow returns input untouched when no bounds are given", () => {
  const data = daily([1, 2, 3]);
  assert.equal(sliceWindow(data, "date", null, null, 0), data);
});

test("sliceWindow skips points with a null timestamp", () => {
  const data = [{ date: null, v: 1 }, { date: d(2026, 2, 2), v: 2 }, { date: d(2026, 2, 3), v: 3 }];
  const out = sliceWindow(data, "date", d(2026, 2, 1), d(2026, 2, 4), 0);
  assert.deepEqual(out.map((p) => p.v), [2, 3]);
});

/* ======================== tick formatting / density ======================== */

test("tickFormatterForSpan spells out the DAY on a short span", () => {
  const f = tickFormatterForSpan(14 * DAY);
  assert.equal(f(d(2026, 7, 7)), "Jul 7");
});

test("tickFormatterForSpan switches to month+year on a multi-month span", () => {
  const f = tickFormatterForSpan(400 * DAY);
  assert.equal(f(d(2026, 7, 7)), "Jul '26");
});

test("tickFormatterForSpan collapses to the year on a multi-year span", () => {
  const f = tickFormatterForSpan(2000 * DAY);
  assert.equal(f(d(2026, 7, 7)), "2026");
});

test("tickFormatterForSpan yields DISTINCT labels across a zoomed daily axis", () => {
  // The regression that zooming exposed: the old fmtAxisDate ("Jul '26") gave
  // every tick in a two-week window the same string.
  const f = tickFormatterForSpan(14 * DAY);
  const labels = new Set(Array.from({ length: 14 }, (_, i) => f(d(2026, 7, 1) + i * DAY)));
  assert.equal(labels.size, 14);
});

test("pickTicks labels every point when the series already fits", () => {
  const data = daily([1, 2, 3, 4, 5]);
  assert.deepEqual(pickTicks(data, "date", 8), data.map((p) => p.date));
});

test("pickTicks thins a long series to the target count", () => {
  const data = daily(Array.from({ length: 80 }, () => 1));
  assert.equal(pickTicks(data, "date", 8).length, 8);
});

test("pickTicks always includes the first and last point", () => {
  const data = daily(Array.from({ length: 45 }, () => 1));
  const ticks = pickTicks(data, "date", 8);
  assert.equal(ticks[0], data[0].date);
  assert.equal(ticks[ticks.length - 1], data[44].date);
});

test("pickTicks lands only on real bucket timestamps", () => {
  const data = daily(Array.from({ length: 30 }, () => 1));
  const valid = new Set(data.map((p) => p.date));
  for (const t of pickTicks(data, "date", 8)) assert.ok(valid.has(t), `${t} is not a bucket`);
});

test("pickTicks spaces ticks evenly", () => {
  const data = daily(Array.from({ length: 43 }, () => 1));
  const ticks = pickTicks(data, "date", 7);
  const gaps = ticks.slice(1).map((t, i) => t - ticks[i]);
  // Rounding can shift a gap by one day, no more.
  assert.ok(Math.max(...gaps) - Math.min(...gaps) <= DAY, `uneven gaps: ${gaps}`);
});

test("pickTicks dedupes when rounding selects an index twice", () => {
  const data = daily([1, 2, 3]);
  const ticks = pickTicks(data, "date", 8);
  assert.equal(new Set(ticks).size, ticks.length);
});

test("pickTicks handles empty input", () => {
  assert.deepEqual(pickTicks([], "date", 8), []);
  assert.deepEqual(pickTicks(null, "date", 8), []);
});

test("timeWindow emits multiple ticks — a numeric axis ignores `interval`", () => {
  // Regression: every chart rendered a single left-edge tick because `interval`
  // does nothing on type="number". timeWindow must hand over explicit ticks.
  const win = timeWindow({
    data: daily(Array.from({ length: 45 }, () => 3)),
    key: "date", valueKeys: ["closed"], range: null,
    scope: SCOPE_RANGE, bucketMs: BUCKET_MS.day,
  });
  assert.ok(win.ticks.length >= 6, `expected several ticks, got ${win.ticks.length}`);
  // And every tick must sit inside the rendered domain.
  for (const t of win.ticks) {
    assert.ok(t >= win.domain[0] && t <= win.domain[1], `tick ${t} outside domain`);
  }
});

/* ============================ timeWindow ============================ */

test("timeWindow zooms to the range and reports what it hid", () => {
  const data = daily(Array.from({ length: 30 }, () => 2));
  const win = timeWindow({
    data,
    key: "date",
    valueKeys: ["closed"],
    range: { from: d(2026, 2, 10), to: d(2026, 2, 19) + DAY - 1 },
    scope: SCOPE_RANGE,
    bucketMs: BUCKET_MS.day,
  });
  assert.equal(win.data.length, 10);
  assert.equal(win.data[0].date, d(2026, 2, 10));
  assert.equal(win.clipped, true);
  assert.equal(win.hiddenBefore, 9);
  assert.equal(win.hiddenAfter, 11);
});

test("timeWindow trims dead edges even at All-time scope", () => {
  // The AI-tagging case: months of leading zeroes before tagging existed.
  const data = daily([0, 0, 0, 0, 4, 9, 2, 0, 0]);
  const win = timeWindow({
    data,
    key: "date",
    valueKeys: ["closed"],
    range: { from: d(2026, 2, 1), to: d(2026, 2, 9) },
    scope: SCOPE_ALL,
    bucketMs: BUCKET_MS.day,
  });
  assert.deepEqual(win.data.map((p) => p.closed), [4, 9, 2]);
  assert.equal(win.trimmed, 6);
  // Nothing the user asked for is hidden, so no "outside the range" note.
  assert.equal(win.clipped, false);
});

test("timeWindow does not count trimmed dead edges as hidden points", () => {
  const data = daily([0, 0, 1, 2, 3, 4, 5, 6, 0, 0]);
  const win = timeWindow({
    data,
    key: "date",
    valueKeys: ["closed"],
    range: { from: d(2026, 2, 5), to: d(2026, 2, 8) + DAY - 1 },
    scope: SCOPE_RANGE,
    bucketMs: BUCKET_MS.day,
  });
  assert.deepEqual(win.data.map((p) => p.closed), [3, 4, 5, 6]);
  // Trimmed series is the 6 real points; 2 of them fall before the window.
  assert.equal(win.hiddenBefore, 2);
  assert.equal(win.hiddenAfter, 0);
  assert.equal(win.trimmed, 4);
});

test("timeWindow ignores the range at All-time scope", () => {
  const data = daily(Array.from({ length: 20 }, () => 1));
  const win = timeWindow({
    data,
    key: "date",
    valueKeys: ["closed"],
    range: { from: d(2026, 2, 5), to: d(2026, 2, 6) },
    scope: SCOPE_ALL,
    bucketMs: BUCKET_MS.day,
  });
  assert.equal(win.data.length, 20);
  assert.equal(win.clipped, false);
});

test("timeWindow pads the domain by half a bucket so end bars aren't clipped", () => {
  const data = daily([1, 2, 3]);
  const win = timeWindow({
    data, key: "date", valueKeys: ["closed"], range: null,
    scope: SCOPE_RANGE, bucketMs: BUCKET_MS.day,
  });
  assert.equal(win.pad, DAY / 2);
  assert.deepEqual(win.domain, [d(2026, 2, 1) - DAY / 2, d(2026, 2, 3) + DAY / 2]);
});

test("timeWindow picks a day formatter once zoomed in", () => {
  const data = daily(Array.from({ length: 400 }, () => 1));
  const zoomed = timeWindow({
    data, key: "date", valueKeys: ["closed"],
    range: { from: d(2026, 2, 1), to: d(2026, 2, 14) },
    scope: SCOPE_RANGE, bucketMs: BUCKET_MS.day,
  });
  const wide = timeWindow({
    data, key: "date", valueKeys: ["closed"], range: null,
    scope: SCOPE_RANGE, bucketMs: BUCKET_MS.day,
  });
  assert.equal(zoomed.tickFormatter(d(2026, 2, 3)), "Feb 3");
  assert.equal(wide.tickFormatter(d(2026, 2, 3)), "Feb '26");
});

test("timeWindow survives an empty series without NaN in the domain", () => {
  const win = timeWindow({
    data: [], key: "date", valueKeys: ["closed"], range: null,
    scope: SCOPE_RANGE, bucketMs: BUCKET_MS.day,
  });
  assert.deepEqual(win.data, []);
  assert.ok(win.domain.every(Number.isFinite));
  assert.ok(Number.isFinite(win.spanMs));
});

test("timeWindow gives a single-point series a non-zero span and pad", () => {
  const win = timeWindow({
    data: daily([5]), key: "date", valueKeys: ["closed"], range: null,
    scope: SCOPE_RANGE, bucketMs: BUCKET_MS.week,
  });
  assert.equal(win.pad, BUCKET_MS.week);
  assert.equal(win.spanMs, BUCKET_MS.week);
  assert.ok(win.domain[1] > win.domain[0]);
});
