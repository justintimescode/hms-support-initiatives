// SECURITY #1 — PII scrubber for AI payloads (defense in depth).
//
// Every payload bound for the AI proxy passes through `scrubForAi` BEFORE it
// leaves the browser, even though the eventual server-side proxy is expected
// to re-scrub. Two independent scrubs mean a bug or misconfiguration on either
// side still leaves customer PII masked.
//
// Identifiers (case numbers, account names, analyst names) are replaced with
// `PREFIX-<shortHash>` tokens. The hash is deterministic per value, so the AI
// can still reason that "these cases share an account" without ever seeing the
// real name. Free-text fields get a light regex scrub (emails, name pairs,
// case-number-shaped tokens) and a hard 400-char cap.
//
// The hash is a synchronous non-cryptographic FNV-1a (6 hex chars). It is NOT
// a security boundary — the real protection is that raw values never leave the
// browser. A sync hash keeps `scrubForAi` (and its callers) synchronous;
// crypto.subtle.digest is async and would force the whole AI path to await.

/** FNV-1a → 6 lowercase hex chars. Deterministic for a given input. */
export function shortHash(input) {
  const s = String(input ?? "")
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  // >>> 0 to keep it unsigned, then 6 hex chars.
  return (h >>> 0).toString(16).padStart(8, "0").slice(0, 6)
}

const mask = (prefix, value) =>
  value == null || value === "" ? value : `${prefix}-${shortHash(value)}`

const EMAIL_RE = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g
// ServiceNow-style identifiers: 2-5 caps + 6+ digits (CS0012345, SCS0098765),
// or explicit CASE-/RN- prefixes.
const CASENUM_RE = /\b(?:[A-Z]{2,5}\d{6,}|(?:CASE|RN)-[A-Za-z0-9]+)\b/g
// Light name heuristic: two consecutive Capitalized words (First Last).
const NAME_PAIR_RE = /\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/g
// Phone numbers: a separated/parenthesized 3-3-4 grouping with an optional
// country code. Conservative on purpose — requires separators so it can't eat
// ISO dates (2026-05-31) or bare numeric IDs; the customer comment stream the
// sentiment deep-read sends is the main field this protects.
const PHONE_RE = /\b(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{3}\)[\s.-]?|\d{3}[\s.-])\d{3}[\s.-]?\d{4}\b/g

/** Light scrub for free-text: mask emails / case numbers / phones / name pairs, cap 400. */
export function scrubText(text) {
  if (!text) return ""
  return String(text)
    .replace(EMAIL_RE, "[email]")
    .replace(CASENUM_RE, "[case]")
    .replace(PHONE_RE, "[phone]")
    .replace(NAME_PAIR_RE, "[name]")
    .slice(0, 400)
}

/**
 * Mask PII in an AI payload. Non-mutating — returns a new object.
 * Recognized fields are masked wherever they appear (top-level `label` and
 * each entry in `cases`); unknown fields pass through untouched.
 *
 * @param {{ label?: string, cases?: Array<object> }} payload
 * @returns {object} scrubbed payload, safe to send off-device
 */
export function scrubForAi(payload) {
  if (!payload || typeof payload !== "object") return payload
  const out = { ...payload }

  // `label` is the analysis scope — often a real analyst name. Leave the
  // sentinel "all analysts" readable; mask anything that looks like a person.
  if (out.label && out.label !== "all analysts") {
    out.label = mask("ANALYST", out.label)
  }

  if (Array.isArray(out.cases)) {
    out.cases = out.cases.map((c) => {
      const r = { ...c }
      if ("number" in r) r.number = mask("CASE", r.number)
      if ("account" in r) r.account = mask("ACCOUNT", r.account)
      if ("assigned_to" in r) r.assigned_to = mask("ANALYST", r.assigned_to)
      if ("short_description" in r) r.short_description = scrubText(r.short_description)
      if ("close_notes" in r) r.close_notes = scrubText(r.close_notes)
      // Sentiment deep-read free-text (the customer's own words + the picked
      // quote). The existing insights payload never carries these keys, so this
      // is additive; for the deep-read it is the load-bearing scrub.
      if ("comments" in r) r.comments = scrubText(r.comments)
      if ("quote" in r) r.quote = scrubText(r.quote)
      if ("work_notes" in r) r.work_notes = scrubText(r.work_notes)
      return r
    })
  }

  return out
}

/*
 * Example — what the scrubber produces (illustrative, hashes are stable):
 *
 *   scrubForAi({
 *     label: "Jane Smith",
 *     totalCases: 2,
 *     cases: [
 *       { number: "CS0012345", account: "Fort Bragg Lodging",
 *         assigned_to: "Jane Smith", priority: "1 - Critical",
 *         short_description: "Night audit failed, contact john.doe@army.mil",
 *         close_notes: "Escalated to Bob Jones re ticket CS0012345" },
 *     ],
 *   })
 *
 *   => {
 *     label: "ANALYST-1a2b3c",
 *     totalCases: 2,
 *     cases: [
 *       { number: "CASE-9f8e7d", account: "ACCOUNT-4c5d6e",
 *         assigned_to: "ANALYST-1a2b3c", priority: "1 - Critical",
 *         short_description: "Night audit failed, contact [email]",
 *         close_notes: "Escalated to [name] re ticket [case]" },
 *     ],
 *   }
 *
 * Invariants worth checking if you touch this:
 *   - same input value -> same token  (account/analyst correlation preserved)
 *   - no raw email / CSxxxxxxx / "First Last" survives in the text fields
 *   - text fields are <= 400 chars
 *   - "all analysts" label is left intact (not a person)
 */
