import { loadEnv } from 'vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const env = loadEnv('development', here, '')

console.log('cwd:', here)
console.log('JIRA_EMAIL:', env.JIRA_EMAIL ? 'SET' : 'MISSING')
console.log('JIRA_API_TOKEN:', env.JIRA_API_TOKEN ? `SET (len=${env.JIRA_API_TOKEN.length})` : 'MISSING')
console.log('JIRA_BASE_URL:', env.JIRA_BASE_URL || 'MISSING')
console.log('hasJiraCreds:', Boolean(env.JIRA_EMAIL && env.JIRA_API_TOKEN))
