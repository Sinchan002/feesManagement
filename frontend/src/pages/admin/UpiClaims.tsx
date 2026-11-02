import { useState } from "react"
import { BadgeCheck, Copy, ShieldCheck, X } from "lucide-react"
import { Alert, Badge, Button, Card, ErrorState, Field, Input, LoadingState, Modal, Spinner } from "../../components/ui"
import { upiApi } from "../../services/api"
import type { UpiClaim } from "../../services/types"
import { errorMessage, formatDate, formatDateTime, inr, periodLabel, timeAgo, useAsync } from "../../lib/format"

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      title="Copy"
      className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true)
          setTimeout(() => setDone(false), 1500)
        })
      }}
    >
      {done ? <BadgeCheck className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
    </button>
  )
}

/** The bank / UPI reference number, large and monospaced so it can be matched against the bank app at a glance. */
function ReferenceBox({ value, size = "md" }: { value: string; size?: "md" | "lg" }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-xl border-2 border-blue-200 bg-blue-50 px-3 py-2">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wider text-blue-700">Bank reference no.</p>
        <p className={`font-mono font-bold tracking-wide text-slate-950 ${size === "lg" ? "text-2xl" : "text-lg"}`}>{value}</p>
      </div>
      <CopyButton text={value} />
    </div>
  )
}

const feeName = (i: UpiClaim["items"][number]) => (i.billingPeriod ? periodLabel(i.billingPeriod) : i.description)

/** Payments the students say they made by UPI, waiting for the teacher to check the bank and confirm. */
export function UpiClaimsPanel({ onChanged }: { onChanged: () => void }) {
  const { data, error, loading, reload } = useAsync(() => upiApi.claims("PENDING"), [])
  const [verifying, setVerifying] = useState<UpiClaim | null>(null)
  const [rejecting, setRejecting] = useState<UpiClaim | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const done = (text: string) => {
    setVerifying(null)
    setRejecting(null)
    setNotice(text)
    void reload()
    onChanged()
  }

  if (loading && !data) return null
  if (error) {
    return (
      <Card>
        <ErrorState message={error} onRetry={reload} />
      </Card>
    )
  }
  const claims = data?.items ?? []
  if (claims.length === 0 && !notice) return null

  return (
    <Card className="border-emerald-200">
      <div className="flex items-center justify-between border-b border-slate-100 p-5 sm:px-6">
        <div>
          <h2 className="flex items-center gap-2 font-bold">
            <ShieldCheck className="size-5 text-emerald-600" /> UPI payments awaiting verification
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Check each reference number in your bank or UPI app, then confirm. Nothing is marked paid until you do.
          </p>
        </div>
        <Badge tone="amber">{claims.length} to verify</Badge>
      </div>
      {notice && (
        <div className="p-4 pb-0 sm:px-6">
          <Alert tone="green" onDismiss={() => setNotice(null)}>
            {notice}
          </Alert>
        </div>
      )}
      <div className="divide-y divide-slate-100">
        {claims.map((c) => (
          <div key={c.id} className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:px-6">
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                {c.student.name} <span className="text-xs font-normal text-slate-400">{c.student.code} • {c.code}</span>
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 text-sm text-slate-600">
                <span className="text-xl font-bold text-slate-900">{inr(c.amount)}</span>
                <span className="text-xs text-slate-400">
                  paid {formatDate(c.paymentDate)} • reported {timeAgo(c.createdAt)}
                </span>
              </p>
              <div className="mt-2">
                <ReferenceBox value={c.transactionReference} />
              </div>
              <p className="mt-1 text-xs text-slate-500">
                For: {c.items.map((i) => `${feeName(i)} (${inr(i.claimedAmount)})`).join(", ")}
              </p>
              {c.notes && <p className="mt-1 text-xs italic text-slate-500">“{c.notes}”</p>}
            </div>
            <div className="flex gap-2">
              <Button onClick={() => setVerifying(c)}>
                <BadgeCheck className="size-4" /> Verify
              </Button>
              <Button variant="secondary" onClick={() => setRejecting(c)}>
                Reject
              </Button>
            </div>
          </div>
        ))}
      </div>
      {verifying && <VerifyModal claim={verifying} onClose={() => setVerifying(null)} onDone={done} />}
      {rejecting && <RejectModal claim={rejecting} onClose={() => setRejecting(null)} onDone={done} />}
    </Card>
  )
}

