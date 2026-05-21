/**
 * Proxy routes that call the ServiceNow Table API and return normalized rows
 * in the same shape the KPI analyzer's enrichRow() expects.
 *
 * All routes require a valid OAuth session (requireAuth middleware).
 *
 * ServiceNow Table API reference:
 *   GET /api/now/table/{tableName}?sysparm_query=...&sysparm_fields=...&sysparm_limit=...
 */
import express from 'express'
import axios from 'axios'
import { requireAuth, snClient } from './auth.js'

export const apiRouter = express.Router()
apiRouter.use(requireAuth)

const SN = process.env.SN_INSTANCE

// The fields we request from ServiceNow — maps to the internal field names
// the enrichment pipeline expects.
const CASE_FIELDS = [
  'number',
  'short_description',
  'state',
  'priority',
  'account',           // u_account or account depending on your instance
  'u_product_line',    // adjust to your field name
  'assigned_to',
  'close_notes',
  'work_notes',
  'u_case_action_summary',
  'made_sla',
  'u_first_response_time',
  'sys_created_on',
  'closed_at',
  'sla_due',
  'cause',
].join(',')

/**
 * Normalize a raw ServiceNow Table API record into the shape enrichRow() expects.
 * ServiceNow returns reference fields as { value, display_value } objects —
 * we flatten them to their display_value strings.
 */
function normalizeRecord(r) {
  const str = (v) => {
    if (v == null) return null
    if (typeof v === 'object') return v.display_value ?? v.value ?? null
    return String(v)
  }
  return {
    number:              str(r.number),
    short_description:   str(r.short_description),
    state:               str(r.state),
    priority:            str(r.priority),
    account:             str(r.account),
    product_line:        str(r.u_product_line),
    assigned_to:         str(r.assigned_to),
    close_notes:         str(r.close_notes),
    work_notes:          str(r.work_notes),
    case_action_summary: str(r.u_case_action_summary),
    made_sla:            str(r.made_sla),
    first_response_time: str(r.u_first_response_time),
    sys_created_on:      str(r.sys_created_on),
    closed_at:           str(r.closed_at),
    sla_due:             str(r.sla_due),
    cause:               str(r.cause),
  }
}

/**
 * Paginate through all records matching a query.
 * ServiceNow caps each response at sysparm_limit rows; we walk pages until done.
 */
async function fetchAllRecords(client, table, query, limit = 1000) {
  const records = []
  let offset = 0

  while (true) {
    const { data } = await client.get(`/api/now/table/${table}`, {
      params: {
        sysparm_query: query,
        sysparm_fields: CASE_FIELDS,
        sysparm_limit: limit,
        sysparm_offset: offset,
        sysparm_display_value: 'all', // return both value and display_value
        sysparm_exclude_reference_link: true,
      },
    })

    const batch = data.result || []
    records.push(...batch)

    if (batch.length < limit) break
    offset += limit
  }

  return records
}

// ─── Routes ──────────────────────────────────────────────────────────────────

/**
 * GET /api/cases
 * Query params:
 *   from      ISO date string (created_on >= from)
 *   to        ISO date string (created_on <= to)
 *   field     "created" | "closed"  (which date field to filter on)
 *   analyst   assigned_to display name (optional)
 *   table     ServiceNow table name (default: sn_customerservice_case)
 *
 * Returns: { rows: NormalizedRecord[], total: number }
 */
apiRouter.get('/cases', async (req, res) => {
  try {
    const client = snClient(req)
    const table = req.query.table || 'sn_customerservice_case'
    const dateField = req.query.field === 'closed' ? 'closed_at' : 'sys_created_on'

    const conditions = []

    if (req.query.from) {
      const d = new Date(req.query.from)
      if (!isNaN(d)) conditions.push(`${dateField}>=${d.toISOString().replace('T', ' ').slice(0, 19)}`)
    }
    if (req.query.to) {
      const d = new Date(req.query.to)
      if (!isNaN(d)) conditions.push(`${dateField}<=${d.toISOString().replace('T', ' ').slice(0, 19)}`)
    }
    if (req.query.analyst) {
      conditions.push(`assigned_to.display_name=${req.query.analyst}`)
    }

    const query = conditions.join('^') || 'active=true^ORactive=false'

    const raw = await fetchAllRecords(client, table, query)
    const rows = raw.map(normalizeRecord)

    res.json({ rows, total: rows.length })
  } catch (err) {
    console.error('[api] /cases error', err?.response?.data || err.message)
    res.status(500).json({ error: err?.response?.data?.error?.message || err.message })
  }
})

