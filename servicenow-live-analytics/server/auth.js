/**
 * Auth module — supports two modes controlled by SN_AUTH_MODE env var:
 *
 *   basic  (default) — username + password stored in .env, no browser redirect.
 *                      POST /auth/login with { username, password } or use the
 *                      env credentials directly. Simplest for local dev.
 *
 *   oauth             — OAuth 2.0 Authorization Code flow. Requires an OAuth
 *                      Application Registry record in ServiceNow.
 */
import express from 'express'
import axios from 'axios'

export const authRouter = express.Router()

const SN           = process.env.SN_INSTANCE
const AUTH_MODE    = (process.env.SN_AUTH_MODE || 'basic').toLowerCase()
const CLIENT_ID    = process.env.SN_CLIENT_ID
const CLIENT_SECRET = process.env.SN_CLIENT_SECRET
const REDIRECT_URI = process.env.SN_REDIRECT_URI || 'http://localhost:3000/auth/callback'

/* ─── Basic auth ─────────────────────────────────────────────────────────── */

if (AUTH_MODE === 'basic') {
  /**
   * GET /auth/login — for basic mode, just mark the session as authenticated
   * using the env credentials. Redirects back to the app.
   */
  authRouter.get('/login', (req, res) => {
    const user = process.env.SN_USER
    const pass = process.env.SN_PASSWORD
    if (!user || !pass) {
      return res.status(500).send('SN_USER and SN_PASSWORD must be set in .env for basic auth mode.')
    }
    req.session.basicAuth = Buffer.from(`${user}:${pass}`).toString('base64')
    req.session.authenticated = true
    res.redirect('http://localhost:5173')
  })

  /**
   * POST /auth/login — JSON body { username, password } for programmatic login.
   */
  authRouter.post('/login', (req, res) => {
    const { username, password } = req.body || {}
    const user = username || process.env.SN_USER
    const pass = password || process.env.SN_PASSWORD
    if (!user || !pass) return res.status(400).json({ error: 'Missing credentials' })
    req.session.basicAuth = Buffer.from(`${user}:${pass}`).toString('base64')
    req.session.authenticated = true
    res.json({ ok: true })
  })
}

/* ─── OAuth flow ─────────────────────────────────────────────────────────── */

if (AUTH_MODE === 'oauth') {
  authRouter.get('/login', (req, res) => {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
    })
    res.redirect(`${SN}/oauth_auth.do?${params}`)
  })

  authRouter.get('/callback', async (req, res) => {
    const { code } = req.query
    if (!code) return res.status(400).send('Missing authorization code')
    try {
      const { data } = await axios.post(
        `${SN}/oauth_token.do`,
        new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: REDIRECT_URI,
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
        }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      )
      req.session.token = {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: Date.now() + data.expires_in * 1000,
      }
      req.session.authenticated = true
      res.redirect('http://localhost:5173')
    } catch (err) {
      console.error('[auth] token exchange failed', err?.response?.data || err.message)
      res.status(500).send('OAuth token exchange failed')
    }
  })
}

/* ─── Shared ─────────────────────────────────────────────────────────────── */

authRouter.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }))
})

authRouter.get('/me', (req, res) => {
  if (!req.session?.authenticated) {
    return res.status(401).json({ authenticated: false })
  }
  res.json({
    authenticated: true,
    mode: AUTH_MODE,
    expires_at: req.session.token?.expires_at ?? null,
  })
})

/**
 * Middleware: ensure the session is authenticated.
 * For basic mode: attaches the Authorization header to the axios client.
 * For OAuth mode: refreshes the token if near expiry.
 */
export async function requireAuth(req, res, next) {
  if (!req.session?.authenticated) {
    return res.status(401).json({ error: 'not_authenticated' })
  }

  if (AUTH_MODE === 'oauth' && req.session.token) {
    if (Date.now() > req.session.token.expires_at - 5 * 60 * 1000) {
      try {
        const { data } = await axios.post(
          `${SN}/oauth_token.do`,
          new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: req.session.token.refresh_token,
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
          }),
          { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        )
        req.session.token = {
          access_token: data.access_token,
          refresh_token: data.refresh_token || req.session.token.refresh_token,
          expires_at: Date.now() + data.expires_in * 1000,
        }
      } catch (err) {
        console.error('[auth] refresh failed', err?.response?.data || err.message)
        req.session.destroy(() => {})
        return res.status(401).json({ error: 'token_expired' })
      }
    }
  }

  next()
}

/**
 * Build an axios instance pre-configured for the current auth mode.
 */
export function snClient(req) {
  const headers = { Accept: 'application/json' }

  if (AUTH_MODE === 'basic') {
    headers.Authorization = `Basic ${req.session.basicAuth}`
  } else {
    headers.Authorization = `Bearer ${req.session.token.access_token}`
  }

  return axios.create({ baseURL: SN, headers })
}
