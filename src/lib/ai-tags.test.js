// Unit tests for the AI-assistance tag analytics (src/lib/ai-tags.js): tag
// parsing (the never-split-on-slash rule), the ordered classification lexicon,
// row-level outcome precedence, the three-denominator summary, and the
// per-analyst / trend / explorer aggregations. Run with `node --test`.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OUTCOME_CLASSES,
  UNASSIGNED,
  tagsRaw,
  parseTags,
  classifyTag,
  rowOutcome,
  isTagged,
  isAiAttempted,
  familyCatalog,
  tagCatalog,
  aiTagSummary,
  adoptionByAnalyst,
  outcomeByPriority,
  coverageTrend,
  tagSelectionOptions,
  filterByTagSelection,
  rowsWithTag,
  hasAnyTagData,
  unrecognizedTags,
  shortTagLabel,
  isIgnoredTag,
} from "./ai-tags.js";

// The seven real tag strings from x_igss2_customer_p_standard_case (1).xlsx.
const T_NA = "Kiro Not Required / Not Applicable";
const T_ASSIST = "Kiro Assisted";
const T_DIRECTION = "Gen AI Provided direction";
const T_NOHELP_K = "Kiro Did not help";
const T_NOHELP_G = "Gen AI Did not help";
const T_HALLUC = "Kiro Hallucinated";
const T_SOLVED = "Kiro Got it Right / Solved";

const row = (tags, extra = {}) => ({ tags, ...extra });

/* ------------------------------ parseTags ------------------------------ */

test("parseTags never treats '/' as a separator", () => {
  // THE regression test. Two of the seven production tags contain " / ", so a
  // slash split would shatter the vocabulary into meaningless fragments.
  assert.deepEqual(parseTags(row(T_NA)), [T_NA]);
  assert.deepEqual(parseTags(row(T_SOLVED)), [T_SOLVED]);
});

test("parseTags splits on comma and tolerates the real-world spacing", () => {
  // Verbatim from the export: note the space BEFORE the comma.
  assert.deepEqual(parseTags(row("Gen AI Did not help , Kiro Not Required / Not Applicable")), [
    T_NOHELP_G,
    T_NA,
  ]);
  assert.deepEqual(parseTags(row("Kiro Assisted, Kiro Not Required / Not Applicable")), [T_ASSIST, T_NA]);
});

test("parseTags also splits on ';' and '|', collapses whitespace, drops empties, de-dupes", () => {
  assert.deepEqual(parseTags(row("Kiro Assisted; Kiro Hallucinated")), [T_ASSIST, T_HALLUC]);
  assert.deepEqual(parseTags(row("Kiro Assisted|Kiro Hallucinated")), [T_ASSIST, T_HALLUC]);
  assert.deepEqual(parseTags(row("Kiro   Assisted")), [T_ASSIST]);
  assert.deepEqual(parseTags(row("Kiro Assisted,,")), [T_ASSIST]);
  assert.deepEqual(parseTags(row("Kiro Assisted, kiro assisted")), [T_ASSIST]); // case-insensitive dedupe
});

test("parseTags on missing / empty input returns []", () => {
  assert.deepEqual(parseTags(row(null)), []);
  assert.deepEqual(parseTags(row("")), []);
  assert.deepEqual(parseTags(row("   ")), []);
  assert.deepEqual(parseTags({}), []);
  assert.deepEqual(parseTags(null), []);
});

test("parseTags drops the non-AI 'database_table' bookkeeping tag", () => {
  // Another team stamps `database_table` onto the same ServiceNow Tags column. It
  // carries no AI signal, so it must not appear as a tag, must not make the case
  // count as tagged, and must not land in the "Other tag" bucket.
  assert.deepEqual(parseTags(row("database_table")), []);
  assert.deepEqual(parseTags(row("Database_Table")), []); // case-insensitive
  assert.deepEqual(parseTags(row("database_table, Kiro Assisted")), [T_ASSIST]);
  assert.equal(isTagged(row("database_table")), false);
  assert.equal(rowOutcome(row("database_table")), null);
  assert.equal(isIgnoredTag("DATABASE_TABLE"), true);
  assert.equal(isIgnoredTag(T_ASSIST), false);

  // ...and it never inflates the coverage denominator or the dropdown.
  const s = aiTagSummary([row("database_table"), row(T_ASSIST)]);
  assert.equal(s.tagged, 1);
  assert.equal(s.untagged, 1);
  assert.deepEqual(unrecognizedTags([row("database_table")]), []);
  const ids = tagSelectionOptions([row("database_table")]).map((o) => o.id);
  assert.ok(!ids.some((id) => id.includes("database_table")));

  // A Tags column carrying ONLY ignored labels can't tell you anything about AI,
  // so the page-level guard must still fire.
  assert.equal(hasAnyTagData([row("database_table")]), false);
  assert.equal(hasAnyTagData([row("database_table"), row(T_ASSIST)]), true);
});

