import axios, { AxiosError } from "axios"
import type {
  AuditEntry,
  Batch,
  BatchDetail,
  Charge,
  CheckoutResult,
  CollectionsReport,
  CurrentUser,
  DashboardReport,
  Enrollment,
  OnlineOrder,
  PageMeta,
  Payment,
  PublicBatch,
  Registration,
  Settings,
  SettingsHealth,
  Student,
  StudentDashboard,
  StudentDetail,
  UpiClaim,
  UpiConfig,
} from "./types"

// ───────────── Token storage ─────────────

const TOKEN_KEY = "tuitiondesk_token"

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY) ?? sessionStorage.getItem(TOKEN_KEY),
  /** "Remember me" keeps the token across browser restarts; otherwise it lasts for the tab session. */
  set: (token: string, remember: boolean) => {
    tokenStore.clear()
    ;(remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, token)
  },
  clear: () => {
    localStorage.removeItem(TOKEN_KEY)
    sessionStorage.removeItem(TOKEN_KEY)
  },
}

// ───────────── HTTP client ─────────────

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public fields?: { field: string; message: string }[],
  ) {
    super(message)
  }
}

export const http = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "/api",
  timeout: 20000,
  headers: { "Content-Type": "application/json" },
})

http.interceptors.request.use((config) => {
  const token = tokenStore.get()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

type ErrorBody = { message?: string; code?: string; details?: { fields?: { field: string; message: string }[] } }

/** Lets the auth layer react to an expired session / pending account from anywhere. */
let authFailureHandler: ((error: ApiError) => void) | null = null
export const onAuthFailure = (fn: (error: ApiError) => void) => {
  authFailureHandler = fn
}

http.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ErrorBody | Blob>) => {
    let body = error.response?.data
    if (body instanceof Blob) {
      try {
        body = JSON.parse(await body.text()) as ErrorBody
      } catch {
        body = undefined
      }
    }
    const status = error.response?.status ?? 0
    const b = body as ErrorBody | undefined
    const apiError = new ApiError(
      b?.message ||
        (status === 0
          ? "Cannot reach the server. Check that the backend is running."
          : "Something went wrong. Please try again."),
      status,
      b?.code,
      b?.details?.fields,
    )
    const isAuthCall = /\/auth\/(login|register|forgot-password|reset-password)$/.test(error.config?.url ?? "")
    if (!isAuthCall && (status === 401 || apiError.code === "APPROVAL_PENDING")) authFailureHandler?.(apiError)
    return Promise.reject(apiError)
  },
)

type Envelope<T> = { data: T; meta?: PageMeta & Record<string, unknown>; message?: string }
type Paged<T> = { items: T; meta: PageMeta & Record<string, unknown> }

const get = async <T>(url: string, params?: object) => (await http.get<Envelope<T>>(url, { params })).data.data
const getPaged = async <T>(url: string, params?: object): Promise<Paged<T>> => {
  const res = (await http.get<Envelope<T>>(url, { params })).data
  return { items: res.data, meta: res.meta! }
}
const post = async <T>(url: string, body?: object, headers?: Record<string, string>) =>
  (await http.post<Envelope<T>>(url, body ?? {}, { headers })).data.data
const patch = async <T>(url: string, body: object) => (await http.patch<Envelope<T>>(url, body)).data.data
const put = async <T>(url: string, body: object) => (await http.put<Envelope<T>>(url, body)).data.data
const del = async <T>(url: string, body?: object) => (await http.delete<Envelope<T>>(url, { data: body })).data.data

/** Download an authenticated file (PDF / CSV) and save it in the browser. */
export async function downloadFile(url: string, fallbackName: string, params?: object) {
  const res = await http.get<Blob>(url, { params, responseType: "blob" })
  const disposition = String(res.headers["content-disposition"] ?? "")
  const name = /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? fallbackName
  const href = URL.createObjectURL(res.data)
  const a = document.createElement("a")
  a.href = href
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(href), 1000)
}

const clean = (params: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== "" && v !== null))

// ───────────── Endpoints ─────────────

export type RegisterInput = {
  name: string
  email: string
  phone: string
  schoolClass: string
  requestedSubjects: string[]
  preferredBatchId?: string | null
  notes?: string
  password: string
}

