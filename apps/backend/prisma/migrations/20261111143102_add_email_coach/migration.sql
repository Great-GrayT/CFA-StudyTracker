-- AlterTable
ALTER TABLE "StudyPlan" ADD COLUMN     "emailCoach" TEXT NOT NULL DEFAULT 'all',
ADD COLUMN     "timeZone" TEXT NOT NULL DEFAULT 'UTC';

-- CreateTable
CREATE TABLE "EmailSend" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "localDate" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailSend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailSend_planId_localDate_idx" ON "EmailSend"("planId", "localDate");

-- CreateIndex
CREATE UNIQUE INDEX "EmailSend_planId_localDate_slot_key" ON "EmailSend"("planId", "localDate", "slot");

-- AddForeignKey
ALTER TABLE "EmailSend" ADD CONSTRAINT "EmailSend_planId_fkey" FOREIGN KEY ("planId") REFERENCES "StudyPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
