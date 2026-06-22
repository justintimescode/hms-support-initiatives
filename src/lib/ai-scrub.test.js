// PII-scrubber tests. Covers the deep-read additions (comments/quote/work_notes
// scrubbing) and the phone-number hardening, plus the non-mutating/deterministic
// guarantees the AI seam relies on. Runs under `node --test`.
import test from "node:test";
import assert from "node:assert/strict";

import { scrubText, scrubForAi, shortHash } from "./ai-scrub.js";

test("scrubText masks email, case number, phone, and name pairs", () => {
  const out = scrubText("Call John Smith at 212-555-0199 or email j.doe@army.mil re CS0012345");
  assert.ok(out.includes("[email]"), out);
  assert.ok(out.includes("[case]"), out);
  assert.ok(out.includes("[phone]"), out);
  assert.ok(out.includes("[name]"), out);
  assert.ok(!out.includes("212-555-0199"));
  assert.ok(!out.includes("army.mil"));
});

test("scrubText does not over-match ISO dates or short numbers", () => {
  const out = scrubText("Opened 2026-05-31, room 1204, ext 55");
  assert.ok(out.includes("2026-05-31"));
  assert.ok(out.includes("1204"));
  assert.ok(!out.includes("[phone]"));
});

test("scrubText caps at 400 chars and tolerates empty", () => {
  assert.equal(scrubText(""), "");
  assert.equal(scrubText("x".repeat(500)).length, 400);
});

test("scrubForAi masks ids and scrubs the deep-read free-text fields", () => {
  const out = scrubForAi({
    label: "all analysts",
    cases: [{
      ref: 0,
      number: "CS0012345",
      account: "Fort Bragg Lodging",
      valence: -3,
      sentiment: "Negative",
      arc: "declined",
      quote: "John Smith said it is broken, call 212-555-0199",
      comments: "email j.doe@army.mil for the night audit issue",
      work_notes: "blocked on ticket CS0099999",
    }],
  });
  const c = out.cases[0];
  assert.equal(out.label, "all analysts"); // sentinel stays readable
  assert.ok(c.number.startsWith("CASE-"));
  assert.ok(c.account.startsWith("ACCOUNT-"));
  assert.equal(c.ref, 0); // non-PII index untouched
  assert.equal(c.valence, -3); // structured fields untouched
  assert.equal(c.sentiment, "Negative");
  assert.ok(c.quote.includes("[name]") && c.quote.includes("[phone]"));
  assert.ok(!c.quote.includes("212-555-0199"));
  assert.ok(c.comments.includes("[email]"));
  assert.ok(c.work_notes.includes("[case]"));
});

test("scrubForAi is non-mutating and deterministic", () => {
  const payload = { cases: [{ number: "CS0012345", account: "Acme" }] };
  const a = scrubForAi(payload);
  const b = scrubForAi(payload);
  assert.deepStrictEqual(a, b);
  assert.equal(payload.cases[0].number, "CS0012345"); // original untouched
  assert.equal(shortHash("Acme"), shortHash("Acme")); // stable hash
});
