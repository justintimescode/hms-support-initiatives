import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  RadialBarChart, RadialBar, LineChart, Line, ComposedChart, Legend,
} from "recharts";
import {
  RefreshCw, AlertTriangle, Clock, CheckCircle2, XCircle,
  User, Sparkles, TrendingUp, Activity, ListFilter, RotateCcw,
  Loader2, ClipboardList, Printer, LogOut, Wifi, WifiOff, TicketPlus,
} from "lucide-react";
import { enrichRow, priorityRank } from "./lib/enrich.js";
import { fetchCases, fetchAnalysts, logout } from "./lib/api.js";
import JiraTicketModal from "./components/JiraTicketModal.jsx";
import JiraTicketBadge from "./components/JiraTicketBadge.jsx";

/* ─── theme ─────────────────────────────────────────────────────────────── */
const T = {
  bg: "#F3EEE5", surface: "#FBF8F2", surfaceAlt: "#EFE8DB",
  ink: "#141311", sub: "#5C564A", muted: "#8A8270",
  border: "#D9D1BF", borderSoft: "#E8E0CE",
  accent: "#B8452C", accentSoft: "#E8C6B8",
  ok: "#3D6340", okSoft: "#C8D6BF",
  warn: "#B8801C", warnSoft: "#EBD3A0",
  danger: "#A23220", dangerSoft: "#E7B8AD",
  priorityCritical: "#A23220", priorityMajor: "#B8801C",
  priorityMedium: "#3D6340", priorityStandard: "#6B7A8F",
};

/* ─── helpers ────────────────────────────────────────────────────────────── */
const fmtDuration = (ms) => {
  if (ms == null || isNaN(ms)) return "—";
  const h = ms / 36e5;
  if (h < 1) return `${Math.round(ms / 6e4)}m`;
  if (h < 48) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
};

const priorityColor = (p) => {
  const r = priorityRank(p);
  return [null, T.priorityCritical, T.priorityMajor, T.priorityMedium, T.priorityStandard][r] || T.muted;
};

const startOfDay = (d) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
const startOfMonday = (d) => {
  const x = startOfDay(d);
  const off = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - off);
  return x;
};

const isoFromMs = (ms) => {
  if (ms == null) return "";
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
};
const msFromIso = (iso, endOfDay = false) => {
  if (!iso) return null;
  const [y,m,d] = iso.split("-").map(Number);
  if (!y||!m||!d) return null;
  const dt = new Date(y, m-1, d, 0,0,0,0);
  return endOfDay ? dt.getTime() + 864e5 - 1 : dt.getTime();
};

const filterByDate = (rows, from, to, field) => {
  if (from == null && to == null) return rows;
  return rows.filter((r) => {
    const d = r[field]; if (!d) return false;
    const t = d.getTime();
    if (from != null && t < from) return false;
    if (to != null && t > to) return false;
    return true;
  });
};

const previousWindow = (from, to) => {
  if (from == null || to == null) return { from: null, to: null };
  const len = to - from;
  return { from: from - len - 1, to: from - 1 };
};

/* ─── KPI computation ────────────────────────────────────────────────────── */
const computeKpis = (rows) => {
  const total = rows.length;
  const closed = rows.filter((r) => r._isClosed);
  const open = rows.filter((r) => !r._isClosed);
  const slaEligible = rows.filter((r) => r.made_sla !== "" && r.made_sla != null);
  const slaMet = slaEligible.filter((r) => r._madeSla).length;
  const slaRate = slaEligible.length ? (slaMet / slaEligible.length) * 100 : null;
  const resolved = closed.filter((r) => r._resolvedMs != null);
  const avgRes = resolved.length ? resolved.reduce((s,r) => s + r._resolvedMs, 0) / resolved.length : null;
  const frt = rows.filter((r) => r._frtMs != null);
  const avgFrt = frt.length ? frt.reduce((s,r) => s + r._frtMs, 0) / frt.length : null;
  const now = new Date();
  const atRisk = open.filter((r) => r._slaDue && r._slaDue > now && r._slaDue - now < 24*36e5);
  const breached = open.filter((r) => r._slaDue && r._slaDue < now);
  return { total, closed: closed.length, open: open.length, slaRate, slaMet, slaEligible: slaEligible.length, avgRes, avgFrt, atRisk, breached };
};

const topCounts = (rows, getKey, n = 5) => {
  const g = {};
  for (const r of rows) { const k = getKey(r) || "Unknown"; g[k] = (g[k]||0)+1; }
  return Object.entries(g).map(([name,count]) => ({name,count})).sort((a,b) => b.count-a.count).slice(0,n);
};

const priorityMix = (rows) => {
  const g = {};
  for (const r of rows) { const p = r.priority||"Unknown"; g[p] = (g[p]||0)+1; }
  return Object.entries(g)
    .map(([priority,count]) => ({priority,count,color:priorityColor(priority)}))
    .sort((a,b) => priorityRank(a.priority)-priorityRank(b.priority));
};

const percentile = (sorted, p) => {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const rank = (p/100)*(sorted.length-1);
  const lo = Math.floor(rank), hi = Math.ceil(rank);
  if (lo===hi) return sorted[lo];
  return sorted[lo] + (sorted[hi]-sorted[lo])*(rank-lo);
};

const resolutionDistribution = (rows) => {
  const g = {};
  for (const r of rows) {
    if (!r._isClosed || r._resolvedMs == null) continue;
    const p = r.priority||"Unknown";
    (g[p] = g[p]||[]).push(r._resolvedMs);
  }
  return Object.entries(g).map(([priority,values]) => {
    values.sort((a,b) => a-b);
    return {
      priority, n: values.length,
      p50_h: percentile(values,50)/36e5,
      p90_h: percentile(values,90)/36e5,
      color: priorityColor(priority),
    };
  }).sort((a,b) => priorityRank(a.priority)-priorityRank(b.priority));
};

const AGING_BUCKETS = [
  {name:"0–7d",min:0,max:7},{name:"8–30d",min:8,max:30},
  {name:"31–90d",min:31,max:90},{name:"90d+",min:91,max:Infinity},
];
const agingBuckets = (rows) => {
  const now = Date.now();
  const counts = AGING_BUCKETS.map((b) => ({name:b.name,count:0}));
  for (const r of rows) {
    if (r._isClosed || !r._created) continue;
    const days = Math.floor((now - r._created.getTime()) / 864e5);
    const idx = AGING_BUCKETS.findIndex((b) => days >= b.min && days <= b.max);
    if (idx >= 0) counts[idx].count++;
  }
  return counts;
};

