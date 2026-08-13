// Single source of truth for filter state, persisted in the URL search
// params via react-router. Replaces the previous parseUrlFilters /
// writeUrlFilters pair in stats.js. Closes SECURITY_CONCERNS.md #3 by
// serializing the analyst as an opaque index token (e.g. `?a=a4`) instead
// of a raw name.

import { useCallback, useMemo } from "react"
import { useSearchParams } from "react-router-dom"
import { isoFromMs, msFromIso } from "./format.js"
import { matchPreset } from "./stats.js"

const TOKEN_RE = /^a(\d+)$/
const MANAGER_TOKEN_RE = /^m(\d+)$/

/**
 * @param {object} [opts]
 * @param {string[]} [opts.analystNames] raw analyst names from the loaded
 *   dataset. Used to build a stable alphabetical ordering for opaque
 *   token <-> name resolution. Pass an empty array (default) when no
 *   data is loaded — incoming `?a=…` URLs gracefully fall back to
 *   `__all__`.
 * @param {string[]} [opts.managerNames] raw manager names from the loaded
 *   dataset — same opaque-token treatment as `analystNames`, under `?m=…`.
 * @returns {{
 *   analyst: string,                                  // '__all__' or a resolved name
 *   setAnalyst: (name: string|null) => void,
 *   manager: string,                                  // '__all__' or a resolved name
 *   setManager: (name: string|null) => void,
 *   dateRange: { preset: string, from: number|null, to: number|null, field: string },
 *   setDateRange: (range: { from?: number|null, to?: number|null, field?: string }) => void,
 *   compareOn: boolean,
 *   setCompareOn: (on: boolean) => void,
 *   buildFilterSearch: (overrides?: { analyst?: string|null, manager?: string|null }) => string,
 * }}
 */
export function useFilters({ analystNames = [], managerNames = [] } = {}) {
  const [params, setParams] = useSearchParams()

  // Stable alphabetical ordering. The index in this array is the token
  // payload. Sorting is locale-aware so we get consistent results across
  // browsers.
  const sortedNames = useMemo(
    () => [...analystNames].sort((a, b) => String(a).localeCompare(String(b))),
    [analystNames],
  )
  const sortedManagers = useMemo(
    () => [...managerNames].sort((a, b) => String(a).localeCompare(String(b))),
    [managerNames],
  )

  /* ---------- analyst (opaque token ↔ name) ---------- */
  // SECURITY #8: user-controlled input. `?a=` comes from the URL and is
  // attacker-influenceable. It is NOT used in any query directly — it only
  // indexes into `sortedNames` (names derived from the loaded dataset), so the
  // resolved `analyst` is always either '__all__' or a real known name. Every
  // DB query then passes it as a parameterized value (queries.js buildWhere:
  // `assigned_to = ?`). If you ever interpolate `analyst` into SQL/HTML
  // instead of parameterizing it, this becomes an injection vector — don't.
  const tokenParam = params.get("a")
  const analyst = useMemo(() => {
    if (!tokenParam) return "__all__"
    const m = tokenParam.match(TOKEN_RE)
    if (!m) return "__all__"
    const idx = parseInt(m[1], 10)
    return sortedNames[idx] || "__all__"
  }, [tokenParam, sortedNames])

  const setAnalyst = useCallback(
    (name) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (!name || name === "__all__") {
            next.delete("a")
          } else {
            const idx = sortedNames.indexOf(name)
            if (idx < 0) next.delete("a")
            else next.set("a", `a${idx}`)
          }
          return next
        },
        { replace: true },
      )
    },
    [setParams, sortedNames],
  )

  /* ---------- manager (opaque token ↔ name) ---------- */
  // Same SECURITY #8 treatment as the analyst: `?m=` only indexes into
  // `sortedManagers` (names derived from the loaded dataset), so the resolved
  // `manager` is always '__all__' or a real known name, and every consumer
  // passes it as a parameterized value (queries.js buildWhere: `manager = ?`).
  const managerTokenParam = params.get("m")
  const manager = useMemo(() => {
    if (!managerTokenParam) return "__all__"
    const m = managerTokenParam.match(MANAGER_TOKEN_RE)
    if (!m) return "__all__"
    const idx = parseInt(m[1], 10)
    return sortedManagers[idx] || "__all__"
  }, [managerTokenParam, sortedManagers])

  const setManager = useCallback(
    (name) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          // A manager change swaps the analyst roster underneath the analyst
          // filter, so the analyst selection is cleared alongside — you land on
          // "All analysts" of the newly picked team.
          next.delete("a")
          if (!name || name === "__all__") {
            next.delete("m")
          } else {
            const idx = sortedManagers.indexOf(name)
            if (idx < 0) next.delete("m")
            else next.set("m", `m${idx}`)
          }
          return next
        },
        { replace: true },
      )
    },
    [setParams, sortedManagers],
  )

  /* ---------- date range ---------- */
  const fromParam = params.get("from")
  const toParam = params.get("to")
  const fieldParam = params.get("field")
  const dateRange = useMemo(() => {
    const from = msFromIso(fromParam, false)
    const to = msFromIso(toParam, true)
    const field = fieldParam === "closed" ? "_closed" : "_created"
    return { preset: matchPreset(from, to), from, to, field }
  }, [fromParam, toParam, fieldParam])

  const setDateRange = useCallback(
    (next) => {
      setParams(
        (prev) => {
          const out = new URLSearchParams(prev)
          if (next.from != null) out.set("from", isoFromMs(next.from))
          else out.delete("from")
          if (next.to != null) out.set("to", isoFromMs(next.to))
          else out.delete("to")
          if (next.field === "_closed") out.set("field", "closed")
          else out.delete("field")
          return out
        },
        { replace: true },
      )
    },
    [setParams],
  )

  /* ---------- compare-on ---------- */
  const compareOn = params.get("compare") === "1"
  const setCompareOn = useCallback(
    (on) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (on) next.set("compare", "1")
          else next.delete("compare")
          return next
        },
        { replace: true },
      )
    },
    [setParams],
  )

  /* ---------- search builder ---------- */
  // Build a `?…` search string from the *current* params with optional
  // overrides applied. For callers that change a filter and navigate in the
  // same action (e.g. drilling into an analyst from the team view), where
  // reading the post-update location would be stale. The analyst override
  // mirrors setAnalyst's opaque-token logic exactly (SECURITY #3/#8).
  const buildFilterSearch = useCallback(
    (overrides = {}) => {
      const next = new URLSearchParams(params)
      if ("analyst" in overrides) {
        const name = overrides.analyst
        if (!name || name === "__all__") {
          next.delete("a")
        } else {
          const idx = sortedNames.indexOf(name)
          if (idx < 0) next.delete("a")
          else next.set("a", `a${idx}`)
        }
      }
      if ("manager" in overrides) {
        const name = overrides.manager
        if (!name || name === "__all__") {
          next.delete("m")
        } else {
          const idx = sortedManagers.indexOf(name)
          if (idx < 0) next.delete("m")
          else next.set("m", `m${idx}`)
        }
      }
      const s = next.toString()
      return s ? `?${s}` : ""
    },
    [params, sortedNames, sortedManagers],
  )

  return {
    analyst, setAnalyst, manager, setManager,
    dateRange, setDateRange, compareOn, setCompareOn, buildFilterSearch,
  }
}
