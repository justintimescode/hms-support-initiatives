import { useState, useMemo } from "react";
import { T } from "../lib/theme.js";
import { fmtDuration, SLA_COLOR, deltaColor, fmtDeltaCount, fmtDeltaPct } from "../lib/format.js";
import { computeKpis } from "../lib/stats.js";
import { PROJECT_KEY } from "../lib/jira-client.js";
import { Section } from "../components/layout/Section.jsx";
import { Card } from "../components/layout/Card.jsx";
import { Pill } from "../components/Pill.jsx";
import { DeltaLine } from "../components/KpiRow.jsx";
import { DevKpiCompare } from "../components/DevKpiCompare.jsx";
import { SlaBlock } from "../components/charts/SlaBlock.jsx";
import { AssigneeAgingBlock } from "../components/charts/AssigneeAgingBlock.jsx";
import { StuckCasesList } from "../components/StuckCasesList.jsx";
import { TrajectoryBlock } from "../components/charts/TrajectoryBlock.jsx";
import { WeekdayBlock } from "../components/charts/WeekdayBlock.jsx";
import { IntakeHeatmap } from "../components/charts/IntakeHeatmap.jsx";
import { PriorityBlock } from "../components/charts/PriorityBlock.jsx";
import { CategoryBlock } from "../components/charts/CategoryBlock.jsx";
import { AccountProductBlock } from "../components/charts/AccountProductBlock.jsx";
import { JiraDashboard } from "../components/jira/JiraDashboard.jsx";
import { JiraAnalysisBlock } from "../components/jira/JiraAnalysisBlock.jsx";
import { InteractionQualityBlock } from "../components/charts/InteractionQualityBlock.jsx";
import { QualityBlock } from "../components/charts/QualityBlock.jsx";
import { AnalystProfileModal } from "../components/AnalystProfileModal.jsx";
import { AiBlock } from "../components/ai/AiBlock.jsx";
import { CaseTable } from "../components/CaseTable.jsx";
import { UpdateQueue } from "./UpdateQueue.jsx";

