import { createBrowserRouter } from "react-router"
import { AppShell, PortalShell } from "../components/AppShell"
import { GuestOnly, RequireArea } from "../auth/AuthContext"
import { ForgotPasswordPage, LoginPage, RegisterPage, ResetPasswordPage } from "../pages/Auth"
import { DashboardPage } from "../pages/Dashboard"
import { RegistrationsPage } from "../pages/admin/Registrations"
import { BatchesPage } from "../pages/admin/Batches"
import { StudentsPage } from "../pages/admin/Students"
import { PaymentsPage } from "../pages/admin/Payments"
import { ReportsPage } from "../pages/admin/Reports"
import { ActivityPage } from "../pages/admin/Activity"
import { SettingsPage } from "../pages/admin/Settings"
import { StudentPortalPage } from "../pages/Portals"
import { PendingApprovalPage } from "../pages/Pending"
import { NotFoundPage, RouteErrorPage } from "../pages/NotFound"
import { LandingPage } from "../pages/Landing"

export const router = createBrowserRouter([
  { path: "/", Component: LandingPage, errorElement: <RouteErrorPage /> },
  {
    path: "/login",
    element: (
      <GuestOnly>
        <LoginPage />
      </GuestOnly>
    ),
    errorElement: <RouteErrorPage />,
  },
  {
    path: "/register",
    element: (
      <GuestOnly>
        <RegisterPage />
      </GuestOnly>
    ),
    errorElement: <RouteErrorPage />,
  },
  { path: "/forgot-password", Component: ForgotPasswordPage, errorElement: <RouteErrorPage /> },
  { path: "/reset-password", Component: ResetPasswordPage, errorElement: <RouteErrorPage /> },
  {
    path: "/pending",
    element: (
      <RequireArea area="pending">
        <PendingApprovalPage />
      </RequireArea>
    ),
    errorElement: <RouteErrorPage />,
  },
  {
    path: "/admin",
    element: (
      <RequireArea area="admin">
        <AppShell />
      </RequireArea>
    ),
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, Component: DashboardPage },
      { path: "registrations", Component: RegistrationsPage },
      { path: "batches", Component: BatchesPage },
      { path: "students", Component: StudentsPage },
      { path: "payments", Component: PaymentsPage },
      { path: "reports", Component: ReportsPage },
      { path: "activity", Component: ActivityPage },
      { path: "settings", Component: SettingsPage },
    ],
  },
  {
    path: "/student",
    element: (
      <RequireArea area="student">
        <PortalShell />
      </RequireArea>
    ),
    errorElement: <RouteErrorPage />,
    children: [{ index: true, Component: StudentPortalPage }],
  },
  { path: "*", Component: NotFoundPage },
])
