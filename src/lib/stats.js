import { priorityRank } from "./enrich.js";
import { priorityColor } from "./format.js";
import {
  WEEKDAY_NAMES, WEEKDAY_ORDER, PRESETS, AGING_BUCKETS, SLA_RISK_BUCKETS, FRT_BUCKETS,
} from "./constants.js";

export const computeKpis = (rows) => {
  const total = rows.length;
  // Three-state lifecycle: closed (State="Closed", truly done) | solutionProposed
  // (State="Resolved" / "Solution Proposed", awaiting customer) | open (active
  // work). `open` is TRULY open — Solution-Proposed cases are their own bucket,
  // not folded into either closed or open. See enrich.js v8.
  const closed = rows.filter((r) => r._isClosed);
  const open = rows.filter((r) => r._isOpen);
  const solutionProposed = rows.filter((r) => r._lifecycle === "solution_proposed");
  // SLA = the Infor SOP response cadence (see computeSlaSop in enrich.js), not
  // ServiceNow's first-response-only `made_sla` flag. Eligible = the case has a
  // defined cadence; met = eligible and it never breached the cadence.
  const slaEligible = rows.filter((r) => r._slaEligible);
  const slaMet = slaEligible.filter((r) => !r._slaBreached).length;
  const slaRate = slaEligible.length ? (slaMet / slaEligible.length) * 100 : null;
  // Split the missed cases by *why* they missed (mutually exclusive, so the two
  // sum to slaEligible - slaMet). Drives the breach-reason breakdown on the SLA
  // page and the reason column in the case register.
  const slaMissedInitial = slaEligible.filter((r) => r._slaBreachReason === "initial").length;
  const slaMissedCadence = slaEligible.filter((r) => r._slaBreachReason === "cadence").length;
  const resolved = closed.filter((r) => r._resolvedMs != null);
  const avgRes = resolved.length
    ? resolved.reduce((s, r) => s + r._resolvedMs, 0) / resolved.length
    : null;
  // Percentiles tell the real story the average hides: p50 is the typical case,
  // p90 the long tail. A wide p50→p90 gap means a minority of cases drag badly.
  const resSorted = resolved.map((r) => r._resolvedMs).sort((a, b) => a - b);
  const resP50 = percentile(resSorted, 50);
  const resP90 = percentile(resSorted, 90);
  const frt = rows.filter((r) => r._frtMs != null);
  const avgFrt = frt.length ? frt.reduce((s, r) => s + r._frtMs, 0) / frt.length : null;
  const frtSorted = frt.map((r) => r._frtMs).sort((a, b) => a - b);
  const frtP50 = percentile(frtSorted, 50);
  const frtP90 = percentile(frtSorted, 90);
  const now = new Date();
  const atRisk = open.filter((r) => r._slaDueSop && r._slaDueSop > now && r._slaDueSop - now < 24 * 36e5);
  const breached = open.filter((r) => r._slaDueSop && r._slaDueSop < now);
  return {
    total, closed: closed.length, open: open.length,
    solutionProposed: solutionProposed.length,
    slaRate, slaMet,
    slaEligible: slaEligible.length, slaMissedInitial, slaMissedCadence,
    avgRes, resP50, resP90, avgFrt, frtP50, frtP90,
    atRisk, breached,
  };
};

export const computeInteractionStats = (rows) => {
  if (!rows.length) return { avgTurns: 0, avgCustomer: 0, avgAnalyst: 0, multiTouchPct: 0 }
  let totalTurns = 0, totalCustomer = 0, totalAnalyst = 0, multiTouch = 0
  for (const r of rows) {
    const t = r._interactionCount || 0
    totalTurns += t
    totalCustomer += r._customerTurns || 0
    totalAnalyst += r._analystTurns || 0
    if (t > 2) multiTouch++
  }
  const n = rows.length
  return {
    avgTurns: totalTurns / n,
    avgCustomer: totalCustomer / n,
    avgAnalyst: totalAnalyst / n,
    multiTouchPct: (multiTouch / n) * 100,
  }
}

export const topCounts = (rows, getKey, n = 3) => {
  const groups = {};
  for (const r of rows) {
    const k = getKey(r) || "Unknown";
    groups[k] = (groups[k] || 0) + 1;
  }
  return Object.entries(groups)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n);
};

export const priorityMix = (rows) => {
  const groups = {};
  for (const r of rows) {
    const p = r.priority || "Unknown";
    groups[p] = (groups[p] || 0) + 1;
  }
  return Object.entries(groups)
    .map(([priority, count]) => ({ priority, count, color: priorityColor(priority) }))
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority));
};

