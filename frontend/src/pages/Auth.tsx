import { useEffect, useRef, useState, type ReactNode } from "react"
import { Link, useLocation, useNavigate, useSearchParams } from "react-router"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { ArrowRight, BookOpen, CheckCircle2, GraduationCap, KeyRound, ShieldCheck } from "lucide-react"
import { Alert, Button, Field, Input, Select, Spinner, Textarea } from "../components/ui"
import { useAuth } from "../auth/AuthContext"
import { ApiError, authApi, batchesApi } from "../services/api"
import type { PublicBatch } from "../services/types"
import { errorMessage, inr } from "../lib/format"
import { classOptionsFrom, sameText, subjectOptionsFrom } from "../lib/academics"

const passwordRule = z
  .string()
  .min(8, "Password must contain at least 8 characters")
  .max(72, "Password must be at most 72 characters")
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), "Use at least one letter and one number")

/** Copy server-side field errors onto the form, falling back to a banner message. */
function applyServerErrors(
  error: unknown,
  setError: (field: never, e: { message: string }) => void,
  known: string[],
): string | null {
  if (error instanceof ApiError && error.fields?.length) {
    let unmatched: string | null = null
    for (const f of error.fields) {
      if (known.includes(f.field)) setError(f.field as never, { message: f.message })
      else unmatched ??= f.message
    }
    return unmatched
  }
  return errorMessage(error)
}

// ───────────────────────────── Login ─────────────────────────────

const loginSchema = z.object({
  email: z.email("Enter a valid email"),
  password: z.string().min(1, "Enter your password"),
  remember: z.boolean(),
})
type LoginValues = z.infer<typeof loginSchema>

export function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { login, notice, setNotice } = useAuth()
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "", remember: true },
  })

  const submit = async (values: LoginValues) => {
    setFormError(null)
    setNotice(null)
    try {
      const user = await login(values.email.trim(), values.password, values.remember)
      const from = (location.state as { from?: string } | null)?.from
      navigate(from && from.startsWith(user.redirectTo) ? from : user.redirectTo, { replace: true })
    } catch (error) {
      setFormError(errorMessage(error))
    }
  }

  return (
    <AuthLayout>
      <p className="text-sm font-bold text-blue-600">WELCOME BACK</p>
      <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Sign in to your workspace</h2>
      <p className="mt-2 text-sm text-slate-500">Use your account details to continue.</p>
      <form className="mt-8 space-y-5" onSubmit={handleSubmit(submit)} noValidate>
        {notice && <Alert tone="amber">{notice}</Alert>}
        {formError && <Alert>{formError}</Alert>}
        <Field label="Email address" error={errors.email?.message}>
          <Input type="email" autoComplete="email" placeholder="you@example.com" {...register("email")} />
        </Field>
        <Field label="Password" error={errors.password?.message}>
          <Input type="password" autoComplete="current-password" {...register("password")} />
        </Field>
        <div className="flex items-center justify-between text-sm">
          <label className="flex items-center gap-2 text-slate-600">
            <input type="checkbox" {...register("remember")} /> Remember me
          </label>
          <Link to="/forgot-password" className="font-semibold text-blue-600">
            Forgot password?
          </Link>
        </div>
        <Button className="w-full" disabled={isSubmitting}>
          {isSubmitting ? <Spinner /> : null}
          {isSubmitting ? "Signing in…" : "Sign in"} {!isSubmitting && <ArrowRight className="size-4" />}
        </Button>
      </form>
      <p className="mt-4 rounded-xl bg-blue-50 p-3 text-center text-xs leading-5 text-blue-700">
        Your account opens the correct admin or student dashboard automatically.
      </p>
      <div className="mt-8 border-t border-slate-100 pt-6 text-center text-sm text-slate-500">
        New student?{" "}
        <Link to="/register" className="font-semibold text-blue-600">
          Submit a registration
        </Link>
      </div>
    </AuthLayout>
  )
}

