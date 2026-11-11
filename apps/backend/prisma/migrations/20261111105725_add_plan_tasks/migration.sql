-- AlterTable
ALTER TABLE "Reading" ADD COLUMN     "phaseBand" INTEGER,
ADD COLUMN     "prereqRefs" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "priorityRank" INTEGER;

-- AlterTable
ALTER TABLE "StudyPlan" ADD COLUMN     "orderingStrategy" TEXT NOT NULL DEFAULT 'curriculum';

-- CreateTable
CREATE TABLE "PlanTask" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "order" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "resourceId" TEXT,
    "readingIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "estimatedMinutes" INTEGER NOT NULL,
    "actualMinutes" INTEGER,
    "timerStartedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "splitOf" TEXT,
    "splitIndex" INTEGER,
    "splitCount" INTEGER,
    "requiresConfidence" BOOLEAN NOT NULL DEFAULT false,
    "questionTarget" INTEGER,
    "vignetteFrom" INTEGER,
    "vignetteTo" INTEGER,
    "mode" TEXT,
    "frozen" BOOLEAN NOT NULL DEFAULT false,
    "logEntryId" TEXT,
    "insertedBecause" TEXT,

    CONSTRAINT "PlanTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlanTask_planId_date_idx" ON "PlanTask"("planId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "PlanTask_planId_date_order_key" ON "PlanTask"("planId", "date", "order");

-- AddForeignKey
ALTER TABLE "PlanTask" ADD CONSTRAINT "PlanTask_planId_fkey" FOREIGN KEY ("planId") REFERENCES "StudyPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