export const percentile = (sortedAsc, p) => {
  if (!sortedAsc.length) return null;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const rank = (p / 100) * (sortedAsc.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (rank - lo);
};

export const resolutionDistribution = (rows) => {
  const groups = {};
  for (const r of rows) {
    if (!r._isClosed || r._resolvedMs == null) continue;
    const p = r.priority || "Unknown";
    (groups[p] = groups[p] || []).push(r._resolvedMs);
  }
  return Object.entries(groups)
    .map(([priority, values]) => {
      values.sort((a, b) => a - b);
      const p50 = percentile(values, 50);
      const p90 = percentile(values, 90);
      const max = values[values.length - 1];
      return {
        priority,
        n: values.length,
        p50_h: p50 == null ? null : p50 / 36e5,
        p90_h: p90 == null ? null : p90 / 36e5,
        max_h: max == null ? null : max / 36e5,
        p50_ms: p50,
        p90_ms: p90,
        max_ms: max,
        color: priorityColor(priority),
      };
    })
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority));
};

export const startOfDay = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

export const presetRange = (key, refDate = new Date()) => {
  const start = startOfDay(refDate);
  const endOfToday = start.getTime() + 864e5 - 1;
  switch (key) {
    case "7d":  return { from: start.getTime() - 6 * 864e5, to: endOfToday };
    case "30d": return { from: start.getTime() - 29 * 864e5, to: endOfToday };
    case "qtr": return { from: start.getTime() - 89 * 864e5, to: endOfToday };
    case "ytd": {
      const yearStart = new Date(start.getFullYear(), 0, 1);
      return { from: yearStart.getTime(), to: endOfToday };
    }
    case "all":
    default:    return { from: null, to: null };
  }
};

export const matchPreset = (from, to) => {
  if (from == null && to == null) return "all";
  for (const p of PRESETS) {
    if (p.key === "all" || p.key === "custom") continue;
    const r = presetRange(p.key);
    if (Math.abs(r.from - from) < 60 * 1000 && Math.abs(r.to - to) < 60 * 1000) return p.key;
  }
  return "custom";
};

export const filterRowsByDate = (rows, from, to, fieldKey) => {
  if (from == null && to == null) return rows;
  return rows.filter((r) => {
    const d = r[fieldKey];
    if (!d) return false;
    const t = d.getTime();
    if (from != null && t < from) return false;
    if (to != null && t > to) return false;
    return true;
  });
};

export const previousWindow = (from, to) => {
  if (from == null || to == null) return { from: null, to: null };
  const len = to - from;
  return { from: from - len - 1, to: from - 1 };
};

export const weekdayAnalytics = (rows) => {
  const empty = WEEKDAY_NAMES.map((name) => ({ name, count: 0 }));
  if (!rows || !rows.length) return { created: empty, avgOpen: empty.map((d) => ({ ...d })) };

  // Cases created by weekday
  const createdBuckets = [0, 0, 0, 0, 0, 0, 0];
  let minCreated = null;
  let maxEnd = null;
  const now = new Date();
  for (const r of rows) {
    if (r._created) {
      createdBuckets[r._created.getDay()]++;
      if (!minCreated || r._created < minCreated) minCreated = r._created;
    }
    const end = r._closed || (r._isClosed ? r._closed : now);
    if (end && (!maxEnd || end > maxEnd)) maxEnd = end;
  }
  const created = WEEKDAY_ORDER.map((idx, i) => ({ name: WEEKDAY_NAMES[i], count: createdBuckets[idx] }));

  // Average open caseload by weekday
  if (!minCreated || !maxEnd) {
    return { created, avgOpen: empty.map((d) => ({ ...d })) };
  }
  const start = startOfDay(minCreated);
  const end = startOfDay(maxEnd);
  const totalDays = Math.floor((end - start) / 864e5) + 1;
  if (totalDays > 2000) {
    return { created, avgOpen: empty.map((d) => ({ ...d })) };
  }

  const openSums = [0, 0, 0, 0, 0, 0, 0];
  const dayCounts = [0, 0, 0, 0, 0, 0, 0];
  const cursor = new Date(start);
  for (let i = 0; i < totalDays; i++) {
    const dayStart = cursor.getTime();
    const dayEnd = dayStart + 864e5;
    let openCount = 0;
    for (const r of rows) {
      if (!r._created) continue;
      if (r._created.getTime() >= dayEnd) continue;
      if (r._closed && r._closed.getTime() < dayStart) continue;
      // Without a close timestamp, only TRULY open cases count toward open
      // caseload — Solution-Proposed (resolved, awaiting customer) are excluded.
      if (!r._closed && !r._isOpen) continue;
      openCount++;
    }
    const dow = cursor.getDay();
    openSums[dow] += openCount;
    dayCounts[dow]++;
    cursor.setDate(cursor.getDate() + 1);
  }
  const avgOpen = WEEKDAY_ORDER.map((idx, i) => ({
    name: WEEKDAY_NAMES[i],
    count: dayCounts[idx] ? Math.round((openSums[idx] / dayCounts[idx]) * 10) / 10 : 0,
  }));

  return { created, avgOpen };
};

