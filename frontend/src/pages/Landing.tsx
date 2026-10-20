import { useState } from "react"
import { Link } from "react-router"
import {
  ArrowRight,
  Atom,
  Award,
  Beaker,
  BookOpenCheck,
  CalendarDays,
  Camera,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Download,
  FlaskConical,
  GraduationCap,
  History,
  IndianRupee,
  Lightbulb,
  LockKeyhole,
  Mail,
  MapPin,
  Menu,
  MessageCircle,
  Orbit,
  Phone,
  Play,
  Quote,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  Star,
  Target,
  TrendingUp,
  UsersRound,
  Waves,
  X,
  Zap,
} from "lucide-react"
import { Badge, Button, Card } from "../components/ui"
import { batchesApi } from "../services/api"
import type { PublicBatch } from "../services/types"
import { currentPeriod, inr, periodLabel, shiftPeriod, useAsync } from "../lib/format"
import { classOptionsFrom } from "../lib/academics"

// Visual styles cycled across the teacher's batches.
const cardStyles = [
  { accent: "bg-cyan-50 text-cyan-600", icon: Lightbulb },
  { accent: "bg-blue-50 text-blue-600", icon: BookOpenCheck },
  { accent: "bg-violet-50 text-violet-600", icon: Target },
]

function BatchCard({ batch: b, index }: { batch: PublicBatch; index: number }) {
  const style = cardStyles[index % cardStyles.length]!
  const enrolled = b.capacity - b.seatsLeft
  return (
    <Card className="group flex flex-col overflow-hidden p-6 transition duration-300 hover:-translate-y-1 hover:shadow-xl">
      <div className="flex items-center justify-between">
        <div className={`grid size-12 place-items-center rounded-2xl ${style.accent}`}>
          <style.icon className="size-6" />
        </div>
        {b.hasSeats ? (
          <Badge tone={b.seatsLeft <= 3 ? "amber" : "green"}>
            {b.seatsLeft} seat{b.seatsLeft === 1 ? "" : "s"} left
          </Badge>
        ) : (
          <Badge tone="red">Batch full</Badge>
        )}
      </div>
      <p className="mt-7 text-xs font-bold uppercase tracking-wider text-cyan-600">{b.classLevel}</p>
      <h3 className="mt-2 text-xl font-bold">{b.name}</h3>
      <div className="mt-3 flex min-h-8 flex-wrap gap-1.5">
        {b.subjects.map((s) => (
          <span key={s} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
            {s}
          </span>
        ))}
      </div>
      <div className="mt-6 space-y-3 border-y border-slate-100 py-5 text-sm text-slate-600">
        <p className="flex items-center gap-3">
          <CalendarDays className="size-4 text-cyan-600" />
          {b.schedule}
        </p>
        <p className="flex items-center gap-3">
          <Clock3 className="size-4 text-cyan-600" />
          {b.time}
        </p>
        <p className="flex items-center gap-3">
          <IndianRupee className="size-4 text-cyan-600" />
          {inr(b.monthlyFee)} per month
        </p>
      </div>
      <div className="mt-5">
        <div className="mb-2 flex justify-between text-xs">
          <span className="text-slate-400">Batch availability</span>
          <span className="font-bold">
            {enrolled}/{b.capacity} enrolled
          </span>
        </div>
        <div className="h-2 rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-cyan-500" style={{ width: `${Math.min(100, (enrolled / b.capacity) * 100)}%` }} />
        </div>
      </div>
      <Link
        to={b.hasSeats ? `/register?batch=${b.id}` : "/register"}
        className="mt-auto flex items-center justify-between pt-6 text-sm font-bold text-slate-900"
      >
        {b.hasSeats ? "Request a seat" : "Register your interest"}{" "}
        <ChevronRight className="size-4 transition group-hover:translate-x-1" />
      </Link>
    </Card>
  )
}

const testimonials = [
  {
    quote:
      "Sir made mechanics feel visual instead of abstract. His experiments and diagrams helped me score 95 in Physics.",
    name: "Anirban Saha",
    detail: "Class XII • WBCHSE",
  },
  {
    quote:
      "Every numerical is explained from first principles. I stopped memorising formulas and started understanding them.",
    name: "Riya Banerjee",
    detail: "JEE Foundation Student",
  },
  {
    quote:
      "The fee dashboard is transparent and simple. We always know the due date and can download every receipt instantly.",
    name: "Mrs. Sen",
    detail: "Parent of Class XI student",
  },
]

