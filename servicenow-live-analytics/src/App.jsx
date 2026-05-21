import { useEffect, useState } from 'react'
import KpiAnalyzer from './KpiAnalyzer.jsx'

const T = {
  bg: '#F3EEE5', surface: '#FBF8F2', ink: '#141311',
  sub: '#5C564A', border: '#D9D1BF', accent: '#B8452C',
  danger: '#A23220', dangerSoft: '#E7B8AD',
}

function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || `HTTP ${res.status}`)
      }
      onLogin()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const input = {
    width: '100%', padding: '9px 12px', fontSize: 14,
    border: `1px solid ${T.border}`, borderRadius: 6,
    background: T.surface, color: T.ink, outline: 'none',
    fontFamily: 'inherit',
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', background: T.bg, fontFamily: 'system-ui, sans-serif',
    }}>
      <div style={{
        background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12,
        padding: 36, width: '100%', maxWidth: 380, boxShadow: '0 4px 24px rgba(0,0,0,0.07)',
      }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: T.ink, margin: '0 0 4px' }}>
          ServiceNow Live Analytics
        </h1>
        <p style={{ fontSize: 13, color: T.sub, margin: '0 0 24px' }}>
          Sign in with your ServiceNow credentials.
        </p>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: T.sub, display: 'block', marginBottom: 4 }}>
              Username
            </label>
            <input
              type="text" value={username} onChange={(e) => setUsername(e.target.value)}
              placeholder="you@infor.com" required autoFocus style={input}
            />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: T.sub, display: 'block', marginBottom: 4 }}>
              Password
            </label>
            <input
              type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••" required style={input}
            />
          </div>

          {error && (
            <div style={{
              background: T.dangerSoft, color: T.danger, fontSize: 12,
              padding: '8px 12px', borderRadius: 6,
            }}>
              {error}
            </div>
          )}

          <button type="submit" disabled={loading} style={{
            marginTop: 4, padding: '10px', background: T.accent, color: '#fff',
            border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 600,
            cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1,
          }}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p style={{ fontSize: 11, color: T.sub, marginTop: 16, textAlign: 'center' }}>
          Credentials are stored in your local session only.
        </p>
      </div>
    </div>
  )
}

export default function App() {
  const [authState, setAuthState] = useState('loading')

  const checkAuth = () => {
    fetch('/auth/me', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setAuthState(d.authenticated ? 'authenticated' : 'unauthenticated'))
      .catch(() => setAuthState('unauthenticated'))
  }

  useEffect(() => { checkAuth() }, [])

  if (authState === 'loading') {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', background: T.bg, fontFamily: 'system-ui, sans-serif',
      }}>
        <p style={{ color: T.sub }}>Connecting…</p>
      </div>
    )
  }

  if (authState === 'unauthenticated') {
    return <LoginScreen onLogin={() => setAuthState('authenticated')} />
  }

  return <KpiAnalyzer />
}
