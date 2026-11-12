-- AlterTable
ALTER TABLE "StudyLogEntry" ADD COLUMN     "selfDeclared" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "StudyPlan" ADD COLUMN     "planMode" TEXT NOT NULL DEFAULT 'curriculum-topic',
ADD COLUMN     "reviewPolicy" TEXT NOT NULL DEFAULT 'decay-triggered',
ADD COLUMN     "reviewStartDate" TIMESTAMP(3),
ADD COLUMN     "tuning" JSONB;
