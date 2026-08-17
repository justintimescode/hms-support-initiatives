import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

const DEFAULT_JIRA_BASE_URL = 'https://infor.atlassian.net'

// Read .env directly so its values always win over a stale process.env
// (Vite's built-in loadEnv lets system env vars shadow .env, which silently
// breaks Jira sync when a user has an old JIRA_API_TOKEN exported in their
// shell profile). Returns an empty object if .env is missing.
function readDotEnv() {
  const file = path.join(here, '.env')
  if (!fs.existsSync(file)) return {}
  const out = {}
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue
    const i = line.indexOf('=')
    if (i < 0) continue
    out[line.slice(0, i).trim()] = line.slice(i + 1)
  }
  return out
}

/* --------------------------- Jira credentials ----------------------------- */
// Jira is an OPTIONAL data source: the app boots, imports ServiceNow exports and
// runs every non-Jira page with no credentials at all. When someone does want
// the Jira pages they enter their Atlassian email + API token in Settings, and
// this is where the dev server keeps them.
//
// Precedence: the in-app credentials (written here by /api/creds/jira) beat
// .env, so saving in Settings always wins over a stale .env. Both are resolved
// per REQUEST, not at config time, so adding or changing credentials takes
// effect immediately — no `npm run dev` restart.
//
// SECURITY: .jira-creds.json holds a PLAINTEXT token in the project folder,
// exactly like the .env it replaces, and is gitignored. This is the dev-server
// path only. The packaged desktop app stores the token encrypted with the OS
// keystore instead (electron/creds.cjs).
const CREDS_FILE = path.join(here, '.jira-creds.json')

function readSavedCreds() {
  try {
    const c = JSON.parse(fs.readFileSync(CREDS_FILE, 'utf8'))
    if (c?.email && c?.token) {
      return { baseUrl: c.baseUrl || DEFAULT_JIRA_BASE_URL, email: c.email, token: c.token }
    }
  } catch { /* missing / corrupt — treat as unconfigured */ }
  return null
}

/** In-app credentials, else .env, else null. `source` tells the UI which. */
function resolveJiraCreds() {
  const saved = readSavedCreds()
  if (saved) return { ...saved, source: 'file' }
  const env = readDotEnv()
  if (env.JIRA_EMAIL && env.JIRA_API_TOKEN) {
    return {
      baseUrl: env.JIRA_BASE_URL || DEFAULT_JIRA_BASE_URL,
      email: env.JIRA_EMAIL,
      token: env.JIRA_API_TOKEN,
      source: 'env',
    }
  }
  return null
}

const toAuthHeader = (c) =>
  c?.email && c?.token ? 'Basic ' + Buffer.from(`${c.email}:${c.token}`).toString('base64') : null

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) }
      catch (e) { reject(e) }
    })
    req.on('error', reject)
  })
}

