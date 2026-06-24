// Unit tests for the deterministic sentiment engine. Runs on Node's built-in
// runner: `node --test` (zero deps). The engine is framework-free, so these
// import it directly with no JSDOM / Vite shim.
import test from "node:test";
import assert from "node:assert/strict";

import {
  parseInteractionStream,
  scoreText,
  detectEmotions,
  detectFrustrationTarget,
  gradeCase,
  summarizeSentiment,
} from "./sentiment.js";

/* --------------------------- small helpers ---------------------------- */

// Build a journal blob in the exact ServiceNow header shape enrich.js parses.
// entries: [{ ts, author, body }]
const journal = (entries) =>
  entries.map((e) => `${e.ts} - ${e.author}\n${e.body}`).join("\n\n");

const CUST = "John Guest";
const ANALYST = "Jane Doe (Infor) (Additional comments)";

// The engine's line-level label, mirroring sentimentLabel(round(valence)).
const lineLabel = (t) => {
  const v = Math.round(scoreText(t).valence);
  return v >= 1 ? "Positive" : v <= -1 ? "Negative" : "Neutral";
};

/* ============================== attribution ============================ */

test("attribution: (Infor) → analyst, bare name → customer, relayed voice → customer", () => {
  const blob = journal([
    { ts: "2026-05-31 10:00:00", author: ANALYST, body: "Looking into it now." },
    { ts: "2026-05-31 11:00:00", author: CUST, body: "Still seeing the error." },
    { ts: "2026-05-31 12:00:00", author: "Support Portal Relay", body: "Customer says it is fixed." },
  ]);
  const stream = parseInteractionStream(blob);
  assert.equal(stream.length, 3);
  assert.equal(stream[0].isCustomer, false); // (Infor) → analyst
  assert.equal(stream[1].isCustomer, true); // bare customer name
  assert.equal(stream[2].isCustomer, true); // relayed voice, no (Infor) → customer
});

test("parsing: header-less blob is one customer block; newest-first sorts oldest-first", () => {
  const headerless = parseInteractionStream("just a free-text note with no header at all");
  assert.equal(headerless.length, 1);
  assert.equal(headerless[0].isCustomer, true);
  assert.equal(headerless[0].ts, null);

  // Provided newest-first; engine sorts ascending when every ts is present.
  const blob = journal([
    { ts: "2026-05-31 15:00:00", author: CUST, body: "Second in time." },
    { ts: "2026-05-31 09:00:00", author: CUST, body: "First in time." },
  ]);
  const stream = parseInteractionStream(blob);
  assert.equal(stream[0].body, "First in time.");
  assert.equal(stream[1].body, "Second in time.");
});

test("parsing: strips [code] blocks and stray HTML from bodies", () => {
  const blob = journal([
    { ts: "2026-05-31 10:00:00", author: CUST, body: "before [code]<script>x</script>raw[/code] <b>after</b>" },
  ]);
  const [m] = parseInteractionStream(blob);
  assert.ok(!m.body.includes("[code]"));
  assert.ok(!m.body.includes("<b>"));
  assert.ok(!m.body.includes("<script>"));
  assert.ok(m.body.includes("before"));
  assert.ok(m.body.includes("after"));
});

/* ============================ scoreable gating ========================= */

test("gating: zero customer messages → not scoreable, null grade, phone/silent coaching", () => {
  const g = gradeCase({
    number: "C-SILENT",
    work_notes: journal([{ ts: "2026-05-31 10:00:00", author: ANALYST, body: "Resolved via phone." }]),
  });
  assert.equal(g.scoreable, false);
  assert.equal(g.valence, null);
  assert.equal(g.sentiment, null);
  assert.equal(g.arc, null);
  assert.equal(g.coachingNote, "No written customer dialogue to score — handled by phone or silent close.");
});

test("gating: empty journal → not scoreable, empty-journal coaching", () => {
  const g = gradeCase({ number: "C-EMPTY", work_notes: "" });
  assert.equal(g.scoreable, false);
  assert.equal(g.custMsgs, 0);
  assert.equal(g.myMsgs, 0);
  assert.equal(g.coachingNote, "No customer or analyst text in the journal.");
});

test("gating: falls back from work_notes to additional_comments", () => {
  const g = gradeCase({
    number: "C-FALLBACK",
    work_notes: null,
    additional_comments: journal([{ ts: "2026-05-31 10:00:00", author: CUST, body: "Perfect, thank you!" }]),
  });
  assert.equal(g.scoreable, true);
  assert.equal(g.sentiment, "Positive");
});

/* ============================== determinism ============================ */

test("determinism: same row in → deep-equal grade out", () => {
  const row = {
    number: "C-DET",
    account: "Acme Hotels",
    priority: "2 - Major",
    work_notes: journal([
      { ts: "2026-05-31 10:00:00", author: CUST, body: "This is broken and not working, very frustrating." },
      { ts: "2026-05-31 16:00:00", author: CUST, body: "Perfect, that resolved it. Thank you!" },
    ]),
  };
  assert.deepStrictEqual(gradeCase(row), gradeCase(row));
});

