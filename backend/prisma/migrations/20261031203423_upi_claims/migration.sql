-- CreateEnum
CREATE TYPE "UpiClaimStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "UpiClaim" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "transactionReference" TEXT NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "status" "UpiClaimStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "paymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UpiClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UpiClaimItem" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "chargeId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,

    CONSTRAINT "UpiClaimItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UpiClaim_code_key" ON "UpiClaim"("code");

-- CreateIndex
CREATE UNIQUE INDEX "UpiClaim_paymentId_key" ON "UpiClaim"("paymentId");

-- CreateIndex
CREATE INDEX "UpiClaim_status_createdAt_idx" ON "UpiClaim"("status", "createdAt");

-- CreateIndex
CREATE INDEX "UpiClaim_studentId_createdAt_idx" ON "UpiClaim"("studentId", "createdAt");

-- CreateIndex
CREATE INDEX "UpiClaimItem_chargeId_idx" ON "UpiClaimItem"("chargeId");

-- CreateIndex
CREATE UNIQUE INDEX "UpiClaimItem_claimId_chargeId_key" ON "UpiClaimItem"("claimId", "chargeId");

-- AddForeignKey
ALTER TABLE "UpiClaim" ADD CONSTRAINT "UpiClaim_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpiClaim" ADD CONSTRAINT "UpiClaim_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpiClaim" ADD CONSTRAINT "UpiClaim_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpiClaimItem" ADD CONSTRAINT "UpiClaimItem_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "UpiClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpiClaimItem" ADD CONSTRAINT "UpiClaimItem_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "FeeCharge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ───────── Hand-written constraints ─────────

-- A payment reference can back only one live claim (rejected claims free it, so it can be re-entered correctly).
CREATE UNIQUE INDEX "UpiClaim_reference_live_unique"
  ON "UpiClaim" (lower("transactionReference"))
  WHERE "status" IN ('PENDING', 'APPROVED');

ALTER TABLE "UpiClaim" ADD CONSTRAINT "UpiClaim_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "UpiClaimItem" ADD CONSTRAINT "UpiClaimItem_amount_positive" CHECK ("amount" > 0);