export const agingBuckets = (rows) => {
  const now = Date.now();
  const counts = AGING_BUCKETS.map((b) => ({ name: b.name, count: 0 }));
  for (const r of rows) {
    if (!r._isOpen) continue; // truly-open only; Solution-Proposed & closed excluded
    if (!r._created) continue;
    const days = Math.floor((now - r._created.getTime()) / 864e5);
    const idx = AGING_BUCKETS.findIndex((b) => days >= b.min && days <= b.max);
    if (idx >= 0) counts[idx].count++;
  }
  return counts;
};

export const slaRiskSegments = (rows) => {
  const now = Date.now();
  const counts = Object.fromEntries(SLA_RISK_BUCKETS.map((b) => [b.key, 0]));
  for (const r of rows) {
    if (!r._isOpen) continue; // truly-open only; Solution-Proposed tracked in its own queue
    if (!r._slaDueSop) {
      counts.noSla++;
      continue;
    }
    const ms = r._slaDueSop.getTime() - now;
    if (ms < 0) counts.breached++;
    else if (ms < 24 * 36e5) counts.due24++;
    else if (ms < 7 * 24 * 36e5) counts.dueWeek++;
    else counts.comfortable++;
  }
  return SLA_RISK_BUCKETS.map((b) => ({ ...b, count: counts[b.key] }));
};

export const slaRiskOf = (r, now = Date.now()) => {
  if (!r._slaDueSop) return "noSla";
  const ms = r._slaDueSop.getTime() - now;
  if (ms < 0) return "breached";
  if (ms < 24 * 36e5) return "due24";
  if (ms < 7 * 24 * 36e5) return "dueWeek";
  return "comfortable";
};

export const ageBucketOf = (r, now = Date.now()) => {
  if (!r._created) return null;
  const days = Math.floor((now - r._created.getTime()) / 864e5);
  return AGING_BUCKETS.findIndex((b) => days >= b.min && days <= b.max);
};

export const openByAssigneeAge = (members) => {
  if (!members || !members.length) return [];
  const now = Date.now();
  const rows = [];
  for (const m of members) {
    const cells = AGING_BUCKETS.map(() => 0);
    let total = 0;
    for (const r of m.rows) {
      if (!r._isOpen) continue; // truly-open only
      const idx = ageBucketOf(r, now);
      if (idx >= 0) {
        cells[idx]++;
        total++;
      }
    }
    if (total === 0) continue;
    const obj = { name: m.name, total };
    AGING_BUCKETS.forEach((b, i) => { obj[b.name] = cells[i]; });
    rows.push(obj);
  }
  rows.sort((a, b) => {
    const aOld = (a[AGING_BUCKETS[2].name] || 0) + (a[AGING_BUCKETS[3].name] || 0);
    const bOld = (b[AGING_BUCKETS[2].name] || 0) + (b[AGING_BUCKETS[3].name] || 0);
    if (aOld !== bOld) return bOld - aOld;
    return b.total - a.total;
  });
  return rows;
};

export const stuckCases = (rows, thresholdDays = 30) => {
  const now = Date.now();
  const cutoff = thresholdDays * 864e5;
  return rows
    .filter((r) => r._isOpen && r._created && (now - r._created.getTime()) >= cutoff)
    .sort((a, b) => a._created - b._created);
};

export const hourHeatmap = (rows) => {
  const grid = WEEKDAY_ORDER.map(() => new Array(24).fill(0));
  let max = 0;
  for (const r of rows) {
    if (!r._created) continue;
    const dow = r._created.getDay();
    const hr = r._created.getHours();
    const rowIdx = WEEKDAY_ORDER.indexOf(dow);
    if (rowIdx < 0) continue;
    grid[rowIdx][hr]++;
    if (grid[rowIdx][hr] > max) max = grid[rowIdx][hr];
  }
  return { grid, max };
};

