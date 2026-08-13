// Engine tests for the v11 sentiment / escalation-early-warning rewrite.
// Every behavior asserted here was grounded in the corpus study of two real
// exports (see sentiment.js header): [code]-wrapped HTML customer messages,
// phatic gratitude, signature/disclaimer poisoning, "Reply From:" relays,
// structured escalation workflow notes, chase messages, and the
// solution-proposed confirm/pushback/conditional/silent split.
// Runs under `node --test`.
import test from "node:test";
import assert from "node:assert/strict";

import {
  cleanBody,
  stripQuoted,
  parseJournal,
  parseInteractionStream,
  scoreMessage,
  scoreText,
  analyzeJournal,
  gradeCase,
  gradeFromRow,
  summarizeSentiment,
  RISK_HIGH,
  RISK_ELEVATED,
} from "./sentiment.js";

const J = (entries) => entries.map((e) => `${e.ts} - ${e.author}\n${e.body}`).join("\n\n");
const CUST = "Guest Contact (Additional comments)";
const ANALYST = "Agent Name (Infor) (Additional comments)";
const SYS = "System (Additional comments)";
const DAY = 86400000;
const T0 = "2026-06-01 09:00:00";
const T0_MS = new Date("2026-06-01T09:00:00").getTime();

/* ========================= cleaning ========================= */

test("cleanBody UNWRAPS [code] blocks — the customer's words survive (v9 deleted them)", () => {
  const raw = "[code]<p>Hi</p>\n<p>The night audit is still failing.&nbsp;</p>[/code]";
  const out = cleanBody(raw);
  assert.match(out, /night audit is still failing/);
  assert.doesNotMatch(out, /\[code\]|<p>|&nbsp;/);
});

test("cleanBody strips URLs and cid refs before punctuation features (urldefense '!!' must not read as shouting)", () => {
  const out = cleanBody("see https://urldefense.com/v3/__http:/x__;!!PoGYGYb4!jC_EZ [cid:abc-123] done");
  assert.doesNotMatch(out, /urldefense|!!|cid:/);
  const { features } = scoreMessage(out);
  assert.equal(features.bangRuns, 0);
});

test("stripQuoted cuts reply chains, signatures and legal disclaimers", () => {
  const msg = [
    "The report is still broken.",
    "",
    "Best regards,",
    "Milja",
    "Milja Perkovic|Director of Revenue Management",
    "T: 646 277 3207 | F: 212 721 3521",
    "IMPORTANT DISCLOSURE: This message may contain confidential information. If received in error notify the sender immediately.",
  ].join("\n");
  const out = stripQuoted(msg);
  assert.match(out, /still broken/);
  assert.doesNotMatch(out, /Revenue Management|646|DISCLOSURE|immediately/);
});

test("stripQuoted cuts a signature even when the sign-off IS the whole message", () => {
  const out = stripQuoted("Thank you!\n\nRossanne Cruz\n\nFront Office Supervisor\n\nCampus Tower Suite Hotel");
  assert.equal(out, "Thank you!");
});

test("stripQuoted keeps real content after a mid-message thanks line", () => {
  const out = stripQuoted("Thanks!\nAlso, the export is still empty — can you check again?");
  assert.match(out, /still empty/);
});

test("stripQuoted cuts quoted email history (From:/wrote:)", () => {
  const out = stripQuoted("It works now, thanks.\nFrom: support@infor.com\nSent: Monday\nEarlier text that is not the customer's.");
  assert.equal(out, "It works now, thanks.");
});

/* ==================== attribution & events ==================== */

test("parseJournal: Infor authors are analysts, System is system, everyone else is the customer", () => {
  const blob = J([
    { ts: T0, author: ANALYST, body: "We are looking into it." },
    { ts: "2026-06-01 10:00:00", author: CUST, body: "Any update on this?" },
    { ts: "2026-06-01 11:00:00", author: "System  Automatic Reminders (Infor) (Work notes)", body: "ServiceNow has automatically sent the reminder." },
  ]);
  const [a, c, s] = parseJournal(blob);
  assert.equal(a.who, "analyst");
  assert.equal(c.who, "customer");
  assert.equal(s.who, "system"); // "System … (Infor)" is the automated actor, not an analyst
});

test("parseJournal: 'Reply From: email' System notes are re-attributed as CUSTOMER voice", () => {
  const blob = J([{ ts: T0, author: SYS, body: "Reply From: guest@hotel.com\n\nThank you, it works now. You can close the case." }]);
  const [m] = parseJournal(blob);
  assert.equal(m.who, "customer");
  assert.match(m.text, /works now/);
  assert.doesNotMatch(m.text, /Reply From/);
});

