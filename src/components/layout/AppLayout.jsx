import { Outlet, NavLink } from "react-router-dom";
import {
  LayoutDashboard, ClipboardList,
  Clock, Inbox, TrendingUp, CalendarClock, CircleDot, Layers, Building2,
  Scale, Users, Ban,
  ExternalLink, BarChart3,
  Plug, Sparkles, Table, Mailbox, Settings,
} from "lucide-react";
import { T } from "../../lib/theme.js";
import { useAppData } from "../../lib/useAppData.js";
import { Shell } from "./Shell.jsx";
import { TopBar } from "./TopBar.jsx";
import { DataRetentionNotice } from "./DataRetentionNotice.jsx";

const NAV_GROUPS = [
  {
    label: "Overview",
    items: [
      { to: "/",             label: "Dashboard",    icon: LayoutDashboard },
      { to: "/update-queue", label: "Update Queue", icon: ClipboardList },
    ],
  },
  {
    label: "Performance",
    items: [
      { to: "/sla",        label: "SLA",          icon: Clock },
      { to: "/backlog",    label: "Open Backlog", icon: Inbox },
      { to: "/trends",     label: "Trends",       icon: TrendingUp },
      { to: "/cadence",    label: "Cadence",      icon: CalendarClock },
      { to: "/priority",   label: "Priority",     icon: CircleDot },
      { to: "/categories", label: "Categories",   icon: Layers },
      { to: "/accounts",   label: "Accounts",     icon: Building2 },
    ],
  },
  {
    label: "Team",
    items: [
      { to: "/workload",      label: "Workload",             icon: Scale },
      { to: "/team",          label: "Team",                 icon: Users },
      { to: "/jira-blockers", label: "Cases w/ Jira Blockers", icon: Ban },
    ],
  },
  {
    label: "Jira",
    items: [
      { to: "/jira",       label: "All HMS Jira's", icon: ExternalLink },
      { to: "/jira-stats", label: "Statistics",     icon: BarChart3 },
    ],
  },
  {
    label: "Tools",
    items: [
      { to: "/connections", label: "Connections", icon: Plug },
      { to: "/insights",    label: "Insights",    icon: Sparkles },
      { to: "/cases",       label: "Cases",       icon: Table },
      { to: "/surveys",     label: "Surveys",     icon: Mailbox },
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
  // Infor wordmark — lowercase, heavy weight, with the brand's signature
  // triangular tittle above the "i" (using the dotless ı + an SVG wedge so
  // there's no fight with the font's own dot).
  const wedgeW = height * 0.22;
  const wedgeH = height * 0.34;
  const wedgeLeft = height * 0.04;
  const wedgeTop = -height * 0.06;
  return (
    <div
      role="img"
      aria-label="Infor"
      style={{
        position: "relative",
        display: "inline-block",
        fontFamily: "Geist, system-ui, sans-serif",
        fontWeight: 900,
        fontSize: height,
        color: T.accent,
        letterSpacing: "-0.045em",
        lineHeight: 1,
        userSelect: "none",
      }}
    >
      <span
        aria-hidden
        style={{
          position: "absolute",
          left: wedgeLeft,
          top: wedgeTop,
          width: 0,
          height: 0,
          borderLeft: `${wedgeW}px solid ${T.accent}`,
          borderRight: 0,
          borderBottom: `${wedgeH}px solid transparent`,
        }}
      />
      <span style={{ fontFeatureSettings: '"ss01"' }}>ınfor</span>
    </div>
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
        <DataRetentionNotice importCount={importCount} storageBytes={storageBytes} />
      </div>
    </aside>
  );
}

function SidebarLink({ to, label, icon: Icon }) {
  return (
    <NavLink
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
    </NavLink>
  );
}
