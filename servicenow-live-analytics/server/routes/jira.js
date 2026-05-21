/**
 * Jira proxy routes — all Jira API calls go through here so credentials
 * never reach the browser.
 *
 * Required env vars:
 *   JIRA_BASE_URL    e.g. https://yourorg.atlassian.net
 *   JIRA_USER_EMAIL  Atlassian account email
 *   JIRA_API_TOKEN   API token (never sent to client)
 *
 * Routes:
 *   GET  /api/jira/projects        — list accessible projects
 *   POST /api/jira/tickets         — create a new issue
 *   GET  /api/jira/tickets/:key    — get issue status
 */
import express from 'express'
import axios from 'axios'
import { requireAuth } from '../auth.js'

export const jiraRouter = express.Router()
jiraRouter.use(requireAuth)

/* ─── credential check middleware ────────────────────────────────────────── */
function requireJiraConfig(req, res, next) {
  const { JIRA_BASE_URL, JIRA_USER_EMAIL, JIRA_API_TOKEN } = process.env
  if (!JIRA_BASE_URL || !JIRA_USER_EMAIL || !JIRA_API_TOKEN) {
    return res.status(503).json({
      error: 'Jira integration not configured. Set JIRA_BASE_URL, JIRA_USER_EMAIL, and JIRA_API_TOKEN in your .env file.',
    })
  }
  next()
}

jiraRouter.use(requireJiraConfig)

/* ─── axios client factory ───────────────────────────────────────────────── */
function jiraClient() {
  const { JIRA_BASE_URL, JIRA_USER_EMAIL, JIRA_API_TOKEN } = process.env
  const token = Buffer.from(`${JIRA_USER_EMAIL}:${JIRA_API_TOKEN}`).toString('base64')
  return axios.create({
    baseURL: `${JIRA_BASE_URL.replace(/\/$/, '')}/rest/api/3`,
    headers: {
      Authorization: `Basic ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    timeout: 10000,
  })
}

/* ─── error normalizer ───────────────────────────────────────────────────── */
function handleJiraError(err, res) {
  console.error('[jira]', err?.response?.data || err.message)
  const status = err?.response?.status
  if (status === 401) return res.status(401).json({ error: 'Authentication failed — check Jira credentials.' })
  if (status === 403) return res.status(403).json({ error: 'Forbidden — your Jira account lacks permission for this action.' })
  if (status === 404) return res.status(404).json({ error: 'Resource not found in Jira.' })
  if (err.code === 'ECONNABORTED') return res.status(504).json({ error: 'Jira request timed out — try again.' })
  const msg = err?.response?.data?.errorMessages?.[0]
    || err?.response?.data?.errors && Object.values(err.response.data.errors)[0]
    || err.message
  return res.status(500).json({ error: msg || 'Unexpected Jira error.' })
}

/* ─── GET /api/jira/projects ─────────────────────────────────────────────── */
jiraRouter.get('/projects', async (req, res) => {
  try {
    const client = jiraClient()
    const { data } = await client.get('/project/search', {
      params: { maxResults: 100, orderBy: 'name', expand: 'description' },
    })
    const projects = (data.values || []).map((p) => ({
      id: p.id,
      key: p.key,
      name: p.name,
    }))
    res.json(projects)
  } catch (err) {
    handleJiraError(err, res)
  }
})

/* ─── POST /api/jira/tickets ─────────────────────────────────────────────── */
jiraRouter.post('/tickets', async (req, res) => {
  const { projectKey, summary, description, priority, issueType } = req.body || {}

  if (!projectKey || !summary) {
    return res.status(400).json({ error: 'projectKey and summary are required.' })
  }

  try {
    const client = jiraClient()

    // Convert plain-text description to Jira's Atlassian Document Format (ADF)
    const adfDescription = description
      ? {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: description }],
            },
          ],
        }
      : undefined

    const payload = {
      fields: {
        project: { key: projectKey },
        summary,
        issuetype: { name: issueType || 'Task' },
        ...(adfDescription && { description: adfDescription }),
        ...(priority && { priority: { name: priority } }),
      },
    }

    const { data } = await client.post('/issue', payload)
    const baseUrl = process.env.JIRA_BASE_URL.replace(/\/$/, '')
    res.json({
      key: data.key,
      url: `${baseUrl}/browse/${data.key}`,
    })
  } catch (err) {
    handleJiraError(err, res)
  }
})

/* ─── GET /api/jira/tickets/:key ─────────────────────────────────────────── */
jiraRouter.get('/tickets/:key', async (req, res) => {
  try {
    const client = jiraClient()
    const { data } = await client.get(`/issue/${req.params.key}`, {
      params: { fields: 'summary,status,priority,assignee' },
    })
    res.json({
      key: data.key,
      summary: data.fields.summary,
      status: data.fields.status?.name,
      statusCategory: data.fields.status?.statusCategory?.key,
      priority: data.fields.priority?.name,
      assignee: data.fields.assignee?.displayName || null,
      url: `${process.env.JIRA_BASE_URL.replace(/\/$/, '')}/browse/${data.key}`,
    })
  } catch (err) {
    handleJiraError(err, res)
  }
})
