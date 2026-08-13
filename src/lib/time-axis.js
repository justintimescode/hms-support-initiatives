// Shared viewport logic for every chart with a time x-axis.
//
// THE PROBLEM THIS REPLACES. Every trend block used to compute its series over
// the full import, then draw a translucent ReferenceArea over the active date
// filter. Three costs stacked up:
//
//   1. A one-month filter on an 18-month import got ~5% of the axis width. The
//      answer to the user's actual question was a sliver.
//   2. Buckets with no data still consumed axis width. The AI-tagging chart
//      spent ~14 months of its x-axis rendering zeroes because tagging did not
//      exist yet, packing every real bar against the right edge.
//   3. The y-axis scaled to the GLOBAL max, so one recent spike flattened the
//      region you were trying to read even after you narrowed the filter.
//
// THE FIX IS TO SLICE, NOT TO CLIP THE DOMAIN, and that distinction is the whole
// reason this is safe. Every trend builder in stats.js / dod.js / ai-tags.js
// emits points whose values are already final for that point: `open` is the
// backlog on that day, `rollingAvg` is that day's trailing 7-day mean, the DoD
// cumulative series carries its running total. None of it is derived at render
// time from neighbouring points. So dropping out-of-window points cannot change
// a value that stays — no lead-in to preserve, no rolling window to re-seed —
// and Recharts then rescales BOTH axes to what remains, which is what fixes (3)
// for free. Clipping via XAxis domain + allowDataOverflow would fix (1) only,
// and would leave the y-axis pinned to off-screen data.
//
// Callers get one `timeWindow()` result and spread it onto their axis. The
// scope toggle ("Range" vs "All time") lives in TimeScopeToggle.jsx.

/** Scope values. `range` honours the active date filter; `all` shows the whole
 *  import. Both still trim dead edges — see trimEmptyEdges. */
export const SCOPE_RANGE = "range";
export const SCOPE_ALL = "all";

const DAY = 864e5;

/* ============================ edge trimming ============================ */

/** Drop leading and trailing points whose every value key is zero/null.
 *
 *  Only the EDGES. Interior empty buckets are kept, because a gap in the middle
 *  of a series is information ("intake stopped for three weeks") whereas a run
 *  of zeroes before the first real datum is just the builder's grid extending
 *  back to the oldest case in the import. Trimming interior points would also
 *  break the even bucket spacing the x-axis assumes.
 *
 *  @param {object[]} data points, ascending by time
 *  @param {string[]} valueKeys keys that carry a measurement. A point is "empty"
 *    when all of them are 0, null, or undefined.
 *  @returns {object[]} the same array when nothing is trimmed (referentially
 *    stable, so useMemo consumers don't see a new array every render). */
export function trimEmptyEdges(data, valueKeys) {
  if (!data || data.length === 0 || !valueKeys || valueKeys.length === 0) return data || [];
  const empty = (p) => valueKeys.every((k) => p[k] == null || p[k] === 0);

  let lo = 0;
  while (lo < data.length && empty(data[lo])) lo++;
  // Every point is empty: there is no signal to zoom to, so keep the series as
  // it is rather than handing back nothing. The chart's own empty state (or a
  // flat line at zero) is more honest than a blank card.
  if (lo === data.length) return data;

  let hi = data.length - 1;
  while (hi > lo && empty(data[hi])) hi--;

  if (lo === 0 && hi === data.length - 1) return data;
  return data.slice(lo, hi + 1);
}

/* ============================ window slicing ============================ */

/** Slice `data` to the points falling inside [from, to].
 *
 *  Bucket-start semantics: points are keyed by the START of their bucket, so a
 *  week bucket at Jul 27 covers Jul 27–Aug 2 and is included by a filter ending
 *  Jul 30. Testing `point <= to` alone would drop it and lose real cases from
 *  the view, so a point also qualifies when its bucket still covers `from`.
 *  `bucketMs` is that bucket's width; pass 0 for instantaneous points.
 *
 *  Returns the original array when the window would leave fewer than
 *  MIN_POINTS points — a one- or two-point chart reads as broken, and the wider
 *  view is more useful than a technically-correct dot. Callers can tell this
 *  happened via the `clipped` flag from timeWindow(). */
const MIN_POINTS = 2;

export function sliceWindow(data, key, from, to, bucketMs = 0) {
  if (!data || data.length === 0) return data || [];
  if (from == null && to == null) return data;

  const out = data.filter((p) => {
    const t = p[key];
    if (t == null) return false;
    if (to != null && t > to) return false;
    // A bucket spans [t, t + bucketMs) and is dropped only when it ends at or
    // before `from`. Math.max(bucketMs, 1) keeps that exclusive-end arithmetic
    // honest for instantaneous points (bucketMs 0), where a bare
    // `t + 0 <= from` would drop the point landing exactly ON the range start.
    if (from != null && t + Math.max(bucketMs, 1) <= from) return false;
    return true;
  });
  return out.length >= Math.min(MIN_POINTS, data.length) ? out : data;
}

/* ============================ tick formatting ============================ */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Pick a tick formatter from the VISIBLE span, not from the bucket size.
 *
 *  This is the bug that zooming exposes. The daily charts used `fmtAxisDate`
 *  ("Feb 26" — month + 2-digit year), which is right for an 18-month axis and
 *  useless at two weeks, where every tick renders the identical string. The
 *  span, not the granularity, decides how much of the date has to be spelled
 *  out for adjacent ticks to differ:
 *
 *    < ~10 weeks   "Jul 7"      day is what changes
 *    < ~3 years    "Jul '26"    month is what changes; year disambiguates
 *    otherwise     "2026"       only the year is legible at this density
 *
 *  Two-digit years carry an apostrophe ("Jul '26") so the number can't be read
 *  as a day of the month. */