function VerifyModal({ claim, onClose, onDone }: { claim: UpiClaim; onClose: () => void; onDone: (message: string) => void }) {
  const [selected, setSelected] = useState<string[]>(() => claim.items.filter((i) => i.outstandingNow > 0).map((i) => i.chargeId))
  const [amount, setAmount] = useState(String(claim.amount))
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const received = Number(amount) || 0
  const chosen = claim.items.filter((i) => selected.includes(i.chargeId))
  const dueOnChosen = chosen.reduce((s, i) => s + i.outstandingNow, 0)
  const applied = Math.min(received, dueOnChosen)
  const extra = Math.max(0, Math.round((received - dueOnChosen) * 100) / 100)

  const confirm = async () => {
    setError(null)
    if (!received || received <= 0) return setError("Enter the amount you received.")
    if (chosen.length === 0) return setError("Tick at least one fee to mark as paid.")
    setBusy(true)
    try {
      const res = await upiApi.approve(claim.id, { chargeIds: selected, amount: received, note: note.trim() || undefined })
      onDone(`${claim.student.name}'s payment of ${inr(received)} was verified. Receipt ${res.payment?.receiptNumber ?? ""} issued.`)
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  return (
    <Modal title="Verify UPI payment" eyebrow={`${claim.code} • ${claim.student.name}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4 text-center">
          <p className="text-sm text-slate-600">
            Open your bank or UPI app and look for a <strong>credit of {inr(claim.amount)}</strong> with this reference:
          </p>
          <div className="mt-3">
            <ReferenceBox value={claim.transactionReference} size="lg" />
          </div>
          <p className="mt-3 text-xs text-slate-500">Only continue if you can see it in your account.</p>
        </div>
        {error && <Alert>{error}</Alert>}
        <div>
          <p className="mb-2 text-sm font-semibold text-slate-700">Fees to mark as paid</p>
          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {claim.items.map((i) => (
              <label key={i.chargeId} className={`flex items-center gap-3 px-4 py-3 text-sm ${i.outstandingNow > 0 ? "cursor-pointer" : "opacity-60"}`}>
                <input
                  type="checkbox"
                  className="size-4"
                  checked={selected.includes(i.chargeId)}
                  disabled={i.outstandingNow <= 0 || busy}
                  onChange={(e) => setSelected((s) => (e.target.checked ? [...s, i.chargeId] : s.filter((x) => x !== i.chargeId)))}
                />
                <span className="flex-1">
                  <span className="block font-semibold">{feeName(i)}</span>
                  <span className="block text-xs text-slate-400">{i.code} • due {formatDate(i.dueDate)}</span>
                </span>
                <span className="font-bold">{i.outstandingNow > 0 ? inr(i.outstandingNow) : "Already paid"}</span>
              </label>
            ))}
          </div>
        </div>
        <Field label="Amount you received (₹)">
          <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy} />
        </Field>
        {received > 0 && received !== claim.amount && (
          <p className="text-xs text-amber-700">The student reported {inr(claim.amount)}; you are recording {inr(received)}.</p>
        )}
        <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm">
          <strong>{inr(applied)}</strong> will be applied to {chosen.length} fee{chosen.length === 1 ? "" : "s"}, oldest first
          {dueOnChosen > received && received > 0 ? ` (${inr(dueOnChosen - received)} will still be due)` : ""}
          {extra > 0 ? `; ${inr(extra)} extra is kept as advance credit for later fees` : ""}.
        </div>
        <Field label="Note (optional)">
          <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="e.g. Checked in HDFC statement" disabled={busy} />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={busy}>
            {busy ? <Spinner /> : <BadgeCheck className="size-4" />} Verified — mark as paid
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function RejectModal({ claim, onClose, onDone }: { claim: UpiClaim; onClose: () => void; onDone: (message: string) => void }) {
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reject = async () => {
    if (reason.trim().length < 3) return setError("Give a short reason — the student will see it.")
    setBusy(true)
    setError(null)
    try {
      await upiApi.reject(claim.id, reason.trim())
      onDone(`${claim.student.name}'s report ${claim.code} was rejected. Their fees stay due and they were told why.`)
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  return (
    <Modal title="Reject this payment report?" eyebrow={`${claim.code} • ${claim.student.name}`} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          {inr(claim.amount)}, reported {formatDateTime(claim.createdAt)}. The fees stay unpaid and the student can submit again.
        </p>
        <ReferenceBox value={claim.transactionReference} />
        {error && <Alert>{error}</Alert>}
        <Field label="Reason (shown to the student)">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="e.g. Amount not received in my account" disabled={busy} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={reject} disabled={busy}>
            {busy ? <Spinner /> : <X className="size-4" />} Reject
          </Button>
        </div>
      </div>
    </Modal>
  )
}
