import React, { useState, useMemo, useCallback, useRef } from "react";
import Papa from "papaparse";
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  RadialBarChart,
  RadialBar,
  LineChart,
  Line,
  ComposedChart,
  Legend,
  ReferenceArea,
} from "recharts";
import {
  Upload,
  FileSpreadsheet,
  AlertTriangle,
  Clock,
  CheckCircle2,
  XCircle,
  User,
  Sparkles,
  Info,
  TrendingUp,
  Activity,
  ListFilter,
  RotateCcw,
  Loader2,
  ClipboardList,
  Mailbox,
} from "lucide-react";

/* ---------- theme ---------- */
const T = {
  bg: "#F3EEE5",
  surface: "#FBF8F2",
  surfaceAlt: "#EFE8DB",
  ink: "#141311",
  sub: "#5C564A",
  muted: "#8A8270",
  border: "#D9D1BF",
  borderSoft: "#E8E0CE",
  accent: "#B8452C",
  accentSoft: "#E8C6B8",
  ok: "#3D6340",
  okSoft: "#C8D6BF",
  warn: "#B8801C",
  warnSoft: "#EBD3A0",
  danger: "#A23220",
  dangerSoft: "#E7B8AD",
  priorityCritical: "#A23220",
  priorityMajor: "#B8801C",
  priorityMedium: "#3D6340",
  priorityStandard: "#6B7A8F",
};

/* ---------- categorization ---------- */
const CATEGORIES = [
  { name: "Night Audit", kws: ["night audit", "nightaudit", "end of day", "eod ", "audit ran"] },
  { name: "Login & Access", kws: ["login", "log in", "signin", "sign in", "password", "credentials", "unable to log", "cannot log", "locked out", "access denied"] },
  { name: "Email & Notifications", kws: ["email", "e-mail", "confirmation", "receipt", "smtp", "not sending", "not receiving", "notification"] },
  { name: "Reservations & Availability", kws: ["reservation", "booking", "availability", "out of balance", "rooms avail", "stay date", "departure", "arrival", "cancel", "no-show", "block"] },
  { name: "Rates & Pricing", kws: ["rate", "rateplan", "pricing", "discount", "package", "yield"] },
  { name: "Billing & Folio", kws: ["folio", "invoice", "billing", "charge", "credit card", "cc auth", "payment", "refund", "post "] },
  { name: "Reports & Data", kws: ["report", "export", "query", "data missing", "extract", "kpi"] },
  { name: "Integrations & Interfaces", kws: ["integration", "interface", "crs", "sync", "connector", "api ", "hms core", "pms sync"] },
  { name: "Performance & Errors", kws: ["slow", "crash", "frozen", "stuck", "error", "timeout", "hang", "unresponsive", "not responding"] },
  { name: "User & Permissions", kws: ["user", "permission", "role", "security group", "privilege"] },
  { name: "Printing & Hardware", kws: ["print", "printer", "receipt printer", "key encoder", "terminal"] },
];

function categorize(text) {
  if (!text) return "Uncategorized";
  const t = String(text).toLowerCase();
  for (const c of CATEGORIES) if (c.kws.some((k) => t.includes(k))) return c.name;
  return "Other";
}

/* ---------- helpers ---------- */
const parseDate = (v) => {
  if (!v) return null;
  const d = new Date(String(v).replace(" ", "T"));
  return isNaN(d.getTime()) ? null : d;
};

const fmtDuration = (ms) => {
  if (ms == null || isNaN(ms)) return "—";
  const h = ms / 36e5;
  if (h < 1) return `${Math.round(ms / 6e4)}m`;
  if (h < 48) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
};

const parseFirstResponse = (v) => {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v * 1000;
  const s = String(v).trim();
  const n = Number(s);
  if (!isNaN(n) && n > 0) return n > 10000 ? n : n * 1000;
  const m = s.match(/(\d+)[:\s](\d+)[:\s](\d+)/);
  if (m) return (+m[1] * 3600 + +m[2] * 60 + +m[3]) * 1000;
  return null;
};

const priorityRank = (p) => {
  if (!p) return 99;
  const n = parseInt(String(p));
  return isNaN(n) ? 99 : n;
};

const priorityColor = (p) => {
  const r = priorityRank(p);
  return [null, T.priorityCritical, T.priorityMajor, T.priorityMedium, T.priorityStandard][r] || T.muted;
};

const enrichRow = (r) => {
  const created = parseDate(r.sys_created_on);
  const closed = parseDate(r.closed_at);
  const slaDue = parseDate(r.sla_due);
  const resolvedMs = created && closed ? closed - created : null;
  const frtMs = parseFirstResponse(r.first_response_time);
  const isClosed = String(r.state || "").toLowerCase() === "closed";
  const madeSla =
    r.made_sla === true ||
    String(r.made_sla).toLowerCase() === "true" ||
    String(r.made_sla).toLowerCase() === "1" ||
    String(r.made_sla).toLowerCase() === "yes";
  const combinedText = [r.short_description, r.close_notes, r.work_notes, r.case_action_summary]
    .filter(Boolean)
    .join(" ");
  return {
    ...r,
    _created: created,
    _closed: closed,
    _slaDue: slaDue,
    _resolvedMs: resolvedMs,
    _frtMs: frtMs,
    _isClosed: isClosed,
    _madeSla: madeSla,
    _category: categorize(r.short_description + " " + (r.close_notes || "")),
    _combinedText: combinedText,
  };
};

const computeKpis = (rows) => {
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

const topCounts = (rows, getKey, n = 3) => {
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

const priorityMix = (rows) => {
  const groups = {};
  for (const r of rows) {
    const p = r.priority || "Unknown";
    groups[p] = (groups[p] || 0) + 1;
  }
  return Object.entries(groups)
    .map(([priority, count]) => ({ priority, count, color: priorityColor(priority) }))
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority));
};

