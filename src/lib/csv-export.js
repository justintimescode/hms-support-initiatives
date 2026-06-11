// SECURITY #7 — CSV / formula-injection sanitizer for data EXPORT.
//
// Every export feature (Update Queue, Jira Blockers) must build its CSV
// through rowsToCsv/toCsvRow below — never by joining raw strings.
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

/**
 * Build a complete CSV document (header line + data rows, CRLF-joined) with
 * every cell passed through the injection guard above.
 *
 * @param {Array<*>} headers
 * @param {Array<Array<*>>} rows
 * @returns {string}
 */
export function rowsToCsv(headers, rows) {
  const lines = [toCsvRow(headers)];
  for (const r of rows) lines.push(toCsvRow(r));
  return lines.join("\r\n");
}

/** Trigger a browser download of `csv` as `filename`. The leading BOM is
 *  required: without it, Excel on Windows decodes the file as the ANSI code
 *  page and mangles non-ASCII account/analyst names. */
export function downloadCsv(filename, csv) {
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Local-time filename stamp, e.g. "20260611-153042". */
export function csvTimestamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