const SLA_RISK_BUCKETS = [
  {key:"breached",label:"Breached",color:"#A23220"},
  {key:"due24",label:"Due < 24h",color:"#B8452C"},
  {key:"dueWeek",label:"Due this week",color:"#B8801C"},
  {key:"comfortable",label:"Comfortable",color:"#3D6340"},
  {key:"noSla",label:"No SLA",color:"#8A8270"},
];
const slaRiskSegments = (rows) => {
  const now = Date.now();
  const counts = Object.fromEntries(SLA_RISK_BUCKETS.map((b) => [b.key,0]));
  for (const r of rows) {
    if (r._isClosed) continue;
    if (!r._slaDue) { counts.noSla++; continue; }
    const ms = r._slaDue.getTime() - now;
    if (ms < 0) counts.breached++;
    else if (ms < 24*36e5) counts.due24++;
    else if (ms < 7*24*36e5) counts.dueWeek++;
    else counts.comfortable++;
  }
  return SLA_RISK_BUCKETS.map((b) => ({...b,count:counts[b.key]}));
};

const weeklyIntakeResolved = (rows) => {
  if (!rows.length) return [];
  let minDate = null, maxDate = null;
  const now = new Date();
  for (const r of rows) {
    if (r._created && (!minDate || r._created < minDate)) minDate = r._created;
    const ref = r._closed || now;
    if (!maxDate || ref > maxDate) maxDate = ref;
  }
  if (!minDate || !maxDate) return [];
  const startWeek = startOfMonday(minDate);
  const endWeek = startOfMonday(maxDate);
  const totalWeeks = Math.floor((endWeek - startWeek) / (7*864e5)) + 1;
  if (totalWeeks > 520) return [];
  const buckets = new Map();
  for (let i = 0; i < totalWeeks; i++) {
    const wk = new Date(startWeek); wk.setDate(wk.getDate() + i*7);
    buckets.set(wk.getTime(), {week:wk.getTime(),created:0,resolved:0});
  }
  for (const r of rows) {
    if (r._created) { const k = startOfMonday(r._created).getTime(); const b = buckets.get(k); if (b) b.created++; }
    if (r._closed)  { const k = startOfMonday(r._closed).getTime();  const b = buckets.get(k); if (b) b.resolved++; }
  }
  const arr = Array.from(buckets.values()).sort((a,b) => a.week-b.week);
  for (let i = 0; i < arr.length; i++) {
    let s=0,n=0;
    for (let j=Math.max(0,i-3);j<=i;j++){s+=arr[j].created-arr[j].resolved;n++;}
    arr[i].rollingNet = n ? Math.round((s/n)*10)/10 : 0;
    arr[i].net = arr[i].created - arr[i].resolved;
  }
  return arr;
};

const dailyTrajectory = (rows) => {
  if (!rows.length) return [];
  let minCreated=null, maxEnd=null;
  const now = new Date();
  for (const r of rows) {
    if (r._created && (!minCreated||r._created<minCreated)) minCreated=r._created;
    const end = r._closed||now;
    if (!maxEnd||end>maxEnd) maxEnd=end;
  }
  if (!minCreated||!maxEnd) return [];
  const start = startOfDay(minCreated);
  const end = startOfDay(maxEnd);
  const totalDays = Math.floor((end-start)/864e5)+1;
  if (totalDays>730) return []; // cap at 2 years for perf
  const out=[];
  const cursor = new Date(start);
  for (let i=0;i<totalDays;i++) {
    const dayStart=cursor.getTime(), dayEnd=dayStart+864e5;
    let open=0,created=0,closed=0;
    for (const r of rows) {
      if (r._created) {
        const ct=r._created.getTime();
        if (ct>=dayStart&&ct<dayEnd) created++;
        if (ct<dayEnd&&(!r._closed||r._closed.getTime()>=dayStart)) {
          if (!(!r._closed&&r._isClosed)) open++;
        }
      }
      if (r._closed){const xt=r._closed.getTime();if(xt>=dayStart&&xt<dayEnd)closed++;}
    }
    out.push({date:dayStart,open,created,closed});
    cursor.setDate(cursor.getDate()+1);
  }
  return out;
};

/* ─── date presets ───────────────────────────────────────────────────────── */
const PRESETS = [
  {key:"all",label:"All-time"},{key:"ytd",label:"YTD"},
  {key:"qtr",label:"Last 90d"},{key:"30d",label:"Last 30d"},
  {key:"7d",label:"Last 7d"},{key:"custom",label:"Custom"},
];
const presetRange = (key, ref=new Date()) => {
  const s = startOfDay(ref);
  const end = s.getTime()+864e5-1;
  switch(key){
    case "7d":  return {from:s.getTime()-6*864e5,to:end};
    case "30d": return {from:s.getTime()-29*864e5,to:end};
    case "qtr": return {from:s.getTime()-89*864e5,to:end};
    case "ytd": return {from:new Date(s.getFullYear(),0,1).getTime(),to:end};
    default:    return {from:null,to:null};
  }
};
const matchPreset = (from,to) => {
  if (from==null&&to==null) return "all";
  for (const p of PRESETS){
    if (p.key==="all"||p.key==="custom") continue;
    const r=presetRange(p.key);
    if (Math.abs(r.from-from)<60000&&Math.abs(r.to-to)<60000) return p.key;
  }
  return "custom";
};

/* ─── URL state ──────────────────────────────────────────────────────────── */
const PAGE_KEYS = ["overview","sla","trends","mix","team","ai","cases"];
const parseUrl = () => {
  if (typeof window==="undefined") return {};
  const p = new URLSearchParams(window.location.search);
  const page = p.get("page");
  return {
    from: msFromIso(p.get("from"),false),
    to:   msFromIso(p.get("to"),true),
    field: p.get("field")==="closed" ? "_closed" : "_created",
    analyst: p.get("analyst")||null,
    compare: p.get("compare")==="1",
    page: PAGE_KEYS.includes(page)?page:null,
  };
};
const writeUrl = ({from,to,field,analyst,compare,page}) => {
  if (typeof window==="undefined") return;
  const p = new URLSearchParams();
  if (page&&page!=="overview") p.set("page",page);
  if (from!=null) p.set("from",isoFromMs(from));
  if (to!=null)   p.set("to",isoFromMs(to));
  if (field==="_closed") p.set("field","closed");
  if (analyst&&analyst!=="__all__") p.set("analyst",analyst);
  if (compare) p.set("compare","1");
  const qs=p.toString();
  window.history.replaceState(null,"",window.location.pathname+(qs?"?"+qs:""));
};

/* ─── small UI primitives ────────────────────────────────────────────────── */
const Card = ({children,style={}}) => (
  <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,padding:16,...style}}>
    {children}
  </div>
);

const Section = ({title,subtitle,children}) => (
  <div style={{marginBottom:28}}>
    <div style={{marginBottom:12}}>
      <h2 style={{fontSize:17,fontWeight:600,color:T.ink,margin:0}}>{title}</h2>
      {subtitle && <p style={{fontSize:13,color:T.sub,marginTop:3}}>{subtitle}</p>}
    </div>
    {children}
  </div>
);

const Badge = ({children,color=T.muted,bg}) => (
  <span style={{
    display:"inline-flex",alignItems:"center",gap:4,
    fontSize:11,fontWeight:600,padding:"2px 7px",borderRadius:99,
    color,background:bg||color+"22",
  }}>{children}</span>
);