export const startOfMonday = (d) => {
  const x = startOfDay(d);
  const offset = (x.getDay() + 6) % 7; // Mon=0, Sun=6
  x.setDate(x.getDate() - offset);
  return x;
};

/** Daily backlog grid, oldest case → `refNow` (the data snapshot).
 *
 *  `gridEndMs` extends the x-axis PAST the snapshot — used by the Trends charts
 *  so the axis reaches the current calendar day instead of stopping on the day
 *  the export was uploaded. Days after the snapshot are marked `stale: true` and
 *  carry `created`/`closed` as **null**, not 0: we have no observations for them,
 *  and a zero bar would assert "nothing came in today" when the truth is "we
 *  haven't imported today yet". `open`/`owned`/`solutionProposed` DO carry
 *  forward on those days — a case open at the snapshot is still open until an
 *  import says otherwise. */
export const dailyTrajectory = (rows, refNow = Date.now(), gridEndMs = null) => {
  if (!rows || !rows.length) return [];
  let minCreated = null;
  let maxEnd = null;
  const now = new Date(refNow);
  for (const r of rows) {
    if (r._created && (!minCreated || r._created < minCreated)) minCreated = r._created;
    const end = r._closed || now;
    if (!maxEnd || end > maxEnd) maxEnd = end;
  }
  if (!minCreated || !maxEnd) return [];
  const start = startOfDay(minCreated);
  const observedEnd = startOfDay(maxEnd).getTime();
  const end = gridEndMs != null && startOfDay(gridEndMs).getTime() > observedEnd
    ? startOfDay(gridEndMs)
    : startOfDay(maxEnd);
  const totalDays = Math.floor((end - start) / 864e5) + 1;
  if (totalDays > 2000) return [];

  const out = [];
  const cursor = new Date(start);
  for (let i = 0; i < totalDays; i++) {
    const dayStart = cursor.getTime();
    const dayEnd = dayStart + 864e5;
    let open = 0;
    let created = 0;
    let closed = 0;
    let owned = 0;
    for (const r of rows) {
      if (r._created) {
        const ct = r._created.getTime();
        if (ct >= dayStart && ct < dayEnd) created++;
        if (ct < dayEnd && (!r._closed || r._closed.getTime() >= dayStart)) {
          // `owned` = every case still on our books that day — created by then
          // and not yet closed. Includes Solution-Proposed (resolved, awaiting
          // customer): we still own it until it closes.
          owned++;
          // `open` is the TRULY-open subset — Solution-Proposed excluded.
          if (!(!r._closed && !r._isOpen)) open++;
        }
      }
      if (r._closed) {
        const xt = r._closed.getTime();
        if (xt >= dayStart && xt < dayEnd) closed++;
      }
    }
    // `solutionProposed` is the rest of `owned` once truly-open is removed —
    // cases on our books that day sitting in a resolved/Solution-Proposed state.
    // By construction open + solutionProposed === owned, so the three stack.
    // Past the last observed day the counters below are structurally zero (there
    // are no rows out there) — surface that as null/`stale` so charts can draw a
    // gap instead of a fabricated zero. See the jsdoc above.
    const stale = dayStart > observedEnd;
    out.push({
      date: dayStart,
      open,
      created: stale ? null : created,
      closed: stale ? null : closed,
      owned,
      solutionProposed: owned - open,
      stale,
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
};

/** Cases actually CLOSED per calendar day — keyed off the ServiceNow close
 *  timestamp (`_closed` = the "Closed" column), NOT resolution duration. A row
 *  counts on the day its close timestamp falls, even if it was later reopened
 *  (the close event still happened that day) — matching how `dailyTrajectory`
 *  and the weekly chart already bucket closes.
 *
 *  Built on top of `dailyTrajectory` so the daily grid (oldest case → snapshot)
 *  and close-bucketing logic stay a single source of truth and the x-axis lines
 *  up with the backlog-trajectory chart above it. Adds a trailing N-day rolling
 *  average so the weekday/weekend spikiness of raw daily closes is readable.
 *  `refNow` should be the data snapshot timestamp for determinism. */
export const dailyClosed = (rows, refNow = Date.now(), window = 7, gridEndMs = null) => {
  const traj = dailyTrajectory(rows, refNow, gridEndMs);
  const out = traj.map((d) => ({ date: d.date, closed: d.closed, rollingAvg: 0, stale: d.stale }));
  for (let i = 0; i < out.length; i++) {
    // Unobserved days (past the snapshot) get a null average rather than being
    // averaged in as zeroes — otherwise a stale import would drag the trailing
    // mean down and read as a throughput collapse that never happened.
    if (out[i].stale) { out[i].rollingAvg = null; continue; }
    let s = 0;
    let n = 0;
    for (let j = Math.max(0, i - (window - 1)); j <= i; j++) {
      s += out[j].closed;
      n++;
    }
    out[i].rollingAvg = n ? Math.round((s / n) * 10) / 10 : 0;
  }
  return out;
};

export const weeklyIntakeResolved = (rows, refNow = Date.now()) => {
  if (!rows || !rows.length) return [];
  let minDate = null;
  let maxDate = null;
  const now = new Date(refNow);
  for (const r of rows) {
    const d = r._created;
    const c = r._closed;
    if (d && (!minDate || d < minDate)) minDate = d;
    const ref = c || now;
    if (!maxDate || ref > maxDate) maxDate = ref;
  }
  if (!minDate || !maxDate) return [];
  const startWeek = startOfMonday(minDate);
  const endWeek = startOfMonday(maxDate);
  const totalWeeks = Math.floor((endWeek - startWeek) / (7 * 864e5)) + 1;
  if (totalWeeks > 520) return []; // ~10 years guard

  const buckets = new Map();
  for (let i = 0; i < totalWeeks; i++) {
    const wkStart = new Date(startWeek);
    wkStart.setDate(wkStart.getDate() + i * 7);
    buckets.set(wkStart.getTime(), { week: wkStart.getTime(), created: 0, resolved: 0 });
  }
  for (const r of rows) {
    if (r._created) {
      const k = startOfMonday(r._created).getTime();
      const b = buckets.get(k);
      if (b) b.created++;
    }
    if (r._closed) {
      const k = startOfMonday(r._closed).getTime();
      const b = buckets.get(k);
      if (b) b.resolved++;
    }
  }
  const arr = Array.from(buckets.values()).sort((a, b) => a.week - b.week);
  // Rolling 4-week net (created - resolved)
  for (let i = 0; i < arr.length; i++) {
    let s = 0;
    let n = 0;
    for (let j = Math.max(0, i - 3); j <= i; j++) {
      s += arr[j].created - arr[j].resolved;
      n++;
    }
    arr[i].rollingNet = n ? Math.round((s / n) * 10) / 10 : 0;
    arr[i].net = arr[i].created - arr[i].resolved;
  }
  return arr;
};

export const workloadStats = (members) => {
  const empty = { n: 0, mean: 0, median: 0, stddev: 0, min: 0, max: 0, cv: 0, total: 0 };
  if (!members || !members.length) return empty;
  const counts = members.map((m) => m.kpis.total).filter((v) => v > 0);
  const n = counts.length;
  if (!n) return { ...empty, n: members.length };
  const total = counts.reduce((s, v) => s + v, 0);
  const mean = total / n;
  const sorted = [...counts].sort((a, b) => a - b);
  const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  const variance = counts.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const stddev = Math.sqrt(variance);
  return {
    n,
    total,
    mean,
    median,
    stddev,
    min: sorted[0],
    max: sorted[n - 1],
    cv: mean ? stddev / mean : 0,
  };
};

/** Resolution-quality metrics managers care about more than raw volume:
 *  - FCR (first-contact resolution): closed cases resolved in ≤1 analyst touch,
 *    approximated from `_analystTurns` (Infor-authored journal entries).
 *  - Reopen rate: cases that carry a close timestamp (`_closed`) but are NOT
 *    currently closed — i.e. they were resolved and bounced back open. Derived
 *    purely from the snapshot (no state-history export needed). */
export const qualityMetrics = (rows) => {
  let closed = 0, fcr = 0, everClosed = 0, reopened = 0;
  for (const r of rows) {
    if (r._isClosed) {
      closed++;
      if ((r._analystTurns || 0) <= 1) fcr++;
    }
    if (r._closed) {
      everClosed++;
      if (!r._isClosed) reopened++;
    }
  }
  return {
    closed,
    fcr,
    fcrRate: closed ? (fcr / closed) * 100 : null,
    everClosed,
    reopened,
    reopenRate: everClosed ? (reopened / everClosed) * 100 : null,
  };
};

/* Seeded PRNG (mulberry32). The forecast below is a Monte Carlo simulation, so
 * it needs randomness — but `Math.random()` would reshuffle the cone on every
 * re-render (and trips react-hooks/purity). Seeding deterministically from the
 * data keeps the forecast stable for a given snapshot. */
const mulberry32 = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Backlog burn-down forecast via Monte Carlo simulation.
 *
 *  Instead of extrapolating a single average net — which assumes one rate holds
 *  forever and hides all uncertainty — this bootstraps from the recent *mature*
 *  weekly history. Each simulated future week replays a real past week's
 *  (created, resolved) pair; resolution is capped by what's actually open (a
 *  queue can't resolve more than it holds); the open backlog walks forward.
 *  Over many trials this yields a distribution per week, reported as a p10–p90
 *  cone around the p50 median — an honest range rather than false precision.
 *
 *  Inputs are de-biased first: "now" is anchored to the snapshot, and the
 *  resolution-immature tail (recent weeks whose cases haven't closed yet) is
 *  dropped before sampling. The charted history is also trimmed of its
 *  cold-start ramp. `refNow` should be the data snapshot timestamp. */
export const backlogForecast = (
  rows,
  refNow = Date.now(),
  {
    horizonWeeks = 13,
    historyDays = 120,
    immatureWeeks = 2,
    sampleWeeks = 12,
    trials = 2000,
  } = {},
) => {
  const currentOpen = rows.reduce((n, r) => n + (r._isOpen ? 1 : 0), 0);
  const weekly = weeklyIntakeResolved(rows, refNow);

  // Drop the resolution-immature tail (recent weeks under-count closes) and the
  // partial final week, then keep the most recent `sampleWeeks` as the pool the
  // simulation draws future weeks from — "the future looks like the recent past".
  const mature = weekly.slice(0, Math.max(0, weekly.length - immatureWeeks));
  const pool = (mature.length ? mature : weekly).slice(-sampleWeeks);

  // Mean weekly net over the pool — the headline "± X per week" run-rate.
  const weeklyNet = pool.length
    ? pool.reduce((s, w) => s + (w.created - w.resolved), 0) / pool.length
    : 0;
  const shrinking = weeklyNet < 0;

  // ---- historical line, cold-start-trimmed --------------------------------
  // The export only holds cases created inside its window, so the open count
  // ramps up from ~0 at the data's start — that early stretch understates the
  // real backlog. Don't chart it until the dataset has run ~one typical case
  // lifetime (median resolution time), by which point open-count churn reflects
  // steady state rather than the fill-up artifact.
  const resolvedDays = [];
  for (const r of rows) if (r._resolvedMs != null) resolvedDays.push(r._resolvedMs / 864e5);
  resolvedDays.sort((a, b) => a - b);
  const warmupDays = Math.min(Math.max(percentile(resolvedDays, 50) ?? 0, 0), 45);

  const traj = dailyTrajectory(rows, refNow);
  const dataStart = traj.length ? traj[0].date : refNow;
  const histStart = Math.max(refNow - historyDays * 864e5, dataStart + warmupDays * 864e5);
  const series = traj
    .filter((d) => d.date >= histStart)
    .map((d) => ({ date: d.date, open: d.open, band: null, mid: null }));

  // Need a few weeks of variance to simulate a meaningful distribution.
  if (pool.length < 3 || !series.length) {
    return {
      currentOpen, weeklyNet, shrinking, sampleWeeks: pool.length,
      insufficient: pool.length < 3,
      pClear: null, medianClearWeeks: null, clearDate: null, projHorizon: null, series,
    };
  }

  // ---- Monte Carlo ---------------------------------------------------------
  let seed = (0x9e3779b9 ^ currentOpen ^ (pool.length << 16)) | 0;
  for (const w of pool) seed = (Math.imul(seed, 31) + (w.created * 7 + w.resolved)) | 0;
  const rng = mulberry32(seed);
  const weekMs = 7 * 864e5;
  const lastDate = series[series.length - 1].date;
  const weekOpens = Array.from({ length: horizonWeeks }, () => new Float64Array(trials));
  const clearWeeks = [];
  let clearedCount = 0;

  for (let t = 0; t < trials; t++) {
    let open = currentOpen;
    let clearedAt = 0;
    for (let w = 0; w < horizonWeeks; w++) {
      const wk = pool[(rng() * pool.length) | 0];
      const resolvedEff = Math.min(wk.resolved, open + wk.created); // can't resolve more than exists
      open = Math.max(0, open + wk.created - resolvedEff);
      weekOpens[w][t] = open;
      if (!clearedAt && open <= 0) clearedAt = w + 1;
    }
    if (clearedAt) { clearedCount++; clearWeeks.push(clearedAt); }
  }

  // Per-week percentiles → cone. Anchor the final actual point to the true
  // snapshot open (the trajectory's last partial day can over-count) so the
  // solid line meets the cone cleanly at "now" and matches the headline figure.
  series[series.length - 1].open = currentOpen;
  series[series.length - 1].band = [currentOpen, currentOpen];
  series[series.length - 1].mid = currentOpen;
  for (let w = 0; w < horizonWeeks; w++) {
    const sorted = Array.from(weekOpens[w]).sort((a, b) => a - b);
    series.push({
      date: lastDate + (w + 1) * weekMs,
      open: null,
      band: [Math.round(percentile(sorted, 10)), Math.round(percentile(sorted, 90))],
      mid: Math.round(percentile(sorted, 50)),
    });
  }

  clearWeeks.sort((a, b) => a - b);
  const medianClearWeeks = clearWeeks.length ? percentile(clearWeeks, 50) : null;
  const clearDate = medianClearWeeks != null ? refNow + Math.round(medianClearWeeks * 7) * 864e5 : null;
  const last = series[series.length - 1];

  return {
    currentOpen, weeklyNet, shrinking, sampleWeeks: pool.length, insufficient: false,
    pClear: clearedCount / trials,
    medianClearWeeks,
    clearDate,
    projHorizon: { weeks: horizonWeeks, lo: last.band[0], mid: last.mid, hi: last.band[1] },
    series,
  };
};

/** First-response-time distribution: histogram buckets + percentile/avg stats.
 *  Operates over rows that have a measured `_frtMs`. */
export const frtDistribution = (rows) => {
  const vals = [];
  for (const r of rows) if (r._frtMs != null) vals.push(r._frtMs);
  const buckets = FRT_BUCKETS.map((b) => ({ name: b.name, count: 0 }));
  for (const v of vals) {
    const idx = FRT_BUCKETS.findIndex((b) => v < b.max);
    if (idx >= 0) buckets[idx].count++;
  }
  const sorted = [...vals].sort((a, b) => a - b);
  return {
    buckets,
    n: vals.length,
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    avg: vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null,
  };
};

/** Forward-looking SLA breach forecast: open cases NOT yet breached whose SLA
 *  deadline falls within `horizonDays`, ranked soonest-first. Each row carries
 *  its time-to-breach and a momentum read (time since the last Infor update);
 *  `stalled` flags cases that haven't been touched in longer than the time they
 *  have left — i.e. on current cadence they're unlikely to get attention before
 *  breaching. `noResponseYet` flags open cases with no first response logged.
 *
 *  `refNow` defaults to the live clock; callers should pass the data snapshot
 *  timestamp so the forecast is deterministic for a given dataset (and to keep
 *  Date.now() out of component render — react-hooks/purity). */
export const slaBreachForecast = (rows, refNow = Date.now(), horizonDays = 7) => {
  const now = refNow;
  const horizon = now + horizonDays * 864e5;
  const out = [];
  for (const r of rows) {
    if (!r._isOpen || !r._slaDueSop) continue; // truly-open only
    const due = r._slaDueSop.getTime();
    if (due <= now || due > horizon) continue; // already breached, or beyond window
    const timeToBreach = due - now;
    const lastTouch = r._lastInforUpdate
      ? r._lastInforUpdate.getTime()
      : r._created ? r._created.getTime() : null;
    const sinceTouch = lastTouch != null ? now - lastTouch : null;
    const stalled = sinceTouch != null && sinceTouch > timeToBreach;
    const noResponseYet = r._frtMs == null;
    out.push({ row: r, due, timeToBreach, sinceTouch, stalled, noResponseYet });
  }
  out.sort((a, b) => a.timeToBreach - b.timeToBreach);
  return out;
};

/** Account churn-risk signal. Ranks accounts by a transparent score combining
 *  three pressures relative to a rolling window: rising case volume (this
 *  `windowDays` vs the prior equal window), falling SLA (same comparison), and
 *  open Jira-blocked / breached cases right now. Returns accounts with any risk
 *  signal, highest score first. Tiny accounts (< 3 cases across both windows)
 *  are excluded as noise. `refNow` should be the data snapshot timestamp. */
export const accountChurnRisk = (rows, refNow = Date.now(), windowDays = 90) => {
  const now = refNow;
  const W = windowDays * 864e5;
  const nowStart = now - W;
  const prevStart = now - 2 * W;
  const acc = new Map();
  const get = (name) => {
    let a = acc.get(name);
    if (!a) {
      a = {
        account: name, casesNow: 0, casesPrev: 0,
        slaMetNow: 0, slaEligNow: 0, slaMetPrev: 0, slaEligPrev: 0,
        openCount: 0, openBlockers: 0, breachedOpen: 0,
      };
      acc.set(name, a);
    }
    return a;
  };
  for (const r of rows) {
    const a = get(r.account || "Unknown");
    const eligible = r._slaEligible;
    const created = r._created ? r._created.getTime() : null;
    if (created != null) {
      if (created >= nowStart && created <= now) {
        a.casesNow++;
        if (eligible) { a.slaEligNow++; if (!r._slaBreached) a.slaMetNow++; }
      } else if (created >= prevStart && created < nowStart) {
        a.casesPrev++;
        if (eligible) { a.slaEligPrev++; if (!r._slaBreached) a.slaMetPrev++; }
      }
    }
    if (r._isOpen) {
      a.openCount++;
      if ((r._jiraActiveTickets?.length || 0) > 0) a.openBlockers++;
      if (r._slaDueSop && r._slaDueSop.getTime() < now) a.breachedOpen++;
    }
  }
  const results = [];
  for (const a of acc.values()) {
    if (a.account === "Unknown") continue;
    if (a.casesNow + a.casesPrev < 3) continue;
    const slaNow = a.slaEligNow ? (a.slaMetNow / a.slaEligNow) * 100 : null;
    const slaPrev = a.slaEligPrev ? (a.slaMetPrev / a.slaEligPrev) * 100 : null;
    const volDelta = a.casesNow - a.casesPrev;
    const volTrendPct = a.casesPrev ? (volDelta / a.casesPrev) * 100 : a.casesNow ? 100 : 0;
    const slaDrop = slaNow != null && slaPrev != null ? slaPrev - slaNow : 0; // + = SLA fell
    const risingVolume = volDelta > 0 && a.casesNow >= 2;
    const fallingSla = slaDrop > 0.5;
    // Transparent additive score — shown alongside its signal chips so managers
    // can see *why* an account ranks where it does, not just a black-box number.
    const score =
      Math.max(0, volDelta) * 2 +
      Math.max(0, slaDrop) * 0.5 +
      a.openBlockers * 4 +
      a.breachedOpen * 3;
    if (score <= 0) continue;
    results.push({
      ...a, slaNow, slaPrev, volDelta, volTrendPct, slaDrop,
      risingVolume, fallingSla, score,
    });
  }
  results.sort((x, y) => y.score - x.score);
  return results;
};

export const workloadConcentration = (members) => {
  const empty = { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], gini: 0, top20Share: 0, top50Share: 0, nAnalysts: 0, totalCases: 0 };
  if (!members || !members.length) return empty;
  const sorted = [...members]
    .map((m) => ({ name: m.name, count: m.kpis.total }))
    .sort((a, b) => a.count - b.count);
  const n = sorted.length;
  const total = sorted.reduce((s, m) => s + m.count, 0);
  if (!total) return { ...empty, nAnalysts: n };
  const points = [{ x: 0, y: 0 }];
  let cum = 0;
  for (let i = 0; i < n; i++) {
    cum += sorted[i].count;
    points.push({
      x: (i + 1) / n,
      y: cum / total,
      name: sorted[i].name,
      count: sorted[i].count,
    });
  }
  // Gini via trapezoidal area under Lorenz: G = 1 - 2 * area
  let area = 0;
  for (let i = 1; i < points.length; i++) {
    area += (points[i].x - points[i - 1].x) * (points[i].y + points[i - 1].y) / 2;
  }
  const gini = Math.max(0, Math.min(1, 1 - 2 * area));
  const topShare = (frac) => {
    const k = Math.max(1, Math.ceil(frac * n));
    const start = n - k;
    let s = 0;
    for (let i = start; i < n; i++) s += sorted[i].count;
    return (s / total) * 100;
  };
  return {
    points,
    gini,
    top20Share: topShare(0.2),
    top50Share: topShare(0.5),
    nAnalysts: n,
    totalCases: total,
  };
};