test("tagsRaw falls back to the raw CSV header spelling", () => {
  assert.equal(tagsRaw({ Tags: " Kiro Assisted " }), T_ASSIST);
  assert.equal(tagsRaw({}), "");
});

/* ----------------------------- classifyTag ----------------------------- */

test("classifyTag maps all seven production tags to the right family and outcome", () => {
  const table = [
    [T_NA, "kiro", "notApplicable"],
    [T_ASSIST, "kiro", "helpful"],
    [T_DIRECTION, "genai", "helpful"],
    [T_NOHELP_K, "kiro", "unhelpful"],
    [T_NOHELP_G, "genai", "unhelpful"],
    [T_HALLUC, "kiro", "harmful"],
    [T_SOLVED, "kiro", "helpful"],
  ];
  for (const [tag, family, outcome] of table) {
    const c = classifyTag(tag);
    assert.equal(c.family, family, `family for ${tag}`);
    assert.equal(c.outcome, outcome, `outcome for ${tag}`);
  }
});

test("the negative patterns are tested before the positive ones", () => {
  // "Kiro Did not help" CONTAINS the substring "help". If the `helpful` probe ran
  // first this would score as a success — the highest-consequence bug available
  // in this module, which is why the lexicon order is load-bearing.
  assert.equal(classifyTag(T_NOHELP_K).outcome, "unhelpful");
  assert.equal(classifyTag(T_NOHELP_G).outcome, "unhelpful");
  // And a hallucination that also claims to have helped scores on its worst signal.
  assert.equal(classifyTag("Kiro Assisted but Hallucinated").outcome, "harmful");
});

test("classifyTag never drops an unseen tag", () => {
  assert.deepEqual(
    { family: classifyTag("Copilot Refactored the query").family, outcome: classifyTag("Copilot Refactored the query").outcome },
    { family: "genai", outcome: "unclassified" },
  );
  assert.deepEqual(
    { family: classifyTag("Something Entirely New").family, outcome: classifyTag("Something Entirely New").outcome },
    { family: "other", outcome: "unclassified" },
  );
  assert.equal(classifyTag("").outcome, "unclassified");
  assert.equal(classifyTag(null).outcome, "unclassified");
});

/* ------------------------- row-level resolution ------------------------ */

test("rowOutcome puts a multi-tagged row in exactly one bucket, worst-signal-first", () => {
  // The two real multi-tag combos in the export.
  assert.equal(rowOutcome(row("Gen AI Did not help , Kiro Not Required / Not Applicable")), "unhelpful");
  assert.equal(rowOutcome(row("Kiro Assisted, Kiro Not Required / Not Applicable")), "helpful");
  // Synthetic precedence checks.
  assert.equal(rowOutcome(row(`${T_ASSIST}, ${T_HALLUC}`)), "harmful");
  assert.equal(rowOutcome(row(`${T_ASSIST}, ${T_NOHELP_K}`)), "unhelpful");
  assert.equal(rowOutcome(row(`Something New, ${T_NA}`)), "unclassified");
  // Untagged is its own population, never an outcome.
  assert.equal(rowOutcome(row(null)), null);
});

test("isTagged / isAiAttempted separate coverage from effectiveness", () => {
  assert.equal(isTagged(row(T_NA)), true);
  assert.equal(isTagged(row(null)), false);
  // Deliberate non-use is tagged but NOT an AI attempt — folding it in would
  // count "I judged AI wasn't needed" as an AI failure.
  assert.equal(isAiAttempted(row(T_NA)), false);
  assert.equal(isAiAttempted(row(T_ASSIST)), true);
  assert.equal(isAiAttempted(row(T_HALLUC)), true);
  assert.equal(isAiAttempted(row("Gen AI Did not help , Kiro Not Required / Not Applicable")), true);
  assert.equal(isAiAttempted(row(null)), false);
});

/* ------------------------ catalogs and summary ------------------------- */

