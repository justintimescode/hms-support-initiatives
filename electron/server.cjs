// Local HTTP server that runs inside the Electron main process.
//
// This is the production replacement for the Vite dev server. Your React code
// keeps fetching the same relative URLs (/api/jira, /api/cache/jira,
// /api/cache/sn) — they just hit this server instead. The three handlers below
// are ports of the Vite middleware in vite.config.js:
//
//   /api/jira       → Jira REST proxy with server-side Basic auth (no CORS,
//                     token never reaches the renderer)
//   /api/cache/jira → file-backed Jira issue cache (cache.json)
//   /api/cache/sn   → file-backed ServiceNow import mirror
//
// The two caches now live under <userData> instead of the project folder,
// because a packaged app's own directory is read-only.

const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
}

const SAFE_UUID = /^[a-zA-Z0-9-]{1,64}$/
const isSafeUuid = (s) => typeof s === 'string' && SAFE_UUID.test(s)

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

// Stream a request body straight to disk so large payloads (a 100+ MB Jira
// cache, big ServiceNow exports) aren't buffered/capped. Returns bytes written.
function streamBodyToFile(req, file) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let bytes = 0
    req.on('data', (c) => { chunks.push(c); bytes += c.length })
    req.on('end', () => {
      fs.writeFile(file, Buffer.concat(chunks), (err) => (err ? reject(err) : resolve(bytes)))
    })
    req.on('error', reject)
  })
}

/* ------------------------------ Jira proxy ------------------------------- */

// Mirrors vite.config.js → server.proxy['/api/jira']. Injects Basic auth and
// strips Origin/Referer/Cookie (+ sets X-Atlassian-Token) so Atlassian's XSRF
// protection treats the call as server-to-server. The client already handles
// 429/5xx retries, so we just forward the response through.
async function handleJira(req, res, getCreds) {
  const { baseUrl, auth } = getCreds()
  const restPath = req.url.replace(/^\/api\/jira/, '/rest')
  const target = baseUrl.replace(/\/$/, '') + restPath

  const headers = { Accept: 'application/json', 'X-Atlassian-Token': 'no-check' }
  if (auth) headers.Authorization = auth
  if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type']

  let body
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const buf = await readBody(req)
    if (buf.length) body = buf
  }

  try {
    const upstream = await fetch(target, { method: req.method, headers, body })
    const payload = Buffer.from(await upstream.arrayBuffer())
    res.statusCode = upstream.status
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json')
    res.end(payload)
  } catch (err) {
    res.statusCode = 502
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ errorMessages: [`Proxy to Jira failed: ${err.message}`] }))
  }
}

/* --------------------------- Jira file cache ----------------------------- */

function handleJiraCache(req, res, cacheDir) {
  const cacheFile = path.join(cacheDir, 'cache.json')
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
    fs.mkdirSync(cacheDir, { recursive: true })
    streamBodyToFile(req, cacheFile)
      .then((bytes) => {
        console.info(`[jira-cache] wrote ${(bytes / 1048576).toFixed(1)} MB`)
        res.statusCode = 204; res.end()
      })
      .catch((err) => { res.statusCode = 500; res.end(err.message) })
    return
  }
  if (req.method === 'DELETE') {
    fs.unlink(cacheFile, (err) => {
      if (err && err.code !== 'ENOENT') { res.statusCode = 500; res.end(err.message); return }
      res.statusCode = 204; res.end()
    })
    return
  }
  res.statusCode = 405; res.end()
}

/* ----------------------- ServiceNow import cache ------------------------- */

