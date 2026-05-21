// Phase 3 — typed query helpers backed by DuckDB.
// Every helper takes `{ analyst, dateRange }` (some take more). `analyst`
// is either `'__all__'` (no filter) or an exact assignee. `dateRange` is
// `{ from, to, field }` where `field` is `'_created'` or `'_closed'`,
// mapping to the SQL columns `created_at` / `closed_at`.

import { dbClient } from './db-client.js'
import { priorityColor } from './format.js'
import {
  WARN_FRACTION,
  DEV_JIRA_CHECK_MS,
  INITIAL_RESPONSE_MS,
} from './sop-thresholds.js'

/* ---------- WHERE-clause builder ---------- */

/**
 * @param {object} args
 * @param {string|null} [args.analyst]
 * @param {{from:number|null,to:number|null,field:string}|null} [args.dateRange]
 * @returns {{ sql: string, params: any[] }}
 */
export function buildWhere({ analyst, dateRange } = {}) {
  const conds = []
  const params = []
  if (analyst && analyst !== '__all__') {
    conds.push('assigned_to = ?')
    params.push(analyst)
  }
  const dr = dateRange || {}
  if (dr.from != null || dr.to != null) {
    const field = dr.field === '_closed' ? 'closed_at' : 'created_at'
    if (dr.from != null) {
      conds.push(`${field} >= ?::TIMESTAMP`)
      params.push(new Date(dr.from).toISOString())
    }
    if (dr.to != null) {
      conds.push(`${field} <= ?::TIMESTAMP`)
      params.push(new Date(dr.to).toISOString())
    }
  }
  return {
    sql: conds.length ? `WHERE ${conds.join(' AND ')}` : '',
    params,
  }
}

/* ---------- queries ---------- */

/**
 * Headline KPIs for the analyst-view / team-view summary cards.
 * Matches the shape of the existing `computeKpis(rows)` output, but
 * `atRisk` / `breached` are scalar counts here — full case lists for
 * those are returned by `getAtRiskCases` (to be added in the next batch).
 */
export async function getKpis({ analyst, dateRange } = {}) {
  const { sql: where, params } = buildWhere({ analyst, dateRange })
  const rows = await dbClient.query(
    `
    SELECT
      COUNT(*)::BIGINT AS total,
      COUNT_IF(is_closed)::BIGINT AS closed,
      COUNT_IF(NOT is_closed)::BIGINT AS open,
      COUNT_IF(sla_eligible)::BIGINT AS sla_eligible,
      COUNT_IF(sla_eligible AND made_sla)::BIGINT AS sla_met,
      CASE WHEN COUNT_IF(sla_eligible) > 0
        THEN COUNT_IF(sla_eligible AND made_sla) * 100.0 / COUNT_IF(sla_eligible)
        ELSE NULL
      END AS sla_rate,
      AVG(CASE WHEN is_closed AND resolved_ms IS NOT NULL THEN resolved_ms::DOUBLE END) AS avg_res,
      AVG(frt_ms::DOUBLE) AS avg_frt,
      COUNT_IF(NOT is_closed AND sla_due IS NOT NULL AND sla_due > now() AND sla_due < now() + INTERVAL 24 HOUR)::BIGINT AS at_risk_count,
      COUNT_IF(NOT is_closed AND sla_due IS NOT NULL AND sla_due < now())::BIGINT AS breached_count
    FROM cases
    ${where}
    `,
    params
  )
  const r = rows[0] || {}
  return {
    total: Number(r.total ?? 0),
    closed: Number(r.closed ?? 0),
    open: Number(r.open ?? 0),
    slaEligible: Number(r.sla_eligible ?? 0),
    slaMet: Number(r.sla_met ?? 0),
    slaRate: r.sla_rate == null ? null : Number(r.sla_rate),
    avgRes: r.avg_res == null ? null : Number(r.avg_res),
    avgFrt: r.avg_frt == null ? null : Number(r.avg_frt),
    atRiskCount: Number(r.at_risk_count ?? 0),
    breachedCount: Number(r.breached_count ?? 0),
  }
}

/** getKpis over the comparison window. Returns null when there's no window. */
export async function getCompareKpis({ analyst, compareWindow, field } = {}) {
  if (!compareWindow || compareWindow.from == null || compareWindow.to == null) return null
  return getKpis({ analyst, dateRange: { from: compareWindow.from, to: compareWindow.to, field } })
}

/**
 * Per-priority breakdown — matches the in-memory `priorityData` memo shape:
 * `{ priority, total, closed, sla_met, sla_total, res_sum, res_n, sla_pct,
 * avg_res_h, color }`. SLA eligibility = `sla_eligible` (made_sla non-empty);
 * resolution average is over rows with a resolved_ms (created+closed), not
 * gated on is_closed, matching `_resolvedMs`. Ordered by priority rank.
 */
