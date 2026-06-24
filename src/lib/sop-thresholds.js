// SOP thresholds for the Update Queue. Edit values here when the SOP changes;
// queries and UI read them via imports, no magic numbers elsewhere.

export const WARN_FRACTION = 0.75

// Development cases — classified by ServiceNow `state` containing any of:
export const DEV_STATUS_MARKERS = [
  'development researching',
  'code fix pending',
  'code deployment pending',
]

// Dev hard rule: >30 days since last Infor comment = compliance breach.
export const DEV_HARD_RULE_MS = 30 * 24 * 60 * 60 * 1000

// Dev soft rule: >7 days = "Jira check recommended" nudge (not a breach).
export const DEV_JIRA_CHECK_MS = 7 * 24 * 60 * 60 * 1000

// Support cases — required update cadence by priority rank (1..4).
export const SUPPORT_THRESHOLDS_MS = {
  1: 60 * 60 * 1000,           // P1 Critical: 1h
  2: 24 * 60 * 60 * 1000,      // P2 Major:    1d
  3: 3 * 24 * 60 * 60 * 1000,  // P3 Medium:   3d
  4: 7 * 24 * 60 * 60 * 1000,  // P4 Standard: 7d
}

// One-time first-response targets by priority rank.
export const INITIAL_RESPONSE_MS = {
  1: 30 * 60 * 1000,           // P1: 30m
  2: 2 * 60 * 60 * 1000,       // P2: 2h
  3: 2 * 60 * 60 * 1000,       // P3: 2h
  4: 4 * 60 * 60 * 1000,       // P4: 4h
}

// Auto-close horizon for Solution Proposed (State="Resolved") cases. ServiceNow
// auto-closes a Resolved case 90 days after its last update if the customer
// never confirms. We model that countdown from the case's last journal activity
// against the data-as-of snapshot (see `_autoCloseAt` in enrich.js and
// getSolutionProposedAutoClose in queries.js). Resolved cases NO LONGER owe a
// recurring SOP cadence update (their SLA cadence clock stops at the last
// update — see computeSlaSop); this is the clock that replaces it.
export const SOLUTION_PROPOSED_AUTOCLOSE_MS = 90 * 24 * 60 * 60 * 1000
