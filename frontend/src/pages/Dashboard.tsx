import { useState } from "react"
import { Link } from "react-router"
import {
  ArrowDownRight,
  ArrowUpRight,
  BellRing,
  CheckCircle2,
  Clock3,
  FilePlus2,
  IndianRupee,
  Users,
} from "lucide-react"
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { Alert, Badge, Button, Card, EmptyState, ErrorState, LoadingState, PageHeader, Spinner } from "../components/ui"
import { useAuth } from "../auth/AuthContext"
import { feesApi, reportsApi } from "../services/api"
import { currentPeriod, errorMessage, inr, methodLabel, periodLabel, timeAgo, titleCase, useAsync } from "../lib/format"

const color: Record<string, string> = {
  blue: "bg-blue-50 text-blue-600",
  amber: "bg-amber-50 text-amber-600",
  violet: "bg-violet-50 text-violet-600",
  green: "bg-emerald-50 text-emerald-600",
}

const greeting = () => {
  const h = new Date().getHours()
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"
}

const activityTone = (action: string) =>
  action.startsWith("PAYMENT") ? "bg-emerald-500" : action.startsWith("REGISTRATION") ? "bg-blue-500" : action.includes("REMINDER") || action.includes("CHARGE") ? "bg-amber-500" : "bg-violet-500"