function PhysicsVisual() {
  return (
    <div className="relative mx-auto aspect-square w-full max-w-lg">
      <div className="absolute inset-[8%] rounded-full bg-cyan-400/10 blur-3xl" />
      <div className="absolute inset-[12%] animate-[spin_24s_linear_infinite] rounded-full border border-cyan-300/25" />
      <div className="absolute inset-[22%] animate-[spin_18s_linear_infinite_reverse] rounded-full border border-blue-300/20" />
      <svg
        viewBox="0 0 500 500"
        className="absolute inset-0 size-full text-cyan-300"
        aria-hidden="true"
      >
        <ellipse
          cx="250"
          cy="250"
          rx="205"
          ry="76"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          opacity=".42"
          transform="rotate(32 250 250)"
        />
        <ellipse
          cx="250"
          cy="250"
          rx="205"
          ry="76"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          opacity=".28"
          transform="rotate(-32 250 250)"
        />
        <circle cx="90" cy="173" r="7" fill="currentColor" />
        <circle cx="410" cy="326" r="6" fill="#60a5fa" />
      </svg>
      <div className="absolute inset-[31%] grid place-items-center rounded-full border border-white/10 bg-slate-900/80 shadow-2xl shadow-cyan-500/20 backdrop-blur-xl">
        <Atom className="size-24 text-cyan-300" strokeWidth={1.2} />
      </div>
      <Card className="absolute left-0 top-[14%] flex items-center gap-3 border-white/10 bg-white/95 p-3 shadow-xl">
        <div className="grid size-10 place-items-center rounded-xl bg-cyan-50 text-cyan-600">
          <Waves className="size-5" />
        </div>
        <div>
          <p className="text-xs text-slate-400">Concept clarity</p>
          <p className="text-sm font-bold text-slate-900">Visual learning</p>
        </div>
      </Card>
      <Card className="absolute bottom-[12%] right-0 flex items-center gap-3 border-white/10 bg-white/95 p-3 shadow-xl">
        <div className="grid size-10 place-items-center rounded-xl bg-blue-50 text-blue-600">
          <TrendingUp className="size-5" />
        </div>
        <div>
          <p className="text-xs text-slate-400">Exam ready</p>
          <p className="text-sm font-bold text-slate-900">
            Results that matter
          </p>
        </div>
      </Card>
      <div className="absolute right-[8%] top-[9%] size-2 rounded-full bg-cyan-300 shadow-[0_0_18px_4px_rgba(103,232,249,.5)]" />
      <div className="absolute bottom-[20%] left-[9%] size-1.5 rounded-full bg-blue-400 shadow-[0_0_15px_3px_rgba(96,165,250,.5)]" />
    </div>
  )
}

