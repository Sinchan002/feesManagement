import { Router } from "express"
import { z } from "zod"
import { prisma } from "../../lib/prisma"
import { parse, periodSchema, toCsv } from "../../lib/http"
import { outstandingOf, toRupees } from "../../lib/money"
import { addMonths, currentPeriod, periodEnd, periodLabel, periodStart } from "../../lib/dates"
import { authenticate, requireAdmin } from "../../middleware/auth"
import { paymentInclude, serializePayment } from "../payments/service"
import { enrolledCounts } from "../batches/service"
import { standings } from "../students/service"

export const reportsRouter = Router()
reportsRouter.use(authenticate, requireAdmin)

const monthQuery = z.object({ month: periodSchema.optional(), batchId: z.string().max(64).optional() })

/** Sum of successful payments received in a period (cash-basis collections). */
async function collectedIn(period: string, source?: "MANUAL" | "ONLINE") {
  const agg = await prisma.payment.aggregate({
    where: {
      status: "SUCCEEDED",
      paymentDate: { gte: periodStart(period), lt: periodEnd(period) },
      ...(source ? { source } : {}),
    },
    _sum: { amount: true },
  })
  return agg._sum.amount ?? 0
}

/** Billed vs paid for charges belonging to a billing period. */
async function billingFor(period: string, batchId?: string) {
  const charges = await prisma.feeCharge.findMany({
    where: { billingPeriod: period, status: { not: "VOID" }, ...(batchId ? { batchId } : {}) },
    select: { studentId: true, batchId: true, amount: true, adjustmentTotal: true, paidAmount: true },
  })
  let billed = 0
  let paid = 0
  let outstanding = 0
  for (const c of charges) {
    billed += c.amount + c.adjustmentTotal
    paid += Math.min(c.paidAmount, c.amount + c.adjustmentTotal)
    outstanding += outstandingOf(c)
  }
  return { charges, billed, paid, outstanding, rate: billed > 0 ? Math.round((paid / billed) * 1000) / 10 : null }
}

const pctChange = (now: number, before: number) =>
  before > 0 ? Math.round(((now - before) / before) * 1000) / 10 : null

reportsRouter.get("/dashboard", async (req, res) => {
  const { month } = parse(monthQuery, req.query)
  const period = month ?? currentPeriod()
  const previous = addMonths(period, -1)

  const [collected, collectedPrev, billing, billingPrev, allStandings, activeStudents, newStudents, pendingRegistrations, latestPayments, recentActivity] =
    await Promise.all([
      collectedIn(period),
      collectedIn(previous),
      billingFor(period),
      billingFor(previous),
      standings(null),
      prisma.student.count({ where: { status: "ACTIVE" } }),
      prisma.student.count({ where: { joinedAt: { gte: periodStart(period), lt: periodEnd(period) } } }),
      prisma.registration.count({ where: { status: "PENDING" } }),
      prisma.payment.findMany({
        where: { status: "SUCCEEDED" },
        include: paymentInclude,
        orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
        take: 5,
      }),
      prisma.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 6,
        where: { action: { notIn: ["LOGIN", "PAYMENT_ORDER_CREATED"] } },
        include: { actor: { select: { name: true } } },
      }),
    ])

  const withDues = [...allStandings.values()].filter((s) => s.outstanding > 0)
  const totalOutstanding = withDues.reduce((sum, s) => sum + s.outstanding, 0)

  const trend = []
  for (let i = 5; i >= 0; i--) {
    const p = addMonths(period, -i)
    const [c, b] = await Promise.all([collectedIn(p), billingFor(p)])
    trend.push({
      period: p,
      month: periodStart(p).toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" }),
      collected: toRupees(c),
      due: toRupees(b.outstanding),
    })
  }

  res.json({
    data: {
      period,
      periodLabel: periodLabel(period),
      metrics: {
        collectedThisMonth: toRupees(collected),
        collectedChangePct: pctChange(collected, collectedPrev),
        outstandingFees: totalOutstanding,
        studentsWithDues: withDues.length,
        activeStudents,
        newStudentsThisMonth: newStudents,
        collectionRate: billing.rate,
        collectionRateChange:
          billing.rate !== null && billingPrev.rate !== null ? Math.round((billing.rate - billingPrev.rate) * 10) / 10 : null,
        pendingRegistrations,
      },
      trend,
      latestPayments: latestPayments.map(serializePayment),
      recentActivity: recentActivity.map((a) => ({
        id: a.id,
        action: a.action,
        summary: a.summary,
        actor: a.actor?.name ?? (a.actorRole === "SYSTEM" ? "System" : null),
        actorRole: a.actorRole,
        createdAt: a.createdAt,
      })),
    },
  })
})

