import { priorityRank } from "./enrich.js";
import { priorityColor, isoFromMs, msFromIso } from "./format.js";
import {
  WEEKDAY_NAMES, WEEKDAY_ORDER, PRESETS, AGING_BUCKETS, SLA_RISK_BUCKETS,
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
  const frt = rows.filter((r) => r._frtMs != null);
  const avgFrt = frt.length ? frt.reduce((s, r) => s + r._frtMs, 0) / frt.length : null;
  const now = new Date();
  const atRisk = open.filter((r) => r._slaDue && r._slaDue > now && r._slaDue - now < 24 * 36e5);
  const breached = open.filter((r) => r._slaDue && r._slaDue < now);
  return { total, closed: closed.length, open: open.length, slaRate, slaMet, slaEligible: slaEligible.length, avgRes, avgFrt, atRisk, breached };
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