export const authApi = {
  login: (email: string, password: string, remember: boolean) =>
    post<{ token: string; expiresAt: string; user: CurrentUser }>("/auth/login", { email, password, remember }),
  register: (input: RegisterInput) => post<{ id: string; code: string; status: string }>("/auth/register", input),
  me: () => get<CurrentUser>("/auth/me"),
  logout: () => post<{ success: boolean }>("/auth/logout"),
  forgotPassword: (email: string) => post<{ success: boolean }>("/auth/forgot-password", { email }),
  resetPassword: (token: string, password: string) => post<{ success: boolean }>("/auth/reset-password", { token, password }),
  changePassword: (currentPassword: string, newPassword: string) =>
    post<{ success: boolean }>("/auth/change-password", { currentPassword, newPassword }),
}

export type BatchInput = {
  name: string
  classLevel: string
  subjects: string[]
  schedule: string
  startTime: string
  endTime: string
  capacity: number
  monthlyFee: number
  status: Batch["status"]
}

export const batchesApi = {
  publicList: () => get<PublicBatch[]>("/public/batches"),
  list: (params: { status?: string; search?: string } = {}) => get<Batch[]>("/batches", clean(params)),
  get: (id: string) => get<BatchDetail>(`/batches/${id}`),
  create: (input: BatchInput) => post<Batch>("/batches", input),
  update: (id: string, input: Partial<BatchInput>) => patch<Batch>(`/batches/${id}`, input),
  remove: (id: string) => del<{ id: string; studentsMoved: number }>(`/batches/${id}`),
}

export const registrationsApi = {
  list: (params: { status?: string; search?: string; page?: number; pageSize?: number } = {}) =>
    getPaged<Registration[]>("/registrations", clean(params)),
  /** `firstCharge` is this month's fee when the student was placed before the 15th, else null. */
  approve: (id: string, batchId: string, note?: string) =>
    post<Registration & { firstCharge: { amount: number; billingPeriod: string | null; dueDate: string } | null }>(
      `/registrations/${id}/approve`,
      { batchId, note },
    ),
  decline: (id: string, reason?: string) => post<{ id: string; deleted: boolean }>(`/registrations/${id}/reject`, { reason }),
}

export type StudentInput = {
  name: string
  email: string
  phone: string
  schoolClass: string
  subjects: string[]
  address?: string
  notes?: string
  batchId?: string | null
  parentName?: string
  parentRelation?: string
  parentEmail?: string
  parentPhone?: string
}

export const studentsApi = {
  list: (params: { search?: string; batchId?: string; status?: string; feeStatus?: string; page?: number; pageSize?: number } = {}) =>
    getPaged<Student[]>("/students", clean(params)),
  get: (id: string) => get<StudentDetail>(`/students/${id}`),
  create: (input: StudentInput) => post<Student>("/students", input),
  update: (id: string, input: Partial<StudentInput>) => patch<Student>(`/students/${id}`, input),
  setStatus: (id: string, status: "ACTIVE" | "INACTIVE", reason?: string) =>
    patch<Student>(`/students/${id}/status`, { status, reason }),
  changeBatch: (id: string, batchId: string, reason?: string) => post<Student>(`/students/${id}/batch`, { batchId, reason }),
  sendPasswordLink: (id: string) => post<{ success: boolean }>(`/students/${id}/send-password-link`),
  remove: (id: string) => del<{ id: string }>(`/students/${id}`),
}

export const feesApi = {
  charges: (params: { studentId?: string; status?: string; period?: string; page?: number; pageSize?: number } = {}) =>
    getPaged<Charge[]>("/fees/charges", clean(params)),
  generate: (period: string, batchId?: string) =>
    post<{ period: string; created: number; alreadyBilled: number; skippedZeroFee: number }>("/fees/charges/generate", clean({ period, batchId })),
  generationStatus: () => get<{ period: string; pendingStudents: number }>("/fees/charges/generation-status"),
  adjust: (chargeId: string, amount: number, reason: string) => post<Charge>(`/fees/charges/${chargeId}/adjustments`, { amount, reason }),
  void: (chargeId: string, reason: string) => post<Charge>(`/fees/charges/${chargeId}/void`, { reason }),
  sendReminders: () => post<{ studentsNotified: number; parentsNotified: number }>("/fees/reminders/send"),
}

export type ManualPaymentInput = {
  studentId: string
  amount: number
  method: string
  paymentDate?: string
  transactionReference?: string
  notes?: string
  allocations?: { chargeId: string; amount: number }[]
}

