# ServiceNow Live Analytics

A React/Vite web app that pulls live case data from ServiceNow and renders the same KPI dashboards as the CSV-based analyzer — but in real time, with no file uploads.

## Architecture

```
Browser (React + Vite :5173)
        ↕ fetch /api/*
Express server (:3000)  ──→  ServiceNow Table API
  - holds credentials          (infor.service-now.com)
  - proxies all requests
  - serves AI insights via Anthropic
```

Credentials never reach the browser. The Express server holds them in a server-side session.

## Quick start

### 1. Install dependencies

```bash
cd servicenow-live-analytics
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
SN_INSTANCE=https://infor.service-now.com
SN_AUTH_MODE=basic
SN_USER=your_username@infor.com
SN_PASSWORD=your_password_here
SESSION_SECRET=any-long-random-string
ANTHROPIC_API_KEY=sk-ant-...   # optional, enables AI Insights tab
PORT=3000
```

### 3. Run

```bash
npm run dev
```

Opens the Express API on `http://localhost:3000` and Vite on `http://localhost:5173`.

Sign in with your ServiceNow credentials on the login screen. The app fetches cases directly from the ServiceNow Table API.

## Auth modes

**Basic auth** (`SN_AUTH_MODE=basic`) — default. Uses username + password from `.env` or the login form. Simplest for local dev.

**OAuth 2.0** (`SN_AUTH_MODE=oauth`) — requires an OAuth Application Registry record in ServiceNow:
- System OAuth → Application Registry → New → "Create an OAuth API endpoint for external clients"
- Redirect URL: `http://localhost:3000/auth/callback`
- Copy Client ID and Client Secret into `.env`

## Features

- **Overview** — headline KPIs (total, open, closed, SLA rate, avg resolution, avg FRT, at-risk, breached), case categories, top accounts
- **SLA** — radial hit-rate gauge, resolution time p50/p90 by priority, SLA risk segments, breached case list
- **Trends** — daily open-case trajectory, weekly intake vs. resolved with rolling 4-week net, open case aging buckets
- **Priority** — volume pie chart and resolution time bar chart by priority level
- **Team** — per-analyst leaderboard (total, open, SLA%, avg resolution, breached count); click any analyst to drill in
- **Jira Blockers** — open cases with active Jira tickets parsed from work notes and cause fields
- **AI Insights** — Claude-powered qualitative analysis of themes, gaps, and things to watch (requires `ANTHROPIC_API_KEY`)
- **Cases** — full sortable/searchable case register

All filters (date range, analyst, compare mode, active tab) are reflected in the URL for bookmarking.

## ServiceNow table

The app queries `sn_customerservice_case` by default. To use a different table (e.g. `incident`), pass `?table=incident` on any API call, or update the default in `server/api.js`.

## Scripts

```bash
npm run dev          # start both servers concurrently
npm run dev:server   # Express only (with --watch)
npm run dev:client   # Vite only
npm run build        # production build of the React app
npm run lint         # ESLint
```
