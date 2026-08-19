// AI-assistance tag analytics (the "AI Assisted?" tab).
//
// Analysts tag ServiceNow cases with how — or whether — an AI assistant
// contributed to the work. The current export layout carries these in a `Tags`
// column, comma-separated when a case has more than one, e.g.
//
//   "Kiro Assisted"
//   "Kiro Not Required / Not Applicable"
//   "Gen AI Did not help , Kiro Not Required / Not Applicable"
//
// `tags` reaches the in-memory enriched row as a raw passthrough: normalizeXlsxRow
// (enrich.js) maps the XLSX "Tags" column, and CSV exports carry the system field
// name directly (see parseFileToRows in useAppData.js). enrichRow spreads `...r`,
// so the field rides along on every enriched row without a dedicated SQL column —
// the same treatment as `parent_account` and other display-only raw fields.
//
// TWO DESIGN RULES, both load-bearing:
//
// 1. THE TAG VOCABULARY IS DISCOVERED, NOT HARDCODED. Every aggregation below
//    derives its categories from the rows it is handed, so a tag ServiceNow starts
//    emitting tomorrow shows up in the charts and the dropdown immediately. The
//    KNOWN-tag lexicon here only *classifies* a tag (which tool, which outcome);
//    an unrecognized tag is classified "unclassified" and is never dropped.
//
// 2. DENOMINATORS ARE NEVER CONFLATED. Three distinct populations, and every
//    number in the UI has to say which one it divides by:
//
//      total      — every case in the current view
//      tagged     — cases carrying at least one tag  → TAGGING COVERAGE (a
//                   compliance metric: on the reference export only 29% of cases
//                   are tagged at all, and per-analyst coverage runs 0%–98%)
//      attempted  — tagged cases where AI was actually tried, i.e. excluding the
//                   ones tagged only "Not Required / Not Applicable"
//                   → the denominator for assist / miss / hallucination rates
//
//    Reporting "assist rate" against `total` would understate it ~4x; reporting it
//    against `tagged` would count deliberate non-use as an AI failure. Both are
//    wrong, which is why `aiTagSummary` returns all three and the UI labels each.

import { startOfMonday } from "./stats.js";

// Outcome classes, in display order. `id` is the stable key used by dataKeys,
// dropdown selections and CSV; `label` is UI text. Colors are NOT here — the
// chart blocks pick them from the theme tokens, which keeps this module free of
// UI imports and unit-testable under `node --test`.
export const OUTCOME_CLASSES = [
  { id: "helpful", label: "Helped" },
  { id: "unhelpful", label: "Didn't help" },
  { id: "harmful", label: "Hallucinated" },
  { id: "notApplicable", label: "Not required" },
  { id: "unclassified", label: "Other tag" },
];

export const OUTCOME_LABEL = Object.fromEntries(OUTCOME_CLASSES.map((o) => [o.id, o.label]));

// Row-level outcome precedence, worst-first. A case carrying several tags lands in
// exactly ONE bucket for the stacked charts, and the tie-break is deliberate:
// "Gen AI Did not help , Kiro Not Required / Not Applicable" (4 real rows) counts
// as `unhelpful`, because an AI attempt demonstrably happened and failed —
// bucketing it as "not required" would quietly hide a miss. Likewise
// "Kiro Assisted, Kiro Not Required" counts as `helpful`.
const OUTCOME_PRECEDENCE = ["harmful", "unhelpful", "helpful", "unclassified", "notApplicable"];

// Tool families. Matched against the normalized tag text, first hit wins.
const FAMILIES = [
  { id: "kiro", label: "Kiro", re: /kiro/ },
  { id: "genai", label: "Gen AI", re: /gen ?ai|genai|copilot|chatgpt|claude|\bllm\b/ },
];
const FAMILY_OTHER = { id: "other", label: "Other" };

