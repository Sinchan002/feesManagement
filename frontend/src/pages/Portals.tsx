import { useState } from "react"
import { MOBILE_MESSAGE, isMobile } from "../lib/validation"
import {
  CalendarDays,
  Check,
  CheckCircle2,
  Clock,
  Download,
  Mail,
  MapPin,
  Pencil,
  Phone,
  ReceiptText,
  Smartphone,
  ShieldCheck,
  UserRound,
} from "lucide-react"
import { Alert, Badge, Button, Card, ErrorState, Field, Input, LoadingState, Modal, PageHeader, Spinner } from "../components/ui"
import { meApi, paymentsApi } from "../services/api"
import { PayUpiModal } from "./PayUpiModal"
import type { Payment, Student } from "../services/types"
import { errorMessage, formatDate, inr, methodLabel, periodLabel, useAsync } from "../lib/format"

export function StudentPortalPage() {
  const dash = useAsync(() => meApi.dashboard(), [])
  const history = useAsync(() => meApi.payments(), [])
  const [notice, setNotice] = useState<{ tone: "green" | "red" | "amber"; text: string } | null>(null)
  const [editing, setEditing] = useState(false)
  const [payingUpi, setPayingUpi] = useState(false)

  const reloadAll = () => {
    void dash.reload()
    void history.reload()
  }

  if (dash.loading && !dash.data) return <LoadingState />
  if (dash.error) return <ErrorState message={dash.error} onRetry={dash.reload} />
  const d = dash.data
  if (!d) return null
  const p = d.profile
  // Fees that already have a UPI payment waiting for the teacher can't be paid a second time.
  const payable = d.openCharges.filter((c) => !d.pendingClaimChargeIds.includes(c.id))

  const download = (id: string) => void paymentsApi.receiptPdf(id).catch((e) => setNotice({ tone: "red", text: errorMessage(e) }))

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Student dashboard"
        title={`Hello, ${p.name.split(" ")[0]}`}
        description="Your profile, class details, fee status, and receipts—all in one place."
      />
      {notice && (
        <Alert tone={notice.tone} onDismiss={() => setNotice(null)}>
          {notice.text}
        </Alert>
      )}
      <div className="grid gap-5 lg:grid-cols-3">
        <section className="relative overflow-hidden rounded-2xl bg-slate-950 p-6 text-white shadow-sm lg:col-span-2">
          <div className="absolute -right-16 -top-20 size-64 rounded-full bg-blue-600/30 blur-3xl" />
          <div className="relative">
            {d.feeStatus === "PAID" ? (
              <Badge tone="green">All fees paid</Badge>
            ) : d.feeStatus === "OVERDUE" ? (
              <Badge tone="red">Payment overdue</Badge>
            ) : (
              <Badge tone="amber">Fee due</Badge>
            )}
            <p className="mt-8 text-sm text-slate-400">{d.outstanding > 0 ? "Total due" : "Nothing due right now"}</p>
            <p className="mt-1 text-3xl font-bold">{inr(d.outstanding)}</p>
            {d.nextDue && (
              <p className="mt-2 text-sm text-slate-300">
                {d.nextDue.description} — due by {formatDate(d.nextDue.dueDate)}
              </p>
            )}
            {d.openCharges.length > 1 && (
              <ul className="mt-3 space-y-1 text-xs text-slate-400">
                {d.openCharges.map((c) => (
                  <li key={c.id}>
                    {c.periodLabel ?? c.description}: {inr(c.outstanding)}
                    {c.isOverdue ? " (overdue)" : ""}
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-8 flex flex-wrap gap-3">
              <button
                type="button"
                className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
                disabled={!d.upi.configured || payable.length === 0}
                onClick={() => setPayingUpi(true)}
              >
                <Smartphone className="size-4" /> Pay by UPI
              </button>
              <button
                type="button"
                className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
                disabled={!d.latestReceiptPaymentId}
                onClick={() => d.latestReceiptPaymentId && download(d.latestReceiptPaymentId)}
              >
                <ReceiptText className="size-4" /> Latest receipt
              </button>
            </div>
            <p className="mt-5 flex items-center gap-2 text-xs text-slate-400">
              <ShieldCheck className="size-4" />
              {d.upi.configured
                ? "Fees are marked paid after your teacher verifies your UPI reference number."
                : "UPI payment is not set up yet. Please pay at the academy."}
            </p>
          </div>
        </section>
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <h2 className="font-bold">Your batch</h2>
            {p.batch && <Badge tone="blue">{p.batch.status === "ACTIVE" ? "Active" : "Paused"}</Badge>}
          </div>
          {p.batch ? (
            <>
              <p className="mt-6 text-lg font-bold">{p.batch.name}</p>
              <div className="mt-5 space-y-3 text-sm text-slate-600">
                <p className="flex items-center gap-3">
                  <CalendarDays className="size-4 text-blue-600" /> {p.batch.schedule}
                </p>
                <p className="flex items-center gap-3">
                  <Clock className="size-4 text-blue-600" /> {p.batch.time}
                </p>
              </div>
            </>
          ) : (
            <p className="mt-6 text-sm text-slate-500">You haven't been assigned to a batch yet. Your teacher will allocate one.</p>
          )}
          <div className="mt-6 border-t border-slate-100 pt-5">
            <p className="text-xs text-slate-400">Teacher</p>
            <p className="mt-1 text-sm font-semibold">{d.teacher}</p>
          </div>
        </Card>
      </div>

      <Card id="profile">
        <div className="flex flex-col gap-4 border-b border-slate-100 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="flex items-center gap-4">
            <div className="grid size-14 place-items-center rounded-2xl bg-blue-50 text-lg font-bold text-blue-700">{p.initials}</div>
            <div>
              <h2 className="font-bold">Student profile</h2>
              <p className="mt-1 text-xs text-slate-500">Your personal, academic, and parent contact details</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone="green">Enrollment active</Badge>
            <Button variant="secondary" onClick={() => setEditing(true)}>
              <Pencil className="size-4" /> Edit
            </Button>
          </div>
        </div>
        <div className="grid gap-8 p-5 sm:p-6 lg:grid-cols-2">
          <section>
            <div className="mb-5 flex items-center gap-2">
              <UserRound className="size-4 text-blue-600" />
              <h3 className="text-sm font-bold">Personal details</h3>
            </div>
            <dl className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
              <Detail label="Full name" value={p.name} />
              <Detail label="Student ID" value={p.code} />
              <Detail label="Email address" value={p.email} icon={<Mail className="size-3.5 text-slate-400" />} />
              <Detail label="Phone number" value={p.phone} icon={<Phone className="size-3.5 text-slate-400" />} />
              <Detail label="Class" value={p.schoolClass} />
              <Detail label="Joined on" value={formatDate(p.joinedAt)} />
              <div className="sm:col-span-2">
                <Detail label="Address" value={p.address} icon={<MapPin className="mt-0.5 size-3.5 shrink-0 text-slate-400" />} />
              </div>
            </dl>
          </section>
          <section className="border-t border-slate-100 pt-8 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
            <div className="mb-5 flex items-center gap-2">
              <ShieldCheck className="size-4 text-violet-600" />
              <h3 className="text-sm font-bold">Academic & parent details</h3>
            </div>
            <dl className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
              <Detail label="Batch" value={p.batch?.name} />
              <Detail label="Monthly fee" value={p.batch ? inr(p.batch.monthlyFee) : null} />
              <Detail label="Subjects" value={p.subjects.join(", ")} />
              <Detail label="Parent name" value={p.parent.name} />
              <Detail label="Relationship" value={p.parent.relation} />
              <Detail label="Parent email" value={p.parent.email} />
              <Detail label="Parent phone" value={p.parent.phone} />
            </dl>
            {!p.parent.name && (
              <div className="mt-6 rounded-xl bg-blue-50 p-4 text-xs leading-5 text-blue-800">
                Add your parent's details with <strong>Edit</strong> so they can receive fee reminders.
              </div>
            )}
            <div className="mt-6 rounded-xl bg-amber-50 p-4 text-xs leading-5 text-amber-800">
              The parent contact is used only for automated reminder emails when a fee is due.
            </div>
          </section>
        </div>
      </Card>

      {d.upiClaims.length > 0 && (
        <Card>
          <div className="border-b border-slate-100 p-5 sm:p-6">
            <h2 className="font-bold">Your UPI payment reports</h2>
            <p className="mt-1 text-xs text-slate-500">Fees are marked paid once the teacher verifies the reference number.</p>
          </div>
          <div className="divide-y divide-slate-100">
            {d.upiClaims.map((c) => (
              <div key={c.id} className="flex flex-col gap-2 p-5 sm:flex-row sm:items-center sm:px-6">
                <div className="min-w-0 flex-1">
                  <p className="text-lg font-bold">{inr(c.amount)}</p>
                  <p className="mt-0.5 text-sm text-slate-600">
                    Reference no. <span className="font-mono text-base font-bold tracking-wide text-slate-950">{c.transactionReference}</span>
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {c.items.map((i) => (i.billingPeriod ? periodLabel(i.billingPeriod) : i.description)).join(", ")} • reported {formatDate(c.createdAt)}
                  </p>
                  {c.status === "REJECTED" && c.reviewNote && <p className="mt-1 text-xs text-red-600">Reason: {c.reviewNote}</p>}
                </div>
                {c.status === "PENDING" && <Badge tone="amber">Awaiting verification</Badge>}
                {c.status === "REJECTED" && <Badge tone="red">Not verified</Badge>}
                {c.status === "APPROVED" && (
                  <>
                    <Badge tone="green">Verified</Badge>
                    {c.payment && (
                      <Button variant="ghost" onClick={() => download(c.payment!.id)}>
                        <Download className="size-4" /> Receipt
                      </Button>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <div className="border-b border-slate-100 p-5 sm:p-6">
          <h2 className="font-bold">Payment history</h2>
          <p className="mt-1 text-xs text-slate-500">Download receipts for completed payments</p>
        </div>
        {history.loading && !history.data ? (
          <LoadingState />
        ) : !history.data?.length ? (
          <p className="p-6 text-sm text-slate-500">No payments yet.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {history.data.map((pay) => (
              <PaymentRow key={pay.id} payment={pay} onDownload={download} />
            ))}
          </div>
        )}
      </Card>

      {editing && (
        <EditProfileModal
          student={p}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false)
            setNotice({ tone: "green", text: "Your profile was updated." })
            void dash.reload()
          }}
        />
      )}
      {payingUpi && (
        <PayUpiModal
          charges={d.openCharges}
          pendingIds={d.pendingClaimChargeIds}
          studentCode={p.code}
          onClose={() => setPayingUpi(false)}
          onDone={(text) => {
            setPayingUpi(false)
            setNotice({ tone: "green", text })
            reloadAll()
          }}
        />
      )}
    </div>
  )
}

function Detail({ label, value, icon }: { label: string; value: string | null | undefined; icon?: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className="mt-1 flex items-start gap-2 text-sm font-semibold">
        {icon}
        {value || <span className="font-normal text-slate-400">Not provided</span>}
      </dd>
    </div>
  )
}

function PaymentRow({ payment: p, onDownload }: { payment: Payment; onDownload: (id: string) => void }) {
  return (
    <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:px-6">
      <div
        className={`grid size-10 shrink-0 place-items-center rounded-full ${p.status === "VOIDED" ? "bg-red-50 text-red-500" : "bg-emerald-50 text-emerald-600"}`}
      >
        <CheckCircle2 className="size-5" />
      </div>
      <div className="flex-1">
        <p className="text-sm font-semibold">
          {p.periods.map(periodLabel).join(", ") || "Advance payment"} {p.status === "VOIDED" && <Badge tone="red">Voided</Badge>}
        </p>
        <p className="mt-1 text-xs text-slate-400">
          {formatDate(p.paymentDate)} • {methodLabel(p.method)} • {p.receiptNumber}
        </p>
      </div>
      <p className="font-bold">{inr(p.amount)}</p>
      <Button variant="ghost" onClick={() => onDownload(p.id)}>
        <Download className="size-4" /> Receipt
      </Button>
    </div>
  )
}

function EditProfileModal({ student, onClose, onSaved }: { student: Student; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState({
    phone: student.phone ?? "",
    address: student.address ?? "",
    parentName: student.parent.name ?? "",
    parentRelation: student.parent.relation ?? "",
    parentEmail: student.parent.email ?? "",
    parentPhone: student.parent.phone ?? "",
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const field = (k: keyof typeof v) => ({ value: v[k], onChange: (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value }) })

  const save = async () => {
    setError(null)
    if (!isMobile(v.phone)) return setError(`Your phone: ${MOBILE_MESSAGE}`)
    if (v.parentPhone.trim() && !isMobile(v.parentPhone)) return setError(`Parent phone: ${MOBILE_MESSAGE}`)
    setBusy(true)
    try {
      await meApi.updateProfile(v)
      onSaved()
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  return (
    <Modal title="Edit your details" description="Name, email, class and batch are managed by your teacher." onClose={onClose} size="lg">
      <div className="grid gap-4 sm:grid-cols-2">
        {error && (
          <div className="sm:col-span-2">
            <Alert>{error}</Alert>
          </div>
        )}
        <Field label="Phone">
          <Input {...field("phone")} />
        </Field>
        <Field label="Address">
          <Input {...field("address")} />
        </Field>
        <Field label="Parent name">
          <Input {...field("parentName")} />
        </Field>
        <Field label="Relationship">
          <Input placeholder="e.g. Mother" {...field("parentRelation")} />
        </Field>
        <Field label="Parent email">
          <Input type="email" {...field("parentEmail")} />
        </Field>
        <Field label="Parent phone">
          <Input {...field("parentPhone")} />
        </Field>
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? <Spinner /> : <Check className="size-4" />} Save
          </Button>
        </div>
      </div>
    </Modal>
  )
}