export async function getPriorityData({ analyst, dateRange } = {}) {
  const { sql: where, params } = buildWhere({ analyst, dateRange })
  const rows = await dbClient.query(
    `
    SELECT
      CASE WHEN priority IS NULL OR priority = '' THEN 'Unknown' ELSE priority END AS priority,
      COUNT(*)::BIGINT AS total,
      COUNT_IF(is_closed)::BIGINT AS closed,
      COUNT_IF(sla_eligible AND made_sla)::BIGINT AS sla_met,
      COUNT_IF(sla_eligible)::BIGINT AS sla_total,
      SUM(resolved_ms) FILTER (WHERE resolved_ms IS NOT NULL)::DOUBLE AS res_sum,
      COUNT(*) FILTER (WHERE resolved_ms IS NOT NULL)::BIGINT AS res_n,
      MIN(priority_rank) AS rank
    FROM cases
    ${where}
    GROUP BY 1
    ORDER BY rank
    `,
    params
  )
  return rows.map((r) => {
    const total = Number(r.total ?? 0)
    const closed = Number(r.closed ?? 0)
    const sla_met = Number(r.sla_met ?? 0)
    const sla_total = Number(r.sla_total ?? 0)
    const res_sum = r.res_sum == null ? 0 : Number(r.res_sum)
    const res_n = Number(r.res_n ?? 0)
    return {
      priority: r.priority,
      total,
      closed,
      sla_met,
      sla_total,
      res_sum,
      res_n,
      sla_pct: sla_total ? (sla_met / sla_total) * 100 : null,
      avg_res_h: res_n ? res_sum / res_n / 36e5 : null,
      color: priorityColor(r.priority),
    }
  })
}

/** GROUP BY category → `{ name, count }[]` desc. Mirrors `categoryData`. */
export async function getCategoryData({ analyst, dateRange } = {}) {
  const { sql: where, params } = buildWhere({ analyst, dateRange })
  const rows = await dbClient.query(
    `SELECT category AS name, COUNT(*)::BIGINT AS count
     FROM cases ${where}
     GROUP BY category
     ORDER BY count DESC, name ASC`,
    params
  )
  return rows.map((r) => ({ name: r.name, count: Number(r.count ?? 0) }))
}

/** GROUP BY account → top 30 `{ name, count }[]` desc. Mirrors `accountData`. */
export async function getAccountData({ analyst, dateRange } = {}) {
  const { sql: where, params } = buildWhere({ analyst, dateRange })
  const rows = await dbClient.query(
    `SELECT CASE WHEN account IS NULL OR account = '' THEN 'Unknown' ELSE account END AS name,
            COUNT(*)::BIGINT AS count
     FROM cases ${where}
     GROUP BY 1
     ORDER BY count DESC, name ASC
     LIMIT 30`,
    params
  )
  return rows.map((r) => ({ name: r.name, count: Number(r.count ?? 0) }))
}

/** GROUP BY product_line → `{ name, count }[]` desc. Mirrors `productData`. */
export async function getProductData({ analyst, dateRange } = {}) {
  const { sql: where, params } = buildWhere({ analyst, dateRange })
  const rows = await dbClient.query(
    `SELECT CASE WHEN product_line IS NULL OR product_line = '' THEN 'Unknown' ELSE product_line END AS name,
            COUNT(*)::BIGINT AS count
     FROM cases ${where}
     GROUP BY 1
     ORDER BY count DESC, name ASC`,
    params
  )
  return rows.map((r) => ({ name: r.name, count: Number(r.count ?? 0) }))
}

/**
 * The Update Queue: open cases overdue (or coming due) for an Infor-authored
 * customer-facing update per SOP, plus a parallel list of cases that missed
 * their initial-response target.
 *
 * "Now" is anchored to `snapshotMs` (passed in from `meta.loaded_at`) so
 * bucket assignments are deterministic for a given dataset. Nothing here
 * calls `Date.now()`.
 *
 * @param {object} args
 * @param {string|null} [args.analyst]   '__all__' or assignee
 * @param {number} args.snapshotMs       epoch ms anchor for "now"
 * @returns {Promise<{
 *   snapshotMs: number,
 *   overdue: object[],
 *   dueSoon: object[],
 *   initialResponseMisses: object[],
 *   summary: { overdue: number, dueSoon: number, initialMisses: number },
 * }>}
 */