test("determinism: summarizeSentiment is stable across calls", () => {
  const rows = [
    { number: "A", work_notes: journal([{ ts: "2026-05-31 10:00:00", author: CUST, body: "Thanks, all set." }]) },
    { number: "B", work_notes: journal([{ ts: "2026-05-31 10:00:00", author: CUST, body: "Still broken and failing." }]) },
  ];
  assert.deepStrictEqual(summarizeSentiment(rows), summarizeSentiment(rows));
});

/* ============================ valence sign ============================= */

// Frozen fixture (seed lines + representative support lines). Context-only tone
// is held out as non-strict (the lexicon is expected to miss sarcasm and
// impact-without-explicit-negativity). Strict lines must clear ≥60% agreement.
const STRICT = [
  ["We have resolved the issue. Thank you.", "Positive"],
  ["Thank you very much. Highly appreciated.", "Positive"],
  ["Perfect, thank you", "Positive"],
  ["That worked perfectly, all set now.", "Positive"],
  ["Great, that resolved it. Thanks!", "Positive"],
  ["I'm still having a problem downloading a couple of night audit reports", "Negative"],
  ["This explanation was irrelevant and the problem keeps getting kicked down the road", "Negative"],
  ["The system is completely broken and crashing every time.", "Negative"],
  ["This is unacceptable, we are still waiting and the report is wrong.", "Negative"],
  ["We are unable to access the system, this is urgent.", "Negative"],
  ["This can be closed - duplicate case", "Neutral"],
  ["Please find the attached log file for review.", "Neutral"],
  ["Can you confirm the maintenance window for next week?", "Neutral"],
];

// Context-only — exercised for determinism / no-NaN, NOT asserted for sign.
const CONTEXT = [
  "DOD Res Center is receiving calls from guests stating they have not received their confirmation e-mails",
  "is statistics report discrepancy fixed by now ?",
];

test("valence: sign agreement on strict fixture ≥ 60%", () => {
  const hits = STRICT.filter(([t, want]) => lineLabel(t) === want).length;
  const agreement = hits / STRICT.length;
  assert.ok(agreement >= 0.6, `sign agreement ${(agreement * 100).toFixed(0)}% < 60%`);
});

test("valence: high-confidence individual signs", () => {
  assert.equal(lineLabel("Perfect, thank you"), "Positive");
  assert.equal(lineLabel("We have resolved the issue. Thank you."), "Positive");
  assert.equal(lineLabel("I'm still having a problem downloading a couple of night audit reports"), "Negative");
  assert.equal(lineLabel("This explanation was irrelevant and the problem keeps getting kicked down the road"), "Negative");
  assert.equal(lineLabel("This can be closed - duplicate case"), "Neutral");
});

test("valence: context-only lines stay finite (no NaN), determinism holds", () => {
  for (const t of CONTEXT) {
    const s = scoreText(t);
    assert.ok(Number.isFinite(s.valence));
    assert.deepStrictEqual(scoreText(t), scoreText(t));
  }
});

/* ====================== diminishing-returns cap ======================== */

test("cap: after 3 distinct same-polarity hits, extras weigh 0.5×", () => {
  // broken(-2) frozen(-1.8) crashing(-2.2) | failing(-2)→-1 stuck(-1.5)→-0.75
  const s = scoreText("broken frozen crashing failing stuck");
  assert.equal(s.neg.length, 5); // five distinct negative hits recorded
  const uncapped = -2 - 1.8 - 2.2 - 2 - 1.5; // -9.5
  const capped = -2 - 1.8 - 2.2 - 1 - 0.75; // -7.75
  assert.ok(Math.abs(s.raw - capped) < 1e-9, `raw ${s.raw} != ${capped}`);
  assert.ok(s.raw > uncapped); // cap pulled it back toward zero
  assert.ok(s.valence < 0); // still negative overall
});

test("cap: distinct keys only — a repeated term is not extra signal", () => {
  const once = scoreText("broken");
  const thrice = scoreText("broken broken broken");
  assert.equal(once.raw, thrice.raw);
});

/* ================================ arc ================================== */

const twoTouch = (b1, b2) =>
  gradeCase({
    number: "ARC",
    work_notes: journal([
      { ts: "2026-05-31 09:00:00", author: CUST, body: b1 },
      { ts: "2026-05-31 17:00:00", author: CUST, body: b2 },
    ]),
  });

test("arc: negative open → positive close = improved (recovery)", () => {
  const g = twoTouch("This is broken and not working, very frustrating.", "Perfect, that resolved it. Thank you!");
  assert.ok(g.start < 0);
  assert.ok(g.end > 0);
  assert.equal(g.arc, "improved (recovery)");
});

test("arc: positive open → negative close = declined", () => {
  const g = twoTouch("Great, thanks, that works.", "Actually it's broken again and still failing.");
  assert.equal(g.arc, "declined");
});

test("arc: flat tone = stable", () => {
  const g = twoTouch("Please see the attached export.", "Any update on the ticket reference?");
  assert.equal(g.arc, "stable");
});

