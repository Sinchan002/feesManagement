import { useEffect, useState } from "react"
import { NavLink, Outlet, useLocation, useNavigate } from "react-router"
import {
  BarChart3,
  BookOpen,
  CreditCard,
  FileClock,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  UserCheck,
  Users,
  X,
} from "lucide-react"
import { useAuth } from "../auth/AuthContext"
import { registrationsApi } from "../services/api"
import { initialsOf } from "../lib/format"

const nav = [
  { to: "/admin", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/admin/registrations", label: "Registrations", icon: UserCheck, badge: "pending" as const },
  { to: "/admin/batches", label: "Batches", icon: BookOpen },
  { to: "/admin/students", label: "Students", icon: Users },
  { to: "/admin/payments", label: "Payments", icon: CreditCard },
  { to: "/admin/reports", label: "Reports", icon: BarChart3 },
  { to: "/admin/activity", label: "Audit history", icon: FileClock },
]

/** Pending-registration count for the sidebar badge; refreshed on navigation. */
function usePendingCount(pathname: string) {
  const [count, setCount] = useState(0)
  useEffect(() => {
    registrationsApi
      .list({ status: "PENDING", pageSize: 1 })
      .then((r) => setCount(Number(r.meta.pendingCount ?? r.meta.total)))
      .catch(() => {})
  }, [pathname])
  return count
}

function useSignOut() {
  const { logout } = useAuth()
  const navigate = useNavigate()
  return () => void logout().then(() => navigate("/login", { replace: true }))
}

export function AppShell() {
  const [open, setOpen] = useState(false)
  const location = useLocation()
  const { user } = useAuth()
  const signOut = useSignOut()
  const pending = usePendingCount(location.pathname)
  const current = nav.find((item) =>
    item.end ? location.pathname === item.to : location.pathname.startsWith(item.to),
  )
  const today = new Date().toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" })

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {open && (
        <button
          aria-label="Close navigation"
          className="fixed inset-0 z-30 bg-slate-950/30 backdrop-blur-sm lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-slate-200 bg-white transition-transform lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-20 items-center gap-3 border-b border-slate-100 px-6">
          <div className="grid size-10 place-items-center rounded-xl bg-blue-600 text-white shadow-lg shadow-blue-600/20">
            <GraduationCap className="size-5" />
          </div>
          <div>
            <p className="font-bold tracking-tight text-slate-950">SriKrishna Physics</p>
            <p className="text-xs text-slate-500">Fee management</p>
          </div>
          <button className="ml-auto rounded-lg p-2 text-slate-500 lg:hidden" onClick={() => setOpen(false)}>
            <X className="size-5" />
          </button>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-4 py-6">
          <p className="mb-3 px-3 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">Workspace</p>
          {nav.map(({ to, label, icon: Icon, badge, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                  isActive ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
                }`
              }
            >
              <Icon className="size-[18px]" />
              <span>{label}</span>
              {badge === "pending" && pending > 0 && (
                <span className="ml-auto rounded-full bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-700">
                  {pending}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-100 p-4">
          <NavLink
            to="/admin/settings"
            onClick={() => setOpen(false)}
            className={({ isActive }) =>
              `mb-2 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium ${
                isActive ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-50"
              }`
            }
          >
            <Settings className="size-[18px]" /> Settings
          </NavLink>
          <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-3">
            <div className="grid size-9 place-items-center rounded-full bg-slate-900 text-xs font-bold text-white">
              {initialsOf(user?.name ?? "")}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{user?.name}</p>
              <p className="truncate text-xs text-slate-500">{user?.email}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={signOut}
            className="mt-2 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-red-50 hover:text-red-700"
          >
            <LogOut className="size-[18px]" />
            Log out
          </button>
        </div>
      </aside>
      <div className="lg:pl-72">
        <header className="sticky top-0 z-20 flex h-20 items-center border-b border-slate-200/80 bg-white/85 px-4 backdrop-blur-xl sm:px-8">
          <button
            aria-label="Open navigation"
            className="mr-3 rounded-xl p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
            onClick={() => setOpen(true)}
          >
            <Menu className="size-5" />
          </button>
          <div>
            <p className="text-xs text-slate-400">Admin workspace</p>
            <p className="text-sm font-semibold">{current?.label || "Settings"}</p>
          </div>
          <p className="ml-auto hidden rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 sm:block">
            {today}
          </p>
        </header>
        <main className="mx-auto max-w-[1440px] p-4 sm:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

export function PortalShell() {
  const { user } = useAuth()
  const signOut = useSignOut()

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-20 max-w-6xl items-center px-4">
          <div className="grid size-10 place-items-center rounded-xl bg-blue-600 text-white">
            <GraduationCap className="size-5" />
          </div>
          <p className="ml-3 hidden font-bold sm:block">SriKrishna Physics Academy</p>
          <nav className="ml-auto flex items-center gap-3">
            <NavLink
              to="/student"
              className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
            >
              My dashboard
            </NavLink>
            <a
              href="#profile"
              className="hidden rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 sm:block"
            >
              My profile
            </a>
            <div
              className="grid size-9 place-items-center rounded-full bg-blue-50 text-xs font-bold text-blue-700"
              title={user?.name}
            >
              {initialsOf(user?.name ?? "")}
            </div>
            <button
              type="button"
              onClick={signOut}
              aria-label="Log out"
              className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-600 transition hover:border-red-200 hover:bg-red-50 hover:text-red-700"
            >
              <LogOut className="size-4" />
              <span className="hidden sm:inline">Log out</span>
            </button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-4 sm:p-8">
        <Outlet />
      </main>
    </div>
  )
}
