// Dimension registry, cluster selectors and drill-down for the insight layer.
//
// Two design rules, both load-bearing:
//
//   FILTERS NEVER RE-CORRELATE. Correlation happens once, memoized on
//   [rows, issues, snapshotMs]. Everything here operates on the RESULT. The
//   selectors filter and never map or clone, so a filtered list contains the
//   very same cluster objects by reference — which is how a test can prove no
//   re-correlation happened.
//
//   AN ABSENT DIMENSION SAYS SO. Every dimension declares the export column that
//   would light it up, and `available` is resolved from the ACTIVE import — so a
//   column this export lacks renders "not available in this export" rather than a
//   misleading zero. Same honest-absence pattern as AiEffectivenessBlock.jsx.
//
//   (Region and Assignment group were originally declared here as permanently
//   unavailable, on the stated premise that no ServiceNow layout provides them.
//   Inspecting a real export disproved that — both columns are present and were
//   merely unmapped. They are now ordinary dimensions.)
//
// A cluster survives a filter when AT LEAST ONE of its members matches, and its
// `metrics` are never recomputed against the filtered subset: a Jira blocking
// five cases across three analysts still blocks five cases. `matchedCasesOf`
// gives the UI the subset for its "N of M" chip and the drill-down default.

import { SIDE_CASE, SIDE_JIRA, medianOf } from './insight-metrics.js';
import {
  URGENCY_CRITICAL, URGENCY_HIGH, URGENCY_MEDIUM,
  ESCALATION_LEVELS, BAND_HIGH, BAND_MEDIUM, BAND_LOW,
} from './insight-thresholds.js';

const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const nonEmpty = (v) => v != null && String(v).trim() !== '';
const one = (v) => (nonEmpty(v) ? [String(v)] : []);
const many = (arr) => (Array.isArray(arr) ? arr.filter(nonEmpty).map(String) : []);

/** The "No manager" sentinel the global filter bar uses (useAppData groups a
 *  blank manager under this label, so the cluster filter must match it). */
export const NO_MANAGER = 'No manager';
export const UNASSIGNED = 'Unassigned';

/* --------------------------- dimension registry --------------------------- */

/**
 * Every filterable dimension, declared up front.
 *
 * `side`         which member list the values come from
 * `valuesOfMember` the values one member contributes (may be several, e.g. fixVersions)
 * `needs`        the export column that would light it up, for the unavailable state
 * `declaredOnly` true for a dimension no export layout can supply, so it reports
 *                unavailable even with data loaded. None currently — the mechanism
 *                is kept for a genuinely unsupplyable dimension.
 */