test("arc: single customer message = single touchpoint, end null", () => {
  const g = gradeCase({
    number: "ARC-1",
    work_notes: journal([{ ts: "2026-05-31 09:00:00", author: CUST, body: "Thanks, that works." }]),
  });
  assert.equal(g.arc, "single touchpoint");
  assert.equal(g.end, null);
});

/* ============================== hygiene ================================ */

test("hygiene: identical analyst body twice within 60s → dup flag", () => {
  const g = gradeCase({
    number: "DUP",
    work_notes: journal([
      { ts: "2026-05-31 09:00:00", author: ANALYST, body: "We are looking into this now." },
      { ts: "2026-05-31 09:00:30", author: ANALYST, body: "We are looking into this now." },
    ]),
  });
  assert.equal(g.dup, true);
});

test("hygiene: AnyDesk / password: in the stream → pii flag", () => {
  const anydesk = gradeCase({
    number: "PII1",
    work_notes: journal([{ ts: "2026-05-31 09:00:00", author: CUST, body: "You can connect with AnyDesk if needed." }]),
  });
  assert.equal(anydesk.pii, true);

  const pwd = gradeCase({
    number: "PII2",
    work_notes: journal([{ ts: "2026-05-31 09:00:00", author: CUST, body: "The password: hunter2 should work." }]),
  });
  assert.equal(pwd.pii, true);

  const clean = gradeCase({
    number: "PII3",
    work_notes: journal([{ ts: "2026-05-31 09:00:00", author: CUST, body: "Thanks, all good now." }]),
  });
  assert.equal(clean.pii, false);
});

/* =========================== emotions / target ========================= */

test("emotions: controlled vocabulary, defaults to neutral/transactional", () => {
  assert.deepEqual(detectEmotions("thank you so much"), ["grateful"]);
  assert.deepEqual(detectEmotions("this is still not working and frustrating"), detectEmotions("this is still not working and frustrating"));
  assert.deepEqual(detectEmotions(""), ["neutral/transactional"]);
});

test("frustration target: product vs service vs none", () => {
  assert.equal(detectFrustrationTarget("the report is broken and the screen crashes", -2), "product");
  assert.equal(detectFrustrationTarget("no response for days, kicked down the road", -2), "service");
  assert.equal(detectFrustrationTarget("thanks, all set", 3), "none");
});

/* ============================= summary math ============================ */

test("summary: coverage, distribution, recovery, responsiveness on a known batch", () => {
  const rows = [
    // r1 — positive, single touchpoint, FRT 0.5h
    {
      number: "R1",
      _frtMs: 0.5 * 3.6e6,
      work_notes: journal([{ ts: "2026-05-31 09:00:00", author: CUST, body: "Perfect, thank you so much!" }]),
    },
    // r2 — frustrated open → positive close (recovery), FRT 2h
    {
      number: "R2",
      _frtMs: 2 * 3.6e6,
      work_notes: journal([
        { ts: "2026-05-31 09:00:00", author: CUST, body: "This is broken and failing." },
        { ts: "2026-05-31 16:00:00", author: CUST, body: "Resolved now, thank you!" },
      ]),
    },
    // r3 — silent (analyst only), FRT 0.25h
    {
      number: "R3",
      _frtMs: 0.25 * 3.6e6,
      work_notes: journal([{ ts: "2026-05-31 09:00:00", author: ANALYST, body: "Closed via phone." }]),
    },
    // r4 — negative single touchpoint, FRT 5h
    {
      number: "R4",
      _frtMs: 5 * 3.6e6,
      work_notes: journal([{ ts: "2026-05-31 09:00:00", author: CUST, body: "Still broken, still failing, unacceptable." }]),
    },
  ];

  const { summary } = summarizeSentiment(rows);
  assert.equal(summary.analyzed, 4);
  assert.equal(summary.scoreableCount, 3);
  assert.equal(summary.silent, 1);
  assert.equal(summary.scoreableShare, 0.75);

  // distribution: R1 + R2 positive, R4 negative, none neutral
  assert.equal(summary.pos, 2);
  assert.equal(summary.neu, 0);
  assert.equal(summary.neg, 1);
  assert.ok(summary.avgValence > 0);
  assert.ok(summary.normalized100 > 50 && summary.normalized100 < 65);

  // trajectory: R2 and R4 opened frustrated; only R2 closed positive
  assert.equal(summary.openedFrustrated, 2);
  assert.equal(summary.recovered, 1);
  assert.equal(summary.stillNegative, 0);
  assert.equal(summary.calmToNegative, 0);

  // responsiveness from FRT (hours): [0.25, 0.5, 2, 5] → median 1.25, 2/4 ≤ 1h
  assert.equal(summary.medianFrtH, 1.25);
  assert.equal(summary.within1hShare, 0.5);

  // hygiene: nothing flagged in this batch
  assert.equal(summary.duplicatePosts, 0);
  assert.equal(summary.piiExposure, 0);
});