const DeltaBadge = ({curr,prev,fmt=fmtDuration,higherIsBetter=true}) => {
  if (prev==null||curr==null) return null;
  const delta = curr-prev;
  if (Math.abs(delta)<0.001) return null;
  const good = higherIsBetter ? delta>0 : delta<0;
  const sign = delta>0?"+":"";
  return (
    <span style={{fontSize:11,fontWeight:600,color:good?T.ok:T.danger,marginLeft:6}}>
      {sign}{fmt(delta)}
    </span>
  );
};

const Spinner = ({size=18}) => (
  <Loader2 size={size} style={{animation:"spin 1s linear infinite"}} />
);

/* ─── KPI card row ───────────────────────────────────────────────────────── */
const KpiCard = ({icon:Icon,label,value,sub,color=T.ink,iconColor,onCreateJira,jiraTicket}) => (
  <Card style={{display:"flex",flexDirection:"column",gap:6,minWidth:0}}>
    <div style={{display:"flex",alignItems:"center",gap:8}}>
      <div style={{
        width:32,height:32,borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",
        background:(iconColor||color)+"18",flexShrink:0,
      }}>
        <Icon size={16} color={iconColor||color} />
      </div>
      <span style={{fontSize:12,color:T.sub,fontWeight:500,flex:1}}>{label}</span>
      {onCreateJira && !jiraTicket && (
        <button
          onClick={onCreateJira}
          title="Create Jira Ticket"
          aria-label={`Create Jira ticket for ${label}`}
          style={{
            background:"none",border:"none",cursor:"pointer",padding:2,
            color:T.muted,display:"flex",alignItems:"center",
            borderRadius:4,flexShrink:0,
          }}
          onMouseEnter={(e)=>e.currentTarget.style.color=T.accent}
          onMouseLeave={(e)=>e.currentTarget.style.color=T.muted}
        >
          <TicketPlus size={13}/>
        </button>
      )}
    </div>
    <div style={{fontSize:26,fontWeight:700,color,lineHeight:1}}>{value}</div>
    {sub && <div style={{fontSize:12,color:T.muted}}>{sub}</div>}
    {jiraTicket && (
      <div style={{marginTop:2}}>
        <JiraTicketBadge
          ticketKey={jiraTicket.key}
          ticketUrl={jiraTicket.url}
          status={jiraTicket.status}
          statusCategory={jiraTicket.statusCategory}
        />
      </div>
    )}
  </Card>
);

const KpiRow = ({kpis,compareKpis}) => {
  const pct = (n,d) => d ? `${((n/d)*100).toFixed(1)}%` : "—";
  return (
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:12}}>
      <KpiCard icon={ClipboardList} label="Total Cases" value={kpis.total}
        sub={compareKpis?<DeltaBadge curr={kpis.total} prev={compareKpis.total} fmt={(d)=>d>0?`+${d}`:String(d)} higherIsBetter={false}/>:null}
        color={T.ink} iconColor={T.accent} />
      <KpiCard icon={Activity} label="Open" value={kpis.open}
        color={kpis.open>0?T.warn:T.ok} iconColor={kpis.open>0?T.warn:T.ok} />
      <KpiCard icon={CheckCircle2} label="Closed" value={kpis.closed}
        color={T.ok} iconColor={T.ok} />
      <KpiCard icon={TrendingUp} label="SLA Rate"
        value={kpis.slaRate!=null?`${kpis.slaRate.toFixed(1)}%`:"—"}
        sub={`${kpis.slaMet}/${kpis.slaEligible} eligible`}
        color={kpis.slaRate!=null?(kpis.slaRate>=90?T.ok:kpis.slaRate>=75?T.warn:T.danger):T.muted}
        iconColor={kpis.slaRate!=null?(kpis.slaRate>=90?T.ok:kpis.slaRate>=75?T.warn:T.danger):T.muted} />
      <KpiCard icon={Clock} label="Avg Resolution" value={fmtDuration(kpis.avgRes)}
        color={T.ink} iconColor={T.accent} />
      <KpiCard icon={Clock} label="Avg First Response" value={fmtDuration(kpis.avgFrt)}
        color={T.ink} iconColor={T.accent} />
      <KpiCard icon={AlertTriangle} label="SLA Breached" value={kpis.breached.length}
        color={kpis.breached.length>0?T.danger:T.ok}
        iconColor={kpis.breached.length>0?T.danger:T.ok} />
      <KpiCard icon={AlertTriangle} label="At Risk (24h)" value={kpis.atRisk.length}
        color={kpis.atRisk.length>0?T.warn:T.ok}
        iconColor={kpis.atRisk.length>0?T.warn:T.ok} />
    </div>
  );
};

/* ─── SLA radial ─────────────────────────────────────────────────────────── */
const SlaRadial = ({rate}) => {
  if (rate==null) return <div style={{color:T.muted,fontSize:13}}>No SLA data</div>;
  const color = rate>=90?T.ok:rate>=75?T.warn:T.danger;
  const data = [{value:rate,fill:color},{value:100-rate,fill:T.borderSoft}];
  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
      <div style={{position:"relative",width:140,height:140}}>
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart innerRadius={50} outerRadius={68} startAngle={90} endAngle={-270} data={data} barSize={14}>
            <RadialBar dataKey="value" cornerRadius={7} background={false} />
          </RadialBarChart>
        </ResponsiveContainer>
        <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
          <span style={{fontSize:22,fontWeight:700,color}}>{rate.toFixed(1)}%</span>
          <span style={{fontSize:11,color:T.muted}}>SLA met</span>
        </div>
      </div>
    </div>
  );
};

