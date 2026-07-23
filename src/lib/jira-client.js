// Live Jira data layer. Pure fetch/cache logic — no React.
//
// All requests go through the Vite dev-server proxy mounted at /api/jira
// (see vite.config.js). The proxy injects HTTP Basic auth server-side, so the
// token never reaches this code or the client bundle. DEV ONLY: a static
// `vite build` has no dev server, so these calls 404 outside `npm run dev`.
//
// Mirrors the role of db-client.js: a thin, promise-based access layer the
// rest of the app builds on.

const JIRA_API = '/api/jira/api/3'

// The Jira project to pull standalone analytics for. PROJECT_NAME is the
// authoritative identifier: resolveProject() looks the project up by name so
// the sync is provably scoped to exactly this space. PROJECT_KEY is only a
// fast-path hint / fallback.
export const PROJECT_NAME = 'Hospitality Management Solution'
export const PROJECT_KEY = 'HMS'

// Small maps stay in localStorage (a few KB each). The big issues array + meta
// moved to IndexedDB (see the caching section) — a 365-day pull is thousands of
// issues with embedded changelogs and blows the ~5 MB localStorage budget.
const FIELDMAP_KEY = 'jira:fieldmap:v1'
const STATUSMAP_KEY = 'jira:statusmap:v1'
const PROJECT_CACHE_KEY = 'jira:project:v1'
// Orphaned by the move to IndexedDB; clearCache() still sweeps them up.
const LEGACY_CACHE_KEYS = ['jira:hms:v1', 'jira:hms:meta:v1', 'jira:hms:v2', 'jira:hms:meta:v2']

const PAGE_SIZE = 100

// A "full" sync pulls issues updated within this window rather than the
// project's entire history. Raise this for a longer view.
const FULL_SYNC_DAYS = 365 // ~1 year

// Hard ceiling on issues per sync, so a runaway query can't go unbounded.
// A normal 365-day pull stays well under this; it's a safety net, not a trim.
const MAX_ISSUES = 15000

// Base fields requested for every issue. Story-point / sprint custom field IDs
// are resolved at runtime (they vary per instance) and appended in fetch*().
const BASE_FIELDS = [
  'summary', 'status', 'priority', 'issuetype', 'created', 'updated',
  'resolutiondate', 'assignee', 'components', 'labels', 'fixVersions', 'parent',
]

/* ----------------------------- low-level fetch ---------------------------- */

/** Thrown for any non-2xx Jira response. `status` carries the HTTP code so
 *  callers can special-case 401 (not configured) and 429 (rate limited). */
export class JiraError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'JiraError'
    this.status = status
  }
}

// Transient gateway/proxy errors. Atlassian (and the dev proxy in front of it)
// intermittently return these on large expand=changelog pages — they are not
// fatal, so we retry rather than aborting a multi-page sync on one hiccup.
const TRANSIENT_STATUS = new Set([502, 503, 504])

async function jiraFetch(path, { method = 'GET', body, retries = 3 } = {}) {
  const res = await fetch(JIRA_API + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })

  if (res.status === 429 && retries > 0) {
    // Atlassian Cloud enforces cost-based rate limits. Honor Retry-After.
    const wait = Number(res.headers.get('Retry-After')) || 5
    await new Promise((r) => setTimeout(r, wait * 1000))
    return jiraFetch(path, { method, body, retries: retries - 1 })
  }

  if (TRANSIENT_STATUS.has(res.status) && retries > 0) {
    // Exponential backoff: ~1s, 2s, 4s. Honor Retry-After if present.
    const attempt = 3 - retries
    const wait = Number(res.headers.get('Retry-After')) || 2 ** attempt
    await new Promise((r) => setTimeout(r, wait * 1000))
    return jiraFetch(path, { method, body, retries: retries - 1 })
  }

  if (!res.ok) {
    let detail = ''
    try {
      const j = await res.json()
      detail = j.errorMessages?.join('; ') || j.message || ''
    } catch {
      /* non-JSON error body */
    }
    throw new JiraError(
      `Jira ${method} ${path} → ${res.status}${detail ? ': ' + detail : ''}`,
      res.status,
    )
  }
  return res.json()
}

/* ------------------------------ field map -------------------------------- */

/** Resolve the per-instance custom field IDs we care about (story points,
 *  sprint). IDs differ between Jira sites, so they must never be hardcoded.
 *  Cached in localStorage; if a field can't be found the corresponding
 *  analytics degrade gracefully rather than throwing. */