const sendJson = (res, status, body) => {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

/** Validate a candidate credential set against /myself without saving it.
 *  Shared by the dev server and (in spirit) electron/main.cjs's creds:test. */
async function probeJira({ baseUrl, email, token }) {
  if (!email || !token) return { ok: false, message: 'Email and API token are required.' }
  const base = (baseUrl || DEFAULT_JIRA_BASE_URL).replace(/\/$/, '')
  try {
    const res = await fetch(`${base}/rest/api/3/myself`, {
      headers: {
        Authorization: toAuthHeader({ email, token }),
        Accept: 'application/json',
        'X-Atlassian-Token': 'no-check',
      },
    })
    if (res.status === 401 || res.status === 403) {
      return { ok: false, status: res.status, message: 'Authentication failed — check your email and API token.' }
    }
    if (!res.ok) return { ok: false, status: res.status, message: `Jira returned HTTP ${res.status}.` }
    const me = await res.json()
    return { ok: true, displayName: me.displayName || me.emailAddress || 'your account' }
  } catch (err) {
    return { ok: false, message: `Could not reach ${base} — ${err.message}` }
  }
}

// Dev-only credential management endpoint, mirrored by the Electron IPC bridge
// (electron/preload.cjs) so src/lib/jira-creds.js can talk to either one:
//   GET    /api/creds/jira        → { configured, baseUrl, email, source }
//   POST   /api/creds/jira        → save { baseUrl, email, token }
//   POST   /api/creds/jira/test   → probe without saving
//   DELETE /api/creds/jira        → forget the saved credentials
function jiraCredsPlugin() {
  return {
    name: 'jira-creds',
    configureServer(server) {
      server.middlewares.use('/api/creds/jira', (req, res, next) => {
        const sub = new URL(req.url, 'http://x').pathname.replace(/\/$/, '')

        if (req.method === 'GET' && !sub) {
          const c = resolveJiraCreds()
          // The token is deliberately never returned — only whether one exists.
          return sendJson(res, 200, {
            configured: !!c,
            baseUrl: c?.baseUrl || DEFAULT_JIRA_BASE_URL,
            email: c?.email || '',
            source: c?.source || null,
            storage: 'file',
          })
        }

        if (req.method === 'POST' && sub === '/test') {
          readJson(req)
            .then(probeJira)
            .then((r) => sendJson(res, 200, r))
            .catch((e) => sendJson(res, 400, { ok: false, message: e.message }))
          return
        }

        if (req.method === 'POST' && !sub) {
          readJson(req)
            .then(({ baseUrl, email, token }) => {
              if (!email || !token) return sendJson(res, 200, { ok: false, message: 'Email and API token are required.' })
              const body = JSON.stringify({ baseUrl: baseUrl || DEFAULT_JIRA_BASE_URL, email, token }, null, 2)
              fs.writeFileSync(CREDS_FILE, body, { mode: 0o600 })
              console.info('[jira-creds] saved credentials for', email)
              sendJson(res, 200, { ok: true })
            })
            .catch((e) => sendJson(res, 200, { ok: false, message: `Could not save credentials: ${e.message}` }))
          return
        }

        if (req.method === 'DELETE' && !sub) {
          try { fs.unlinkSync(CREDS_FILE) } catch { /* already gone */ }
          const env = resolveJiraCreds() // .env may still supply credentials
          return sendJson(res, 200, { ok: true, configured: !!env, source: env?.source || null })
        }

        next()
      })
    },
  }
}

// Jira REST proxy. Replaces server.proxy['/api/jira'] because a static proxy
// target/auth header is fixed at config time, and credentials here are entered
// at runtime in Settings. Same contract as the packaged app's proxy
// (electron/server.cjs → handleJira), so the client code is identical in both.
function jiraProxyPlugin() {
  return {
    name: 'jira-proxy',
    configureServer(server) {
      // req.url is the path AFTER the mount point, query string included.
      server.middlewares.use('/api/jira', async (req, res) => {
        const creds = resolveJiraCreds()
        const auth = toAuthHeader(creds)
        if (!auth) {
          // 401 (not 500) so pingJira() reads this as "not configured" and the
          // UI invites the user to add credentials in Settings.
          return sendJson(res, 401, {
            errorMessages: ['Jira is not connected. Add your Atlassian email and API token in Settings.'],
          })
        }

        const target = creds.baseUrl.replace(/\/$/, '') + '/rest' + req.url
        // Atlassian applies XSRF protection to API calls that arrive with a
        // browser Origin/Referer header — GETs pass, but POSTs (e.g.
        // /search/jql) get a 403. Sending only these headers makes the request
        // read as server-to-server; HTTP Basic auth is the real credential, and
        // X-Atlassian-Token is the documented opt-out.
        const headers = { Authorization: auth, Accept: 'application/json', 'X-Atlassian-Token': 'no-check' }
        if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type']

        let body
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          const chunks = []
          for await (const c of req) chunks.push(c)
          if (chunks.length) body = Buffer.concat(chunks)
        }

        try {
          const upstream = await fetch(target, { method: req.method, headers, body })
          const payload = Buffer.from(await upstream.arrayBuffer())
          res.statusCode = upstream.status
          res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json')
          // The client handles 429/5xx retries itself; just pass them through.
          res.end(payload)
        } catch (err) {
          sendJson(res, 502, { errorMessages: [`Proxy to Jira failed: ${err.message}`] })
        }
      })
    },
  }
}