/* ─── Case table ─────────────────────────────────────────────────────────── */
const CaseTable = ({rows}) => {
  const [search,setSearch] = useState("");
  const [sortKey,setSortKey] = useState("_created");
  const [sortDir,setSortDir] = useState(-1);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return rows.filter((r) =>
      !q ||
      (r.number||"").toLowerCase().includes(q) ||
      (r.short_description||"").toLowerCase().includes(q) ||
      (r.assigned_to||"").toLowerCase().includes(q) ||
      (r.account||"").toLowerCase().includes(q)
    );
  },[rows,search]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a,b) => {
      const av=a[sortKey], bv=b[sortKey];
      if (av==null&&bv==null) return 0;
      if (av==null) return 1; if (bv==null) return -1;
      if (av instanceof Date) return sortDir*(av-bv);
      if (typeof av==="number") return sortDir*(av-bv);
      return sortDir*String(av).localeCompare(String(bv));
    });
  },[filtered,sortKey,sortDir]);

  const col = (key,label,width) => {
    const active = sortKey===key;
    return (
      <th key={key} onClick={()=>{if(active)setSortDir(-sortDir);else{setSortKey(key);setSortDir(-1);}}}
        style={{padding:"8px 10px",textAlign:"left",fontSize:12,fontWeight:600,color:active?T.accent:T.sub,
          cursor:"pointer",whiteSpace:"nowrap",width,borderBottom:`1px solid ${T.border}`,background:T.surfaceAlt}}>
        {label}{active?(sortDir===-1?" ↓":" ↑"):""}
      </th>
    );
  };

  return (
    <div>
      <div style={{marginBottom:10}}>
        <input value={search} onChange={(e)=>setSearch(e.target.value)}
          placeholder="Search cases…"
          style={{width:"100%",maxWidth:360,padding:"7px 12px",border:`1px solid ${T.border}`,
            borderRadius:6,fontSize:13,background:T.surface,color:T.ink,outline:"none"}} />
      </div>
      <div style={{overflowX:"auto",borderRadius:8,border:`1px solid ${T.border}`}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
          <thead>
            <tr>
              {col("number","Number",90)}
              {col("_created","Created",110)}
              {col("priority","Priority",90)}
              {col("state","State",90)}
              {col("assigned_to","Assigned To",140)}
              {col("account","Account",140)}
              {col("_category","Category",150)}
              {col("_resolvedMs","Resolution",100)}
              <th style={{padding:"8px 10px",fontSize:12,fontWeight:600,color:T.sub,
                borderBottom:`1px solid ${T.border}`,background:T.surfaceAlt}}>Description</th>
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0,500).map((r,i) => (
              <tr key={r.number||i} style={{background:i%2===0?T.surface:T.bg,borderBottom:`1px solid ${T.borderSoft}`}}>
                <td style={{padding:"7px 10px",fontWeight:600,color:T.accent,whiteSpace:"nowrap"}}>{r.number||"—"}</td>
                <td style={{padding:"7px 10px",whiteSpace:"nowrap",color:T.sub}}>
                  {r._created?r._created.toLocaleDateString():"—"}
                </td>
                <td style={{padding:"7px 10px"}}>
                  <span style={{fontSize:11,fontWeight:600,color:priorityColor(r.priority),
                    background:priorityColor(r.priority)+"22",padding:"2px 7px",borderRadius:99}}>
                    {r.priority||"—"}
                  </span>
                </td>
                <td style={{padding:"7px 10px",color:r._isClosed?T.ok:T.warn,fontWeight:500}}>{r.state||"—"}</td>
                <td style={{padding:"7px 10px",color:T.sub}}>{r.assigned_to||"—"}</td>
                <td style={{padding:"7px 10px",color:T.sub}}>{r.account||"—"}</td>
                <td style={{padding:"7px 10px",color:T.sub}}>{r._category||"—"}</td>
                <td style={{padding:"7px 10px",color:T.sub,whiteSpace:"nowrap"}}>{fmtDuration(r._resolvedMs)}</td>
                <td style={{padding:"7px 10px",color:T.sub,maxWidth:300,overflow:"hidden",
                  textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                  {r.short_description||"—"}
                </td>
              </tr>
            ))}
            {sorted.length===0&&(
              <tr><td colSpan={9} style={{padding:24,textAlign:"center",color:T.muted}}>No cases match the current filters.</td></tr>
            )}
          </tbody>
        </table>
        {sorted.length>500&&(
          <div style={{padding:"8px 12px",fontSize:12,color:T.muted,borderTop:`1px solid ${T.border}`}}>
            Showing first 500 of {sorted.length} results.
          </div>
        )}
      </div>
    </div>
  );
};