/* ================= Team View ================= */
export function TeamView({ page, printMode, members, allMembers, compareTotals, highlightRange, kpis, priorityData, categoryData, accountData, productData, enriched, aiState, runAiAnalysis, memberAi, runMemberAi, drillIntoMember, dbReady, snapshotMs, jiraState, syncJira, hydrateFromCache }) {
  const [sort, setSort] = useState({ key: "total", dir: "desc" });
  const [profileMember, setProfileMember] = useState(null);

  const sorted = useMemo(() => {
    const get = (m) => {
      switch (sort.key) {
        case "name": return m.name.toLowerCase();
        case "total": return m.kpis.total;
        case "open": return m.kpis.open;
        case "sla": return m.kpis.slaRate ?? -1;
        case "avgRes": return m.kpis.avgRes ?? Infinity;
        case "resP50": return m.kpis.resP50 ?? Infinity;
        case "avgFrt": return m.kpis.avgFrt ?? Infinity;
        case "atRisk": return m.kpis.atRisk.length;
        case "breached": return m.kpis.breached.length;
        default: return 0;
      }
    };
    const arr = [...members];
    arr.sort((a, b) => {
      const av = get(a);
      const bv = get(b);
      if (av < bv) return sort.dir === "asc" ? -1 : 1;
      if (av > bv) return sort.dir === "asc" ? 1 : -1;
      return 0;
    });
    return arr;
  }, [members, sort]);

  const headers = [
    { key: "name", label: "Analyst", align: "left" },
    { key: "total", label: "Cases", align: "right" },
    { key: "open", label: "Open", align: "right" },
    { key: "sla", label: "SLA %", align: "right" },
    { key: "avgRes", label: "Avg Resolution", align: "right" },
    { key: "resP50", label: "Med · p90 Res", align: "right" },
    { key: "avgFrt", label: "Avg FRT", align: "right" },
    { key: "atRisk", label: "At Risk", align: "right" },
    { key: "breached", label: "Breached", align: "right" },
  ];

  const allRows = useMemo(() => members.flatMap((m) => m.rows), [members]);
  const trajectoryRows = useMemo(() => (allMembers ? allMembers.flatMap((m) => m.rows) : allRows), [allMembers, allRows]);
  const totals = useMemo(() => computeKpis(allRows), [allRows]);

  return (
    <>
      {(page === "overview" || printMode) && (
        <div className="print-section">
        <Section title="Team at a Glance" subtitle="Top-line numbers across every analyst with assigned cases. Use this row as the starting frame for everything below — leaderboard, cadence, and per-member profiles.">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
            <Card className="hoverlift">
              <div className="eyebrow" style={{ color: T.muted }}>Team size</div>
              <div className="display mono" style={{ fontSize: 40, fontWeight: 500, marginTop: 10, color: T.ink, lineHeight: 1 }}>
                {members.length}
              </div>
              <div style={{ color: T.sub, fontSize: 12, marginTop: 8 }}>analysts with assigned cases</div>
            </Card>
            <Card className="hoverlift">
              <div className="eyebrow" style={{ color: T.muted }}>Total cases</div>
              <div className="display mono" style={{ fontSize: 40, fontWeight: 500, marginTop: 10, color: T.ink, lineHeight: 1 }}>
                {totals.total.toLocaleString()}
              </div>
              <div style={{ color: T.sub, fontSize: 12, marginTop: 8 }}>{totals.closed} closed · {totals.solutionProposed ? `${totals.solutionProposed} solution proposed · ` : ""}{totals.open} open</div>
              {compareTotals && (
                <DeltaLine text={fmtDeltaCount(totals.total, compareTotals.total)} color={deltaColor(totals.total - compareTotals.total, "up")} />
              )}
            </Card>
            <Card className="hoverlift">
              <div className="eyebrow" style={{ color: T.muted }}>Team SLA</div>
              <div className="display mono" style={{ fontSize: 40, fontWeight: 500, marginTop: 10, color: SLA_COLOR(totals.slaRate), lineHeight: 1 }}>
                {totals.slaRate == null ? "—" : `${totals.slaRate.toFixed(1)}%`}
              </div>
              <div style={{ color: T.sub, fontSize: 12, marginTop: 8 }}>{totals.slaMet} / {totals.slaEligible} within SLA</div>
              {compareTotals && (
                <DeltaLine text={fmtDeltaPct(totals.slaRate, compareTotals.slaRate)} color={deltaColor((totals.slaRate ?? 0) - (compareTotals.slaRate ?? 0), "up")} />
              )}
            </Card>
            <Card className="hoverlift">
              <div className="eyebrow" style={{ color: T.muted }}>Open at risk</div>
              <div className="display mono" style={{ fontSize: 40, fontWeight: 500, marginTop: 10, color: totals.breached.length ? T.danger : totals.atRisk.length ? T.warn : T.ok, lineHeight: 1 }}>
                {totals.breached.length + totals.atRisk.length}
              </div>
              <div style={{ color: T.sub, fontSize: 12, marginTop: 8 }}>{totals.breached.length} breached · {totals.atRisk.length} due in 24h</div>
              {compareTotals && (
                <DeltaLine
                  text={fmtDeltaCount(totals.atRisk.length + totals.breached.length, compareTotals.atRisk.length + compareTotals.breached.length)}
                  color={deltaColor((totals.atRisk.length + totals.breached.length) - (compareTotals.atRisk.length + compareTotals.breached.length), "down")}
                />
              )}
            </Card>
          </div>
          <DevKpiCompare jsKpis={totals} analyst="__all__" dateRange={highlightRange} dbReady={dbReady} />
        </Section>
        </div>
      )}

      {(page === "sla" || printMode) && (
        <div className="print-section">
          <Section title="SLA Performance" subtitle="Team-wide SLA hit rate, broken down by priority, with the cases nearest to (or past) their deadline.">
            <SlaBlock kpis={kpis} priorityData={priorityData} enriched={enriched} />
          </Section>
          <Section title="Open Backlog" subtitle="Open cases across the team, sliced by who's holding them and how long they've been open. The stacked bars show whose queue is graying; the stuck-cases list calls out the actual cases sitting over 30 days, with assignee.">
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <AssigneeAgingBlock members={members} />
              <StuckCasesList rows={allRows} showAssignee />
            </div>
          </Section>
        </div>
      )}

      {(page === "trends" || printMode) && (
        <div className="print-section">
          <Section title="Trends Over Time" subtitle="Team-wide backlog trajectory and weekly intake-versus-resolved cadence. Use this to see whether the team is keeping pace with incoming work, or whether work is accumulating faster than it can be cleared. Charts zoom to the active date filter; switch any card to All time for the full arc.">
            <TrajectoryBlock rows={trajectoryRows} dateRange={highlightRange?.from != null ? highlightRange : null} />
          </Section>
          <Section title="Workload Cadence" subtitle="Team-wide weekly rhythm. The bars show average open caseload and case creation by weekday; the heatmap pinpoints the weekday-and-hour slots where intake concentrates. Useful for staffing decisions and on-call coverage. Click a heatmap tile to see the cases created in that slot.">
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <WeekdayBlock rows={allRows} />
              <IntakeHeatmap rows={allRows} />
            </div>
          </Section>
        </div>
      )}

      {(page === "mix" || printMode) && (
        <div className="print-section">
          <Section title="Priority Analysis" subtitle="How case priority shapes both volume and resolution time across the team.">
            <PriorityBlock priorityData={priorityData} rows={allRows} />
          </Section>
          <Section title="Case Categorization" subtitle="What kinds of problems are showing up across the team. Auto-derived from case titles and comments.">
            <CategoryBlock categoryData={categoryData} />
          </Section>
          <Section title="Accounts & Products" subtitle="Which customers and product lines drive the most case volume across the team.">
            <AccountProductBlock accountData={accountData} productData={productData} />
          </Section>
        </div>
      )}

      {(page === "jira" || printMode) && (
        <div className="print-section">
        <Section title="Jira Blockers" subtitle="Open cases across the team waiting on engineering work. Cases here are gated by a Jira ticket rather than analyst capacity, so they need a different intervention than the rest of the backlog.">
          <JiraDashboard
            rows={allRows.filter((r) => r._isOpen && r._jiraTickets.length > 0)}
            jiraConnected={jiraState?.status === "ready"}
          />
        </Section>
        </div>
      )}

      {(page === "jiraproject" || printMode) && (
        <div className="print-section">
        <Section title="Jira Project Analysis" subtitle={`Live engineering analytics for the ${PROJECT_KEY} Jira project, pulled directly from Atlassian.`}>
          <JiraAnalysisBlock jiraState={jiraState} onSync={syncJira} onLoadCache={hydrateFromCache} />
        </Section>
        </div>
      )}

      {(page === "team" || printMode) && (
        <div className="print-section">
          <Section title="Team Leaderboard" subtitle="Side-by-side performance across the team. Click any column header to sort, or any analyst's name to drill into their full dashboard. Use this view to spot outliers — both the team's strongest performers and analysts who may need support.">
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }} className="scrollbar">
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: T.surfaceAlt }}>
                  {headers.map((h) => (
                    <th
                      key={h.key}
                      onClick={() =>
                        setSort((s) =>
                          s.key === h.key
                            ? { key: h.key, dir: s.dir === "asc" ? "desc" : "asc" }
                            : { key: h.key, dir: h.key === "name" ? "asc" : "desc" }
                        )
                      }
                      style={{
                        padding: "10px 14px",
                        textAlign: h.align,
                        fontWeight: 600,
                        color: T.sub,
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                        borderBottom: `1px solid ${T.borderSoft}`,
                      }}
                    >
                      {h.label}
                      {sort.key === h.key && (
                        <span style={{ marginLeft: 4, color: T.accent }}>
                          {sort.dir === "asc" ? "▲" : "▼"}
                        </span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((m) => (
                  <tr key={m.name} style={{ borderBottom: `1px solid ${T.borderSoft}` }}>
                    <td style={{ padding: "10px 14px" }}>
                      <button
                        onClick={() => drillIntoMember(m.name)}
                        style={{ background: "none", border: "none", color: T.ink, cursor: "pointer", padding: 0, fontSize: 13, fontFamily: "DM Sans, sans-serif", textAlign: "left" }}
                      >
                        <span style={{ fontWeight: 600 }}>{m.name}</span>
                      </button>
                    </td>
                    <td className="mono" style={{ padding: "10px 14px", textAlign: "right" }}>{m.kpis.total}</td>
                    <td className="mono" style={{ padding: "10px 14px", textAlign: "right", color: m.kpis.open > 0 ? T.ink : T.muted }}>{m.kpis.open}</td>
                    <td className="mono" style={{ padding: "10px 14px", textAlign: "right", color: SLA_COLOR(m.kpis.slaRate), fontWeight: 600 }}>
                      {m.kpis.slaRate == null ? "—" : `${m.kpis.slaRate.toFixed(1)}%`}
                    </td>
                    <td className="mono" style={{ padding: "10px 14px", textAlign: "right" }}>{fmtDuration(m.kpis.avgRes)}</td>
                    <td className="mono" style={{ padding: "10px 14px", textAlign: "right", whiteSpace: "nowrap" }}>
                      {fmtDuration(m.kpis.resP50)}<span style={{ color: T.muted }}> · {fmtDuration(m.kpis.resP90)}</span>
                    </td>
                    <td className="mono" style={{ padding: "10px 14px", textAlign: "right" }}>{fmtDuration(m.kpis.avgFrt)}</td>
                    <td className="mono" style={{ padding: "10px 14px", textAlign: "right", color: m.kpis.atRisk.length > 0 ? T.warn : T.muted }}>{m.kpis.atRisk.length}</td>
                    <td className="mono" style={{ padding: "10px 14px", textAlign: "right", color: m.kpis.breached.length > 0 ? T.danger : T.muted }}>{m.kpis.breached.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </Section>

          <Section title="Resolution Quality" subtitle="First-contact resolution (closed in ≤1 analyst touch) and reopen rate (resolutions that bounced back open). These quality signals matter more than raw volume — a high closure count with a high reopen rate is churn, not throughput.">
            <QualityBlock members={members} />
          </Section>

          <Section title="Interaction Quality" subtitle="Average customer and analyst turns per case. More turns often indicate unclear expectations, complex issues, or cases that needed more back-and-forth to resolve. Use this alongside SLA metrics to identify analysts who resolve hard cases efficiently.">
            <InteractionQualityBlock members={members} />
          </Section>

          <Section title="Member Profiles" subtitle="A condensed snapshot per analyst — priority mix, top case categories, and most frequent accounts. Run the AI button on any card for a qualitative read on what that analyst's queue looks like, or click through to their full dashboard.">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 12 }}>
              {sorted.map((m) => (
                <MemberCard
                  key={m.name}
                  member={m}
                  onOpenProfile={() => setProfileMember(m)}
                  onDrillIn={() => drillIntoMember(m.name)}
                />
              ))}
            </div>
          </Section>

          {profileMember && (
            <AnalystProfileModal
              member={profileMember}
              ai={memberAi[profileMember.name]}
              onRunAi={() => runMemberAi(profileMember)}
              onClose={() => setProfileMember(null)}
              onOpenDashboard={() => { setProfileMember(null); drillIntoMember(profileMember.name); }}
            />
          )}
        </div>
      )}

      {page === "ai" && (
        <Section title="Deep Pattern Analysis" subtitle="An AI-powered qualitative read on the team's case data — themes, recurring issues, knowledge-base gaps, and skill-development opportunities. Samples up to 50 cases (anonymized) and sends them to Claude for analysis.">
          <AiBlock state={aiState} run={runAiAnalysis} hasData={allRows.length > 0} />
        </Section>
      )}

      {page === "queue" && (
        <UpdateQueue analyst="__all__" snapshotMs={snapshotMs} dbReady={dbReady} />
      )}

      {page === "cases" && (
        <Section title="Case Register" subtitle="The full underlying case list across the team. Sort by any column or search by keyword to inspect the individual cases behind every metric in the app.">
          <CaseTable rows={allRows} />
        </Section>
      )}
    </>
  );
}

function MemberCard({ member, onDrillIn, onOpenProfile }) {
  const k = member.kpis;
  const maxPriority = Math.max(1, ...member.priorityMix.map((p) => p.count));
  // The whole card is a click target for the profile modal (mouse convenience);
  // the name and footer buttons stay real, keyboard-accessible controls.
  return (
    <Card
      className="hoverlift"
      onClick={onOpenProfile}
      style={{ display: "flex", flexDirection: "column", gap: 14, cursor: "pointer" }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <button
            onClick={(e) => { e.stopPropagation(); onOpenProfile(); }}
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}
          >
            <div className="display" style={{ fontSize: 18, fontWeight: 600, color: T.ink, lineHeight: 1.2 }}>
              {member.name}
            </div>
          </button>
          <div className="eyebrow" style={{ color: T.muted, marginTop: 6 }}>
            {k.total} cases · {k.closed} closed · {k.solutionProposed ? `${k.solutionProposed} solution proposed · ` : ""}{k.open} open
          </div>
        </div>
        <Pill color={SLA_COLOR(k.slaRate)}>
          {k.slaRate == null ? "no SLA data" : `SLA ${k.slaRate.toFixed(0)}%`}
        </Pill>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, fontSize: 12 }}>
        <Stat label="Avg res" value={fmtDuration(k.avgRes)} />
        <Stat label="Avg FRT" value={fmtDuration(k.avgFrt)} />
        <Stat
          label="At risk"
          value={`${k.breached.length + k.atRisk.length}`}
          accent={k.breached.length > 0 ? T.danger : k.atRisk.length > 0 ? T.warn : T.muted}
        />
      </div>

      <div>
        <div className="eyebrow" style={{ color: T.muted, marginBottom: 6 }}>Priority mix</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {member.priorityMix.map((p) => (
            <div key={p.priority} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
              <div style={{ width: 90, color: T.sub, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.priority}</div>
              <div style={{ flex: 1, height: 6, background: T.surfaceAlt, borderRadius: 3, overflow: "hidden" }}>
                <div style={{ width: `${(p.count / maxPriority) * 100}%`, height: "100%", background: p.color }} />
              </div>
              <div className="mono" style={{ width: 28, textAlign: "right", color: T.sub }}>{p.count}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <ListBlock label="Top categories" items={member.topCategories} />
        <ListBlock label="Top accounts" items={member.topAccounts} />
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", borderTop: `1px solid ${T.borderSoft}`, paddingTop: 12 }}>
        <button
          onClick={(e) => { e.stopPropagation(); onOpenProfile(); }}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "7px 12px", background: T.ink, color: T.surface,
            border: `1px solid ${T.ink}`, borderRadius: 6,
            fontFamily: "DM Sans, sans-serif", fontSize: 12, fontWeight: 500, cursor: "pointer",
          }}
        >
          View profile
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDrillIn(); }}
          style={{
            padding: "7px 12px", background: "transparent", color: T.sub,
            border: `1px solid ${T.border}`, borderRadius: 6,
            fontFamily: "DM Sans, sans-serif", fontSize: 12, cursor: "pointer",
          }}
        >
          Open full dashboard →
        </button>
      </div>
    </Card>
  );
}

function Stat({ label, value, accent }) {
  return (
    <div style={{ background: T.surfaceAlt, borderRadius: 4, padding: "8px 10px" }}>
      <div className="eyebrow" style={{ color: T.muted, fontSize: 9 }}>{label}</div>
      <div className="mono" style={{ fontSize: 14, fontWeight: 600, color: accent || T.ink, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function ListBlock({ label, items }) {
  return (
    <div>
      <div className="eyebrow" style={{ color: T.muted, marginBottom: 6 }}>{label}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {items.length === 0 ? (
          <div style={{ fontSize: 12, color: T.muted, fontStyle: "italic" }}>—</div>
        ) : items.map((it) => (
          <div key={it.name} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12 }}>
            <span style={{ color: T.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</span>
            <span className="mono" style={{ color: T.sub }}>{it.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
