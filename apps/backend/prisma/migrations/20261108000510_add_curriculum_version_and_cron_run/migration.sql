-- AlterTable
ALTER TABLE "Level" ADD COLUMN     "version" TEXT NOT NULL DEFAULT 'unknown';

-- CreateTable
CREATE TABLE "CronRun" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "ok" BOOLEAN NOT NULL DEFAULT false,
    "plansProcessed" INTEGER NOT NULL DEFAULT 0,
    "plansFailed" INTEGER NOT NULL DEFAULT 0,
    "plansSkipped" INTEGER NOT NULL DEFAULT 0,
    "triggeredByUserId" TEXT,
    "error" TEXT,

    CONSTRAINT "CronRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CronRun_startedAt_idx" ON "CronRun"("startedAt");