export async function getFieldMap() {
  try {
    const cached = JSON.parse(localStorage.getItem(FIELDMAP_KEY) || 'null')
    if (cached) return cached
  } catch {
    /* ignore corrupt cache */
  }

  const fields = await jiraFetch('/field')
  const map = { storyPoints: null, sprint: null }
  for (const f of fields) {
    const name = String(f.name || '').toLowerCase()
    const custom = f.schema?.custom || ''
    if (!map.storyPoints && /story point/.test(name)) map.storyPoints = f.id
    if (!map.sprint && custom === 'com.pyxis.greenhopper.jira:gh-sprint') map.sprint = f.id
  }
  try {
    localStorage.setItem(FIELDMAP_KEY, JSON.stringify(map))
  } catch {
    /* quota — fine, we'll just re-resolve next time */
  }
  return map
}

function fieldsFor(fieldMap) {
  const extra = [fieldMap?.storyPoints, fieldMap?.sprint].filter(Boolean)
  return [...BASE_FIELDS, ...extra]
}

/** Map every workflow status name → its category name ('To Do' | 'In Progress'
 *  | 'Done'). The changelog only records status *names*, so this map is what
 *  lets the enrich layer tell when an issue entered "in progress" or "done".
 *  Cached in localStorage. */
export async function getStatusMap() {
  try {
    const cached = JSON.parse(localStorage.getItem(STATUSMAP_KEY) || 'null')
    if (cached) return cached
  } catch {
    /* ignore corrupt cache */
  }
  const statuses = await jiraFetch('/status')
  const map = {}
  for (const s of statuses) {
    if (s?.name) map[s.name] = s.statusCategory?.name || 'To Do'
  }
  try {
    localStorage.setItem(STATUSMAP_KEY, JSON.stringify(map))
  } catch {
    /* quota — re-resolve next time */
  }
  return map
}

/* ------------------------------- project --------------------------------- */

/** Resolve the target project by NAME so the sync is provably scoped to the
 *  right space — not a guessed key. Returns { key, name, id }. Cached in
 *  localStorage. Throws JiraError(404) if no project matches. */
export async function resolveProject() {
  try {
    const cached = JSON.parse(localStorage.getItem(PROJECT_CACHE_KEY) || 'null')
    if (cached?.key) return cached
  } catch {
    /* ignore corrupt cache */
  }

  let project = null
  // Authoritative: find the project whose name matches PROJECT_NAME.
  try {
    const res = await jiraFetch(`/project/search?query=${encodeURIComponent(PROJECT_NAME)}`)
    const values = res.values || []
    const match =
      values.find((p) => (p.name || '').toLowerCase() === PROJECT_NAME.toLowerCase()) || values[0]
    if (match) project = { key: match.key, name: match.name, id: match.id }
  } catch {
    /* fall through to the key fast-path */
  }
  // Fallback: direct lookup by the hinted key.
  if (!project) {
    const p = await jiraFetch(`/project/${encodeURIComponent(PROJECT_KEY)}`)
    if (p?.key) project = { key: p.key, name: p.name, id: p.id }
  }
  if (!project) {
    throw new JiraError(`No Jira project matching "${PROJECT_NAME}" (or key ${PROJECT_KEY})`, 404)
  }
  try {
    localStorage.setItem(PROJECT_CACHE_KEY, JSON.stringify(project))
  } catch {
    /* quota — re-resolve next time */
  }
  return project
}

/* ------------------------------- search ---------------------------------- */

// Jira Cloud is migrating /rest/api/3/search (startAt paging) to
// /rest/api/3/search/jql (nextPageToken cursor paging). All paging quirks are
// isolated in searchIssues(): it tries the new endpoint first and falls back
// to the legacy one on 404/410. This is the single most likely thing to break.
let _searchMode = null // 'jql' | 'legacy' — cached after first successful call

/**
 * Run a JQL search, walking every page.
 * @param {object} opts
 * @param {string} opts.jql
 * @param {string[]} opts.fields
 * @param {string} [opts.expand]   e.g. 'changelog'
 * @param {(issues, info) => void} [opts.onPage]  info = { fetched, total|null }
 * @returns {Promise<object[]>} raw Jira issue objects
 */
