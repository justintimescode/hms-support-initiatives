import { useCallback, useMemo } from "react"
import { useOutletContext, useSearchParams, useNavigate } from "react-router-dom"
import { Sun, UserRound, Users } from "lucide-react"
import { T } from "../lib/theme.js"
import { fmtFullDate } from "../lib/format.js"
import { Section } from "../components/layout/Section.jsx"
import { Card } from "../components/layout/Card.jsx"
import { Pill } from "../components/Pill.jsx"
import { EmptyState } from "../components/EmptyState.jsx"
import { SENTIMENT_STYLE } from "../components/charts/sentiment-tokens.js"
import { AnalystDay } from "../components/myday/AnalystDay.jsx"
import { TeamDay } from "../components/myday/TeamDay.jsx"

/* ============================================================================
 * My Day — live triage, in two flavors.
 *
 *   MY CASES (analyst)  one person's open work: overdue updates, escalation
 *                       watch, SLA pressure, stuck cases, Jira blockers.
 *   MY TEAM  (manager)  the same signals rolled up per report, plus the roster
 *                       that says who needs help today. Scoped by the global
 *                       Manager filter, so it agrees with every other
 *                       team-flavored surface in the app.
 *
 * The flavor lives in the URL as `?day=me|team` (shareable, survives a reload)
 * and defaults to My Cases so an analyst's landing page is unchanged. Both
 * views deliberately ignore the global date range — a day is about live work,
 * not a historical window.
 * ========================================================================== */

const MODES = [
  { key: "me", label: "My cases", Icon: UserRound },
  { key: "team", label: "My team", Icon: Users },
]

export default function MyDayPage() {
  const ctx = useOutletContext()
  const {
    rows, analyst, setAnalyst, analysts, enrichedAnalyst, enrichedManagerAll,
    snapshotMs, managerSel, managers, toggleManager, setManagers, buildFilterSearch,
  } = ctx
  const me = analyst
  const isPicked = me && me !== "__all__"

  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const mode = params.get("day") === "team" ? "team" : "me"

  const setMode = useCallback(
    (next) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev)
          if (next === "team") p.set("day", "team")
          else p.delete("day") // "me" is the default — keep the URL clean
          return p
        },
        { replace: true },
      )
    },
    [setParams],
  )

  // Roster drill-in: set the analyst AND switch to their day in ONE navigation.
  // Doing it as setAnalyst() + setMode() would race — the second write reads the
  // pre-update search and drops the first (same reason drillIntoMember bakes the
  // search string up front).
  const openAnalystDay = useCallback(
    (name) => {
      const search = new URLSearchParams(buildFilterSearch({ analyst: name }))
      search.delete("day")
      const qs = search.toString()
      navigate({ pathname: "/my-day", search: qs ? `?${qs}` : "" })
      if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" })
    },
    [buildFilterSearch, navigate],
  )

  const subtitle = useMemo(
    () =>
      mode === "team"
        ? "Your team's live open work — independent of the global date range. The roster ranks reports by how many of their cases need attention today; the update queue is anchored to the data snapshot."
        : "Your live open work — independent of the global date range. The update queue is anchored to the data snapshot; escalation, SLA, stuck, and blocker views reflect right now.",
    [mode],
  )

  if (!rows) {
    return (
      <Section title="My Day">
        <EmptyState
          title="Load some data to see your day"
          message="Drop a ServiceNow case export on the Connections page, then pick who you are — this page becomes your personal triage view."
        />
      </Section>
    )
  }

  return (
    <Section title="My Day" subtitle={subtitle}>
      {/* The escalation table and the roster share the Sentiment tab's row
          styling; inject it once for the whole page. */}
      <style>{SENTIMENT_STYLE}</style>

      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
        <div role="group" aria-label="My Day views" style={{ display: "flex" }}>
          {MODES.map((m) => (
            <button
              key={m.key}
              type="button"
              className="sentiment-seg"
              aria-pressed={mode === m.key}
              onClick={() => setMode(m.key)}
            >
              <m.Icon size={13} strokeWidth={2.25} style={{ verticalAlign: "middle", marginRight: 6 }} />
              {m.label}
            </button>
          ))}
        </div>

        {mode === "me" && isPicked && (
          <>
            <Pill color={T.accentDeep}>
              <Sun size={14} strokeWidth={2.25} style={{ verticalAlign: "middle", marginRight: 5 }} />
              Viewing as {me}
            </Pill>
            <button
              onClick={() => setAnalyst("__all__")}
              style={{ background: "none", border: "none", color: T.sub, cursor: "pointer", fontSize: 12, textDecoration: "underline" }}
            >
              switch
            </button>
          </>
        )}

        {snapshotMs && (
          <span style={{ color: T.muted, fontSize: 12, marginLeft: "auto" }}>
            data as of {fmtFullDate(snapshotMs)}
          </span>
        )}
      </div>

      {mode === "team" ? (
        <TeamDay
          managerSel={managerSel}
          managers={managers}
          toggleManager={toggleManager}
          setManagers={setManagers}
          enrichedManagerAll={enrichedManagerAll}
          snapshotMs={snapshotMs}
          hasRows={!!rows}
          onOpenAnalyst={openAnalystDay}
        />
      ) : isPicked ? (
        <AnalystDay
          me={me}
          enrichedAnalyst={enrichedAnalyst}
          snapshotMs={snapshotMs}
          hasRows={!!rows}
        />
      ) : (
        <AnalystPicker analysts={analysts} setAnalyst={setAnalyst} onTeamView={() => setMode("team")} />
      )}
    </Section>
  )
}

/** No analyst chosen yet → let the user say who they are, or hand a manager the
 *  team view instead of a dead end. */
function AnalystPicker({ analysts, setAnalyst, onTeamView }) {
  return (
    <Card style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div className="eyebrow">
          <UserRound size={14} strokeWidth={2.25} style={{ verticalAlign: "middle", marginRight: 6, color: T.accent }} />
          Whose day?
        </div>
        <button
          type="button"
          onClick={onTeamView}
          style={{ background: "none", border: "none", color: T.accentDeep, cursor: "pointer", fontSize: 12, fontWeight: 600 }}
        >
          I manage a team — show me my team's day
        </button>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {(analysts || []).map(([name, count]) => (
          <button
            key={name}
            onClick={() => setAnalyst(name)}
            className="hoverlift"
            style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              padding: "8px 12px", borderRadius: T.radiusSm, cursor: "pointer",
              background: T.surface, border: `1px solid ${T.border}`,
              color: T.ink, fontSize: 13,
            }}
          >
            {name}
            <span className="mono" style={{ color: T.muted, fontSize: 11 }}>{count}</span>
          </button>
        ))}
      </div>
    </Card>
  )
}
