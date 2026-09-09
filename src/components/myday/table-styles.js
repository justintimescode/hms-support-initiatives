import { T } from "../../lib/theme.js"

/* My Day table cell styles and the per-section row cap. A plain module, not
 * shared.jsx, so the component file exports only components (Fast Refresh). */

export const TH = { textAlign: "left", padding: "8px 12px", color: T.sub, fontWeight: 600, borderBottom: `1px solid ${T.borderSoft}`, whiteSpace: "nowrap" }
export const TD = { padding: "8px 12px", whiteSpace: "nowrap" }
export const TD_DESC = { padding: "8px 12px", maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }

export const CAP = 8 // rows shown per section before "view all"