test("parseJournal: work-notes-typed entries are never customer voice (internal staff without the tag)", () => {
  const blob = J([{ ts: T0, author: "Katie White (Work notes)", body: "internal note about the defect" }]);
  const [m] = parseJournal(blob);
  assert.equal(m.who, "internal");
});

test("parseJournal detects structured workflow events (escalation request, customer priority raise)", () => {
  const blob = J([
    { ts: T0, author: CUST, body: "Escalation has been requested by customer Escalation Reason: Inactivity Escalation Justification: Not solved" },
    { ts: "2026-06-01 10:00:00", author: CUST, body: "Anon Popradit has changed the priority of the case to 1-Critical . The reason for the change is: the customer is being significantly impacted." },
  ]);
  const [esc, pri] = parseJournal(blob);
  assert.equal(esc.event, "escalation_request");
  assert.equal(pri.event, "priority_change");
  assert.equal(pri.eventMatch[1], "1");
});

test("parseInteractionStream keeps the v9 consumer shape (ts/author/isCustomer/body)", () => {
  const blob = J([{ ts: T0, author: CUST, body: "hello" }]);
  const [m] = parseInteractionStream(blob);
  assert.equal(m.isCustomer, true);
  assert.equal(typeof m.ts, "number");
  assert.equal(m.body, "hello");
});

/* ======================= message scoring ======================= */

test("gratitude is phatic: 'thanks' scores positive alone but ZERO when trouble is present", () => {
  assert.ok(scoreMessage("Thank you so much!").valence > 0);
  const polite = scoreMessage("Thanks, but the interface is still not working again today.");
  assert.ok(polite.valence < 0, `polite frustration must stay negative, got ${polite.valence}`);
});

test("confirmation & satisfaction drive positive; scoreText alias agrees", () => {
  const v = scoreMessage("Perfect, it works now — you can close the case.").valence;
  assert.ok(v >= 3);
  assert.equal(scoreText("Perfect, it works now — you can close the case.").valence, v);
});

test("urgency/impact are amplifiers, not standalone negatives (neutral workflow requests stay ~neutral)", () => {
  const neutral = scoreMessage("Could you map the payment tender coupon to transaction code COUPON today?");
  assert.ok(Math.abs(neutral.valence) < 1, `neutral request drifted to ${neutral.valence}`);
  const amplified = scoreMessage("Guests are waiting at the front desk and check-in is still failing — this is urgent!");
  assert.ok(amplified.valence < -2);
});

test("chase detection: short prod-for-response messages flag isChase", () => {
  assert.equal(scoreMessage("Hi team, any update please?").features.isChase, true);
  assert.equal(scoreMessage("Please find attached the full log export you asked for; steps to reproduce are below." + " detail".repeat(60)).features.isChase, false);
});

test("scoring is deterministic and negative piles compress into the -5..+5 band", () => {
  const rant = "Still broken, still failing, crashes every day, nobody responded, this is unacceptable!!";
  const a = scoreMessage(rant), b = scoreMessage(rant);
  assert.deepStrictEqual(a, b);
  assert.ok(a.valence >= -5 && a.valence <= -3);
});

/* ==================== case-level: early warning ==================== */

test("unanswered chases + waiting time raise escalation risk with named factors", () => {
  const blob = J([
    { ts: T0, author: CUST, body: "The interface is failing again, same issue as last week." },
    { ts: "2026-06-02 09:00:00", author: ANALYST, body: "We are checking." },
    { ts: "2026-06-03 09:00:00", author: CUST, body: "Any update please?" },
    { ts: "2026-06-05 09:00:00", author: CUST, body: "Still waiting for a response, this is urgent." },
  ]);
  const a = analyzeJournal(blob, { lifecycle: "open", snapshotMs: T0_MS + 8 * DAY });
  assert.ok(a.risk >= RISK_ELEVATED, `risk ${a.risk} should be at least elevated`);
  assert.equal(a.trailingUnanswered, 2);
  assert.ok(a.chases >= 1);
  assert.ok(a.factors.some((f) => /awaiting a reply/.test(f)));
  assert.ok(a.factors.some((f) => /chase/.test(f)));
});

test("a calm answered thread scores low risk", () => {
  const blob = J([
    { ts: T0, author: CUST, body: "Could you add a new rate code for us?" },
    { ts: "2026-06-01 10:00:00", author: ANALYST, body: "Done — please verify." },
    { ts: "2026-06-01 11:00:00", author: CUST, body: "Confirmed working, thank you. You can close the case." },
  ]);
  const a = analyzeJournal(blob, { lifecycle: "open", snapshotMs: T0_MS + 1 * DAY });
  assert.ok(a.risk < 15, `calm thread got risk ${a.risk}`);
});