// Outcome lexicon — ORDER IS SIGNIFICANT, first match wins. "Kiro Did not help"
// contains "help", so the negative patterns must be tested before the positive
// ones; "Kiro Hallucinated" is checked first of all so a future
// "Kiro Assisted but hallucinated" is scored on its worst signal.
const OUTCOME_LEXICON = [
  { outcome: "harmful", re: /hallucinat|made ?up|fabricat|misleading/ },
  { outcome: "notApplicable", re: /not required|not applicable|not needed|\bn\/a\b/ },
  { outcome: "unhelpful", re: /did ?n[o'’]?t help|didn.t help|\bno help\b|not helpful|unhelpful|no value|wrong|incorrect|failed/ },
  { outcome: "helpful", re: /assist|helped|\bhelpful\b|got it right|solved|resolved|provided direction|guidance|useful|success/ },
];

// Trim, collapse internal whitespace runs, lowercase. ServiceNow tag values pick
// up stray double spaces (the real "Gen AI Did not help , Kiro …" value has one
// before the comma), so plain equality/regex on the raw string is unreliable.
const norm = (s) => String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase();

// Tags that are NOT AI-assistance vocabulary and must never reach an aggregation.
// ServiceNow's `Tags` column is a shared free-for-all: other teams and automations
// stamp their own bookkeeping labels onto the same field. `database_table` is one
// of those — it says nothing about whether AI was used, but because rule 1 above
// discovers the vocabulary, an ignored-tag list is the ONLY thing keeping it out
// of the dropdown, the "Other tag" bucket and — worse — the `tagged` denominator,
// where it would inflate tagging coverage on cases nobody actually tagged.
//
// Matched on the normalized tag (lowercased, whitespace-collapsed), so
// "Database_Table" and "database_table" are both dropped. Filtering happens in
// parseTags, the single chokepoint every other function and the case explorer
// goes through, so no caller can accidentally see one of these.
const IGNORED_TAGS = new Set(["database_table"]);

/** Whether a tag is bookkeeping noise rather than AI-assistance vocabulary. */
export const isIgnoredTag = (tag) => IGNORED_TAGS.has(norm(tag));

/** The raw `Tags` cell for a row, or "". Reads the mapped `tags` field first
 *  (XLSX, and CSV whose header already is that system field name), then a couple
 *  of likely raw CSV header spellings as a best-effort fallback — same shape as
 *  `parentAccountRaw` in dod.js. */
export function tagsRaw(row) {
  if (!row) return "";
  const v = row.tags ?? row["Tags"] ?? row.sys_tags ?? null;
  return v == null ? "" : String(v).trim();
}

/** The individual tags on a row: trimmed, whitespace-collapsed, de-duped,
 *  original casing preserved for display.
 *
 *  Tags in `IGNORED_TAGS` are dropped here, which is what keeps non-AI
 *  bookkeeping labels out of every downstream count.
 *
 *  Splits on `,` `;` `|` ONLY — never on `/`. Tag names legitimately contain
 *  slashes ("Kiro Not Required / Not Applicable", "Kiro Got it Right / Solved"),
 *  so slash-splitting would shatter the vocabulary into nonsense fragments. */
export function parseTags(row) {
  const raw = tagsRaw(row);
  if (!raw) return [];
  const out = [];
  const seen = new Set();
  for (const part of raw.split(/[,;|]/)) {
    const tag = part.trim().replace(/\s+/g, " ");
    if (!tag) continue;
    if (IGNORED_TAGS.has(tag.toLowerCase())) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

/** Classify a single tag string into a tool family and an outcome class. An
 *  unrecognized tag still classifies — family "other", outcome "unclassified" —
 *  so new ServiceNow vocabulary appears in every view instead of vanishing. */
export function classifyTag(tag) {
  const n = norm(tag);
  const fam = FAMILIES.find((f) => f.re.test(n)) || FAMILY_OTHER;
  const hit = OUTCOME_LEXICON.find((o) => o.re.test(n));
  return {
    tag: String(tag ?? "").trim().replace(/\s+/g, " "),
    family: fam.id,
    familyLabel: fam.label,
    outcome: hit ? hit.outcome : "unclassified",
  };
}

/** The single outcome bucket a row belongs to, by OUTCOME_PRECEDENCE, or null
 *  when the row carries no tags at all (untagged is its own population — never
 *  fold it into an outcome). */
export function rowOutcome(row) {
  const tags = parseTags(row);
  if (!tags.length) return null;
  const present = new Set(tags.map((t) => classifyTag(t).outcome));
  return OUTCOME_PRECEDENCE.find((o) => present.has(o)) ?? "unclassified";
}

/** Whether a row carries at least one tag. */
export const isTagged = (row) => parseTags(row).length > 0;

/** Whether AI was actually attempted on this case: tagged with something other
 *  than "not applicable". This is the denominator for every effectiveness rate. */
export function isAiAttempted(row) {
  const o = rowOutcome(row);
  return o != null && o !== "notApplicable";
}

/** The tool families present in `rows`, in FAMILIES order with "other" last.
 *  Returns `[{ id, label, count }]` — count is ROWS carrying ≥1 tag of that
 *  family (not tag instances). */
export function familyCatalog(rows) {
  const counts = new Map();
  for (const r of rows || []) {
    const fams = new Set(parseTags(r).map((t) => classifyTag(t).family));
    for (const f of fams) counts.set(f, (counts.get(f) || 0) + 1);
  }
  return [...FAMILIES, FAMILY_OTHER]
    .filter((f) => counts.has(f.id))
    .map((f) => ({ id: f.id, label: f.label, count: counts.get(f.id) }));
}

/** Every distinct tag found in `rows`, most-used first, each with its
 *  classification and both percentage bases spelled out. `count` is tag
 *  INSTANCES (= rows carrying that tag); the instance total can exceed the tagged
 *  row count because a case may carry several tags — `aiTagSummary().multiTagged`
 *  reports how many, so the UI can explain the discrepancy. */
export function tagCatalog(rows) {
  const list = rows || [];
  let tagged = 0;
  const byTag = new Map();
  for (const r of list) {
    const tags = parseTags(r);
    if (tags.length) tagged++;
    for (const t of tags) {
      const key = t.toLowerCase();
      const cur = byTag.get(key);
      if (cur) cur.count++;
      else byTag.set(key, { ...classifyTag(t), count: 1 });
    }
  }
  return [...byTag.values()]
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .map((t) => ({
      ...t,
      pctOfAll: list.length ? (t.count / list.length) * 100 : null,
      pctOfTagged: tagged ? (t.count / tagged) * 100 : null,
    }));
}

/** Headline counts and rates, with all three denominators exposed so no caller
 *  has to guess. Rates are null (not 0) when their denominator is empty, so the
 *  UI can render "—" instead of a fabricated 0%. */
export function aiTagSummary(rows) {
  const list = rows || [];
  const buckets = { helpful: 0, unhelpful: 0, harmful: 0, notApplicable: 0, unclassified: 0 };
  let tagged = 0;
  let multiTagged = 0;
  let tagInstances = 0;
  for (const r of list) {
    const tags = parseTags(r);
    if (!tags.length) continue;
    tagged++;
    tagInstances += tags.length;
    if (tags.length > 1) multiTagged++;
    buckets[rowOutcome(r)]++;
  }
  const total = list.length;
  const attempted = tagged - buckets.notApplicable;
  const pct = (n, d) => (d ? (n / d) * 100 : null);
  return {
    total,
    tagged,
    untagged: total - tagged,
    coveragePct: pct(tagged, total),
    attempted,
    helped: buckets.helpful,
    unhelped: buckets.unhelpful,
    harmful: buckets.harmful,
    notApplicable: buckets.notApplicable,
    unclassified: buckets.unclassified,
    assistRatePct: pct(buckets.helpful, attempted),
    missRatePct: pct(buckets.unhelpful, attempted),
    hallucinationRatePct: pct(buckets.harmful, attempted),
    multiTagged,
    tagInstances,
  };
}

// One outcome-split row: the five buckets plus untagged, ready to drop straight
// into a Recharts stack.
function emptySplit() {
  return { helpful: 0, unhelpful: 0, harmful: 0, notApplicable: 0, unclassified: 0, untagged: 0 };
}
function addToSplit(split, row) {
  const o = rowOutcome(row);
  if (o == null) split.untagged++;
  else split[o]++;
}

export const UNASSIGNED = "Unassigned";

/** Per-analyst tagging adoption and outcome split, sorted by coverage descending
 *  then by volume — so the compliance leaders and laggards read straight off one
 *  sorted axis. Groups enriched rows by `assigned_to`.
 *
 *  Analysts with ZERO tagged cases are kept, showing as a full-width untagged
 *  bar: on the reference export five analysts have 0% coverage across 30+ cases
 *  each, which is precisely the finding a manager needs to see. Because
 *  "untagged" is a segment of the same stack, a 0%-coverage analyst renders as a
 *  full bar rather than an empty row — an empty row would read as "0% helpful".
 *
 *  `Unassigned` is forced last: it is a pseudo-member (see teamMembersAll in
 *  useAppData.js) and has no one to hold accountable for tagging.
 *
 *  CAVEAT the UI must repeat: the tag lives on the CASE, and `assigned_to` is the
 *  case's CURRENT assignee — not provably whoever applied the tag. On reassigned
 *  cases this attributes the tag to the wrong analyst, so this is a proxy for
 *  adoption, not an audit trail. */
export function adoptionByAnalyst(rows) {
  const byName = new Map();
  for (const r of rows || []) {
    const name = String(r.assigned_to ?? "").trim() || UNASSIGNED;
    if (!byName.has(name)) byName.set(name, { name, total: 0, tagged: 0, ...emptySplit() });
    const s = byName.get(name);
    s.total++;
    if (isTagged(r)) s.tagged++;
    addToSplit(s, r);
  }
  return [...byName.values()]
    .map((s) => ({
      ...s,
      attempted: s.tagged - s.notApplicable,
      coveragePct: s.total ? (s.tagged / s.total) * 100 : null,
      assistRatePct: s.tagged - s.notApplicable ? (s.helpful / (s.tagged - s.notApplicable)) * 100 : null,
    }))
    .sort((a, b) => {
      if ((a.name === UNASSIGNED) !== (b.name === UNASSIGNED)) return a.name === UNASSIGNED ? 1 : -1;
      return (
        (b.coveragePct ?? 0) - (a.coveragePct ?? 0) ||
        b.total - a.total ||
        a.name.localeCompare(b.name)
      );
    });
}

/** Outcome split per priority, ascending by priority rank (1 - Critical first) so
 *  "is AI being used on the hard cases?" reads left to right. Priorities with no
 *  cases in the view are absent — the category set follows the data. */
export function outcomeByPriority(rows) {
  const byPriority = new Map();
  for (const r of rows || []) {
    const priority = String(r.priority ?? "").trim() || "Unset";
    if (!byPriority.has(priority)) byPriority.set(priority, { priority, total: 0, tagged: 0, ...emptySplit() });
    const s = byPriority.get(priority);
    s.total++;
    if (isTagged(r)) s.tagged++;
    addToSplit(s, r);
  }
  return [...byPriority.values()]
    .map((s) => ({
      ...s,
      attempted: s.tagged - s.notApplicable,
      coveragePct: s.total ? (s.tagged / s.total) * 100 : null,
    }))
    .sort((a, b) => {
      const ra = parseInt(a.priority, 10);
      const rb = parseInt(b.priority, 10);
      return (isNaN(ra) ? 99 : ra) - (isNaN(rb) ? 99 : rb) || a.priority.localeCompare(b.priority);
    });
}

const MONTH_MS_GUARD = 240; // ~20 years of monthly buckets
const WEEK_MS_GUARD = 520; // ~10 years of weekly buckets, matching dod.js

const bucketStart = (d, granularity) =>
  granularity === "week" ? startOfMonday(d) : new Date(d.getFullYear(), d.getMonth(), 1);

const nextBucket = (d, granularity) => {
  const n = new Date(d);
  if (granularity === "week") n.setDate(n.getDate() + 7);
  else n.setMonth(n.getMonth() + 1);
  return n;
};

/** Tagging coverage and assist rate over time, bucketed by calendar month
 *  (default) or Monday-anchored week — the same anchoring as `weeklyIntakeResolved`
 *  so the x-axis lines up with the other trend charts. Buckets run from the oldest
 *  dated case through `refNow` (pass the import's snapshot so the series is
 *  deterministic), with empty buckets included so gaps are visible.
 *
 *  Rows without `_created` are ignored. `assistRatePct` is null in any bucket with
 *  fewer than `minAttempted` attempted cases: early months on the reference export
 *  hold one or two tagged cases, and plotting 0%/100% from an n of 1 invents a
 *  trend that isn't there. The chart renders those as gaps. */
export function coverageTrend(rows, refNow = Date.now(), granularity = "month", minAttempted = 5) {
  const dated = (rows || []).filter((r) => r._created);
  if (!dated.length) return [];
  let minDate = null;
  for (const r of dated) if (!minDate || r._created < minDate) minDate = r._created;

  const start = bucketStart(minDate, granularity);
  const end = bucketStart(new Date(refNow), granularity);
  const guard = granularity === "week" ? WEEK_MS_GUARD : MONTH_MS_GUARD;

  const buckets = new Map();
  const order = [];
  for (let d = start, i = 0; d <= end && i <= guard; d = nextBucket(d, granularity), i++) {
    const key = d.getTime();
    buckets.set(key, { bucket: key, total: 0, tagged: 0, ...emptySplit() });
    order.push(key);
  }
  if (!order.length || order.length > guard) return [];

  for (const r of dated) {
    const b = buckets.get(bucketStart(r._created, granularity).getTime());
    if (!b) continue;
    b.total++;
    if (isTagged(r)) b.tagged++;
    addToSplit(b, r);
  }

  return order.map((k) => {
    const b = buckets.get(k);
    const attempted = b.tagged - b.notApplicable;
    return {
      ...b,
      attempted,
      coveragePct: b.total ? (b.tagged / b.total) * 100 : null,
      assistRatePct: attempted >= minAttempted ? (b.helpful / attempted) * 100 : null,
    };
  });
}

// ---------------------------------------------------------------------------
// Case-explorer selection model
// ---------------------------------------------------------------------------
//
// The explorer dropdown mixes synthetic views (all / untagged / by outcome / by
// family) with the literal discovered tags. Every option carries a stable `id`
// that `filterByTagSelection` understands, so the selection survives re-renders
// and can be reasoned about in one place. Prefixes keep the namespaces apart:
//   view:*  outcome:<id>  family:<id>  tag:<lowercased tag>

export const ALL_CASES = "view:all";

const VIEW_PREDICATES = {
  "view:all": () => true,
  "view:tagged": (r) => isTagged(r),
  "view:untagged": (r) => !isTagged(r),
  "view:attempted": (r) => isAiAttempted(r),
};

/** The dropdown model: `[{ id, label, count, group }]` in display order, with
 *  every count computed against the rows handed in so the label matches what the
 *  list will show. Families and tags come from the data, never a fixed list. */
export function tagSelectionOptions(rows) {
  const list = rows || [];
  const s = aiTagSummary(list);
  const options = [
    { id: "view:all", label: "All cases", count: s.total, group: "Views" },
    { id: "view:tagged", label: "Any tag", count: s.tagged, group: "Views" },
    { id: "view:untagged", label: "Untagged", count: s.untagged, group: "Views" },
    { id: "view:attempted", label: "AI attempted", count: s.attempted, group: "Views" },
  ];
  const outcomeCounts = {
    helpful: s.helped,
    unhelpful: s.unhelped,
    harmful: s.harmful,
    notApplicable: s.notApplicable,
    unclassified: s.unclassified,
  };
  for (const o of OUTCOME_CLASSES) {
    if (!outcomeCounts[o.id]) continue;
    options.push({ id: `outcome:${o.id}`, label: o.label, count: outcomeCounts[o.id], group: "Outcomes" });
  }
  for (const f of familyCatalog(list)) {
    options.push({ id: `family:${f.id}`, label: `Any ${f.label}`, count: f.count, group: "Tools" });
  }
  for (const t of tagCatalog(list)) {
    options.push({ id: `tag:${t.tag.toLowerCase()}`, label: t.tag, count: t.count, group: "Tags" });
  }
  return options;
}

/** Apply a selection id from `tagSelectionOptions` to `rows`. An unknown id
 *  returns [] rather than throwing, so a stale selection (e.g. a tag that
 *  disappeared when the date filter moved) degrades to an empty list. */
export function filterByTagSelection(rows, id) {
  const list = rows || [];
  const view = VIEW_PREDICATES[id];
  if (view) return list.filter(view);
  if (typeof id === "string" && id.startsWith("outcome:")) {
    const want = id.slice("outcome:".length);
    return list.filter((r) => rowOutcome(r) === want);
  }
  if (typeof id === "string" && id.startsWith("family:")) {
    const want = id.slice("family:".length);
    return list.filter((r) => parseTags(r).some((t) => classifyTag(t).family === want));
  }
  if (typeof id === "string" && id.startsWith("tag:")) {
    const want = id.slice("tag:".length);
    return list.filter((r) => parseTags(r).some((t) => t.toLowerCase() === want));
  }
  return [];
}

/** Rows carrying a specific tag — the chart-click drilldown path. */
export function rowsWithTag(rows, tag) {
  const want = String(tag ?? "").trim().toLowerCase();
  if (!want) return [];
  return (rows || []).filter((r) => parseTags(r).some((t) => t.toLowerCase() === want));
}

/** Whether ANY row carries a tag value. Drives the page-level guard: older
 *  ServiceNow report layouts have no `Tags` column at all, and a wall of zeros
 *  would read as "the team never uses AI" rather than "this export can't tell
 *  you".
 *
 *  Asks parseTags, not tagsRaw, so a `Tags` column carrying only ignored
 *  bookkeeping labels still trips the guard — the export genuinely can't tell you
 *  anything about AI use.
 *
 *  It cannot distinguish "column absent" from "column present, nothing tagged" —
 *  normalizeXlsxRow sets `tags: null` in both cases and the pre-normalized rows
 *  aren't retained — so the guard's copy must cover both readings honestly. */
export function hasAnyTagData(rows) {
  return (rows || []).some((r) => parseTags(r).length > 0);
}

/** Discovered tags the lexicon didn't recognize. Surfaced in the UI as a strip so
 *  new ServiceNow vocabulary is visible (and gets classified) instead of quietly
 *  accumulating in the "Other tag" bucket. */
export function unrecognizedTags(rows) {
  return tagCatalog(rows).filter((t) => t.outcome === "unclassified");
}

/** A short, Pill-safe label for a tag. `Pill` hardcodes uppercase 10px mono with
 *  no override, so a 33-character tag ("Kiro Not Required / Not Applicable")
 *  renders as an unreadable blob. Drop the leading tool-family word — the family
 *  is already carried by the pill's color and the surrounding context — and
 *  abbreviate the one stock phrase that is still long after that. Callers must
 *  put the full tag in a `title` attribute. */
export function shortTagLabel(tag) {
  let s = String(tag ?? "").trim().replace(/\s+/g, " ");
  s = s.replace(/^(kiro|gen ?ai|genai|copilot|chatgpt|claude)\s+/i, "");
  s = s.replace(/not required \/ not applicable/i, "not required");
  return s || String(tag ?? "").trim();
}
