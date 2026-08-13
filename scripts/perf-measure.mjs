// Repeatable performance harness for the whole app. Drives a real browser
// against the dev server and records, per interaction: wall-clock time from
// click to painted content, how many React components rendered, and how much
// of that time the main thread was blocked (long tasks).
//
// Component render counts come from React 19.2's own performance tracks — every
// component render in a dev build emits a `performance.measure` on the
// "Components ⚛" track, which is the same data the DevTools Profiler shows.
// No source instrumentation needed, so the app under test is unmodified.
//
// Usage:
//   node scripts/perf-measure.mjs --label=baseline
//   node scripts/perf-measure.mjs --label=after --url=http://localhost:5173
//
// Writes <label>.json next to the repo root under .perf/ (gitignored) and
// prints a summary table. Requires `npm run dev` to be running.

import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')

const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : dflt
}

const URL_BASE = arg('url', 'http://localhost:5173')
const LABEL = arg('label', 'run')
const PROFILE = arg('profile', path.join(root, '.perf', 'profile'))
const OUT_DIR = path.join(root, '.perf')
const REPEATS = Number(arg('repeats', '3'))

// The nav targets exercised on every run: a chart-heavy page, two big tables,
// the Jira pages (heaviest known), and the dashboard.
const TABS = [
  { label: 'Dashboard', link: 'Dashboard', heading: 'Dashboard' },
  { label: 'SLA', link: 'SLA', heading: 'SLA Performance' },
  { label: 'Cases', link: 'Cases', heading: 'Case Register' },
  { label: 'Team', link: 'Team', heading: 'Team Leaderboard' },
  { label: "All HMS Jira's", link: "All HMS Jira's", heading: "All HMS Jira's" },
  { label: 'Jira Statistics', link: 'Statistics', heading: 'Jira Statistics' },
  { label: 'Jira Blockers', link: 'Cases w/ Jira Blockers', heading: 'Cases w/ Jira Blockers' },
  { label: 'Workload', link: 'Workload', heading: 'Workload Distribution' },
]

