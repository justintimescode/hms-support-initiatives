// Tiny hook over `dbClient.query`. Fires `fn` on mount and whenever `deps`
// change, with cancellation so a fast-firing filter doesn't race itself
// into stale state. `enabled=false` short-circuits — useful before
// DuckDB is loaded.

import { useEffect, useState } from 'react'

export function useQuery(fn, deps, { enabled = true } = {}) {
  const [state, setState] = useState({
    data: null,
    loading: enabled,
    error: null,
  })

  useEffect(() => {
    if (!enabled) {
      setState({ data: null, loading: false, error: null })
      return
    }
    let cancelled = false
    setState((s) => ({ data: s.data, loading: true, error: null }))
    Promise.resolve()
      .then(fn)
      .then((data) => {
        if (!cancelled) setState({ data, loading: false, error: null })
      })
      .catch((error) => {
        if (!cancelled) setState({ data: null, loading: false, error })
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps])

  return state
}