export const DIMENSIONS = [
  /* ---- ServiceNow case side ---- */
  {
    id: 'account', label: 'Account', side: SIDE_CASE,
    needs: 'an `Account` column',
    valuesOfMember: (c) => one(c.account),
  },
  {
    id: 'parentAccount', label: 'Parent account', side: SIDE_CASE,
    needs: 'a `Parent Account` column',
    // The customer-hierarchy parent (the DoD branch grouping). A separate
    // dimension from Region — never conflated with it.
    valuesOfMember: (c) => one(c.parentAccount),
  },
  {
    id: 'productLine', label: 'Product line', side: SIDE_CASE,
    needs: 'a `Product line` column',
    valuesOfMember: (c) => one(c.productLine),
  },
  // `globalOnly`: already owned by the app-wide filter bar (useFilters), which
  // serializes analyst/manager as OPAQUE tokens precisely so a person's name
  // never lands in a URL (SECURITY #3). These stay in the registry — faceting and
  // `filterClusters`' analyst/manager criteria both use them — but the view-local
  // filter bar must not offer them a second time.
  {
    id: 'assignedTo', label: 'Analyst', side: SIDE_CASE, globalOnly: true,
    needs: 'an `Assigned to` column',
    valuesOfMember: (c) => [c.assignedTo ? String(c.assignedTo) : UNASSIGNED],
  },
  {
    id: 'manager', label: 'Manager', side: SIDE_CASE, globalOnly: true,
    needs: 'a `Manager` (or `assigned_to.manager`) column',
    valuesOfMember: (c) => [c.manager ? String(c.manager) : NO_MANAGER],
  },
  {
    id: 'priority', label: 'Case priority', side: SIDE_CASE,
    needs: 'a `Priority` column',
    valuesOfMember: (c) => one(c.priority),
  },
  {
    id: 'category', label: 'Category', side: SIDE_CASE,
    needs: 'a `Short Description` column (categories are derived from it)',
    valuesOfMember: (c) => one(c.category),
  },
  {
    id: 'lifecycle', label: 'Lifecycle', side: SIDE_CASE,
    needs: 'a `State` column',
    valuesOfMember: (c) => one(c.lifecycle),
  },
  {
    id: 'caseAgeBucket', label: 'Case age', side: SIDE_CASE,
    needs: 'a `Created` column',
    valuesOfMember: (c) => one(c.ageBucket),
  },

  /* ---- Jira side ---- */
  {
    id: 'jiraAssignee', label: 'Jira assignee', side: SIDE_JIRA,
    needs: 'a synced Jira connection',
    valuesOfMember: (j) => one(j.assignee),
  },
  {
    id: 'jiraPriority', label: 'Jira priority', side: SIDE_JIRA,
    needs: 'a synced Jira connection',
    valuesOfMember: (j) => one(j.priority),
  },
  {
    id: 'fixVersion', label: 'Fix version', side: SIDE_JIRA,
    needs: 'a synced Jira connection with fix versions set',
    valuesOfMember: (j) => many(j.fixVersions),
  },
  {
    id: 'statusCategory', label: 'Jira status', side: SIDE_JIRA,
    needs: 'a synced Jira connection',
    valuesOfMember: (j) => one(j.statusCategory),
  },
  {
    id: 'jiraAgeBucket', label: 'Jira age', side: SIDE_JIRA,
    needs: 'a synced Jira connection',
    valuesOfMember: (j) => one(j.ageBucket),
  },

  /* ---- real, but only on exports that carry the column ---- */
  //
  // `Region` and `Assignment group` were believed not to exist. They DO: the
  // standard ServiceNow case export ships both ("Region" = e.g. "NA",
  // "Assignment group" = e.g. "Hospitality - HMS Support"). They were invisible
  // to the app only because `normalizeXlsxRow` never mapped them, which is now
  // fixed. They are ordinary dimensions — `available` resolves from the data
  // like every other one, so an export that omits the column still says so
  // honestly rather than rendering a misleading zero.
  {
    id: 'region', label: 'Region', side: SIDE_CASE,
    needs: 'a `Region` column',
    valuesOfMember: (c) => one(c.region),
  },
  {
    id: 'assignmentGroup', label: 'Assignment group', side: SIDE_CASE,
    needs: 'an `Assignment group` column',
    valuesOfMember: (c) => one(c.assignmentGroup),
  },
];

const DIM_BY_ID = new Map(DIMENSIONS.map((d) => [d.id, d]));

/** Look up a dimension descriptor by id. */
export const dimensionById = (id) => DIM_BY_ID.get(id) || null;

/** Every value a cluster contributes for a dimension, deduped and sorted. */
export function valuesOf(cluster, dim) {
  const members = dim.side === SIDE_JIRA ? cluster.jira : cluster.cases;
  const out = new Set();
  for (const m of members || []) for (const v of dim.valuesOfMember(m)) out.add(v);
  return [...out].sort(cmpStr);
}

/**
 * Resolve each dimension's `available` flag against the ACTIVE import.
 *
 * Available means "at least one member in view carries a value". A column that
 * exists but is entirely blank is indistinguishable from one that is absent —
 * the same limitation AiEffectivenessBlock has — so the copy says "not available
 * in this export" rather than claiming the column is missing.
 */
export function resolveDimensions(clusters) {
  const list = clusters || [];
  return DIMENSIONS.map((d) => {
    if (d.declaredOnly) return { ...d, available: false };
    return { ...d, available: hasAnyValue(list, d) };
  });
}