/** Illustration of the student fee screen, using one of the teacher's real batches. */
function FeePortalDemo({ sample }: { sample: PublicBatch | null }) {
  const fee = sample ? inr(sample.monthlyFee) : "—"
  const lastMonth = periodLabel(shiftPeriod(currentPeriod(), -1))
  return (
    <Card className="overflow-hidden border-slate-700 bg-slate-900 text-white shadow-2xl shadow-slate-950/30">
      <div className="flex items-center gap-2 border-b border-white/10 px-5 py-4">
        <span className="size-2.5 rounded-full bg-red-400" />
        <span className="size-2.5 rounded-full bg-amber-400" />
        <span className="size-2.5 rounded-full bg-emerald-400" />
        <span className="ml-3 text-xs text-slate-400">
          fee-management-preview
        </span>
        <LockKeyhole className="ml-auto size-3.5 text-emerald-400" />
      </div>
      <div className="p-6 sm:p-8">
        <div className="flex items-center justify-between">
          <div>
            <Badge tone="green">Fee up to date</Badge>
            <h3 className="mt-3 text-xl font-bold">Student fee overview</h3>
            <p className="mt-1 text-xs text-slate-400">Sample dashboard</p>
          </div>
          <LockKeyhole className="size-5 text-emerald-400" />
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-white/5 p-4">
            <p className="text-xs text-slate-400">Monthly fee</p>
            <p className="mt-2 text-xl font-bold">{fee}</p>
            <p className="mt-1 text-xs text-cyan-300">Billed every month</p>
          </div>
          <div className="rounded-2xl bg-white/5 p-4">
            <p className="text-xs text-slate-400">Current batch</p>
            <p className="mt-2 truncate text-sm font-bold">{sample?.name ?? "Your batch"}</p>
            <p className="mt-1 truncate text-xs text-cyan-300">{sample?.schedule ?? "Schedule after approval"}</p>
          </div>
        </div>
        <div className="mt-4 rounded-2xl border border-white/10 p-4">
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-full bg-emerald-400/10 text-emerald-300">
              <CheckCircle2 className="size-4" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold">{lastMonth}</p>
              <p className="text-xs text-slate-400">Paid • UPI • receipt issued</p>
            </div>
            <p className="text-sm font-bold">{fee}</p>
          </div>
          <Link
            to="/login"
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-xs font-semibold text-cyan-300 hover:bg-white/10"
          >
            <Download className="size-3.5" /> Log in to download your receipts
          </Link>
        </div>
        <p className="mt-4 text-center text-[11px] text-slate-500">
          Preview only—no real payment or account data is processed.
        </p>
      </div>
    </Card>
  )
}