export function tickFormatterForSpan(spanMs) {
  if (spanMs <= 70 * DAY) {
    return (ts) => {
      const d = new Date(ts);
      return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
    };
  }
  if (spanMs <= 1100 * DAY) {
    return (ts) => {
      const d = new Date(ts);
      return `${MONTHS[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`;
    };
  }
  return (ts) => String(new Date(ts).getFullYear());
}

/** Pick ~`target` evenly spaced tick timestamps, always including both ends.
 *
 *  EXPLICIT TICKS, NOT `interval`. On a `type="number"` axis Recharts derives
 *  ticks from the domain and ignores `interval` (which only selects among
 *  category indices), so every one of these charts was rendering a SINGLE tick
 *  at the left edge — visible in the original AI-tagging screenshot as a lone
 *  "Feb 1" under 78 weeks of bars. Handing Recharts a `ticks` array is the only
 *  reliable way to label a numeric time axis.
 *
 *  Ticks land on real bucket timestamps rather than round numbers the scale
 *  would invent, so a label always names a bucket that exists. Deduped, because
 *  rounding can select the same index twice on a short series. */
export function pickTicks(data, key, target = 8) {
  if (!data || data.length === 0) return [];
  if (data.length <= target) return data.map((p) => p[key]);
  const step = (data.length - 1) / (target - 1);
  const out = [];
  for (let i = 0; i < target; i++) out.push(data[Math.round(i * step)][key]);
  return Array.from(new Set(out));
}

/* ============================ main entry ============================ */

/**
 * Resolve the visible window for one time-series chart.
 *
 * @param {object} opts
 * @param {object[]} opts.data full precomputed series, ascending by time
 * @param {string} opts.key timestamp field on each point ("date" | "week" | "bucket")
 * @param {string[]} opts.valueKeys measurement keys, for dead-edge trimming
 * @param {{from:number|null,to:number|null}|null} opts.range active date filter
 * @param {string} opts.scope SCOPE_RANGE | SCOPE_ALL
 * @param {number} [opts.bucketMs] bucket width; also sets the axis pad
 * @param {number} [opts.tickTarget] desired tick count
 * @returns {{
 *   data: object[], domain: [number, number], pad: number, ticks: number[],
 *   tickFormatter: (ts:number)=>string, spanMs: number, clipped: boolean,
 *   trimmed: number, hiddenBefore: number, hiddenAfter: number,
 * }}
 */
export function timeWindow({
  data,
  key,
  valueKeys = [],
  range = null,
  scope = SCOPE_RANGE,
  bucketMs = DAY,
  tickTarget = 8,
}) {
  const full = data || [];
  // Trim dead edges FIRST, at both scopes. "All time" means the full arc of
  // real data, not the full arc of the builder's grid — a chart padded with
  // leading zeroes is the exact complaint this module exists to fix, and it is
  // no less wasteful when the filter happens to be cleared.
  const trimmedData = trimEmptyEdges(full, valueKeys);

  const wantRange = scope === SCOPE_RANGE && range && (range.from != null || range.to != null);
  const windowed = wantRange
    ? sliceWindow(trimmedData, key, range.from, range.to, bucketMs)
    : trimmedData;

  // `clipped` drives the "showing N of M" note. Compare against the trimmed
  // series, not the raw one: edges we dropped for having no data are not points
  // the user is being kept from, so counting them would overstate what's hidden.
  const clipped = windowed.length < trimmedData.length;
  const firstVisible = windowed.length ? windowed[0][key] : null;
  const hiddenBefore = clipped && firstVisible != null
    ? trimmedData.filter((p) => p[key] < firstVisible).length
    : 0;
  const hiddenAfter = clipped ? trimmedData.length - windowed.length - hiddenBefore : 0;

  const lo = windowed.length ? windowed[0][key] : 0;
  const hi = windowed.length ? windowed[windowed.length - 1][key] : 0;
  // Half a bucket of breathing room so end bars/points aren't sliced by the
  // axis. A single-point series has no span to derive this from, so fall back
  // to the bucket width itself.
  const pad = windowed.length > 1 ? bucketMs / 2 : bucketMs;
  const spanMs = Math.max(hi - lo, bucketMs);

  return {
    data: windowed,
    domain: [lo - pad, hi + pad],
    pad,
    ticks: pickTicks(windowed, key, tickTarget),
    tickFormatter: tickFormatterForSpan(spanMs),
    spanMs,
    clipped,
    trimmed: full.length - trimmedData.length,
    hiddenBefore,
    hiddenAfter,
  };
}

/** End of the grid for a chart that should run up to TODAY rather than stopping
 *  on the day the active import was uploaded.
 *
 *  Metrics stay snapshot-anchored (SLA countdowns, queues, forecasts all read
 *  `snapshotMs` — see enrich.js / queries.js); this is purely the x-axis reach,
 *  so the Trends charts don't appear to end "yesterday" just because that's when
 *  the export was pulled. Builders mark the days past the snapshot `stale` and
 *  null out their event counts, so nothing is invented out there.
 *
 *  Returns `snapshotMs` when it is somehow ahead of the clock (a back-dated
 *  machine, an import restored with a future timestamp) so the grid never
 *  shrinks below the observed data. */
export function liveGridEnd(snapshotMs) {
  const now = Date.now();
  return snapshotMs != null && snapshotMs > now ? snapshotMs : now;
}

/** Bucket widths, for callers passing `bucketMs`. */
export const BUCKET_MS = { day: DAY, week: 7 * DAY, month: 30 * DAY };
