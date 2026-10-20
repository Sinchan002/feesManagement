// Shapes returned by the backend API (amounts are in rupees).

export type Role = "ADMIN" | "STUDENT"
export type AccountStatus = "PENDING" | "ACTIVE" | "DEACTIVATED" | "REJECTED"
export type BatchStatus = "ACTIVE" | "PAUSED" | "ARCHIVED"
export type FeeStatus = "PAID" | "DUE" | "OVERDUE"
export type PaymentMethod =
  | "CASH"
  | "UPI"
  | "BANK_TRANSFER"
  | "CHEQUE"
  | "CARD"
  | "NET_BANKING"
  | "WALLET"
  | "ONLINE"
  | "OTHER"

export type PageMeta = { total: number; page: number; pageSize: number; totalPages: number }

export type CurrentUser = {
  id: string
  email: string
  name: string
  phone: string | null
  role: Role
  status: AccountStatus
  lastLoginAt: string | null
  redirectTo: "/admin" | "/student" | "/pending"
  registration: {
    code: string
    schoolClass: string
    requestedSubjects: string[]
    preferredBatch: string | null
    notes: string | null
    submittedAt: string
  } | null
  student: {
    id: string
    code: string
    schoolClass: string
    status: "ACTIVE" | "INACTIVE"
    batch: { id: string; code: string; name: string } | null
  } | null
}

export type PublicBatch = {
  id: string
  code: string
  name: string
  classLevel: string
  subjects: string[]
  schedule: string
  time: string
  monthlyFee: number
  capacity: number
  seatsLeft: number
  hasSeats: boolean
}

export type Batch = {
  id: string
  code: string
  name: string
  classLevel: string
  subjects: string[]
  schedule: string
  startTime: string
  endTime: string | null
  time: string
  capacity: number
  students: number
  seatsAvailable: number
  monthlyFee: number
  status: BatchStatus
  createdAt: string
}

export type BatchDetail = Batch & {
  roster: { studentId: string; code: string; name: string; email: string; phone: string | null; status: string; enrolledAt: string }[]
  feeHistory: { oldFee: number | null; newFee: number; changedBy: string | null; changedAt: string }[]
}

export type Registration = {
  id: string
  code: string
  /** NEW = applicant; REALLOCATION = existing student whose batch was deleted. */
  kind: "NEW" | "REALLOCATION"
  studentCode: string | null
  name: string
  email: string
  phone: string
  schoolClass: string
  requestedSubjects: string[]
  preferredBatch: { id: string; code: string; name: string } | null
  notes: string | null
  status: "PENDING" | "APPROVED" | "REJECTED"
  assignedBatch: { id: string; code: string; name: string } | null
  reviewedBy: string | null
  reviewedAt: string | null
  reviewNote: string | null
  submittedAt: string
}

export type Student = {
  id: string
  code: string
  userId: string
  name: string
  initials: string
  email: string
  phone: string | null
  schoolClass: string
  subjects: string[]
  address: string | null
  notes: string | null
  parent: { name: string | null; relation: string | null; email: string | null; phone: string | null }
  batch: {
    id: string
    code: string
    name: string
    schedule: string
    time: string
    monthlyFee: number
    status: BatchStatus
    enrolledAt: string
  } | null
  status: "ACTIVE" | "INACTIVE"
  accountStatus: AccountStatus
  lastLoginAt: string | null
  joinedAt: string
  outstanding: number
  overdue: number
  feeStatus: FeeStatus
}

export type Enrollment = {
  id: string
  /** id/code are null when the batch has since been deleted; the name is kept. */
  batch: { id: string | null; code: string | null; name: string; deleted: boolean }
  startedAt: string
  endedAt: string | null
  active: boolean
  reason: string | null
  endReason: string | null
  changedBy: string | null
}