function hasAnyValue(clusters, dim) {
  for (const cl of clusters) {
    const members = dim.side === SIDE_JIRA ? cl.jira : cl.cases;
    for (const m of members || []) {
      if (dim.valuesOfMember(m).length) return true;
    }
  }
  return false;
}

/* -------------------------------- selectors ------------------------------- */

/**
 * Does one case satisfy every case-side criterion at once?
 *
 * "At once" matters: a cluster with an Ana case and a P1 case must NOT survive a
 * filter for "Ana AND P1" unless a single case is both.
 */
function caseMatches(c, crit) {
  if (crit.analyst && crit.analyst !== '__all__') {
    if ((c.assignedTo || UNASSIGNED) !== crit.analyst) return false;
  }
  if (crit.manager && crit.manager !== '__all__') {
    if ((c.manager || NO_MANAGER) !== crit.manager) return false;
  }
  const dr = crit.dateRange;
  if (dr && (dr.from != null || dr.to != null)) {
    const ts = dr.field === '_closed' ? c.closedMs : c.createdMs;
    if (ts == null) return false;
    if (dr.from != null && ts < dr.from) return false;
    if (dr.to != null && ts > dr.to) return false;
  }
  for (const [id, selected] of Object.entries(crit.dimensions || {})) {
    if (!selected || !selected.length) continue;
    const dim = DIM_BY_ID.get(id);
    if (!dim || dim.side !== SIDE_CASE) continue;
    const vals = dim.valuesOfMember(c);
    if (!vals.some((v) => selected.includes(v))) return false;
  }
  return true;
}

function jiraMatches(j, crit) {
  for (const [id, selected] of Object.entries(crit.dimensions || {})) {
    if (!selected || !selected.length) continue;
    const dim = DIM_BY_ID.get(id);
    if (!dim || dim.side !== SIDE_JIRA) continue;
    const vals = dim.valuesOfMember(j);
    if (!vals.some((v) => selected.includes(v))) return false;
  }
  return true;
}

function clusterTextMatches(cl, needle) {
  const q = String(needle).trim().toLowerCase();
  if (!q) return true;
  for (const c of cl.cases) {
    if (String(c.number ?? '').toLowerCase().includes(q)) return true;
    if (String(c.shortDescription ?? '').toLowerCase().includes(q)) return true;
    if (String(c.account ?? '').toLowerCase().includes(q)) return true;
  }
  for (const j of cl.jira) {
    if (String(j.key ?? '').toLowerCase().includes(q)) return true;
    if (String(j.summary ?? '').toLowerCase().includes(q)) return true;
  }
  return false;
}

/** The cases in a cluster that satisfy the case-side criteria — the subset the
 *  UI highlights and the drill-down opens on. */
export function matchedCasesOf(cluster, criteria = {}) {
  return cluster.cases.filter((c) => caseMatches(c, criteria));
}

/** The Jiras in a cluster that satisfy the Jira-side criteria. */
export function matchedJiraOf(cluster, criteria = {}) {
  return cluster.jira.filter((j) => jiraMatches(j, criteria));
}

/**
 * Select clusters matching the criteria.
 *
 * Returns the SAME cluster objects, by reference — this function only ever
 * filters. That is deliberate and tested: identity preservation is the proof
 * that changing a filter cannot have re-run correlation.
 *
 * @param {object[]} clusters
 * @param {object} [criteria]
 * @param {string} [criteria.analyst]   '__all__' or a resolved analyst name
 * @param {string} [criteria.manager]   '__all__' or a resolved manager name
 * @param {object} [criteria.dateRange] { from, to, field } from useFilters
 * @param {Record<string,string[]>} [criteria.dimensions]  selected values per dimension id
 * @param {string[]} [criteria.bands]        keep only these bands
 * @param {string[]} [criteria.escalation]   keep only these escalation levels
 * @param {string[]} [criteria.flags]        keep only clusters carrying one of these flags
 * @param {string} [criteria.search]         free-text over case/Jira identifiers
 */
