// Bundle-size report. Builds with sourcemaps into a throwaway directory and
// attributes every byte of each generated chunk back to the module it came
// from, so "what is actually in the 1 MB chunk" is a measured number instead
// of a guess.
//
// Deliberately dependency-free: it decodes the sourcemap mappings directly
// (the same attribution source-map-explorer uses) rather than pulling in a
// visualizer plugin that would have to be wired into vite.config.js. Nothing
// here runs at app runtime.
//
// Usage: node scripts/bundle-report.mjs [--top=25] [--keep]

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')
const OUT = path.join(root, '.perf', 'bundle')
const TOP = Number((process.argv.find((a) => a.startsWith('--top=')) || '--top=25').slice(6))

/* VLQ / base64 sourcemap mapping decode */
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const CHAR = new Map([...B64].map((c, i) => [c, i]))

// Yields [generatedLine, generatedColumn, sourceIndex] for every mapping.
function* decodeMappings(mappings) {
  let line = 0, srcIdx = 0
  for (const lineStr of mappings.split(';')) {
    let col = 0
    if (lineStr) {
      for (const seg of lineStr.split(',')) {
        if (!seg) continue
        let i = 0
        const read = () => {
          let shift = 0, result = 0, cont
          do {
            const digit = CHAR.get(seg[i++])
            if (digit === undefined) return null
            cont = digit & 32
            result += (digit & 31) << shift
            shift += 5
          } while (cont)
          const negate = result & 1
          result >>= 1
          return negate ? -result : result
        }
        const dCol = read(); if (dCol == null) continue
        col += dCol
        const dSrc = read()
        if (dSrc == null) { yield [line, col, -1]; continue }
        srcIdx += dSrc
        read(); read() // source line / column (unused)
        yield [line, col, srcIdx]
      }
    }
    line++
  }
}

// Bucket a chunk's bytes by source module. A mapping owns the generated text
// from its column up to the next mapping (or end of line).
function attribute(code, map) {
  const lines = code.split('\n')
  const lineStart = []
  let acc = 0
  for (const l of lines) { lineStart.push(acc); acc += l.length + 1 }
  const entries = [...decodeMappings(map.mappings)]
  const bytes = new Map()
  for (let i = 0; i < entries.length; i++) {
    const [line, col, src] = entries[i]
    const next = entries[i + 1]
    const sameLine = next && next[0] === line
    const end = sameLine ? next[1] : (lines[line]?.length ?? col)
    const len = Math.max(0, end - col)
    const name = src >= 0 ? (map.sources[src] || '(unknown)') : '(unmapped)'
    bytes.set(name, (bytes.get(name) || 0) + len)
  }
  const mapped = [...bytes.values()].reduce((s, n) => s + n, 0)
  bytes.set('(unmapped)', (bytes.get('(unmapped)') || 0) + Math.max(0, code.length - mapped))
  return bytes
}

const kb = (n) => (n / 1024).toFixed(1).padStart(8)
// Collapse a module path to the unit worth reporting: one line per npm
// package, one line per app source file.
const bucketOf = (src) => {
  const s = src.replace(/\\/g, '/')
  const m = s.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/)
  if (m) return `node_modules/${m[1]}`
  const i = s.indexOf('/src/')
  return i >= 0 ? s.slice(i + 1) : s.replace(/^.*?([^/]+\/[^/]+)$/, '$1')
}

fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })
execFileSync('npx', ['vite', 'build', '--sourcemap', '--outDir', OUT, '--emptyOutDir'], {
  cwd: root, stdio: ['ignore', 'ignore', 'inherit'], shell: process.platform === 'win32',
})

const assetDir = path.join(OUT, 'assets')
const files = fs.readdirSync(assetDir)
const chunks = files.filter((f) => f.endsWith('.js'))
const total = { js: 0, css: 0, wasm: 0 }
for (const f of files) {
  const size = fs.statSync(path.join(assetDir, f)).size
  if (f.endsWith('.js')) total.js += size
  else if (f.endsWith('.css')) total.css += size
  else if (f.endsWith('.wasm')) total.wasm += size
}

console.log('=== chunks ===')
for (const f of [...chunks].sort((a, b) => fs.statSync(path.join(assetDir, b)).size - fs.statSync(path.join(assetDir, a)).size)) {
  console.log(`${kb(fs.statSync(path.join(assetDir, f)).size)} kB  ${f}`)
}
for (const f of files.filter((f) => !f.endsWith('.js') && !f.endsWith('.map'))) {
  console.log(`${kb(fs.statSync(path.join(assetDir, f)).size)} kB  ${f}`)
}
console.log(`\ntotal JS ${kb(total.js)} kB · CSS ${kb(total.css)} kB · WASM ${kb(total.wasm)} kB`)

for (const chunk of chunks) {
  const mapFile = path.join(assetDir, chunk + '.map')
  if (!fs.existsSync(mapFile)) { console.log(`\n=== ${chunk} — no sourcemap ===`); continue }
  const code = fs.readFileSync(path.join(assetDir, chunk), 'utf8')
  const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'))
  const bytes = attribute(code, map)
  const buckets = new Map()
  for (const [src, n] of bytes) {
    const b = src === '(unmapped)' ? '(unmapped)' : bucketOf(src)
    buckets.set(b, (buckets.get(b) || 0) + n)
  }
  console.log(`\n=== ${chunk} · ${kb(code.length)} kB ===`)
  for (const [b, n] of [...buckets].sort((a, b2) => b2[1] - a[1]).slice(0, TOP)) {
    console.log(`${kb(n)} kB  ${b}`)
  }
}

if (!process.argv.includes('--keep')) fs.rmSync(OUT, { recursive: true, force: true })
