import { useOutletContext } from "react-router-dom"
import { Section } from "../components/layout/Section.jsx"
import { AccountProductBlock } from "../components/charts/AccountProductBlock.jsx"
import { AccountRiskBlock } from "../components/charts/AccountRiskBlock.jsx"
import { AccountParetoBlock } from "../components/charts/AccountParetoBlock.jsx"
import { EmptyState } from "../components/EmptyState.jsx"
import { useQuery } from "../lib/useQuery.js"
import { getAccountData, getProductData } from "../lib/queries.js"
import { DevCompare } from "../components/dev/DevCompare.jsx"
import { flattenByKey } from "../components/dev/devCompareUtils.js"

export default function AccountsPage() {
  const { rows, view, accountData, accountDataAll, productData, analyst, manager, dateRange, enrichedAllJoined, snapshotMs } = useOutletContext()
  const dr = dateRange || { from: null, to: null, field: "_created" }
  const acctSql = useQuery(() => getAccountData({ analyst, manager, dateRange: dr }), [analyst, manager, dr.from, dr.to, dr.field], { enabled: !!rows })
  const prodSql = useQuery(() => getProductData({ analyst, manager, dateRange: dr }), [analyst, manager, dr.from, dr.to, dr.field], { enabled: !!rows })
  if (!rows) return <Section title="Accounts & Products"><EmptyState /></Section>
  return (
    <Section
      title="Accounts & Products"
      subtitle={
        view === "team"
          ? "Which customers and product lines drive the most case volume across the team."
          : "Which customers and product lines drive the most case volume. Helps spot account concentration risk (one customer dominating the queue) and recurring product hotspots that might warrant deeper investigation."
      }
    >
      <DevCompare
        label="getAccountData"
        note={`analyst: ${analyst === "__all__" ? "all" : analyst}`}
        metrics={flattenByKey(accountData, acctSql.data, "name", ["count"])}
      />
      <DevCompare
        label="getProductData"
        note={`analyst: ${analyst === "__all__" ? "all" : analyst}`}
        metrics={flattenByKey(productData, prodSql.data, "name", ["count"])}
      />
      <AccountProductBlock accountData={accountDataAll} productData={productData} scrollAccounts />

      <div style={{ marginTop: 12 }}>
        <AccountParetoBlock accountData={accountDataAll} />
      </div>

      <div style={{ marginTop: 12 }}>
        <AccountRiskBlock rows={enrichedAllJoined} snapshotMs={snapshotMs} />
      </div>
    </Section>
  )
}
