// One-shot compactor for .jira-cache/cache.json.
//
// The app normalises the cache on read (see loadCache in src/lib/jira-client.js),
// so this script is not required — but a cache written by a pre-90-day build can
// be hundreds of MB, and parsing that much JSON in the renderer just to throw
// most of it away is a bad first boot. Run this once after upgrading:
//
//   node --max-old-space-size=8192 scripts/compact-jira-cache.mjs
//
// It applies the exact same prune + slim the app does (imported, not
// reimplemented, so the two can't drift), writes cache.json.bak alongside, and
// reports the before/after size. Deleting the cache and re-syncing is the other
// valid option — the data is fully reproducible from Jira.

import { readFileSync, writeFileSync, existsSync, statSync, renameSync } from 'node:fs'
import { pruneIssues, slimIssues, RETENTION_DAYS } from '../src/lib/jira-client.js'

const FILE = '.jira-cache/cache.json'
const BAK = FILE + '.bak'
const MB = (n) => (n / 1048576).toFixed(1) + ' MB'

if (!existsSync(FILE)) {
  console.log(`no cache at ${FILE} — nothing to do`)
  process.exit(0)
}

const before = statSync(FILE).size
const data = JSON.parse(readFileSync(FILE, 'utf8'))
if (!data?.issues?.length) {
  console.log('cache has no issues — nothing to do')
  process.exit(0)
}

const pruned = pruneIssues(data.issues)
const { issues } = slimIssues(pruned)
const meta = { ...data.meta, count: issues.length }
const out = JSON.stringify({ issues, meta })

renameSync(FILE, BAK)
writeFileSync(FILE, out)

console.log(`issues   ${data.issues.length} → ${issues.length} (${RETENTION_DAYS}-day window)`)
console.log(`size     ${MB(before)} → ${MB(out.length)}`)
console.log(`backup   ${BAK} — delete it once the app boots cleanly`)