function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen bg-slate-950 lg:grid-cols-2">
      <div className="relative hidden overflow-hidden p-12 lg:flex lg:flex-col">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,.45),transparent_42%),radial-gradient(circle_at_bottom_right,rgba(14,165,233,.18),transparent_40%)]" />
        <Link to="/" className="relative flex items-center gap-3 text-white">
          <div className="grid size-11 place-items-center rounded-xl bg-white/10 ring-1 ring-white/15">
            <GraduationCap />
          </div>
          <span className="text-xl font-bold">SriKrishna Physics Academy</span>
        </Link>
        <div className="relative my-auto max-w-lg">
          <p className="mb-5 text-sm font-semibold uppercase tracking-[0.2em] text-blue-300">One calm workspace</p>
          <h1 className="text-5xl font-bold leading-tight tracking-tight text-white">
            Teach more.
            <br />
            Chase fewer fees.
          </h1>
          <p className="mt-6 text-lg leading-8 text-slate-300">
            Registrations, batches, payments, reminders, and parent updates—organized around your teaching day.
          </p>
          <div className="mt-10 flex gap-8 text-sm text-slate-300">
            <span className="flex items-center gap-2">
              <ShieldCheck className="size-5 text-emerald-400" /> Audit-ready
            </span>
            <span className="flex items-center gap-2">
              <BookOpen className="size-5 text-blue-400" /> Batch-first
            </span>
          </div>
        </div>
        <p className="relative text-xs text-slate-500">One secure login for teachers and students</p>
      </div>
      <div className="flex items-center justify-center bg-white p-6 sm:p-12">
        <div className="w-full max-w-md">
          <Link to="/" className="mb-10 flex items-center gap-3 lg:hidden">
            <div className="grid size-10 place-items-center rounded-xl bg-blue-600 text-white">
              <GraduationCap />
            </div>
            <span className="font-bold">SriKrishna Physics Academy</span>
          </Link>
          {children}
        </div>
      </div>
    </div>
  )
}

// ───────────────────────────── Register ─────────────────────────────

const registrationSchema = z
  .object({
    name: z.string().trim().min(2, "Enter your full name").max(120),
    email: z.email("Enter a valid email"),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[0-9 ()-]{10,20}$/, "Enter a valid phone number"),
    schoolClass: z.string().min(1, "Choose a class"),
    requestedSubjects: z.array(z.string()).min(1, "Choose at least one subject"),
    preferredBatchId: z.string(),
    password: passwordRule,
    confirmPassword: z.string().min(1, "Confirm your password"),
    notes: z.string().trim().max(500, "Keep your note under 500 characters"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  })
type RegistrationValues = z.infer<typeof registrationSchema>

