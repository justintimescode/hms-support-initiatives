import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

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
  // .env values stay on the Node side; they are never bundled into the client.
  // We read .env directly rather than via Vite's loadEnv so the file always
  // wins over any matching variable in the shell environment.
  const env = readDotEnv()
  const jiraBase = env.JIRA_BASE_URL || 'https://infor.atlassian.net'
  const hasJiraCreds = Boolean(env.JIRA_EMAIL && env.JIRA_API_TOKEN)
  const jiraAuth = hasJiraCreds
    ? 'Basic ' + Buffer.from(`${env.JIRA_EMAIL}:${env.JIRA_API_TOKEN}`).toString('base64')
    : null

  if (!hasJiraCreds) {
    console.warn(
      '[vite] No JIRA_EMAIL / JIRA_API_TOKEN in .env — the /api/jira proxy will ' +
      'forward requests unauthenticated (Jira will return 401). Copy .env.example ' +
      'to .env and fill it in to enable live Jira sync.'
    )
  }

  return {
    plugins: [react(), jiraFileCachePlugin(), snFileCachePlugin(), cspProdPlugin()],
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
    server: {
      proxy: {
        // Browser calls /api/jira/* — the dev server forwards to Jira's REST
        // API and injects HTTP Basic auth server-side so the token never
        // reaches the client bundle. DEV ONLY: a static `vite build` has no
        // dev server, so live sync is unavailable in `vite preview` / deploys.
        '/api/jira': {
          target: jiraBase,
          changeOrigin: true,
          secure: true,
          rewrite: (p) => p.replace(/^\/api\/jira/, '/rest'),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              if (jiraAuth) proxyReq.setHeader('Authorization', jiraAuth)
              proxyReq.setHeader('Accept', 'application/json')
              // Atlassian applies XSRF protection to API calls that arrive
              // with a browser Origin/Referer header — GETs pass, but POSTs
              // (e.g. /search/jql) get a 403. Strip them so the proxied
              // request reads as server-to-server; HTTP Basic auth is the
              // real credential. X-Atlassian-Token is the documented opt-out.
              proxyReq.removeHeader('origin')
              proxyReq.removeHeader('referer')
              proxyReq.removeHeader('cookie')
              proxyReq.setHeader('X-Atlassian-Token', 'no-check')
            })
          },
        },
      },
    },
  }
})
