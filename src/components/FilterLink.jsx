// Filter-preserving <Link> / <NavLink>.
//
// See lib/nav.js for the rationale and the imperative useFilterNavigate()
// counterpart. Use these for ALL in-app navigation so the filter bar (analyst,
// date range, compare — held in the URL search params) survives screen
// changes. External links (<a href> to Jira, etc.) must NOT use these.

import { Link, NavLink, useLocation } from "react-router-dom"
import { mergeTo } from "../lib/nav.js"

export function FilterLink({ to, ...rest }) {
  const { search } = useLocation()
  return <Link to={mergeTo(to, search)} {...rest} />
}

export function FilterNavLink({ to, ...rest }) {
  const { search } = useLocation()
  return <NavLink to={mergeTo(to, search)} {...rest} />
}
