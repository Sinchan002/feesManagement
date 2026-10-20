import { prisma } from "../../lib/prisma"
import { sendMail } from "../../lib/mailer"
import { audit, type Actor } from "../../lib/audit"
import { outstandingOf, toRupees } from "../../lib/money"
import { env } from "../../config/env"
import { getSettings } from "../settings/service"

const inr = (paise: number) => `₹${toRupees(paise).toLocaleString("en-IN")}`

/** Email every active student with unpaid fees (and their parent, if enabled). */
export async function sendFeeReminders(actor: Actor) {
  const settings = await getSettings()
  const charges = await prisma.feeCharge.findMany({
    where: { status: { in: ["PENDING", "PARTIALLY_PAID"] }, student: { status: "ACTIVE" } },
    include: { student: { include: { user: { select: { name: true, email: true } } } } },
    orderBy: { dueDate: "asc" },
  })
  const byStudent = new Map<string, typeof charges>()
  for (const c of charges) byStudent.set(c.studentId, [...(byStudent.get(c.studentId) ?? []), c])

  let studentsNotified = 0
  let parentsNotified = 0
  for (const list of byStudent.values()) {
    const { student } = list[0]!
    const total = list.reduce((sum, c) => sum + outstandingOf(c), 0)
    if (total <= 0) continue
    const lines = list
      .map((c) => `  • ${c.description}: ${inr(outstandingOf(c))} due ${c.dueDate.toLocaleDateString("en-IN")}`)
      .join("\n")
    const body = `${lines}\n\nTotal due: ${inr(total)}\n\nPay online at ${env.APP_URL}/student or pay at the academy.`
    const replyTo = settings.reminders.replyTo || undefined

    if (
      await sendMail({
        to: student.user.email,
        replyTo,
        subject: `Fee reminder – ${inr(total)} due`,
        text: `Hello ${student.user.name},\n\nThis is a reminder that the following fees are due:\n${body}`,
      })
    )
      studentsNotified++
    if (settings.reminders.notifyParents && student.parentEmail) {
      if (
        await sendMail({
          to: student.parentEmail,
          replyTo,
          subject: `Fee reminder for ${student.user.name}`,
          text: `Dear ${student.parentName ?? "Parent"},\n\nThe following fees for ${student.user.name} are due:\n${body}`,
        })
      )
        parentsNotified++
    }
  }

  await audit(actor, {
    action: "REMINDERS_SENT",
    entityType: "FeeCharge",
    summary: `Fee reminders sent to ${studentsNotified} student(s) and ${parentsNotified} parent(s)`,
    metadata: { studentsNotified, parentsNotified },
  })
  return { studentsNotified, parentsNotified }
}
