-- AlterTable
ALTER TABLE "StudyLogEntry" ADD COLUMN     "taskId" TEXT;

-- CreateIndex
CREATE INDEX "StudyLogEntry_taskId_idx" ON "StudyLogEntry"("taskId");

-- AddForeignKey
ALTER TABLE "StudyLogEntry" ADD CONSTRAINT "StudyLogEntry_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "PlanTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;
