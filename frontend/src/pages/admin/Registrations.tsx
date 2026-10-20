import { useEffect, useState } from "react"
import { Check, ChevronRight, Inbox, Trash2 } from "lucide-react"
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
  Modal,
  PageHeader,
  SearchBox,
  Select,
  Spinner,
} from "../../components/ui"
import { batchesApi, registrationsApi } from "../../services/api"
import type { Batch, Registration } from "../../services/types"
import { errorMessage, formatDate, formatDateTime, inr, initialsOf, timeAgo, useAsync, useDebounced } from "../../lib/format"

export function RegistrationsPage() {
  const [search, setSearch] = useState("")
  const query = useDebounced(search)
  const list = useAsync(() => registrationsApi.list({ status: "PENDING", search: query, pageSize: 100 }), [query])
  const batches = useAsync(() => batchesApi.list({ status: "ACTIVE" }), [])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const items = list.data?.items ?? []
  const selected = items.find((r) => r.id === selectedId) ?? items[0] ?? null

  const removeFromList = (id: string, message: string) => {
    list.setData((d) => (d ? { ...d, items: d.items.filter((r) => r.id !== id), meta: { ...d.meta, total: d.meta.total - 1 } } : d))
    setSelectedId(null)
    setNotice(message)
    void batches.reload() // seat counts changed
  }

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Admissions"
        title="Registration requests"
        description="Review student preferences, then approve and allocate a batch, or decline the request."
        action={<Badge tone="amber">{list.data?.meta.total ?? 0} awaiting review</Badge>}
      />
      {notice && (
        <Alert tone="green" onDismiss={() => setNotice(null)}>
          {notice}
        </Alert>
      )}
      <div className="grid gap-6 xl:grid-cols-[1.2fr_.8fr]">
        <Card className="overflow-hidden">
          <div className="border-b border-slate-100 p-4">
            <SearchBox value={search} onChange={setSearch} placeholder="Search by name, email, class or number" />
          </div>
          {list.loading && !list.data ? (
            <LoadingState />
          ) : list.error ? (
            <ErrorState message={list.error} onRetry={list.reload} />
          ) : items.length === 0 ? (
            <EmptyState
              icon={<Inbox />}
              title={query ? "No matching requests" : "No pending registrations"}
              description="New student registrations will appear here for review."
            />
          ) : (
            <div className="divide-y divide-slate-100">
              {items.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setSelectedId(r.id)}
                  className={`flex w-full items-center gap-4 p-4 text-left transition hover:bg-slate-50 sm:px-6 ${
                    selected?.id === r.id ? "bg-blue-50/60" : ""
                  }`}
                >
                  <div className="grid size-10 shrink-0 place-items-center rounded-full bg-slate-100 text-xs font-bold text-slate-600">
                    {initialsOf(r.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 truncate text-sm font-semibold">
                      {r.name} {r.kind === "REALLOCATION" && <Badge tone="violet">Needs new batch</Badge>}
                    </p>
                    <p className="mt-1 truncate text-xs text-slate-500">
                      {r.schoolClass} • {r.requestedSubjects.join(", ") || "No subjects listed"}
                      {r.notes ? ` • ${r.notes}` : ""}
                    </p>
                  </div>
                  <div className="hidden text-right sm:block">
                    <p className="text-xs text-slate-500">{timeAgo(r.submittedAt)}</p>
                    <p className="mt-1 text-[11px] text-slate-400">{r.code}</p>
                  </div>
                  <ChevronRight className="size-4 text-slate-400" />
                </button>
              ))}
            </div>
          )}
        </Card>
        {selected && (
          <ReviewPanel
            key={selected.id}
            registration={selected}
            batches={batches.data ?? []}
            onApproved={(r, batchName, firstCharge) =>
              removeFromList(
                r.id,
                (r.kind === "REALLOCATION" ? `${r.name} was moved to ${batchName}.` : `${r.name} was approved and allocated to ${batchName}.`) +
                  (firstCharge
                    ? ` This month's fee of ${inr(firstCharge.amount)} was billed (due ${formatDate(firstCharge.dueDate)}).`
                    : " No fee was billed for this month (placed on or after the 15th, already billed, or a ₹0 batch)."),
              )
            }
            onDeclined={(r) =>
              removeFromList(
                r.id,
                r.kind === "REALLOCATION"
                  ? `${r.name}'s request was dismissed. They remain a student without a batch.`
                  : `${r.name}'s registration was declined and their details were permanently deleted.`,
              )
            }
          />
        )}
      </div>
    </div>
  )
}

