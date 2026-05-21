import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { dbClient } from './lib/db-client.js'

// Phase 1: boot the DuckDB worker at app start so the smoke-test handle is
// ready by the time the console opens. Errors here are non-fatal and only
// affect the future (Phase 2+) data layer; the existing UI keeps working.
dbClient.init().catch((err) => {
  console.error('[db] init failed', err)
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