/* ---------------------------------------------------------------- page shim */
// Installed before any app code runs. Collects long tasks continuously and
// exposes reset/snapshot so the driver can scope counters to one interaction.
const SHIM = () => {
  window.__perf = { longTasks: [], t0: 0 }
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        window.__perf.longTasks.push({ start: e.startTime, duration: e.duration })
      }
    }).observe({ entryTypes: ['longtask'] })
  } catch { /* longtask unsupported — durations still reported */ }

  const REACT_TRACK = 'Components ⚛'
  window.__perfReset = () => {
    performance.clearMeasures()
    window.__perf.longTasks.length = 0
    window.__perf.t0 = performance.now()
    return window.__perf.t0
  }
  window.__perfSnapshot = () => {
    const t0 = window.__perf.t0
    const byName = {}
    let renders = 0
    for (const m of performance.getEntriesByType('measure')) {
      if (m.detail?.devtools?.track !== REACT_TRACK) continue
      if (m.startTime < t0) continue
      renders++
      byName[m.name] = (byName[m.name] || 0) + 1
    }
    const long = window.__perf.longTasks.filter((t) => t.start >= t0)
    return {
      renders,
      byName,
      longTasks: long.length,
      blockedMs: +long.reduce((s, t) => s + t.duration, 0).toFixed(1),
      longestTaskMs: +long.reduce((m, t) => Math.max(m, t.duration), 0).toFixed(1),
    }
  }
  // Click a sidebar link and resolve once the target heading has painted.
  window.__perfNav = (linkText, heading, timeoutMs = 20000) => {
    const links = [...document.querySelectorAll('aside a')]
    const link = links.find((a) => a.textContent.trim() === linkText)
    if (!link) return Promise.resolve({ error: `link not found: ${linkText}` })
    // Page titles render as `.display` divs inside <Section>; the sidebar has
    // one too ("HMS Insights"), so anything inside <aside> is excluded.
    const seen = () => [...document.querySelectorAll('.display')].some(
      (el) => !el.closest('aside') && el.textContent.trim() === heading)
    return new Promise((resolve) => {
      const t0 = performance.now()
      window.__perfReset()
      link.click()
      const deadline = t0 + timeoutMs
      const poll = () => {
        if (seen()) {
          // One more frame so the measurement includes the paint, not just the
          // commit — this is the number that maps to "feels instant".
          requestAnimationFrame(() =>
            resolve({ ms: +(performance.now() - t0).toFixed(1), ...window.__perfSnapshot() }))
          return
        }
        if (performance.now() > deadline) {
          resolve({ ms: +(performance.now() - t0).toFixed(1), timeout: true, ...window.__perfSnapshot() })
          return
        }
        requestAnimationFrame(poll)
      }
      requestAnimationFrame(poll)
    })
  }
  // Generic "do this, then wait until the DOM settles into `pred`" timer.
  window.__perfAct = (act, pred, timeoutMs = 30000) => {
    const predFn = new Function(`return (${pred})`)()
    return new Promise((resolve) => {
      const t0 = performance.now()
      window.__perfReset()
      new Function(`return (${act})`)()()
      const deadline = t0 + timeoutMs
      const poll = () => {
        if (predFn()) {
          requestAnimationFrame(() =>
            resolve({ ms: +(performance.now() - t0).toFixed(1), ...window.__perfSnapshot() }))
          return
        }
        if (performance.now() > deadline) {
          resolve({ ms: +(performance.now() - t0).toFixed(1), timeout: true, ...window.__perfSnapshot() })
          return
        }
        requestAnimationFrame(poll)
      }
      requestAnimationFrame(poll)
    })
  }
  // Scroll the window in fixed steps, recording frame intervals.
  window.__perfScroll = (steps = 40, px = 220) => {
    return new Promise((resolve) => {
      window.__perfReset()
      const frames = []
      let last = performance.now()
      let i = 0
      const tick = () => {
        const now = performance.now()
        frames.push(now - last)
        last = now
        if (i++ >= steps) {
          const sorted = [...frames].sort((a, b) => a - b)
          resolve({
            frames: frames.length,
            p50: +sorted[Math.floor(sorted.length * 0.5)].toFixed(1),
            p95: +sorted[Math.floor(sorted.length * 0.95)].toFixed(1),
            worst: +Math.max(...frames).toFixed(1),
            dropped: frames.filter((f) => f > 32).length,
            ...window.__perfSnapshot(),
          })
          return
        }
        window.scrollBy(0, px)
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
  }
}

/* ------------------------------------------------------------------- driver */
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : null
}
const topN = (byName, n = 8) =>
  Object.entries(byName || {}).sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([k, v]) => `${k}×${v}`).join(', ')