function ReviewPanel({
  registration: r,
  batches,
  onApproved,
  onDeclined,
}: {
  registration: Registration
  batches: Batch[]
  onApproved: (r: Registration, batchName: string, firstCharge: { amount: number; dueDate: string } | null) => void
  onDeclined: (r: Registration) => void
}) {
  const [batchId, setBatchId] = useState(r.preferredBatch?.id ?? "")
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [declineOpen, setDeclineOpen] = useState(false)

  useEffect(() => {
    // Once batches have loaded, keep the preferred batch only if it is still active with seats.
    if (batches.length === 0 || !r.preferredBatch) return
    const selectable = batches.some((b) => b.id === r.preferredBatch!.id && b.seatsAvailable > 0)
    setBatchId((current) => (current === r.preferredBatch!.id && !selectable ? "" : current))
  }, [batches, r.preferredBatch])

  const sameClass = batches.filter((b) => b.classLevel === r.schoolClass)
  const others = batches.filter((b) => b.classLevel !== r.schoolClass)

  const approve = async () => {
    if (!batchId) return setError("Choose a batch to allocate.")
    setBusy(true)
    setError(null)
    try {
      const res = await registrationsApi.approve(r.id, batchId, note.trim() || undefined)
      onApproved(r, batches.find((b) => b.id === batchId)?.name ?? "the batch", res.firstCharge)
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  const option = (b: Batch) => (
    <option key={b.id} value={b.id} disabled={b.seatsAvailable <= 0}>
      {b.name} • {b.schedule} • {b.time} • {inr(b.monthlyFee)} ({b.seatsAvailable > 0 ? `${b.seatsAvailable} seats left` : "full"})
    </option>
  )

  return (
    <Card className="h-fit p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wider text-blue-600">
            {r.kind === "REALLOCATION" ? `Re-allocation ${r.code} • student ${r.studentCode ?? ""}` : `Application ${r.code}`}
          </p>
          <h2 className="mt-2 text-xl font-bold">{r.name}</h2>
          <p className="truncate text-sm text-slate-500">{r.email}</p>
          <p className="text-sm text-slate-500">{r.phone}</p>
        </div>
        <Badge tone={r.kind === "REALLOCATION" ? "violet" : "amber"}>{r.kind === "REALLOCATION" ? "Needs new batch" : "Pending"}</Badge>
      </div>
      {r.kind === "REALLOCATION" && (
        <div className="mt-4">
          <Alert tone="blue">
            This is an existing student whose batch was deleted. Their account, fees and receipts are unchanged; choose a
            new batch for them.
          </Alert>
        </div>
      )}
      <dl className="mt-6 grid grid-cols-2 gap-4 rounded-2xl bg-slate-50 p-4 text-sm">
        <div>
          <dt className="text-xs text-slate-400">Class</dt>
          <dd className="mt-1 font-semibold">{r.schoolClass}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-400">Submitted</dt>
          <dd className="mt-1 font-semibold">{formatDateTime(r.submittedAt)}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-400">Subjects</dt>
          <dd className="mt-1 font-semibold">{r.requestedSubjects.join(", ") || "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-400">Preferred batch</dt>
          <dd className="mt-1 font-semibold">{r.preferredBatch?.name ?? "No preference"}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-xs text-slate-400">Notes</dt>
          <dd className="mt-1 leading-6 font-semibold">{r.notes || "—"}</dd>
        </div>
      </dl>
      <div className="mt-6 space-y-4">
        {error && <Alert>{error}</Alert>}
        <Field label="Allocate batch">
          <Select value={batchId} onChange={(e) => setBatchId(e.target.value)}>
            <option value="">Select an active batch</option>
            {sameClass.length > 0 && <optgroup label={`${r.schoolClass} batches`}>{sameClass.map(option)}</optgroup>}
            {others.length > 0 && <optgroup label="Other batches">{others.map(option)}</optgroup>}
          </Select>
        </Field>
        {batches.length === 0 && (
          <p className="text-xs text-amber-700">There are no active batches. Create one on the Batches page first.</p>
        )}
        <Field label="Internal note (optional)">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add context for the allocation" maxLength={500} />
        </Field>
      </div>
      <div className="mt-6 flex gap-2">
        <Button className="flex-1" onClick={approve} disabled={busy}>
          {busy ? <Spinner /> : <Check className="size-4" />} {r.kind === "REALLOCATION" ? "Allocate batch" : "Approve & allocate"}
        </Button>
        <Button variant="secondary" onClick={() => setDeclineOpen(true)} disabled={busy}>
          {r.kind === "REALLOCATION" ? "Dismiss" : "Decline"}
        </Button>
      </div>
      <p className="mt-4 text-xs leading-5 text-slate-400">
        {r.kind === "REALLOCATION"
          ? "Dismissing removes this request only; the student stays without a batch and you can assign one later from Students."
          : "Approval activates the student's account and they can use the student dashboard immediately. Declining permanently deletes the applicant's account and details."}
      </p>
      {declineOpen && <DeclineDialog registration={r} onClose={() => setDeclineOpen(false)} onDeclined={onDeclined} />}
    </Card>
  )
}

function DeclineDialog({
  registration: r,
  onClose,
  onDeclined,
}: {
  registration: Registration
  onClose: () => void
  onDeclined: (r: Registration) => void
}) {
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const decline = async () => {
    setBusy(true)
    setError(null)
    try {
      await registrationsApi.decline(r.id, reason.trim() || undefined)
      onDeclined(r)
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  return (
    <Modal title={r.kind === "REALLOCATION" ? `Dismiss request for ${r.name}?` : `Decline ${r.name}?`} eyebrow={r.code} onClose={onClose}>
      <div className="space-y-4">
        {r.kind === "REALLOCATION" ? (
          <Alert tone="blue">
            Only this request is removed. {r.name} remains an active student (with their fees and receipts) but without a
            batch until you assign one from the Students page.
          </Alert>
        ) : (
          <Alert tone="amber">
            This permanently deletes {r.name}'s registration and account ({r.email}). It cannot be undone. They will get an
            email and can register again later.
          </Alert>
        )}
        {error && <Alert>{error}</Alert>}
        <Field label={r.kind === "REALLOCATION" ? "Note (optional)" : "Reason (optional — included in the email)"}>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. All Grade 12 batches are full" maxLength={500} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={decline} disabled={busy}>
            {busy ? <Spinner /> : <Trash2 className="size-4" />} {r.kind === "REALLOCATION" ? "Dismiss request" : "Decline & delete"}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