export function filterClusters(clusters, criteria = {}) {
  const list = clusters || [];
  const { bands, escalation, flags, search } = criteria;
  return list.filter((cl) => {
    if (bands && bands.length && !bands.includes(cl.band)) return false;
    if (escalation && escalation.length && !escalation.includes(cl.metrics.escalation.level)) return false;
    if (flags && flags.length && !flags.some((f) => cl.clusterFlags.includes(f))) return false;
    if (search && !clusterTextMatches(cl, search)) return false;
    // A cluster survives on ONE matching member — its metrics still describe the
    // whole cluster, so "5 cases blocked" stays true when you filter to one.
    if (!cl.cases.some((c) => caseMatches(c, criteria))) return false;
    if (!cl.jira.some((j) => jiraMatches(j, criteria))) return false;
    return true;
  });
}

/* ------------------------------- facet counts ----------------------------- */

/**
 * Counts per distinct value of a dimension, for the filter chips and the
 * click-through aggregates.
 *
 * `clusters` counts clusters carrying the value; `cases` / `openCases` count the
 * MEMBERS carrying it. Both reconcile exactly with `drillFacet` below — that
 * pairing is tested, because an aggregate that does not match its own drill-down
 * is worse than no aggregate.
 */
export function facetsOf(clusters, dim) {
  const acc = new Map();
  for (const cl of clusters || []) {
    const seen = new Set();
    const members = dim.side === SIDE_JIRA ? cl.jira : cl.cases;
    for (const m of members || []) {
      for (const v of dim.valuesOfMember(m)) {
        let e = acc.get(v);
        if (!e) {
          e = { value: v, clusters: 0, cases: 0, openCases: 0 };
          acc.set(v, e);
        }
        if (!seen.has(v)) {
          e.clusters++;
          seen.add(v);
        }
        e.cases++;
        if (dim.side === SIDE_CASE ? m.isOpen : m.isOpen === true) e.openCases++;
      }
    }
  }
  return [...acc.values()].sort((a, b) => b.clusters - a.clusters || cmpStr(a.value, b.value));
}

/**
 * The records behind one facet value — the drill-down target. Every aggregate on
 * screen must land on a real record list; this is that list.
 */
export function drillFacet(clusters, dim, value) {
  const outClusters = [];
  const members = [];
  for (const cl of clusters || []) {
    const list = dim.side === SIDE_JIRA ? cl.jira : cl.cases;
    const hits = (list || []).filter((m) => dim.valuesOfMember(m).includes(value));
    if (hits.length) {
      outClusters.push(cl);
      members.push(...hits);
    }
  }
  return dim.side === SIDE_JIRA
    ? { clusters: outClusters, jira: members, cases: [] }
    : { clusters: outClusters, cases: members, jira: [] };
}

/* --------------------------- band / risk rollups -------------------------- */

export const BANDS = [BAND_HIGH, BAND_MEDIUM, BAND_LOW];

/** Cluster counts per band, always all three rows so an empty band renders as
 *  zero rather than vanishing. */
export function bandCounts(clusters) {
  const counts = new Map(BANDS.map((b) => [b, 0]));
  for (const cl of clusters || []) counts.set(cl.band, (counts.get(cl.band) || 0) + 1);
  return BANDS.map((band) => ({ band, count: counts.get(band) || 0 }));
}

/** Cluster counts per escalation level, most severe first. */
export function escalationCounts(clusters) {
  const counts = new Map(ESCALATION_LEVELS.map((l) => [l, 0]));
  for (const cl of clusters || []) {
    const l = cl.metrics.escalation.level;
    counts.set(l, (counts.get(l) || 0) + 1);
  }
  return [...ESCALATION_LEVELS].reverse().map((level) => ({ level, count: counts.get(level) || 0 }));
}

/* ------------------------- escalation x urgency grid --------------------- */