export type Charge = {
  id: string
  code: string
  studentId: string
  student?: { id: string; code: string; name: string }
  type: "MONTHLY" | "ADMISSION" | "OTHER"
  billingPeriod: string | null
  periodLabel: string | null
  description: string
  batchName: string | null
  amount: number
  adjustmentTotal: number
  netAmount: number
  paidAmount: number
  outstanding: number
  dueDate: string
  status: "PENDING" | "PARTIALLY_PAID" | "PAID" | "VOID"
  isOverdue: boolean
  voidReason: string | null
  adjustments?: { id: string; amount: number; reason: string; createdBy: string | null; createdAt: string }[]
}

export type Payment = {
  id: string
  code: string
  receiptNumber: string | null
  studentId: string
  student: { id: string; code: string; name: string }
  amount: number
  allocatedAmount: number
  unallocatedAmount: number
  currency: string
  source: "MANUAL" | "ONLINE"
  method: PaymentMethod
  status: "CREATED" | "SUCCEEDED" | "FAILED" | "VOIDED"
  paymentDate: string | null
  periods: string[]
  transactionReference: string | null
  notes: string | null
  recordedBy: string | null
  verifiedVia: string | null
  voidReason: string | null
  createdAt: string
  allocations: { chargeId: string; chargeCode: string; description: string; billingPeriod: string | null; amount: number }[]
}

export type StudentDetail = Student & { enrollments: Enrollment[]; charges: Charge[]; payments: Payment[] }

export type AuditEntry = {
  id: string
  action: string
  entityType: string
  entityId: string | null
  summary: string
  actor: string | null
  actorRole: string | null
  ip: string | null
  createdAt: string
}

export type DashboardReport = {
  period: string
  periodLabel: string
  metrics: {
    collectedThisMonth: number
    collectedChangePct: number | null
    outstandingFees: number
    studentsWithDues: number
    activeStudents: number
    newStudentsThisMonth: number
    collectionRate: number | null
    collectionRateChange: number | null
    pendingRegistrations: number
  }
  trend: { period: string; month: string; collected: number; due: number }[]
  latestPayments: Payment[]
  recentActivity: { id: string; action: string; summary: string; actor: string | null; actorRole: string | null; createdAt: string }[]
}

export type CollectionsReport = {
  period: string
  periodLabel: string
  billed: number
  collectedAgainstBilling: number
  outstanding: number
  collectionRate: number | null
  receivedInMonth: { total: number; online: number; manual: number }
  studentStatus: { paid: number; due: number }
  byMethod: { method: PaymentMethod; amount: number; count: number }[]
  byBatch: {
    batchId: string
    code: string
    name: string
    students: number
    monthlyFee: number
    billed: number
    collected: number
    outstanding: number
    collectionRate: number | null
  }[]
}

export type Settings = {
  academy: { name: string; teacherName: string; address: string; phone: string }
  billing: { dueDay: number; autoGenerateCharges: boolean }
  reminders: {
    enabled: boolean
    dayOfMonth: number
    time: string
    replyTo: string
    gracePeriodDays: number
    notifyParents: boolean
  }
  notifications: { sendPaymentReceipts: boolean }
  paymentMethods: { upi: boolean; card: boolean; netBanking: boolean; cash: boolean }
}

export type SettingsHealth = {
  emailProvider: "CONNECTED" | "CONSOLE_ONLY"
  paymentGateway: string
  paymentGatewayLive: boolean
  schedulerEnabled: boolean
  lastChargeGeneration: string | null
  lastReminderRun: string | null
}

export type StudentDashboard = {
  profile: Student
  teacher: string
  outstanding: number
  overdue: number
  feeStatus: FeeStatus
  nextDue: Charge | null
  openCharges: Charge[]
  recentPayments: Payment[]
  latestReceiptPaymentId: string | null
  onlinePaymentMethods: Settings["paymentMethods"]
}

export type OnlineOrder = {
  paymentId: string
  code: string
  provider: "razorpay" | "mock"
  keyId: string | null
  orderId: string
  amount: number
  amountInSubunits: number
  currency: string
  description: string
  prefill: { name: string; email: string; contact: string }
}

export type CheckoutResult = {
  razorpay_order_id: string
  razorpay_payment_id: string
  razorpay_signature: string
}
