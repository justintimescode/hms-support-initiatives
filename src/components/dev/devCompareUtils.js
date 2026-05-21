// Pure helpers for the dev-only DevCompare validator. Kept out of the .jsx so
// fast-refresh stays happy (components-only export there). Deleted in Phase 5.

export function closeEnough(a, b, eps = 0.05) {
  if (a == null && b == null) return true
  if (a == null || b == null) return false
  return Math.abs(Number(a) - Number(b)) <= eps
}

/** Flatten two keyed arrays into DevCompare metrics. For each key (union of
 *  both sides) and each field, emit `{ name: "key·field", js, sql }`. */
export function flattenByKey(jsArr, sqlArr, keyField, valueFields) {
  const js = new Map((jsArr || []).map((d) => [d[keyField], d]))
  const sql = new Map((sqlArr || []).map((d) => [d[keyField], d]))
  const keys = [...new Set([...js.keys(), ...sql.keys()])]
  const out = []
  for (const k of keys) {
    for (const f of valueFields) {
      out.push({ name: `${k}·${f}`, js: js.get(k)?.[f] ?? null, sql: sql.get(k)?.[f] ?? null })
    }
  }
  return out
}

/** KPI metrics from the in-memory computeKpis shape (atRisk/breached arrays)
 *  vs the SQL getKpis shape (atRiskCount/breachedCount). */
export function kpiMetrics(js, sql) {
  if (!js || !sql) return []
  return [
    { name: "total", js: js.total, sql: sql.total },
    { name: "closed", js: js.closed, sql: sql.closed },
    { name: "open", js: js.open, sql: sql.open },
    { name: "slaEligible", js: js.slaEligible, sql: sql.slaEligible },
    { name: "slaMet", js: js.slaMet, sql: sql.slaMet },
    { name: "slaRate", js: js.slaRate, sql: sql.slaRate },
    { name: "avgRes", js: js.avgRes, sql: sql.avgRes },
    { name: "avgFrt", js: js.avgFrt, sql: sql.avgFrt },
    { name: "atRisk", js: js.atRisk?.length ?? js.atRiskCount, sql: sql.atRiskCount },
    { name: "breached", js: js.breached?.length ?? js.breachedCount, sql: sql.breachedCount },
  ]
}