// Dev-only file-backed Jira cache. The dashboard's cache used to live in
// IndexedDB but that turned out to be unreliable for ~9000 issues with
// changelogs. This middleware exposes /api/cache/jira (GET / POST / DELETE)
// over a single JSON file at <project>/.jira-cache/cache.json so the cache is
// a real, persistent, inspectable file on disk that survives any browser
// clearing.
function jiraFileCachePlugin() {
  const cacheDir = path.join(here, '.jira-cache')
  const cacheFile = path.join(cacheDir, 'cache.json')
  fs.mkdirSync(cacheDir, { recursive: true })
  return {
    name: 'jira-file-cache',
    configureServer(server) {
      server.middlewares.use('/api/cache/jira', (req, res, next) => {
        if (req.method === 'GET') {
          fs.readFile(cacheFile, 'utf8', (err, data) => {
            if (err && err.code === 'ENOENT') { res.statusCode = 404; res.end(); return }
            if (err) { res.statusCode = 500; res.end(err.message); return }
            res.setHeader('Content-Type', 'application/json')
            res.end(data)
          })
          return
        }
        if (req.method === 'POST' || req.method === 'PUT') {
          // Stream the raw body so large payloads aren't capped by JSON
          // body-parser limits — 9000 issues × changelog can be 100+ MB.
          const chunks = []
          let bytes = 0
          req.on('data', (c) => { chunks.push(c); bytes += c.length })
          req.on('end', () => {
            fs.writeFile(cacheFile, Buffer.concat(chunks), (err) => {
              if (err) { res.statusCode = 500; res.end(err.message); return }
              console.info(`[jira-cache] wrote ${(bytes / 1048576).toFixed(1)} MB → ${cacheFile}`)
              res.statusCode = 204
              res.end()
            })
          })
          req.on('error', (err) => { res.statusCode = 500; res.end(err.message) })
          return
        }
        if (req.method === 'DELETE') {
          fs.unlink(cacheFile, (err) => {
            if (err && err.code !== 'ENOENT') { res.statusCode = 500; res.end(err.message); return }
            res.statusCode = 204
            res.end()
          })
          return
        }
        next()
      })
    },
  }
}

// Dev-only disk mirror for ServiceNow imports. Patterned after the Jira cache
// above. Each import lives at <project>/.servicenow-cache/{uuid}/source.{ext}
// + meta.json so the data survives any browser clearing — OPFS (browser-side)
// stays the primary store; this is a backup that lets a different browser /
// cleared profile recover its imports on next boot. Customer case data is
// written here, so .servicenow-cache/ is gitignored — see SECURITY note at the
// top of imports-cache.js.
function snFileCachePlugin() {
  const cacheDir = path.join(here, '.servicenow-cache')
  fs.mkdirSync(cacheDir, { recursive: true })

  const importDir = (uuid) => path.join(cacheDir, uuid)
  const SAFE_UUID = /^[a-zA-Z0-9-]{1,64}$/
  // Server-side guard: only accept things that look like our uuids to prevent
  // any path-traversal funny business through user-controlled URL segments.
  const isSafeUuid = (s) => typeof s === 'string' && SAFE_UUID.test(s)

  function streamBody(req, file) {
    return new Promise((resolve, reject) => {
      const chunks = []
      let bytes = 0
      req.on('data', (c) => { chunks.push(c); bytes += c.length })
      req.on('end', () => {
        fs.writeFile(file, Buffer.concat(chunks), (err) => err ? reject(err) : resolve(bytes))
      })
      req.on('error', reject)
    })
  }

  function readAllMetas() {
    if (!fs.existsSync(cacheDir)) return []
    const out = []
    for (const uuid of fs.readdirSync(cacheDir)) {
      if (!isSafeUuid(uuid)) continue
      const metaFile = path.join(cacheDir, uuid, 'meta.json')
      try {
        const txt = fs.readFileSync(metaFile, 'utf8')
        const meta = JSON.parse(txt)
        if (meta && meta.uuid === uuid) out.push(meta)
      } catch { /* skip corrupt / missing meta */ }
    }
    return out
  }

  function findSourceFile(dir) {
    if (!fs.existsSync(dir)) return null
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith('source.')) return path.join(dir, name)
    }
    return null
  }

  return {
    name: 'sn-file-cache',
    configureServer(server) {
      server.middlewares.use('/api/cache/sn', (req, res, next) => {
        // req.url is the path AFTER the mount point. "" or "/" = collection root.
        const u = new URL(req.url, 'http://x')
        const segs = u.pathname.split('/').filter(Boolean) // [uuid?, kind?]

        // Collection: GET (list) | DELETE (wipe)
        if (segs.length === 0) {
          if (req.method === 'GET') {
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(readAllMetas()))
            return
          }
          if (req.method === 'DELETE') {
            try { fs.rmSync(cacheDir, { recursive: true, force: true }); fs.mkdirSync(cacheDir, { recursive: true }) }
            catch (e) { res.statusCode = 500; res.end(e.message); return }
            res.statusCode = 204; res.end(); return
          }
          return next()
        }

        const uuid = segs[0]
        if (!isSafeUuid(uuid)) { res.statusCode = 400; res.end('bad uuid'); return }
        const dir = importDir(uuid)

        // /{uuid} : DELETE one
        if (segs.length === 1 && req.method === 'DELETE') {
          try { fs.rmSync(dir, { recursive: true, force: true }) }
          catch (e) { res.statusCode = 500; res.end(e.message); return }
          res.statusCode = 204; res.end(); return
        }

        // /{uuid}/source : GET (stream blob) | PUT (write blob)
        if (segs.length === 2 && segs[1] === 'source') {
          if (req.method === 'GET') {
            const file = findSourceFile(dir)
            if (!file) { res.statusCode = 404; res.end(); return }
            res.setHeader('Content-Type', 'application/octet-stream')
            fs.createReadStream(file).pipe(res)
            return
          }
          if (req.method === 'PUT') {
            const ext = (u.searchParams.get('ext') || 'bin').replace(/[^a-zA-Z0-9]/g, '')
            fs.mkdirSync(dir, { recursive: true })
            // Remove any prior source.* before writing (extension can change).
            try { for (const n of fs.readdirSync(dir)) { if (n.startsWith('source.')) fs.unlinkSync(path.join(dir, n)) } } catch { /* ignore */ }
            streamBody(req, path.join(dir, `source.${ext}`))
              .then((bytes) => { console.info(`[sn-cache] wrote ${(bytes / 1048576).toFixed(1)} MB → ${uuid}/source.${ext}`); res.statusCode = 204; res.end() })
              .catch((e) => { res.statusCode = 500; res.end(e.message) })
            return
          }
        }

        // /{uuid}/meta : PUT (write meta.json)
        if (segs.length === 2 && segs[1] === 'meta' && req.method === 'PUT') {
          fs.mkdirSync(dir, { recursive: true })
          streamBody(req, path.join(dir, 'meta.json'))
            .then(() => { res.statusCode = 204; res.end() })
            .catch((e) => { res.statusCode = 500; res.end(e.message) })
          return
        }

        next()
      })
    },
  }
}

