import PDFDocument from "pdfkit"
import type { Settings } from "../settings/service"
import type { serializePayment } from "./service"

type ReceiptPayment = ReturnType<typeof serializePayment>

// The built-in PDF fonts have no ₹ glyph, so the PDF writes "Rs.".
const money = (n: number) => `Rs. ${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const date = (d: Date | null) =>
  d ? d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—"
const METHOD_LABEL: Record<string, string> = {
  CASH: "Cash",
  UPI: "UPI",
  BANK_TRANSFER: "Bank transfer",
  CHEQUE: "Cheque",
  CARD: "Card",
  NET_BANKING: "Net banking",
  WALLET: "Wallet",
  ONLINE: "Online",
  OTHER: "Other",
}

export function receiptData(p: ReceiptPayment, academy: Settings["academy"]) {
  return {
    receiptNumber: p.receiptNumber,
    issuedAt: p.verifiedAt ?? p.paymentDate,
    academy,
    student: p.student,
    payment: {
      id: p.id,
      code: p.code,
      amount: p.amount,
      currency: p.currency,
      method: METHOD_LABEL[p.method] ?? p.method,
      source: p.source,
      paymentDate: p.paymentDate,
      transactionReference: p.transactionReference,
      status: p.status,
      voidReason: p.voidReason,
    },
    items: p.allocations,
    unallocatedAmount: p.unallocatedAmount,
    recordedBy: p.recordedBy,
  }
}

export function renderReceiptPdf(p: ReceiptPayment, academy: Settings["academy"]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A5", margin: 36, info: { Title: `Receipt ${p.receiptNumber}` } })
    const chunks: Buffer[] = []
    doc.on("data", (c: Buffer) => chunks.push(c))
    doc.on("end", () => resolve(Buffer.concat(chunks)))
    doc.on("error", reject)

    const left = doc.page.margins.left
    const width = doc.page.width - left - doc.page.margins.right

    doc.font("Helvetica-Bold").fontSize(15).fillColor("#0f172a").text(academy.name)
    doc.font("Helvetica").fontSize(8.5).fillColor("#64748b")
    if (academy.address) doc.text(academy.address)
    if (academy.phone) doc.text(academy.phone)
    doc.moveDown(0.8)

    doc.font("Helvetica-Bold").fontSize(11).fillColor("#2563eb").text("PAYMENT RECEIPT")
    doc.font("Helvetica").fontSize(9).fillColor("#0f172a")
    doc.text(`Receipt no: ${p.receiptNumber}`)
    doc.text(`Date: ${date(p.paymentDate)}`)
    doc.moveDown(0.6)

    const row = (label: string, value: string) => {
      const y = doc.y
      doc.fillColor("#64748b").text(label, left, y, { width: width * 0.4 })
      doc.fillColor("#0f172a").text(value, left + width * 0.4, y, { width: width * 0.6 })
      doc.moveDown(0.2)
    }
    row("Student", `${p.student.name} (${p.student.code})`)
    row("Payment method", METHOD_LABEL[p.method] ?? p.method)
    if (p.transactionReference) row("Transaction ref.", p.transactionReference)
    row("Payment id", p.code)
    doc.moveDown(0.6)

    doc.font("Helvetica-Bold").fillColor("#0f172a").text("Applied to", left)
    doc.font("Helvetica").moveDown(0.3)
    if (p.allocations.length === 0) doc.fillColor("#64748b").text("Held as advance credit")
    for (const a of p.allocations) {
      const y = doc.y
      doc.fillColor("#0f172a").text(a.description, left, y, { width: width * 0.7 })
      doc.text(money(a.amount), left + width * 0.7, y, { width: width * 0.3, align: "right" })
      doc.moveDown(0.2)
    }
    if (p.unallocatedAmount > 0 && p.allocations.length) {
      const y = doc.y
      doc.fillColor("#64748b").text("Advance credit", left, y, { width: width * 0.7 })
      doc.text(money(p.unallocatedAmount), left + width * 0.7, y, { width: width * 0.3, align: "right" })
    }
    doc.moveDown(0.4)
    doc.moveTo(left, doc.y).lineTo(left + width, doc.y).strokeColor("#e2e8f0").stroke()
    doc.moveDown(0.4)
    const y = doc.y
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#0f172a").text("Total paid", left, y)
    doc.text(money(p.amount), left, y, { width, align: "right" })

    if (p.status === "VOIDED") {
      doc.moveDown(1)
      doc.font("Helvetica-Bold").fontSize(14).fillColor("#dc2626").text("VOID", { align: "center" })
      if (p.voidReason) doc.font("Helvetica").fontSize(8).text(p.voidReason, { align: "center" })
    }

    doc.font("Helvetica").fontSize(7.5).fillColor("#94a3b8")
    doc.text(
      p.source === "ONLINE"
        ? "Online payment verified with the payment gateway. This is a computer-generated receipt."
        : `Recorded by ${p.recordedBy ?? "the academy"}. This is a computer-generated receipt.`,
      left,
      doc.page.height - doc.page.margins.bottom - 20,
      { width, align: "center" },
    )
    doc.end()
  })
}
