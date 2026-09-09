import { T } from "../lib/theme.js";

/** The ServiceNow-internal `RN-` refs that resolved onto a Jira key.
 *
 * Shown because resolving them makes them DISAPPEAR from the ticket list: one
 * defect is now one row, so an analyst who found "Jira Reference ID RN-9732370"
 * in a case's work notes would otherwise search this page for it and conclude
 * the case is missing. It is not a second ticket — hence a subdued suffix on the
 * real key rather than a row of its own. Shared by every surface that prints a
 * key, so the wording cannot drift between them. See `buildAliasMap`. */
export function AliasNote({ keys }) {
  const list = keys || [];
  if (!list.length) return null;
  const label = list.join(", ");
  return (
    <span
      style={{ color: T.muted, fontWeight: 400, fontSize: 11, whiteSpace: "nowrap" }}
      title={`Also tracked in ServiceNow as ${label} — the same ticket recorded from the ServiceNow side, not a separate one`}
    >
      {" · "}{label}
    </span>
  );
}
