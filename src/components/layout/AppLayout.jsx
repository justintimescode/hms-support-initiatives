import { Outlet } from "react-router-dom";
import { FilterNavLink } from "../FilterLink.jsx";
import {
  LayoutDashboard, Sun, ClipboardList, Timer, FileBarChart,
  Clock, Inbox, TrendingUp, CalendarClock, CircleDot, Layers, Building2,
  Scale, Users, Ban, Shield,
  ExternalLink, BarChart3,
  Plug, Sparkles, Gauge, Table, Mailbox, Settings, Bot, Network,
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
      // Cross-source Jira<->case view. Sits with the Jira group rather than
      // Analysis: "Insights" there is already the AI narrative page, and someone
      // hunting for which tickets are hurting customers looks here.
      { to: "/operations",    label: "Jira x ServiceNow",      icon: Network },
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
      {/* Brand lockup — endorsed-product pattern: the parent Infor wordmark on
       * top, a hairline that hangs the product name off it (clearspace +
       * "an Infor product" hierarchy without a second competing mark), then
       * the product name. The name is a single Montserrat Regular treatment,
       * Title Case, in ink — NO accent color inside the lockup, per the brand
       * rule that accent colors never appear in a logo lockup or text
       * treatment (.brand/SPEC.md §6.9). */}
      <div
        style={{
          padding: "20px 20px 18px",
          borderBottom: `1px solid ${T.borderSoft}`,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: 14,
        }}
      >
        <InforLogo />
        <div
          style={{
            alignSelf: "stretch",
            borderTop: `1px solid ${T.border}`,
            paddingTop: 12,
          }}
        >
          {/* Two-line lockup. Line 1 carries the brand anchor — bold, with
              "Support" in Infor Red; line 2 drops to a lighter weight and
              secondary color with open tracking so the three-word name reads as
              a hierarchy, not one crowded run across the 248px sidebar. Both
              lines stay in the Montserrat display face (.display). */}
          <div
            className="display"
            style={{
              fontSize: 20,
              fontWeight: 700,
              color: T.ink,
              lineHeight: 1.15,
              letterSpacing: "-0.005em",
            }}
          >
            HMS <span style={{ color: T.accentDeep }}>Support</span>
          </div>
          <div
            className="display"
            style={{
              fontSize: 20,
              fontWeight: 400,
              color: T.sub,
              lineHeight: 1.15,
              letterSpacing: "0.02em",
            }}
          >
            Insights
          </div>
        </div>
      </div>

      <nav style={{ flex: 1, padding: "14px 10px 24px" }}>
        {NAV_GROUPS.map((group) => (
          <div key={group.label} style={{ marginTop: 16 }}>
            <div
              className="eyebrow"
              style={{
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
          <span className="eyebrow">Appearance</span>
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
        borderRadius: T.radiusSm,
        background: isActive ? T.accentTint : "transparent",
        color: isActive ? T.onAccentSoft : T.sub,
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
                borderRadius: T.radiusSm,
                background: T.accent,
              }}
            />
          )}
          <Icon size={14} strokeWidth={2.25} />
          {label}
        </>
      )}
    </FilterNavLink>
  );
}
