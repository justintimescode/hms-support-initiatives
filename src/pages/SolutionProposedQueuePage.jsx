import { useOutletContext } from "react-router-dom"
import { UpdateQueue } from "./UpdateQueue.jsx"
import { SOLUTION_PROPOSED_STATUS } from "../lib/sop-thresholds.js"

/* Route-level wrapper that reuses the Update Queue cadence logic, scoped to
 * cases sitting in the `Solution Proposed` ServiceNow status. Same priority-SOP
 * thresholds, same snapshot anchoring; the Initial Response section is dropped
 * since first-response targets don't apply to already-proposed solutions.
 *
 * `includeClosed` is required here: a proposed solution moves the case to a
 * resolved `state` (clock-stop pending customer confirmation) while `status`
 * stays `Solution Proposed`, so the queue's default `NOT is_closed` filter
 * would otherwise hide every one of them. They still owe a cadence update. */
export default function SolutionProposedQueuePage() {
  const { analyst, snapshotMs, dbReady } = useOutletContext()
  return (
    <UpdateQueue
      analyst={analyst}
      snapshotMs={snapshotMs}
      dbReady={dbReady}
      statusEquals={SOLUTION_PROPOSED_STATUS}
      includeClosed
      title="Solution Proposed"
      subtitle="Cases in 'Solution Proposed' status (resolved pending customer confirmation) that are overdue — or coming due — for an Infor-authored customer-facing update, per the priority SOP cadence. Anchored to the data-as-of snapshot below."
      showInitialResponse={false}
      csvName="solution-proposed-update-que"
    />
  )
}
