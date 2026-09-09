// Single source of truth for filter state, persisted in the URL search
// params via react-router. Replaces the previous parseUrlFilters /
// writeUrlFilters pair in stats.js. Closes SECURITY_CONCERNS.md #3 by
// serializing every entity filter as opaque index tokens (e.g. `?a=a4`)
// instead of raw names.
//
// MULTI-SELECT (v2). The analyst and manager filters, plus the new
// product / region / priority filters, are now *sets* of selections rather
// than a single value. Each is serialized as a dot-joined list of opaque
// index tokens — e.g. `?a=a1.a4.a7`, `?m=m2`, `?prod=p0.p3`. An empty /
// absent param means "all" (no filter).
//
// BACKWARD COMPATIBILITY. Much of the app (queries.js buildWhere, the
// Monthly Summary report, My Day, the per-dimension pages, drill-in nav)
// still reasons about a *single* `analyst` / `manager` string that is either
// '__all__' or one resolved name. Those scalars are DERIVED here from the
// arrays: when exactly one entry is selected the scalar is that name; with
// zero or 2+ selected it collapses to '__all__'. This lets the dashboard
// offer true multi-select without rewriting every single-value consumer,
// while the in-memory dashboard pipeline reads the full arrays.

import { useCallback, useMemo } from "react"
import { useSearchParams } from "react-router-dom"
import { isoFromMs, msFromIso } from "./format.js"
import { matchPreset } from "./stats.js"

// A token is `<prefix><index>`; a param carries one or more joined by ".".
const TOKEN_SEP = "."

/** Parse a dot-joined token param (e.g. "a1.a4") into the resolved names it
 *  points at, in the order they appear in `sorted`. Unknown / malformed
 *  indices are dropped (SECURITY #8: the token only ever indexes into names
 *  derived from the loaded dataset, so the result is always a subset of real
 *  known names). Deduped, preserving first-seen order. */