export const paymentsApi = {
  list: (params: { search?: string; source?: string; method?: string; status?: string; from?: string; to?: string; page?: number; pageSize?: number } = {}) =>
    getPaged<Payment[]>("/payments", clean(params)),
  recordManual: (input: ManualPaymentInput, idempotencyKey: string) =>
    post<Payment>("/payments/manual", input, { "Idempotency-Key": idempotencyKey }),
  void: (id: string, reason: string) => post<Payment>(`/payments/${id}/void`, { reason }),
  exportCsv: (params: object = {}) => downloadFile("/payments/export.csv", "payments.csv", clean(params as Record<string, unknown>)),
  receiptPdf: (id: string) => downloadFile(`/payments/${id}/receipt.pdf`, "receipt.pdf"),
  onlineConfig: () => get<{ provider: string; keyId: string | null; methods: Settings["paymentMethods"] }>("/payments/online/config"),
  createOrder: (chargeIds?: string[]) => post<OnlineOrder>("/payments/online/orders", chargeIds ? { chargeIds } : {}),
  verify: (result: CheckoutResult) => post<Payment>("/payments/online/verify", result),
  mockCheckout: (orderId: string, outcome: "success" | "failure") =>
    post<CheckoutResult>("/payments/online/mock-checkout", { orderId, outcome }),
}

export const reportsApi = {
  dashboard: (month?: string) => get<DashboardReport>("/reports/dashboard", clean({ month })),
  collections: (month?: string, batchId?: string) => get<CollectionsReport>("/reports/collections", clean({ month, batchId })),
  exportCsv: (month?: string, batchId?: string) => downloadFile("/reports/collections.csv", "fees.csv", clean({ month, batchId })),
}

export const auditApi = {
  list: (params: { search?: string; action?: string; from?: string; to?: string; page?: number; pageSize?: number } = {}) =>
    getPaged<AuditEntry[]>("/audit-logs", clean(params)),
  exportCsv: (params: object = {}) => downloadFile("/audit-logs/export.csv", "audit-log.csv", clean(params as Record<string, unknown>)),
}

export const settingsApi = {
  get: () => get<Settings>("/settings"),
  update: (patchBody: Partial<{ [K in keyof Settings]: Partial<Settings[K]> }>) => patch<Settings>("/settings", patchBody),
  health: () => get<SettingsHealth>("/settings/health"),
}

export type ProfileInput = {
  phone?: string
  address?: string
  parentName?: string
  parentRelation?: string
  parentEmail?: string
  parentPhone?: string
}

export const meApi = {
  dashboard: () => get<StudentDashboard>("/me/dashboard"),
  updateProfile: (input: ProfileInput) => patch<Student>("/me/profile", input),
  payments: () => get<Payment[]>("/me/payments"),
  charges: (status: "OPEN" | "PAID" | "ALL" = "ALL") => get<Charge[]>("/me/charges", { status }),
  enrollments: () => get<Enrollment[]>("/me/enrollments"),
}

export const upiApi = {
  /** Teacher's UPI ID, payee name and QR image (students read it to pay). */
  config: () => get<UpiConfig>("/upi/config"),
  saveDetails: (input: { upiId: string; payeeName: string }) => put<UpiConfig>("/upi/config", input),
  uploadQr: async (file: Blob) =>
    (await http.put<Envelope<UpiConfig>>("/upi/qr", file, { headers: { "Content-Type": file.type } })).data.data,
  removeQr: () => del<UpiConfig>("/upi/qr"),
  /** Student: report a UPI payment for the chosen fees. The server works out the amount. */
  submitClaim: (input: { chargeIds: string[]; transactionReference: string; paymentDate?: string; notes?: string }) =>
    post<UpiClaim>("/upi/claims", input),
  myClaims: () => get<UpiClaim[]>("/upi/claims/mine"),
  /** Teacher: claims waiting for verification (or "ALL"). */
  claims: async (status: "PENDING" | "APPROVED" | "REJECTED" | "ALL" = "PENDING") => {
    const res = (await http.get<Envelope<UpiClaim[]>>("/upi/claims", { params: { status } })).data
    return { items: res.data, pendingCount: Number(res.meta?.pendingCount ?? 0) }
  },
  approve: (id: string, input: { chargeIds?: string[]; amount?: number; note?: string }) =>
    post<UpiClaim>(`/upi/claims/${id}/approve`, input),
  reject: (id: string, reason: string) => post<UpiClaim>(`/upi/claims/${id}/reject`, { reason }),
}
