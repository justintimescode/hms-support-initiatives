// DoD parent-account grouping.
//
// The app is focused on Department of Defense support. Every ServiceNow case
// carries a "Parent Account" (the customer-hierarchy parent), and the DoD
// customers roll up to four branch HQs. The parent-account visualizations on the
// Accounts and Trends tabs count ONLY cases whose parent account is one of these
// four branches; cases with any OTHER parent account, or none, are intentionally
// excluded (per product direction — this app is DoD-scoped).
//
// `parent_account` reaches the in-memory enriched row as a raw passthrough:
// normalizeXlsxRow (enrich.js) maps the XLSX "Parent Account" column, and CSV
// exports carry the system field name directly (see parseFileToRows in
// useAppData.js). enrichRow spreads `...r`, so the field rides along on every
// enriched row without a dedicated SQL column — the same treatment as other
// display-only raw fields like `contact` and `cause`.

import { startOfMonday } from "./stats.js";

// The four DoD branch parent accounts, in a stable display order.
//   `name`  — the exact ServiceNow "Parent Account" value.
//   `id`    — a safe, whitespace-free key for chart dataKeys / maps.
//   `label` — legend / axis text.
//   `color` — fixed, branch-evocative hex, readable on both light and dark
//             surfaces (chart palettes here use raw hex; see AccountProductBlock).
export const DOD_PARENT_ACCOUNTS = [
  { id: "airforce",   name: "Armed Forces - Air Force (HQ)",   label: "Air Force",   color: "#4C6FB8" },
  { id: "army",       name: "Armed Forces - Army (HQ)",        label: "Army",        color: "#5A6B3C" },
  { id: "navy",       name: "Armed Forces - Navy (HQ)",        label: "Navy",        color: "#2E4A6B" },
  { id: "navylodges", name: "Armed Forces - Navy Lodges (HQ)", label: "Navy Lodges", color: "#3E7C8F" },
];

// Normalize a parent-account string for matching: trim, collapse internal runs of
// whitespace to a single space, lowercase. ServiceNow occasionally double-spaces
// hierarchy labels, so plain string equality would miss otherwise-identical
// values. Exact-string (not substring) matching, so "Navy" never swallows
// "Navy Lodges".
const normKey = (s) => String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase();

// canonical normalized-name -> branch descriptor
const BY_KEY = new Map(DOD_PARENT_ACCOUNTS.map((b) => [normKey(b.name), b]));

/** The raw parent-account string on an (enriched) row, trimmed, or null. Reads
 *  the mapped `parent_account` first (XLSX, and CSV whose header already is that
 *  system field name), then a couple of likely raw CSV header spellings as a
 *  best-effort fallback. */
export function parentAccountRaw(row) {
  if (!row) return null;
  const v =
    row.parent_account ??
    row["Parent Account"] ??
    row["Parent account"] ??
    row.parent ??
    null;
  const s = v == null ? "" : String(v).trim();
  return s || null;
}

/** The DoD branch descriptor a row rolls up to, or null when its parent account
 *  is not one of the four branches (or is missing). This is the single gate every
 *  DoD visualization uses to drop non-DoD / unassigned cases. */
export function dodBranchOf(row) {
  return BY_KEY.get(normKey(parentAccountRaw(row))) || null;
}

/** Keep only rows belonging to a DoD branch (drops other / no parent account). */
export function filterDodRows(rows) {
  return (rows || []).filter((r) => dodBranchOf(r) != null);
}

/** Per-branch case counts for the Accounts tab. Always returns all four branches
 *  in `DOD_PARENT_ACCOUNTS` order (a branch with no cases in the current view
 *  shows as zero, so the chart's category set is stable), each with a lifecycle
 *  split (open / solution-proposed / closed) and SOP-SLA compliance. Lifecycle is
 *  read from the baked `_lifecycle` bucket (see enrich.js v8); SLA from the
 *  SOP-cadence flags (`_slaEligible` / `_slaBreached`, see computeSlaSop). */
export function dodParentAccountStats(rows) {
  const stats = new Map(
    DOD_PARENT_ACCOUNTS.map((b) => [
      b.id,
      { ...b, total: 0, open: 0, solutionProposed: 0, closed: 0, slaEligible: 0, slaMet: 0 },
    ]),
  );
  for (const r of rows || []) {
    const b = dodBranchOf(r);
    if (!b) continue;
    const s = stats.get(b.id);
    s.total++;
    if (r._lifecycle === "closed") s.closed++;
    else if (r._lifecycle === "solution_proposed") s.solutionProposed++;
    else s.open++;
    if (r._slaEligible) {
      s.slaEligible++;
      if (!r._slaBreached) s.slaMet++;
    }
  }
  return DOD_PARENT_ACCOUNTS.map((b) => {
    const s = stats.get(b.id);
    return { ...s, slaPct: s.slaEligible ? (s.slaMet / s.slaEligible) * 100 : null };
  });
}

/** Total DoD-case count across all four branches in `rows`. */
export function dodTotal(rows) {
  return filterDodRows(rows).length;
}

/** Weekly case-intake volume per DoD branch for the Trends tab. Monday-anchored
 *  weeks from the oldest DoD case's creation date through the snapshot (`refNow`),
 *  matching `weeklyIntakeResolved` so the x-axis aligns with the other trend
 *  charts. Each bucket carries one count per branch id plus a `total`. `refNow`
 *  should be the data snapshot timestamp so the series is deterministic per
 *  import. Returns [] when there are no dated DoD cases. */
export function weeklyDodParentVolume(rows, refNow = Date.now()) {
  const dod = filterDodRows(rows).filter((r) => r._created);
  if (!dod.length) return [];
  let minDate = null;
  for (const r of dod) {
    if (!minDate || r._created < minDate) minDate = r._created;
  }
  const startWeek = startOfMonday(minDate);
  const endWeek = startOfMonday(new Date(refNow));
  const totalWeeks = Math.floor((endWeek - startWeek) / (7 * 864e5)) + 1;
  if (totalWeeks < 1 || totalWeeks > 520) return []; // ~10-year guard

  const buckets = new Map();
  for (let i = 0; i < totalWeeks; i++) {
    const wk = new Date(startWeek);
    wk.setDate(wk.getDate() + i * 7);
    const row = { week: wk.getTime(), total: 0 };
    for (const b of DOD_PARENT_ACCOUNTS) row[b.id] = 0;
    buckets.set(wk.getTime(), row);
  }
  for (const r of dod) {
    const b = dodBranchOf(r);
    const bucket = buckets.get(startOfMonday(r._created).getTime());
    if (bucket && b) {
      bucket[b.id]++;
      bucket.total++;
    }
  }
  return Array.from(buckets.values()).sort((a, b) => a.week - b.week);
}

/** Cumulative (running-total) case count per DoD branch, derived from the weekly
 *  series. Each returned bucket carries the running total per branch id plus a
 *  `total`. Shows how each branch's overall book of cases has grown over time. */
export function cumulativeDodParentVolume(rows, refNow = Date.now()) {
  const weekly = weeklyDodParentVolume(rows, refNow);
  const running = {};
  for (const b of DOD_PARENT_ACCOUNTS) running[b.id] = 0;
  let total = 0;
  return weekly.map((w) => {
    const row = { week: w.week };
    for (const b of DOD_PARENT_ACCOUNTS) {
      running[b.id] += w[b.id];
      row[b.id] = running[b.id];
    }
    total += w.total;
    row.total = total;
    return row;
  });
}
