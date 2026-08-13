// Times the pure data pipeline (parse → enrichRow → aggregate) outside the
// browser, so business-logic cost is separated from React cost, and prints a
// hash of every derived output.
//
// The hashes are the parity contract for any optimization that touches the
// pipeline: same input file + same frozen clock must produce the same digest
// before and after. `Date.now` is pinned so runs are reproducible.
//
// Reads the newest source file from .servicenow-cache/ (the dev disk mirror).
// Usage: node scripts/pipeline-bench.mjs [--json]

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')

// Pinned wall clock — every "days since" derivation in the pipeline reads this.
const FROZEN_NOW = Date.UTC(2026, 6, 1, 12, 0, 0)
const realNow = Date.now
Date.now = () => FROZEN_NOW

const { enrichRow, normalizeXlsxRow, priorityRank } = await import('../src/lib/enrich.js')
const {
  computeKpis, computeInteractionStats, topCounts, priorityMix,
  filterRowsByDate, qualityMetrics,
} = await import('../src/lib/stats.js')
const { priorityColor } = await import('../src/lib/format.js')

const time = async (label, fn) => {
  const t = realNow()
  const out = await fn()
  const ms = realNow() - t
  timings.push([label, ms])
  return out
}
const timings = []
const digest = (v) => crypto.createHash('sha256')
  .update(JSON.stringify(v, (_k, x) => (x instanceof Date ? x.toISOString() : x)))
  .digest('hex').slice(0, 16)

/* ---------------------------------------------------------------- load rows */
const cacheDir = path.join(root, '.servicenow-cache')
const dirs = fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir) : []
let source = null
let uploadedAt = null
for (const d of dirs) {
  const dir = path.join(cacheDir, d)
  const files = fs.existsSync(dir) ? fs.readdirSync(dir) : []
  const src = files.find((f) => f.startsWith('source.'))
  if (!src) continue
  const stat = fs.statSync(path.join(dir, src))
  if (!source || stat.mtimeMs > uploadedAt) { source = path.join(dir, src); uploadedAt = stat.mtimeMs }
}
if (!source) {
  console.error('No .servicenow-cache/*/source.* file found — nothing to benchmark.')
  process.exit(1)
}

const _pad2 = (n) => String(n).padStart(2, '0')
function xlsxCellValue(v) {
  if (v == null) return null
  if (v instanceof Date) {
    return `${v.getUTCFullYear()}-${_pad2(v.getUTCMonth() + 1)}-${_pad2(v.getUTCDate())} ` +
      `${_pad2(v.getUTCHours())}:${_pad2(v.getUTCMinutes())}:${_pad2(v.getUTCSeconds())}`
  }
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('')
    if ('text' in v) return v.text
    if ('result' in v) return v.result
    if ('error' in v) return null
    return String(v)
  }
  return v
}

const rows = await time('parse xlsx', async () => {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(fs.readFileSync(source))
  const ws = wb.worksheets[0]
  const headers = ws.getRow(1).values
  const out = []
  ws.eachRow((row, n) => {
    if (n === 1) return
    const obj = {}
    for (let i = 1; i < headers.length; i++) {
      const key = headers[i]
      if (key == null) continue
      obj[key] = xlsxCellValue(row.getCell(i).value)
    }
    out.push(obj)
  })
  return out.map(normalizeXlsxRow).map((r) => {
    const o = {}
    for (const k of Object.keys(r)) o[String(k).trim()] = r[k]
    return o
  })
})

/* -------------------------------------------------------------- the pipeline */
const snapshotMs = FROZEN_NOW
const enrichedAll = await time('enrichRow × all', () => rows.map((r) => enrichRow(r, snapshotMs)))

// Mirrors useAppData's derived chain for the default (no analyst, all-time) view.
const enrichedAnalyst = enrichedAll
const enriched = await time('filterRowsByDate', () => filterRowsByDate(enrichedAnalyst, null, null, '_created'))
const kpis = await time('computeKpis', () => computeKpis(enriched))

const teamMembersAll = await time('group by analyst', () => {
  const groups = new Map()
  for (const r of enrichedAnalyst) {
    const name = r.assigned_to || 'Unassigned'
    if (!groups.has(name)) groups.set(name, [])
    groups.get(name).push(r)
  }
  return [...groups.entries()].map(([name, list]) => ({ name, rows: list }))
})

const teamMembers = await time('teamMembers (7 stats × analyst)', () =>
  teamMembersAll.map((m) => {
    const list = filterRowsByDate(m.rows, null, null, '_created')
    return {
      name: m.name,
      kpis: computeKpis(list),
      topCategories: topCounts(list, (r) => r._category, 3),
      topAccounts: topCounts(list, (r) => r.account, 3),
      topProducts: topCounts(list, (r) => r.product_line, 3),
      priorityMix: priorityMix(list),
      interactionStats: computeInteractionStats(list),
      quality: qualityMetrics(list),
    }
  }).sort((a, b) => b.kpis.total - a.kpis.total))

const priorityData = await time('priorityData', () => {
  const groups = {}
  for (const r of enriched) {
    const p = r.priority || 'Unknown'
    groups[p] = groups[p] || { priority: p, total: 0, closed: 0, sla_met: 0, sla_total: 0, res_sum: 0, res_n: 0 }
    groups[p].total++
    if (r._isClosed) groups[p].closed++
    if (r._slaEligible) { groups[p].sla_total++; if (!r._slaBreached) groups[p].sla_met++ }
    if (r._resolvedMs != null) { groups[p].res_sum += r._resolvedMs; groups[p].res_n++ }
  }
  return Object.values(groups)
    .map((g) => ({ ...g, sla_pct: g.sla_total ? (g.sla_met / g.sla_total) * 100 : null, avg_res_h: g.res_n ? g.res_sum / g.res_n / 36e5 : null, color: priorityColor(g.priority) }))
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority))
})

/* ---------------------------------------------------------------- reporting */
const report = {
  source: path.relative(root, source),
  rows: rows.length,
  analysts: teamMembersAll.length,
  frozenNow: new Date(FROZEN_NOW).toISOString(),
  timings: Object.fromEntries(timings),
  digests: {
    enrichedAll: digest(enrichedAll),
    kpis: digest(kpis),
    teamMembers: digest(teamMembers),
    priorityData: digest(priorityData),
  },
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(`source: ${report.source} · ${report.rows} rows · ${report.analysts} analysts`)
  console.log('\n-- timings (ms) --')
  for (const [k, v] of timings) console.log(`  ${String(v).padStart(7)}  ${k}`)
  console.log('\n-- digests (parity contract) --')
  for (const [k, v] of Object.entries(report.digests)) console.log(`  ${v}  ${k}`)
}