function resolveTokens(raw, prefix, sorted) {
  if (!raw) return []
  const re = new RegExp(`^${prefix}(\\d+)$`)
  const out = []
  const seen = new Set()
  for (const tok of raw.split(TOKEN_SEP)) {
    const m = tok.match(re)
    if (!m) continue
    const idx = parseInt(m[1], 10)
    const name = sorted[idx]
    if (name == null || seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}

/** Serialize a list of names to a dot-joined token param, dropping names not
 *  present in `sorted`. Returns "" when nothing resolves (caller deletes the
 *  param). Indices are emitted in `sorted` order for a stable URL. */
function serializeTokens(names, prefix, sorted) {
  if (!names || names.length === 0) return ""
  const idxs = []
  const seen = new Set()
  for (const name of names) {
    const idx = sorted.indexOf(name)
    if (idx < 0 || seen.has(idx)) continue
    seen.add(idx)
    idxs.push(idx)
  }
  idxs.sort((a, b) => a - b)
  return idxs.map((i) => `${prefix}${i}`).join(TOKEN_SEP)
}

/** Collapse a multi-select array to the legacy single-value scalar: the sole
 *  selection when exactly one is picked, otherwise '__all__'. */
function scalarOf(names) {
  return names.length === 1 ? names[0] : "__all__"
}

/**
 * @param {object} [opts]
 * @param {string[]} [opts.analystNames] raw analyst names from the loaded
 *   dataset. Used to build a stable alphabetical ordering for opaque
 *   token <-> name resolution.
 * @param {string[]} [opts.managerNames] raw manager names from the loaded
 *   dataset — same opaque-token treatment, under `?m=…`.
 * @param {string[]} [opts.productNames] raw product-line names — `?prod=…`.
 * @param {string[]} [opts.regionNames] raw region names — `?region=…`.
 * @param {string[]} [opts.priorityNames] raw priority names — `?prio=…`.
 * @returns {{
 *   analyst: string, analysts: string[], setAnalyst: (name:string|null)=>void,
 *     setAnalysts:(names:string[])=>void, toggleAnalyst:(name:string)=>void,
 *   manager: string, managers: string[], setManager:(name:string|null)=>void,
 *     setManagers:(names:string[])=>void, toggleManager:(name:string)=>void,
 *   products: string[], setProducts:(names:string[])=>void, toggleProduct:(name:string)=>void,
 *   regions: string[], setRegions:(names:string[])=>void, toggleRegion:(name:string)=>void,
 *   priorities: string[], setPriorities:(names:string[])=>void, togglePriority:(name:string)=>void,
 *   dateRange: { preset:string, from:number|null, to:number|null, field:string },
 *   setDateRange: (range:{from?:number|null,to?:number|null,field?:string})=>void,
 *   compareOn: boolean, setCompareOn:(on:boolean)=>void,
 *   clearEntityFilters: () => void,
 *   buildFilterSearch: (overrides?: object) => string,
 * }}
 */
export function useFilters({
  analystNames = [],
  managerNames = [],
  productNames = [],
  regionNames = [],
  priorityNames = [],
} = {}) {
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
  const sortedProducts = useMemo(
    () => [...productNames].sort((a, b) => String(a).localeCompare(String(b))),
    [productNames],
  )
  const sortedRegions = useMemo(
    () => [...regionNames].sort((a, b) => String(a).localeCompare(String(b))),
    [regionNames],
  )
  // Priorities have a meaningful natural (severity) order supplied by the
  // caller; keep it as given rather than sorting alphabetically so the
  // dropdown reads Critical → Major → … The index resolver only needs the
  // list to be stable, not sorted.
  const sortedPriorities = useMemo(() => [...priorityNames], [priorityNames])

  /* ---------- entity multi-selects (opaque tokens ↔ names) ----------
   * SECURITY #8: every one of these params is user-controlled (comes from the
   * URL). None is used in any query directly — each only indexes into a name
   * list derived from the loaded dataset, so a resolved value is always a
   * subset of real known names. Every DB query then passes those names as
   * parameterized values (queries.js buildWhere). Never interpolate them into
   * SQL/HTML — that would reintroduce an injection vector. */
  const analysts = useMemo(
    () => resolveTokens(params.get("a"), "a", sortedNames),
    [params, sortedNames],
  )
  const managers = useMemo(
    () => resolveTokens(params.get("m"), "m", sortedManagers),
    [params, sortedManagers],
  )
  const products = useMemo(
    () => resolveTokens(params.get("prod"), "p", sortedProducts),
    [params, sortedProducts],
  )
  const regions = useMemo(
    () => resolveTokens(params.get("region"), "r", sortedRegions),
    [params, sortedRegions],
  )
  const priorities = useMemo(
    () => resolveTokens(params.get("prio"), "q", sortedPriorities),
    [params, sortedPriorities],
  )

  // Legacy single-value scalars derived from the arrays (see header note).
  const analyst = useMemo(() => scalarOf(analysts), [analysts])
  const manager = useMemo(() => scalarOf(managers), [managers])

  /* ---------- setters ---------- */
  const setAnalysts = useCallback(
    (names) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          const tok = serializeTokens(names, "a", sortedNames)
          if (tok) next.set("a", tok)
          else next.delete("a")
          return next
        },
        { replace: true },
      )
    },
    [setParams, sortedNames],
  )

  const setManagers = useCallback(
    (names) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          // A manager change swaps the analyst roster underneath the analyst
          // filter, so any analyst selection is cleared alongside — you land
          // on "All analysts" of the newly picked team(s).
          next.delete("a")
          const tok = serializeTokens(names, "m", sortedManagers)
          if (tok) next.set("m", tok)
          else next.delete("m")
          return next
        },
        { replace: true },
      )
    },
    [setParams, sortedManagers],
  )

  const setProducts = useCallback(
    (names) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          const tok = serializeTokens(names, "p", sortedProducts)
          if (tok) next.set("prod", tok)
          else next.delete("prod")
          return next
        },
        { replace: true },
      )
    },
    [setParams, sortedProducts],
  )

  const setRegions = useCallback(
    (names) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          const tok = serializeTokens(names, "r", sortedRegions)
          if (tok) next.set("region", tok)
          else next.delete("region")
          return next
        },
        { replace: true },
      )
    },
    [setParams, sortedRegions],
  )

  const setPriorities = useCallback(
    (names) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          const tok = serializeTokens(names, "q", sortedPriorities)
          if (tok) next.set("prio", tok)
          else next.delete("prio")
          return next
        },
        { replace: true },
      )
    },
    [setParams, sortedPriorities],
  )

  // Single-value setters kept for existing callers (My Day's analyst picker,
  // team-view drill-in). '__all__'/null clears; a name selects only that one.
  const setAnalyst = useCallback(
    (name) => setAnalysts(!name || name === "__all__" ? [] : [name]),
    [setAnalysts],
  )
  const setManager = useCallback(
    (name) => setManagers(!name || name === "__all__" ? [] : [name]),
    [setManagers],
  )

  // Toggle one value in a multi-select (add if absent, remove if present).
  const makeToggle = (list, setList) => (name) => {
    if (name == null) return
    setList(list.includes(name) ? list.filter((n) => n !== name) : [...list, name])
  }
  const toggleAnalyst = useCallback(makeToggle(analysts, setAnalysts), [analysts, setAnalysts])
  const toggleManager = useCallback(makeToggle(managers, setManagers), [managers, setManagers])
  const toggleProduct = useCallback(makeToggle(products, setProducts), [products, setProducts])
  const toggleRegion = useCallback(makeToggle(regions, setRegions), [regions, setRegions])
  const togglePriority = useCallback(makeToggle(priorities, setPriorities), [priorities, setPriorities])

  const clearEntityFilters = useCallback(() => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        for (const k of ["a", "m", "prod", "region", "prio"]) next.delete(k)
        return next
      },
      { replace: true },
    )
  }, [setParams])

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
  // reading the post-update location would be stale. Overrides accept a single
  // name string, an array of names, or '__all__'/null to clear. Mirrors the
  // setters' opaque-token logic exactly (SECURITY #3/#8).
  const buildFilterSearch = useCallback(
    (overrides = {}) => {
      const next = new URLSearchParams(params)
      const apply = (key, param, prefix, sorted) => {
        if (!(key in overrides)) return
        let val = overrides[key]
        if (val == null || val === "__all__") val = []
        else if (!Array.isArray(val)) val = [val]
        const tok = serializeTokens(val, prefix, sorted)
        if (tok) next.set(param, tok)
        else next.delete(param)
      }
      apply("analyst", "a", "a", sortedNames)
      apply("analysts", "a", "a", sortedNames)
      apply("manager", "m", "m", sortedManagers)
      apply("managers", "m", "m", sortedManagers)
      apply("products", "prod", "p", sortedProducts)
      apply("regions", "region", "r", sortedRegions)
      apply("priorities", "prio", "q", sortedPriorities)
      const s = next.toString()
      return s ? `?${s}` : ""
    },
    [params, sortedNames, sortedManagers, sortedProducts, sortedRegions, sortedPriorities],
  )

  return {
    // analyst: array is the source of truth; scalar derived for legacy consumers
    analyst, analysts, setAnalyst, setAnalysts, toggleAnalyst,
    manager, managers, setManager, setManagers, toggleManager,
    products, setProducts, toggleProduct,
    regions, setRegions, toggleRegion,
    priorities, setPriorities, togglePriority,
    clearEntityFilters,
    dateRange, setDateRange, compareOn, setCompareOn, buildFilterSearch,
  }
}