const percentile = (sortedAsc, p) => {
  if (!sortedAsc.length) return null;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const rank = (p / 100) * (sortedAsc.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (rank - lo);
};

const resolutionDistribution = (rows) => {
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

const WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const startOfDay = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

/* ---------- date-range filters ---------- */
const PRESETS = [
  { key: "all", label: "All-time" },
  { key: "ytd", label: "YTD" },
  { key: "qtr", label: "Last quarter (90d)" },
  { key: "30d", label: "Last 30 days" },
  { key: "7d", label: "Last 7 days" },
  { key: "custom", label: "Custom" },
];

const presetRange = (key, refDate = new Date()) => {
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

const matchPreset = (from, to) => {
  if (from == null && to == null) return "all";
  for (const p of PRESETS) {
    if (p.key === "all" || p.key === "custom") continue;
    const r = presetRange(p.key);
    if (Math.abs(r.from - from) < 60 * 1000 && Math.abs(r.to - to) < 60 * 1000) return p.key;
  }
  return "custom";
};

const isoFromMs = (ms) => {
  if (ms == null) return "";
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const msFromIso = (iso, endOfDay = false) => {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d, 0, 0, 0, 0);
  return endOfDay ? dt.getTime() + 864e5 - 1 : dt.getTime();
};

const filterRowsByDate = (rows, from, to, fieldKey) => {
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

const previousWindow = (from, to) => {
  if (from == null || to == null) return { from: null, to: null };
  const len = to - from;
  return { from: from - len - 1, to: from - 1 };
};

const PAGE_KEYS = ["overview", "sla", "trends", "mix", "team", "ai", "cases"];

const parseUrlFilters = () => {
  if (typeof window === "undefined") return {};
  const p = new URLSearchParams(window.location.search);
  const fromIso = p.get("from");
  const toIso = p.get("to");
  const page = p.get("page");
  return {
    from: msFromIso(fromIso, false),
    to: msFromIso(toIso, true),
    field: p.get("field") === "closed" ? "_closed" : "_created",
    analyst: p.get("analyst") || null,
    compare: p.get("compare") === "1",
    page: PAGE_KEYS.includes(page) ? page : null,
  };
};

const writeUrlFilters = ({ from, to, field, analyst, compare, page }) => {
  if (typeof window === "undefined") return;
  const p = new URLSearchParams();
  if (page && page !== "overview") p.set("page", page);
  if (from != null) p.set("from", isoFromMs(from));
  if (to != null) p.set("to", isoFromMs(to));
  if (field === "_closed") p.set("field", "closed");
  if (analyst && analyst !== "__all__") p.set("analyst", analyst);
  if (compare) p.set("compare", "1");
  const qs = p.toString();
  const url = window.location.pathname + (qs ? "?" + qs : "");
  window.history.replaceState(null, "", url);
};

const weekdayAnalytics = (rows) => {
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

const AGING_BUCKETS = [
  { name: "0–7d", min: 0, max: 7 },
  { name: "8–30d", min: 8, max: 30 },
  { name: "31–90d", min: 31, max: 90 },
  { name: "90d+", min: 91, max: Infinity },
];

const agingBuckets = (rows) => {
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

const SLA_RISK_BUCKETS = [
  { key: "breached", label: "Breached", desc: "SLA already passed", color: "#A23220" },
  { key: "due24", label: "Due < 24h", desc: "SLA within next 24h", color: "#B8452C" },
  { key: "dueWeek", label: "Due this week", desc: "SLA within 1–7 days", color: "#B8801C" },
  { key: "comfortable", label: "Comfortable", desc: "SLA more than 7 days out", color: "#3D6340" },
  { key: "noSla", label: "No SLA", desc: "No SLA deadline recorded", color: "#8A8270" },
];

const slaRiskSegments = (rows) => {
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

const slaRiskOf = (r, now = Date.now()) => {
  if (!r._slaDue) return "noSla";
  const ms = r._slaDue.getTime() - now;
  if (ms < 0) return "breached";
  if (ms < 24 * 36e5) return "due24";
  if (ms < 7 * 24 * 36e5) return "dueWeek";
  return "comfortable";
};

const ageBucketOf = (r, now = Date.now()) => {
  if (!r._created) return null;
  const days = Math.floor((now - r._created.getTime()) / 864e5);
  return AGING_BUCKETS.findIndex((b) => days >= b.min && days <= b.max);
};

const openByAssigneeAge = (members) => {
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

const stuckCases = (rows, thresholdDays = 30) => {
  const now = Date.now();
  const cutoff = thresholdDays * 864e5;
  return rows
    .filter((r) => !r._isClosed && r._created && (now - r._created.getTime()) >= cutoff)
    .sort((a, b) => a._created - b._created);
};

const hourHeatmap = (rows) => {
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

const startOfMonday = (d) => {
  const x = startOfDay(d);
  const offset = (x.getDay() + 6) % 7; // Mon=0, Sun=6
  x.setDate(x.getDate() - offset);
  return x;
};

const dailyTrajectory = (rows) => {
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

const weeklyIntakeResolved = (rows) => {
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

const workloadConcentration = (members) => {
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

/* ---------- component ---------- */
export default function KpiAnalyzer() {
  const initialUrl = useMemo(() => parseUrlFilters(), []);
  const [rows, setRows] = useState(null);
  const [filename, setFilename] = useState("");
  const [analyst, setAnalyst] = useState(initialUrl.analyst || "__all__");
  const [view, setView] = useState(initialUrl.analyst ? "individual" : "team");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [aiState, setAiState] = useState({ loading: false, result: null, error: null });
  const [memberAi, setMemberAi] = useState({});
  const [dateRange, setDateRange] = useState({
    preset: matchPreset(initialUrl.from ?? null, initialUrl.to ?? null),
    from: initialUrl.from ?? null,
    to: initialUrl.to ?? null,
    field: initialUrl.field || "_created",
  });
  const [compareOn, setCompareOn] = useState(!!initialUrl.compare);
  const [page, setPage] = useState(initialUrl.page || "overview");
  const inputRef = useRef(null);

  /* sync filters to the URL whenever they change */
  React.useEffect(() => {
    writeUrlFilters({
      from: dateRange.from,
      to: dateRange.to,
      field: dateRange.field,
      analyst,
      compare: compareOn && dateRange.from != null,
      page,
    });
  }, [dateRange, analyst, compareOn, page]);

  /* if user is on Team page but scope flips to Individual, fall back */
  React.useEffect(() => {
    if (view === "individual" && page === "team") setPage("overview");
  }, [view, page]);

  /* ---------- ingest ---------- */
  const handleFile = async (file) => {
    setUploading(true);
    setUploadError("");
    try {
      const ext = file.name.split(".").pop().toLowerCase();
      let data = [];
      if (ext === "csv") {
        const text = await file.text();
        const parsed = Papa.parse(text, { header: true, skipEmptyLines: true, dynamicTyping: false });
        data = parsed.data;
      } else if (ext === "xlsx" || ext === "xls") {
        throw new Error("Excel files are not supported. Export your ServiceNow case list as CSV and try again.");
      } else {
        throw new Error("Please upload a CSV file.");
      }
      if (!data.length) throw new Error("No rows found in the file.");
      const normalized = data.map((r) => {
        const o = {};
        for (const k of Object.keys(r)) o[String(k).trim()] = r[k];
        return o;
      });
      setRows(normalized);
      setFilename(file.name);
      setAnalyst("__all__");
      setView("team");
      setDateRange({ preset: "all", from: null, to: null, field: "_created" });
      setCompareOn(false);
      setPage("overview");
      setAiState({ loading: false, result: null, error: null });
      setMemberAi({});
    } catch (e) {
      setUploadError(e.message || "Could not parse file.");
    } finally {
      setUploading(false);
    }
  };

  const reset = () => {
    setRows(null);
    setFilename("");
    setAnalyst("__all__");
    setView("team");
    setDateRange({ preset: "all", from: null, to: null, field: "_created" });
    setCompareOn(false);
    setAiState({ loading: false, result: null, error: null });
    setMemberAi({});
    if (inputRef.current) inputRef.current.value = "";
  };

  /* ---------- derived ---------- */
  const analysts = useMemo(() => {
    if (!rows) return [];
    const set = new Map();
    for (const r of rows) {
      const a = r.assigned_to || "Unassigned";
      set.set(a, (set.get(a) || 0) + 1);
    }
    return [...set.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const enrichedAll = useMemo(() => (rows ? rows.map(enrichRow) : []), [rows]);

  // Analyst-filtered, date-UNfiltered. Used by TrajectoryBlock so the longitudinal
  // arc stays intact; everything else uses `enriched` below.
  const enrichedAnalyst = useMemo(() => {
    if (analyst === "__all__") return enrichedAll;
    return enrichedAll.filter((r) => (r.assigned_to || "Unassigned") === analyst);
  }, [enrichedAll, analyst]);

  const enriched = useMemo(() => filterRowsByDate(enrichedAnalyst, dateRange.from, dateRange.to, dateRange.field),
    [enrichedAnalyst, dateRange]);

  const compareWindow = useMemo(() => {
    if (!compareOn || dateRange.from == null || dateRange.to == null) return null;
    return previousWindow(dateRange.from, dateRange.to);
  }, [compareOn, dateRange]);

  const compareEnriched = useMemo(() => {
    if (!compareWindow) return null;
    return filterRowsByDate(enrichedAnalyst, compareWindow.from, compareWindow.to, dateRange.field);
  }, [enrichedAnalyst, compareWindow, dateRange.field]);

  const kpis = useMemo(() => computeKpis(enriched), [enriched]);
  const compareKpis = useMemo(() => (compareEnriched ? computeKpis(compareEnriched) : null), [compareEnriched]);

  // Team members: unfiltered (for trajectory) and filtered (for everything else).
  const teamMembersAll = useMemo(() => {
    const groups = new Map();
    for (const r of enrichedAll) {
      const name = r.assigned_to || "Unassigned";
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(r);
    }
    const out = [];
    for (const [name, list] of groups.entries()) {
      out.push({ name, rows: list });
    }
    return out;
  }, [enrichedAll]);

  const teamMembers = useMemo(() => {
    const out = teamMembersAll.map((m) => {
      const list = filterRowsByDate(m.rows, dateRange.from, dateRange.to, dateRange.field);
      return {
        name: m.name,
        rows: list,
        kpis: computeKpis(list),
        topCategories: topCounts(list, (r) => r._category, 3),
        topAccounts: topCounts(list, (r) => r.account, 3),
        topProducts: topCounts(list, (r) => r.product_line, 3),
        priorityMix: priorityMix(list),
      };
    });
    return out.sort((a, b) => b.kpis.total - a.kpis.total);
  }, [teamMembersAll, dateRange]);

  const compareTeamKpis = useMemo(() => {
    if (!compareWindow) return null;
    const all = teamMembersAll.flatMap((m) =>
      filterRowsByDate(m.rows, compareWindow.from, compareWindow.to, dateRange.field)
    );
    return computeKpis(all);
  }, [teamMembersAll, compareWindow, dateRange.field]);

  const priorityData = useMemo(() => {
    const groups = {};
    for (const r of enriched) {
      const p = r.priority || "Unknown";
      groups[p] = groups[p] || { priority: p, total: 0, closed: 0, sla_met: 0, sla_total: 0, res_sum: 0, res_n: 0 };
      groups[p].total++;
      if (r._isClosed) groups[p].closed++;
      if (r.made_sla !== "" && r.made_sla != null) {
        groups[p].sla_total++;
        if (r._madeSla) groups[p].sla_met++;
      }
      if (r._resolvedMs != null) {
        groups[p].res_sum += r._resolvedMs;
        groups[p].res_n++;
      }
    }
    return Object.values(groups)
      .map((g) => ({
        ...g,
        sla_pct: g.sla_total ? (g.sla_met / g.sla_total) * 100 : null,
        avg_res_h: g.res_n ? g.res_sum / g.res_n / 36e5 : null,
        color: priorityColor(g.priority),
      }))
      .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority));
  }, [enriched]);

  const categoryData = useMemo(() => {
    const groups = {};
    for (const r of enriched) {
      groups[r._category] = (groups[r._category] || 0) + 1;
    }
    return Object.entries(groups)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [enriched]);

  const accountData = useMemo(() => {
    const groups = {};
    for (const r of enriched) {
      const a = r.account || "Unknown";
      groups[a] = (groups[a] || 0) + 1;
    }
    return Object.entries(groups)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [enriched]);

  const productData = useMemo(() => {
    const groups = {};
    for (const r of enriched) {
      const p = r.product_line || "Unknown";
      groups[p] = (groups[p] || 0) + 1;
    }
    return Object.entries(groups)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [enriched]);

  /* ---------- AI insights ---------- */
  const analyzeCases = async (rows, label) => {
    const sample = rows.slice(0, 50).map((r) => ({
      number: r.number,
      priority: r.priority,
      state: r.state,
      product: r.product_line,
      category: r._category,
      short_description: r.short_description,
      close_notes: r.close_notes ? String(r.close_notes).slice(0, 400) : "",
      resolution_hours: r._resolvedMs != null ? +(r._resolvedMs / 36e5).toFixed(1) : null,
      made_sla: r._madeSla,
    }));
    const localKpis = computeKpis(rows);
    const cats = topCounts(rows, (r) => r._category, 6);
    const prompt = `You are analyzing ServiceNow support cases for a Product Support Analyst working on Infor HMS and Epitome PMS for DoD lodging properties.

Scope: ${label}. Total cases in view: ${rows.length}. SLA compliance in view: ${localKpis.slaRate != null ? localKpis.slaRate.toFixed(1) + "%" : "n/a"}. Categories detected: ${cats.map((c) => c.name + "(" + c.count + ")").join(", ")}.

Here is a sample of up to 50 cases as JSON:
${JSON.stringify(sample, null, 2)}

Respond ONLY with a JSON object, no markdown fences, with these keys:
{
  "themes": [ { "title": "short theme name", "description": "1-2 sentence explanation grounded in the data" } ],
  "recurring_issues": [ { "issue": "specific recurring issue", "evidence": "what in the data shows this" } ],
  "skill_opportunities": [ { "area": "skill area", "why": "why this would help based on the cases" } ],
  "kb_gaps": [ { "gap": "potential knowledge base gap", "why": "evidence from the cases" } ],
  "watch_outs": [ "short string of a risk or anti-pattern to watch" ]
}

Be specific, reference real patterns (e.g., night audit issues, CRS sync) rather than generic advice. Keep each array to 3-5 items max.`;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1500,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await res.json();
    const text = (data.content || [])
      .map((i) => (i.type === "text" ? i.text : ""))
      .join("")
      .trim();
    const clean = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
    return JSON.parse(clean);
  };

  const runAiAnalysis = async () => {
    setAiState({ loading: true, result: null, error: null });
    try {
      const label = analyst === "__all__" ? "all analysts" : analyst;
      const parsed = await analyzeCases(enriched, label);
      setAiState({ loading: false, result: parsed, error: null });
    } catch (e) {
      setAiState({ loading: false, result: null, error: e.message || "AI analysis failed." });
    }
  };

  const runMemberAi = async (member) => {
    setMemberAi((s) => ({ ...s, [member.name]: { loading: true, result: null, error: null } }));
    try {
      const parsed = await analyzeCases(member.rows, member.name);
      setMemberAi((s) => ({ ...s, [member.name]: { loading: false, result: parsed, error: null } }));
    } catch (e) {
      setMemberAi((s) => ({ ...s, [member.name]: { loading: false, result: null, error: e.message || "AI analysis failed." } }));
    }
  };

  const drillIntoMember = (name) => {
    setAnalyst(name);
    setView("individual");
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  /* ---------- UI ---------- */
  if (!rows) {
    return (
      <Shell>
        <UploadScreen onPick={handleFile} uploading={uploading} error={uploadError} inputRef={inputRef} />
      </Shell>
    );
  }

  return (
    <Shell>
      <Header
        filename={filename}
        total={rows.length}
        analyst={analyst}
        setAnalyst={setAnalyst}
        analysts={analysts}
        reset={reset}
        view={view}
        setView={setView}
      />

      <FilterBar
        range={dateRange}
        onRangeChange={setDateRange}
        compareOn={compareOn}
        onCompareChange={setCompareOn}
        compareWindow={compareWindow}
        sliceCount={view === "team" ? teamMembers.reduce((s, m) => s + m.kpis.total, 0) : kpis.total}
      />

      <PageTabs page={page} onPageChange={setPage} scope={view} />

      {view === "team" ? (
        <TeamView
          page={page}
          members={teamMembers}
          allMembers={teamMembersAll}
          compareTotals={compareTeamKpis}
          compareWindow={compareWindow}
          highlightRange={dateRange}
          kpis={kpis}
          priorityData={priorityData}
          categoryData={categoryData}
          accountData={accountData}
          productData={productData}
          enriched={enriched}
          enrichedAnalyst={enrichedAnalyst}
          aiState={aiState}
          runAiAnalysis={runAiAnalysis}
          memberAi={memberAi}
          runMemberAi={runMemberAi}
          drillIntoMember={drillIntoMember}
        />
      ) : (
        <>
      {page === "overview" && (
        <Section title="At a Glance" subtitle="Top-line numbers for the selected analyst. Use this as the starting frame before drilling into any other tab.">
          <KpiRow kpis={kpis} compareKpis={compareKpis} compareWindow={compareWindow} />
        </Section>
      )}

      {page === "sla" && (
        <>
          <Section title="SLA Performance" subtitle="The headline accountability metric: are cases being resolved within their contractual SLA window? The radial shows the overall hit rate, the bar chart breaks it down by priority, and the list at the bottom calls out open cases approaching or already past their SLA deadline.">
            <SlaBlock kpis={kpis} priorityData={priorityData} enriched={enriched} />
          </Section>
          <Section title="Open Backlog" subtitle="What's still on this analyst's plate, framed by SLA pressure rather than calendar age. The SLA-risk chart shows what to work on next; the stuck-cases list surfaces individual cases that have been sitting longer than 30 days.">
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <SlaRiskBlock rows={enriched} />
              <StuckCasesList rows={enriched} />
            </div>
          </Section>
        </>
      )}

      {page === "trends" && (
        <>
          <Section title="Trends Over Time" subtitle="How the backlog has moved over time, and whether intake is outpacing resolution week to week. The daily line shows the open-case count from the oldest record to today; the weekly bars compare new cases versus resolved ones to surface backlog growth or recovery. The shaded band marks the active date filter, if any.">
            <TrajectoryBlock rows={enrichedAnalyst} highlightRange={dateRange.from != null ? dateRange : null} />
          </Section>
          <Section title="Workload Cadence" subtitle="How workload distributes across the week. The first chart shows the average number of cases open on each weekday, the second shows when new cases get created, and the heatmap pinpoints the exact weekday-and-hour slots where intake concentrates. Useful for spotting Monday spikes, weekend backlogs, and shifts in staffing needs. Click any tile to see the cases created in that slot.">
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <WeekdayBlock rows={enriched} />
              <IntakeHeatmap rows={enriched} />
            </div>
          </Section>
        </>
      )}

      {page === "mix" && (
        <>
          <Section title="Priority Analysis" subtitle="How case priority shapes both volume and resolution time. Helps confirm whether high-priority work is actually being handled faster than lower-priority work, and where the biggest workload sits.">
            <PriorityBlock priorityData={priorityData} rows={enriched} />
          </Section>
          <Section title="Case Categorization" subtitle="What kinds of problems are showing up in this queue. Categories are auto-derived by scanning short descriptions and resolution notes for keyword patterns (Night Audit, Login & Access, Billing & Folio, etc.). The keyword cloud surfaces the most-mentioned terms in resolution notes — a quick read on the language of the work.">
            <CategoryBlock categoryData={categoryData} enriched={enriched} />
          </Section>
          <Section title="Accounts & Products" subtitle="Which customers and product lines drive the most case volume. Helps spot account concentration risk (one customer dominating the queue) and recurring product hotspots that might warrant deeper investigation.">
            <AccountProductBlock accountData={accountData} productData={productData} />
          </Section>
        </>
      )}

      {page === "ai" && (
        <>
          <Section title="Deep Pattern Analysis" subtitle="An AI-powered qualitative read on the case data — themes, recurring issues, knowledge-base gaps, skill-development opportunities, and things to watch out for. Samples up to 50 cases (with sensitive data anonymized) and sends them to Claude for analysis. Click run when you want a narrative summary the charts can't give you.">
            <AiBlock state={aiState} run={runAiAnalysis} hasData={enriched.length > 0} />
          </Section>
          <Section title="Customer Surveys" subtitle="Placeholder for customer satisfaction data. Will populate automatically once ServiceNow survey responses are available in the export.">
            <SurveyPlaceholder />
          </Section>
        </>
      )}

      {page === "cases" && (
        <Section title="Case Register" subtitle="The full underlying case list — every record from the uploaded export. Sort by any column or search by keyword to inspect the individual cases behind the metrics above.">
          <CaseTable rows={enriched} />
        </Section>
      )}
        </>
      )}

      <Footer />
    </Shell>
  );
}

/* ================= Layout ================= */
function Shell({ children }) {
  return (
    <div style={{ background: T.bg, color: T.ink, minHeight: "100vh" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=DM+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap');
        .display { font-family: 'Fraunces', Georgia, serif; font-optical-sizing: auto; letter-spacing: -0.01em; }
        .body { font-family: 'DM Sans', system-ui, sans-serif; }
        .mono { font-family: 'JetBrains Mono', ui-monospace, monospace; font-feature-settings: "tnum"; }
        .eyebrow { font-family: 'JetBrains Mono', monospace; text-transform: uppercase; letter-spacing: 0.14em; font-size: 10px; font-weight: 500; }
        .hairline { border-top: 1px solid ${T.border}; }
        .hoverlift { transition: transform 0.15s ease, box-shadow 0.15s ease; }
        .hoverlift:hover { transform: translateY(-1px); }
        .scrollbar::-webkit-scrollbar { width: 8px; height: 8px; }
        .scrollbar::-webkit-scrollbar-track { background: ${T.surfaceAlt}; }
        .scrollbar::-webkit-scrollbar-thumb { background: ${T.border}; border-radius: 4px; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
      <div className="body" style={{ maxWidth: 1280, margin: "0 auto", padding: "24px 32px 80px" }}>{children}</div>
    </div>
  );
}

function Section({ title, subtitle, children }) {
  return (
    <section style={{ marginTop: title ? 48 : 24 }}>
      {title && (
        <div style={{ marginBottom: 16 }}>
          <div className="display" style={{ fontSize: 28, fontWeight: 500, lineHeight: 1.1 }}>{title}</div>
          {subtitle && <div style={{ color: T.sub, marginTop: 6, fontSize: 14, maxWidth: 680 }}>{subtitle}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

function Card({ children, style, className = "" }) {
  return (
    <div
      className={className}
      style={{
        background: T.surface,
        border: `1px solid ${T.borderSoft}`,
        borderRadius: 6,
        padding: 20,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/* ================= Upload ================= */
function UploadScreen({ onPick, uploading, error, inputRef }) {
  const [drag, setDrag] = useState(false);
  return (
    <div style={{ minHeight: "80vh", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 32 }}>
      <div style={{ textAlign: "center", maxWidth: 560 }}>
        <div className="eyebrow" style={{ color: T.accent, marginBottom: 12 }}>Product Support · KPI Analyzer</div>
        <div className="display" style={{ fontSize: 56, fontWeight: 500, lineHeight: 1.02, letterSpacing: "-0.025em" }}>
          Your ServiceNow cases,<br/><em style={{ fontStyle: "italic", color: T.accent }}>read clearly</em>.
        </div>
        <div style={{ color: T.sub, marginTop: 16, fontSize: 15, lineHeight: 1.5 }}>
          Drop a ServiceNow case export and get an analyst-grade breakdown of SLA performance, priority mix,
          and the kinds of problems you are actually solving.
        </div>
      </div>

      <label
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files[0];
          if (f) onPick(f);
        }}
        className="hoverlift"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          gap: 12,
          width: 520,
          maxWidth: "90vw",
          padding: "48px 32px",
          borderRadius: 8,
          border: `1.5px dashed ${drag ? T.accent : T.border}`,
          background: drag ? T.accentSoft + "55" : T.surface,
          cursor: "pointer",
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files[0];
            if (f) onPick(f);
          }}
        />
        {uploading ? (
          <>
            <Loader2 size={28} style={{ color: T.accent, animation: "spin 1s linear infinite" }} />
            <div className="eyebrow" style={{ color: T.sub }}>Parsing…</div>
          </>
        ) : (
          <>
            <Upload size={28} style={{ color: T.accent }} />
            <div className="display" style={{ fontSize: 18, fontWeight: 500 }}>Drop a CSV here</div>
            <div style={{ color: T.sub, fontSize: 13 }}>or click to browse</div>
          </>
        )}
      </label>

      {error && (
        <div style={{ color: T.danger, fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 32, color: T.muted, fontSize: 12, flexWrap: "wrap", justifyContent: "center" }}>
        <span>• Expects ServiceNow `case` table export</span>
        <span>• Data stays in your browser</span>
      </div>
    </div>
  );
}

/* ================= Header ================= */
function Header({ filename, total, analyst, setAnalyst, analysts, reset, view, setView }) {
  const isIndividual = view === "individual";
  return (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 16, paddingBottom: 20, borderBottom: `1px solid ${T.border}` }}>
      <div>
        <div className="eyebrow" style={{ color: T.accent }}>Product Support · KPI Analyzer</div>
        <div className="display" style={{ fontSize: 40, fontWeight: 500, letterSpacing: "-0.02em", marginTop: 4, lineHeight: 1 }}>
          Case Performance Report
        </div>
        <div style={{ color: T.sub, fontSize: 13, marginTop: 8, display: "flex", alignItems: "center", gap: 10 }}>
          <FileSpreadsheet size={14} />
          <span className="mono">{filename}</span>
          <span>·</span>
          <span className="mono">{total.toLocaleString()} rows</span>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div role="tablist" style={{ display: "inline-flex", background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, padding: 3 }}>
          {[
            { id: "team", label: "Team Overview" },
            { id: "individual", label: "Individual" },
          ].map((opt) => {
            const active = view === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => {
                  setView(opt.id);
                  if (opt.id === "team") setAnalyst("__all__");
                }}
                style={{
                  padding: "6px 14px",
                  background: active ? T.ink : "transparent",
                  color: active ? T.surface : T.sub,
                  border: "none",
                  borderRadius: 4,
                  fontFamily: "DM Sans, sans-serif",
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        <div style={{ position: "relative", opacity: isIndividual ? 1 : 0.5 }}>
          <User size={14} style={{ position: "absolute", left: 12, top: 10, color: T.muted }} />
          <select
            value={analyst}
            disabled={!isIndividual}
            onChange={(e) => setAnalyst(e.target.value)}
            style={{
              appearance: "none",
              padding: "8px 32px 8px 32px",
              background: T.surface,
              border: `1px solid ${T.border}`,
              borderRadius: 6,
              fontFamily: "DM Sans, sans-serif",
              fontSize: 13,
              color: T.ink,
              cursor: isIndividual ? "pointer" : "not-allowed",
              minWidth: 220,
            }}
          >
            <option value="__all__">All analysts ({analysts.reduce((s, [, c]) => s + c, 0)})</option>
            {analysts.map(([name, count]) => (
              <option key={name} value={name}>{name} ({count})</option>
            ))}
          </select>
          <ListFilter size={14} style={{ position: "absolute", right: 10, top: 10, color: T.muted, pointerEvents: "none" }} />
        </div>
        <button
          onClick={reset}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 14px",
            background: "transparent",
            border: `1px solid ${T.border}`,
            borderRadius: 6,
            fontFamily: "DM Sans, sans-serif",
            fontSize: 13,
            color: T.ink,
            cursor: "pointer",
          }}
        >
          <RotateCcw size={13} /> New file
        </button>
      </div>
    </div>
  );
}

/* ================= Filter Bar ================= */
function FilterBar({ range, onRangeChange, compareOn, onCompareChange, compareWindow, sliceCount }) {
  const setPreset = (key) => {
    if (key === "custom") {
      onRangeChange({ ...range, preset: "custom" });
      return;
    }
    const r = presetRange(key);
    onRangeChange({ preset: key, from: r.from, to: r.to, field: range.field });
  };
  const setField = (field) => onRangeChange({ ...range, field });
  const setFrom = (iso) => {
    const ms = msFromIso(iso, false);
    onRangeChange({ ...range, preset: "custom", from: ms });
  };
  const setTo = (iso) => {
    const ms = msFromIso(iso, true);
    onRangeChange({ ...range, preset: "custom", to: ms });
  };
  const compareDisabled = range.from == null || range.to == null;
  const compareLabel = compareWindow && compareWindow.from != null
    ? `vs. ${isoFromMs(compareWindow.from)} → ${isoFromMs(compareWindow.to)}`
    : null;

  const inputStyle = {
    border: `1px solid ${T.border}`,
    background: T.surface,
    color: T.ink,
    borderRadius: 4,
    padding: "5px 8px",
    fontSize: 12,
    fontFamily: "JetBrains Mono, monospace",
  };

  return (
    <div style={{ marginTop: 14, padding: "10px 14px", border: `1px solid ${T.borderSoft}`, borderRadius: 6, background: T.surface, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12, fontSize: 12 }}>
      <span className="eyebrow" style={{ color: T.muted }}>Filter</span>

      <select
        value={range.preset}
        onChange={(e) => setPreset(e.target.value)}
        style={{ ...inputStyle, fontFamily: "DM Sans, sans-serif", padding: "5px 10px", cursor: "pointer" }}
      >
        {PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
      </select>

      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ color: T.muted }}>from</span>
        <input type="date" value={isoFromMs(range.from)} onChange={(e) => setFrom(e.target.value)} style={inputStyle} />
        <span style={{ color: T.muted }}>to</span>
        <input type="date" value={isoFromMs(range.to)} onChange={(e) => setTo(e.target.value)} style={inputStyle} />
      </div>

      <div style={{ display: "inline-flex", background: T.surfaceAlt, border: `1px solid ${T.border}`, borderRadius: 4, padding: 2 }}>
        {[{ k: "_created", label: "by Created" }, { k: "_closed", label: "by Closed" }].map((opt) => {
          const active = range.field === opt.k;
          return (
            <button
              key={opt.k}
              onClick={() => setField(opt.k)}
              style={{
                padding: "4px 10px",
                background: active ? T.ink : "transparent",
                color: active ? T.surface : T.sub,
                border: "none",
                borderRadius: 3,
                fontFamily: "DM Sans, sans-serif",
                fontSize: 12,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      <label style={{ display: "inline-flex", alignItems: "center", gap: 6, color: compareDisabled ? T.muted : T.ink, cursor: compareDisabled ? "not-allowed" : "pointer" }}>
        <input
          type="checkbox"
          checked={compareOn && !compareDisabled}
          disabled={compareDisabled}
          onChange={(e) => onCompareChange(e.target.checked)}
        />
        <span>Compare to previous period</span>
      </label>

      {compareOn && compareLabel && (
        <span className="mono" style={{ color: T.sub, fontSize: 11 }}>{compareLabel}</span>
      )}

      <div style={{ marginLeft: "auto", color: T.sub, fontSize: 11 }} className="mono">
        {sliceCount.toLocaleString()} cases in slice
      </div>
    </div>
  );
}

/* ================= Page Tabs ================= */
const PAGE_DEFS = [
  { key: "overview",  label: "Overview" },
  { key: "sla",       label: "SLA & Backlog" },
  { key: "trends",    label: "Trends" },
  { key: "mix",       label: "Mix" },
  { key: "team",      label: "Team",     teamOnly: true },
  { key: "ai",        label: "AI" },
  { key: "cases",     label: "Cases" },
];

function PageTabs({ page, onPageChange, scope }) {
  const tabs = PAGE_DEFS.filter((t) => !t.teamOnly || scope === "team");
  return (
    <div role="tablist" style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 4, borderBottom: `1px solid ${T.border}` }}>
      {tabs.map((t) => {
        const active = page === t.key;
        return (
          <button
            key={t.key}
            role="tab"
            onClick={() => onPageChange(t.key)}
            style={{
              padding: "10px 16px",
              background: "transparent",
              color: active ? T.ink : T.sub,
              border: "none",
              borderBottom: `2px solid ${active ? T.accent : "transparent"}`,
              marginBottom: -1,
              fontFamily: "DM Sans, sans-serif",
              fontSize: 13,
              fontWeight: active ? 600 : 500,
              cursor: "pointer",
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/* ================= Team View ================= */
const SLA_COLOR = (rate) =>
  rate == null ? T.muted : rate >= 95 ? T.ok : rate >= 85 ? T.warn : T.danger;

function TeamView({ page, members, allMembers, compareTotals, compareWindow, highlightRange, kpis, priorityData, categoryData, accountData, productData, enriched, enrichedAnalyst, aiState, runAiAnalysis, memberAi, runMemberAi, drillIntoMember }) {
  const [sort, setSort] = useState({ key: "total", dir: "desc" });

  const sorted = useMemo(() => {
    const get = (m) => {
      switch (sort.key) {
        case "name": return m.name.toLowerCase();
        case "total": return m.kpis.total;
        case "open": return m.kpis.open;
        case "sla": return m.kpis.slaRate ?? -1;
        case "avgRes": return m.kpis.avgRes ?? Infinity;
        case "avgFrt": return m.kpis.avgFrt ?? Infinity;
        case "atRisk": return m.kpis.atRisk.length;
        case "breached": return m.kpis.breached.length;
        default: return 0;
      }
    };
    const arr = [...members];
    arr.sort((a, b) => {
      const av = get(a);
      const bv = get(b);
      if (av < bv) return sort.dir === "asc" ? -1 : 1;
      if (av > bv) return sort.dir === "asc" ? 1 : -1;
      return 0;
    });
    return arr;
  }, [members, sort]);

  const headers = [
    { key: "name", label: "Analyst", align: "left" },
    { key: "total", label: "Cases", align: "right" },
    { key: "open", label: "Open", align: "right" },
    { key: "sla", label: "SLA %", align: "right" },
    { key: "avgRes", label: "Avg Resolution", align: "right" },
    { key: "avgFrt", label: "Avg FRT", align: "right" },
    { key: "atRisk", label: "At Risk", align: "right" },
    { key: "breached", label: "Breached", align: "right" },
  ];

  const allRows = useMemo(() => members.flatMap((m) => m.rows), [members]);
  const trajectoryRows = useMemo(() => (allMembers ? allMembers.flatMap((m) => m.rows) : allRows), [allMembers, allRows]);
  const totals = useMemo(() => computeKpis(allRows), [allRows]);

  return (
    <>
      {page === "overview" && (
        <Section title="Team at a Glance" subtitle="Top-line numbers across every analyst with assigned cases. Use this row as the starting frame for everything below — leaderboard, cadence, and per-member profiles.">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
            <Card className="hoverlift">
              <div className="eyebrow" style={{ color: T.muted }}>Team size</div>
              <div className="display mono" style={{ fontSize: 40, fontWeight: 500, marginTop: 10, color: T.ink, lineHeight: 1 }}>
                {members.length}
              </div>
              <div style={{ color: T.sub, fontSize: 12, marginTop: 8 }}>analysts with assigned cases</div>
            </Card>
            <Card className="hoverlift">
              <div className="eyebrow" style={{ color: T.muted }}>Total cases</div>
              <div className="display mono" style={{ fontSize: 40, fontWeight: 500, marginTop: 10, color: T.ink, lineHeight: 1 }}>
                {totals.total.toLocaleString()}
              </div>
              <div style={{ color: T.sub, fontSize: 12, marginTop: 8 }}>{totals.closed} closed · {totals.open} open</div>
              {compareTotals && (
                <DeltaLine text={fmtDeltaCount(totals.total, compareTotals.total)} color={deltaColor(totals.total - compareTotals.total, "up")} />
              )}
            </Card>
            <Card className="hoverlift">
              <div className="eyebrow" style={{ color: T.muted }}>Team SLA</div>
              <div className="display mono" style={{ fontSize: 40, fontWeight: 500, marginTop: 10, color: SLA_COLOR(totals.slaRate), lineHeight: 1 }}>
                {totals.slaRate == null ? "—" : `${totals.slaRate.toFixed(1)}%`}
              </div>
              <div style={{ color: T.sub, fontSize: 12, marginTop: 8 }}>{totals.slaMet} / {totals.slaEligible} within SLA</div>
              {compareTotals && (
                <DeltaLine text={fmtDeltaPct(totals.slaRate, compareTotals.slaRate)} color={deltaColor((totals.slaRate ?? 0) - (compareTotals.slaRate ?? 0), "up")} />
              )}
            </Card>
            <Card className="hoverlift">
              <div className="eyebrow" style={{ color: T.muted }}>Open at risk</div>
              <div className="display mono" style={{ fontSize: 40, fontWeight: 500, marginTop: 10, color: totals.breached.length ? T.danger : totals.atRisk.length ? T.warn : T.ok, lineHeight: 1 }}>
                {totals.breached.length + totals.atRisk.length}
              </div>
              <div style={{ color: T.sub, fontSize: 12, marginTop: 8 }}>{totals.breached.length} breached · {totals.atRisk.length} due in 24h</div>
              {compareTotals && (
                <DeltaLine
                  text={fmtDeltaCount(totals.atRisk.length + totals.breached.length, compareTotals.atRisk.length + compareTotals.breached.length)}
                  color={deltaColor((totals.atRisk.length + totals.breached.length) - (compareTotals.atRisk.length + compareTotals.breached.length), "down")}
                />
              )}
            </Card>
          </div>
        </Section>
      )}

      {page === "sla" && (
        <>
          <Section title="SLA Performance" subtitle="Team-wide SLA hit rate, broken down by priority, with the cases nearest to (or past) their deadline.">
            <SlaBlock kpis={kpis} priorityData={priorityData} enriched={enriched} />
          </Section>
          <Section title="Open Backlog" subtitle="Open cases across the team, sliced by who's holding them and how long they've been open. The stacked bars show whose queue is graying; the stuck-cases list calls out the actual cases sitting over 30 days, with assignee.">
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <AssigneeAgingBlock members={members} />
              <StuckCasesList rows={allRows} showAssignee />
            </div>
          </Section>
        </>
      )}

      {page === "trends" && (
        <>
          <Section title="Trends Over Time" subtitle="Team-wide backlog trajectory and weekly intake-versus-resolved cadence. Use this to see whether the team is keeping pace with incoming work, or whether work is accumulating faster than it can be cleared. The shaded band marks the active date filter, if any.">
            <TrajectoryBlock rows={trajectoryRows} highlightRange={highlightRange?.from != null ? highlightRange : null} />
          </Section>
          <Section title="Workload Cadence" subtitle="Team-wide weekly rhythm. The bars show average open caseload and case creation by weekday; the heatmap pinpoints the weekday-and-hour slots where intake concentrates. Useful for staffing decisions and on-call coverage. Click a heatmap tile to see the cases created in that slot.">
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <WeekdayBlock rows={allRows} />
              <IntakeHeatmap rows={allRows} />
            </div>
          </Section>
        </>
      )}

      {page === "mix" && (
        <>
          <Section title="Priority Analysis" subtitle="How case priority shapes both volume and resolution time across the team.">
            <PriorityBlock priorityData={priorityData} rows={allRows} />
          </Section>
          <Section title="Case Categorization" subtitle="What kinds of problems are showing up across the team. Auto-derived from short descriptions and resolution notes.">
            <CategoryBlock categoryData={categoryData} enriched={allRows} />
          </Section>
          <Section title="Accounts & Products" subtitle="Which customers and product lines drive the most case volume across the team.">
            <AccountProductBlock accountData={accountData} productData={productData} />
          </Section>
        </>
      )}

      {page === "team" && (
        <>
          <Section title="Workload Distribution" subtitle="How work is spread across the team — the Lorenz curve and Gini score show fairness and bus-factor risk that the leaderboard alone does not.">
            <WorkloadDistributionBlock members={members} />
          </Section>
          <Section title="Team Leaderboard" subtitle="Side-by-side performance across the team. Click any column header to sort, or any analyst's name to drill into their full dashboard. Use this view to spot outliers — both the team's strongest performers and analysts who may need support.">
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }} className="scrollbar">
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: T.surfaceAlt }}>
                  {headers.map((h) => (
                    <th
                      key={h.key}
                      onClick={() =>
                        setSort((s) =>
                          s.key === h.key
                            ? { key: h.key, dir: s.dir === "asc" ? "desc" : "asc" }
                            : { key: h.key, dir: h.key === "name" ? "asc" : "desc" }
                        )
                      }
                      style={{
                        padding: "10px 14px",
                        textAlign: h.align,
                        fontWeight: 600,
                        color: T.sub,
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                        borderBottom: `1px solid ${T.borderSoft}`,
                      }}
                    >
                      {h.label}
                      {sort.key === h.key && (
                        <span style={{ marginLeft: 4, color: T.accent }}>
                          {sort.dir === "asc" ? "▲" : "▼"}
                        </span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((m) => (
                  <tr key={m.name} style={{ borderBottom: `1px solid ${T.borderSoft}` }}>
                    <td style={{ padding: "10px 14px" }}>
                      <button
                        onClick={() => drillIntoMember(m.name)}
                        style={{ background: "none", border: "none", color: T.ink, cursor: "pointer", padding: 0, fontSize: 13, fontFamily: "DM Sans, sans-serif", textAlign: "left" }}
                      >
                        <span style={{ fontWeight: 600 }}>{m.name}</span>
                      </button>
                    </td>
                    <td className="mono" style={{ padding: "10px 14px", textAlign: "right" }}>{m.kpis.total}</td>
                    <td className="mono" style={{ padding: "10px 14px", textAlign: "right", color: m.kpis.open > 0 ? T.ink : T.muted }}>{m.kpis.open}</td>
                    <td className="mono" style={{ padding: "10px 14px", textAlign: "right", color: SLA_COLOR(m.kpis.slaRate), fontWeight: 600 }}>
                      {m.kpis.slaRate == null ? "—" : `${m.kpis.slaRate.toFixed(1)}%`}
                    </td>
                    <td className="mono" style={{ padding: "10px 14px", textAlign: "right" }}>{fmtDuration(m.kpis.avgRes)}</td>
                    <td className="mono" style={{ padding: "10px 14px", textAlign: "right" }}>{fmtDuration(m.kpis.avgFrt)}</td>
                    <td className="mono" style={{ padding: "10px 14px", textAlign: "right", color: m.kpis.atRisk.length > 0 ? T.warn : T.muted }}>{m.kpis.atRisk.length}</td>
                    <td className="mono" style={{ padding: "10px 14px", textAlign: "right", color: m.kpis.breached.length > 0 ? T.danger : T.muted }}>{m.kpis.breached.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </Section>

          <Section title="Member Profiles" subtitle="A condensed snapshot per analyst — priority mix, top case categories, and most frequent accounts. Run the AI button on any card for a qualitative read on what that analyst's queue looks like, or click through to their full dashboard.">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 12 }}>
              {sorted.map((m) => (
                <MemberCard
                  key={m.name}
                  member={m}
                  ai={memberAi[m.name]}
                  onRunAi={() => runMemberAi(m)}
                  onDrillIn={() => drillIntoMember(m.name)}
                />
              ))}
            </div>
          </Section>
        </>
      )}

      {page === "ai" && (
        <Section title="Deep Pattern Analysis" subtitle="An AI-powered qualitative read on the team's case data — themes, recurring issues, knowledge-base gaps, and skill-development opportunities. Samples up to 50 cases (anonymized) and sends them to Claude for analysis.">
          <AiBlock state={aiState} run={runAiAnalysis} hasData={allRows.length > 0} />
        </Section>
      )}

      {page === "cases" && (
        <Section title="Case Register" subtitle="The full underlying case list across the team. Sort by any column or search by keyword to inspect the individual cases behind every metric in the app.">
          <CaseTable rows={allRows} />
        </Section>
      )}
    </>
  );
}

function MemberCard({ member, ai, onRunAi, onDrillIn }) {
  const [showAi, setShowAi] = useState(false);
  const k = member.kpis;
  const maxPriority = Math.max(1, ...member.priorityMix.map((p) => p.count));
  return (
    <Card className="hoverlift" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <button
            onClick={onDrillIn}
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}
          >
            <div className="display" style={{ fontSize: 18, fontWeight: 600, color: T.ink, lineHeight: 1.2 }}>
              {member.name}
            </div>
          </button>
          <div className="eyebrow" style={{ color: T.muted, marginTop: 6 }}>
            {k.total} cases · {k.closed} closed · {k.open} open
          </div>
        </div>
        <Pill color={SLA_COLOR(k.slaRate)}>
          {k.slaRate == null ? "no SLA data" : `SLA ${k.slaRate.toFixed(0)}%`}
        </Pill>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, fontSize: 12 }}>
        <Stat label="Avg res" value={fmtDuration(k.avgRes)} />
        <Stat label="Avg FRT" value={fmtDuration(k.avgFrt)} />
        <Stat
          label="At risk"
          value={`${k.breached.length + k.atRisk.length}`}
          accent={k.breached.length > 0 ? T.danger : k.atRisk.length > 0 ? T.warn : T.muted}
        />
      </div>

      <div>
        <div className="eyebrow" style={{ color: T.muted, marginBottom: 6 }}>Priority mix</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {member.priorityMix.map((p) => (
            <div key={p.priority} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
              <div style={{ width: 90, color: T.sub, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.priority}</div>
              <div style={{ flex: 1, height: 6, background: T.surfaceAlt, borderRadius: 3, overflow: "hidden" }}>
                <div style={{ width: `${(p.count / maxPriority) * 100}%`, height: "100%", background: p.color }} />
              </div>
              <div className="mono" style={{ width: 28, textAlign: "right", color: T.sub }}>{p.count}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <ListBlock label="Top categories" items={member.topCategories} />
        <ListBlock label="Top accounts" items={member.topAccounts} />
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", borderTop: `1px solid ${T.borderSoft}`, paddingTop: 12 }}>
        <button
          disabled
          title="AI insights are not yet enabled in this environment"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "7px 12px",
            background: T.ink,
            color: T.surface,
            border: `1px solid ${T.ink}`,
            borderRadius: 6,
            fontFamily: "DM Sans, sans-serif",
            fontSize: 12,
            fontWeight: 500,
            cursor: "not-allowed",
            opacity: 0.5,
          }}
        >
          <Sparkles size={12} />
          Analyze with AI
        </button>
        <button
          onClick={onDrillIn}
          style={{
            padding: "7px 12px",
            background: "transparent",
            color: T.sub,
            border: `1px solid ${T.border}`,
            borderRadius: 6,
            fontFamily: "DM Sans, sans-serif",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          Open full dashboard →
        </button>
      </div>
      <div style={{ fontSize: 11, color: T.muted, fontStyle: "italic", display: "flex", alignItems: "center", gap: 6 }}>
        <AlertTriangle size={11} style={{ color: T.warn }} /> AI insights are not yet enabled in this environment.
      </div>

      {ai?.error && (
        <div style={{ color: T.danger, fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
          <AlertTriangle size={12} /> {ai.error}
        </div>
      )}

      {showAi && ai?.result && (
        <div style={{ borderTop: `1px solid ${T.borderSoft}`, paddingTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>
          <AiSummaryList title="Themes" items={ai.result.themes?.map((t) => ({ h: t.title, b: t.description }))} />
          <AiSummaryList title="Recurring issues" items={ai.result.recurring_issues?.map((t) => ({ h: t.issue, b: t.evidence }))} />
          <AiSummaryList title="Skill opportunities" items={ai.result.skill_opportunities?.map((t) => ({ h: t.area, b: t.why }))} />
          <AiSummaryList title="Knowledge base gaps" items={ai.result.kb_gaps?.map((t) => ({ h: t.gap, b: t.why }))} />
          {ai.result.watch_outs?.length > 0 && (
            <div>
              <div className="eyebrow" style={{ color: T.muted, marginBottom: 6 }}>Watch-outs</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.5, color: T.sub }}>
                {ai.result.watch_outs.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function Stat({ label, value, accent }) {
  return (
    <div style={{ background: T.surfaceAlt, borderRadius: 4, padding: "8px 10px" }}>
      <div className="eyebrow" style={{ color: T.muted, fontSize: 9 }}>{label}</div>
      <div className="mono" style={{ fontSize: 14, fontWeight: 600, color: accent || T.ink, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function ListBlock({ label, items }) {
  return (
    <div>
      <div className="eyebrow" style={{ color: T.muted, marginBottom: 6 }}>{label}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {items.length === 0 ? (
          <div style={{ fontSize: 12, color: T.muted, fontStyle: "italic" }}>—</div>
        ) : items.map((it) => (
          <div key={it.name} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12 }}>
            <span style={{ color: T.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</span>
            <span className="mono" style={{ color: T.sub }}>{it.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AiSummaryList({ title, items }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <div className="eyebrow" style={{ color: T.muted, marginBottom: 6 }}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {items.map((it, i) => (
          <div key={i}>
            <div style={{ fontWeight: 600, fontSize: 12 }}>{it.h}</div>
            <div style={{ color: T.sub, fontSize: 12, marginTop: 2, lineHeight: 1.45 }}>{it.b}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ================= KPI Row ================= */
// "higher is better" by default. For metrics where lower is better, color flips.
const deltaColor = (diff, betterDir = "up") => {
  if (diff == null || diff === 0) return T.muted;
  const positive = diff > 0;
  const good = betterDir === "up" ? positive : !positive;
  return good ? T.ok : T.danger;
};

const fmtDeltaCount = (cur, prev) => {
  if (prev == null || cur == null) return null;
  const d = cur - prev;
  return `${d > 0 ? "+" : ""}${d.toLocaleString()} vs prev`;
};

const fmtDeltaPct = (cur, prev) => {
  if (cur == null || prev == null) return null;
  const d = cur - prev;
  return `${d > 0 ? "+" : ""}${d.toFixed(1)}pp vs prev`;
};

const fmtDeltaDuration = (cur, prev) => {
  if (cur == null || prev == null) return null;
  const d = cur - prev;
  if (d === 0) return "no change vs prev";
  const sign = d > 0 ? "+" : "−";
  return `${sign}${fmtDuration(Math.abs(d))} vs prev`;
};

function DeltaLine({ text, color }) {
  if (!text) return null;
  return (
    <div className="mono" style={{ color, fontSize: 11, marginTop: 4, fontWeight: 500 }}>
      {text}
    </div>
  );
}

function KpiRow({ kpis, compareKpis }) {
  const cmp = compareKpis;
  const cards = [
    {
      label: "Cases in view",
      value: kpis.total.toLocaleString(),
      sub: `${kpis.closed} closed · ${kpis.open} open`,
      icon: <ClipboardList size={14} />,
      accent: T.ink,
      delta: cmp ? { text: fmtDeltaCount(kpis.total, cmp.total), color: deltaColor(kpis.total - cmp.total, "up") } : null,
    },
    {
      label: "SLA compliance",
      value: kpis.slaRate == null ? "—" : `${kpis.slaRate.toFixed(1)}%`,
      sub: kpis.slaEligible ? `${kpis.slaMet} / ${kpis.slaEligible} within SLA` : "no data",
      icon: <CheckCircle2 size={14} />,
      accent: kpis.slaRate != null && kpis.slaRate >= 95 ? T.ok : kpis.slaRate != null && kpis.slaRate >= 85 ? T.warn : T.danger,
      delta: cmp ? { text: fmtDeltaPct(kpis.slaRate, cmp.slaRate), color: deltaColor((kpis.slaRate ?? 0) - (cmp.slaRate ?? 0), "up") } : null,
    },
    {
      label: "Avg resolution",
      value: fmtDuration(kpis.avgRes),
      sub: "from created to closed",
      icon: <Clock size={14} />,
      accent: T.ink,
      delta: cmp ? { text: fmtDeltaDuration(kpis.avgRes, cmp.avgRes), color: deltaColor((kpis.avgRes ?? 0) - (cmp.avgRes ?? 0), "down") } : null,
    },
    {
      label: "Open at risk",
      value: (kpis.atRisk.length + kpis.breached.length).toString(),
      sub: `${kpis.breached.length} breached · ${kpis.atRisk.length} due in 24h`,
      icon: <AlertTriangle size={14} />,
      accent: kpis.breached.length > 0 ? T.danger : kpis.atRisk.length > 0 ? T.warn : T.ok,
      delta: cmp ? {
        text: fmtDeltaCount(kpis.atRisk.length + kpis.breached.length, cmp.atRisk.length + cmp.breached.length),
        color: deltaColor((kpis.atRisk.length + kpis.breached.length) - (cmp.atRisk.length + cmp.breached.length), "down"),
      } : null,
    },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
      {cards.map((c) => (
        <Card key={c.label} className="hoverlift">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div className="eyebrow" style={{ color: T.muted }}>{c.label}</div>
            <span style={{ color: c.accent }}>{c.icon}</span>
          </div>
          <div className="display mono" style={{ fontSize: 40, fontWeight: 500, marginTop: 10, color: c.accent, lineHeight: 1 }}>
            {c.value}
          </div>
          <div style={{ color: T.sub, fontSize: 12, marginTop: 8 }}>{c.sub}</div>
          {c.delta && <DeltaLine text={c.delta.text} color={c.delta.color} />}
        </Card>
      ))}
    </div>
  );
}

/* ================= SLA ================= */
function SlaBlock({ kpis, priorityData, enriched }) {
  const pct = kpis.slaRate == null ? 0 : kpis.slaRate;
  const radialData = [{ name: "SLA met", value: pct, fill: pct >= 95 ? T.ok : pct >= 85 ? T.warn : T.danger }];
  const nearestBreach = [...kpis.atRisk, ...kpis.breached]
    .sort((a, b) => (a._slaDue || 0) - (b._slaDue || 0))
    .slice(0, 6);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: 12 }}>
      <Card>
        <div className="eyebrow" style={{ color: T.muted }}>Overall SLA</div>
        <div style={{ color: T.sub, fontSize: 12, marginTop: 4 }}>The percentage of SLA-eligible cases resolved within their contractual window. Green ≥ 95%, amber ≥ 85%, red below.</div>
        <div style={{ position: "relative", height: 240, marginTop: 12 }}>
          <ResponsiveContainer width="100%" height="100%">
            <RadialBarChart innerRadius="70%" outerRadius="95%" data={radialData} startAngle={90} endAngle={-270}>
              <RadialBar dataKey="value" cornerRadius={8} background={{ fill: T.surfaceAlt }} />
            </RadialBarChart>
          </ResponsiveContainer>
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            <div className="display mono" style={{ fontSize: 48, fontWeight: 500, color: radialData[0].fill, lineHeight: 1 }}>
              {kpis.slaRate == null ? "—" : `${pct.toFixed(1)}%`}
            </div>
            <div style={{ fontSize: 12, color: T.sub, marginTop: 4 }}>within SLA</div>
          </div>
        </div>
        <div className="hairline" style={{ margin: "12px -20px 0", borderColor: T.borderSoft }} />
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12, fontSize: 12, color: T.sub }}>
          <span><CheckCircle2 size={12} style={{ color: T.ok, verticalAlign: "middle" }} /> Met: <span className="mono" style={{ color: T.ink }}>{kpis.slaMet}</span></span>
          <span><XCircle size={12} style={{ color: T.danger, verticalAlign: "middle" }} /> Missed: <span className="mono" style={{ color: T.ink }}>{kpis.slaEligible - kpis.slaMet}</span></span>
          <span><Clock size={12} style={{ color: T.muted, verticalAlign: "middle" }} /> Avg FRT: <span className="mono" style={{ color: T.ink }}>{fmtDuration(kpis.avgFrt)}</span></span>
        </div>
      </Card>

      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div className="eyebrow" style={{ color: T.muted }}>SLA compliance by priority</div>
          <div style={{ fontSize: 11, color: T.muted }}>closed + in-flight, where SLA data is present</div>
        </div>
        <div style={{ color: T.sub, fontSize: 12, marginTop: 4 }}>Hit rate broken out per priority level — surfaces whether a single priority is dragging the overall number down.</div>
        <div style={{ height: 200, marginTop: 12 }}>
          <ResponsiveContainer>
            <BarChart data={priorityData} layout="vertical" margin={{ left: 0, right: 30, top: 10, bottom: 0 }}>
              <CartesianGrid stroke={T.borderSoft} horizontal={false} />
              <XAxis type="number" domain={[0, 100]} tick={{ fill: T.muted, fontSize: 11, fontFamily: "JetBrains Mono" }} axisLine={{ stroke: T.border }} tickLine={{ stroke: T.border }} unit="%" />
              <YAxis type="category" dataKey="priority" tick={{ fill: T.ink, fontSize: 12 }} width={90} axisLine={{ stroke: T.border }} tickLine={{ stroke: T.border }} />
              <Tooltip content={<SlaTip />} cursor={{ fill: T.surfaceAlt }} />
              <Bar dataKey="sla_pct" radius={[0, 3, 3, 0]}>
                {priorityData.map((p, i) => (
                  <Cell key={i} fill={p.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="hairline" style={{ margin: "8px -20px 12px", borderColor: T.borderSoft }} />
        <div className="eyebrow" style={{ color: T.muted, marginBottom: 4 }}>Open cases approaching or past SLA</div>
        <div style={{ color: T.sub, fontSize: 12, marginBottom: 8 }}>Up to six open cases sorted by SLA deadline. Amber = within 24h, red = already breached.</div>
        {nearestBreach.length === 0 ? (
          <div style={{ fontSize: 13, color: T.sub, fontStyle: "italic" }}>No open cases are at risk. Clean slate.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {nearestBreach.map((r) => {
              const now = new Date();
              const breached = r._slaDue && r._slaDue < now;
              const ms = r._slaDue ? Math.abs(r._slaDue - now) : 0;
              return (
                <div key={r.number} style={{ display: "grid", gridTemplateColumns: "100px 70px 1fr 120px", gap: 12, alignItems: "center", fontSize: 12, padding: "6px 0", borderBottom: `1px solid ${T.borderSoft}` }}>
                  <span className="mono" style={{ color: T.sub }}>{r.number}</span>
                  <Pill color={priorityColor(r.priority)}>{String(r.priority).split(" - ")[1] || r.priority}</Pill>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.short_description}</span>
                  <span className="mono" style={{ color: breached ? T.danger : T.warn, textAlign: "right" }}>
                    {breached ? `- ${fmtDuration(ms)}` : `in ${fmtDuration(ms)}`}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

function SlaTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, padding: "8px 12px", borderRadius: 4, fontSize: 12 }}>
      <div style={{ fontWeight: 600 }}>{d.priority}</div>
      <div className="mono" style={{ color: T.sub }}>{d.sla_pct == null ? "no SLA data" : d.sla_pct.toFixed(1) + "% SLA"}</div>
      <div className="mono" style={{ color: T.sub }}>{d.sla_met}/{d.sla_total} met · {d.total} cases</div>
      {d.avg_res_h != null && <div className="mono" style={{ color: T.sub }}>avg resolve: {fmtDuration(d.avg_res_h * 36e5)}</div>}
    </div>
  );
}

/* ================= Priority ================= */
function PriorityBlock({ priorityData, rows }) {
  const distribution = useMemo(() => resolutionDistribution(rows || []), [rows]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Card>
          <div className="eyebrow" style={{ color: T.muted }}>Volume by priority</div>
          <div style={{ color: T.sub, fontSize: 12, marginTop: 4 }}>Total case count at each priority level. Shows where the bulk of the work sits.</div>
          <div style={{ height: 240, marginTop: 12 }}>
            <ResponsiveContainer>
              <BarChart data={priorityData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={T.borderSoft} vertical={false} />
                <XAxis dataKey="priority" tick={{ fill: T.sub, fontSize: 11 }} axisLine={{ stroke: T.border }} tickLine={{ stroke: T.border }} />
                <YAxis tick={{ fill: T.muted, fontSize: 11, fontFamily: "JetBrains Mono" }} axisLine={{ stroke: T.border }} tickLine={{ stroke: T.border }} />
                <Tooltip content={<VolumeTip />} cursor={{ fill: T.surfaceAlt }} />
                <Bar dataKey="total" radius={[3, 3, 0, 0]}>
                  {priorityData.map((p, i) => <Cell key={i} fill={p.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card>
          <div className="eyebrow" style={{ color: T.muted }}>Average resolution time by priority</div>
          <div style={{ color: T.sub, fontSize: 12, marginTop: 4 }}>How long it actually takes to close cases at each priority level (created → closed). Critical priorities should resolve fastest.</div>
          <div style={{ height: 240, marginTop: 12 }}>
            <ResponsiveContainer>
              <BarChart data={priorityData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={T.borderSoft} vertical={false} />
                <XAxis dataKey="priority" tick={{ fill: T.sub, fontSize: 11 }} axisLine={{ stroke: T.border }} tickLine={{ stroke: T.border }} />
                <YAxis tick={{ fill: T.muted, fontSize: 11, fontFamily: "JetBrains Mono" }} axisLine={{ stroke: T.border }} tickLine={{ stroke: T.border }} unit="h" />
                <Tooltip content={<ResTip />} cursor={{ fill: T.surfaceAlt }} />
                <Bar dataKey="avg_res_h" radius={[3, 3, 0, 0]}>
                  {priorityData.map((p, i) => <Cell key={i} fill={p.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <div>
            <div className="eyebrow" style={{ color: T.muted }}>Resolution-time distribution by priority</div>
            <div style={{ color: T.sub, fontSize: 12, marginTop: 4 }}>
              The median (p50), 90th-percentile (p90), and worst-case resolution time per priority. Averages hide the long tail — the gap between p50 and p90/max shows how often things drag.
            </div>
          </div>
          <div className="mono" style={{ fontSize: 11, color: T.muted, display: "flex", gap: 12 }}>
            <span><span style={{ display: "inline-block", width: 10, height: 10, background: T.ok, borderRadius: 2, marginRight: 4, verticalAlign: "middle" }} />p50</span>
            <span><span style={{ display: "inline-block", width: 10, height: 10, background: T.warn, borderRadius: 2, marginRight: 4, verticalAlign: "middle" }} />p90</span>
            <span><span style={{ display: "inline-block", width: 10, height: 10, background: T.danger, borderRadius: 2, marginRight: 4, verticalAlign: "middle" }} />max</span>
          </div>
        </div>
        <div style={{ height: 280, marginTop: 12 }}>
          <ResponsiveContainer>
            <BarChart data={distribution} margin={{ top: 10, right: 20, left: 0, bottom: 0 }} barCategoryGap="20%">
              <CartesianGrid stroke={T.borderSoft} vertical={false} />
              <XAxis dataKey="priority" tick={{ fill: T.sub, fontSize: 11 }} axisLine={{ stroke: T.border }} tickLine={{ stroke: T.border }} />
              <YAxis tick={{ fill: T.muted, fontSize: 11, fontFamily: "JetBrains Mono" }} axisLine={{ stroke: T.border }} tickLine={{ stroke: T.border }} unit="h" />
              <Tooltip content={<DistTip />} cursor={{ fill: T.surfaceAlt }} />
              <Bar dataKey="p50_h" name="p50" fill={T.ok} radius={[3, 3, 0, 0]} />
              <Bar dataKey="p90_h" name="p90" fill={T.warn} radius={[3, 3, 0, 0]} />
              <Bar dataKey="max_h" name="max" fill={T.danger} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        {distribution.length === 0 && (
          <div style={{ color: T.sub, fontSize: 13, fontStyle: "italic", marginTop: 8 }}>No closed cases with resolution times yet.</div>
        )}
      </Card>
    </div>
  );
}

function DistTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, padding: "8px 12px", borderRadius: 4, fontSize: 12 }}>
      <div style={{ fontWeight: 600 }}>{d.priority}</div>
      <div className="mono" style={{ color: T.sub }}>p50: {d.p50_ms == null ? "—" : fmtDuration(d.p50_ms)}</div>
      <div className="mono" style={{ color: T.sub }}>p90: {d.p90_ms == null ? "—" : fmtDuration(d.p90_ms)}</div>
      <div className="mono" style={{ color: T.sub }}>max: {d.max_ms == null ? "—" : fmtDuration(d.max_ms)}</div>
      <div className="mono" style={{ color: T.muted, marginTop: 4 }}>from {d.n} resolved case{d.n === 1 ? "" : "s"}</div>
    </div>
  );
}

function VolumeTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, padding: "8px 12px", borderRadius: 4, fontSize: 12 }}>
      <div style={{ fontWeight: 600 }}>{d.priority}</div>
      <div className="mono" style={{ color: T.sub }}>{d.total} cases · {d.closed} closed</div>
    </div>
  );
}

function ResTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, padding: "8px 12px", borderRadius: 4, fontSize: 12 }}>
      <div style={{ fontWeight: 600 }}>{d.priority}</div>
      <div className="mono" style={{ color: T.sub }}>{d.avg_res_h == null ? "no data" : fmtDuration(d.avg_res_h * 36e5)} avg</div>
      <div className="mono" style={{ color: T.sub }}>from {d.res_n} resolved cases</div>
    </div>
  );
}

/* ================= Workload Cadence ================= */
function WeekdayBlock({ rows }) {
  const data = useMemo(() => weekdayAnalytics(rows), [rows]);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
      <Card>
        <div className="eyebrow" style={{ color: T.muted }}>Avg open caseload by weekday</div>
        <div style={{ color: T.sub, fontSize: 12, marginTop: 4 }}>Average number of cases open on each day of the week, across the data range.</div>
        <div style={{ height: 240, marginTop: 12 }}>
          <ResponsiveContainer>
            <BarChart data={data.avgOpen} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={T.borderSoft} vertical={false} />
              <XAxis dataKey="name" tick={{ fill: T.sub, fontSize: 11 }} axisLine={{ stroke: T.border }} tickLine={{ stroke: T.border }} />
              <YAxis tick={{ fill: T.muted, fontSize: 11, fontFamily: "JetBrains Mono" }} axisLine={{ stroke: T.border }} tickLine={{ stroke: T.border }} />
              <Tooltip content={<WeekdayTip label="avg open" />} cursor={{ fill: T.surfaceAlt }} />
              <Bar dataKey="count" radius={[3, 3, 0, 0]} fill={T.accent} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Card>
        <div className="eyebrow" style={{ color: T.muted }}>Cases created by weekday</div>
        <div style={{ color: T.sub, fontSize: 12, marginTop: 4 }}>Which days of the week new cases get opened.</div>
        <div style={{ height: 240, marginTop: 12 }}>
          <ResponsiveContainer>
            <BarChart data={data.created} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={T.borderSoft} vertical={false} />
              <XAxis dataKey="name" tick={{ fill: T.sub, fontSize: 11 }} axisLine={{ stroke: T.border }} tickLine={{ stroke: T.border }} />
              <YAxis tick={{ fill: T.muted, fontSize: 11, fontFamily: "JetBrains Mono" }} axisLine={{ stroke: T.border }} tickLine={{ stroke: T.border }} />
              <Tooltip content={<WeekdayTip label="cases created" />} cursor={{ fill: T.surfaceAlt }} />
              <Bar dataKey="count" radius={[3, 3, 0, 0]} fill={T.accent} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}

function WeekdayTip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, padding: "8px 12px", borderRadius: 4, fontSize: 12 }}>
      <div style={{ fontWeight: 600 }}>{d.name}</div>
      <div className="mono" style={{ color: T.sub }}>{d.count} {label}</div>
    </div>
  );
}

/* ================= Drilldown ================= */
const fmtDate = (d) => {
  if (!d) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

const ageDays = (d) => {
  if (!d) return null;
  return Math.floor((Date.now() - d.getTime()) / 864e5);
};

function CaseDrilldown({ title, rows, onClose }) {
  return (
    <div style={{ marginTop: 12, border: `1px solid ${T.border}`, borderRadius: 4, background: T.surface }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: `1px solid ${T.borderSoft}`, background: T.surfaceAlt }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span className="eyebrow" style={{ color: T.accent }}>{title}</span>
          <span className="mono" style={{ fontSize: 12, color: T.sub }}>{rows.length} case{rows.length === 1 ? "" : "s"}</span>
        </div>
        <button
          onClick={onClose}
          style={{ background: "none", border: "none", color: T.sub, cursor: "pointer", fontSize: 13, padding: 4 }}
          aria-label="Close drilldown"
        >
          ✕
        </button>
      </div>
      <div style={{ maxHeight: 320, overflowY: "auto" }} className="scrollbar">
        {rows.length === 0 ? (
          <div style={{ padding: "16px 14px", color: T.muted, fontSize: 13 }}>No cases in this bucket.</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: T.surface, position: "sticky", top: 0 }}>
                <th style={{ textAlign: "left", padding: "8px 12px", color: T.sub, fontWeight: 600, borderBottom: `1px solid ${T.borderSoft}` }}>Case</th>
                <th style={{ textAlign: "left", padding: "8px 12px", color: T.sub, fontWeight: 600, borderBottom: `1px solid ${T.borderSoft}` }}>Assignee</th>
                <th style={{ textAlign: "left", padding: "8px 12px", color: T.sub, fontWeight: 600, borderBottom: `1px solid ${T.borderSoft}` }}>Priority</th>
                <th style={{ textAlign: "left", padding: "8px 12px", color: T.sub, fontWeight: 600, borderBottom: `1px solid ${T.borderSoft}` }}>Account</th>
                <th style={{ textAlign: "left", padding: "8px 12px", color: T.sub, fontWeight: 600, borderBottom: `1px solid ${T.borderSoft}` }}>Created</th>
                <th style={{ textAlign: "left", padding: "8px 12px", color: T.sub, fontWeight: 600, borderBottom: `1px solid ${T.borderSoft}` }}>Age</th>
                <th style={{ textAlign: "left", padding: "8px 12px", color: T.sub, fontWeight: 600, borderBottom: `1px solid ${T.borderSoft}` }}>Description</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const age = ageDays(r._created);
                return (
                  <tr key={r.number || i} style={{ borderBottom: `1px solid ${T.borderSoft}` }}>
                    <td className="mono" style={{ padding: "8px 12px", whiteSpace: "nowrap", fontWeight: 600 }}>{r.number || "—"}</td>
                    <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>{r.assigned_to || "Unassigned"}</td>
                    <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>
                      <span style={{ color: priorityColor(r.priority), fontWeight: 600 }}>{r.priority || "—"}</span>
                    </td>
                    <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>{r.account || "—"}</td>
                    <td className="mono" style={{ padding: "8px 12px", whiteSpace: "nowrap", color: T.sub }}>{fmtDate(r._created)}</td>
                    <td className="mono" style={{ padding: "8px 12px", whiteSpace: "nowrap", color: age != null && age > 30 ? T.danger : T.sub }}>{age == null ? "—" : `${age}d`}</td>
                    <td style={{ padding: "8px 12px", maxWidth: 380, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.short_description || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/* ================= Open Backlog · SLA Risk (analyst view) ================= */
function SlaRiskBlock({ rows }) {
  const data = useMemo(() => slaRiskSegments(rows), [rows]);
  const [selected, setSelected] = useState(null);
  const total = data.reduce((s, d) => s + d.count, 0);
  const breached = data.find((d) => d.key === "breached")?.count || 0;
  const due24 = data.find((d) => d.key === "due24")?.count || 0;
  const drilldownRows = useMemo(() => {
    if (!selected) return [];
    const now = Date.now();
    return rows
      .filter((r) => !r._isClosed && slaRiskOf(r, now) === selected)
      .sort((a, b) => {
        const ad = a._slaDue ? a._slaDue.getTime() : Infinity;
        const bd = b._slaDue ? b._slaDue.getTime() : Infinity;
        return ad - bd;
      });
  }, [rows, selected]);

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div>
          <div className="eyebrow" style={{ color: T.muted }}>Open cases by SLA risk</div>
          <div style={{ color: T.sub, fontSize: 12, marginTop: 4, maxWidth: 640 }}>
            Open cases grouped by their SLA clock — what to work on next, not just what's old. Click any bar to drill in.
          </div>
        </div>
        <div className="mono" style={{ fontSize: 12, color: T.sub, textAlign: "right" }}>
          <div>{total} open</div>
          <div style={{ color: breached ? T.danger : T.muted, fontWeight: 600 }}>{breached} breached · {due24} due in 24h</div>
        </div>
      </div>
      <div style={{ height: 240, marginTop: 12 }}>
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={T.borderSoft} vertical={false} />
            <XAxis dataKey="label" tick={{ fill: T.sub, fontSize: 11 }} axisLine={{ stroke: T.border }} tickLine={{ stroke: T.border }} />
            <YAxis tick={{ fill: T.muted, fontSize: 11, fontFamily: "JetBrains Mono" }} axisLine={{ stroke: T.border }} tickLine={{ stroke: T.border }} allowDecimals={false} />
            <Tooltip content={<SlaRiskTip total={total} />} cursor={{ fill: T.surfaceAlt }} />
            <Bar
              dataKey="count"
              radius={[3, 3, 0, 0]}
              cursor="pointer"
              onClick={(d) => setSelected((prev) => (prev === d.key ? null : d.key))}
            >
              {data.map((d, i) => (
                <Cell
                  key={i}
                  fill={d.color}
                  fillOpacity={!selected || selected === d.key ? 1 : 0.35}
                  stroke={selected === d.key ? T.ink : "none"}
                  strokeWidth={selected === d.key ? 1.5 : 0}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {selected && (
        <CaseDrilldown
          title={`Open · ${data.find((d) => d.key === selected)?.label}`}
          rows={drilldownRows}
          onClose={() => setSelected(null)}
        />
      )}
    </Card>
  );
}

function SlaRiskTip({ active, payload, total }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const pct = total ? (d.count / total) * 100 : 0;
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, padding: "8px 12px", borderRadius: 4, fontSize: 12 }}>
      <div style={{ fontWeight: 600 }}>{d.label}</div>
      <div className="mono" style={{ color: T.sub }}>{d.count} open · {pct.toFixed(1)}%</div>
      <div style={{ color: T.muted, marginTop: 4, maxWidth: 200 }}>{d.desc}</div>
    </div>
  );
}

/* ================= Open Backlog · By Assignee (team view) ================= */
const AGING_STACK_COLORS = [T.ok, T.warn, T.accent, T.danger];

function AssigneeAgingBlock({ members }) {
  const data = useMemo(() => openByAssigneeAge(members), [members]);
  const [selected, setSelected] = useState(null); // { name, bucketIdx }
  const drilldownRows = useMemo(() => {
    if (!selected) return [];
    const m = members.find((x) => x.name === selected.name);
    if (!m) return [];
    const now = Date.now();
    const bucket = AGING_BUCKETS[selected.bucketIdx];
    return m.rows
      .filter((r) => !r._isClosed && r._created)
      .filter((r) => {
        const days = Math.floor((now - r._created.getTime()) / 864e5);
        return days >= bucket.min && days <= bucket.max;
      })
      .sort((a, b) => a._created - b._created);
  }, [members, selected]);

  if (!data.length) {
    return (
      <Card>
        <div className="eyebrow" style={{ color: T.muted }}>Open cases by assignee · stacked by age</div>
        <div style={{ color: T.sub, fontSize: 13, fontStyle: "italic", marginTop: 12 }}>No open cases on the team.</div>
      </Card>
    );
  }

  const height = Math.max(240, data.length * 30 + 40);

  return (
    <Card>
      <div className="eyebrow" style={{ color: T.muted }}>Open cases by assignee · stacked by age</div>
      <div style={{ color: T.sub, fontSize: 12, marginTop: 4, maxWidth: 720 }}>
        Each analyst's open queue, with the dark segments (31–90d / 90d+) showing where stale work is concentrated. Click any segment to drill into those cases.
      </div>
      <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 11, color: T.sub, flexWrap: "wrap" }}>
        {AGING_BUCKETS.map((b, i) => (
          <span key={b.name} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 12, height: 10, background: AGING_STACK_COLORS[i], borderRadius: 2 }} />
            {b.name}
          </span>
        ))}
      </div>
      <div style={{ height, marginTop: 12 }}>
        <ResponsiveContainer>
          <BarChart data={data} layout="vertical" margin={{ top: 10, right: 20, left: 8, bottom: 0 }}>
            <CartesianGrid stroke={T.borderSoft} horizontal={false} />
            <XAxis type="number" tick={{ fill: T.muted, fontSize: 11, fontFamily: "JetBrains Mono" }} axisLine={{ stroke: T.border }} tickLine={{ stroke: T.border }} allowDecimals={false} />
            <YAxis type="category" dataKey="name" tick={{ fill: T.ink, fontSize: 12 }} width={140} interval={0} axisLine={{ stroke: T.border }} tickLine={{ stroke: T.border }} />
            <Tooltip content={<AssigneeAgingTip />} cursor={{ fill: T.surfaceAlt }} />
            {AGING_BUCKETS.map((b, i) => (
              <Bar
                key={b.name}
                dataKey={b.name}
                stackId="age"
                fill={AGING_STACK_COLORS[i]}
                cursor="pointer"
                onClick={(d) => setSelected((prev) =>
                  prev && prev.name === d.name && prev.bucketIdx === i ? null : { name: d.name, bucketIdx: i }
                )}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      {selected && (
        <CaseDrilldown
          title={`${selected.name} · ${AGING_BUCKETS[selected.bucketIdx].name}`}
          rows={drilldownRows}
          onClose={() => setSelected(null)}
        />
      )}
    </Card>
  );
}

function AssigneeAgingTip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + (p.value || 0), 0);
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, padding: "8px 12px", borderRadius: 4, fontSize: 12 }}>
      <div style={{ fontWeight: 600 }}>{label}</div>
      <div className="mono" style={{ color: T.sub, marginBottom: 4 }}>{total} open</div>
      {payload.filter((p) => p.value > 0).map((p) => (
        <div key={p.dataKey} className="mono" style={{ color: T.sub, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 8, height: 8, background: p.color, borderRadius: 2 }} />
          {p.dataKey}: {p.value}
        </div>
      ))}
    </div>
  );
}

/* ================= Stuck Cases List ================= */
function StuckCasesList({ rows, thresholdDays = 30, showAssignee = false }) {
  const stuck = useMemo(() => stuckCases(rows, thresholdDays), [rows, thresholdDays]);
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? stuck : stuck.slice(0, 10);

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div>
          <div className="eyebrow" style={{ color: T.muted }}>Stuck cases · open more than {thresholdDays} days</div>
          <div style={{ color: T.sub, fontSize: 12, marginTop: 4, maxWidth: 720 }}>
            The single highest-signal-per-pixel view for 1:1s. Sorted oldest first. {showAssignee ? "Each row shows its assignee." : "Filtered to this analyst's queue."}
          </div>
        </div>
        <div className="mono" style={{ fontSize: 12, color: stuck.length ? T.danger : T.muted, fontWeight: 600 }}>
          {stuck.length} case{stuck.length === 1 ? "" : "s"}
        </div>
      </div>

      {stuck.length === 0 ? (
        <div style={{ color: T.sub, fontSize: 13, fontStyle: "italic", marginTop: 12 }}>Nothing stuck. Clean slate.</div>
      ) : (
        <>
          <div style={{ marginTop: 12, overflowX: "auto" }} className="scrollbar">
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: T.surfaceAlt }}>
                  <th style={{ textAlign: "left", padding: "8px 12px", color: T.sub, fontWeight: 600, borderBottom: `1px solid ${T.borderSoft}` }}>Case</th>
                  {showAssignee && (
                    <th style={{ textAlign: "left", padding: "8px 12px", color: T.sub, fontWeight: 600, borderBottom: `1px solid ${T.borderSoft}` }}>Assignee</th>
                  )}
                  <th style={{ textAlign: "left", padding: "8px 12px", color: T.sub, fontWeight: 600, borderBottom: `1px solid ${T.borderSoft}` }}>Priority</th>
                  <th style={{ textAlign: "left", padding: "8px 12px", color: T.sub, fontWeight: 600, borderBottom: `1px solid ${T.borderSoft}` }}>Account</th>
                  <th style={{ textAlign: "left", padding: "8px 12px", color: T.sub, fontWeight: 600, borderBottom: `1px solid ${T.borderSoft}` }}>Age</th>
                  <th style={{ textAlign: "left", padding: "8px 12px", color: T.sub, fontWeight: 600, borderBottom: `1px solid ${T.borderSoft}` }}>SLA</th>
                  <th style={{ textAlign: "left", padding: "8px 12px", color: T.sub, fontWeight: 600, borderBottom: `1px solid ${T.borderSoft}` }}>Description</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const age = ageDays(r._created);
                  const now = Date.now();
                  let slaText = "—";
                  let slaColor = T.muted;
                  if (r._slaDue) {
                    const ms = r._slaDue.getTime() - now;
                    if (ms < 0) { slaText = `breached ${fmtDuration(-ms)}`; slaColor = T.danger; }
                    else if (ms < 24 * 36e5) { slaText = `due in ${fmtDuration(ms)}`; slaColor = T.warn; }
                    else { slaText = `in ${fmtDuration(ms)}`; slaColor = T.sub; }
                  }
                  return (
                    <tr key={r.number} style={{ borderBottom: `1px solid ${T.borderSoft}` }}>
                      <td className="mono" style={{ padding: "8px 12px", whiteSpace: "nowrap", fontWeight: 600 }}>{r.number || "—"}</td>
                      {showAssignee && (
                        <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>{r.assigned_to || "Unassigned"}</td>
                      )}
                      <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>
                        <span style={{ color: priorityColor(r.priority), fontWeight: 600 }}>{r.priority || "—"}</span>
                      </td>
                      <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>{r.account || "—"}</td>
                      <td className="mono" style={{ padding: "8px 12px", whiteSpace: "nowrap", color: age > 90 ? T.danger : age > 30 ? T.warn : T.sub }}>{age}d</td>
                      <td className="mono" style={{ padding: "8px 12px", whiteSpace: "nowrap", color: slaColor }}>{slaText}</td>
                      <td style={{ padding: "8px 12px", maxWidth: 380, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.short_description || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {stuck.length > 10 && (
            <div style={{ marginTop: 10, textAlign: "center" }}>
              <button
                onClick={() => setExpanded((v) => !v)}
                style={{ background: "none", border: `1px solid ${T.border}`, color: T.sub, padding: "6px 14px", borderRadius: 4, cursor: "pointer", fontSize: 12 }}
              >
                {expanded ? "Show top 10" : `Show all ${stuck.length}`}
              </button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

/* ================= Intake Heatmap ================= */
function IntakeHeatmap({ rows }) {
  const { grid, max } = useMemo(() => hourHeatmap(rows), [rows]);
  const [selected, setSelected] = useState(null); // { rowIdx, hourIdx }
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const drilldownRows = useMemo(() => {
    if (!selected) return [];
    const dow = WEEKDAY_ORDER[selected.rowIdx];
    return rows
      .filter((r) => r._created && r._created.getDay() === dow && r._created.getHours() === selected.hourIdx)
      .sort((a, b) => b._created - a._created);
  }, [rows, selected]);
  return (
    <Card>
      <div className="eyebrow" style={{ color: T.muted, textAlign: "left" }}>Intake heatmap · weekday × hour</div>
      <div style={{ color: T.sub, fontSize: 12, marginTop: 4, textAlign: "left" }}>When new cases come in. Darker = more cases created in that slot. Click a tile to drill in.</div>
      <div style={{ marginTop: 16, overflowX: "auto", textAlign: "left" }} className="scrollbar">
        <div style={{ display: "grid", gridTemplateColumns: `36px repeat(24, minmax(20px, 1fr))`, gap: 2, minWidth: "100%" }}>
          <div />
          {hours.map((h) => (
            <div key={h} className="mono" style={{ fontSize: 9, color: T.muted, textAlign: "center" }}>
              {String(h).padStart(2, "0")}
            </div>
          ))}
          {grid.map((row, ri) => (
            <React.Fragment key={ri}>
              <div className="mono" style={{ fontSize: 10, color: T.sub, alignSelf: "center" }}>{WEEKDAY_NAMES[ri]}</div>
              {row.map((v, hi) => {
                const intensity = max ? v / max : 0;
                const bg = v === 0
                  ? T.surfaceAlt
                  : `rgba(184, 69, 44, ${0.12 + intensity * 0.78})`;
                const isSelected = selected && selected.rowIdx === ri && selected.hourIdx === hi;
                return (
                  <div
                    key={hi}
                    onClick={() => {
                      if (v === 0) return;
                      setSelected((prev) => (prev && prev.rowIdx === ri && prev.hourIdx === hi ? null : { rowIdx: ri, hourIdx: hi }));
                    }}
                    title={`${WEEKDAY_NAMES[ri]} ${hi}:00 — ${v} case${v === 1 ? "" : "s"}`}
                    style={{
                      height: 22,
                      background: bg,
                      border: isSelected ? `2px solid ${T.ink}` : `1px solid ${T.borderSoft}`,
                      boxShadow: isSelected ? `0 0 0 1px ${T.surface}` : "none",
                      borderRadius: 2,
                      cursor: v === 0 ? "default" : "pointer",
                    }}
                  />
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, marginTop: 10, fontSize: 11, color: T.muted }}>
        <span className="mono">0</span>
        <div style={{ display: "flex", gap: 2 }}>
          {[0.12, 0.3, 0.5, 0.7, 0.9].map((a) => (
            <div key={a} style={{ width: 18, height: 10, background: `rgba(184, 69, 44, ${a})`, borderRadius: 2 }} />
          ))}
        </div>
        <span className="mono">{max}</span>
      </div>
      <div style={{ marginTop: 8, fontSize: 11, color: T.muted, fontStyle: "italic", lineHeight: 1.4 }}>
        Note: hour values reflect whatever timezone the case timestamps are stored in. ServiceNow exports do not specify a timezone — the times are typically rendered in the local timezone of whoever clicked Export, so interpret these slots accordingly.
      </div>
      {selected && (
        <CaseDrilldown
          title={`Created · ${WEEKDAY_NAMES[selected.rowIdx]} ${String(selected.hourIdx).padStart(2, "0")}:00–${String(selected.hourIdx).padStart(2, "0")}:59`}
          rows={drilldownRows}
          onClose={() => setSelected(null)}
        />
      )}
    </Card>
  );
}

/* ================= Trends Over Time ================= */
const fmtAxisDate = (ts) => {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
};
const fmtWeekLabel = (ts) => {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};
const fmtFullDate = (ts) => {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

function TrajectoryBlock({ rows, highlightRange }) {
  const trajectory = useMemo(() => dailyTrajectory(rows), [rows]);
  const weekly = useMemo(() => weeklyIntakeResolved(rows), [rows]);
  const hl = highlightRange && highlightRange.from != null && highlightRange.to != null ? highlightRange : null;

  if (!trajectory.length) {
    return (
      <Card>
        <div style={{ color: T.sub, fontSize: 13, fontStyle: "italic" }}>Not enough date range to plot a trajectory.</div>
      </Card>
    );
  }

  const tickInterval = Math.max(1, Math.floor(trajectory.length / 8));
  const dayPad = 12 * 36e5; // half a day buffer so end-bars don't clip the axis
  const weekPad = 3.5 * 864e5; // half a week buffer for the weekly chart

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Card>
        <div className="eyebrow" style={{ color: T.muted, textAlign: "left" }}>Backlog trajectory · daily</div>
        <div style={{ color: T.sub, fontSize: 12, marginTop: 4, textAlign: "left" }}>
          Open-case count per day from the oldest case to today. Faint bars behind the line show how many new cases were created that day. Rising line + steady bars = backlog growing; falling line = catching up.
        </div>
        <div style={{ height: 280, marginTop: 12 }}>
          <ResponsiveContainer>
            <ComposedChart data={trajectory} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={T.borderSoft} vertical={false} />
              <XAxis
                dataKey="date"
                type="number"
                domain={[(min) => min - dayPad, (max) => max + dayPad]}
                tickFormatter={fmtAxisDate}
                tick={{ fill: T.sub, fontSize: 11 }}
                axisLine={{ stroke: T.border }}
                tickLine={{ stroke: T.border }}
                interval={tickInterval}
              />
              <YAxis
                yAxisId="left"
                tick={{ fill: T.muted, fontSize: 11, fontFamily: "JetBrains Mono" }}
                axisLine={{ stroke: T.border }}
                tickLine={{ stroke: T.border }}
                allowDecimals={false}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fill: T.muted, fontSize: 11, fontFamily: "JetBrains Mono" }}
                axisLine={{ stroke: T.border }}
                tickLine={{ stroke: T.border }}
                allowDecimals={false}
              />
              <Tooltip content={<TrajectoryTip />} cursor={{ fill: T.surfaceAlt }} />
              <Legend wrapperStyle={{ fontSize: 11, color: T.sub }} />
              {hl && (
                <ReferenceArea
                  yAxisId="left"
                  x1={hl.from}
                  x2={hl.to}
                  fill={T.accent}
                  fillOpacity={0.08}
                  stroke={T.accent}
                  strokeOpacity={0.35}
                  ifOverflow="extendDomain"
                />
              )}
              <Bar yAxisId="right" dataKey="created" name="created (right axis)" fill={T.accentSoft} radius={[2, 2, 0, 0]} />
              <Line yAxisId="left" type="monotone" dataKey="open" name="open (left axis)" stroke={T.accent} strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card>
        <div className="eyebrow" style={{ color: T.muted, textAlign: "left" }}>Weekly intake vs. resolved</div>
        <div style={{ color: T.sub, fontSize: 12, marginTop: 4, textAlign: "left" }}>
          Cases created and cases resolved per week (Monday-anchored). The line is a rolling 4-week net (created − resolved): above zero = backlog growing, below zero = shrinking.
        </div>
        <div style={{ height: 260, marginTop: 12 }}>
          <ResponsiveContainer>
            <ComposedChart data={weekly} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={T.borderSoft} vertical={false} />
              <XAxis
                dataKey="week"
                type="number"
                domain={[(min) => min - weekPad, (max) => max + weekPad]}
                tickFormatter={fmtWeekLabel}
                tick={{ fill: T.sub, fontSize: 11 }}
                axisLine={{ stroke: T.border }}
                tickLine={{ stroke: T.border }}
                interval={Math.max(0, Math.floor(weekly.length / 10))}
              />
              <YAxis
                yAxisId="left"
                tick={{ fill: T.muted, fontSize: 11, fontFamily: "JetBrains Mono" }}
                axisLine={{ stroke: T.border }}
                tickLine={{ stroke: T.border }}
                allowDecimals={false}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fill: T.muted, fontSize: 11, fontFamily: "JetBrains Mono" }}
                axisLine={{ stroke: T.border }}
                tickLine={{ stroke: T.border }}
              />
              <Tooltip content={<WeeklyTip />} cursor={{ fill: T.surfaceAlt }} />
              <Legend wrapperStyle={{ fontSize: 11, color: T.sub }} />
              {hl && (
                <ReferenceArea
                  yAxisId="left"
                  x1={hl.from}
                  x2={hl.to}
                  fill={T.accent}
                  fillOpacity={0.08}
                  stroke={T.accent}
                  strokeOpacity={0.35}
                  ifOverflow="extendDomain"
                />
              )}
              <Bar yAxisId="left" dataKey="created" name="created" fill={T.accent} radius={[2, 2, 0, 0]} />
              <Bar yAxisId="left" dataKey="resolved" name="resolved" fill={T.ok} radius={[2, 2, 0, 0]} />
              <Line yAxisId="right" type="monotone" dataKey="rollingNet" name="rolling net (4wk avg)" stroke={T.ink} strokeWidth={1.5} dot={false} strokeDasharray="4 3" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}

function TrajectoryTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, padding: "8px 12px", borderRadius: 4, fontSize: 12 }}>
      <div style={{ fontWeight: 600 }}>{fmtFullDate(d.date)}</div>
      <div className="mono" style={{ color: T.sub }}>{d.open} open</div>
      <div className="mono" style={{ color: T.sub }}>{d.created} created · {d.closed} closed</div>
    </div>
  );
}

function WeeklyTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const netColor = d.net > 0 ? T.danger : d.net < 0 ? T.ok : T.muted;
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, padding: "8px 12px", borderRadius: 4, fontSize: 12 }}>
      <div style={{ fontWeight: 600 }}>Week of {fmtFullDate(d.week)}</div>
      <div className="mono" style={{ color: T.sub }}>{d.created} created · {d.resolved} resolved</div>
      <div className="mono" style={{ color: netColor }}>net {d.net > 0 ? "+" : ""}{d.net} · 4wk avg {d.rollingNet > 0 ? "+" : ""}{d.rollingNet}</div>
    </div>
  );
}

/* ================= Workload Distribution ================= */
function WorkloadDistributionBlock({ members }) {
  const lorenz = useMemo(() => workloadConcentration(members), [members]);

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div>
          <div className="eyebrow" style={{ color: T.muted, textAlign: "left" }}>Workload concentration</div>
          <div style={{ color: T.sub, fontSize: 12, marginTop: 4, textAlign: "left", maxWidth: 600 }}>
            How evenly cases are distributed across the team. The dashed diagonal is perfect equality; the further the curve sags below it, the more concentrated the workload — meaning a few analysts carry most of the cases.
          </div>
          <div style={{ color: T.muted, fontSize: 11, marginTop: 6, textAlign: "left", maxWidth: 600, fontStyle: "italic" }}>
            Gini score summarizes that gap in a single number: <strong style={{ color: T.sub }}>0</strong> = perfectly even (every analyst handles the same share), <strong style={{ color: T.sub }}>1</strong> = one analyst handles everything. Rough read: under 0.3 is balanced, 0.3–0.4 leans uneven, 0.4+ typically signals real concentration worth investigating.
          </div>
        </div>
        <div className="mono" style={{ fontSize: 12, color: T.sub, textAlign: "right" }}>
          <div>Top 20% carries <span style={{ color: lorenz.top20Share >= 60 ? T.danger : lorenz.top20Share >= 40 ? T.warn : T.ink, fontWeight: 600 }}>{lorenz.top20Share.toFixed(0)}%</span></div>
          <div>Top 50% carries <span style={{ color: T.ink, fontWeight: 600 }}>{lorenz.top50Share.toFixed(0)}%</span></div>
          <div>Gini <span style={{ color: T.ink, fontWeight: 600 }}>{lorenz.gini.toFixed(2)}</span></div>
        </div>
      </div>
      <div style={{ height: 280, marginTop: 12 }}>
        <ResponsiveContainer>
          <LineChart margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={T.borderSoft} />
            <XAxis
              type="number"
              dataKey="x"
              domain={[0, 1]}
              ticks={[0, 0.25, 0.5, 0.75, 1]}
              tickFormatter={(v) => `${Math.round(v * 100)}%`}
              tick={{ fill: T.sub, fontSize: 11 }}
              axisLine={{ stroke: T.border }}
              tickLine={{ stroke: T.border }}
            />
            <YAxis
              type="number"
              dataKey="y"
              domain={[0, 1]}
              ticks={[0, 0.25, 0.5, 0.75, 1]}
              tickFormatter={(v) => `${Math.round(v * 100)}%`}
              tick={{ fill: T.muted, fontSize: 11, fontFamily: "JetBrains Mono" }}
              axisLine={{ stroke: T.border }}
              tickLine={{ stroke: T.border }}
            />
            <Tooltip content={<LorenzTip total={lorenz.totalCases} />} />
            <Line
              data={[{ x: 0, y: 0 }, { x: 1, y: 1 }]}
              dataKey="y"
              stroke={T.muted}
              strokeWidth={1}
              strokeDasharray="4 4"
              dot={false}
              isAnimationActive={false}
              name="equality"
            />
            <Line
              data={lorenz.points}
              dataKey="y"
              stroke={T.accent}
              strokeWidth={2}
              type="monotone"
              dot={false}
              isAnimationActive={false}
              name="actual"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {lorenz.nAnalysts <= 1 && (
        <div style={{ color: T.sub, fontSize: 13, fontStyle: "italic", marginTop: 8 }}>Need at least 2 analysts to compare distribution.</div>
      )}
    </Card>
  );
}

function LorenzTip({ active, payload, total }) {
  if (!active || !payload?.length) return null;
  // The chart has two overlapping lines (equality + Lorenz). Prefer the entry
  // that carries actual analyst data, not the equality reference.
  const entry = payload.find((p) => p.payload && p.payload.name) || payload[0];
  const d = entry.payload;
  if (d.x === 0 && d.y === 0) return null;
  const xPct = (d.x * 100).toFixed(0);
  const yPct = (d.y * 100).toFixed(0);
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, padding: "8px 12px", borderRadius: 4, fontSize: 12 }}>
      {d.name && <div style={{ fontWeight: 600 }}>{d.name}</div>}
      <div className="mono" style={{ color: T.sub }}>Bottom {xPct}% of analysts</div>
      <div className="mono" style={{ color: T.sub }}>handle {yPct}% of cases</div>
      {d.count != null && <div className="mono" style={{ color: T.muted, marginTop: 4 }}>{d.count} of {total} total</div>}
    </div>
  );
}

/* ================= Categories ================= */
function CategoryBlock({ categoryData, enriched }) {
  const total = categoryData.reduce((s, c) => s + c.count, 0);
  const max = Math.max(...categoryData.map((c) => c.count), 1);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 12 }}>
      <Card>
        <div className="eyebrow" style={{ color: T.muted }}>Category distribution</div>
        <div style={{ color: T.sub, fontSize: 12, marginTop: 4 }}>Cases bucketed by problem area. The bar length is volume; the percentage is share of total.</div>
        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          {categoryData.map((c) => {
            const pct = (c.count / total) * 100;
            const width = (c.count / max) * 100;
            return (
              <div key={c.name}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                  <span>{c.name}</span>
                  <span className="mono" style={{ color: T.sub }}>{c.count} · {pct.toFixed(1)}%</span>
                </div>
                <div style={{ height: 8, background: T.surfaceAlt, borderRadius: 2, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${width}%`, background: T.accent, transition: "width 0.4s" }} />
                </div>
              </div>
            );
          })}
        </div>
      </Card>
      <Card>
        <div className="eyebrow" style={{ color: T.muted }}>Signal words in resolution notes</div>
        <div style={{ color: T.sub, fontSize: 12, marginTop: 4 }}>The most-mentioned words across short descriptions, work notes, and resolution notes. Larger, darker = more frequent. Useful for spotting recurring language and themes the categories may miss.</div>
        <KeywordCloud enriched={enriched} />
      </Card>
    </div>
  );
}

function KeywordCloud({ enriched }) {
  const STOP = new Set(("a an the and or of to in is it for with on from as at be by this that was were are have has been will but not can also so if then we i our my me your you they their them he she his her its").split(" "));
  const counts = {};
  for (const r of enriched) {
    const text = (r.close_notes || "") + " " + (r.short_description || "") + " " + (r.work_notes || "");
    const words = text.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/);
    for (const w of words) if (w.length >= 4 && !STOP.has(w) && isNaN(w)) counts[w] = (counts[w] || 0) + 1;
  }
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 25);
  const max = top[0]?.[1] || 1;
  return (
    <div style={{ marginTop: 16, display: "flex", flexWrap: "wrap", gap: "6px 10px", lineHeight: 1.6, minHeight: 180 }}>
      {top.length === 0 ? (
        <span style={{ color: T.sub, fontStyle: "italic", fontSize: 13 }}>Not enough text to extract signal words.</span>
      ) : top.map(([w, c]) => {
        const size = 11 + (c / max) * 12;
        const weight = c / max > 0.6 ? 600 : 400;
        const op = 0.5 + (c / max) * 0.5;
        return (
          <span key={w} style={{ fontSize: size, fontWeight: weight, color: T.ink, opacity: op, fontFamily: "Fraunces, serif" }} title={`${c} mentions`}>
            {w}
          </span>
        );
      })}
    </div>
  );
}

/* ================= Accounts / Products ================= */
function AccountProductBlock({ accountData, productData }) {
  const max = Math.max(...accountData.map((c) => c.count), 1);
  const COLORS = [T.accent, "#6B7A8F", T.ok, T.warn, "#8A5C9E", "#7A8F6B", "#B88A4C", "#8F6B7A"];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 12 }}>
      <Card>
        <div className="eyebrow" style={{ color: T.muted }}>Top accounts by case volume</div>
        <div style={{ color: T.sub, fontSize: 12, marginTop: 4 }}>Customers driving the most cases. A heavily concentrated list can signal an unstable customer or one ripe for a deeper review.</div>
        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
          {accountData.map((a) => (
            <div key={a.name} style={{ display: "grid", gridTemplateColumns: "1fr 60px", alignItems: "center", gap: 12, fontSize: 13 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: "0 0 180px" }}>{a.name}</span>
                <div style={{ flex: 1, height: 6, background: T.surfaceAlt, borderRadius: 2, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${(a.count / max) * 100}%`, background: T.ink, transition: "width 0.4s" }} />
                </div>
              </div>
              <span className="mono" style={{ color: T.sub, textAlign: "right" }}>{a.count}</span>
            </div>
          ))}
        </div>
      </Card>
      <Card>
        <div className="eyebrow" style={{ color: T.muted }}>Product line mix</div>
        <div style={{ color: T.sub, fontSize: 12, marginTop: 4 }}>Share of cases per product line — shows which products generate the most support load.</div>
        <div style={{ height: 240, marginTop: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <ResponsiveContainer>
            <PieChart>
              <Pie data={productData} dataKey="count" nameKey="name" innerRadius={60} outerRadius={90} paddingAngle={2}>
                {productData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip content={<ProductTip />} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 4 }}>
          {productData.map((p, i) => (
            <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
              <span style={{ width: 10, height: 10, background: COLORS[i % COLORS.length], borderRadius: 2 }} />
              <span style={{ flex: 1 }}>{p.name}</span>
              <span className="mono" style={{ color: T.sub }}>{p.count}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function ProductTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, padding: "8px 12px", borderRadius: 4, fontSize: 12 }}>
      <div style={{ fontWeight: 600 }}>{d.name}</div>
      <div className="mono" style={{ color: T.sub }}>{d.count} cases</div>
    </div>
  );
}

/* ================= AI ================= */
function AiBlock({ state, run, hasData }) {
  if (state.loading) {
    return (
      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "20px 0" }}>
          <Loader2 size={20} style={{ color: T.accent, animation: "spin 1s linear infinite" }} />
          <div>
            <div style={{ fontWeight: 600 }}>Reading resolution notes…</div>
            <div style={{ color: T.sub, fontSize: 13, marginTop: 2 }}>Sampling cases, detecting themes, surfacing gaps.</div>
          </div>
        </div>
      </Card>
    );
  }
  if (state.error) {
    return (
      <Card>
        <div style={{ color: T.danger, fontSize: 13 }}>
          <AlertTriangle size={14} style={{ verticalAlign: "middle" }} /> {state.error}
        </div>
        <button onClick={run} style={btnPrimary}>Try again</button>
      </Card>
    );
  }
  if (!state.result) {
    return (
      <Card>
        <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 300 }}>
            <div className="display" style={{ fontSize: 20, fontWeight: 500 }}>
              Let Claude read the notes.
            </div>
            <div style={{ color: T.sub, fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>
              Send a sampled, anonymized slice of your cases to Claude Sonnet for a qualitative read — themes,
              recurring issues, KB gaps, and skill areas that would sharpen your queue.
            </div>
          </div>
          <button disabled style={{ ...btnPrimary, opacity: 0.5, cursor: "not-allowed" }}>
            <Sparkles size={14} /> Generate insights
          </button>
        </div>
        <div style={{ marginTop: 12, padding: "10px 14px", border: `1px dashed ${T.warn}`, borderRadius: 4, background: T.warnSoft + "55", color: T.sub, fontSize: 12, display: "flex", alignItems: "center", gap: 8 }}>
          <AlertTriangle size={14} style={{ color: T.warn, flex: "0 0 auto" }} />
          <span><strong style={{ color: T.ink }}>This feature is not yet enabled.</strong> AI insights will turn on once the Claude API integration is wired up in this environment.</span>
        </div>
      </Card>
    );
  }
  const r = state.result;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
      <AiList title="Themes" icon={<TrendingUp size={13} />} items={r.themes?.map((t) => ({ h: t.title, b: t.description }))} />
      <AiList title="Recurring issues" icon={<Activity size={13} />} items={r.recurring_issues?.map((t) => ({ h: t.issue, b: t.evidence }))} />
      <AiList title="Skill opportunities" icon={<Sparkles size={13} />} items={r.skill_opportunities?.map((t) => ({ h: t.area, b: t.why }))} />
      <AiList title="Knowledge base gaps" icon={<Info size={13} />} items={r.kb_gaps?.map((t) => ({ h: t.gap, b: t.why }))} />
      {r.watch_outs?.length > 0 && (
        <div style={{ gridColumn: "1 / -1" }}>
          <Card>
            <div className="eyebrow" style={{ color: T.muted, display: "flex", alignItems: "center", gap: 6 }}>
              <AlertTriangle size={13} /> Watch-outs
            </div>
            <ul style={{ margin: "12px 0 0", paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>
              {r.watch_outs.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}

function AiList({ title, icon, items }) {
  return (
    <Card>
      <div className="eyebrow" style={{ color: T.muted, display: "flex", alignItems: "center", gap: 6 }}>
        {icon} {title}
      </div>
      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>
        {(items || []).map((it, i) => (
          <div key={i} style={{ paddingBottom: 12, borderBottom: i < items.length - 1 ? `1px solid ${T.borderSoft}` : "none" }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{it.h}</div>
            <div style={{ color: T.sub, fontSize: 13, marginTop: 4, lineHeight: 1.5 }}>{it.b}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

const btnPrimary = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "10px 18px",
  background: T.ink,
  color: T.surface,
  border: "none",
  borderRadius: 6,
  fontFamily: "DM Sans, sans-serif",
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
  marginTop: 8,
};

/* ================= Survey placeholder ================= */
function SurveyPlaceholder() {
  return (
    <Card style={{ background: T.surfaceAlt, borderStyle: "dashed" }}>
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        <div style={{ padding: 10, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6 }}>
          <Mailbox size={18} style={{ color: T.muted }} />
        </div>
        <div style={{ flex: 1 }}>
          <div className="eyebrow" style={{ color: T.muted }}>Coming online</div>
          <div style={{ fontWeight: 600, fontSize: 15, marginTop: 4 }}>
            Customer survey responses — not yet exposed in ServiceNow
          </div>
          <div style={{ color: T.sub, fontSize: 13, marginTop: 6, lineHeight: 1.55, maxWidth: 720 }}>
            Your manager grades the CSAT surveys manually today. Once survey results become a queryable ServiceNow
            table or view, this panel will plot score distribution, correlate CSAT against SLA and category,
            and flag accounts whose sentiment diverges from their ticket behavior. For now, drop survey exports
            here when you get them and the pipeline is ready.
          </div>
          <div style={{ display: "flex", gap: 20, marginTop: 14, fontSize: 12, color: T.muted, flexWrap: "wrap" }}>
            <span>· Score distribution</span>
            <span>· CSAT vs SLA correlation</span>
            <span>· Sentiment vs ticket volume</span>
            <span>· Comments themes</span>
          </div>
        </div>
      </div>
    </Card>
  );
}

/* ================= Table ================= */
function CaseTable({ rows }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState({ key: "sys_created_on", dir: "desc" });

  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = rows;
    if (q) {
      out = out.filter((r) =>
        [r.number, r.short_description, r.account, r.priority, r.state, r._category]
          .some((v) => String(v || "").toLowerCase().includes(q))
      );
    }
    const k = sort.key;
    out = [...out].sort((a, b) => {
      let av = a[k], bv = b[k];
      if (k === "sys_created_on" || k === "closed_at") {
        av = a[k === "sys_created_on" ? "_created" : "_closed"];
        bv = b[k === "sys_created_on" ? "_created" : "_closed"];
      }
      if (k === "priority") {
        av = priorityRank(av); bv = priorityRank(bv);
      }
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av < bv) return sort.dir === "asc" ? -1 : 1;
      if (av > bv) return sort.dir === "asc" ? 1 : -1;
      return 0;
    });
    return out;
  }, [rows, query, sort]);

  const toggleSort = (key) => {
    setSort((s) => s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" });
  };

  const cols = [
    { key: "number", label: "Case" },
    { key: "priority", label: "Priority" },
    { key: "state", label: "State" },
    { key: "_category", label: "Category" },
    { key: "account", label: "Account" },
    { key: "short_description", label: "Short description" },
    { key: "sys_created_on", label: "Created" },
    { key: "made_sla", label: "SLA" },
  ];

  return (
    <Card style={{ padding: 0 }}>
      <div style={{ padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${T.borderSoft}` }}>
        <input
          placeholder="Search case, account, description…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
            border: `1px solid ${T.border}`,
            borderRadius: 4,
            padding: "7px 10px",
            fontSize: 13,
            fontFamily: "DM Sans, sans-serif",
            background: T.surface,
            color: T.ink,
            width: 280,
          }}
        />
        <div className="mono" style={{ fontSize: 12, color: T.sub }}>{sorted.length} rows</div>
      </div>
      <div className="scrollbar" style={{ maxHeight: 520, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead style={{ position: "sticky", top: 0, background: T.surface, zIndex: 1 }}>
            <tr>
              {cols.map((c) => (
                <th
                  key={c.key}
                  onClick={() => toggleSort(c.key)}
                  style={{
                    textAlign: "left",
                    padding: "10px 14px",
                    fontFamily: "JetBrains Mono, monospace",
                    fontSize: 10,
                    textTransform: "uppercase",
                    letterSpacing: "0.12em",
                    color: T.muted,
                    cursor: "pointer",
                    borderBottom: `1px solid ${T.border}`,
                    userSelect: "none",
                  }}
                >
                  {c.label}{sort.key === c.key ? (sort.dir === "asc" ? " ↑" : " ↓") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.number} style={{ borderBottom: `1px solid ${T.borderSoft}` }}>
                <td className="mono" style={tdStyle}>{r.number}</td>
                <td style={tdStyle}>
                  <Pill color={priorityColor(r.priority)}>{String(r.priority || "").split(" - ")[1] || r.priority || "—"}</Pill>
                </td>
                <td style={tdStyle}>{r.state}</td>
                <td style={tdStyle}>{r._category}</td>
                <td style={{ ...tdStyle, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.account}</td>
                <td style={{ ...tdStyle, maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.short_description}</td>
                <td className="mono" style={{ ...tdStyle, color: T.sub }}>{r._created ? r._created.toISOString().slice(0, 10) : "—"}</td>
                <td style={tdStyle}>
                  {r.made_sla === "" || r.made_sla == null ? "—" : r._madeSla ? (
                    <CheckCircle2 size={14} style={{ color: T.ok }} />
                  ) : (
                    <XCircle size={14} style={{ color: T.danger }} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

const tdStyle = { padding: "10px 14px", verticalAlign: "middle" };

function Pill({ color, children }) {
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 8px",
      borderRadius: 100,
      background: color + "22",
      color,
      fontSize: 10,
      fontWeight: 600,
      letterSpacing: "0.04em",
      textTransform: "uppercase",
      fontFamily: "JetBrains Mono, monospace",
    }}>{children}</span>
  );
}

/* ================= Footer ================= */
function Footer() {
  return (
    <div style={{ marginTop: 60, paddingTop: 20, borderTop: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", color: T.muted, fontSize: 11 }}>
      <span className="eyebrow">Infor · Product Support · KPI Analyzer</span>
      <span className="mono">data processed locally · survey module pending ServiceNow access</span>
    </div>
  );
}
