import { Outlet } from "react-router-dom";
import { FilterNavLink } from "../FilterLink.jsx";
import {
  LayoutDashboard, Sun, ClipboardList, Timer, FileBarChart,
  Clock, Inbox, TrendingUp, CalendarClock, CircleDot, Layers, Building2,
  Scale, Users, Ban, Shield,
  ExternalLink, BarChart3,
  Plug, Sparkles, Gauge, Table, Mailbox, Settings, Bot,
} from "lucide-react";
import { T } from "../../lib/theme.js";
import { useAppData } from "../../lib/useAppData.js";
import { Shell } from "./Shell.jsx";
import { TopBar } from "./TopBar.jsx";
import { DataRetentionNotice } from "./DataRetentionNotice.jsx";
import { ThemeToggle } from "../ThemeToggle.jsx";

/* Groups follow a first-time user's journey top to bottom: land on the
 * overview, work today's queues, read performance, look at the team,
 * drill into slices of the caseload, then integrations and deeper
 * analysis. Setup (Connections/Settings) anchors the bottom, the
 * conventional spot for configuration. */
const NAV_GROUPS = [
  {
    label: "Overview",
    items: [
      { to: "/",       label: "Dashboard",       icon: LayoutDashboard },
      { to: "/report", label: "Monthly Summary", icon: FileBarChart },
    ],
  },
  {
    label: "Queues",
    items: [
      { to: "/my-day",            label: "My Day",            icon: Sun },
      { to: "/update-queue",      label: "Update Queue",      icon: ClipboardList },
      { to: "/solution-proposed", label: "Solution Proposed", icon: Timer },
    ],
  },
  {
    label: "Performance",
    items: [
      { to: "/sla",     label: "SLA",          icon: Clock },
      { to: "/cadence", label: "Cadence",      icon: CalendarClock },
      { to: "/trends",  label: "Trends",       icon: TrendingUp },
      { to: "/backlog", label: "Open Backlog", icon: Inbox },
    ],
  },
  {
    label: "Team",
    items: [
      { to: "/team",     label: "Team",     icon: Users },
      { to: "/workload", label: "Workload", icon: Scale },
    ],
  },
  {
    label: "Explore",
    items: [
      { to: "/cases",      label: "Cases",      icon: Table },
      { to: "/priority",   label: "Priority",   icon: CircleDot },
      { to: "/categories", label: "Categories", icon: Layers },
      { to: "/accounts",   label: "Accounts",   icon: Building2 },
      { to: "/dod",        label: "DoD",        icon: Shield },
    ],
  },
  {
    label: "Jira",
    items: [
      { to: "/jira",          label: "All HMS Jira's",         icon: ExternalLink },
      { to: "/jira-blockers", label: "Cases w/ Jira Blockers", icon: Ban },
      { to: "/jira-stats",    label: "Statistics",             icon: BarChart3 },
    ],
  },
  {
    label: "Analysis",
    items: [
      { to: "/insights",    label: "Insights",     icon: Sparkles },
      { to: "/sentiment",   label: "Sentiment",    icon: Gauge },
      { to: "/ai-assisted", label: "AI Assisted?", icon: Bot },
      { to: "/surveys",     label: "Surveys",      icon: Mailbox },
    ],
  },
  {
    label: "Setup",
    items: [
      { to: "/connections", label: "Connections", icon: Plug },
      { to: "/settings",    label: "Settings",    icon: Settings },
    ],
  },
];

const SIDEBAR_WIDTH = 248;

export function AppLayout() {
  const appData = useAppData();
  return (
    <div style={{ display: "flex", minHeight: "100vh", background: T.bg, color: T.ink }}>
      <Sidebar importCount={appData.imports?.length || 0} storageBytes={appData.storageBytes} />
      <div style={{ flex: 1, marginLeft: SIDEBAR_WIDTH, minWidth: 0 }}>
        <Shell>
          <TopBar ctx={appData} />
          <Outlet context={appData} />
        </Shell>
      </div>
    </div>
  );
}

function InforLogo({ height = 28 }) {
  // Official Infor wordmark — transparent PNG trimmed to its content bounds
  // (src/../public/infor-logo.png). Rendered by height so it stays crisp and
  // keeps its native aspect ratio.
  return (
    <img
      src="/infor-logo.png"
      alt="Infor"
      height={height}
      draggable={false}
      style={{ height, width: "auto", display: "block", userSelect: "none" }}
    />
  );
}

function Sidebar({ importCount, storageBytes }) {
  return (
    <aside
      className="no-print scrollbar"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        bottom: 0,
        width: SIDEBAR_WIDTH,
        background: T.surface,
        borderRight: `1px solid ${T.border}`,
        display: "flex",
        flexDirection: "column",
        overflowY: "auto",
      }}
    >
      <div
        style={{
          padding: "20px 20px 18px",
          borderBottom: `1px solid ${T.borderSoft}`,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: 10,
        }}
      >
        <InforLogo height={26} />
        <div
          className="display"
          style={{
            fontSize: 22,
            color: T.ink,
            lineHeight: 1.05,
            letterSpacing: "-0.015em",
          }}
        >
          HMS <em>Insights</em>
        </div>
      </div>

      <nav style={{ flex: 1, padding: "14px 10px 24px" }}>
        {NAV_GROUPS.map((group) => (
          <div key={group.label} style={{ marginTop: 16 }}>
            <div
              className="eyebrow"
              style={{
                color: T.muted,
                fontSize: 9,
                padding: "0 12px 8px",
              }}
            >
              {group.label}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {group.items.map((item) => (
                <SidebarLink key={item.to} {...item} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div style={{ padding: "0 0 14px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            margin: "0 14px 10px",
            paddingTop: 12,
            borderTop: `1px solid ${T.borderSoft}`,
          }}
        >
          <span className="eyebrow" style={{ color: T.muted, fontSize: 9 }}>Appearance</span>
          <ThemeToggle />
        </div>
        <DataRetentionNotice importCount={importCount} storageBytes={storageBytes} />
      </div>
    </aside>
  );
}

function SidebarLink({ to, label, icon: Icon }) {
  return (
    <FilterNavLink
      to={to}
      end={to === "/"}
      style={({ isActive }) => ({
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: 11,
        padding: "8px 12px",
        margin: "0 4px",
        borderRadius: 7,
        background: isActive ? T.accentTint : "transparent",
        color: isActive ? T.accentDeep : T.sub,
        fontFamily: "Geist, DM Sans, sans-serif",
        fontSize: 13,
        fontWeight: isActive ? 600 : 500,
        textDecoration: "none",
        whiteSpace: "nowrap",
        transition: "background 0.15s ease, color 0.15s ease",
      })}
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <span
              aria-hidden
              style={{
                position: "absolute",
                left: -4,
                top: 8,
                bottom: 8,
                width: 3,
                borderRadius: 2,
                background: T.accent,
              }}
            />
          )}
          <Icon size={15} strokeWidth={isActive ? 2.25 : 1.85} />
          {label}
        </>
      )}
    </FilterNavLink>
  );
}