export function DashboardPage() {
  const { user } = useAuth()
  const { data, error, loading, reload } = useAsync(() => reportsApi.dashboard(), [])
  const genStatus = useAsync(() => feesApi.generationStatus(), [])
  const [busy, setBusy] = useState<"reminders" | "generate" | null>(null)
  const [notice, setNotice] = useState<{ tone: "green" | "red"; text: string } | null>(null)

  const sendReminders = async () => {
    if (!window.confirm("Email a fee reminder to every student with unpaid fees?")) return
    setBusy("reminders")
    try {
      const r = await feesApi.sendReminders()
      setNotice({ tone: "green", text: `Reminders sent to ${r.studentsNotified} student(s) and ${r.parentsNotified} parent(s).` })
    } catch (e) {
      setNotice({ tone: "red", text: errorMessage(e) })
    } finally {
      setBusy(null)
    }
  }

  const generate = async () => {
    const period = currentPeriod()
    if (!window.confirm(`Create ${periodLabel(period)} fee charges for all enrolled students? Students already billed are skipped.`)) return
    setBusy("generate")
    try {
      const r = await feesApi.generate(period)
      setNotice({
        tone: "green",
        text: `${r.created} new charge(s) created for ${periodLabel(period)}${r.alreadyBilled ? `; ${r.alreadyBilled} already billed` : ""}.`,
      })
      void reload()
      genStatus.reload()
    } catch (e) {
      setNotice({ tone: "red", text: errorMessage(e) })
    } finally {
      setBusy(null)
    }
  }

  const m = data?.metrics
  const metrics = m
    ? [
        {
          label: "Collected this month",
          value: inr(m.collectedThisMonth),
          detail: m.collectedChangePct === null ? "No data for last month" : `${Math.abs(m.collectedChangePct)}% ${m.collectedChangePct >= 0 ? "up" : "down"} from last month`,
          trend: (m.collectedChangePct ?? 0) >= 0 ? "up" : "down",
          icon: IndianRupee,
          color: "blue",
        },
        {
          label: "Outstanding fees",
          value: inr(m.outstandingFees),
          detail: `${m.studentsWithDues} student${m.studentsWithDues === 1 ? "" : "s"} with dues`,
          trend: m.outstandingFees > 0 ? "down" : "up",
          icon: Clock3,
          color: "amber",
        },
        {
          label: "Active students",
          value: String(m.activeStudents),
          detail: `${m.newStudentsThisMonth} joined this month`,
          trend: "up",
          icon: Users,
          color: "violet",
        },
        {
          label: "Collection rate",
          value: m.collectionRate === null ? "—" : `${m.collectionRate}%`,
          detail: m.collectionRate === null ? "No fees billed this month yet" : m.collectionRateChange === null ? "This month's charges" : `${m.collectionRateChange >= 0 ? "+" : ""}${m.collectionRateChange} pts vs last month`,
          trend: (m.collectionRateChange ?? 0) >= 0 ? "up" : "down",
          icon: CheckCircle2,
          color: "green",
        },
      ]
    : []

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow={data?.periodLabel ?? periodLabel(currentPeriod())}
        title={`${greeting()}, ${user?.name.split(" ")[0] ?? ""}`}
        description="Here’s what’s happening across your batches and fee collection."
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={generate} disabled={busy !== null}>
              {busy === "generate" ? <Spinner /> : <FilePlus2 className="size-4" />} Generate this month's fees
            </Button>
            <Button variant="secondary" onClick={sendReminders} disabled={busy !== null}>
              {busy === "reminders" ? <Spinner /> : <BellRing className="size-4" />} Send reminders
            </Button>
            <Link to="/admin/payments">
              <Button>
                <IndianRupee className="size-4" /> Record payment
              </Button>
            </Link>
          </div>
        }
      />

      {genStatus.data && genStatus.data.pendingStudents > 0 && (
        <Alert tone="amber">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>
              <strong>{periodLabel(genStatus.data.period)} fees haven’t been generated yet.</strong>{" "}
              {genStatus.data.pendingStudents} student{genStatus.data.pendingStudents === 1 ? "" : "s"} can’t see or pay this month’s fee until you generate it.
            </span>
            <Button onClick={generate} disabled={busy !== null}>
              {busy === "generate" ? <Spinner /> : <FilePlus2 className="size-4" />} Generate now
            </Button>
          </div>
        </Alert>
      )}
      {notice && (
        <Alert tone={notice.tone} onDismiss={() => setNotice(null)}>
          {notice.text}
        </Alert>
      )}
      {m && m.pendingUpiClaims > 0 && (
        <Alert tone="blue">
          {m.pendingUpiClaims} UPI payment{m.pendingUpiClaims === 1 ? " is" : "s are"} waiting for you to verify.{" "}
          <Link to="/admin/payments" className="font-semibold underline">
            Verify now
          </Link>
        </Alert>
      )}
      {m && m.pendingRegistrations > 0 && (
        <Alert tone="blue">
          {m.pendingRegistrations} registration{m.pendingRegistrations === 1 ? " is" : "s are"} waiting for review.{" "}
          <Link to="/admin/registrations" className="font-semibold underline">
            Review now
          </Link>
        </Alert>
      )}

      {loading && !data ? (
        <Card>
          <LoadingState />
        </Card>
      ) : error ? (
        <Card>
          <ErrorState message={error} onRetry={reload} />
        </Card>
      ) : data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {metrics.map((metric) => (
              <Card key={metric.label} className="p-5">
                <div className="flex items-start justify-between">
                  <div className={`grid size-10 place-items-center rounded-xl ${color[metric.color]}`}>
                    <metric.icon className="size-5" />
                  </div>
                  <span className={`flex items-center text-xs font-semibold ${metric.trend === "up" ? "text-emerald-600" : "text-amber-600"}`}>
                    {metric.trend === "up" ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
                  </span>
                </div>
                <p className="mt-5 text-sm text-slate-500">{metric.label}</p>
                <p className="mt-1 text-2xl font-bold tracking-tight">{metric.value}</p>
                <p className="mt-2 text-xs text-slate-400">{metric.detail}</p>
              </Card>
            ))}
          </div>
          <div className="grid gap-6 xl:grid-cols-[1.55fr_1fr]">
            <Card>
              <div className="flex items-center justify-between border-b border-slate-100 p-5 sm:p-6">
                <div>
                  <h2 className="font-bold">Collection overview</h2>
                  <p className="mt-1 text-xs text-slate-500">Collected vs outstanding over six months</p>
                </div>
                <Badge tone="blue">Last 6 months</Badge>
              </div>
              <div className="h-72 p-3 sm:p-5">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.trend} margin={{ top: 10, right: 8, left: -15, bottom: 0 }}>
                    <defs>
                      <linearGradient id="collected" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#2563eb" stopOpacity={0.22} />
                        <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="4 4" />
                    <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 12 }} />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : String(v))}
                      tick={{ fill: "#94a3b8", fontSize: 12 }}
                    />
                    <Tooltip
                      formatter={(value, name) => [inr(Number(value)), name === "collected" ? "Collected" : "Outstanding"]}
                      contentStyle={{ borderRadius: 12, borderColor: "#e2e8f0", fontSize: 12 }}
                    />
                    <Area type="monotone" dataKey="collected" stroke="#2563eb" strokeWidth={3} fill="url(#collected)" />
                    <Area type="monotone" dataKey="due" stroke="#f59e0b" strokeWidth={2} fill="transparent" strokeDasharray="5 5" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card>
              <div className="flex items-center justify-between border-b border-slate-100 p-5 sm:p-6">
                <div>
                  <h2 className="font-bold">Recent activity</h2>
                  <p className="mt-1 text-xs text-slate-500">Latest actions across the academy</p>
                </div>
                <Link className="text-xs font-semibold text-blue-600" to="/admin/activity">
                  View all
                </Link>
              </div>
              {data.recentActivity.length === 0 ? (
                <p className="p-6 text-sm text-slate-500">No activity yet.</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {data.recentActivity.map((item) => (
                    <div key={item.id} className="flex gap-3 p-4 sm:px-6">
                      <span className={`mt-1.5 size-2 shrink-0 rounded-full ${activityTone(item.action)}`} />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold">{titleCase(item.action)}</p>
                        <p className="mt-0.5 truncate text-xs text-slate-500">{item.summary}</p>
                        <p className="mt-1.5 text-[11px] text-slate-400">
                          {timeAgo(item.createdAt)}
                          {item.actor ? ` • ${item.actor}` : ""}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
          <Card>
            <div className="flex items-center justify-between border-b border-slate-100 p-5 sm:p-6">
              <div>
                <h2 className="font-bold">Latest payments</h2>
                <p className="mt-1 text-xs text-slate-500">Most recent verified and manually recorded entries</p>
              </div>
              <Link className="text-xs font-semibold text-blue-600" to="/admin/payments">
                All payments
              </Link>
            </div>
            {data.latestPayments.length === 0 ? (
              <EmptyState icon={<IndianRupee />} title="No payments yet" description="Payments you record or students make online will appear here." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[700px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-400">
                    <tr>
                      <th className="px-6 py-3 font-semibold">Student</th>
                      <th className="px-6 py-3 font-semibold">Period</th>
                      <th className="px-6 py-3 font-semibold">Method</th>
                      <th className="px-6 py-3 font-semibold">Amount</th>
                      <th className="px-6 py-3 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.latestPayments.map((p) => (
                      <tr key={p.id} className="hover:bg-slate-50/60">
                        <td className="px-6 py-4">
                          <p className="font-semibold">{p.student.name}</p>
                          <p className="text-xs text-slate-400">{p.code}</p>
                        </td>
                        <td className="px-6 py-4 text-slate-600">{p.periods.map(periodLabel).join(", ") || "Advance credit"}</td>
                        <td className="px-6 py-4 text-slate-600">{methodLabel(p.method)}</td>
                        <td className="px-6 py-4 font-semibold">{inr(p.amount)}</td>
                        <td className="px-6 py-4">
                          <Badge tone="green">{p.source === "ONLINE" ? "Verified online" : "Recorded"}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      ) : null}
    </div>
  )
}