/* ─── Jira blockers block ────────────────────────────────────────────────── */
const JiraBlock = ({rows}) => {
  const blocked = useMemo(() => rows.filter((r) => !r._isClosed && r._jiraActiveTickets?.length > 0), [rows]);
  if (!blocked.length) return (
    <Card><p style={{color:T.muted,fontSize:13}}>No open cases with active Jira blockers.</p></Card>
  );
  return (
    <div style={{display:"flex",flexDirection:"column",gap:8}}>
      {blocked.map((r) => (
        <Card key={r.number} style={{display:"flex",flexDirection:"column",gap:6}}>
          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
            <span style={{fontWeight:600,color:T.accent,fontSize:13}}>{r.number}</span>
            <span style={{fontSize:12,color:priorityColor(r.priority),fontWeight:600,
              background:priorityColor(r.priority)+"22",padding:"1px 6px",borderRadius:99}}>
              {r.priority||"—"}
            </span>
            <span style={{fontSize:12,color:T.sub}}>{r.assigned_to||"Unassigned"}</span>
            {r._jiraDaysSinceLinked!=null&&(
              <Badge color={r._jiraDaysSinceLinked>30?T.danger:T.warn}>
                Linked {r._jiraDaysSinceLinked}d ago
              </Badge>
            )}
          </div>
          <div style={{fontSize:13,color:T.ink}}>{r.short_description||"—"}</div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            {r._jiraActiveTickets.map((id) => (
              <a key={id} href={`https://infor.atlassian.net/browse/${id}`} target="_blank" rel="noreferrer"
                style={{fontSize:11,fontWeight:600,color:T.accent,background:T.accentSoft,
                  padding:"2px 8px",borderRadius:99,textDecoration:"none"}}>
                {id} ↗
              </a>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
};

/* ─── AI insights block ──────────────────────────────────────────────────── */
const AiBlock = ({state,run,hasData}) => (
  <Card>
    {state.loading && (
      <div style={{display:"flex",alignItems:"center",gap:10,color:T.sub}}>
        <Spinner /> <span style={{fontSize:13}}>Analyzing cases…</span>
      </div>
    )}
    {!state.loading && !state.result && !state.error && (
      <div style={{display:"flex",flexDirection:"column",gap:12,alignItems:"flex-start"}}>
        <p style={{fontSize:13,color:T.sub,maxWidth:520}}>
          Samples up to 50 cases (short description + resolution notes, anonymized) and asks Claude
          for a qualitative read: recurring themes, knowledge-base gaps, and things to watch.
        </p>
        <button onClick={run} disabled={!hasData}
          style={{display:"flex",alignItems:"center",gap:8,padding:"8px 18px",
            background:T.accent,color:"#fff",border:"none",borderRadius:6,
            fontSize:13,fontWeight:600,opacity:hasData?1:0.5}}>
          <Sparkles size={15}/> Run analysis
        </button>
      </div>
    )}
    {state.error && (
      <div style={{color:T.danger,fontSize:13}}>
        <strong>Error:</strong> {state.error}
        <button onClick={run} style={{marginLeft:12,fontSize:12,color:T.accent,background:"none",border:"none",textDecoration:"underline"}}>
          Retry
        </button>
      </div>
    )}
    {state.result && (
      <div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <span style={{fontSize:12,color:T.muted}}>Analysis complete</span>
          <button onClick={run} style={{fontSize:12,color:T.accent,background:"none",border:"none",textDecoration:"underline",cursor:"pointer"}}>
            Re-run
          </button>
        </div>
        <div style={{fontSize:13,color:T.ink,lineHeight:1.7,whiteSpace:"pre-wrap"}}>{state.result}</div>
      </div>
    )}
  </Card>
);

/* ─── Toolbar ────────────────────────────────────────────────────────────── */
const Toolbar = ({dateRange,setDateRange,compareOn,setCompareOn,onRefresh,loading,lastFetched}) => {
  const [customFrom,setCustomFrom] = useState(isoFromMs(dateRange.from));
  const [customTo,setCustomTo]     = useState(isoFromMs(dateRange.to));

  const applyPreset = (key) => {
    if (key==="custom") { setDateRange((d)=>({...d,preset:"custom"})); return; }
    const r = presetRange(key);
    setDateRange({preset:key,from:r.from,to:r.to,field:dateRange.field});
  };

  const applyCustom = () => {
    const from = msFromIso(customFrom,false);
    const to   = msFromIso(customTo,true);
    setDateRange({preset:"custom",from,to,field:dateRange.field});
  };

  return (
    <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",
      padding:"10px 16px",background:T.surface,borderBottom:`1px solid ${T.border}`}}>
      {/* preset buttons */}
      <div style={{display:"flex",gap:4}}>
        {PRESETS.filter((p)=>p.key!=="custom").map((p)=>(
          <button key={p.key} onClick={()=>applyPreset(p.key)}
            style={{padding:"4px 10px",fontSize:12,fontWeight:500,borderRadius:5,border:"none",cursor:"pointer",
              background:dateRange.preset===p.key?T.accent:T.surfaceAlt,
              color:dateRange.preset===p.key?"#fff":T.sub}}>
            {p.label}
          </button>
        ))}
      </div>

      {/* custom date inputs */}
      <div style={{display:"flex",alignItems:"center",gap:4}}>
        <input type="date" value={customFrom} onChange={(e)=>setCustomFrom(e.target.value)}
          style={{fontSize:12,padding:"3px 6px"}} />
        <span style={{fontSize:12,color:T.muted}}>–</span>
        <input type="date" value={customTo} onChange={(e)=>setCustomTo(e.target.value)}
          style={{fontSize:12,padding:"3px 6px"}} />
        <button onClick={applyCustom}
          style={{padding:"4px 10px",fontSize:12,fontWeight:500,borderRadius:5,border:"none",
            background:T.surfaceAlt,color:T.sub,cursor:"pointer"}}>
          Apply
        </button>
      </div>

      {/* date field toggle */}
      <div style={{display:"flex",gap:4}}>
        {[{k:"_created",l:"Created"},{k:"_closed",l:"Closed"}].map(({k,l})=>(
          <button key={k} onClick={()=>setDateRange((d)=>({...d,field:k}))}
            style={{padding:"4px 10px",fontSize:12,fontWeight:500,borderRadius:5,border:"none",cursor:"pointer",
              background:dateRange.field===k?T.ink:T.surfaceAlt,
              color:dateRange.field===k?"#fff":T.sub}}>
            {l}
          </button>
        ))}
      </div>

      {/* compare toggle */}
      <button onClick={()=>setCompareOn((v)=>!v)}
        style={{padding:"4px 10px",fontSize:12,fontWeight:500,borderRadius:5,border:"none",cursor:"pointer",
          background:compareOn?T.warn:T.surfaceAlt,color:compareOn?"#fff":T.sub}}>
        Compare
      </button>

      <div style={{flex:1}}/>

      {/* last fetched */}
      {lastFetched && (
        <span style={{fontSize:11,color:T.muted}}>
          Updated {lastFetched.toLocaleTimeString()}
        </span>
      )}

      {/* refresh */}
      <button onClick={onRefresh} disabled={loading}
        style={{display:"flex",alignItems:"center",gap:6,padding:"5px 12px",
          background:T.accent,color:"#fff",border:"none",borderRadius:6,
          fontSize:12,fontWeight:600,opacity:loading?0.6:1,cursor:loading?"not-allowed":"pointer"}}>
        {loading?<Spinner size={13}/>:<RefreshCw size={13}/>}
        {loading?"Loading…":"Refresh"}
      </button>
    </div>
  );
};

/* ─── Nav tabs ───────────────────────────────────────────────────────────── */
const NavTabs = ({page,setPage,isTeam}) => {
  const tabs = [
    {key:"overview",label:"Overview"},
    {key:"sla",label:"SLA"},
    {key:"trends",label:"Trends"},
    {key:"mix",label:"Priority"},
    ...(isTeam?[{key:"team",label:"Team"}]:[]),
    {key:"jira",label:"Jira Blockers"},
    {key:"ai",label:"AI Insights"},
    {key:"cases",label:"Cases"},
  ];
  return (
    <div style={{display:"flex",gap:2,padding:"0 16px",borderBottom:`1px solid ${T.border}`,
      background:T.surface,overflowX:"auto"}}>
      {tabs.map((t)=>(
        <button key={t.key} onClick={()=>setPage(t.key)}
          style={{padding:"10px 14px",fontSize:13,fontWeight:500,border:"none",cursor:"pointer",
            background:"none",color:page===t.key?T.accent:T.sub,
            borderBottom:page===t.key?`2px solid ${T.accent}`:"2px solid transparent",
            whiteSpace:"nowrap"}}>
          {t.label}
        </button>
      ))}
    </div>
  );
};

/* ─── Main KpiAnalyzer component ─────────────────────────────────────────── */
export default function KpiAnalyzer() {
  const initialUrl = useMemo(() => parseUrl(), []);

  // ── data state ──
  const [allRows, setAllRows]       = useState([]);
  const [analysts, setAnalysts]     = useState([]);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState(null);
  const [lastFetched, setLastFetched] = useState(null);

  // ── filter state ──
  const [analyst, setAnalyst]       = useState(initialUrl.analyst || "__all__");
  const [view, setView]             = useState(initialUrl.analyst ? "individual" : "team");
  const [dateRange, setDateRange]   = useState({
    preset: matchPreset(initialUrl.from ?? null, initialUrl.to ?? null),
    from: initialUrl.from ?? null,
    to:   initialUrl.to   ?? null,
    field: initialUrl.field || "_created",
  });
  const [compareOn, setCompareOn]   = useState(!!initialUrl.compare);
  const [page, setPage]             = useState(initialUrl.page || "overview");

  // ── AI state ──
  const [aiState, setAiState]       = useState({loading:false,result:null,error:null});

  // ── sync URL ──
  useEffect(() => {
    writeUrl({from:dateRange.from,to:dateRange.to,field:dateRange.field,analyst,compare:compareOn,page});
  }, [dateRange,analyst,compareOn,page]);

  // ── guard: individual view can't show team tab ──
  useEffect(() => {
    if (view==="individual" && page==="team") setPage("overview");
  }, [view, page]);

  // ── fetch analysts on mount ──
  useEffect(() => {
    fetchAnalysts()
      .then((d) => setAnalysts(d.analysts || []))
      .catch(() => {});
  }, []);

  // ── fetch cases whenever filters change ──
  const loadCases = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { rows } = await fetchCases({
        from: dateRange.from,
        to:   dateRange.to,
        field: dateRange.field,
        analyst: analyst !== "__all__" ? analyst : undefined,
      });
      setAllRows(rows);
      setLastFetched(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [dateRange, analyst]);

  useEffect(() => { loadCases(); }, [loadCases]);

  // ── enrichment ──
  const enrichedAll = useMemo(() => allRows.map(enrichRow), [allRows]);

  const enriched = useMemo(
    () => filterByDate(enrichedAll, dateRange.from, dateRange.to, dateRange.field),
    [enrichedAll, dateRange]
  );

  const compareWindow = useMemo(() => {
    if (!compareOn || dateRange.from == null || dateRange.to == null) return null;
    return previousWindow(dateRange.from, dateRange.to);
  }, [compareOn, dateRange]);

  const compareEnriched = useMemo(() => {
    if (!compareWindow) return null;
    return filterByDate(enrichedAll, compareWindow.from, compareWindow.to, dateRange.field);
  }, [enrichedAll, compareWindow, dateRange.field]);

  const kpis        = useMemo(() => computeKpis(enriched), [enriched]);
  const compareKpis = useMemo(() => compareEnriched ? computeKpis(compareEnriched) : null, [compareEnriched]);

  // ── team members ──
  const teamMembers = useMemo(() => {
    const groups = new Map();
    for (const r of enriched) {
      const name = r.assigned_to || "Unassigned";
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(r);
    }
    return [...groups.entries()]
      .map(([name, rows]) => ({name, rows, kpis: computeKpis(rows)}))
      .sort((a,b) => b.kpis.total - a.kpis.total);
  }, [enriched]);

  // ── derived chart data ──
  const priorityData    = useMemo(() => priorityMix(enriched), [enriched]);
  const categoryData    = useMemo(() => topCounts(enriched, (r) => r._category, 8), [enriched]);
  const accountData     = useMemo(() => topCounts(enriched, (r) => r.account, 8), [enriched]);
  const slaRisk         = useMemo(() => slaRiskSegments(enriched), [enriched]);
  const aging           = useMemo(() => agingBuckets(enriched), [enriched]);
  const resDist         = useMemo(() => resolutionDistribution(enriched), [enriched]);
  const weeklyData      = useMemo(() => weeklyIntakeResolved(enriched), [enriched]);
  const dailyData       = useMemo(() => dailyTrajectory(enriched), [enriched]);

  // ── AI analysis ──
  const runAiAnalysis = async () => {
    setAiState({loading:true,result:null,error:null});
    try {
      const sample = enriched.slice(0,50).map((r) => ({
        priority: r.priority,
        state: r.state,
        category: r._category,
        description: (r.short_description||"").slice(0,120),
        resolution: (r.close_notes||"").slice(0,120),
        resolvedH: r._resolvedMs ? (r._resolvedMs/36e5).toFixed(1) : null,
        madeSla: r._madeSla,
      }));
      const res = await fetch("/api/ai-insights", {
        method: "POST",
        credentials: "include",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({cases: sample, scope: view==="individual" ? analyst : "team"}),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setAiState({loading:false,result:data.insight,error:null});
    } catch (e) {
      setAiState({loading:false,result:null,error:e.message});
    }
  };

  // ── chart tooltip formatter ──
  const fmtWeekLabel = (ts) => {
    if (!ts) return "";
    const d = new Date(ts);
    return `${d.toLocaleDateString(undefined,{month:"short",day:"numeric"})}`;
  };

  // ── render ──
  return (
    <div style={{minHeight:"100vh",background:T.bg,display:"flex",flexDirection:"column"}}>
      {/* ── header ── */}
      <div style={{background:T.surface,borderBottom:`1px solid ${T.border}`,
        padding:"12px 20px",display:"flex",alignItems:"center",gap:12}} className="no-print">
        <div style={{flex:1}}>
          <h1 style={{fontSize:18,fontWeight:700,color:T.ink,margin:0}}>ServiceNow Live Analytics</h1>
          <p style={{fontSize:12,color:T.muted,margin:0}}>
            {loading ? "Fetching…" : `${enriched.length.toLocaleString()} cases`}
            {lastFetched && ` · ${lastFetched.toLocaleTimeString()}`}
          </p>
        </div>

        {/* analyst selector */}
        <div style={{display:"flex",alignItems:"center",gap:6}}>
          <User size={14} color={T.muted}/>
          <select value={analyst} onChange={(e)=>{
              const v=e.target.value;
              setAnalyst(v);
              setView(v==="__all__"?"team":"individual");
            }}
            style={{fontSize:13,padding:"5px 8px",border:`1px solid ${T.border}`,
              borderRadius:6,background:T.surface,color:T.ink,cursor:"pointer"}}>
            <option value="__all__">All Analysts</option>
            {analysts.map((a)=><option key={a} value={a}>{a}</option>)}
          </select>
        </div>

        {/* connection status */}
        <div style={{display:"flex",alignItems:"center",gap:4}}>
          {error
            ? <><WifiOff size={14} color={T.danger}/><span style={{fontSize:12,color:T.danger}}>Error</span></>
            : <><Wifi size={14} color={T.ok}/><span style={{fontSize:12,color:T.ok}}>Live</span></>
          }
        </div>

        <button onClick={logout}
          style={{display:"flex",alignItems:"center",gap:6,padding:"5px 12px",
            background:T.surfaceAlt,color:T.sub,border:`1px solid ${T.border}`,
            borderRadius:6,fontSize:12,fontWeight:500}}>
          <LogOut size={13}/> Sign out
        </button>
      </div>

      {/* ── toolbar ── */}
      <div className="no-print">
        <Toolbar
          dateRange={dateRange} setDateRange={setDateRange}
          compareOn={compareOn} setCompareOn={setCompareOn}
          onRefresh={loadCases} loading={loading} lastFetched={lastFetched}
        />
      </div>

      {/* ── nav tabs ── */}
      <div className="no-print">
        <NavTabs page={page} setPage={setPage} isTeam={view==="team"} />
      </div>

      {/* ── error banner ── */}
      {error && (
        <div style={{background:T.dangerSoft,borderBottom:`1px solid ${T.danger}`,
          padding:"10px 20px",fontSize:13,color:T.danger,display:"flex",alignItems:"center",gap:8}}>
          <AlertTriangle size={14}/> {error}
          <button onClick={loadCases} style={{marginLeft:8,fontSize:12,color:T.danger,
            background:"none",border:"none",textDecoration:"underline",cursor:"pointer"}}>
            Retry
          </button>
        </div>
      )}

      {/* ── loading overlay ── */}
      {loading && !allRows.length && (
        <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:12,color:T.sub}}>
          <Spinner size={22}/> <span style={{fontSize:15}}>Loading cases from ServiceNow…</span>
        </div>
      )}

      {/* ── main content ── */}
      {(!loading || allRows.length > 0) && (
        <div style={{flex:1,padding:"20px",maxWidth:1400,width:"100%",margin:"0 auto"}}>

          {/* OVERVIEW */}
          {page==="overview" && (
            <div className="print-section">
              <Section title="At a Glance"
                subtitle={view==="individual"
                  ? `Top-line numbers for ${analyst}.`
                  : "Top-line numbers across all analysts."}>
                <KpiRow kpis={kpis} compareKpis={compareKpis} />
              </Section>

              {/* category breakdown */}
              <Section title="Case Categories" subtitle="Auto-categorized from short description and resolution notes.">
                <Card>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={categoryData} layout="vertical" margin={{left:8,right:16,top:4,bottom:4}}>
                      <CartesianGrid strokeDasharray="3 3" stroke={T.borderSoft} horizontal={false}/>
                      <XAxis type="number" tick={{fontSize:11,fill:T.muted}} axisLine={false} tickLine={false}/>
                      <YAxis type="category" dataKey="name" width={160} tick={{fontSize:11,fill:T.sub}} axisLine={false} tickLine={false}/>
                      <Tooltip contentStyle={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:6,fontSize:12}}/>
                      <Bar dataKey="count" fill={T.accent} radius={[0,4,4,0]} maxBarSize={18}/>
                    </BarChart>
                  </ResponsiveContainer>
                </Card>
              </Section>

              {/* top accounts */}
              {accountData.length > 0 && (
                <Section title="Top Accounts" subtitle="Accounts with the most cases in the selected window.">
                  <Card>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={accountData} layout="vertical" margin={{left:8,right:16,top:4,bottom:4}}>
                        <CartesianGrid strokeDasharray="3 3" stroke={T.borderSoft} horizontal={false}/>
                        <XAxis type="number" tick={{fontSize:11,fill:T.muted}} axisLine={false} tickLine={false}/>
                        <YAxis type="category" dataKey="name" width={160} tick={{fontSize:11,fill:T.sub}} axisLine={false} tickLine={false}/>
                        <Tooltip contentStyle={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:6,fontSize:12}}/>
                        <Bar dataKey="count" fill={T.warn} radius={[0,4,4,0]} maxBarSize={18}/>
                      </BarChart>
                    </ResponsiveContainer>
                  </Card>
                </Section>
              )}
            </div>
          )}

          {/* SLA */}
          {page==="sla" && (
            <div className="print-section">
              <Section title="SLA Performance"
                subtitle="Overall SLA hit rate, breakdown by priority, and open cases at risk.">
                <div style={{display:"grid",gridTemplateColumns:"auto 1fr",gap:16,alignItems:"start"}}>
                  <Card style={{display:"flex",flexDirection:"column",alignItems:"center",gap:8,padding:24}}>
                    <SlaRadial rate={kpis.slaRate}/>
                    <div style={{fontSize:12,color:T.muted}}>{kpis.slaMet}/{kpis.slaEligible} eligible</div>
                  </Card>
                  <Card>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={resDist} margin={{left:8,right:16,top:4,bottom:4}}>
                        <CartesianGrid strokeDasharray="3 3" stroke={T.borderSoft} vertical={false}/>
                        <XAxis dataKey="priority" tick={{fontSize:11,fill:T.sub}} axisLine={false} tickLine={false}/>
                        <YAxis tick={{fontSize:11,fill:T.muted}} axisLine={false} tickLine={false} unit="h"/>
                        <Tooltip formatter={(v)=>`${v?.toFixed(1)}h`}
                          contentStyle={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:6,fontSize:12}}/>
                        <Legend wrapperStyle={{fontSize:12}}/>
                        <Bar dataKey="p50_h" name="Median (h)" fill={T.ok} radius={[4,4,0,0]} maxBarSize={32}/>
                        <Bar dataKey="p90_h" name="P90 (h)" fill={T.warn} radius={[4,4,0,0]} maxBarSize={32}/>
                      </BarChart>
                    </ResponsiveContainer>
                  </Card>
                </div>
              </Section>

              {/* SLA risk segments */}
              <Section title="Open Case SLA Risk">
                <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                  {slaRisk.map((b)=>(
                    <Card key={b.key} style={{flex:"1 1 120px",textAlign:"center",padding:16}}>
                      <div style={{fontSize:22,fontWeight:700,color:b.color}}>{b.count}</div>
                      <div style={{fontSize:12,color:T.sub,marginTop:4}}>{b.label}</div>
                    </Card>
                  ))}
                </div>
              </Section>

              {/* breached cases */}
              {kpis.breached.length > 0 && (
                <Section title="Breached SLA Cases" subtitle="Open cases whose SLA deadline has already passed.">
                  <div style={{display:"flex",flexDirection:"column",gap:6}}>
                    {kpis.breached.slice(0,20).map((r)=>(
                      <Card key={r.number} style={{display:"flex",gap:12,alignItems:"center",padding:"10px 14px"}}>
                        <span style={{fontWeight:600,color:T.accent,fontSize:13,minWidth:90}}>{r.number}</span>
                        <span style={{fontSize:11,fontWeight:600,color:priorityColor(r.priority),
                          background:priorityColor(r.priority)+"22",padding:"1px 6px",borderRadius:99}}>
                          {r.priority||"—"}
                        </span>
                        <span style={{fontSize:12,color:T.sub,flex:1}}>{r.short_description||"—"}</span>
                        <span style={{fontSize:12,color:T.danger,whiteSpace:"nowrap"}}>
                          Due {r._slaDue?.toLocaleDateString()}
                        </span>
                      </Card>
                    ))}
                  </div>
                </Section>
              )}
            </div>
          )}

          {/* TRENDS */}
          {page==="trends" && (
            <div className="print-section">
              <Section title="Daily Backlog Trajectory"
                subtitle="Open case count from the earliest record to today.">
                <Card>
                  <ResponsiveContainer width="100%" height={240}>
                    <LineChart data={dailyData} margin={{left:8,right:16,top:8,bottom:4}}>
                      <CartesianGrid strokeDasharray="3 3" stroke={T.borderSoft} vertical={false}/>
                      <XAxis dataKey="date" tickFormatter={(ts)=>new Date(ts).toLocaleDateString(undefined,{month:"short",day:"numeric"})}
                        tick={{fontSize:10,fill:T.muted}} axisLine={false} tickLine={false} minTickGap={40}/>
                      <YAxis tick={{fontSize:11,fill:T.muted}} axisLine={false} tickLine={false}/>
                      <Tooltip labelFormatter={(ts)=>new Date(ts).toLocaleDateString()}
                        contentStyle={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:6,fontSize:12}}/>
                      <Line type="monotone" dataKey="open" name="Open" stroke={T.accent} dot={false} strokeWidth={2}/>
                    </LineChart>
                  </ResponsiveContainer>
                </Card>
              </Section>

              <Section title="Weekly Intake vs. Resolved"
                subtitle="New cases vs. resolved cases per week. Rolling 4-week net shows backlog trend.">
                <Card>
                  <ResponsiveContainer width="100%" height={260}>
                    <ComposedChart data={weeklyData} margin={{left:8,right:16,top:8,bottom:4}}>
                      <CartesianGrid strokeDasharray="3 3" stroke={T.borderSoft} vertical={false}/>
                      <XAxis dataKey="week" tickFormatter={fmtWeekLabel}
                        tick={{fontSize:10,fill:T.muted}} axisLine={false} tickLine={false} minTickGap={40}/>
                      <YAxis yAxisId="left" tick={{fontSize:11,fill:T.muted}} axisLine={false} tickLine={false}/>
                      <YAxis yAxisId="right" orientation="right" tick={{fontSize:11,fill:T.muted}} axisLine={false} tickLine={false}/>
                      <Tooltip labelFormatter={fmtWeekLabel}
                        contentStyle={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:6,fontSize:12}}/>
                      <Legend wrapperStyle={{fontSize:12}}/>
                      <Bar yAxisId="left" dataKey="created" name="Created" fill={T.accent} opacity={0.7} maxBarSize={20}/>
                      <Bar yAxisId="left" dataKey="resolved" name="Resolved" fill={T.ok} opacity={0.7} maxBarSize={20}/>
                      <Line yAxisId="right" type="monotone" dataKey="rollingNet" name="4-wk net" stroke={T.warn} dot={false} strokeWidth={2}/>
                    </ComposedChart>
                  </ResponsiveContainer>
                </Card>
              </Section>

              <Section title="Open Case Aging" subtitle="How long open cases have been sitting.">
                <Card>
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={aging} margin={{left:8,right:16,top:8,bottom:4}}>
                      <CartesianGrid strokeDasharray="3 3" stroke={T.borderSoft} vertical={false}/>
                      <XAxis dataKey="name" tick={{fontSize:12,fill:T.sub}} axisLine={false} tickLine={false}/>
                      <YAxis tick={{fontSize:11,fill:T.muted}} axisLine={false} tickLine={false}/>
                      <Tooltip contentStyle={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:6,fontSize:12}}/>
                      <Bar dataKey="count" name="Cases" fill={T.accent} radius={[4,4,0,0]} maxBarSize={48}/>
                    </BarChart>
                  </ResponsiveContainer>
                </Card>
              </Section>
            </div>
          )}

          {/* PRIORITY MIX */}
          {page==="mix" && (
            <div className="print-section">
              <Section title="Priority Analysis"
                subtitle="Volume and resolution time by priority level.">
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
                  <Card>
                    <p style={{fontSize:12,color:T.sub,marginBottom:10,fontWeight:600}}>Volume by Priority</p>
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Pie data={priorityData} dataKey="count" nameKey="priority"
                          cx="50%" cy="50%" outerRadius={80} label={({priority,percent})=>`${priority} ${(percent*100).toFixed(0)}%`}
                          labelLine={false}>
                          {priorityData.map((e,i)=><Cell key={i} fill={e.color}/>)}
                        </Pie>
                        <Tooltip contentStyle={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:6,fontSize:12}}/>
                      </PieChart>
                    </ResponsiveContainer>
                  </Card>
                  <Card>
                    <p style={{fontSize:12,color:T.sub,marginBottom:10,fontWeight:600}}>Resolution Time by Priority (p50 / p90)</p>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={resDist} margin={{left:4,right:8,top:4,bottom:4}}>
                        <CartesianGrid strokeDasharray="3 3" stroke={T.borderSoft} vertical={false}/>
                        <XAxis dataKey="priority" tick={{fontSize:11,fill:T.sub}} axisLine={false} tickLine={false}/>
                        <YAxis tick={{fontSize:11,fill:T.muted}} axisLine={false} tickLine={false} unit="h"/>
                        <Tooltip formatter={(v)=>`${v?.toFixed(1)}h`}
                          contentStyle={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:6,fontSize:12}}/>
                        <Legend wrapperStyle={{fontSize:12}}/>
                        <Bar dataKey="p50_h" name="Median" fill={T.ok} radius={[4,4,0,0]} maxBarSize={32}/>
                        <Bar dataKey="p90_h" name="P90" fill={T.warn} radius={[4,4,0,0]} maxBarSize={32}/>
                      </BarChart>
                    </ResponsiveContainer>
                  </Card>
                </div>
              </Section>
            </div>
          )}

          {/* TEAM */}
          {page==="team" && view==="team" && (
            <div className="print-section">
              <Section title="Workload Distribution"
                subtitle="Case volume and SLA performance per analyst.">
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  {teamMembers.map((m)=>(
                    <Card key={m.name} style={{display:"grid",
                      gridTemplateColumns:"200px repeat(5,1fr)",gap:12,alignItems:"center",padding:"12px 16px"}}>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <User size={14} color={T.muted}/>
                        <button onClick={()=>{setAnalyst(m.name);setView("individual");setPage("overview");}}
                          style={{fontSize:13,fontWeight:600,color:T.accent,background:"none",border:"none",
                            cursor:"pointer",textAlign:"left",padding:0}}>
                          {m.name}
                        </button>
                      </div>
                      <div style={{textAlign:"center"}}>
                        <div style={{fontSize:18,fontWeight:700,color:T.ink}}>{m.kpis.total}</div>
                        <div style={{fontSize:11,color:T.muted}}>Total</div>
                      </div>
                      <div style={{textAlign:"center"}}>
                        <div style={{fontSize:18,fontWeight:700,color:T.warn}}>{m.kpis.open}</div>
                        <div style={{fontSize:11,color:T.muted}}>Open</div>
                      </div>
                      <div style={{textAlign:"center"}}>
                        <div style={{fontSize:18,fontWeight:700,
                          color:m.kpis.slaRate!=null?(m.kpis.slaRate>=90?T.ok:m.kpis.slaRate>=75?T.warn:T.danger):T.muted}}>
                          {m.kpis.slaRate!=null?`${m.kpis.slaRate.toFixed(0)}%`:"—"}
                        </div>
                        <div style={{fontSize:11,color:T.muted}}>SLA</div>
                      </div>
                      <div style={{textAlign:"center"}}>
                        <div style={{fontSize:18,fontWeight:700,color:T.ink}}>{fmtDuration(m.kpis.avgRes)}</div>
                        <div style={{fontSize:11,color:T.muted}}>Avg Res</div>
                      </div>
                      <div style={{textAlign:"center"}}>
                        <div style={{fontSize:16,fontWeight:700,color:m.kpis.breached.length>0?T.danger:T.ok}}>
                          {m.kpis.breached.length}
                        </div>
                        <div style={{fontSize:11,color:T.muted}}>Breached</div>
                      </div>
                    </Card>
                  ))}
                  {teamMembers.length===0&&(
                    <Card><p style={{color:T.muted,fontSize:13}}>No data for the selected filters.</p></Card>
                  )}
                </div>
              </Section>
            </div>
          )}

          {/* JIRA BLOCKERS */}
          {page==="jira" && (
            <div className="print-section">
              <Section title="Jira Blockers"
                subtitle="Open cases waiting on engineering work, parsed from work notes and cause fields.">
                <JiraBlock rows={enriched}/>
              </Section>
            </div>
          )}

          {/* AI INSIGHTS */}
          {page==="ai" && (
            <Section title="AI Insights"
              subtitle="Claude-powered qualitative analysis of themes, recurring issues, and knowledge gaps.">
              <AiBlock state={aiState} run={runAiAnalysis} hasData={enriched.length>0}/>
            </Section>
          )}

          {/* CASES */}
          {page==="cases" && (
            <Section title="Case Register"
              subtitle="Full case list for the selected filters. Sortable and searchable.">
              <CaseTable rows={enriched}/>
            </Section>
          )}

        </div>
      )}

      {/* ── keyframe for spinner ── */}
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
