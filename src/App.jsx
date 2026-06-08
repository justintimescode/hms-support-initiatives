import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AppLayout } from "./components/layout/AppLayout.jsx";
import Home from "./pages/Home.jsx";
import MyDayPage from "./pages/MyDayPage.jsx";
import MonthlySummaryReport from "./pages/MonthlySummaryReport.jsx";
import SlaPage from "./pages/SlaPage.jsx";
import BacklogPage from "./pages/BacklogPage.jsx";
import TrendsPage from "./pages/TrendsPage.jsx";
import CadencePage from "./pages/CadencePage.jsx";
import PriorityPage from "./pages/PriorityPage.jsx";
import CategoriesPage from "./pages/CategoriesPage.jsx";
import AccountsPage from "./pages/AccountsPage.jsx";
import WorkloadPage from "./pages/WorkloadPage.jsx";
import TeamPage from "./pages/TeamPage.jsx";
import JiraPage from "./pages/JiraPage.jsx";
import JiraBlockersPage from "./pages/JiraBlockersPage.jsx";
import JiraStatsPage from "./pages/JiraStatsPage.jsx";
import InsightsPage from "./pages/InsightsPage.jsx";
import CasesPage from "./pages/CasesPage.jsx";
import SurveysPage from "./pages/SurveysPage.jsx";
import UpdateQueuePage from "./pages/UpdateQueuePage.jsx";
import SolutionProposedQueuePage from "./pages/SolutionProposedQueuePage.jsx";
import SettingsPage from "./pages/SettingsPage.jsx";
import NotFoundPage from "./pages/NotFoundPage.jsx";
import Connections from "./pages/Connections.jsx";

/* One route per page, all nested under AppLayout (sidebar + top filter
 * bar + outlet). Filter state lives in the URL via useFilters; app data
 * lives in AppLayout via useAppData and reaches pages through Outlet
 * context. */
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/sla" element={<SlaPage />} />
          <Route path="/backlog" element={<BacklogPage />} />
          <Route path="/trends" element={<TrendsPage />} />
          <Route path="/cadence" element={<CadencePage />} />
          <Route path="/priority" element={<PriorityPage />} />
          <Route path="/categories" element={<CategoriesPage />} />
          <Route path="/accounts" element={<AccountsPage />} />
          <Route path="/workload" element={<WorkloadPage />} />
          <Route path="/team" element={<TeamPage />} />
          <Route path="/jira" element={<JiraPage />} />
          <Route path="/jira-blockers" element={<JiraBlockersPage />} />
          <Route path="/jira-stats" element={<JiraStatsPage />} />
          <Route path="/insights" element={<InsightsPage />} />
          <Route path="/cases" element={<CasesPage />} />
          <Route path="/surveys" element={<SurveysPage />} />
          <Route path="/update-queue" element={<UpdateQueuePage />} />
          <Route path="/solution-proposed" element={<SolutionProposedQueuePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/connections" element={<Connections />} />
          <Route path="/" element={<Home />} />
          <Route path="/my-day" element={<MyDayPage />} />
          <Route path="/report" element={<MonthlySummaryReport />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