// A fixture that mirrors the reference export's shape at 1/10 scale, including
// both real multi-tag combos and one unrecognized tag.
const FIXTURE = [
  ...Array.from({ length: 27 }, () => row(T_NA)),
  ...Array.from({ length: 12 }, () => row(T_ASSIST)),
  ...Array.from({ length: 4 }, () => row(T_DIRECTION)),
  ...Array.from({ length: 2 }, () => row(T_NOHELP_K)),
  row(T_NOHELP_G),
  row(T_HALLUC),
  row(T_SOLVED),
  row("Gen AI Did not help , Kiro Not Required / Not Applicable"),
  row("Kiro Assisted, Kiro Not Required / Not Applicable"),
  row("Kiro Reviewed the config"), // unrecognized
  ...Array.from({ length: 70 }, () => row(null)),
];

test("aiTagSummary keeps the three denominators separate", () => {
  const s = aiTagSummary(FIXTURE);
  assert.equal(s.total, 121);
  assert.equal(s.tagged, 51);
  assert.equal(s.untagged, 70);
  assert.equal(s.tagged + s.untagged, s.total);

  // Row buckets: 12 assisted + 4 direction + 1 solved + 1 (assisted+NA) = 18 helpful
  assert.equal(s.helped, 18);
  assert.equal(s.unhelped, 4); // 2 Kiro + 1 Gen AI + 1 (nohelp+NA)
  assert.equal(s.harmful, 1);
  assert.equal(s.notApplicable, 27);
  assert.equal(s.unclassified, 1);
  assert.equal(s.helped + s.unhelped + s.harmful + s.notApplicable + s.unclassified, s.tagged);

  // `attempted` excludes the not-applicable-only rows, and only those.
  assert.equal(s.attempted, 51 - 27);
  assert.equal(s.helped + s.unhelped + s.harmful + s.unclassified, s.attempted);

  assert.equal(Math.round(s.coveragePct * 10) / 10, 42.1);
  assert.equal(Math.round(s.assistRatePct), 75); // 18/24
  assert.equal(s.multiTagged, 2);
  assert.equal(s.tagInstances, s.tagged + 2);
});

test("aiTagSummary returns null rates, never 0, when a denominator is empty", () => {
  const empty = aiTagSummary([]);
  assert.equal(empty.total, 0);
  assert.equal(empty.coveragePct, null);
  assert.equal(empty.assistRatePct, null);

  const untaggedOnly = aiTagSummary([row(null), row("")]);
  assert.equal(untaggedOnly.coveragePct, 0); // a real, measured 0% coverage
  assert.equal(untaggedOnly.assistRatePct, null); // but no attempts to rate

  const naOnly = aiTagSummary([row(T_NA)]);
  assert.equal(naOnly.attempted, 0);
  assert.equal(naOnly.assistRatePct, null);
  assert.equal(naOnly.hallucinationRatePct, null);
});

test("tagCatalog discovers every tag, counts instances, and reports both bases", () => {
  const cat = tagCatalog(FIXTURE);
  assert.equal(cat.length, 8); // 7 production tags + the unrecognized one
  assert.equal(cat[0].tag, T_NA);
  assert.equal(cat[0].count, 29); // 27 alone + both multi-tag rows
  assert.equal(cat[1].tag, T_ASSIST);
  assert.equal(cat[1].count, 13);
  // Nothing-dropped invariant: instances sum to the summary's instance count.
  const instances = cat.reduce((n, t) => n + t.count, 0);
  assert.equal(instances, aiTagSummary(FIXTURE).tagInstances);
  // Both percentage bases present and distinct.
  assert.equal(Math.round(cat[1].pctOfAll * 10) / 10, 10.7);
  assert.equal(Math.round(cat[1].pctOfTagged * 10) / 10, 25.5);
});

test("unrecognizedTags surfaces new vocabulary", () => {
  const un = unrecognizedTags(FIXTURE);
  assert.equal(un.length, 1);
  assert.equal(un[0].tag, "Kiro Reviewed the config");
  assert.equal(un[0].family, "kiro");
});

test("familyCatalog counts rows, not tag instances, and only present families", () => {
  const fams = familyCatalog(FIXTURE);
  assert.deepEqual(fams.map((f) => f.id), ["kiro", "genai"]);
  // 5 Gen AI rows: 4 direction + 1 nohelp + 1 (nohelp+NA) = 6
  assert.equal(fams.find((f) => f.id === "genai").count, 6);
  assert.deepEqual(familyCatalog([]), []);
});

test("OUTCOME_CLASSES covers every outcome id the classifier can emit", () => {
  const ids = new Set(OUTCOME_CLASSES.map((o) => o.id));
  for (const tag of [T_NA, T_ASSIST, T_DIRECTION, T_NOHELP_K, T_HALLUC, "Brand New Tag"]) {
    assert.ok(ids.has(classifyTag(tag).outcome), `${tag} outcome is a known class`);
  }
});

