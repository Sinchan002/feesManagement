import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { ArrowRightLeft, Check, KeyRound, Pencil, Power, SearchX, Trash2, UserPlus } from "lucide-react"
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
  Pagination,
  SearchBox,
  Select,
  Spinner,
} from "../../components/ui"
import { batchesApi, feesApi, paymentsApi, studentsApi } from "../../services/api"
import type { Batch, Charge, Student, StudentDetail } from "../../services/types"
import { errorMessage, formatDate, inr, methodLabel, useAsync, useDebounced } from "../../lib/format"
import { CLASS_SUGGESTIONS } from "../../lib/academics"

const feeTone = { PAID: "green", DUE: "amber", OVERDUE: "red" } as const
const feeLabel = { PAID: "Paid", DUE: "Due", OVERDUE: "Overdue" } as const

export function StudentsPage() {
  const [search, setSearch] = useState("")
  const query = useDebounced(search)
  const [status, setStatus] = useState("ACTIVE")
  const [feeStatus, setFeeStatus] = useState("")
  const [batchId, setBatchId] = useState("")
  const [page, setPage] = useState(1)
  const batches = useAsync(() => batchesApi.list(), [])
  const list = useAsync(
    () => studentsApi.list({ search: query, status, feeStatus, batchId, page, pageSize: 25 }),
    [query, status, feeStatus, batchId, page],
  )
  const [openId, setOpenId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const filter = (setter: (v: string) => void) => (v: string) => {
    setter(v)
    setPage(1)
  }

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Directory"
        title="Students"
        description="Profiles, parent contacts, batch membership, and current fee standing."
        action={
          <Button onClick={() => setAdding(true)}>
            <UserPlus className="size-4" /> Add student
          </Button>
        }
      />
      {notice && (
        <Alert tone="green" onDismiss={() => setNotice(null)}>
          {notice}
        </Alert>
      )}
      <Card>
        <div className="grid gap-3 border-b border-slate-100 p-4 md:grid-cols-[1fr_auto_auto_auto]">
          <SearchBox value={search} onChange={filter(setSearch)} placeholder="Search students, parents, phone, batch" />
          <div className="md:w-40">
            <Select value={status} onChange={(e) => filter(setStatus)(e.target.value)} aria-label="Account status">
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Deactivated</option>
              <option value="ALL">All students</option>
            </Select>
          </div>
          <div className="md:w-40">
            <Select value={feeStatus} onChange={(e) => filter(setFeeStatus)(e.target.value)} aria-label="Fee status">
              <option value="">Any fee status</option>
              <option value="PAID">Paid up</option>
              <option value="DUE">Due</option>
              <option value="OVERDUE">Overdue</option>
            </Select>
          </div>
          <div className="md:w-52">
            <Select value={batchId} onChange={(e) => filter(setBatchId)(e.target.value)} aria-label="Batch">
              <option value="">All batches</option>
              {batches.data?.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
        {list.loading && !list.data ? (
          <LoadingState />
        ) : list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : !list.data?.items.length ? (
          <EmptyState
            icon={<SearchX />}
            title="No students found"
            description={query || feeStatus || batchId ? "Try a different search or filter." : "Approved registrations and students you add appear here."}
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-400">
                  <tr>
                    <th className="px-6 py-3">Student</th>
                    <th className="px-6 py-3">Batch</th>
                    <th className="px-6 py-3">Parent contact</th>
                    <th className="px-6 py-3">Fee status</th>
                    <th className="px-6 py-3">Outstanding</th>
                    <th />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {list.data.items.map((s) => (
                    <tr key={s.id} className="cursor-pointer hover:bg-slate-50/70" onClick={() => setOpenId(s.id)}>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="grid size-9 place-items-center rounded-full bg-blue-50 text-xs font-bold text-blue-700">
                            {s.initials}
                          </div>
                          <div>
                            <p className="font-semibold">
                              {s.name} {s.status === "INACTIVE" && <Badge tone="slate">Deactivated</Badge>}
                            </p>
                            <p className="text-xs text-slate-400">
                              {s.code} • {s.schoolClass}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-slate-600">{s.batch?.name ?? <span className="text-amber-600">Not assigned</span>}</td>
                      <td className="px-6 py-4">
                        <p>{s.parent.name ?? "—"}</p>
                        <p className="text-xs text-slate-400">{s.parent.phone ?? s.phone}</p>
                      </td>
                      <td className="px-6 py-4">
                        <Badge tone={feeTone[s.feeStatus]}>{feeLabel[s.feeStatus]}</Badge>
                      </td>
                      <td className="px-6 py-4 font-semibold">{s.outstanding ? inr(s.outstanding) : "—"}</td>
                      <td className="px-6 py-4 text-right text-xs font-semibold text-blue-600">View</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={list.data.meta.page} totalPages={list.data.meta.totalPages} total={list.data.meta.total} onPage={setPage} />
          </>
        )}
      </Card>
      {openId && (
        <StudentDetailModal
          studentId={openId}
          batches={batches.data ?? []}
          onClose={() => setOpenId(null)}
          onChanged={() => void list.reload()}
          onDeleted={(name) => {
            setOpenId(null)
            setNotice(`${name} was permanently deleted.`)
            void list.reload()
          }}
        />
      )}
      {adding && (
        <StudentFormModal
          batches={(batches.data ?? []).filter((b) => b.status === "ACTIVE")}
          onClose={() => setAdding(false)}
          onSaved={(s) => {
            setAdding(false)
            setNotice(`${s.name} was added. A link to set their password was emailed to ${s.email}.`)
            void list.reload()
          }}
        />
      )}
    </div>
  )
}

// ───────────── Add / edit student ─────────────

const optionalEmail = z.union([z.email("Enter a valid email"), z.literal("")])
const optionalPhone = z.union([z.string().regex(/^\+?[0-9 ()-]{10,20}$/, "Enter a valid phone number"), z.literal("")])

const studentSchema = z.object({
  name: z.string().trim().min(2, "Enter the full name").max(120),
  email: z.email("Enter a valid email"),
  phone: z.string().trim().regex(/^\+?[0-9 ()-]{10,20}$/, "Enter a valid phone number"),
  schoolClass: z.string().trim().min(1, "Enter the class").max(40),
  subjects: z.string().trim().max(300),
  batchId: z.string(),
  address: z.string().trim().max(300),
  parentName: z.string().trim().max(120),
  parentRelation: z.string().trim().max(40),
  parentEmail: optionalEmail,
  parentPhone: optionalPhone,
})
type StudentFormValues = z.infer<typeof studentSchema>

function StudentFormModal({
  student,
  batches,
  onClose,
  onSaved,
}: {
  student?: Student
  batches: Batch[]
  onClose: () => void
  onSaved: (s: Student) => void
}) {
  const [error, setError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<StudentFormValues>({
    resolver: zodResolver(studentSchema),
    defaultValues: {
      name: student?.name ?? "",
      email: student?.email ?? "",
      phone: student?.phone ?? "",
      schoolClass: student?.schoolClass ?? "",
      subjects: student?.subjects.join(", ") ?? "",
      batchId: "",
      address: student?.address ?? "",
      parentName: student?.parent.name ?? "",
      parentRelation: student?.parent.relation ?? "",
      parentEmail: student?.parent.email ?? "",
      parentPhone: student?.parent.phone ?? "",
    },
  })

  const submit = async ({ batchId, subjects, ...v }: StudentFormValues) => {
    setError(null)
    const input = { ...v, subjects: subjects.split(",").map((s) => s.trim()).filter(Boolean) }
    try {
      const saved = student
        ? await studentsApi.update(student.id, input)
        : await studentsApi.create({ ...input, batchId: batchId || null })
      onSaved(saved)
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <Modal
      title={student ? `Edit ${student.name}` : "Add a student"}
      eyebrow={student?.code ?? "New student"}
      description={student ? undefined : "The student receives an email link to set their own password."}
      onClose={onClose}
      size="lg"
    >
      <form onSubmit={handleSubmit(submit)} noValidate className="grid gap-5 sm:grid-cols-2">
        {error && (
          <div className="sm:col-span-2">
            <Alert>{error}</Alert>
          </div>
        )}
        <Field label="Full name" error={errors.name?.message}>
          <Input {...register("name")} />
        </Field>
        <Field label="Email" error={errors.email?.message}>
          <Input type="email" {...register("email")} />
        </Field>
        <Field label="Phone" error={errors.phone?.message}>
          <Input {...register("phone")} />
        </Field>
        <Field label="Class" error={errors.schoolClass?.message}>
          <Input placeholder="e.g. Class 10" list="class-suggestions" autoComplete="off" {...register("schoolClass")} />
          <datalist id="class-suggestions">
            {CLASS_SUGGESTIONS.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label="Subjects (comma separated)" error={errors.subjects?.message}>
          <Input {...register("subjects")} />
        </Field>
        {!student ? (
          <Field label="Batch (optional)">
            <Select {...register("batchId")}>
              <option value="">Assign later</option>
              {batches.map((b) => (
                <option key={b.id} value={b.id} disabled={b.seatsAvailable <= 0}>
                  {b.name} ({b.seatsAvailable} seats left)
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <div />
        )}
        <div className="sm:col-span-2">
          <Field label="Address" error={errors.address?.message}>
            <Input {...register("address")} />
          </Field>
        </div>
        <Field label="Parent name" error={errors.parentName?.message}>
          <Input {...register("parentName")} />
        </Field>
        <Field label="Relationship" error={errors.parentRelation?.message}>
          <Input placeholder="e.g. Mother" {...register("parentRelation")} />
        </Field>
        <Field label="Parent email" error={errors.parentEmail?.message}>
          <Input type="email" {...register("parentEmail")} />
        </Field>
        <Field label="Parent phone" error={errors.parentPhone?.message}>
          <Input {...register("parentPhone")} />
        </Field>
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-5 sm:col-span-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={isSubmitting}>
            {isSubmitting ? <Spinner /> : <Check className="size-4" />} {student ? "Save changes" : "Add student"}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

// ───────────── Student detail ─────────────

function StudentDetailModal({
  studentId,
  batches,
  onClose,
  onChanged,
  onDeleted,
}: {
  studentId: string
  batches: Batch[]
  onClose: () => void
  onChanged: () => void
  onDeleted: (name: string) => void
}) {
  const { data: s, error, loading, reload } = useAsync(() => studentsApi.get(studentId), [studentId])
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: "green" | "red"; text: string } | null>(null)
  const [moving, setMoving] = useState(false)
  const [editing, setEditing] = useState(false)
  const [adjusting, setAdjusting] = useState<Charge | null>(null)

  const act = async (key: string, fn: () => Promise<unknown>, success: string) => {
    setBusy(key)
    setMessage(null)
    try {
      await fn()
      setMessage({ tone: "green", text: success })
      await reload()
      onChanged()
    } catch (e) {
      setMessage({ tone: "red", text: errorMessage(e) })
    } finally {
      setBusy(null)
    }
  }

  const toggleStatus = (st: StudentDetail) => {
    if (st.status === "ACTIVE") {
      const reason = window.prompt(`Deactivate ${st.name}? They will be signed out and blocked from logging in.\n\nReason (optional):`)
      if (reason === null) return
      void act("status", () => studentsApi.setStatus(st.id, "INACTIVE", reason || undefined), `${st.name} was deactivated.`)
    } else {
      void act("status", () => studentsApi.setStatus(st.id, "ACTIVE"), `${st.name} was reactivated.`)
    }
  }

  const remove = async (st: StudentDetail) => {
    if (!window.confirm(`Permanently delete ${st.name}? This cannot be undone.`)) return
    setBusy("delete")
    setMessage(null)
    try {
      await studentsApi.remove(st.id)
      onDeleted(st.name)
    } catch (e) {
      setMessage({ tone: "red", text: errorMessage(e) })
      setBusy(null)
    }
  }

  return (
    <Modal title={s?.name ?? "Student"} eyebrow={s ? `${s.code} • ${s.schoolClass}` : undefined} onClose={onClose} size="lg">
      {loading && !s ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : s ? (
        <div className="space-y-6">
          {message && (
            <Alert tone={message.tone} onDismiss={() => setMessage(null)}>
              {message.text}
            </Alert>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setEditing(true)}>
              <Pencil className="size-4" /> Edit profile
            </Button>
            <Button variant="secondary" onClick={() => setMoving(true)} disabled={s.status !== "ACTIVE"}>
              <ArrowRightLeft className="size-4" /> {s.batch ? "Change batch" : "Assign batch"}
            </Button>
            <Button variant="secondary" onClick={() => toggleStatus(s)} disabled={busy !== null}>
              {busy === "status" ? <Spinner /> : <Power className="size-4" />} {s.status === "ACTIVE" ? "Deactivate" : "Reactivate"}
            </Button>
            <Button
              variant="secondary"
              disabled={busy !== null || s.status !== "ACTIVE"}
              onClick={() => void act("link", () => studentsApi.sendPasswordLink(s.id), `A password link was emailed to ${s.email}.`)}
            >
              {busy === "link" ? <Spinner /> : <KeyRound className="size-4" />} Send password link
            </Button>
            <Button variant="danger" onClick={() => void remove(s)} disabled={busy !== null}>
              {busy === "delete" ? <Spinner /> : <Trash2 className="size-4" />} Delete
            </Button>
          </div>

          <dl className="grid gap-4 rounded-2xl bg-slate-50 p-4 text-sm sm:grid-cols-3">
            <Info label="Email" value={s.email} />
            <Info label="Phone" value={s.phone} />
            <Info label="Status" value={s.status === "ACTIVE" ? "Active" : "Deactivated"} />
            <Info label="Batch" value={s.batch ? `${s.batch.name} (${inr(s.batch.monthlyFee)}/month)` : "Not assigned"} />
            <Info label="Subjects" value={s.subjects.join(", ")} />
            <Info label="Joined" value={formatDate(s.joinedAt)} />
            <Info label="Parent" value={[s.parent.name, s.parent.relation && `(${s.parent.relation})`].filter(Boolean).join(" ")} />
            <Info label="Parent contact" value={[s.parent.phone, s.parent.email].filter(Boolean).join(" • ")} />
            <Info label="Outstanding" value={s.outstanding ? inr(s.outstanding) : "Nothing due"} />
          </dl>

          <section>
            <h3 className="mb-2 text-sm font-bold">Fee charges</h3>
            {s.charges.length === 0 ? (
              <p className="text-sm text-slate-500">No charges yet. Generate monthly fees from the Overview page.</p>
            ) : (
              <div className="divide-y divide-slate-100 rounded-xl border border-slate-100">
                {s.charges.map((c) => (
                  <div key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{c.description}</p>
                      <p className="text-xs text-slate-400">
                        {c.code} • due {formatDate(c.dueDate)} • billed {inr(c.amount)}
                        {c.adjustmentTotal ? ` • adjusted ${c.adjustmentTotal > 0 ? "+" : ""}${inr(c.adjustmentTotal)}` : ""}
                      </p>
                    </div>
                    <Badge tone={c.status === "PAID" ? "green" : c.status === "VOID" ? "slate" : c.isOverdue ? "red" : "amber"}>
                      {c.status === "PAID" ? "Paid" : c.status === "VOID" ? "Void" : `${inr(c.outstanding)} due`}
                    </Badge>
                    {c.status !== "VOID" && (
                      <Button variant="ghost" onClick={() => setAdjusting(c)}>
                        Adjust
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <h3 className="mb-2 text-sm font-bold">Payments</h3>
            {s.payments.length === 0 ? (
              <p className="text-sm text-slate-500">No payments recorded.</p>
            ) : (
              <div className="divide-y divide-slate-100 rounded-xl border border-slate-100">
                {s.payments.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                    <div className="flex-1">
                      <p className="font-semibold">
                        {inr(p.amount)} • {methodLabel(p.method)} {p.status === "VOIDED" && <Badge tone="red">Voided</Badge>}
                      </p>
                      <p className="text-xs text-slate-400">
                        {formatDate(p.paymentDate)} • {p.receiptNumber}
                      </p>
                    </div>
                    <Button variant="ghost" onClick={() => void paymentsApi.receiptPdf(p.id)}>
                      Receipt
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <h3 className="mb-2 text-sm font-bold">Batch history</h3>
            {s.enrollments.length === 0 ? (
              <p className="text-sm text-slate-500">Never assigned to a batch.</p>
            ) : (
              <ol className="space-y-2 text-sm">
                {s.enrollments.map((e) => (
                  <li key={e.id} className="flex items-start gap-3">
                    <span className={`mt-1.5 size-2 shrink-0 rounded-full ${e.active ? "bg-emerald-500" : "bg-slate-300"}`} />
                    <div>
                      <p className="font-semibold">
                        {e.batch.name} {e.active && <Badge tone="green">Current</Badge>}
                        {e.batch.deleted && <Badge tone="slate">Batch deleted</Badge>}
                      </p>
                      <p className="text-xs text-slate-400">
                        {formatDate(e.startedAt)} – {e.endedAt ? formatDate(e.endedAt) : "present"}
                        {e.reason ? ` • ${e.reason}` : ""}
                        {e.endReason ? ` • left: ${e.endReason}` : ""}
                        {e.changedBy ? ` • by ${e.changedBy}` : ""}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      ) : null}
      {moving && s && (
        <ChangeBatchModal
          student={s}
          batches={batches.filter((b) => b.status === "ACTIVE" && b.id !== s.batch?.id)}
          onClose={() => setMoving(false)}
          onSaved={(batchName) => {
            setMoving(false)
            setMessage({ tone: "green", text: `${s.name} moved to ${batchName}. The previous assignment is kept in the history.` })
            void reload()
            onChanged()
          }}
        />
      )}
      {editing && s && (
        <StudentFormModal
          student={s}
          batches={[]}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false)
            setMessage({ tone: "green", text: "Profile updated." })
            void reload()
            onChanged()
          }}
        />
      )}
      {adjusting && (
        <AdjustChargeModal
          charge={adjusting}
          onClose={() => setAdjusting(null)}
          onSaved={() => {
            setAdjusting(null)
            setMessage({ tone: "green", text: "Adjustment recorded." })
            void reload()
            onChanged()
          }}
        />
      )}
    </Modal>
  )
}

function Info({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className="mt-1 truncate font-semibold">{value || "—"}</dd>
    </div>
  )
}

function ChangeBatchModal({
  student,
  batches,
  onClose,
  onSaved,
}: {
  student: StudentDetail
  batches: Batch[]
  onClose: () => void
  onSaved: (batchName: string) => void
}) {
  const [batchId, setBatchId] = useState("")
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    if (!batchId) return setError("Choose a batch.")
    setBusy(true)
    setError(null)
    try {
      await studentsApi.changeBatch(student.id, batchId, reason.trim() || undefined)
      onSaved(batches.find((b) => b.id === batchId)?.name ?? "the new batch")
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  return (
    <Modal title={student.batch ? "Change batch" : "Assign batch"} eyebrow={student.name} onClose={onClose}>
      <div className="space-y-4">
        {student.batch && <p className="text-sm text-slate-500">Currently in {student.batch.name}.</p>}
        {error && <Alert>{error}</Alert>}
        <Field label="New batch">
          <Select value={batchId} onChange={(e) => setBatchId(e.target.value)}>
            <option value="">Select a batch</option>
            {batches.map((b) => (
              <option key={b.id} value={b.id} disabled={b.seatsAvailable <= 0}>
                {b.name} • {inr(b.monthlyFee)}/month ({b.seatsAvailable} seats left)
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Reason (optional)">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Timing clash with school" />
        </Field>
        <p className="text-xs text-slate-400">Fees already billed are unchanged; the new batch fee applies from the next billing.</p>
        <div className="flex justify-end gap-2">
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

function AdjustChargeModal({ charge, onClose, onSaved }: { charge: Charge; onClose: () => void; onSaved: () => void }) {
  const [kind, setKind] = useState<"discount" | "surcharge">("discount")
  const [amount, setAmount] = useState("")
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    const value = Number(amount)
    if (!value || value <= 0) return setError("Enter an amount greater than zero.")
    if (reason.trim().length < 5) return setError("Document the reason (at least 5 characters).")
    setBusy(true)
    setError(null)
    try {
      await feesApi.adjust(charge.id, kind === "discount" ? -value : value, reason.trim())
      onSaved()
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  return (
    <Modal title="Adjust fee" eyebrow={charge.code} description={charge.description} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-slate-500">
          Original amount {inr(charge.amount)} stays on record. Current net {inr(charge.netAmount)}, paid {inr(charge.paidAmount)}.
        </p>
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type">
            <Select value={kind} onChange={(e) => setKind(e.target.value as "discount" | "surcharge")}>
              <option value="discount">Discount / waiver (reduce)</option>
              <option value="surcharge">Surcharge (increase)</option>
            </Select>
          </Field>
          <Field label="Amount (₹)">
            <Input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
        </div>
        <Field label="Reason (required)">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Sibling discount approved" />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? <Spinner /> : <Check className="size-4" />} Record adjustment
          </Button>
        </div>
      </div>
    </Modal>
  )
}