// Urgency bands for the heatmap axis. `min` is an inclusive lower bound on the
// normalized 0..100 urgency; `null` catches clusters with no known priority,
// which get their OWN cell rather than being lumped in with Low (they are
// unknown, not low — see normalizePriority).
export const URGENCY_BANDS = [
  { id: 'critical', label: 'Critical', min: URGENCY_CRITICAL },
  { id: 'high', label: 'High', min: URGENCY_HIGH },
  { id: 'medium', label: 'Medium', min: URGENCY_MEDIUM },
  { id: 'low', label: 'Low', min: 1 },
  { id: 'unknown', label: 'Unknown', min: null },
];

export function urgencyBandOf(priorityNorm) {
  if (priorityNorm == null) return 'unknown';
  for (const b of URGENCY_BANDS) {
    if (b.min != null && priorityNorm >= b.min) return b.id;
  }
  return 'unknown';
}

/**
 * Escalation x urgency matrix for the heatmap. Every cell exists (so the grid is
 * rectangular and an empty cell reads as zero, not as missing), and every cell
 * carries the clusters behind it so a click lands on real records.
 */
export function escalationUrgencyMatrix(clusters) {
  const cells = new Map();
  const key = (esc, urg) => `${esc}|${urg}`;
  for (const level of ESCALATION_LEVELS) {
    for (const b of URGENCY_BANDS) {
      cells.set(key(level, b.id), { escalation: level, urgency: b.id, count: 0, openCases: 0, clusters: [] });
    }
  }
  for (const cl of clusters || []) {
    const c = cells.get(key(cl.metrics.escalation.level, urgencyBandOf(cl.metrics.priorityNorm)));
    if (!c) continue;
    c.count++;
    c.openCases += cl.metrics.volume.openCases;
    c.clusters.push(cl);
  }
  return {
    escalationLevels: [...ESCALATION_LEVELS].reverse(),
    urgencyBands: URGENCY_BANDS,
    cell: (esc, urg) => cells.get(key(esc, urg)) || null,
    cells: [...cells.values()],
  };
}

/* ----------------------------- age comparison ---------------------------- */

/**
 * Jira-age vs case-age distribution over the SAME bucket table, so the two
 * series are directly comparable on one axis. Counts MEMBERS, not clusters.
 */
export function ageComparison(clusters, buckets) {
  const rows = buckets.map((b) => ({ name: b.name, cases: 0, jira: 0 }));
  const byName = new Map(rows.map((r) => [r.name, r]));
  for (const cl of clusters || []) {
    for (const c of cl.cases) {
      const r = byName.get(c.ageBucket);
      if (r) r.cases++;
    }
    for (const j of cl.jira) {
      const r = byName.get(j.ageBucket);
      if (r) r.jira++;
    }
  }
  return rows;
}

/* --------------------------- per-Jira open counts ------------------------- */

/**
 * Open-case count per Jira key, grouped straight off the cluster edges.
 *
 * A deliberately lighter path than `blockersByJira`, which also re-runs the full
 * `scoreCluster` for every key. The impacted-cases histogram needs counts and a
 * drill-down list, not scores, and it recomputes on every filter change —
 * measured at 139 ms for a 20k-case import via the scoring path versus a few ms
 * here. Same `openCases` definition (truly-open only), so the two agree.
 */
export function openCasesPerJira(clusters) {
  const byKey = new Map();
  for (const cl of clusters || []) {
    const caseByNumber = new Map(cl.cases.map((c) => [c.number, c]));
    const jiraByKey = new Map(cl.jira.map((j) => [j.key, j]));
    for (const e of cl.edges) {
      let g = byKey.get(e.jiraKey);
      if (!g) {
        g = { key: e.jiraKey, jira: jiraByKey.get(e.jiraKey) || null, cases: [], openCount: 0 };
        byKey.set(e.jiraKey, g);
      }
      const c = caseByNumber.get(e.caseNumber);
      if (c && !g.cases.includes(c)) {
        g.cases.push(c);
        if (c.isOpen) g.openCount++;
      }
    }
  }
  return [...byKey.values()].sort((a, b) => b.openCount - a.openCount || cmpStr(a.key, b.key));
}

