import { useState } from "react"
import { BadgeCheck, Check, Copy, Smartphone, QrCode } from "lucide-react"
import { Alert, Badge, Button, ErrorState, Field, Input, LoadingState, Modal, Spinner } from "../components/ui"
import { upiApi } from "../services/api"
import type { Charge } from "../services/types"
import { dateInputToIso, errorMessage, formatDate, inr, todayISO, useAsync } from "../lib/format"

const REFERENCE_RE = /^[A-Za-z0-9_-]{6,35}$/
const isPhoneBrowser = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

type Step = "pick" | "pay" | "reference"

/**
 * Pay by UPI without a payment gateway: the student pays the teacher's UPI ID / QR from any UPI app,
 * then reports the reference number. The fee stays unpaid until the teacher verifies it.
 */
export function PayUpiModal({
  charges,
  pendingIds,
  studentCode,
  onClose,
  onDone,
}: {
  charges: Charge[]
  pendingIds: string[]
  studentCode: string
  onClose: () => void
  onDone: (message: string) => void
}) {
  const config = useAsync(() => upiApi.config(), [])
  const open = [...charges].filter((c) => c.outstanding > 0).sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  const payable = open.filter((c) => !pendingIds.includes(c.id))
  const [selected, setSelected] = useState<string[]>(() => payable.map((c) => c.id))
  const [step, setStep] = useState<Step>("pick")
  const [reference, setReference] = useState("")
  const [paidOn, setPaidOn] = useState(todayISO())
  const [notes, setNotes] = useState("")
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const chosen = payable.filter((c) => selected.includes(c.id))
  const total = Math.round(chosen.reduce((s, c) => s + c.outstanding, 0) * 100) / 100
  const cfg = config.data

  const appLink = cfg
    ? `upi://pay?pa=${encodeURIComponent(cfg.upiId)}&pn=${encodeURIComponent(cfg.payeeName)}&am=${total.toFixed(2)}&cu=INR&tn=${encodeURIComponent(`School fees ${studentCode}`)}`
    : "#"

  const copy = async (text: string) => {
    await navigator.clipboard?.writeText(text).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const submit = async () => {
    setError(null)
    if (!REFERENCE_RE.test(reference.trim())) return setError("Enter the UPI reference / UTR number from your payment app (6–35 letters or digits, no spaces).")
    setBusy(true)
    try {
      await upiApi.submitClaim({
        chargeIds: chosen.map((c) => c.id),
        transactionReference: reference.trim(),
        paymentDate: dateInputToIso(paidOn),
        notes: notes.trim() || undefined,
      })
      onDone(`Thank you! Your payment of ${inr(total)} (ref ${reference.trim()}) was sent for verification. Your fees will be marked paid once the teacher confirms it.`)
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Pay by UPI"
      description={step === "pick" ? "Choose the months you are paying for." : step === "pay" ? "Make the payment in any UPI app." : "Enter your payment reference."}
      onClose={onClose}
    >
      {config.loading && !cfg ? (
        <LoadingState />
      ) : config.error ? (
        <ErrorState message={config.error} onRetry={config.reload} />
      ) : !cfg?.configured ? (
        <Alert tone="amber">UPI payment is not set up yet. Please pay at the academy.</Alert>
      ) : (
        <div className="space-y-4">
          {error && <Alert>{error}</Alert>}

          {step === "pick" && (
            <>
              {payable.length === 0 ? (
                <Alert tone="amber">All your unpaid fees already have a payment waiting for the teacher to verify.</Alert>
              ) : (
                <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                  {open.map((c) => {
                    const waiting = pendingIds.includes(c.id)
                    return (
                      <label key={c.id} className={`flex items-center gap-3 px-4 py-3 text-sm ${waiting ? "opacity-60" : "cursor-pointer hover:bg-slate-50"}`}>
                        <input
                          type="checkbox"
                          className="size-4"
                          disabled={waiting}
                          checked={selected.includes(c.id)}
                          onChange={(e) => setSelected((s) => (e.target.checked ? [...s, c.id] : s.filter((x) => x !== c.id)))}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block font-semibold">{c.periodLabel ?? c.description}</span>
                          <span className="block text-xs text-slate-400">due {formatDate(c.dueDate)}</span>
                        </span>
                        {waiting ? <Badge tone="amber">Awaiting verification</Badge> : c.isOverdue && <Badge tone="red">Overdue</Badge>}
                        <span className="font-bold">{inr(c.outstanding)}</span>
                      </label>
                    )
                  })}
                </div>
              )}
              <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 text-sm">
                <span className="text-slate-500">
                  {chosen.length} month{chosen.length === 1 ? "" : "s"} selected
                </span>
                <span className="text-lg font-bold">{inr(total)}</span>
              </div>
              <Button className="w-full" disabled={chosen.length === 0} onClick={() => setStep("pay")}>
                Continue
              </Button>
            </>
          )}

          {step === "pay" && (
            <>
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-center">
                <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">Amount to pay</p>
                <p className="mt-1 text-3xl font-bold text-emerald-900">{inr(total)}</p>
                <p className="mt-1 text-xs text-emerald-800">Enter exactly this amount in your UPI app.</p>
              </div>

              {cfg.qrDataUrl ? (
                <div className="mx-auto w-fit rounded-2xl border border-slate-200 bg-white p-3">
                  <img src={cfg.qrDataUrl} alt="UPI QR code — scan to pay" className="size-56 object-contain" />
                  <p className="mt-1 flex items-center justify-center gap-1 text-xs text-slate-400">
                    <QrCode className="size-3.5" /> Scan with any UPI app
                  </p>
                </div>
              ) : (
                <p className="text-center text-xs text-slate-400">No QR code available — use the UPI ID below.</p>
              )}

              <div className="rounded-xl border border-slate-200 p-4 text-sm">
                <p className="text-xs text-slate-400">Pay to</p>
                <p className="mt-0.5 font-semibold">{cfg.payeeName}</p>
                <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
                  <span className="break-all font-mono text-sm">{cfg.upiId}</span>
                  <Button variant="secondary" className="shrink-0" onClick={() => void copy(cfg.upiId)}>
                    {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />} {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
              </div>

              {isPhoneBrowser() && (
                <a href={appLink}>
                  <Button className="w-full" variant="secondary" type="button">
                    <Smartphone className="size-4" /> Open my UPI app ({inr(total)})
                  </Button>
                </a>
              )}

              <Alert tone="blue">
                After paying, note the <strong>UPI reference / UTR number</strong> (shown on the payment success screen and in
                your payment history). You will enter it next.
              </Alert>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setStep("pick")}>
                  Back
                </Button>
                <Button className="flex-1" onClick={() => setStep("reference")}>
                  I have paid — enter reference
                </Button>
              </div>
            </>
          )}

          {step === "reference" && (
            <>
              <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm">
                Reporting a payment of <strong>{inr(total)}</strong> for {chosen.map((c) => c.periodLabel ?? c.description).join(", ")}.
              </div>
              <Field label="UPI reference / UTR number">
                <Input
                  value={reference}
                  onChange={(e) => setReference(e.target.value.replace(/\s+/g, ""))}
                  placeholder="e.g. 412345678901"
                  autoComplete="off"
                  maxLength={35}
                  disabled={busy}
                />
              </Field>
              <Field label="Date you paid">
                <Input type="date" value={paidOn} max={todayISO()} onChange={(e) => setPaidOn(e.target.value)} disabled={busy} />
              </Field>
              <Field label="Note for the teacher (optional)">
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} disabled={busy} />
              </Field>
              <p className="text-xs text-slate-400">
                Your fees are marked paid only after the teacher checks this reference in the bank account. Entering a wrong
                reference will delay this.
              </p>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setStep("pay")} disabled={busy}>
                  Back
                </Button>
                <Button className="flex-1" onClick={submit} disabled={busy}>
                  {busy ? <Spinner /> : <BadgeCheck className="size-4" />} Submit for verification
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  )
}
