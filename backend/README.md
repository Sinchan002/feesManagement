# Tuition Fees Management — Backend API

Express 5 + TypeScript + Prisma + PostgreSQL API for the SriKrishna Physics Academy frontend (`../frontend`).

## Quick start

```bash
cd backend
cp .env.example .env          # then edit ADMIN_PASSWORD at least
docker compose up -d          # PostgreSQL 16 on localhost:5433 (+ a tuition_test DB for tests)
npm install
npm run db:deploy             # apply migrations
npm run db:seed               # creates the teacher account from .env (no demo data)
npm run dev                   # http://localhost:4000/api
```

Run the tests (uses the separate `tuition_test` database): `npm test`

Postgres is mapped to **5433** because this machine already has a native PostgreSQL on 5432.

### Connecting the frontend

The frontend is wired to this API. Its Vite dev server proxies `/api` to `http://localhost:4000`
(override with `API_PROXY_TARGET`), so run both: `npm run dev` here and `npm run dev` in `../frontend`,
then open http://localhost:8443.

## Conventions

- **Responses**: `{ data, meta? }`. Lists include `meta: { total, page, pageSize, totalPages }` (`?page=&pageSize=`).
- **Errors**: `{ message, code, details? }`. The frontend interceptor already reads `response.data.message`.
  Validation errors include `details.fields: [{ field, message }]`.
- **Money**: the API speaks **rupees** (e.g. `3200`, `1499.50`); the database stores integer paise.
- **Enums** are uppercase: batch status `ACTIVE | PAUSED | ARCHIVED` (input is case-insensitive, so `"Active"` works).
- **Field aliases** for the existing forms: register accepts `className`/`preferenceNote`; batches accept `time`/`fee`.

## Roles & security model

| Role | Can do |
|---|---|
| `ADMIN` (teacher) | Everything: registrations, batches, students, fees, payments, reports, audit log, settings |
| `STUDENT` | Only `/api/me/*`, their own charges/payments/receipts, and online payment of their own fees |

- Opaque bearer tokens (32 random bytes). Only a SHA-256 hash is stored; logout revokes the session server-side.
- Every request re-checks the account status, so **deactivating a student cuts off existing sessions immediately**.
- Roles are enforced by `requireRole` middleware on each router. Resource-level checks (`assertCanAccessStudent`)
  guard shared endpoints. `/me/*` routes take the student id from the session, never from the request.
  Requests for another student's record return 404, so ids can't be probed.
- Passwords use bcrypt (cost 12). Login and reset responses don't reveal whether an email exists.
  Reset tokens are single-use, expire in 30 minutes, and revoke all sessions when used.
- Rate limits on login, registration, password reset and payment endpoints. Helmet headers, CORS allow-list,
  100 kB body limit.
- Every state-changing action is written to the audit log in the same transaction as the change.

## Financial integrity rules

1. **Charge amounts are immutable.** `FeeCharge.amount`, period, description and due date never change after creation.
   This is enforced by app code *and* a database trigger.
2. **Batch fee changes apply to future charges only.** Each change is logged in `BatchFeeChange`. To change an
   existing charge, the teacher adds a documented `FeeAdjustment` (signed amount + mandatory reason).
3. **No double billing.** Monthly generation is idempotent (unique `MONTHLY:<student>:<YYYY-MM>` key).
4. **No over-allocation.** Charge rows are locked (`SELECT … FOR UPDATE`) while payments are applied. Allocation
   can't exceed what's outstanding, and `(paymentId, chargeId)` is unique.
5. **Online payments are never trusted from the browser.** A payment becomes `SUCCEEDED` only after the HMAC
   signature is valid **and** the gateway API confirms the payment is `captured` for that exact order, amount
   and currency. A signed webhook can also settle it. Both paths go through one idempotent `finalizeOnlinePayment`.
6. **Webhooks are idempotent.** Signatures are checked against the raw body. Each event id is stored once, and
   redeliveries are acknowledged without reprocessing. Unique `providerPaymentId` / `providerOrderId` prevent
   duplicate payment records.
7. **Nothing financial is deleted.** Manual payments entered in error are *voided* (kept, marked `VOIDED`, charges
   re-opened). Students with fee or payment history can only be deactivated, not deleted.

## API reference (all under `/api`)

### Auth
| Method | Path | Who | Notes |
|---|---|---|---|
| POST | `/auth/register` | public | name, email, phone, schoolClass (or className), requestedSubjects[], preferredBatchId?, notes (or preferenceNote), password → pending registration |
| POST | `/auth/login` | public | `{ email, password, remember? }` → `{ token, expiresAt, user }`. A **pending** applicant can sign in (`user.redirectTo = "/pending"`) but every route except `/auth/me` and logout answers `403 APPROVAL_PENDING`. Deactivated accounts get 403 |
| POST | `/auth/logout` · `/auth/logout-all` | any | revoke this / every session |
| GET | `/auth/me` | any | user, role, `redirectTo`, student summary |
| POST | `/auth/forgot-password` | public | always 200; emails a reset link (`APP_URL/reset-password?token=…`) |
| POST | `/auth/reset-password` | public | `{ token, password }` |
| POST | `/auth/change-password` | any | `{ currentPassword, newPassword }` |

Password rule: 8–72 characters with at least one letter and one number.

