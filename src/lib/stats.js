import { priorityRank } from "./enrich.js";
import { priorityColor } from "./format.js";
import {
  WEEKDAY_NAMES, WEEKDAY_ORDER, PRESETS, AGING_BUCKETS, SLA_RISK_BUCKETS, FRT_BUCKETS,
} from "./constants.js";

export const computeKpis = (rows) => {
  const total = rows.length;
  const closed = rows.filter((r) => r._isClosed);
  const open = rows.filter((r) => !r._isClosed);
  const slaEligible = rows.filter((r) => r.made_sla !== "" && r.made_sla != null);
  const slaMet = slaEligible.filter((r) => r._madeSla).length;
  const slaRate = slaEligible.length ? (slaMet / slaEligible.length) * 100 : null;
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
  const atRisk = open.filter((r) => r._slaDue && r._slaDue > now && r._slaDue - now < 24 * 36e5);
  const breached = open.filter((r) => r._slaDue && r._slaDue < now);
  return {
    total, closed: closed.length, open: open.length, slaRate, slaMet,
    slaEligible: slaEligible.length, avgRes, resP50, resP90, avgFrt, frtP50, frtP90,
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
      if (!r._closed && r._isClosed) continue;
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
    if (r._isClosed) continue;
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
    if (r._isClosed) continue;
    if (!r._slaDue) {
      counts.noSla++;
      continue;
    }
    const ms = r._slaDue.getTime() - now;
    if (ms < 0) counts.breached++;
    else if (ms < 24 * 36e5) counts.due24++;
    else if (ms < 7 * 24 * 36e5) counts.dueWeek++;
    else counts.comfortable++;
  }
  return SLA_RISK_BUCKETS.map((b) => ({ ...b, count: counts[b.key] }));
};

export const slaRiskOf = (r, now = Date.now()) => {
  if (!r._slaDue) return "noSla";
  const ms = r._slaDue.getTime() - now;
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
      if (r._isClosed) continue;
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
    .filter((r) => !r._isClosed && r._created && (now - r._created.getTime()) >= cutoff)
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

export const dailyTrajectory = (rows) => {
  if (!rows || !rows.length) return [];
  let minCreated = null;
  let maxEnd = null;
  const now = new Date();
  for (const r of rows) {
    if (r._created && (!minCreated || r._created < minCreated)) minCreated = r._created;
    const end = r._closed || now;
    if (!maxEnd || end > maxEnd) maxEnd = end;
  }
  if (!minCreated || !maxEnd) return [];
  const start = startOfDay(minCreated);
  const end = startOfDay(maxEnd);
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
    for (const r of rows) {
      if (r._created) {
        const ct = r._created.getTime();
        if (ct >= dayStart && ct < dayEnd) created++;
        if (ct < dayEnd && (!r._closed || r._closed.getTime() >= dayStart)) {
          if (!(!r._closed && r._isClosed)) open++;
        }
      }
      if (r._closed) {
        const xt = r._closed.getTime();
        if (xt >= dayStart && xt < dayEnd) closed++;
      }
    }
    out.push({ date: dayStart, open, created, closed });
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
};

export const weeklyIntakeResolved = (rows) => {
  if (!rows || !rows.length) return [];
  let minDate = null;
  let maxDate = null;
  const now = new Date();
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
    if (r._isClosed || !r._slaDue) continue;
    const due = r._slaDue.getTime();
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
    const eligible = r.made_sla !== "" && r.made_sla != null;
    const created = r._created ? r._created.getTime() : null;
    if (created != null) {
      if (created >= nowStart && created <= now) {
        a.casesNow++;
        if (eligible) { a.slaEligNow++; if (r._madeSla) a.slaMetNow++; }
      } else if (created >= prevStart && created < nowStart) {
        a.casesPrev++;
        if (eligible) { a.slaEligPrev++; if (r._madeSla) a.slaMetPrev++; }
      }
    }
    if (!r._isClosed) {
      a.openCount++;
      if ((r._jiraActiveTickets?.length || 0) > 0) a.openBlockers++;
      if (r._slaDue && r._slaDue.getTime() < now) a.breachedOpen++;
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
