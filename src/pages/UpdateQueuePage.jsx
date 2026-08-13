import { useOutletContext } from "react-router-dom"
import { UpdateQueue } from "./UpdateQueue.jsx"

/* Route-level wrapper around the existing UpdateQueue component, pulling
 * its props from the AppLayout outlet context. */
export default function UpdateQueuePage() {
  const { analyst, manager, snapshotMs, dbReady } = useOutletContext()
  return <UpdateQueue analyst={analyst} manager={manager} snapshotMs={snapshotMs} dbReady={dbReady} />
}