export function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false)
  // The teacher's active batches — the same list the registration form offers.
  const { data: batches, loading: batchesLoading } = useAsync(() => batchesApi.publicList(), [])
  const sample = batches?.[0] ?? null
  const classes = batches?.length ? classOptionsFrom(batches) : []
  const highlights = batches?.length
    ? [
        `${batches.length} batch${batches.length === 1 ? "" : "es"} open for admission`,
        `Classes: ${classes.slice(0, 4).join(", ")}${classes.length > 4 ? "…" : ""}`,
        "Board & entrance preparation",
      ]
    : ["Concept-first teaching", "Board & entrance preparation", "Transparent online fees"]
  const navItems = [
    ["Home", "#home"],
    ["About Sir", "#about"],
    ["Courses", "#courses"],
    ["Fee Management", "#fee-portal"],
    ["Contact", "#contact"],
  ]

  return (
    <div className="min-h-screen overflow-hidden bg-white text-slate-900">
      <header className="fixed inset-x-0 top-0 z-40 border-b border-slate-200/70 bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex h-20 max-w-7xl items-center px-5 lg:px-8">
          <a href="#home" className="flex items-center gap-3">
            <div className="grid size-11 place-items-center rounded-2xl bg-slate-950 text-cyan-300 shadow-lg shadow-slate-900/15">
              <Atom className="size-6" />
            </div>
            <div>
              <p className="font-bold tracking-tight text-slate-950">
                SriKrishna Physics
              </p>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-600">
                Academy
              </p>
            </div>
          </a>
          <nav className="mx-auto hidden items-center gap-7 lg:flex">
            {navItems.map(([label, href]) => (
              <a
                key={label}
                href={href}
                className="text-sm font-semibold text-slate-500 transition hover:text-slate-950"
              >
                {label}
              </a>
            ))}
          </nav>
          <div className="ml-auto hidden items-center gap-2 lg:flex">
            <Link to="/login">
              <Button variant="ghost">Login</Button>
            </Link>
            <Link to="/register">
              <Button variant="secondary">Register</Button>
            </Link>
          </div>
          <button
            className="ml-auto rounded-xl border border-slate-200 p-2.5 lg:hidden"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Toggle navigation"
          >
            {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
        {menuOpen && (
          <div className="border-t border-slate-100 bg-white p-5 lg:hidden">
            <nav className="space-y-1">
              {navItems.map(([label, href]) => (
                <a
                  key={label}
                  href={href}
                  onClick={() => setMenuOpen(false)}
                  className="block rounded-xl px-3 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                >
                  {label}
                </a>
              ))}
            </nav>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Link to="/login">
                <Button variant="secondary" className="w-full">
                  Login
                </Button>
              </Link>
              <Link to="/register">
                <Button className="w-full bg-cyan-500 text-slate-950 hover:bg-cyan-400">
                  Register
                </Button>
              </Link>
            </div>
          </div>
        )}
      </header>

      <main>
        <section
          id="home"
          className="relative overflow-hidden bg-slate-950 pb-20 pt-32 text-white sm:pt-40 lg:min-h-[800px] lg:pb-28"
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,rgba(6,182,212,.16),transparent_28%),radial-gradient(circle_at_80%_60%,rgba(37,99,235,.15),transparent_35%)]" />
          <div className="absolute inset-0 opacity-[0.035] [background-image:linear-gradient(rgba(255,255,255,.7)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.7)_1px,transparent_1px)] [background-size:48px_48px]" />
          <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-5 lg:grid-cols-[1.05fr_.95fr] lg:px-8">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1.5 text-xs font-bold text-cyan-300">
                <Sparkles className="size-3.5" /> Physics made visual, logical,
                and exciting
              </div>
              <h1 className="mt-7 max-w-3xl text-4xl font-bold leading-[1.08] tracking-[-0.04em] sm:text-6xl lg:text-7xl">
                Master Physics with{" "}
                <span className="text-cyan-300">Precision, Logic,</span> and
                Conceptual Clarity.
              </h1>
              <p className="mt-7 max-w-2xl text-base leading-8 text-slate-300 sm:text-lg">
                Led by SriKrishna Mondal (M.Sc., B.Ed.)—empowering students to
                excel in board exams and competitive entrances through digital
                learning, hands-on experiments, and clear visualization of
                physical phenomena.
              </p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <a href="#courses">
                  <Button className="w-full bg-cyan-400 px-6 text-slate-950 hover:bg-cyan-300 sm:w-auto">
                    Explore Batches <ArrowRight className="size-4" />
                  </Button>
                </a>
                <Link to="/login">
                  <Button className="w-full border border-white/15 bg-white/5 px-6 text-white hover:bg-white/10 sm:w-auto">
                    <LockKeyhole className="size-4" /> Login
                  </Button>
                </Link>
              </div>
              <div className="mt-10 flex flex-wrap gap-x-7 gap-y-3 text-xs font-medium text-slate-400">
                {highlights.map((h) => (
                  <span key={h} className="flex items-center gap-2">
                    <Check className="size-4 text-cyan-300" /> {h}
                  </span>
                ))}
              </div>
            </div>
            <PhysicsVisual />
          </div>
        </section>

        <section className="border-b border-slate-100 bg-white">
          <div className="mx-auto grid max-w-7xl grid-cols-2 divide-x divide-slate-100 px-5 py-8 md:grid-cols-4 lg:px-8">
            {[
              ["10+", "Years of teaching"],
              ["500+", "Students mentored"],
              ["94%", "Board success"],
              ["4.9/5", "Student rating"],
            ].map(([value, label]) => (
              <div key={label} className="px-4 py-3 text-center">
                <p className="text-2xl font-bold text-slate-950 sm:text-3xl">
                  {value}
                </p>
                <p className="mt-1 text-xs text-slate-500">{label}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="about" className="scroll-mt-20 bg-slate-50 py-20 sm:py-28">
          <div className="mx-auto grid max-w-7xl items-center gap-12 px-5 lg:grid-cols-[.85fr_1.15fr] lg:px-8">
            <div className="relative">
              <div className="aspect-[4/4.5] overflow-hidden rounded-[2rem] bg-slate-900 p-8 text-white shadow-2xl">
                <div className="absolute inset-8 rounded-full bg-cyan-400/10 blur-3xl" />
                <div className="relative flex h-full flex-col justify-between">
                  <div className="flex justify-between">
                    <div className="grid size-16 place-items-center rounded-2xl bg-cyan-400 text-slate-950">
                      <FlaskConical className="size-8" />
                    </div>
                    <Badge tone="blue">M.Sc., B.Ed. in Physics</Badge>
                  </div>
                  <div>
                    <p className="text-sm text-cyan-300">Meet your educator</p>
                    <h2 className="mt-2 text-4xl font-bold tracking-tight">
                      SriKrishna
                      <br />
                      Mondal
                    </h2>
                    <p className="mt-4 max-w-sm text-sm leading-7 text-slate-300">
                      Dedicated physics educator, mentor, and believer in making
                      every complex idea observable.
                    </p>
                  </div>
                </div>
              </div>
              <Card className="absolute -bottom-6 -right-2 flex items-center gap-3 p-4 shadow-xl sm:right-[-5%]">
                <Award className="size-8 text-cyan-600" />
                <div>
                  <p className="text-xs text-slate-400">Teaching focus</p>
                  <p className="text-sm font-bold">Clarity before formulae</p>
                </div>
              </Card>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-600">
                About the educator
              </p>
              <h2 className="mt-4 text-3xl font-bold tracking-tight text-slate-950 sm:text-5xl">
                Learn to see the physics, not just solve it.
              </h2>
              <p className="mt-6 text-base leading-8 text-slate-600">
                SriKrishna Mondal combines years of dedicated classroom
                experience with demonstrations, diagrams, simulations, and
                systematic problem-solving. Every lesson moves from observation
                to concept, concept to equation, and equation to confident
                application.
              </p>
              <div className="mt-8 grid gap-4 sm:grid-cols-2">
                {[
                  [
                    Beaker,
                    "Hands-on visualization",
                    "Experiments that make invisible phenomena tangible.",
                  ],
                  [
                    Target,
                    "Exam-smart practice",
                    "Board and entrance patterns taught with sound reasoning.",
                  ],
                  [
                    UsersRound,
                    "Focused mentoring",
                    "Personal feedback and doubt-clearing for every learner.",
                  ],
                  [
                    Zap,
                    "Conceptual confidence",
                    "Build intuition first, then speed and accuracy.",
                  ],
                ].map(([Icon, title, text]) => {
                  const FeatureIcon = Icon as typeof Beaker
                  return (
                    <div
                      key={String(title)}
                      className="rounded-2xl border border-slate-200 bg-white p-5"
                    >
                      <FeatureIcon className="size-5 text-cyan-600" />
                      <h3 className="mt-4 text-sm font-bold">
                        {String(title)}
                      </h3>
                      <p className="mt-2 text-xs leading-5 text-slate-500">
                        {String(text)}
                      </p>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </section>

        <section id="courses" className="scroll-mt-20 bg-white py-20 sm:py-28">
          <div className="mx-auto max-w-7xl px-5 lg:px-8">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-600">
                Courses & batches
              </p>
              <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-5xl">
                A focused path for every goal.
              </h2>
              <p className="mt-5 leading-7 text-slate-500">
                Carefully sized batches, structured study plans, and teaching
                calibrated to each academic stage.
              </p>
            </div>
            {batchesLoading && !batches ? (
              <div className="mt-12 grid gap-6 lg:grid-cols-3">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-[430px] animate-pulse rounded-2xl bg-slate-100" />
                ))}
              </div>
            ) : batches?.length ? (
              <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {batches.map((b, i) => (
                  <BatchCard key={b.id} batch={b} index={i} />
                ))}
              </div>
            ) : (
              <Card className="mx-auto mt-12 max-w-xl p-8 text-center">
                <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-cyan-50 text-cyan-600">
                  <CalendarDays className="size-6" />
                </div>
                <h3 className="mt-5 text-lg font-bold">New batches are being planned</h3>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  Register now and the teacher will place you in a suitable batch as soon as one opens.
                </p>
                <Link to="/register" className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-cyan-700">
                  Register your interest <ChevronRight className="size-4" />
                </Link>
              </Card>
            )}
          </div>
        </section>

        <section className="bg-slate-950 py-20 text-white sm:py-28">
          <div className="mx-auto grid max-w-7xl items-center gap-14 px-5 lg:grid-cols-2 lg:px-8">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-300">
                Fee management, simplified
              </p>
              <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-5xl">
                Complete clarity, from due date to receipt.
              </h2>
              <p className="mt-6 max-w-xl leading-8 text-slate-300">
                A secure digital experience gives students a clear view of fees,
                payments, receipts, and batch details—without calls, confusion,
                or lost paper slips.
              </p>
              <div className="mt-9 space-y-5">
                {[
                  [
                    History,
                    "Transparent fee tracking",
                    "View monthly dues and a complete payment history.",
                  ],
                  [
                    ShieldCheck,
                    "Secure online payment preview",
                    "Gateway-ready flow with server-side confirmation.",
                  ],
                  [
                    ReceiptText,
                    "Instant digital receipts",
                    "Download verified receipts whenever you need them.",
                  ],
                  [
                    Mail,
                    "Automated due reminders",
                    "Students and parent contacts are notified before fees become overdue.",
                  ],
                ].map(([Icon, title, text]) => {
                  const FeatureIcon = Icon as typeof History
                  return (
                    <div key={String(title)} className="flex gap-4">
                      <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-cyan-400/10 text-cyan-300">
                        <FeatureIcon className="size-5" />
                      </div>
                      <div>
                        <h3 className="font-bold">{String(title)}</h3>
                        <p className="mt-1 text-sm leading-6 text-slate-400">
                          {String(text)}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
            <div className="relative">
              <div className="absolute -inset-5 rounded-[2rem] bg-cyan-400/10 blur-2xl" />
              <Card className="relative overflow-hidden border-slate-700 bg-slate-900 p-5 text-white">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-slate-400">
                      Student fee overview
                    </p>
                    <p className="mt-1 font-bold">{periodLabel(currentPeriod())}</p>
                  </div>
                  <Badge tone="blue">Example</Badge>
                </div>
                <div className="mt-6 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl bg-cyan-400 p-5 text-slate-950">
                    <IndianRupee className="size-5" />
                    <p className="mt-5 text-xs font-semibold opacity-60">
                      Monthly fee
                    </p>
                    <p className="mt-1 text-2xl font-bold">{sample ? inr(sample.monthlyFee) : "—"}</p>
                    <p className="mt-1 truncate text-xs">{sample?.name ?? "Set per batch"}</p>
                  </div>
                  <div className="rounded-2xl bg-white/5 p-5">
                    <ReceiptText className="size-5 text-cyan-300" />
                    <p className="mt-5 text-xs text-slate-400">Receipts</p>
                    <p className="mt-1 text-2xl font-bold">Instant</p>
                    <p className="mt-1 text-xs text-slate-400">
                      For every payment
                    </p>
                  </div>
                </div>
                <div className="mt-3 rounded-2xl bg-white/5 p-5">
                  <div className="flex items-end justify-between">
                    <div>
                      <p className="text-xs text-slate-400">
                        Payment history
                      </p>
                      <p className="mt-1 font-bold">Every month at a glance</p>
                    </div>
                    <TrendingUp className="size-5 text-emerald-400" />
                  </div>
                  <div className="mt-5 flex h-20 items-end gap-2">
                    {[45, 62, 52, 75, 66, 88, 80, 100].map((height, index) => (
                      <div
                        key={index}
                        className="flex-1 rounded-t bg-cyan-400/60"
                        style={{ height: `${height}%` }}
                      />
                    ))}
                  </div>
                </div>
              </Card>
            </div>
          </div>
        </section>

        <section
          id="fee-portal"
          className="scroll-mt-20 bg-slate-50 py-20 sm:py-28"
        >
          <div className="mx-auto grid max-w-7xl items-center gap-12 px-5 lg:grid-cols-[.9fr_1.1fr] lg:px-8">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-600">
                Digital fee preview
              </p>
              <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-5xl">
                Try the fee experience.
              </h2>
              <p className="mt-5 max-w-lg leading-8 text-slate-600">
                Preview the clear fee experience available after login,
                including upcoming dues, batch information, payment history, and
                receipt downloads.
              </p>
              <div className="mt-8 rounded-2xl border border-cyan-100 bg-cyan-50 p-5 text-sm leading-6 text-cyan-900">
                <strong>Safe by design:</strong> this preview never processes a
                real payment. Production payment confirmation and email delivery
                remain secure backend operations.
              </div>
            </div>
            <FeePortalDemo sample={sample} />
          </div>
        </section>

        <section className="bg-white py-20 sm:py-28">
          <div className="mx-auto max-w-7xl px-5 lg:px-8">
            <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-600">
                  Testimonials & results
                </p>
                <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-5xl">
                  Confidence built concept by concept.
                </h2>
              </div>
              <div className="flex items-center gap-2 text-sm font-bold">
                <div className="flex text-amber-400">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Star key={star} className="size-4 fill-current" />
                  ))}
                </div>
                4.9 average rating
              </div>
            </div>
            <div className="mt-12 grid gap-6 lg:grid-cols-3">
              {testimonials.map((item) => (
                <Card key={item.name} className="p-6 sm:p-7">
                  <Quote className="size-8 text-cyan-500" />
                  <p className="mt-6 min-h-32 text-sm leading-7 text-slate-600">
                    “{item.quote}”
                  </p>
                  <div className="mt-6 border-t border-slate-100 pt-5">
                    <p className="font-bold">{item.name}</p>
                    <p className="mt-1 text-xs text-slate-400">{item.detail}</p>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer id="contact" className="scroll-mt-20 bg-slate-950 text-white">
        <div className="mx-auto grid max-w-7xl gap-12 px-5 py-16 md:grid-cols-2 lg:grid-cols-4 lg:px-8">
          <div className="lg:col-span-2">
            <div className="flex items-center gap-3">
              <div className="grid size-11 place-items-center rounded-2xl bg-cyan-400 text-slate-950">
                <Atom className="size-6" />
              </div>
              <div>
                <p className="font-bold">SriKrishna Physics Academy</p>
                <p className="text-xs text-cyan-300">
                  Learn • Visualize • Excel
                </p>
              </div>
            </div>
            <p className="mt-6 max-w-md text-sm leading-7 text-slate-400">
              Premium physics tuition for school, board, and competitive exam
              learners in Bankura—guided by SriKrishna Mondal, M.Sc., B.Ed.
            </p>
            <a
              href="https://wa.me/918927891273"
              target="_blank"
              rel="noreferrer"
              className="mt-6 inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-400"
            >
              <MessageCircle className="size-4" /> WhatsApp inquiry
            </a>
            <div className="mt-5 flex gap-2">
              {[
                ["Facebook", UsersRound, "https://www.facebook.com/"],
                ["Instagram", Camera, "https://www.instagram.com/"],
                ["YouTube", Play, "https://www.youtube.com/"],
              ].map(([label, Icon, href]) => {
                const SocialIcon = Icon as typeof UsersRound
                return (
                  <a
                    key={String(label)}
                    href={String(href)}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={String(label)}
                    className="grid size-10 place-items-center rounded-xl border border-white/10 text-slate-400 transition hover:border-cyan-300/40 hover:bg-cyan-300/10 hover:text-cyan-300"
                  >
                    <SocialIcon className="size-4" />
                  </a>
                )
              })}
            </div>
          </div>
          <div>
            <h3 className="text-sm font-bold">Contact</h3>
            <div className="mt-5 space-y-4 text-sm text-slate-400">
              <p className="flex items-start gap-3">
                <MapPin className="mt-0.5 size-4 shrink-0 text-cyan-300" />
                School Danga, Bankura, West Bengal – 722101
              </p>
              <a
                href="tel:+918927891273"
                className="flex items-center gap-3 hover:text-white"
              >
                <Phone className="size-4 text-cyan-300" /> +91 89278 91273
              </a>
              <a
                href="mailto:hello@srikrishnaphysics.in"
                className="flex items-center gap-3 hover:text-white"
              >
                <Mail className="size-4 text-cyan-300" />{" "}
                hello@srikrishnaphysics.in
              </a>
            </div>
          </div>
          <div>
            <h3 className="text-sm font-bold">Quick links</h3>
            <div className="mt-5 space-y-3 text-sm text-slate-400">
              {navItems.slice(1).map(([label, href]) => (
                <a key={label} href={href} className="block hover:text-white">
                  {label}
                </a>
              ))}
              <Link to="/login" className="block hover:text-white">
                Login
              </Link>
              <Link to="/register" className="block hover:text-white">
                New registration
              </Link>
            </div>
          </div>
        </div>
        <div className="border-t border-white/10">
          <div className="mx-auto flex max-w-7xl flex-col gap-2 px-5 py-5 text-xs text-slate-500 sm:flex-row sm:justify-between lg:px-8">
            <p>© 2025 SriKrishna Physics Academy. All rights reserved.</p>
            <p>Physics education with clarity and purpose.</p>
          </div>
        </div>
      </footer>
    </div>
  )
}