test("an escalation workflow note sets escalated + reason and is EXCLUDED from tone", () => {
  const blob = J([
    { ts: T0, author: CUST, body: "Escalation has been requested by customer Escalation Reason: Lack of Progress Escalation Justification: three weeks with no fix" },
  ]);
  const a = analyzeJournal(blob, { lifecycle: "open", snapshotMs: T0_MS + DAY });
  assert.equal(a.escalated, true);
  assert.match(a.escReason, /Lack of Progress/);
  assert.match(a.escReason, /three weeks/);
  assert.equal(a.scoreable, false); // the workflow note is an event, not a message
});

test("a customer priority raise to 1/2 counts as an escalation event; a lower to 3/4 does not", () => {
  const raise = analyzeJournal(J([{ ts: T0, author: CUST, body: "X has changed the priority of the case to 1-Critical . The reason for the change is: cannot use the system" }]), { lifecycle: "open" });
  assert.equal(raise.escalated, true);
  const lower = analyzeJournal(J([{ ts: T0, author: CUST, body: "X has changed the priority of the case to 4-Standard . The reason for the change is: less pressing now" }]), { lifecycle: "open" });
  assert.equal(lower.escalated, false);
});

test("INITIAL DESCRIPTION echoes and data-access notes never count as conversation", () => {
  const blob = J([
    { ts: T0, author: CUST, body: "INITIAL DESCRIPTION: The system is broken and nothing works at all." },
    { ts: "2026-06-01 10:00:00", author: CUST, body: "The Data Access fields updated by Miguel Rivera on 2026-06-01" },
  ]);
  const a = analyzeJournal(blob, { lifecycle: "open" });
  assert.equal(a.scoreable, false);
  assert.equal(a.nCustomer, 0);
});

/* ==================== case-level: solution proposed ==================== */

const RESOLUTION = { ts: "2026-06-03 09:00:00", author: ANALYST, body: "[code]<b>Resolution notes</b>[/code] Fix applied as described." };

test("solution proposed: pushback after the resolution event → high reopen risk", () => {
  const blob = J([
    { ts: T0, author: CUST, body: "The export is failing." },
    RESOLUTION,
    { ts: "2026-06-04 09:00:00", author: CUST, body: "This does not address the issue — I am still seeing the same error." },
  ]);
  const a = analyzeJournal(blob, { lifecycle: "solution_proposed", snapshotMs: T0_MS + 5 * DAY });
  assert.equal(a.confirmState, "pushback");
  assert.ok(a.risk >= 80);
});

test("solution proposed: conditional hold ('keep it open until we test') → medium reopen risk", () => {
  const blob = J([
    { ts: T0, author: CUST, body: "The export is failing." },
    RESOLUTION,
    { ts: "2026-06-04 09:00:00", author: CUST, body: "Thanks — please keep this case open until we test after the next night audit." },
  ]);
  const a = analyzeJournal(blob, { lifecycle: "solution_proposed", snapshotMs: T0_MS + 5 * DAY });
  assert.equal(a.confirmState, "conditional");
});

test("solution proposed: written confirmation → low reopen risk; silence → unconfirmed middle", () => {
  const confirmed = analyzeJournal(J([
    { ts: T0, author: CUST, body: "The export is failing." },
    RESOLUTION,
    { ts: "2026-06-04 09:00:00", author: CUST, body: "Confirmed fixed, works fine now. You can close the case." },
  ]), { lifecycle: "solution_proposed", snapshotMs: T0_MS + 5 * DAY });
  assert.equal(confirmed.confirmState, "confirmed");
  assert.ok(confirmed.risk <= 15);

  const silent = analyzeJournal(J([
    { ts: T0, author: CUST, body: "The export is failing." },
    RESOLUTION,
  ]), { lifecycle: "solution_proposed", snapshotMs: T0_MS + 5 * DAY });
  assert.equal(silent.confirmState, "silent");
  assert.ok(silent.risk > confirmed.risk && silent.risk < 80);
});

/* ==================== case-level: closed retrospective ==================== */

test("closed: recovery arc + written confirmation are both captured", () => {
  const blob = J([
    { ts: T0, author: CUST, body: "This is broken and not working, very frustrating." },
    { ts: "2026-06-01 12:00:00", author: ANALYST, body: "Fix deployed." },
    { ts: "2026-06-01 16:00:00", author: CUST, body: "Resolved now, works fine — thank you!" },
  ]);
  const a = analyzeJournal(blob, { lifecycle: "closed" });
  assert.equal(a.arc, "recovered");
  assert.equal(a.confirmState, "confirmed");
  assert.equal(a.risk, null); // closed cases carry no forward-looking risk
});

/* ==================== hygiene (carried over from v9) ==================== */