reportsRouter.get("/collections", async (req, res) => {
  const q = parse(monthQuery, req.query)
  const period = q.month ?? currentPeriod()
  const billing = await billingFor(period, q.batchId)

  const [online, manual, byMethodRows, batches] = await Promise.all([
    collectedIn(period, "ONLINE"),
    collectedIn(period, "MANUAL"),
    prisma.payment.groupBy({
      by: ["method"],
      where: { status: "SUCCEEDED", paymentDate: { gte: periodStart(period), lt: periodEnd(period) } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.batch.findMany({ where: q.batchId ? { id: q.batchId } : { status: { not: "ARCHIVED" } }, orderBy: { code: "asc" } }),
  ])
  const counts = await enrolledCounts(batches.map((b) => b.id))

  // Per-student status for this period's charges.
  const perStudent = new Map<string, number>()
  for (const c of billing.charges) perStudent.set(c.studentId, (perStudent.get(c.studentId) ?? 0) + outstandingOf(c))
  const paidStudents = [...perStudent.values()].filter((v) => v === 0).length

  const byBatch = batches.map((b) => {
    const charges = billing.charges.filter((c) => c.batchId === b.id)
    const billed = charges.reduce((s, c) => s + c.amount + c.adjustmentTotal, 0)
    const paid = charges.reduce((s, c) => s + Math.min(c.paidAmount, c.amount + c.adjustmentTotal), 0)
    return {
      batchId: b.id,
      code: b.code,
      name: b.name,
      students: counts.get(b.id) ?? 0,
      monthlyFee: toRupees(b.monthlyFee),
      billed: toRupees(billed),
      collected: toRupees(paid),
      outstanding: toRupees(billed - paid),
      collectionRate: billed > 0 ? Math.round((paid / billed) * 1000) / 10 : null,
    }
  })

  res.json({
    data: {
      period,
      periodLabel: periodLabel(period),
      billed: toRupees(billing.billed),
      collectedAgainstBilling: toRupees(billing.paid),
      outstanding: toRupees(billing.outstanding),
      collectionRate: billing.rate,
      receivedInMonth: { total: toRupees(online + manual), online: toRupees(online), manual: toRupees(manual) },
      studentStatus: { paid: paidStudents, due: perStudent.size - paidStudents },
      byMethod: byMethodRows.map((m) => ({ method: m.method, amount: toRupees(m._sum.amount ?? 0), count: m._count._all })),
      byBatch,
    },
  })
})

/** Per-student fee statement for a month, as CSV. */
reportsRouter.get("/collections.csv", async (req, res) => {
  const q = parse(monthQuery, req.query)
  const period = q.month ?? currentPeriod()
  const charges = await prisma.feeCharge.findMany({
    where: { billingPeriod: period, status: { not: "VOID" }, ...(q.batchId ? { batchId: q.batchId } : {}) },
    include: { student: { include: { user: { select: { name: true, phone: true } } } } },
    orderBy: [{ batchNameAtCharge: "asc" }, { code: "asc" }],
  })
  const csv = toCsv(
    ["Charge", "Student code", "Student", "Phone", "Batch", "Original amount", "Adjustments", "Paid", "Outstanding", "Due date", "Status"],
    charges.map((c) => [
      c.code,
      c.student.code,
      c.student.user.name,
      c.student.user.phone,
      c.batchNameAtCharge,
      toRupees(c.amount).toFixed(2),
      toRupees(c.adjustmentTotal).toFixed(2),
      toRupees(c.paidAmount).toFixed(2),
      toRupees(outstandingOf(c)).toFixed(2),
      c.dueDate.toISOString().slice(0, 10),
      c.status,
    ]),
  )
  res.setHeader("Content-Type", "text/csv; charset=utf-8")
  res.setHeader("Content-Disposition", `attachment; filename="fees-${period}.csv"`)
  res.send(csv)
})
