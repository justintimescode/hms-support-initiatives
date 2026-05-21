// SECURITY #7 — CSV / formula-injection sanitizer for data EXPORT.
//
// NOTE: this app has no export feature today. This util exists so that the
// moment one is added (a common request — "download the case table"), the
// safe primitive is already here and reviewers can require its use.
//
// The risk: a ServiceNow cell like `=cmd|'/c calc'!A1` or `+HYPERLINK(...)` is
// inert in the browser, but if written verbatim into a .csv and opened in
// Excel/Sheets it executes as a formula. Prefixing a leading dangerous
// character with a single quote forces the spreadsheet to treat the cell as
// text. See OWASP "CSV Injection".

// Leading characters that trigger formula evaluation in spreadsheet apps.
const DANGEROUS_LEADING = ["=", "+", "-", "@", "\t", "\r", "\n"];

/**
 * Make a single value safe to write into an exported CSV/XLSX cell.
 * Prefixes a leading formula-trigger character with a single quote. Non-string
 * values (numbers, booleans, null) are returned unchanged — only strings can
 * carry an injection payload.
 *
 * @param {*} value
 * @returns {*} sanitized value (string) or the original non-string value
 */
export function sanitizeCellForExport(value) {
  if (typeof value !== "string" || value.length === 0) return value;
  return DANGEROUS_LEADING.includes(value[0]) ? `'${value}` : value;
}

/**
 * Sanitize a row of values and join them into a CSV line. Each field is
 * passed through sanitizeCellForExport, then double-quoted with internal
 * quotes doubled (RFC 4180) so commas/quotes/newlines don't break the row.
 *
 * @param {Array<*>} values
 * @returns {string} a single CSV row (no trailing newline)
 */
export function toCsvRow(values) {
  return values
    .map((v) => {
      const safe = sanitizeCellForExport(v);
      return `"${String(safe ?? "").replace(/"/g, '""')}"`;
    })
    .join(",");
}
