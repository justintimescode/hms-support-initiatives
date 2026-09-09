import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { T } from "../lib/theme.js";
import { fmtDate, ageDays, priorityColor } from "../lib/format.js";
import { rowsToCsv, downloadCsv, csvTimestamp } from "../lib/csv-export.js";
import {
  ALL_CASES, OUTCOME_LABEL, classifyTag, parseTags, rowOutcome,
  filterByTagSelection, tagSelectionOptions, shortTagLabel,
} from "../lib/ai-tags.js";
import { OUTCOME_COLOR } from "../lib/ai-tag-colors.js";
import { Card } from "./layout/Card.jsx";
import { CopyableNumber } from "./CopyableNumber.jsx";
import { Pill } from "./Pill.jsx";

/* ============== AI tag case explorer (AI Assisted? tab) ==============
 * Pick a tag — or one of the synthetic views — and read the cases behind it.
 * Every option and its count comes from the rows handed in, so a tag ServiceNow
 * starts emitting appears here without a code change, and the count in the label
 * always equals the number of rows the list will show.
 *
 * The dropdown scopes only THIS card's table; the charts above are scoped by the
 * global filter bar. Same arrangement as the Sort select inside UpdateQueue's
 * QueueGroup — an in-card control that shapes one list, not the page.
 *
 * Selection is lifted to the page so a stat tile can deep-link into it. */
const SORTS = [
  { value: "age-desc", label: "Oldest first" },
  { value: "age-asc", label: "Newest first" },
  { value: "priority", label: "Priority" },
  { value: "assignee", label: "Assignee" },
  { value: "manager", label: "Manager" },
  { value: "account", label: "Account" },
];