function handleSnCache(req, res, cacheDir, subPath) {
  fs.mkdirSync(cacheDir, { recursive: true })
  const importDir = (uuid) => path.join(cacheDir, uuid)

  const readAllMetas = () => {
    const out = []
    for (const uuid of fs.readdirSync(cacheDir)) {
      if (!isSafeUuid(uuid)) continue
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(cacheDir, uuid, 'meta.json'), 'utf8'))
        if (meta && meta.uuid === uuid) out.push(meta)
      } catch { /* skip corrupt/missing */ }
    }
    return out
  }
  const findSourceFile = (dir) => {
    if (!fs.existsSync(dir)) return null
    for (const name of fs.readdirSync(dir)) if (name.startsWith('source.')) return path.join(dir, name)
    return null
  }

  const u = new URL(subPath, 'http://x')
  const segs = u.pathname.split('/').filter(Boolean) // [uuid?, kind?]

  // Collection root: GET (list metas) | DELETE (wipe all)
  if (segs.length === 0) {
    if (req.method === 'GET') {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(readAllMetas()))
      return
    }
    if (req.method === 'DELETE') {
      try {
        fs.rmSync(cacheDir, { recursive: true, force: true })
        fs.mkdirSync(cacheDir, { recursive: true })
      } catch (e) { res.statusCode = 500; res.end(e.message); return }
      res.statusCode = 204; res.end(); return
    }
    res.statusCode = 405; res.end(); return
  }

  const uuid = segs[0]
  if (!isSafeUuid(uuid)) { res.statusCode = 400; res.end('bad uuid'); return }
  const dir = importDir(uuid)

  // /{uuid} : DELETE one import
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
      try {
        for (const n of fs.readdirSync(dir)) if (n.startsWith('source.')) fs.unlinkSync(path.join(dir, n))
      } catch { /* ignore */ }
      streamBodyToFile(req, path.join(dir, `source.${ext}`))
        .then((bytes) => {
          console.info(`[sn-cache] wrote ${(bytes / 1048576).toFixed(1)} MB → ${uuid}/source.${ext}`)
          res.statusCode = 204; res.end()
        })
        .catch((e) => { res.statusCode = 500; res.end(e.message) })
      return
    }
  }

  // /{uuid}/meta : PUT (write meta.json)
  if (segs.length === 2 && segs[1] === 'meta' && req.method === 'PUT') {
    fs.mkdirSync(dir, { recursive: true })
    streamBodyToFile(req, path.join(dir, 'meta.json'))
      .then(() => { res.statusCode = 204; res.end() })
      .catch((e) => { res.statusCode = 500; res.end(e.message) })
    return
  }

  res.statusCode = 404; res.end()
}

/* ----------------------------- static files ------------------------------ */

function serveStatic(req, res, distDir) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  let filePath = path.normalize(path.join(distDir, urlPath))

  // Path-traversal guard.
  if (!filePath.startsWith(distDir)) { res.statusCode = 403; res.end('forbidden'); return }

  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isDirectory()) filePath = path.join(filePath, 'index.html')

    const hasExt = path.extname(urlPath) !== ''
    const send = (file) => {
      const ext = path.extname(file).toLowerCase()
      res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream')
      fs.createReadStream(file)
        .on('error', () => { res.statusCode = 500; res.end('read error') })
        .pipe(res)
    }

    fs.access(filePath, fs.constants.R_OK, (missing) => {
      if (!missing) { send(filePath); return }
      // SPA fallback: unknown extensionless path (a react-router route) → index.html.
      if (!hasExt) { send(path.join(distDir, 'index.html')); return }
      res.statusCode = 404; res.end('not found')
    })
  })
}

/* -------------------------------- server --------------------------------- */

/**
 * @param {object} opts
 * @param {string} opts.distDir       absolute path to the built static assets
 * @param {string} opts.userDataDir   Electron userData dir (cache root)
 * @param {() => {baseUrl:string,auth:string|null}} opts.getCreds  read at request time
 * @returns {Promise<{url:string, port:number, close:() => void}>}
 */
function startServer({ distDir, userDataDir, getCreds }) {
  const jiraCacheDir = path.join(userDataDir, '.jira-cache')
  const snCacheDir = path.join(userDataDir, '.servicenow-cache')

  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://x').pathname

    if (pathname.startsWith('/api/jira')) return void handleJira(req, res, getCreds)
    if (pathname === '/api/cache/jira') return void handleJiraCache(req, res, jiraCacheDir)
    if (pathname.startsWith('/api/cache/sn')) {
      const sub = req.url.replace(/^\/api\/cache\/sn/, '') || '/'
      return void handleSnCache(req, res, snCacheDir, sub)
    }
    return void serveStatic(req, res, distDir)
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    // Port 0 = OS picks a free port; bind to loopback only so nothing on the
    // network can reach it.
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({ url: `http://127.0.0.1:${port}`, port, close: () => server.close() })
    })
  })
}

module.exports = { startServer }
