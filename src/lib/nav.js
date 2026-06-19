// Filter-preserving navigation helpers.
//
// Filter state (selected analyst, date range, "by Created/Closed", compare)
// lives in the URL search params — see useFilters.js. A bare navigate("/sla")
// carries only the pathname, so the query string is dropped and every filter
// snaps back to its default the moment the user changes screens. In-app
// navigation must re-attach the current search so the filter bar stays put.
//
// `mergeTo` is the shared core; `useFilterNavigate` is the imperative form.
// The declarative <Link>/<NavLink> wrappers live in components/FilterLink.jsx
// (kept separate so that file only exports components — react-refresh rule).

import { useCallback } from "react"
import { useLocation, useNavigate } from "react-router-dom"

// Attach `search` to a navigation target. A target that already carries its
// own explicit query — "/cases?foo=1" (string form) or { search } (object
// form) — wins untouched: an intentional query is never clobbered.
export function mergeTo(to, search) {
  if (typeof to === "string") {
    if (to.includes("?")) return to
    return { pathname: to, search }
  }
  if (to && typeof to === "object") {
    if (to.search != null) return to
    return { ...to, search }
  }
  return to
}

// navigate() that preserves the current search. Numeric deltas (navigate(-1)
// for back/forward) pass straight through.
export function useFilterNavigate() {
  const navigate = useNavigate()
  const { search } = useLocation()
  return useCallback(
    (to, options) => {
      if (typeof to === "number") return navigate(to, options)
      return navigate(mergeTo(to, search), options)
    },
    [navigate, search],
  )
}