// Written after every phase so a crash mid-run still leaves usable numbers.
function writeOut(results) {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(path.join(OUT_DIR, `${LABEL}.json`), JSON.stringify(results, null, 2))
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: true,
    viewport: { width: 1680, height: 1000 },
    args: ['--enable-precise-memory-info'],
  })
  const page = ctx.pages()[0] || (await ctx.newPage())
  await page.addInitScript(SHIM)

  const results = { label: LABEL, url: URL_BASE, startedAt: new Date().toISOString(), boot: {}, nav: {}, actions: {}, scroll: {} }

  /* ---- boot ---- */
  const bootStart = Date.now()
  await page.goto(URL_BASE, { waitUntil: 'commit', timeout: 120000 })
  // Data-ready = the filter bar's slice counter is present (rows are loaded).
  await page.waitForFunction(
    () => /cases in slice/.test(document.body.innerText),
    null, { timeout: 300000, polling: 250 },
  )
  results.boot.toDataReadyMs = Date.now() - bootStart
  results.boot.nav = await page.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0] || {}
    const paint = performance.getEntriesByType('paint')
    return {
      domContentLoaded: Math.round(n.domContentLoadedEventEnd || 0),
      load: Math.round(n.loadEventEnd || 0),
      firstPaint: Math.round(paint.find((p) => p.name === 'first-paint')?.startTime || 0),
      firstContentfulPaint: Math.round(paint.find((p) => p.name === 'first-contentful-paint')?.startTime || 0),
      transferredKb: Math.round(performance.getEntriesByType('resource')
        .reduce((s, r) => s + (r.transferSize || 0), 0) / 1024),
      resources: performance.getEntriesByType('resource').length,
    }
  })
  results.boot.blockedMs = await page.evaluate(() =>
    +window.__perf.longTasks.reduce((s, t) => s + t.duration, 0).toFixed(1))
  results.boot.longTasks = await page.evaluate(() => window.__perf.longTasks.length)
  results.boot.rows = await page.evaluate(() => {
    const m = document.body.innerText.match(/([\d,]+)\s*\n?\s*cases in slice/)
    return m ? m[1] : null
  })
  // Jira readiness is a separate, much later milestone than rows-ready, and
  // pages branch on it — wait for it or nav timings vary by whether the join
  // had landed yet.
  await page.waitForFunction(
    () => /issues cached|needs token|Not configured/.test(document.body.innerText),
    null, { timeout: 300000, polling: 250 },
  )
  results.boot.toJiraReadyMs = Date.now() - bootStart
  results.boot.jira = await page.evaluate(() => {
    const m = document.body.innerText.match(/([\d,]+) issues cached/)
    return m ? m[1] : null
  })
  results.boot.jsHeapMb = await page.evaluate(
    () => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null))
  writeOut(results)
  // Let any tail-end background work settle before timing interactions.
  await page.waitForTimeout(3000)

  /* ---- nav: cold (first visit) then warm (repeat visits) ---- */
  // Park on a page that isn't measured so the first Dashboard visit is a real
  // navigation (the app boots on "/").
  await page.evaluate(() => window.__perfNav('Settings', 'Settings'))
  for (const tab of TABS) {
    const cold = await page.evaluate(
      ([l, h]) => window.__perfNav(l, h), [tab.link, tab.heading])
    results.nav[tab.label] = { cold, warm: [] }
    process.stdout.write(`cold  ${tab.label.padEnd(22)} ${String(cold.ms).padStart(7)}ms  renders=${String(cold.renders).padStart(5)}  blocked=${cold.blockedMs}ms\n`)
  }
  for (let r = 0; r < REPEATS; r++) {
    for (const tab of TABS) {
      const warm = await page.evaluate(
        ([l, h]) => window.__perfNav(l, h), [tab.link, tab.heading])
      results.nav[tab.label].warm.push(warm)
    }
  }
  for (const tab of TABS) {
    const w = results.nav[tab.label].warm
    const m = median(w.map((x) => x.ms))
    process.stdout.write(`warm  ${tab.label.padEnd(22)} ${String(m).padStart(7)}ms  renders=${String(median(w.map((x) => x.renders))).padStart(5)}  blocked=${median(w.map((x) => x.blockedMs))}ms\n`)
  }
  writeOut(results)

  /* ---- filter changes (measured on the Dashboard) ---- */
  await page.evaluate(() => window.__perfNav('Dashboard', 'Dashboard'))
  const readSlice = () => page.evaluate(
    () => document.body.innerText.match(/([\d,]+)\s*cases in slice/)?.[1] ?? null)
  // "settled" = the slice counter changed from `prev`, i.e. the filter applied.
  const sliceChanged = (prev) =>
    `() => { const m = document.body.innerText.match(/([\\d,]+)\\s*cases in slice/);
             return !!m && m[1] !== ${JSON.stringify(prev)}; }`

  // Analyst select (the one carrying the "All analysts" option — the preset
  // select comes first in DOM order). Pick the busiest analyst, then reset.
  const analystSel = `[...document.querySelectorAll('select')].find(s => [...s.options].some(o => /All analysts/.test(o.text)))`
  const analystRuns = []
  for (let r = 0; r < REPEATS; r++) {
    for (const idx of [1, 0]) {
      const before = await readSlice()
      const res = await page.evaluate(
        ([act, pred]) => window.__perfAct(act, pred),
        [`() => { const s = ${analystSel}; s.selectedIndex = ${idx};
                  s.dispatchEvent(new Event('change', { bubbles: true })); }`,
         sliceChanged(before)])
      if (idx === 1) analystRuns.push(res)
    }
  }
  results.actions.analystFilter = analystRuns

  // Date preset: "Last 30 days" then back to the default.
  const presetRuns = []
  for (let r = 0; r < REPEATS; r++) {
    for (const label of ['Last 30 days', 'All-time']) {
      const before = await readSlice()
      const res = await page.evaluate(
        ([act, pred]) => window.__perfAct(act, pred),
        [`() => { const s = [...document.querySelectorAll('select')].find(x => [...x.options].some(o => o.text === ${JSON.stringify(label)}));
                  const o = [...s.options].find(o => o.text === ${JSON.stringify(label)});
                  s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })); }`,
         sliceChanged(before)])
      if (label === 'Last 30 days') presetRuns.push(res)
    }
  }
  results.actions.datePreset = presetRuns
  writeOut(results)

  /* ---- table sort + scroll on the Cases page ---- */
  await page.evaluate(() => window.__perfNav('Cases', 'Cases'))
  await page.waitForTimeout(500)
  results.actions.sortCasesTable = []
  for (let r = 0; r < REPEATS; r++) {
    const res = await page.evaluate(() => window.__perfAct(
      `() => { const th = [...document.querySelectorAll('th')].find(t => /Priority/.test(t.textContent)); th && th.click() }`,
      `() => true`,
    ))
    results.actions.sortCasesTable.push(res)
  }
  results.scroll.cases = await page.evaluate(() => window.__perfScroll(40, 240))
  await page.evaluate(() => window.scrollTo(0, 0))

  await page.evaluate(() => window.__perfNav("All HMS Jira's", "All HMS Jira's"))
  await page.waitForTimeout(500)
  results.scroll.jira = await page.evaluate(() => window.__perfScroll(40, 240))

  results.finishedAt = new Date().toISOString()
  writeOut(results)
  const out = path.join(OUT_DIR, `${LABEL}.json`)

  process.stdout.write('\n--- actions (median) ---\n')
  for (const [k, runs] of Object.entries(results.actions)) {
    process.stdout.write(`${k.padEnd(20)} ${String(median(runs.map((x) => x.ms))).padStart(7)}ms  renders=${median(runs.map((x) => x.renders))}  blocked=${median(runs.map((x) => x.blockedMs))}ms\n`)
    process.stdout.write(`  top: ${topN(runs[0].byName)}\n`)
  }
  process.stdout.write('\n--- scroll ---\n')
  for (const [k, s] of Object.entries(results.scroll)) {
    process.stdout.write(`${k.padEnd(20)} p50=${s.p50}ms p95=${s.p95}ms worst=${s.worst}ms dropped=${s.dropped}/${s.frames} renders=${s.renders}\n`)
  }
  process.stdout.write(`\nboot: dataReady=${results.boot.toDataReadyMs}ms jiraReady=${results.boot.toJiraReadyMs}ms fcp=${results.boot.nav.firstContentfulPaint}ms blocked=${results.boot.blockedMs}ms heap=${results.boot.jsHeapMb}MB rows=${results.boot.rows} jira=${results.boot.jira}\n`)
  process.stdout.write(`wrote ${out}\n`)

  await ctx.close()
}

main().catch((err) => {
  console.error('perf-measure failed:', err)
  process.exit(1)
})
