import { useEffect, useState } from "react"
import { PHONE_MESSAGE, isPhone } from "../../lib/validation"
import { UpiDetailsCard } from "./UpiDetailsCard"
import { Building2, Check, CircleDollarSign, KeyRound, Mail, RefreshCw } from "lucide-react"
import { Alert, Badge, Button, Card, ErrorState, Field, Input, LoadingState, PageHeader, Select, Spinner } from "../../components/ui"
import { authApi, settingsApi } from "../../services/api"
import type { Settings } from "../../services/types"
import { errorMessage, periodLabel, useAsync } from "../../lib/format"

export function SettingsPage() {
  const remote = useAsync(() => settingsApi.get(), [])
  const health = useAsync(() => settingsApi.health(), [])
  const [form, setForm] = useState<Settings | null>(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ tone: "green" | "red"; text: string } | null>(null)

  useEffect(() => {
    if (remote.data) setForm(remote.data)
  }, [remote.data])

  const set = <K extends keyof Settings>(section: K, values: Partial<Settings[K]>) =>
    setForm((f) => (f ? { ...f, [section]: { ...f[section], ...values } } : f))

  const save = async () => {
    if (!form) return
    if (form.academy.phone.trim() && !isPhone(form.academy.phone)) {
      setNotice({ tone: "red", text: `Academy phone: ${PHONE_MESSAGE}` })
      return
    }
    setSaving(true)
    setNotice(null)
    try {
      const saved = await settingsApi.update(form)
      setForm(saved)
      setNotice({ tone: "green", text: "Settings saved." })
    } catch (e) {
      setNotice({ tone: "red", text: errorMessage(e) })
    } finally {
      setSaving(false)
    }
  }

  if (remote.loading && !form) return <LoadingState />
  if (remote.error) return <ErrorState message={remote.error} onRetry={remote.reload} />
  if (!form) return null
  const h = health.data

  return (
    <div className="space-y-7">
      <PageHeader eyebrow="Configuration" title="Settings" description="Manage billing, reminder schedules, payment options, and your account." />
      {notice && (
        <Alert tone={notice.tone} onDismiss={() => setNotice(null)}>
          {notice.text}
        </Alert>
      )}
      <div className="grid gap-6 xl:grid-cols-[1.2fr_.8fr]">
        <div className="space-y-6">
          <Card className="p-6">
            <SectionTitle icon={<Building2 className="size-5" />} tone="bg-slate-100 text-slate-600" title="Academy details" description="Printed on receipts and shown to students." />
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <Field label="Academy name">
                <Input value={form.academy.name} onChange={(e) => set("academy", { name: e.target.value })} />
              </Field>
              <Field label="Teacher name">
                <Input value={form.academy.teacherName} onChange={(e) => set("academy", { teacherName: e.target.value })} />
              </Field>
              <Field label="Address">
                <Input value={form.academy.address} onChange={(e) => set("academy", { address: e.target.value })} />
              </Field>
              <Field label="Phone">
                <Input
                  value={form.academy.phone}
                  placeholder="e.g. 98765 43210 or 03242 255123"
                  onChange={(e) => set("academy", { phone: e.target.value })}
                />
                {form.academy.phone.trim() && !isPhone(form.academy.phone) && (
                  <span className="mt-1 block text-xs text-red-600">{PHONE_MESSAGE}</span>
                )}
              </Field>
            </div>
          </Card>
          <Card className="p-6">
            <SectionTitle
              icon={<Mail className="size-5" />}
              tone="bg-blue-50 text-blue-600"
              title="Billing & reminders"
              description="The server generates monthly fees and emails students (and parents) with unpaid fees."
            />
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <Field label="Monthly fee due on day">
                <Select value={form.billing.dueDay} onChange={(e) => set("billing", { dueDay: Number(e.target.value) })}>
                  {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Send reminders every month on">
                <Select value={form.reminders.dayOfMonth} onChange={(e) => set("reminders", { dayOfMonth: Number(e.target.value) })}>
                  {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Reminder time">
                <Input type="time" value={form.reminders.time} onChange={(e) => set("reminders", { time: e.target.value })} />
              </Field>
              <Field label="Reply-to email">
                <Input type="email" value={form.reminders.replyTo} onChange={(e) => set("reminders", { replyTo: e.target.value })} />
              </Field>
              <Field label="Grace period (days)">
                <Input
                  type="number"
                  min={0}
                  max={60}
                  value={form.reminders.gracePeriodDays}
                  onChange={(e) => set("reminders", { gracePeriodDays: Number(e.target.value) })}
                />
              </Field>
            </div>
            <div className="mt-5 grid gap-3">
              <Toggle
                checked={form.billing.autoGenerateCharges}
                onChange={(v) => set("billing", { autoGenerateCharges: v })}
                title="Generate monthly fees automatically"
                description="On the 1st of each month, bill every enrolled student at their batch's current fee."
              />
              <Toggle checked={form.reminders.enabled} onChange={(v) => set("reminders", { enabled: v })} title="Send automatic fee reminders" description="Emails students with unpaid fees on the chosen day." />
              <Toggle
                checked={form.reminders.notifyParents}
                onChange={(v) => set("reminders", { notifyParents: v })}
                title="Also remind parents"
                description="Sends the same due-fee reminder to the parent's email."
              />
              <Toggle
                checked={form.notifications.sendPaymentReceipts}
                onChange={(v) => set("notifications", { sendPaymentReceipts: v })}
                title="Student payment-success emails"
                description="Send the receipt to the student after a payment is recorded or verified."
              />
            </div>
          </Card>
          <Card className="p-6">
            <SectionTitle icon={<CircleDollarSign className="size-5" />} tone="bg-violet-50 text-violet-600" title="Payment methods" description="Control the online payment options offered to students." />
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {(
                [
                  ["upi", "UPI & QR"],
                  ["card", "Credit / debit card"],
                  ["netBanking", "Net banking"],
                  ["cash", "Pay in cash at the academy"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex items-center gap-3 rounded-xl border border-slate-200 p-4 text-sm font-medium">
                  <input type="checkbox" checked={form.paymentMethods[key]} onChange={(e) => set("paymentMethods", { [key]: e.target.checked })} />
                  {label}
                </label>
              ))}
            </div>
            {!form.paymentMethods.upi && !form.paymentMethods.card && !form.paymentMethods.netBanking && (
              <p className="mt-3 text-xs text-amber-700">With no online method enabled, students cannot pay online.</p>
            )}
          </Card>
          <UpiDetailsCard />
          <Button onClick={save} disabled={saving}>
            {saving ? <Spinner /> : notice?.tone === "green" ? <Check className="size-4" /> : <RefreshCw className="size-4" />}
            Save changes
          </Button>
        </div>
        <div className="space-y-6">
          <Card className="h-fit p-6">
            <h2 className="font-bold">Automation health</h2>
            {!h ? (
              <p className="mt-4 text-sm text-slate-500">{health.error ?? "Loading…"}</p>
            ) : (
              <div className="mt-5 space-y-4 text-sm">
                <Row label="Email provider">
                  <Badge tone={h.emailProvider === "CONNECTED" ? "green" : "amber"}>{h.emailProvider === "CONNECTED" ? "Connected" : "Not configured (console only)"}</Badge>
                </Row>
                <Row label="Payment gateway">
                  <Badge tone={h.paymentGatewayLive ? "green" : h.paymentGateway === "none" ? "slate" : "amber"}>
                    {h.paymentGatewayLive ? "Razorpay (live)" : h.paymentGateway === "none" ? "Not used (UPI only)" : "Test mode"}
                  </Badge>
                </Row>
                <Row label="Scheduler">
                  <Badge tone={h.schedulerEnabled ? "blue" : "slate"}>{h.schedulerEnabled ? "Running" : "Manual (generate fees yourself)"}</Badge>
                </Row>
                <Row label="Last fee generation">
                  <span className="font-semibold">{h.lastChargeGeneration ? periodLabel(h.lastChargeGeneration) : "Never"}</span>
                </Row>
                <Row label="Last reminders">
                  <span className="font-semibold">{h.lastReminderRun ? periodLabel(h.lastReminderRun) : "Never"}</span>
                </Row>
              </div>
            )}
          </Card>
          <ChangePasswordCard />
        </div>
      </div>
    </div>
  )
}

function ChangePasswordCard() {
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ tone: "green" | "red"; text: string } | null>(null)

  const save = async () => {
    setMsg(null)
    if (next.length < 8 || !/[A-Za-z]/.test(next) || !/\d/.test(next)) {
      return setMsg({ tone: "red", text: "New password needs 8+ characters with a letter and a number." })
    }
    setBusy(true)
    try {
      await authApi.changePassword(current, next)
      setMsg({ tone: "green", text: "Password changed. Other devices were signed out." })
      setCurrent("")
      setNext("")
    } catch (e) {
      setMsg({ tone: "red", text: errorMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="p-6">
      <SectionTitle icon={<KeyRound className="size-5" />} tone="bg-slate-100 text-slate-600" title="Change password" description="Signs you out on all other devices." />
      <div className="mt-5 space-y-4">
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        <Field label="Current password">
          <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field label="New password">
          <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <Button variant="secondary" onClick={save} disabled={busy || !current || !next}>
          {busy && <Spinner />} Update password
        </Button>
      </div>
    </Card>
  )
}

function SectionTitle({ icon, tone, title, description }: { icon: React.ReactNode; tone: string; title: string; description: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className={`rounded-xl p-2.5 ${tone}`}>{icon}</div>
      <div>
        <h2 className="font-bold">{title}</h2>
        <p className="mt-1 text-sm text-slate-500">{description}</p>
      </div>
    </div>
  )
}

function Toggle({ checked, onChange, title, description }: { checked: boolean; onChange: (v: boolean) => void; title: string; description: string }) {
  return (
    <label className="flex items-center gap-3 rounded-xl bg-slate-50 p-4 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-4" />
      <span>
        <strong>{title}</strong>
        <span className="block text-xs text-slate-500">{description}</span>
      </span>
    </label>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-slate-500">{label}</span>
      {children}
    </div>
  )
}