// SECURITY #9 — Content Security Policy, PRODUCTION BUILD ONLY.
//
// The dev server needs looser rules (HMR websockets, the /api/jira proxy,
// eval-based tooling), so this plugin runs only on `vite build` and injects a
// <meta http-equiv="Content-Security-Policy"> into the built index.html.
//
// Allowances explained:
//   script-src 'wasm-unsafe-eval'   → DuckDB-WASM instantiation
//   style-src  'unsafe-inline'      → this app styles via inline style props
//   style-src/font-src fonts.google → Shell.jsx @imports Google Fonts
//   img-src/font-src data:          → inline SVG/icon data URIs
//   connect-src 'self'              → same-origin only (prod has no Jira proxy)
function cspProdPlugin() {
  const policy = [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data:",
    "connect-src 'self'",
    "font-src 'self' data: https://fonts.gstatic.com",
  ].join("; ")
  return {
    name: "csp-prod",
    apply: "build",
    transformIndexHtml(html) {
      const tag = `<meta http-equiv="Content-Security-Policy" content="${policy}">`
      return html.replace("</head>", `    ${tag}\n  </head>`)
    },
  }
}

// https://vite.dev/config/
export default defineConfig(() => {
  // Credentials stay on the Node side; they are never bundled into the client.
  // Resolved per request (see resolveJiraCreds) rather than baked in here, so
  // Jira can be connected from Settings without restarting the dev server.
  const creds = resolveJiraCreds()
  if (creds) {
    console.info(`[vite] Jira credentials found (${creds.source === 'env' ? '.env' : '.jira-creds.json'}) — ${creds.email}`)
  } else {
    console.info(
      '[vite] No Jira credentials yet — that is fine. ServiceNow imports and every ' +
      'non-Jira page work without them; connect Jira any time from Settings → Jira connection.'
    )
  }

  return {
    plugins: [
      react(),
      jiraCredsPlugin(),
      jiraProxyPlugin(),
      jiraFileCachePlugin(),
      snFileCachePlugin(),
      cspProdPlugin(),
    ],
    // duckdb-wasm ships its own pre-bundled artifacts; let Vite pass them through
    // rather than try to pre-bundle them with esbuild.
    optimizeDeps: { exclude: ['@duckdb/duckdb-wasm'] },
    resolve: {
      alias: {
        // The package's `./blocking` subpath only resolves to its node build; the
        // browser-blocking dist file exists but isn't listed in the exports
        // field. Alias it directly so Vite can find it.
        '@duckdb/duckdb-wasm-blocking-browser': path.resolve(
          here,
          'node_modules/@duckdb/duckdb-wasm/dist/duckdb-browser-blocking.mjs'
        ),
      },
    },
    worker: { format: 'es' },
    // /api/jira is served by jiraProxyPlugin() above rather than server.proxy:
    // the target and auth header have to be read per request so credentials can
    // be entered at runtime. DEV ONLY either way — a static `vite build` has no
    // dev server, so live sync is unavailable in `vite preview` / deploys (the
    // packaged desktop app ships its own equivalent in electron/server.cjs).
    server: {
      host: '0.0.0.0',
      allowedHosts: ['inbavwinterfac2'],
    },
  }
})
