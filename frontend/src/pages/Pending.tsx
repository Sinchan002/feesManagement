import { useEffect, useState } from "react"
import { useNavigate } from "react-router"
import { Clock3, GraduationCap, LogOut, RefreshCw } from "lucide-react"
import { useAuth } from "../auth/AuthContext"
import { Badge, Button, Card, Spinner } from "../components/ui"
import { formatDateTime } from "../lib/format"

const POLL_MS = 20_000

/**
 * Shown to a registered student until the teacher approves them. Polls the server so the
 * student moves on automatically once approved (or is signed out if the request is declined).
 */
export function PendingApprovalPage() {
  const { user, refresh, logout } = useAuth()
  const navigate = useNavigate()
  const [checking, setChecking] = useState(false)
  const [lastChecked, setLastChecked] = useState(new Date())

  const check = async () => {
    setChecking(true)
    const me = await refresh()
    setLastChecked(new Date())
    setChecking(false)
    if (me && me.status !== "PENDING") navigate(me.redirectTo, { replace: true })
  }

  useEffect(() => {
    const t = setInterval(() => void check(), POLL_MS)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const reg = user?.registration

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-20 max-w-3xl items-center px-5">
          <div className="grid size-10 place-items-center rounded-xl bg-blue-600 text-white">
            <GraduationCap className="size-5" />
          </div>
          <p className="ml-3 font-bold">SriKrishna Physics Academy</p>
          <Button variant="secondary" className="ml-auto" onClick={() => void logout().then(() => navigate("/login", { replace: true }))}>
            <LogOut className="size-4" /> Log out
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-3xl p-5 py-12">
        <Card className="p-8 text-center sm:p-10">
          <div className="mx-auto grid size-16 place-items-center rounded-full bg-amber-50 text-amber-600">
            <Clock3 className="size-8" />
          </div>
          <Badge tone="amber">Approval pending</Badge>
          <h1 className="mt-4 text-2xl font-bold">Hi {user?.name.split(" ")[0]}, your registration is under review</h1>
          <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-slate-500">
            Your teacher will review your request and allocate a batch. You can't access the student dashboard until
            then. This page updates automatically, and you'll also get an email once it's decided.
          </p>
          <div className="mt-6 flex flex-col items-center gap-2">
            <Button variant="secondary" onClick={() => void check()} disabled={checking}>
              {checking ? <Spinner /> : <RefreshCw className="size-4" />} Check status now
            </Button>
            <p className="text-xs text-slate-400">Last checked {lastChecked.toLocaleTimeString("en-IN")}</p>
          </div>
        </Card>

        {reg && (
          <Card className="mt-6 p-6">
            <h2 className="font-bold">What you submitted</h2>
            <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-slate-400">Registration number</dt>
                <dd className="mt-1 font-semibold">{reg.code}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">Submitted</dt>
                <dd className="mt-1 font-semibold">{formatDateTime(reg.submittedAt)}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">Email</dt>
                <dd className="mt-1 font-semibold">{user?.email}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">Class</dt>
                <dd className="mt-1 font-semibold">{reg.schoolClass}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">Subjects</dt>
                <dd className="mt-1 font-semibold">{reg.requestedSubjects.join(", ") || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">Preferred batch</dt>
                <dd className="mt-1 font-semibold">{reg.preferredBatch ?? "No preference"}</dd>
              </div>
              {reg.notes && (
                <div className="sm:col-span-2">
                  <dt className="text-xs text-slate-400">Notes</dt>
                  <dd className="mt-1 font-semibold">{reg.notes}</dd>
                </div>
              )}
            </dl>
          </Card>
        )}
      </main>
    </div>
  )
}