export async function getUpdateQueue({ analyst, snapshotMs } = {}) {
  if (snapshotMs == null) {
    return {
      snapshotMs: null,
      overdue: [],
      dueSoon: [],
      initialResponseMisses: [],
      summary: { overdue: 0, dueSoon: 0, initialMisses: 0 },
    }
  }

  // Build the analyst filter (reuse the same helper). Date filter is NOT
  // applied — the queue is always "right now" against the snapshot.
  const { sql: where, params: analystParams } = buildWhere({ analyst })

  // Anchored snapshot as a real TIMESTAMP literal we can subtract from in SQL.
  const snapshotIso = new Date(snapshotMs).toISOString()

  // Bucket SQL — fed snapshotMs (as TIMESTAMP) plus WARN_FRACTION and
  // DEV_JIRA_CHECK_MS from sop-thresholds.js. The CASE expression keys off
  // `update_threshold_ms` which is baked at ingest by `classifyCase`.
  const bucketSql = `
    WITH base AS (
      SELECT
        number,
        short_description,
        state,
        status,
        priority,
        priority_rank,
        account,
        assigned_to,
        case_type,
        update_threshold_ms,
        last_infor_update,
        created_at,
        epoch_ms(?::TIMESTAMP) -
          coalesce(epoch_ms(last_infor_update), epoch_ms(created_at)) AS elapsed_ms,
        last_infor_update IS NULL AS no_infor_update_yet
      FROM cases
      ${where ? where + ' AND' : 'WHERE'} NOT is_closed
    )
    SELECT
      *,
      CASE
        WHEN update_threshold_ms IS NULL THEN 'ok'
        WHEN elapsed_ms > update_threshold_ms THEN 'overdue'
        WHEN elapsed_ms > update_threshold_ms * ${WARN_FRACTION} THEN 'due_soon'
        ELSE 'ok'
      END AS bucket,
      (case_type = 'development' AND elapsed_ms > ${DEV_JIRA_CHECK_MS})
        AS jira_check_recommended
    FROM base
    WHERE update_threshold_ms IS NOT NULL
    ORDER BY (elapsed_ms::DOUBLE / NULLIF(update_threshold_ms, 0)) DESC NULLS LAST
  `
  const bucketRows = await dbClient.query(bucketSql, [snapshotIso, ...analystParams])

  // Initial-response misses. priority_rank ∉ INITIAL_RESPONSE_MS → no target,
  // skip. Build a CASE expression instead of one query per priority.
  const irBranches = Object.entries(INITIAL_RESPONSE_MS)
    .map(([rank, ms]) => `WHEN priority_rank = ${rank} THEN ${ms}`)
    .join('\n        ')
  const irSql = `
    SELECT * FROM (
      SELECT
        number,
        short_description,
        state,
        status,
        priority,
        priority_rank,
        account,
        assigned_to,
        created_at,
        epoch_ms(?::TIMESTAMP) - epoch_ms(created_at) AS age_ms,
        CASE
          ${irBranches}
          ELSE NULL
        END AS target_ms
      FROM cases
      ${where ? where + ' AND' : 'WHERE'} NOT is_closed
        AND frt_ms IS NULL
        AND created_at IS NOT NULL
    )
    WHERE target_ms IS NOT NULL AND age_ms > target_ms
    ORDER BY age_ms DESC
  `
  const irRows = await dbClient.query(irSql, [snapshotIso, ...analystParams])

  // Bucket the bucketRows into overdue / dueSoon. Cases with bucket='ok' are
  // excluded from the UI (no signal to surface).
  const overdue = []
  const dueSoon = []
  for (const r of bucketRows) {
    const row = normalizeQueueRow(r)
    if (row.bucket === 'overdue') overdue.push(row)
    else if (row.bucket === 'due_soon') dueSoon.push(row)
  }
  const initialResponseMisses = irRows.map(normalizeIrRow)

  return {
    snapshotMs,
    overdue,
    dueSoon,
    initialResponseMisses,
    summary: {
      overdue: overdue.length,
      dueSoon: dueSoon.length,
      initialMisses: initialResponseMisses.length,
    },
  }
}

function normalizeQueueRow(r) {
  return {
    number: r.number,
    shortDescription: r.short_description,
    state: r.state,
    status: r.status,
    priority: r.priority,
    priorityRank: r.priority_rank == null ? null : Number(r.priority_rank),
    account: r.account,
    assignedTo: r.assigned_to,
    caseType: r.case_type,
    thresholdMs: r.update_threshold_ms == null ? null : Number(r.update_threshold_ms),
    lastInforUpdate: r.last_infor_update ? new Date(r.last_infor_update) : null,
    createdAt: r.created_at ? new Date(r.created_at) : null,
    elapsedMs: r.elapsed_ms == null ? null : Number(r.elapsed_ms),
    noInforUpdateYet: !!r.no_infor_update_yet,
    bucket: r.bucket,
    jiraCheckRecommended: !!r.jira_check_recommended,
  }
}

function normalizeIrRow(r) {
  return {
    number: r.number,
    shortDescription: r.short_description,
    state: r.state,
    status: r.status,
    priority: r.priority,
    priorityRank: r.priority_rank == null ? null : Number(r.priority_rank),
    account: r.account,
    assignedTo: r.assigned_to,
    createdAt: r.created_at ? new Date(r.created_at) : null,
    ageMs: r.age_ms == null ? null : Number(r.age_ms),
    targetMs: r.target_ms == null ? null : Number(r.target_ms),
  }
}