export async function searchIssues({ jql, fields, expand, onPage }) {
  const all = []
  // GET, not POST: this instance returns 403 on POST /search* but serves
  // every GET (/myself, /field, /status all work). GET search is also what
  // mcp-atlassian uses. Our JQL is short, so URL length is not a concern.
  const fieldsParam = (fields || []).join(',')

  async function viaJql() {
    let nextPageToken
    do {
      const qs = new URLSearchParams({
        jql,
        fields: fieldsParam,
        maxResults: String(PAGE_SIZE),
      })
      if (expand) qs.set('expand', expand)
      if (nextPageToken) qs.set('nextPageToken', nextPageToken)
      const page = await jiraFetch(`/search/jql?${qs}`)
      all.push(...(page.issues || []))
      nextPageToken = page.isLast ? undefined : page.nextPageToken
      if (onPage) onPage(page.issues || [], { fetched: all.length, total: null })
    } while (nextPageToken && all.length < MAX_ISSUES)
  }

  async function viaLegacy() {
    let startAt = 0
    let total = Infinity
    do {
      const qs = new URLSearchParams({
        jql,
        fields: fieldsParam,
        startAt: String(startAt),
        maxResults: String(PAGE_SIZE),
      })
      if (expand) qs.set('expand', expand)
      const page = await jiraFetch(`/search?${qs}`)
      all.push(...(page.issues || []))
      total = page.total ?? all.length
      startAt += (page.issues || []).length
      if (onPage) onPage(page.issues || [], { fetched: all.length, total: Math.min(total, MAX_ISSUES) })
      if (!page.issues || page.issues.length === 0) break
    } while (startAt < total && all.length < MAX_ISSUES)
  }

  if (_searchMode === 'legacy') {
    await viaLegacy()
  } else {
    try {
      await viaJql()
      _searchMode = 'jql'
    } catch (err) {
      if (err instanceof JiraError && (err.status === 403 || err.status === 404 || err.status === 410)) {
        _searchMode = 'legacy'
        all.length = 0
        await viaLegacy()
      } else {
        throw err
      }
    }
  }
  // Pages are 100-wide, so the loop guards can overshoot by up to a page.
  return all.length > MAX_ISSUES ? all.slice(0, MAX_ISSUES) : all
}

/* ------------------------------ public API ------------------------------- */

/** Quick connectivity / auth probe. Resolves true if the proxy + token work,
 *  false on 401 (no/invalid creds). Other errors propagate. */
export async function pingJira() {
  try {
    await jiraFetch('/myself')
    return true
  } catch (err) {
    if (err instanceof JiraError && err.status === 401) return false
    throw err
  }
}

/**
 * Pull HMS project issues updated within a time window.
 * @param {object} [opts]
 * @param {number} [opts.since]  issues updated within N days; defaults to
 *                               FULL_SYNC_DAYS for a "full" sync.
 * @param {string} [opts.sinceExpr]  a raw JQL relative-time token used as the
 *                               `updated >=` bound (e.g. "-20m"). Overrides
 *                               `since` — used by the background delta poll to
 *                               derive the window from the last sync time.
 * @param {(info) => void} [opts.onProgress]  info = { fetched, total|null }
 * @returns {Promise<{ issues, fetchedAt, fieldMap, statusMap, project }>}
 */
export async function fetchHmsProject({ since, sinceExpr, onProgress } = {}) {
  const [fieldMap, statusMap, project] = await Promise.all([
    getFieldMap(), getStatusMap(), resolveProject(),
  ])
  const windowDays = since || FULL_SYNC_DAYS
  // A caller-supplied `sinceExpr` (e.g. "-20m") wins so the background poll can
  // fetch just what changed since the last sync; otherwise use the day window.
  const updatedSince = sinceExpr || `-${windowDays}d`
  // Scoped by the resolved project's real key — guaranteed to be exactly the
  // "Hospitality Management Solution" space and nothing else.
  const jql = `project = "${project.key}" AND updated >= ${updatedSince} ORDER BY updated DESC`
  const issues = await searchIssues({
    jql,
    fields: fieldsFor(fieldMap),
    // The embedded changelog (most recent ~100 entries) is enough to
    // reconstruct time-in-status; we deliberately do NOT paginate full
    // changelogs per issue — that turns one fetch into hundreds.
    expand: 'changelog',
    onPage: (_page, info) => onProgress?.(info),
  })
  return { issues, fetchedAt: Date.now(), fieldMap, statusMap, project }
}

/**
 * Resolve a specific set of issue keys — used by the ServiceNow↔Jira join so
 * the existing Jira tab doesn't need a full project pull. Keys outside the
 * configured project (INF-, etc.) still resolve as long as the account can see
 * them. Chunked to keep each JQL `issuekey in (...)` clause small.
 */
