import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { BookOpen, CalendarDays, Check, Clock, MoreHorizontal, Plus, Trash2 } from "lucide-react"
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
  Select,
  Spinner,
} from "../../components/ui"
import { batchesApi } from "../../services/api"
import type { Batch } from "../../services/types"
import { errorMessage, inr, useAsync } from "../../lib/format"
import { CLASS_SUGGESTIONS, SUBJECT_SUGGESTIONS } from "../../lib/academics"

const batchSchema = z.object({
  name: z.string().trim().min(3, "Enter a descriptive batch name").max(120),
  classLevel: z.string().trim().min(1, "Enter the class level").max(40),
  subjects: z.string().trim().max(300),
  schedule: z.string().trim().min(3, "Enter the teaching days").max(120),
  startTime: z.string().trim().min(3, "Enter the start time").max(20),
  endTime: z.string().trim().max(20),
  capacity: z.number({ error: "Enter a number" }).int().min(1, "Capacity must be at least 1").max(1000),
  monthlyFee: z.number({ error: "Enter a number" }).min(0, "Fee cannot be negative"),
  status: z.enum(["ACTIVE", "PAUSED", "ARCHIVED"]),
})
type BatchFormValues = z.infer<typeof batchSchema>

const statusTone = { ACTIVE: "green", PAUSED: "amber", ARCHIVED: "slate" } as const
const statusLabel = { ACTIVE: "Active", PAUSED: "Paused", ARCHIVED: "Archived" } as const
const stripe = ["bg-blue-500", "bg-violet-500", "bg-emerald-500", "bg-amber-500"]

