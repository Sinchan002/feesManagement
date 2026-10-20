import { useState } from "react"
import { ArrowDownToLine } from "lucide-react"
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { Alert, Button, Card, EmptyState, ErrorState, LoadingState, PageHeader, Select } from "../../components/ui"
import { batchesApi, reportsApi } from "../../services/api"
import { currentPeriod, errorMessage, inr, methodLabel, periodLabel, shiftPeriod, useAsync } from "../../lib/format"

const months = Array.from({ length: 12 }, (_, i) => shiftPeriod(currentPeriod(), -i))

export function ReportsPage() {
  const [month, setMonth] = useState(currentPeriod())
  const [batchId, setBatchId] = useState("")
  const [exportError, setExportError] = useState<string | null>(null)
  const batches = useAsync(() => batchesApi.list(), [])
  const report = useAsync(() => reportsApi.collections(month, batchId || undefined), [month, batchId])
  const trend = useAsync(() => reportsApi.dashboard(month), [month])

  const r = report.data
  const pie = r
    ? [
        { name: "Paid", value: r.studentStatus.paid, color: "#10b981" },
        { name: "Due", value: r.studentStatus.due, color: "#f59e0b" },
      ]
    : []

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Analytics"
        title="Fee reports"
        description="Understand collection performance by month and batch."
        action={
          <Button
            variant="secondary"
            onClick={() => void reportsApi.exportCsv(month, batchId || undefined).catch((e) => setExportError(errorMessage(e)))}
          >
            <ArrowDownToLine className="size-4" /> Export report
          </Button>
        }
      />
      {exportError && (
        <Alert onDismiss={() => setExportError(null)}>{exportError}</Alert>
      )}
      <div className="flex flex-wrap gap-3">
        <div className="w-48">
          <Select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month">
            {months.map((m) => (
              <option key={m} value={m}>
                {periodLabel(m)}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-60">
          <Select value={batchId} onChange={(e) => setBatchId(e.target.value)} aria-label="Batch">
            <option value="">All batches</option>
            {batches.data?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {report.loading && !r ? (
        <Card>
          <LoadingState />
        </Card>
      ) : report.error ? (
        <Card>
          <ErrorState message={report.error} onRetry={report.reload} />
        </Card>
      ) : r ? (
        <>
          <div className="grid gap-4 sm:grid-cols-4">
            {[
              { label: "Billed", value: inr(r.billed) },
              { label: "Collected (of billed)", value: inr(r.collectedAgainstBilling) },
              { label: "Outstanding", value: inr(r.outstanding) },
              { label: "Received this month", value: inr(r.receivedInMonth.total), sub: `${inr(r.receivedInMonth.online)} online • ${inr(r.receivedInMonth.manual)} manual` },
            ].map((s) => (
              <Card key={s.label} className="p-5">
                <p className="text-sm text-slate-500">{s.label}</p>
                <p className="mt-2 text-2xl font-bold">{s.value}</p>
                {s.sub && <p className="mt-1 text-xs text-slate-400">{s.sub}</p>}
              </Card>
            ))}
          </div>
          <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
            <Card>
              <div className="p-6">
                <h2 className="font-bold">Monthly collection trend</h2>
                <p className="mt-1 text-xs text-slate-500">Total received in the six months up to {periodLabel(month)}</p>
              </div>
              <div className="h-80 p-4">
                {trend.data && (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={trend.data.trend}>
                      <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="4 4" />
                      <XAxis dataKey="month" axisLine={false} tickLine={false} />
                      <YAxis axisLine={false} tickLine={false} tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : String(v))} />
                      <Tooltip formatter={(v) => inr(Number(v))} />
                      <Bar dataKey="collected" name="Collected" fill="#2563eb" radius={[8, 8, 0, 0]} barSize={30} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </Card>
            <Card>
              <div className="p-6">
                <h2 className="font-bold">{periodLabel(month)} fee status</h2>
                <p className="mt-1 text-xs text-slate-500">Students billed this month</p>
              </div>
              {r.studentStatus.paid + r.studentStatus.due === 0 ? (
                <EmptyState icon={<ArrowDownToLine />} title="Nothing billed" description="No fees were generated for this month." />
              ) : (
                <>
                  <div className="relative h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={pie} dataKey="value" innerRadius={72} outerRadius={92} paddingAngle={4}>
                          {pie.map((p) => (
                            <Cell key={p.name} fill={p.color} />
                          ))}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
                      <div>
                        <p className="text-3xl font-bold">{r.collectionRate ?? 0}%</p>
                        <p className="text-xs text-slate-400">collected</p>
                      </div>
                    </div>
                  </div>
                  <div className="flex justify-center gap-6 pb-6 text-sm">
                    <span className="flex items-center gap-2">
                      <i className="size-2 rounded-full bg-emerald-500" />
                      {r.studentStatus.paid} paid
                    </span>
                    <span className="flex items-center gap-2">
                      <i className="size-2 rounded-full bg-amber-500" />
                      {r.studentStatus.due} due
                    </span>
                  </div>
                </>
              )}
            </Card>
          </div>
          <Card>
            <div className="border-b border-slate-100 p-6">
              <h2 className="font-bold">Performance by batch</h2>
            </div>
            {r.byBatch.length === 0 ? (
              <p className="p-6 text-sm text-slate-500">No batches.</p>
            ) : (
              <div className="grid gap-4 p-6 md:grid-cols-2">
                {r.byBatch.map((b) => {
                  const rate = b.collectionRate ?? 0
                  return (
                    <div key={b.batchId} className="rounded-2xl border border-slate-100 p-4">
                      <div className="flex justify-between">
                        <div>
                          <p className="text-sm font-semibold">{b.name}</p>
                          <p className="mt-1 text-xs text-slate-400">
                            {b.students} students • {inr(b.monthlyFee)}/month • {inr(b.collected)} of {inr(b.billed)}
                          </p>
                        </div>
                        <p className="font-bold">{b.collectionRate === null ? "—" : `${rate}%`}</p>
                      </div>
                      <div className="mt-4 h-2 rounded-full bg-slate-100">
                        <div
                          className={`h-full rounded-full ${rate > 90 ? "bg-emerald-500" : rate > 80 ? "bg-blue-500" : "bg-amber-500"}`}
                          style={{ width: `${rate}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Card>
          {r.byMethod.length > 0 && (
            <Card className="p-6">
              <h2 className="font-bold">By payment method</h2>
              <div className="mt-4 flex flex-wrap gap-3">
                {r.byMethod.map((m) => (
                  <div key={m.method} className="rounded-xl bg-slate-50 px-4 py-3 text-sm">
                    <p className="text-xs text-slate-400">
                      {methodLabel(m.method)} • {m.count} payment{m.count === 1 ? "" : "s"}
                    </p>
                    <p className="mt-1 font-bold">{inr(m.amount)}</p>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      ) : null}
    </div>
  )
}