/* ------------------- per-Jira-key cross-cuts (Impact Clusters) ----------- *
 * These three take `blockersByJira()` rows (insight-rank.js) as input rather
 * than clusters — the page computes that once per render (same CORRELATE-ONCE
 * discipline as everything else here) and hands the rows to whichever of these
 * views it renders, so none of them can disagree about which cases belong to
 * which Jira key. */

export const JIRA_STATUS_CATEGORIES = [
  { id: 'To Do', label: 'To Do' },
  { id: 'In Progress', label: 'In Progress' },
  { id: 'Done', label: 'Done' },
  { id: 'unsynced', label: 'Not synced' },
];

/** Jira status category × impact band. Every cell exists (same rectangular-
 *  grid contract as `escalationUrgencyMatrix`), so an empty combination reads
 *  as zero, never as missing. `unsynced` catches keys with no live Jira record
 *  (an RN- reference, or a key the current sync doesn't have) — `projectJira`
 *  leaves THEIR `statusCategory` null rather than guessing, so this must too. */
export function jiraStatusBandMatrix(blockerRows) {
  const key = (sc, band) => `${sc}|${band}`;
  const cells = new Map();
  for (const sc of JIRA_STATUS_CATEGORIES) {
    for (const band of BANDS) cells.set(key(sc.id, band), { statusCategory: sc.id, band, count: 0, openCases: 0, rows: [] });
  }
  for (const r of blockerRows || []) {
    const sc = r.jira?.statusCategory ?? 'unsynced';
    const c = cells.get(key(sc, r.band));
    if (!c) continue;
    c.count++;
    c.openCases += r.metrics.volume.openCases;
    c.rows.push(r);
  }
  return {
    statusCategories: JIRA_STATUS_CATEGORIES,
    bands: BANDS,
    cell: (sc, band) => cells.get(key(sc, band)) || null,
    cells: [...cells.values()],
  };
}

/** Account × hot-Jira-key matrix: which customers sit behind which blocking
 *  tickets — a ticket hitting many DIFFERENT accounts (escalate loudly) reads
 *  differently from one hitting the SAME account repeatedly (an account
 *  conversation, not necessarily a bigger engineering fire). Scoped to the
 *  busiest `maxKeys` tickets by open-case count, then — WITHIN that scope —
 *  the busiest `maxAccounts` accounts, so the account ranking reflects the
 *  same picture the grid shows rather than the whole import. */
export function accountJiraMatrix(blockerRows, { maxAccounts = 8, maxKeys = 10 } = {}) {
  const ranked = [...(blockerRows || [])]
    .sort((a, b) => b.metrics.volume.openCases - a.metrics.volume.openCases || cmpStr(a.key, b.key))
    .slice(0, maxKeys);

  const accountTotals = new Map();
  for (const r of ranked) {
    for (const c of r.cases) {
      if (!c.account) continue;
      accountTotals.set(c.account, (accountTotals.get(c.account) || 0) + 1);
    }
  }
  const accounts = [...accountTotals.entries()]
    .sort((a, b) => b[1] - a[1] || cmpStr(a[0], b[0]))
    .slice(0, maxAccounts)
    .map(([name]) => name);
  const accountSet = new Set(accounts);

  const cellCases = new Map(); // `${account}|${key}` -> cases[]
  for (const r of ranked) {
    for (const c of r.cases) {
      if (!accountSet.has(c.account)) continue;
      const k = `${c.account}|${r.key}`;
      if (!cellCases.has(k)) cellCases.set(k, []);
      cellCases.get(k).push(c);
    }
  }
  return {
    accounts,
    keys: ranked.map((r) => ({ key: r.key, jira: r.jira, openCases: r.metrics.volume.openCases })),
    cell: (account, key) => cellCases.get(`${account}|${key}`) || [],
  };
}