function BatchEditor({
  batch,
  onClose,
  onSaved,
  onDeleted,
}: {
  batch?: Batch
  onClose: () => void
  onSaved: (b: Batch, created: boolean) => void
  onDeleted: (b: Batch, studentsMoved: number) => void
}) {
  const [submitError, setSubmitError] = useState("")
  const [deleting, setDeleting] = useState(false)
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<BatchFormValues>({
    resolver: zodResolver(batchSchema),
    defaultValues: batch
      ? {
          name: batch.name,
          classLevel: batch.classLevel,
          subjects: batch.subjects.join(", "),
          schedule: batch.schedule,
          startTime: batch.startTime,
          endTime: batch.endTime ?? "",
          capacity: batch.capacity,
          monthlyFee: batch.monthlyFee,
          status: batch.status,
        }
      : { name: "", classLevel: "", subjects: "", schedule: "", startTime: "", endTime: "", capacity: 20, monthlyFee: 0, status: "ACTIVE" },
  })
  const fee = watch("monthlyFee")
  const feeChanged = batch && Number(fee) !== batch.monthlyFee

  const submit = async (values: BatchFormValues) => {
    setSubmitError("")
    if (batch && values.capacity < batch.students) {
      setSubmitError(`Capacity cannot be lower than current enrollment (${batch.students}).`)
      return
    }
    const input = {
      ...values,
      subjects: values.subjects.split(",").map((s) => s.trim()).filter(Boolean),
      endTime: values.endTime || null,
    }
    try {
      const saved = batch ? await batchesApi.update(batch.id, input) : await batchesApi.create(input)
      onSaved(saved, !batch)
    } catch (error) {
      setSubmitError(errorMessage(error, "Could not save this batch."))
    }
  }

  const remove = async () => {
    if (!batch) return
    const consequence = batch.students
      ? `

${batch.students} student(s) in this batch will NOT be deleted: they will be moved to Registrations so you can allocate them a new batch. Their fees and receipts are kept.`
      : ""
    if (!window.confirm(`Permanently delete ${batch.name}? This cannot be undone.${consequence}`)) return
    setDeleting(true)
    setSubmitError("")
    try {
      const result = await batchesApi.remove(batch.id)
      onDeleted(batch, result.studentsMoved)
    } catch (error) {
      setSubmitError(errorMessage(error, "Could not delete this batch."))
      setDeleting(false)
    }
  }

  return (
    <Modal
      eyebrow={batch ? batch.code : "New batch"}
      title={batch ? "Edit batch details" : "Create a new batch"}
      description="Schedule, capacity, fee and status can all be changed here."
      onClose={onClose}
    >
      <form onSubmit={handleSubmit(submit)} noValidate>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Batch name" error={errors.name?.message}>
              <Input placeholder="e.g. Grade 10 • Mathematics" {...register("name")} />
            </Field>
          </div>
          <Field label="Class level" error={errors.classLevel?.message}>
            <Input placeholder="e.g. Class 10" list="class-suggestions" autoComplete="off" {...register("classLevel")} />
            <datalist id="class-suggestions">
              {CLASS_SUGGESTIONS.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
          <Field label="Subjects (comma separated)" error={errors.subjects?.message}>
            <Input placeholder={`e.g. ${SUBJECT_SUGGESTIONS.slice(0, 2).join(", ")}`} {...register("subjects")} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Teaching days" error={errors.schedule?.message}>
              <Input placeholder="e.g. Mon, Wed, Fri" {...register("schedule")} />
            </Field>
          </div>
          <Field label="Start time" error={errors.startTime?.message}>
            <Input placeholder="e.g. 5:00 PM" {...register("startTime")} />
          </Field>
          <Field label="End time (optional)" error={errors.endTime?.message}>
            <Input placeholder="e.g. 6:30 PM" {...register("endTime")} />
          </Field>
          <Field label={`Maximum capacity${batch ? ` (${batch.students} enrolled)` : ""}`} error={errors.capacity?.message}>
            <Input type="number" min="1" {...register("capacity", { valueAsNumber: true })} />
          </Field>
          <Field label="Monthly fee (₹)" error={errors.monthlyFee?.message}>
            <Input type="number" min="0" step="1" {...register("monthlyFee", { valueAsNumber: true })} />
          </Field>
          <Field label="Batch status" error={errors.status?.message}>
            <Select {...register("status")}>
              <option value="ACTIVE">Active</option>
              <option value="PAUSED">Paused</option>
              <option value="ARCHIVED">Archived</option>
            </Select>
          </Field>
        </div>
        {feeChanged && (
          <div className="mt-5">
            <Alert tone="blue">
              The new fee applies to <strong>future</strong> charges only. Fees already billed keep their original amount;
              adjust them individually from a student's record if needed.
            </Alert>
          </div>
        )}
        {submitError && (
          <div className="mt-5">
            <Alert>{submitError}</Alert>
          </div>
        )}
        <div className="mt-7 flex flex-col-reverse gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:items-center">
          {batch && (
            <Button type="button" variant="danger" disabled={deleting || isSubmitting} onClick={remove}>
              {deleting ? <Spinner /> : <Trash2 className="size-4" />}
              {deleting ? "Deleting…" : "Delete batch"}
            </Button>
          )}
          <div className="flex flex-1 justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || deleting}>
              {isSubmitting ? <Spinner /> : <Check className="size-4" />}
              {isSubmitting ? "Saving…" : batch ? "Save changes" : "Create batch"}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  )
}

export function BatchesPage() {
  const [showArchived, setShowArchived] = useState(false)
  const { data, error, loading, reload } = useAsync(
    () => batchesApi.list(showArchived ? { status: "ARCHIVED" } : {}),
    [showArchived],
  )
  const [editing, setEditing] = useState<Batch | undefined>()
  const [editorOpen, setEditorOpen] = useState(false)
  const [notice, setNotice] = useState("")

  const open = (batch?: Batch) => {
    setEditing(batch)
    setEditorOpen(true)
  }

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Classroom"
        title="Batches"
        description="Manage schedules, capacity, and batch-specific monthly fees."
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setShowArchived((v) => !v)}>
              {showArchived ? "Show current batches" : "Show archived"}
            </Button>
            <Button onClick={() => open()}>
              <Plus className="size-4" /> New batch
            </Button>
          </div>
        }
      />
      {notice && (
        <Alert tone="green" onDismiss={() => setNotice("")}>
          {notice}
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
      ) : !data?.length ? (
        <Card>
          <EmptyState
            icon={<BookOpen />}
            title={showArchived ? "No archived batches" : "No batches yet"}
            description={showArchived ? "Archived batches will appear here." : "Create your first batch to start allocating students."}
          />
        </Card>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {data.map((b, i) => (
            <Card key={b.id} className="overflow-hidden">
              <div className={`h-1.5 ${stripe[i % stripe.length]}`} />
              <div className="p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <Badge tone={statusTone[b.status]}>{statusLabel[b.status]}</Badge>
                    <h2 className="mt-3 font-bold">{b.name}</h2>
                    <p className="mt-1 text-xs text-slate-400">
                      {b.code} • {b.classLevel}
                      {b.subjects.length ? ` • ${b.subjects.join(", ")}` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label={`Manage ${b.name}`}
                    onClick={() => open(b)}
                    className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"
                  >
                    <MoreHorizontal className="size-5" />
                  </button>
                </div>
                <div className="mt-6 grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-xl bg-slate-50 p-3">
                    <CalendarDays className="mb-2 size-4 text-blue-600" />
                    <p className="text-xs text-slate-400">Schedule</p>
                    <p className="mt-1 font-semibold">{b.schedule}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3">
                    <Clock className="mb-2 size-4 text-violet-600" />
                    <p className="text-xs text-slate-400">Time</p>
                    <p className="mt-1 font-semibold">{b.time}</p>
                  </div>
                </div>
                <div className="mt-5">
                  <div className="mb-2 flex justify-between text-xs">
                    <span className="text-slate-500">Capacity</span>
                    <span className="font-semibold">
                      {b.students} / {b.capacity}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-blue-500"
                      style={{ width: `${Math.min(100, (b.students / b.capacity) * 100)}%` }}
                    />
                  </div>
                </div>
                <div className="mt-5 flex items-end justify-between border-t border-slate-100 pt-5">
                  <div>
                    <p className="text-xs text-slate-400">Monthly fee</p>
                    <p className="mt-1 text-xl font-bold">{inr(b.monthlyFee)}</p>
                  </div>
                  <Button variant="secondary" onClick={() => open(b)}>
                    Manage
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      {editorOpen && (
        <BatchEditor
          key={editing?.id ?? "new"}
          batch={editing}
          onClose={() => setEditorOpen(false)}
          onSaved={(b, created) => {
            setNotice(`${b.name} was ${created ? "created" : "updated"}.`)
            setEditorOpen(false)
            void reload()
          }}
          onDeleted={(b, moved) => {
            setNotice(
              moved
                ? `${b.name} was deleted. ${moved} student(s) were moved to Registrations to be allocated a new batch.`
                : `${b.name} was deleted.`,
            )
            setEditorOpen(false)
            void reload()
          }}
        />
      )}
    </div>
  )
}
