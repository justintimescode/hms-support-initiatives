import 'dotenv/config'
import express from 'express'
import session from 'express-session'
import cors from 'cors'
import { authRouter } from './auth.js'
import { apiRouter } from './api.js'
import { jiraRouter } from './routes/jira.js'

const app = express()
const PORT = process.env.PORT || 3000

app.use(express.json())
app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true,
}))
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // set true in production behind HTTPS
    httpOnly: true,
    maxAge: 8 * 60 * 60 * 1000, // 8 hours
  },
}))

// Auth routes: /auth/login, /auth/callback, /auth/logout, /auth/me
app.use('/auth', authRouter)

// API routes: /api/cases, /api/analysts, etc.
// All routes require a valid session token.
app.use('/api', apiRouter)

// Jira proxy routes: /api/jira/projects, /api/jira/tickets, etc.
app.use('/api/jira', jiraRouter)

// Root redirect — the UI is served by Vite on :5173, not this server.
app.get('/', (req, res) => res.redirect('http://localhost:5173'))

app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`)
  console.log(`[server] ServiceNow instance: ${process.env.SN_INSTANCE}`)
})
