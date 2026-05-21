/**
 * Client-side API helpers. All calls go to the Express proxy which holds
 * the OAuth token — the browser never sees credentials.
 */

const BASE = '/api'

async function get(path, params = {}) {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v != null))
  ).toString()
  const url = qs ? `${BASE}${path}?${qs}` : `${BASE}${path}`
  const res = await fetch(url, { credentials: 'include' })
  if (res.status === 401) {
    // Session expired — redirect to login
    window.location.href = '/auth/login'
    throw new Error('not_authenticated')
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `HTTP ${res.status}`)
  }
  return res.json()
}

/**
 * Fetch all cases matching the given filters.
 * @param {{ from?: number|null, to?: number|null, field?: string, analyst?: string }} opts
 * @returns {Promise<{ rows: object[], total: number }>}
 */
export async function fetchCases({ from, to, field, analyst } = {}) {
  const isoFromMs = (ms) => ms != null ? new Date(ms).toISOString() : undefined
  return get('/cases', {
    from:    isoFromMs(from),
    to:      isoFromMs(to),
    field:   field === '_closed' ? 'closed' : 'created',
    analyst: analyst !== '__all__' ? analyst : undefined,
  })
}

/**
 * Fetch the list of analysts active in the last 90 days.
 * @returns {Promise<{ analysts: string[] }>}
 */
export async function fetchAnalysts() {
  return get('/analysts')
}

/**
 * Fetch a single case by number.
 * @param {string} number
 * @returns {Promise<{ row: object }>}
 */
export async function fetchCase(number) {
  return get(`/case/${encodeURIComponent(number)}`)
}

/**
 * Sign out — destroys the server-side session.
 */
export async function logout() {
  await fetch('/auth/logout', { method: 'POST', credentials: 'include' })
  window.location.href = '/auth/login'
}