/** Per-Jira-key points for the staleness × blast-radius scatter — deliberately
 *  UNBUCKETED, unlike the two matrices above: both axes are continuous and the
 *  whole point of this chart is triage precision ("340 days stale AND 12 open
 *  cases" beats "90+ days, 10+ cases"). A key with no live Jira record has no
 *  `daysSinceUpdate` to plot and is excluded, the same way `analystEfficiency`
 *  excludes an analyst with no measurable close. */
export function blockerQuadrant(blockerRows) {
  const points = [];
  for (const r of blockerRows || []) {
    if (r.jira?.daysSinceUpdate == null) continue;
    points.push({
      key: r.key,
      daysSinceUpdate: r.jira.daysSinceUpdate,
      openCases: r.metrics.volume.openCases,
      accounts: r.accounts.length,
      escalation: r.metrics.escalation.level,
      status: r.jira.status,
      summary: r.jira.summary,
      isStale: r.jira.isStale,
    });
  }
  return {
    points,
    medDaysSinceUpdate: medianOf(points.map((p) => p.daysSinceUpdate)),
    medOpenCases: medianOf(points.map((p) => p.openCases)),
  };
}

/* ------------------------- URL tokens for dimensions ---------------------- */
//
// SECURITY #3 / #8. `useFilters` serializes the analyst as an opaque index token
// (`?a=a4`) rather than a raw name, so a shared link leaks no personal data.
// View-local dimension filters follow the same rule and go further: EVERY value
// is an index into that dimension's value list, so no customer account name,
// region or assignment group reaches the URL either.
//
// A token is `<dimId>:<index>`. Only the FIRST colon separates them, so a value
// containing a colon is irrelevant (it is never written). An index that no longer
// resolves — different import, changed data — is ignored rather than guessed at,
// exactly like an out-of-range `?a=` token.
//
// Consequence, and it matches the existing behavior: a shared URL reproduces the
// same view only against the same import.

/** A dimension's distinct values in a STABLE order (by value, not by count) —
 *  the index space the URL tokens address. `facetsOf` sorts by count for display
 *  and must not be used here: a count change would silently re-point a token. */
export function facetValuesOf(clusters, dim) {
  const out = new Set();
  for (const cl of clusters || []) {
    const members = dim.side === SIDE_JIRA ? cl.jira : cl.cases;
    for (const m of members || []) for (const v of dim.valuesOfMember(m)) out.add(v);
  }
  return [...out].sort(cmpStr);
}

/** Opaque token for one selected value, or null when the value is unknown. */
export function encodeDimToken(dimId, value, clusters) {
  const dim = DIM_BY_ID.get(dimId);
  if (!dim) return null;
  const idx = facetValuesOf(clusters, dim).indexOf(value);
  return idx < 0 ? null : `${dimId}:${idx}`;
}

/**
 * Resolve opaque tokens back into `{ [dimId]: string[] }` for `filterClusters`.
 * Unknown dimensions, non-numeric indices and out-of-range indices are dropped.
 */
export function decodeDimTokens(tokens, clusters) {
  const out = {};
  const cache = new Map();
  for (const raw of tokens || []) {
    const t = String(raw);
    const at = t.indexOf(':');
    if (at <= 0) continue;
    const dimId = t.slice(0, at);
    const dim = DIM_BY_ID.get(dimId);
    if (!dim) continue;
    const rawIdx = t.slice(at + 1);
    // `Number('')` is 0, so an empty index would silently resolve to the FIRST
    // value — a malformed token must select nothing, not something.
    if (rawIdx === '') continue;
    const idx = Number(rawIdx);
    if (!Number.isInteger(idx) || idx < 0) continue;
    if (!cache.has(dimId)) cache.set(dimId, facetValuesOf(clusters, dim));
    const values = cache.get(dimId);
    if (idx >= values.length) continue;
    if (!out[dimId]) out[dimId] = [];
    if (!out[dimId].includes(values[idx])) out[dimId].push(values[idx]);
  }
  return out;
}

/** Dimensions the view-local filter bar may offer: available, and not already
 *  owned by the global filter bar. */
export function filterableDimensions(clusters) {
  return resolveDimensions(clusters).filter((d) => d.available && !d.globalOnly);
}