/* --------------------------- per-analyst ------------------------------- */

test("adoptionByAnalyst sorts by coverage, keeps 0% analysts, forces Unassigned last", () => {
  const rows = [
    ...Array.from({ length: 9 }, () => row(T_ASSIST, { assigned_to: "Akshay L (Infor)" })),
    row(null, { assigned_to: "Akshay L (Infor)" }),
    ...Array.from({ length: 8 }, () => row(null, { assigned_to: "Harsh Pathak (Infor)" })),
    ...Array.from({ length: 3 }, () => row(T_NA, { assigned_to: "Tunk Chhetri (Infor)" })),
    ...Array.from({ length: 3 }, () => row(null, { assigned_to: "Tunk Chhetri (Infor)" })),
    row(T_ASSIST, { assigned_to: "" }), // -> Unassigned, 100% coverage
  ];
  const stats = adoptionByAnalyst(rows);
  assert.deepEqual(stats.map((s) => s.name), [
    "Akshay L (Infor)", // 90%
    "Tunk Chhetri (Infor)", // 50%
    "Harsh Pathak (Infor)", // 0%
    UNASSIGNED, // 100% but pinned last
  ]);

  const akshay = stats[0];
  assert.equal(akshay.total, 10);
  assert.equal(akshay.tagged, 9);
  assert.equal(akshay.untagged, 1);
  assert.equal(akshay.coveragePct, 90);
  assert.equal(akshay.assistRatePct, 100);

  const harsh = stats[2];
  assert.equal(harsh.coveragePct, 0);
  assert.equal(harsh.untagged, 8);
  assert.equal(harsh.assistRatePct, null); // never 0 — there is nothing to rate

  // All-not-applicable analyst: tagged, compliant, but no attempts to score.
  const tunk = stats[1];
  assert.equal(tunk.attempted, 0);
  assert.equal(tunk.assistRatePct, null);
});

/* ----------------------------- priority ------------------------------- */

test("outcomeByPriority orders by priority rank and puts unset last", () => {
  const rows = [
    row(T_ASSIST, { priority: "4 - Standard" }),
    row(null, { priority: "4 - Standard" }),
    row(T_HALLUC, { priority: "1 - Critical" }),
    row(null, { priority: "" }),
  ];
  const byP = outcomeByPriority(rows);
  assert.deepEqual(byP.map((p) => p.priority), ["1 - Critical", "4 - Standard", "Unset"]);
  assert.equal(byP[0].harmful, 1);
  assert.equal(byP[1].coveragePct, 50);
  assert.equal(byP[2].untagged, 1);
});

/* ------------------------------ trend --------------------------------- */

// Fixed local-time dates so bucketing is deterministic regardless of the
// runner's timezone (same discipline as dod.test.js). 2026-01-05 is a Monday.
const d = (y, m, day) => new Date(y, m, day, 10);
const SNAP = d(2026, 2, 10).getTime(); // 2026-03-10

test("coverageTrend buckets by month, contiguously, including empty months", () => {
  const rows = [
    row(T_ASSIST, { _created: d(2025, 11, 15) }), // Dec 2025
    row(null, { _created: d(2025, 11, 20) }),
    // Jan 2026 deliberately empty — the bucket must still be present
    row(T_NA, { _created: d(2026, 1, 3) }), // Feb 2026
    row(T_ASSIST, { _created: d(2026, 1, 4) }),
    row(null, { _created: d(2026, 1, 5) }),
    row(null, {}), // no _created — ignored
  ];
  const trend = coverageTrend(rows, SNAP, "month", 1);
  assert.equal(trend.length, 4); // Dec, Jan, Feb, Mar — crosses the year boundary
  assert.deepEqual(
    trend.map((b) => new Date(b.bucket).getMonth()),
    [11, 0, 1, 2],
  );
  assert.equal(trend[0].total, 2);
  assert.equal(trend[0].coveragePct, 50);
  assert.equal(trend[1].total, 0); // the empty month is present, not skipped
  assert.equal(trend[1].coveragePct, null); // and rates nothing
  assert.equal(trend[2].total, 3);
  assert.equal(trend[2].attempted, 1); // the T_NA row is tagged but not attempted
  assert.equal(Math.round(trend[2].coveragePct), 67);
});