### Registrations (admin)
`GET /registrations?status=PENDING|APPROVED|REJECTED|ALL&search=` (meta includes `pendingCount`) ·
`GET /registrations/:id` · `POST /registrations/:id/approve { batchId, note? }` (activates or creates the account,
creates the student profile, allocates the batch, and emails the student) · `POST /registrations/:id/reject { reason? }`
(**permanently deletes** the applicant's account, sessions, registration rows and audit entries naming them; one
anonymised audit line is kept, and the applicant is emailed and may register again)

### Batches
`GET /public/batches` (public, active only — for the registration form) ·
admin: `GET /batches?status=&search=` · `GET /batches/:id` (roster + fee history) · `POST /batches` ·
`PATCH /batches/:id` · `DELETE /batches/:id` (permanent; students are never deleted — current ones are moved to Registrations as
`REALLOCATION` requests to get a new batch, their history keeps the batch name, and fee records are untouched)

### Students (admin)
`GET /students?search=&batchId=&status=ACTIVE|INACTIVE|ALL&feeStatus=PAID|DUE|OVERDUE&unassigned=true` ·
`POST /students` (teacher adds directly; a set-password link is emailed) · `GET /students/:id` (profile +
enrollment history + charges + payments) · `PATCH /students/:id` · `PATCH /students/:id/status { status: ACTIVE|INACTIVE, reason? }` ·
`POST /students/:id/batch { batchId, reason? }` (change batch; history kept) · `DELETE /students/:id/batch { reason }` ·
`GET /students/:id/enrollments` · `POST /students/:id/send-password-link` · `DELETE /students/:id`

### Fees
admin: `GET /fees/charges?studentId=&batchId=&period=YYYY-MM&status=OPEN|OVERDUE|PENDING|PARTIALLY_PAID|PAID|VOID` ·
`POST /fees/charges` (one-off or a single monthly charge) · `POST /fees/charges/generate { period, batchId?, dueDate? }` ·
`POST /fees/charges/:id/adjustments { amount (signed ₹), reason }` · `POST /fees/charges/:id/void { reason }` ·
`POST /fees/reminders/send` — admin or owner: `GET /fees/charges/:id`

### Payments
admin: `GET /payments?search=&studentId=&batchId=&source=&method=&status=&from=&to=` · `GET /payments/export.csv` ·
`POST /payments/manual { studentId, amount, method: CASH|UPI|BANK_TRANSFER|CHEQUE|CARD|NET_BANKING|OTHER, paymentDate?, transactionReference?, notes?, allocations?: [{ chargeId, amount }], autoAllocate? }`
(send an `Idempotency-Key` header to make double-submits safe) · `POST /payments/:id/allocations` (apply credit) ·
`POST /payments/:id/void { reason }` · `POST /payments/:id/reconcile` (ask the gateway about an unconfirmed online payment)

student: `GET /payments/online/config` · `POST /payments/online/orders { chargeIds? }` → `{ orderId, keyId, amount, amountInSubunits, currency, prefill }` ·
`POST /payments/online/verify { razorpay_order_id, razorpay_payment_id, razorpay_signature }`

admin or owner: `GET /payments/:id` · `GET /payments/:id/receipt` (JSON) · `GET /payments/:id/receipt.pdf`

Razorpay checkout on the frontend, in outline:
```ts
const { data } = (await api.post("/payments/online/orders", {})).data
new Razorpay({
  key: data.keyId, order_id: data.orderId, amount: data.amountInSubunits, currency: data.currency,
  prefill: data.prefill,
  handler: async (resp) => { await api.post("/payments/online/verify", resp) }, // server decides success
}).open()
```
With `PAYMENT_PROVIDER=mock` (development only), call `POST /payments/online/mock-checkout { orderId, outcome }`
in place of the Razorpay widget, then `verify` with its response.

### Webhooks
`POST /webhooks/razorpay`: configure this URL in the Razorpay dashboard with `RAZORPAY_WEBHOOK_SECRET`, and enable
`payment.captured`, `payment.failed` and `order.paid`. (`/webhooks/mock` is used in development.)

### Student self-service (`/me`, student only)
`GET /me/dashboard` (profile, batch, next due, open charges, recent payments) · `GET /me/profile` ·
`PATCH /me/profile` (phone, address, parent details) · `GET /me/batch` · `GET /me/enrollments` ·
`GET /me/charges?status=OPEN|PAID|ALL` · `GET /me/payments`

### Reports, audit, settings (admin)
`GET /reports/dashboard?month=` (metric cards, 6-month trend, latest payments, recent activity) ·
`GET /reports/collections?month=&batchId=` (billed vs collected, by batch, by method) · `GET /reports/collections.csv` ·
`GET /audit-logs?search=&action=&entityType=&actorRole=&from=&to=` · `GET /audit-logs/export.csv` ·
`GET /settings` · `PATCH /settings` (partial; sections `academy`, `billing`, `reminders`, `notifications`, `paymentMethods`) ·
`GET /settings/health`

## Background jobs

When `SCHEDULER_ENABLED=true`, the server checks every 15 minutes and:
- generates the current month's charges once per month (if `billing.autoGenerateCharges`);
- sends fee-reminder emails to students (and parents, if enabled) once per month, on or after `reminders.dayOfMonth` at `reminders.time` (server local time).

A Postgres advisory lock ensures only one instance runs each job.

## Going to production

- `NODE_ENV=production`, `PAYMENT_PROVIDER=razorpay` with live keys (the mock provider refuses to start in production).
- Configure SMTP. Without it, emails are only logged to the console.
- Serve over HTTPS behind a proxy and set `TRUST_PROXY=true` so rate limits see client IPs.
- `npm run build && npm run db:deploy && npm start`.