export function RegisterPage() {
  const navigate = useNavigate()
  const { login } = useAuth()
  const [params] = useSearchParams()
  const [formError, setFormError] = useState<string | null>(null)
  const [batches, setBatches] = useState<PublicBatch[] | null>(null)
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    getValues,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegistrationValues>({
    resolver: zodResolver(registrationSchema),
    defaultValues: {
      name: "",
      email: "",
      phone: "",
      schoolClass: "",
      requestedSubjects: [],
      preferredBatchId: "",
      password: "",
      confirmPassword: "",
      notes: "",
    },
  })

  // The teacher's active batches drive the class, subject and preferred-batch options.
  useEffect(() => {
    batchesApi
      .publicList()
      .then(setBatches)
      .catch(() => setBatches([]))
  }, [])

  // Arriving from a batch card on the landing page (/register?batch=<id>): preselect it.
  // Runs after the options have rendered, so the selects can actually take the values.
  const preselected = useRef(false)
  useEffect(() => {
    if (!batches || preselected.current) return
    preselected.current = true
    const chosen = batches.find((b) => b.id === params.get("batch") && b.hasSeats)
    if (!chosen) return
    setValue("schoolClass", chosen.classLevel)
    // Subjects and batch options depend on the class, so set them once that has re-rendered.
    requestAnimationFrame(() => {
      setValue("requestedSubjects", chosen.subjects)
      setValue("preferredBatchId", chosen.id)
    })
  }, [batches, params, setValue])

  const all = batches ?? []
  const schoolClass = watch("schoolClass")
  const preferredBatchId = watch("preferredBatchId")
  const classOptions = classOptionsFrom(all)
  const subjectOptions = subjectOptionsFrom(all, schoolClass || undefined)
  // The chosen class's batches are listed first; every other batch stays selectable, so a
  // student's choice is never hidden or silently dropped when they change class.
  const classBatches = schoolClass ? all.filter((b) => sameText(b.classLevel, schoolClass)) : all
  const otherBatches = schoolClass ? all.filter((b) => !sameText(b.classLevel, schoolClass)) : []
  const chosenBatch = all.find((b) => b.id === preferredBatchId) ?? null
  const classMismatch = Boolean(chosenBatch && schoolClass && !sameText(chosenBatch.classLevel, schoolClass))

  // Subject checkboxes depend on the class; drop ticks that are no longer on screen.
  // (The preferred batch is deliberately left alone — only the student changes it.)
  useEffect(() => {
    const keep = getValues("requestedSubjects").filter((s) => subjectOptions.some((o) => sameText(o, s)))
    if (keep.length !== getValues("requestedSubjects").length) setValue("requestedSubjects", keep)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolClass])

  // Picking a batch before a class fills in that batch's class.
  useEffect(() => {
    if (chosenBatch && !getValues("schoolClass")) setValue("schoolClass", chosenBatch.classLevel, { shouldValidate: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferredBatchId])

  const batchOption = (b: PublicBatch) => (
    <option key={b.id} value={b.id} disabled={!b.hasSeats && b.id !== preferredBatchId}>
      {b.name} • {b.schedule} • {b.time} • {inr(b.monthlyFee)}/month{b.hasSeats ? "" : " (full)"}
    </option>
  )

  const submit = async ({ confirmPassword: _c, preferredBatchId, notes, ...values }: RegistrationValues) => {
    setFormError(null)
    try {
      await authApi.register({
        ...values,
        email: values.email.trim(),
        preferredBatchId: preferredBatchId || null,
        notes: notes || undefined,
      })
    } catch (error) {
      setFormError(
        applyServerErrors(error, setError as never, ["name", "email", "phone", "schoolClass", "requestedSubjects", "preferredBatchId", "password", "notes"]),
      )
      return
    }
    // Sign straight in: the account can see its approval status right away.
    try {
      await login(values.email.trim(), values.password, true)
      navigate("/pending", { replace: true })
    } catch {
      navigate("/login", { replace: true })
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-20 max-w-5xl items-center px-5">
          <Link to="/" className="flex items-center">
            <div className="grid size-10 place-items-center rounded-xl bg-blue-600 text-white">
              <GraduationCap className="size-5" />
            </div>
            <p className="ml-3 font-bold">SriKrishna Physics Academy</p>
          </Link>
          <Link to="/login" className="ml-auto text-sm font-semibold text-blue-600">
            Already registered? Sign in
          </Link>
        </div>
      </header>
      <main className="mx-auto grid max-w-5xl gap-10 p-5 py-10 lg:grid-cols-[.8fr_1.2fr] lg:py-16">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600">Student registration</p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight text-slate-950">Find the right batch for you.</h1>
          <p className="mt-4 leading-7 text-slate-500">
            Select your class and subjects and tell us which batch and time work best for you. Your teacher will review
            availability before confirming your place.
          </p>
          <div className="mt-8 space-y-4 text-sm text-slate-600">
            <p className="flex gap-3">
              <CheckCircle2 className="size-5 shrink-0 text-emerald-500" /> No payment is collected during registration
            </p>
            <p className="flex gap-3">
              <CheckCircle2 className="size-5 shrink-0 text-emerald-500" /> You can sign in right away to track your
              approval
            </p>
            <p className="flex gap-3">
              <CheckCircle2 className="size-5 shrink-0 text-emerald-500" /> Parent details can be added after approval
            </p>
          </div>
        </div>
        <form
          onSubmit={handleSubmit(submit)}
          noValidate
          className="grid gap-5 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:grid-cols-2 sm:p-8"
        >
          <div className="sm:col-span-2">
            <h2 className="text-xl font-bold">Your details</h2>
            <p className="mt-1 text-sm text-slate-500">Preferred batch and notes are optional.</p>
          </div>
          {formError && (
            <div className="sm:col-span-2">
              <Alert>{formError}</Alert>
            </div>
          )}
          <Field label="Full name" error={errors.name?.message}>
            <Input placeholder="e.g. Rohan Joshi" autoComplete="name" {...register("name")} />
          </Field>
          <Field label="Email address" error={errors.email?.message}>
            <Input type="email" placeholder="you@example.com" autoComplete="email" {...register("email")} />
          </Field>
          <Field label="Phone number" error={errors.phone?.message}>
            <Input placeholder="+91 98765 43210" autoComplete="tel" {...register("phone")} />
          </Field>
          <Field label="Class" error={errors.schoolClass?.message}>
            <Select {...register("schoolClass")} disabled={batches === null}>
              <option value="" disabled>
                {batches === null ? "Loading classes…" : "Select class"}
              </option>
              {classOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <p className="mb-1.5 text-sm font-medium text-slate-700">Subjects you want to study</p>
            <div className="flex flex-wrap gap-2">
              {subjectOptions.map((s) => (
                <label
                  key={s}
                  className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50 has-[:checked]:text-blue-700"
                >
                  <input type="checkbox" value={s} className="size-4" {...register("requestedSubjects")} />
                  {s}
                </label>
              ))}
            </div>
            {errors.requestedSubjects && (
              <span className="mt-1 block text-xs text-red-600">{errors.requestedSubjects.message}</span>
            )}
          </div>
          <div className="sm:col-span-2">
            <Field label="Preferred batch (optional)" error={errors.preferredBatchId?.message}>
              <Select {...register("preferredBatchId")}>
                <option value="">No preference — let the teacher decide</option>
                {schoolClass ? (
                  <>
                    {classBatches.length > 0 && <optgroup label={`Batches for ${schoolClass}`}>{classBatches.map(batchOption)}</optgroup>}
                    {otherBatches.length > 0 && <optgroup label="Other batches">{otherBatches.map(batchOption)}</optgroup>}
                  </>
                ) : (
                  all.map(batchOption)
                )}
              </Select>
            </Field>
            {chosenBatch && !classMismatch && (
              <p className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                <CheckCircle2 className="size-3.5" /> Your teacher will see that you prefer {chosenBatch.name}.
              </p>
            )}
            {chosenBatch && classMismatch && (
              <p className="mt-1.5 text-xs font-medium text-amber-700">
                Note: {chosenBatch.name} is a batch for {chosenBatch.classLevel}, but you selected {schoolClass}. Change either
                one if that's a mistake.
              </p>
            )}
            {batches !== null && schoolClass && classBatches.length === 0 && !chosenBatch && (
              <p className="mt-1.5 text-xs text-slate-400">No open batch for {schoolClass} yet — your teacher will place you.</p>
            )}
          </div>
          <Field label="Create password" error={errors.password?.message}>
            <Input type="password" autoComplete="new-password" placeholder="8+ characters, letters & a number" {...register("password")} />
          </Field>
          <Field label="Confirm password" error={errors.confirmPassword?.message}>
            <Input type="password" autoComplete="new-password" placeholder="Enter the same password again" {...register("confirmPassword")} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Notes (optional)" error={errors.notes?.message}>
              <Textarea
                placeholder="For example: I prefer the weekday evening batch after 5:30 PM."
                maxLength={500}
                {...register("notes")}
              />
            </Field>
          </div>
          <Button disabled={isSubmitting} className="sm:col-span-2">
            {isSubmitting ? <Spinner /> : null}
            {isSubmitting ? "Submitting…" : "Submit registration"} {!isSubmitting && <ArrowRight className="size-4" />}
          </Button>
        </form>
      </main>
    </div>
  )
}

// ───────────────────────────── Forgot / reset password ─────────────────────────────

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("")
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!z.email().safeParse(email.trim()).success) return setError("Enter a valid email")
    setBusy(true)
    try {
      await authApi.forgotPassword(email.trim())
      setSent(true)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout>
      <div className="grid size-12 place-items-center rounded-2xl bg-blue-50 text-blue-600">
        <KeyRound />
      </div>
      <h2 className="mt-5 text-3xl font-bold tracking-tight text-slate-950">Forgot your password?</h2>
      {sent ? (
        <div className="mt-6 space-y-5">
          <Alert tone="green">
            If <strong>{email.trim()}</strong> is registered, a reset link is on its way. It is valid for 30 minutes.
          </Alert>
          <Link to="/login" className="block text-sm font-semibold text-blue-600">
            Back to sign in
          </Link>
        </div>
      ) : (
        <form className="mt-6 space-y-5" onSubmit={submit} noValidate>
          <p className="text-sm text-slate-500">Enter your account email and we'll send you a link to set a new password.</p>
          {error && <Alert>{error}</Alert>}
          <Field label="Email address">
            <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Button className="w-full" disabled={busy}>
            {busy && <Spinner />} Send reset link
          </Button>
          <Link to="/login" className="block text-center text-sm font-semibold text-blue-600">
            Back to sign in
          </Link>
        </form>
      )}
    </AuthLayout>
  )
}

const resetSchema = z
  .object({ password: passwordRule, confirmPassword: z.string().min(1, "Confirm your password") })
  .refine((d) => d.password === d.confirmPassword, { message: "Passwords do not match", path: ["confirmPassword"] })

export function ResetPasswordPage() {
  const [params] = useSearchParams()
  const token = params.get("token") ?? ""
  const [done, setDone] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof resetSchema>>({
    resolver: zodResolver(resetSchema),
    defaultValues: { password: "", confirmPassword: "" },
  })

  const submit = async ({ password }: z.infer<typeof resetSchema>) => {
    setFormError(null)
    try {
      await authApi.resetPassword(token, password)
      setDone(true)
    } catch (error) {
      setFormError(errorMessage(error))
    }
  }

  return (
    <AuthLayout>
      <div className="grid size-12 place-items-center rounded-2xl bg-blue-50 text-blue-600">
        <KeyRound />
      </div>
      <h2 className="mt-5 text-3xl font-bold tracking-tight text-slate-950">Choose a new password</h2>
      {!token ? (
        <div className="mt-6 space-y-4">
          <Alert>This link is incomplete. Please open the link from your email again.</Alert>
          <Link to="/forgot-password" className="block text-sm font-semibold text-blue-600">
            Request a new link
          </Link>
        </div>
      ) : done ? (
        <div className="mt-6 space-y-4">
          <Alert tone="green">Your password has been updated. You can now sign in.</Alert>
          <Link to="/login">
            <Button className="w-full">
              Go to sign in <ArrowRight className="size-4" />
            </Button>
          </Link>
        </div>
      ) : (
        <form className="mt-6 space-y-5" onSubmit={handleSubmit(submit)} noValidate>
          {formError && (
            <Alert>
              {formError}{" "}
              <Link to="/forgot-password" className="font-semibold underline">
                Request a new link
              </Link>
            </Alert>
          )}
          <Field label="New password" error={errors.password?.message}>
            <Input type="password" autoComplete="new-password" {...register("password")} />
          </Field>
          <Field label="Confirm new password" error={errors.confirmPassword?.message}>
            <Input type="password" autoComplete="new-password" {...register("confirmPassword")} />
          </Field>
          <Button className="w-full" disabled={isSubmitting}>
            {isSubmitting && <Spinner />} Save password
          </Button>
        </form>
      )}
    </AuthLayout>
  )
}
