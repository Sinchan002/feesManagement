-- Batches can now be deleted even when students were in them:
--  * enrollments keep a snapshot of the batch name and lose only the link (SET NULL);
--  * students who were in the batch are queued in Registrations as REALLOCATION requests.

-- CreateEnum
CREATE TYPE "RegistrationKind" AS ENUM ('NEW', 'REALLOCATION');

-- AlterTable
ALTER TABLE "Registration" ADD COLUMN "kind" "RegistrationKind" NOT NULL DEFAULT 'NEW';

-- Enrollment.batchName: add, backfill from the batch, then make it required.
ALTER TABLE "Enrollment" ADD COLUMN "batchName" TEXT;
UPDATE "Enrollment" e SET "batchName" = b."name" FROM "Batch" b WHERE b."id" = e."batchId";
UPDATE "Enrollment" SET "batchName" = 'Unknown batch' WHERE "batchName" IS NULL;
ALTER TABLE "Enrollment" ALTER COLUMN "batchName" SET NOT NULL;

-- Enrollment.batchId becomes optional and is cleared (not cascaded) when the batch is deleted.
ALTER TABLE "Enrollment" DROP CONSTRAINT "Enrollment_batchId_fkey";
ALTER TABLE "Enrollment" ALTER COLUMN "batchId" DROP NOT NULL;
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
