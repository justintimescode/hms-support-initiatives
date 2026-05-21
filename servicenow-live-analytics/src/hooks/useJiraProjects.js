import { useState, useEffect } from 'react'

/**
 * Fetches and caches the list of Jira projects for the current session.
 * Returns { projects, loading, error }.
 */
export function useJiraProjects() {
  const [projects, setProjects] = useState([])
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    fetch('/api/jira/projects', { credentials: 'include' })
      .then((r) => {
        if (!r.ok) return r.json().then((d) => Promise.reject(new Error(d.error || `HTTP ${r.status}`)))
        return r.json()
      })
      .then((data) => {
        if (!cancelled) setProjects(data)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [])

  return { projects, loading, error }
}