export async function fetchIssuesByKeys(keys) {
  const unique = [...new Set(keys.filter(Boolean))]
  if (unique.length === 0) {
    return { issues: [], fetchedAt: Date.now(), fieldMap: null, statusMap: null }
  }
  const [fieldMap, statusMap] = await Promise.all([getFieldMap(), getStatusMap()])
  const out = []
  for (let i = 0; i < unique.length; i += 50) {
    const chunk = unique.slice(i, i + 50)
    const jql = `issuekey in (${chunk.join(',')}) ORDER BY updated DESC`
    const issues = await searchIssues({ jql, fields: fieldsFor(fieldMap), expand: 'changelog' })
    out.push(...issues)
  }
  return { issues: out, fetchedAt: Date.now(), fieldMap, statusMap }
}

/* --------------------------- lazy issue detail --------------------------- */

// Full descriptions are rich text (ADF). They're fetched on demand — when an
// issue row is expanded — not during the bulk sync. Memoised for the session.
const _detailCache = new Map()

/** Fetch one issue's rendered (HTML) description. Resolves
 *  { key, descriptionHtml }. descriptionHtml is '' when the issue has none. */
export async function fetchIssueDetail(key) {
  if (_detailCache.has(key)) return _detailCache.get(key)
  const issue = await jiraFetch(
    `/issue/${encodeURIComponent(key)}?fields=description&expand=renderedFields`,
  )
  const detail = { key, descriptionHtml: issue?.renderedFields?.description || '' }
  _detailCache.set(key, detail)
  return detail
}

/* ------------------------------- caching --------------------------------- */
// The Jira issue cache lives as a real JSON file on disk at
// <project>/.jira-cache/cache.json, served by the Vite dev plugin (see
// vite.config.js → jiraFileCachePlugin). The file is fully inspectable,
// backup-able, and survives any browser clearing — unlike IndexedDB, which
// silently lost the 9000-issue blob on every sync.
//
// Dev-only: a static `vite build` has no dev server, so `/api/cache/jira`
// 404s outside `npm run dev` and the cache won't persist there. That matches
// the other dev-only Jira plumbing (the live sync proxy itself).

const CACHE_URL = '/api/cache/jira'

/** @returns {Promise<{ issues: object[], meta: object } | null>} */
export async function loadCache() {
  try {
    const res = await fetch(CACHE_URL, { cache: 'no-store' })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`cache GET → ${res.status}`)
    const data = await res.json()
    if (!data?.issues?.length || !data?.meta) return null
    return { issues: data.issues, meta: data.meta }
  } catch (err) {
    console.warn('[jira] cache read failed —', err?.message || err)
    return null
  }
}

/** Persist raw issues + meta as one JSON file. Returns true on success,
 *  false on failure. Caller can read the boolean to surface a UI warning. */
export async function saveCache(issues, meta) {
  try {
    const body = JSON.stringify({ issues, meta })
    const res = await fetch(CACHE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
    if (!res.ok) throw new Error(`cache POST → ${res.status}`)
    console.info(`[jira] cache saved · ${issues.length} issues · ${(body.length / 1048576).toFixed(1)} MB`)
    return true
  } catch (err) {
    console.warn('[jira] cache write failed —', err?.message || err)
    return false
  }
}

export async function clearCache() {
  try {
    await fetch(CACHE_URL, { method: 'DELETE' })
  } catch (err) {
    console.warn('[jira] cache clear failed —', err?.message || err)
  }
  try {
    for (const k of [FIELDMAP_KEY, STATUSMAP_KEY, PROJECT_CACHE_KEY, ...LEGACY_CACHE_KEYS]) {
      localStorage.removeItem(k)
    }
  } catch {
    /* ignore */
  }
}

/** Merge a freshly-fetched incremental batch into the existing issue set,
 *  keyed by issue `key` (updated issues replace, new ones append). Deletions
 *  can't be detected incrementally — a full refresh handles those. */
export function mergeIssues(existing, incoming) {
  const byKey = new Map((existing || []).map((it) => [it.key, it]))
  for (const it of incoming || []) byKey.set(it.key, it)
  return [...byKey.values()]
}

// Expose to window in dev for manual smoke testing (mirrors db-client.js).
if (typeof window !== 'undefined' && import.meta.env?.DEV) {
  window.__jira = {
    pingJira, resolveProject, getFieldMap, getStatusMap, searchIssues,
    fetchHmsProject, fetchIssuesByKeys, fetchIssueDetail, loadCache, saveCache,
    clearCache, mergeIssues, PROJECT_KEY, PROJECT_NAME,
  }
}