test("hygiene: pasted credentials and analyst double-posts still flag", () => {
  const blob = J([
    { ts: T0, author: CUST, body: "password: hunter2 — use anydesk to connect" },
    { ts: "2026-06-01 10:00:00", author: ANALYST, body: "Same reply." },
    { ts: "2026-06-01 10:00:30", author: ANALYST, body: "Same reply." },
  ]);
  const a = analyzeJournal(blob, { lifecycle: "open" });
  assert.equal(a.pii, true);
  assert.equal(a.dup, true);
});

/* ==================== gradeCase / gradeFromRow / summary ==================== */

test("gradeCase reads additional_comments first and mirrors analyzeJournal", () => {
  const blob = J([{ ts: T0, author: CUST, body: "Still waiting for any update, this is urgent!" }]);
  const g = gradeCase({ number: "C-1", account: "Acme", state: "Open", additional_comments: blob, _snapshotMs: T0_MS + 4 * DAY });
  assert.equal(g.scoreable, true);
  assert.equal(g.lifecycle, "open");
  assert.ok(g.risk > 0);
  assert.ok(g.lastQuote.includes("Still waiting"));
});

test("gradeFromRow emits the full v11 snake_case column set with no undefined values", () => {
  const blob = J([{ ts: T0, author: CUST, body: "Any update?" }]);
  const out = gradeFromRow({ number: "C-2", state: "Open", additional_comments: blob }, null, T0_MS + DAY, null);
  const KEYS = [
    "sentiment_scoreable", "sentiment_valence", "sentiment_label", "sentiment_start", "sentiment_end",
    "sentiment_arc", "sentiment_signals", "sentiment_quote", "sentiment_coaching", "sentiment_pii",
    "sentiment_dup", "sentiment_risk", "sentiment_risk_factors", "sentiment_escalated",
    "sentiment_esc_reason", "sentiment_confirm", "sentiment_chases", "sentiment_unanswered",
    "sentiment_wait_days", "sentiment_last_quote",
  ];
  assert.deepStrictEqual(Object.keys(out).sort(), [...KEYS].sort());
  for (const k of KEYS) assert.notEqual(typeof out[k], "undefined", `${k} is undefined`);
});

test("summarizeSentiment segments by lifecycle and surfaces the early-warning counts", () => {
  const openHot = {
    number: "O-1", state: "Open",
    additional_comments: J([
      { ts: T0, author: CUST, body: "Still broken, same issue again — urgent, guests are waiting at check-in!" },
      { ts: "2026-06-02 09:00:00", author: CUST, body: "Any update??" },
      { ts: "2026-06-04 09:00:00", author: CUST, body: "Still waiting. Please escalate this to your manager." },
    ]),
    _snapshotMs: T0_MS + 10 * DAY,
  };
  const spPush = {
    number: "SP-1", state: "Resolved",
    additional_comments: J([
      { ts: T0, author: CUST, body: "Export failing." },
      RESOLUTION,
      { ts: "2026-06-04 09:00:00", author: CUST, body: "Still failing — this does not fix the issue." },
    ]),
    _snapshotMs: T0_MS + 10 * DAY,
  };
  const closedGood = {
    number: "CL-1", state: "Closed",
    additional_comments: J([{ ts: T0, author: CUST, body: "Works perfectly now, thanks — you can close the case." }]),
  };
  const { summary, open, proposed, closed } = summarizeSentiment([openHot, spPush, closedGood]);
  assert.equal(open.length, 1);
  assert.equal(proposed.length, 1);
  assert.equal(closed.length, 1);
  assert.equal(summary.spPushback, 1);
  assert.ok(open[0].risk >= RISK_HIGH, `hot open case got risk ${open[0].risk}`);
  assert.equal(summary.highRisk, 1);
  assert.equal(summary.confirmedClose, 1);
});

test("summarizeSentiment prefers baked v11 columns and never re-parses them", () => {
  const baked = {
    number: "B-1", state: "Open", _lifecycle: "open",
    sentiment_scoreable: true, sentiment_valence: -3, sentiment_label: "Negative",
    sentiment_start: -3, sentiment_end: null, sentiment_arc: "single touchpoint",
    sentiment_signals: "neglect", sentiment_quote: "q", sentiment_coaching: "c",
    sentiment_pii: false, sentiment_dup: false, sentiment_risk: 62,
    sentiment_risk_factors: "3 customer messages awaiting a reply (+24)",
    sentiment_escalated: false, sentiment_esc_reason: null, sentiment_confirm: null,
    sentiment_chases: 2, sentiment_unanswered: 3, sentiment_wait_days: 5,
    sentiment_last_quote: "still waiting",
    // journal deliberately ABSENT — resolveGrade must not need it
  };
  const { open, summary } = summarizeSentiment([baked]);
  assert.equal(open[0].risk, 62);
  assert.equal(summary.highRisk, 1);
});
