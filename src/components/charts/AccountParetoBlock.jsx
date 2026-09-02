import { useMemo } from "react";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ReferenceLine, ResponsiveContainer,
} from "recharts";
import {
  T, AXIS_TICK, BAR_RADIUS_V, LEGEND_STYLE, TOOLTIP_STYLE,
} from "../../lib/theme.js";
import { accountPareto } from "../../lib/stats.js";
import { Card } from "../layout/Card.jsx";

/* ================= Account concentration · Pareto ================= */
// ServiceNow's "cases by account" bar chart answers who is loudest; a Pareto
// answers the riskier question — how much of the queue is hostage to how few
// customers. Bars are each account's share of total volume, the line is the
// running cumulative share, and both are percentages so they share ONE axis
// (counts ride in the tooltip). The dashed line marks 80%: the earlier the
// cumulative curve crosses it, the more concentrated the book of work.
// One metric, two readings of it, so this is a duotone: Purple Tint 02 bars
// under the Infor Purple cumulative line, on the Gray Tint plot ground.
export function AccountParetoBlock({ accountData }) {
  const { items, total, totalAccounts, accountsTo80 } = useMemo(
    () => accountPareto(accountData),
    [accountData],
  );

  if (!items.length) {
    return (
      <Card>
        <div className="eyebrow">Account concentration · Pareto</div>
        <div style={{ color: T.sub, fontSize: 13, fontStyle: "italic", marginTop: 12 }}>
          No account data in the current window.
        </div>
      </Card>
    );
  }

  const shown = items.length;
  // A dispersed book of work (hundreds of small accounts) never gets its
  // cumulative line near 80% within the shown slice; pinning the axis to
  // 0–100 would then flatten every mark into invisibility. Let the axis fit
  // the data and only draw the 80% marker when it's actually in reach.
  const maxCum = items[items.length - 1].cumPct;
  const show80 = maxCum >= 60;

  return (
    <Card>
      <div className="eyebrow">Account concentration · Pareto</div>
      <div style={{ color: T.sub, fontSize: 12, marginTop: 4, maxWidth: 720 }}>
        Accounts ranked by share of case volume in the current window. Bars are each account's slice of
        the total; the line is the running cumulative share across ALL {totalAccounts} accounts, so it
        keeps climbing past the {shown} shown here.
        {accountsTo80 != null && (
          <> It takes <span className="mono" style={{ color: T.ink }}>{accountsTo80}</span> account{accountsTo80 === 1 ? "" : "s"} to
          cover 80% of the {total} cases{show80 ? " — the dashed line marks that 80% threshold" : ""}.</>
        )}
        {" "}A queue dependent on a few names inherits those customers' release calendars and moods; a long
        flat tail like a dispersed book spreads that risk but resists per-account fixes.
      </div>
      <div style={{ height: 300, marginTop: 12, background: T.vizWell, borderRadius: T.radiusMd }}>
        <ResponsiveContainer>
          <ComposedChart data={items} margin={{ top: 10, right: 30, left: 0, bottom: 46 }}>
            <CartesianGrid stroke={T.vizGrid} vertical={false} />
            <XAxis
              dataKey="name"
              type="category"
              interval={0}
              angle={-35}
              textAnchor="end"
              height={60}
              tick={<AccountTick />}
              axisLine={{ stroke: T.vizAxis }}
              tickLine={{ stroke: T.vizAxis }}
            />
            <YAxis
              tick={AXIS_TICK}
              axisLine={{ stroke: T.vizAxis }}
              tickLine={{ stroke: T.vizAxis }}
              tickFormatter={(v) => `${v}%`}
            />
            <Tooltip content={<ParetoTip />} cursor={{ fill: T.vizWell }} />
            <Legend verticalAlign="top" wrapperStyle={LEGEND_STYLE} iconType="square" />
            {show80 && <ReferenceLine y={80} stroke={T.vizAxis} strokeDasharray="4 4" strokeWidth={1} />}
            <Bar
              dataKey="sharePct" name="share of cases"
              fill={T.categorical[5]} stroke={T.vizStroke} strokeWidth={1}
              radius={BAR_RADIUS_V}
            />
            <Line
              type="monotone" dataKey="cumPct" name="cumulative share"
              stroke={T.vizAccent} strokeWidth={1.5} dot={{ r: 2 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

// Long customer names would collide at -35°; truncate on the axis, keep the
// full name in the tooltip.
function AccountTick({ x, y, payload }) {
  const name = String(payload.value);
  const short = name.length > 14 ? `${name.slice(0, 13)}…` : name;
  return (
    <text x={x} y={y} dy={10} fill={T.vizCat} fontSize={11} textAnchor="end" transform={`rotate(-35, ${x}, ${y})`}>
      {short}
    </text>
  );
}

function ParetoTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={TOOLTIP_STYLE}>
      <div style={{ fontWeight: 600 }}>{d.name}</div>
      <div className="mono" style={{ color: T.sub }}>{d.count} cases · {d.sharePct.toFixed(1)}% of volume</div>
      <div className="mono" style={{ color: T.muted }}>cumulative {d.cumPct.toFixed(1)}%</div>
    </div>
  );
}
