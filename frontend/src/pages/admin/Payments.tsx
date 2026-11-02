import { useEffect, useMemo, useState } from "react"
import { AlertCircle, Check, Download, Plus, ReceiptText, Undo2, Wallet } from "lucide-react"
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  PageHeader,
  Pagination,
  SearchBox,
  Select,
  Spinner,
} from "../../components/ui"
import { feesApi, paymentsApi, reportsApi, studentsApi } from "../../services/api"
import { UpiClaimsPanel } from "./UpiClaims"
import type { Charge, Payment, Student } from "../../services/types"
import { dateInputToIso, errorMessage, formatDate, inr, methodLabel, periodLabel, todayISO, useAsync, useDebounced } from "../../lib/format"

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

/** This year and the four before it (payments are not recorded in the future). */
const yearOptions = () => {
  const now = new Date().getFullYear()
  return Array.from({ length: 5 }, (_, i) => now - i)
}

export function PaymentsPage() {
  const [showForm, setShowForm] = useState(false)
  const [notice, setNotice] = useState<{ tone: "green" | "red"; text: string } | null>(null)
  const [search, setSearch] = useState("")
  const query = useDebounced(search)
  const [source, setSource] = useState("")
  const [page, setPage] = useState(1)
  // Month / year filter — defaults to the current month.
  const [year, setYear] = useState(() => new Date().getFullYear())
  const [month, setMonth] = useState(() => new Date().getMonth() + 1) // 1–12
  const period = `${year}-${String(month).padStart(2, "0")}`
  // Whole selected month in local (India) time, sent to the server as an instant range.
  const range = {
    from: new Date(year, month - 1, 1, 0, 0, 0).toISOString(),
    to: new Date(year, month, 0, 23, 59, 59, 999).toISOString(),
  }
  const summary = useAsync(() => reportsApi.collections(period), [period])
  const ledger = useAsync(
    () => paymentsApi.list({ search: query, source, ...range, page, pageSize: 25 }),
    [query, source, period, page],
  )
  const [voiding, setVoiding] = useState<string | null>(null)

  const refresh = () => {
    void ledger.reload()
    void summary.reload()
  }

  const voidPayment = async (p: Payment) => {
    const reason = window.prompt(`Void ${p.code} (${inr(p.amount)} from ${p.student.name})?\nThe record is kept, marked void, and the fees it paid become due again.\n\nReason:`)
    if (reason === null) return
    if (reason.trim().length < 5) return setNotice({ tone: "red", text: "Give a reason of at least 5 characters to void a payment." })
    setVoiding(p.id)
    try {
      await paymentsApi.void(p.id, reason.trim())
      setNotice({ tone: "green", text: `${p.code} was voided.` })
      refresh()
    } catch (e) {
      setNotice({ tone: "red", text: errorMessage(e) })
    } finally {
      setVoiding(null)
    }
  }

  const r = summary.data?.receivedInMonth
  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Collections"
        title="Payments"
        description="Track verified online transactions and manually recorded payments in one audit-friendly ledger."
        action={
          <Button onClick={() => setShowForm((v) => !v)}>
            <Plus className="size-4" /> Record manual payment
          </Button>
        }
      />
      {notice && (
        <Alert tone={notice.tone} onDismiss={() => setNotice(null)}>
          {notice.text}
        </Alert>
      )}
      <UpiClaimsPanel onChanged={refresh} />
      {showForm && (
        <ManualPaymentForm
          onCancel={() => setShowForm(false)}
          onSaved={(p) => {
            setShowForm(false)
            setNotice({ tone: "green", text: `${inr(p.amount)} from ${p.student.name} saved to the ledger (receipt ${p.receiptNumber}).` })
            refresh()
          }}
        />
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-5">
          <p className="text-sm text-slate-500">Collected in {periodLabel(period)}</p>
          <p className="mt-2 text-2xl font-bold">{r ? inr(r.total) : "—"}</p>
          <p className="mt-2 text-xs text-slate-400">All successful payments this month</p>
        </Card>
        <Card className="p-5">
          <p className="text-sm text-slate-500">Online payments</p>
          <p className="mt-2 text-2xl font-bold">{r ? inr(r.online) : "—"}</p>
          <p className="mt-2 text-xs text-slate-400">{r && r.total ? `${Math.round((r.online / r.total) * 100)}% of collections` : "Verified by the payment gateway"}</p>
        </Card>
        <Card className="p-5">
          <p className="text-sm text-slate-500">Manual entries</p>
          <p className="mt-2 text-2xl font-bold">{r ? inr(r.manual) : "—"}</p>
          <p className="mt-2 text-xs text-slate-400">Recorded by admin</p>
        </Card>
      </div>
      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:justify-between">
          <div className="flex-1 sm:max-w-md">
            <SearchBox
              value={search}
              onChange={(v) => {
                setSearch(v)
                setPage(1)
              }}
              placeholder="Search payment, receipt, reference or student"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="w-36">
              <Select
                value={month}
                onChange={(e) => {
                  setMonth(Number(e.target.value))
                  setPage(1)
                }}
                aria-label="Month"
              >
                {MONTHS.map((name, i) => (
                  <option key={name} value={i + 1}>
                    {name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="w-28">
              <Select
                value={year}
                onChange={(e) => {
                  setYear(Number(e.target.value))
                  setPage(1)
                }}
                aria-label="Year"
              >
                {yearOptions().map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </Select>
            </div>
            <div className="w-40">
              <Select
                value={source}
                onChange={(e) => {
                  setSource(e.target.value)
                  setPage(1)
                }}
                aria-label="Source"
              >
                <option value="">All sources</option>
                <option value="ONLINE">Online</option>
                <option value="MANUAL">Manual</option>
              </Select>
            </div>
            <Button variant="secondary" onClick={() => void paymentsApi.exportCsv({ search: query, source, ...range }).catch((e) => setNotice({ tone: "red", text: errorMessage(e) }))}>
              <Download className="size-4" /> Export
            </Button>
          </div>
        </div>
        {ledger.loading && !ledger.data ? (
          <LoadingState />
        ) : ledger.error ? (
          <ErrorState message={ledger.error} onRetry={ledger.reload} />
        ) : !ledger.data?.items.length ? (
          <EmptyState icon={<Wallet />} title={`No payments in ${periodLabel(period)}`} description="Choose another month or year, or change the search and source filters." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-400">
                  <tr>
                    <th className="px-6 py-3">Transaction</th>
                    <th className="px-6 py-3">Student</th>
                    <th className="px-6 py-3">Fee period</th>
                    <th className="px-6 py-3">Date</th>
                    <th className="px-6 py-3">Method</th>
                    <th className="px-6 py-3">Amount</th>
                    <th className="px-6 py-3">Receipt</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {ledger.data.items.map((p) => (
                    <tr key={p.id} className={p.status === "VOIDED" ? "opacity-60" : ""}>
                      <td className="px-6 py-4">
                        <p className="font-semibold">{p.code}</p>
                        {p.status === "VOIDED" ? (
                          <Badge tone="red">Voided</Badge>
                        ) : (
                          <Badge tone={p.source === "ONLINE" ? "blue" : "green"}>{p.source === "ONLINE" ? "Verified online" : "Recorded"}</Badge>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <p className="font-semibold">{p.student.name}</p>
                        <p className="text-xs text-slate-400">{p.student.code}</p>
                      </td>
                      <td className="px-6 py-4">
                        {p.periods.map(periodLabel).join(", ") || "—"}
                        {p.unallocatedAmount > 0 && <p className="text-xs text-amber-600">{inr(p.unallocatedAmount)} advance credit</p>}
                      </td>
                      <td className="px-6 py-4 text-slate-500">{formatDate(p.paymentDate)}</td>
                      <td className="px-6 py-4">
                        {methodLabel(p.method)}
                        {p.transactionReference && <p className="break-all font-mono text-sm font-semibold text-slate-700">{p.transactionReference}</p>}
                      </td>
                      <td className="px-6 py-4 font-bold">{inr(p.amount)}</td>
                      <td className="px-6 py-4">
                        <div className="flex gap-1">
                          <Button variant="ghost" onClick={() => void paymentsApi.receiptPdf(p.id).catch((e) => setNotice({ tone: "red", text: errorMessage(e) }))}>
                            <ReceiptText className="size-4" /> PDF
                          </Button>
                          {p.source === "MANUAL" && p.status === "SUCCEEDED" && (
                            <Button variant="ghost" title="Void this entry" onClick={() => void voidPayment(p)} disabled={voiding === p.id}>
                              {voiding === p.id ? <Spinner /> : <Undo2 className="size-4" />}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={ledger.data.meta.page} totalPages={ledger.data.meta.totalPages} total={ledger.data.meta.total} onPage={setPage} />
          </>
        )}
      </Card>
      <div className="flex gap-3 rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-800">
        <AlertCircle className="mt-0.5 size-5 shrink-0" />
        <p>
          <strong>Payment integrity:</strong> online payments are marked successful only after the server verifies them with
          the payment gateway. Manual entries can be voided but never deleted.
        </p>
      </div>
    </div>
  )
}

function ManualPaymentForm({ onCancel, onSaved }: { onCancel: () => void; onSaved: (p: Payment) => void }) {
  const [studentSearch, setStudentSearch] = useState("")
  const q = useDebounced(studentSearch)
  const [students, setStudents] = useState<Student[]>([])
  const [student, setStudent] = useState<Student | null>(null)
  const [charges, setCharges] = useState<Charge[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [amount, setAmount] = useState("")
  const [method, setMethod] = useState("CASH")
  const [date, setDate] = useState(todayISO())
  const [reference, setReference] = useState("")
  const [notes, setNotes] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // One key per form instance: a double click or retry can never record the payment twice.
  const idempotencyKey = useMemo(
    () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    [],
  )

  useEffect(() => {
    if (student) return
    studentsApi
      .list({ search: q, status: "ACTIVE", pageSize: 8 })
      .then((r) => setStudents(r.items))
      .catch(() => setStudents([]))
  }, [q, student])

  useEffect(() => {
    if (!student) return setCharges([])
    feesApi
      .charges({ studentId: student.id, status: "OPEN", pageSize: 100 })
      .then((r) => {
        const open = [...r.items].sort((a, b) => a.dueDate.localeCompare(b.dueDate))
        setCharges(open)
        setSelected(open.map((c) => c.id))
        setAmount(String(open.reduce((s, c) => s + c.outstanding, 0) || ""))
      })
      .catch((e) => setError(errorMessage(e)))
  }, [student])

  const selectedTotal = charges.filter((c) => selected.includes(c.id)).reduce((s, c) => s + c.outstanding, 0)

  const save = async () => {
    setError(null)
    const value = Number(amount)
    if (!student) return setError("Choose a student.")
    if (!value || value <= 0) return setError("Enter the amount received.")
    if (method !== "CASH" && !reference.trim() && method !== "OTHER")
      return setError("Enter the transaction / UTR / cheque reference for non-cash payments.")

    // Spread the amount over the ticked charges, oldest first; anything left is advance credit.
    let remaining = value
    const allocations = charges
      .filter((c) => selected.includes(c.id))
      .map((c) => {
        const a = Math.min(remaining, c.outstanding)
        remaining = Math.round((remaining - a) * 100) / 100
        return { chargeId: c.id, amount: a }
      })
      .filter((a) => a.amount > 0)

    setBusy(true)
    try {
      const p = await paymentsApi.recordManual(
        {
          studentId: student.id,
          amount: value,
          method,
          paymentDate: dateInputToIso(date),
          transactionReference: reference.trim() || undefined,
          notes: notes.trim() || undefined,
          allocations,
        },
        idempotencyKey,
      )
      onSaved(p)
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  return (
    <Card className="border-blue-200 p-5">
      <div>
        <h2 className="font-bold">Record a payment</h2>
        <p className="mt-1 text-xs text-slate-500">For cash, UPI, cheque, or bank transfers received outside the app.</p>
      </div>
      {error && (
        <div className="mt-4">
          <Alert>{error}</Alert>
        </div>
      )}
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <Field label="Student">
          {student ? (
            <div className="flex min-h-11 items-center justify-between rounded-xl border border-slate-200 px-3.5 text-sm">
              <span>
                <strong>{student.name}</strong> <span className="text-slate-400">{student.code}</span>
              </span>
              <button type="button" className="text-xs font-semibold text-blue-600" onClick={() => setStudent(null)}>
                Change
              </button>
            </div>
          ) : (
            <div>
              <SearchBox value={studentSearch} onChange={setStudentSearch} placeholder="Search by name or code" />
              <div className="mt-2 max-h-48 overflow-y-auto rounded-xl border border-slate-100">
                {students.length === 0 ? (
                  <p className="p-3 text-xs text-slate-400">No matching active students.</p>
                ) : (
                  students.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setStudent(s)}
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50"
                    >
                      <span>
                        {s.name} <span className="text-xs text-slate-400">{s.code}</span>
                      </span>
                      <span className="text-xs text-slate-500">{s.outstanding ? `${inr(s.outstanding)} due` : "No dues"}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </Field>
        <div>
          <p className="mb-1.5 text-sm font-medium text-slate-700">Apply to fees</p>
          {!student ? (
            <p className="text-xs text-slate-400">Choose a student to see their unpaid fees.</p>
          ) : charges.length === 0 ? (
            <p className="text-xs text-slate-500">No unpaid fees. The payment will be held as advance credit.</p>
          ) : (
            <div className="space-y-1.5">
              {charges.map((c) => (
                <label key={c.id} className="flex items-center gap-2 rounded-lg border border-slate-100 px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selected.includes(c.id)}
                    onChange={(e) => setSelected((s) => (e.target.checked ? [...s, c.id] : s.filter((x) => x !== c.id)))}
                  />
                  <span className="flex-1">{c.description}</span>
                  <span className="font-semibold">{inr(c.outstanding)}</span>
                </label>
              ))}
              <p className="text-xs text-slate-400">Selected total {inr(selectedTotal)}. Oldest fees are paid first.</p>
            </div>
          )}
        </div>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-4">
        <Field label="Amount received (₹)">
          <Input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Payment method">
          <Select value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="CASH">Cash</option>
            <option value="UPI">UPI</option>
            <option value="BANK_TRANSFER">Bank transfer</option>
            <option value="CHEQUE">Cheque</option>
            <option value="OTHER">Other</option>
          </Select>
        </Field>
        <Field label="Payment date">
          <Input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Transaction reference">
          <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder={method === "CASH" ? "Optional" : "UTR / cheque no."} />
        </Field>
        <div className="md:col-span-4">
          <Field label="Notes (optional)">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
          </Field>
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={save} disabled={busy}>
          {busy ? <Spinner /> : <Check className="size-4" />} Save to ledger
        </Button>
      </div>
    </Card>
  )
}