export function AiCaseExplorer({ rows, selection, onSelectionChange }) {
  // Memoized so the aggregations below keep a stable dependency across renders.
  const list = useMemo(() => rows || [], [rows]);
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState("age-desc");

  const options = useMemo(() => tagSelectionOptions(list), [list]);
  // A selection can go stale when the date filter moves and its tag disappears.
  const active = options.some((o) => o.id === selection) ? selection : ALL_CASES;

  const filtered = useMemo(() => {
    const picked = filterByTagSelection(list, active);
    const q = query.trim().toLowerCase();
    if (!q) return picked;
    return picked.filter((r) =>
      [r.number, r.short_description, r.account, r.assigned_to, r.manager, r.state, r.status, r.tags]
        .some((v) => String(v ?? "").toLowerCase().includes(q)),
    );
  }, [list, active, query]);

  const sorted = useMemo(() => sortRows(filtered, sortMode), [filtered, sortMode]);

  const groups = useMemo(() => {
    const out = [];
    for (const o of options) {
      const last = out[out.length - 1];
      if (last && last.label === o.group) last.items.push(o);
      else out.push({ label: o.group, items: [o] });
    }
    return out;
  }, [options]);

  const activeLabel = options.find((o) => o.id === active)?.label ?? "All cases";

  const exportCsv = () => {
    const headers = [
      "Number", "Tags", "Outcome", "Priority", "State", "Status",
      "Assigned to", "Manager", "Account", "Created", "Age (days)", "Short description",
    ];
    const data = sorted.map((r) => {
      const outcome = rowOutcome(r);
      const age = ageDays(r._created);
      return [
        r.number ?? "",
        parseTags(r).join("; "),
        outcome ? OUTCOME_LABEL[outcome] : "Untagged",
        r.priority ?? "",
        r.state ?? "",
        r.status ?? "",
        r.assigned_to ?? "",
        r.manager ?? "",
        r.account ?? "",
        r._created ? fmtDate(r._created) : "",
        age == null ? "" : age,
        r.short_description ?? "",
      ];
    });
    downloadCsv(`ai-tags-${csvTimestamp()}.csv`, rowsToCsv(headers, data));
  };

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 260 }}>
          <div className="eyebrow">Case explorer</div>
          <div style={{ color: T.sub, fontSize: 12, marginTop: 4, maxWidth: 560 }}>
            Every tag in this import plus the combined views, each labelled with its case count.
            Scopes this list only — the charts above follow the filter bar.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: T.sub }}>
            <span className="eyebrow">Tag</span>
            <select
              value={active}
              onChange={(e) => onSelectionChange(e.target.value)}
              style={{ ...selectStyle, maxWidth: 300 }}
            >
              {groups.map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.items.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label} ({o.count.toLocaleString()})
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: T.sub }}>
            <span className="eyebrow">Sort</span>
            <select value={sortMode} onChange={(e) => setSortMode(e.target.value)} style={selectStyle}>
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </label>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search case, account, assignee…"
            style={{
              fontSize: 12,
              padding: "5px 9px",
              border: `1px solid ${T.border}`,
              borderRadius: T.radiusSm,
              background: T.surface,
              color: T.ink,
              width: 210,
            }}
          />
          <button
            onClick={exportCsv}
            disabled={!sorted.length}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              padding: "5px 10px",
              border: `1px solid ${T.border}`,
              borderRadius: T.radiusSm,
              background: T.surface,
              color: sorted.length ? T.ink : T.muted,
              cursor: sorted.length ? "pointer" : "default",
            }}
          >
            <Download size={14} strokeWidth={2.25} /> Export CSV
          </button>
          <div className="mono" style={{ fontSize: 12, color: T.accentDeep, fontWeight: 600 }}>
            {sorted.length.toLocaleString()} case{sorted.length === 1 ? "" : "s"}
          </div>
        </div>
      </div>

      {sorted.length === 0 ? (
        <div style={{ color: T.sub, fontSize: 13, fontStyle: "italic", marginTop: 14 }}>
          No cases match “{activeLabel}”{query.trim() ? ` and “${query.trim()}”` : ""} in the current
          view.
        </div>
      ) : (
        <div style={{ marginTop: 12, maxHeight: 520, overflow: "auto" }} className="scrollbar">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: T.surfaceAlt, position: "sticky", top: 0, zIndex: 1 }}>
                <th className="eyebrow" style={th}>Case</th>
                <th className="eyebrow" style={th}>Tags</th>
                <th className="eyebrow" style={th}>Priority</th>
                <th className="eyebrow" style={th}>State</th>
                <th className="eyebrow" style={th}>Status</th>
                <th className="eyebrow" style={th}>Assignee</th>
                <th className="eyebrow" style={th}>Manager</th>
                <th className="eyebrow" style={th}>Account</th>
                <th className="eyebrow" style={th}>Created</th>
                <th className="eyebrow" style={th}>Age</th>
                <th className="eyebrow" style={th}>Description</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => {
                const tags = parseTags(r);
                const age = ageDays(r._created);
                return (
                  <tr key={r.number || i} style={{ borderBottom: `1px solid ${T.borderSoft}` }}>
                    <td className="mono" style={{ ...td, whiteSpace: "nowrap", fontWeight: 600 }}>
                      <CopyableNumber value={r.number} />
                    </td>
                    <td style={{ ...td, minWidth: 190 }}>
                      {tags.length === 0 ? (
                        <span style={{ color: T.muted, fontStyle: "italic" }}>untagged</span>
                      ) : (
                        <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 4 }}>
                          {tags.map((t) => {
                            const c = classifyTag(t);
                            return (
                              <span key={t} title={t}>
                                <Pill color={OUTCOME_COLOR[c.outcome]}>{shortTagLabel(t)}</Pill>
                              </span>
                            );
                          })}
                        </span>
                      )}
                    </td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>
                      <span style={{ color: priorityColor(r.priority), fontWeight: 600 }}>{r.priority || "—"}</span>
                    </td>
                    <td style={{ ...td, whiteSpace: "nowrap", color: T.ink }}>{r.state || "—"}</td>
                    <td style={{ ...td, whiteSpace: "nowrap", color: T.sub }}>{r.status || "—"}</td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>{r.assigned_to || "Unassigned"}</td>
                    <td style={{ ...td, whiteSpace: "nowrap", color: T.sub }}>{r.manager || "No manager"}</td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>{r.account || "—"}</td>
                    <td className="mono" style={{ ...td, whiteSpace: "nowrap", color: T.sub }}>{fmtDate(r._created)}</td>
                    <td className="mono" style={{ ...td, whiteSpace: "nowrap", color: age != null && age > 30 ? T.danger : T.sub }}>
                      {age == null ? "—" : `${age}d`}
                    </td>
                    <td style={{ ...td, maxWidth: 340, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.short_description || "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function sortRows(rows, mode) {
  const copy = [...rows];
  const created = (r) => (r._created ? r._created.getTime() : Number.POSITIVE_INFINITY);
  const prio = (r) => {
    const n = parseInt(String(r.priority ?? ""), 10);
    return isNaN(n) ? 99 : n;
  };
  switch (mode) {
    case "age-asc":
      return copy.sort((a, b) => created(b) - created(a));
    case "priority":
      return copy.sort((a, b) => prio(a) - prio(b) || created(a) - created(b));
    case "assignee":
      return copy.sort(
        (a, b) =>
          String(a.assigned_to || "Unassigned").localeCompare(String(b.assigned_to || "Unassigned")) ||
          created(a) - created(b),
      );
    case "manager":
      // Manager, then assignee within the team, then age — reads as a
      // team-by-team roster so a manager can eyeball their block in one place.
      return copy.sort(
        (a, b) =>
          String(a.manager || "No manager").localeCompare(String(b.manager || "No manager")) ||
          String(a.assigned_to || "Unassigned").localeCompare(String(b.assigned_to || "Unassigned")) ||
          created(a) - created(b),
      );
    case "account":
      return copy.sort(
        (a, b) => String(a.account || "").localeCompare(String(b.account || "")) || created(a) - created(b),
      );
    case "age-desc":
    default:
      return copy.sort((a, b) => created(a) - created(b));
  }
}

const selectStyle = {
  fontSize: 12,
  padding: "4px 8px",
  border: `1px solid ${T.border}`,
  borderRadius: T.radiusSm,
  background: T.surface,
  color: T.ink,
  cursor: "pointer",
};

/* Header cells ride className="eyebrow" (uppercase / 11px / 0.08em / 600); only
 * the per-site color, the sticky ground and the real hairline live here. */
const th = {
  textAlign: "left",
  padding: "8px 12px",
  color: T.sub,
  borderBottom: `1px solid ${T.border}`,
  background: T.surfaceAlt,
  whiteSpace: "nowrap",
};

const td = { padding: "8px 12px" };