test("coverageTrend suppresses an assist rate computed from too few attempts", () => {
  const rows = [
    row(T_ASSIST, { _created: d(2026, 1, 3) }),
    row(null, { _created: d(2026, 1, 4) }),
  ];
  // One attempted case would plot as a 100% assist rate — an invented trend.
  assert.equal(coverageTrend(rows, SNAP, "month", 5)[0].assistRatePct, null);
  assert.equal(coverageTrend(rows, SNAP, "month", 1)[0].assistRatePct, 100);
});

test("coverageTrend supports Monday-anchored weeks and no-data input", () => {
  const rows = [
    row(T_ASSIST, { _created: d(2026, 0, 7) }), // week of Mon Jan 5
    row(null, { _created: d(2026, 0, 14) }), // week of Mon Jan 12
  ];
  const weekly = coverageTrend(rows, d(2026, 0, 19).getTime(), "week", 1);
  assert.equal(weekly.length, 3); // Jan 5, 12, 19
  assert.equal(new Date(weekly[0].bucket).getDay(), 1); // Monday
  assert.equal(weekly[0].tagged, 1);
  assert.deepEqual(coverageTrend([], SNAP), []);
  assert.deepEqual(coverageTrend([row(T_ASSIST, {})], SNAP), []); // no dated rows
});

/* ---------------------------- explorer -------------------------------- */

test("tagSelectionOptions is built from the data and its counts match the filter", () => {
  const opts = tagSelectionOptions(FIXTURE);
  const byId = new Map(opts.map((o) => [o.id, o]));

  assert.equal(byId.get("view:all").count, 121);
  assert.equal(byId.get("view:tagged").count, 51);
  assert.equal(byId.get("view:untagged").count, 70);
  assert.equal(byId.get("view:attempted").count, 24);
  assert.equal(byId.get("outcome:harmful").count, 1);
  assert.equal(byId.get("family:genai").count, 6);
  assert.ok(byId.has(`tag:${T_ASSIST.toLowerCase()}`));
  assert.ok(byId.has("tag:kiro reviewed the config")); // unrecognized tags are selectable

  // Every option's advertised count must equal what the list will actually show.
  for (const o of opts) {
    assert.equal(filterByTagSelection(FIXTURE, o.id).length, o.count, `count for ${o.id}`);
  }
  assert.deepEqual([...new Set(opts.map((o) => o.group))], ["Views", "Outcomes", "Tools", "Tags"]);
});

test("filterByTagSelection matches tags exactly and degrades instead of throwing", () => {
  const rows = [row(T_ASSIST), row(T_NA), row(null)];
  // "Kiro Assisted" must not be matched by a substring probe, and vice versa.
  assert.equal(filterByTagSelection(rows, "tag:kiro").length, 0);
  assert.equal(filterByTagSelection(rows, `tag:${T_ASSIST.toLowerCase()}`).length, 1);
  assert.equal(filterByTagSelection(rows, "family:kiro").length, 2);
  assert.deepEqual(filterByTagSelection(rows, "outcome:nonsense"), []);
  assert.deepEqual(filterByTagSelection(rows, "who knows"), []);
  assert.deepEqual(filterByTagSelection(rows, undefined), []);
});

test("rowsWithTag is the chart-click drilldown path", () => {
  assert.equal(rowsWithTag(FIXTURE, T_NA).length, 29); // includes both multi-tag rows
  assert.equal(rowsWithTag(FIXTURE, "kiro assisted").length, 13); // case-insensitive
  assert.deepEqual(rowsWithTag(FIXTURE, ""), []);
});

/* ---------------------------- guards / UI ----------------------------- */

test("hasAnyTagData distinguishes a tag-less import from a tagged one", () => {
  assert.equal(hasAnyTagData([row(null), row("")]), false);
  assert.equal(hasAnyTagData([{ number: "CS1" }]), false);
  assert.equal(hasAnyTagData([row(null), row(T_ASSIST)]), true);
  assert.equal(hasAnyTagData([]), false);
});

test("shortTagLabel keeps a Pill readable without losing meaning", () => {
  assert.equal(shortTagLabel(T_ASSIST), "Assisted");
  assert.equal(shortTagLabel(T_DIRECTION), "Provided direction");
  assert.equal(shortTagLabel(T_NA), "not required");
  assert.equal(shortTagLabel(T_SOLVED), "Got it Right / Solved");
  // A tag that is nothing but a family name must not shorten to "".
  assert.equal(shortTagLabel("Kiro"), "Kiro");
  assert.equal(shortTagLabel("Something Entirely New"), "Something Entirely New");
});
