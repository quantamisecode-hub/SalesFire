// Route architecture: public auth routes + protected application routes.
// Only routes with real backend support are registered; unknown paths
// redirect to the dashboard.
import { Navigate, createBrowserRouter } from "react-router-dom";
import { PublicOnly, RequireAuth } from "@/components/RequireAuth";
import { Layout } from "@/layouts/Layout";
import { LoginPage } from "@/pages/LoginPage";
import { RegisterPage } from "@/pages/RegisterPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { CampaignListPage } from "@/pages/CampaignListPage";
import { CampaignCreatePage } from "@/pages/CampaignCreatePage";
import { CampaignDetailPage } from "@/pages/CampaignDetailPage";
import { CampaignRecipientsPage } from "@/pages/CampaignRecipientsPage";
import { CampaignAnalyticsPage } from "@/pages/CampaignAnalyticsPage";
import { EmailSendingSettingsPage } from "@/pages/EmailSendingSettingsPage";
import { SignaturesPage } from "@/pages/SignaturesPage";

export const router = createBrowserRouter([
  // ---- Public routes ----
  { path: "/login", element: <PublicOnly><LoginPage /></PublicOnly> },
  { path: "/signup", element: <Navigate to="/register" replace /> },
  { path: "/register", element: <PublicOnly><RegisterPage /></PublicOnly> },
  { path: "/forgot-password", element: <Navigate to="/login" replace /> },
  { path: "/reset-password", element: <Navigate to="/login" replace /> },

  // ---- Protected application routes ----
  {
    path: "/",
    element: (
      <RequireAuth>
        <Layout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      { path: "dashboard", element: <DashboardPage /> },
      { path: "campaigns", element: <CampaignListPage /> },
      { path: "campaigns/new", element: <CampaignCreatePage /> },
      { path: "campaigns/create", element: <Navigate to="/campaigns/new" replace /> },
      { path: "campaigns/:id", element: <CampaignDetailPage /> },
      { path: "campaigns/:id/edit", element: <CampaignCreatePage /> },
      { path: "campaigns/:id/recipients", element: <CampaignRecipientsPage /> },
      { path: "campaigns/:id/analytics", element: <CampaignAnalyticsPage /> },
      { path: "settings/email-sending", element: <EmailSendingSettingsPage /> },
      { path: "settings/signatures", element: <SignaturesPage /> },
      // Sections without backend support redirect home (no dead links)
      { path: "*", element: <Navigate to="/dashboard" replace /> },
    ],
  },
]);