/**
 * GET /api/analysts
 * Returns the list of distinct assigned_to values from recent cases.
 * Used to populate the analyst filter dropdown.
 */
apiRouter.get('/analysts', async (req, res) => {
  try {
    const client = snClient(req)
    const table = req.query.table || 'sn_customerservice_case'

    // Pull last 90 days to get a relevant analyst list
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
      .toISOString().replace('T', ' ').slice(0, 19)

    const { data } = await client.get(`/api/now/table/${table}`, {
      params: {
        sysparm_query: `sys_created_on>=${since}`,
        sysparm_fields: 'assigned_to',
        sysparm_limit: 5000,
        sysparm_display_value: 'true',
        sysparm_exclude_reference_link: true,
      },
    })

    const seen = new Set()
    const analysts = []
    for (const r of data.result || []) {
      const name = typeof r.assigned_to === 'object'
        ? r.assigned_to.display_value
        : r.assigned_to
      if (name && !seen.has(name)) {
        seen.add(name)
        analysts.push(name)
      }
    }

    res.json({ analysts: analysts.sort() })
  } catch (err) {
    console.error('[api] /analysts error', err?.response?.data || err.message)
    res.status(500).json({ error: err?.response?.data?.error?.message || err.message })
  }
})

/**
 * POST /api/ai-insights
 * Accepts a sample of anonymized case objects and returns a qualitative
 * analysis string. Requires ANTHROPIC_API_KEY in the environment.
 */
apiRouter.post('/ai-insights', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return res.status(501).json({ error: 'ANTHROPIC_API_KEY not configured on the server.' })
  }
  const { cases = [], scope = 'team' } = req.body || {}
  if (!cases.length) return res.status(400).json({ error: 'No cases provided.' })

  const caseText = cases.map((c, i) =>
    `${i+1}. [${c.priority||'?'}] ${c.category||'?'} — "${c.description}" ` +
    `(resolved: ${c.resolvedH ? c.resolvedH+'h' : 'open'}, SLA: ${c.madeSla ? 'met' : 'missed/unknown'})`
  ).join('\n')

  const prompt = `You are a support operations analyst. Below are up to 50 anonymized ServiceNow cases ` +
    `for ${scope === 'team' ? 'the whole team' : `analyst: ${scope}`}.\n\n${caseText}\n\n` +
    `Provide a concise analysis (4–6 paragraphs) covering:\n` +
    `1. Top recurring themes or issue types\n` +
    `2. SLA and resolution time observations\n` +
    `3. Knowledge-base or process gaps\n` +
    `4. Specific things to watch or act on\n` +
    `Be direct and specific. Do not use bullet points — write in prose.`

  try {
    const { data } = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-opus-4-5',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      },
      {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
      }
    )
    const insight = data.content?.[0]?.text || 'No response from Claude.'
    res.json({ insight })
  } catch (err) {
    console.error('[api] /ai-insights error', err?.response?.data || err.message)
    res.status(500).json({ error: err?.response?.data?.error?.message || err.message })
  }
})

/**
 * GET /api/case/:number
 * Returns a single case record by case number (e.g. CS0012345).
 */
apiRouter.get('/case/:number', async (req, res) => {
  try {
    const client = snClient(req)
    const table = req.query.table || 'sn_customerservice_case'

    const { data } = await client.get(`/api/now/table/${table}`, {
      params: {
        sysparm_query: `number=${req.params.number}`,
        sysparm_fields: CASE_FIELDS,
        sysparm_limit: 1,
        sysparm_display_value: 'all',
        sysparm_exclude_reference_link: true,
      },
    })

    const record = (data.result || [])[0]
    if (!record) return res.status(404).json({ error: 'not found' })

    res.json({ row: normalizeRecord(record) })
  } catch (err) {
    console.error('[api] /case error', err?.response?.data || err.message)
    res.status(500).json({ error: err?.response?.data?.error?.message || err.message })
  }
})
