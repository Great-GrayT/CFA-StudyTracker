-- AlterTable
ALTER TABLE "MockExam" ADD COLUMN     "sessionRef" TEXT;

-- AlterTable
ALTER TABLE "PlanTask" ADD COLUMN     "answerReviewDone" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "extraReason" TEXT,
ADD COLUMN     "mockRef" TEXT,
ADD COLUMN     "questionCount" INTEGER,
ADD COLUMN     "resourceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "round" INTEGER,
ADD COLUMN     "step" INTEGER,
ADD COLUMN     "workMinutes" INTEGER;

-- AlterTable
ALTER TABLE "StudyPlan" ADD COLUMN     "belowPassAccepted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "fitReport" JSONB,
ADD COLUMN     "lesReadingHours" INTEGER NOT NULL DEFAULT 200,
ADD COLUMN     "stepPriority" JSONB;

-- CreateTable
CREATE TABLE "MockTopicScore" (
    "id" TEXT NOT NULL,
    "mockExamId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "answered" INTEGER NOT NULL,
    "correct" INTEGER NOT NULL,

    CONSTRAINT "MockTopicScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StepDeclaration" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "readingId" TEXT NOT NULL,
    "step" INTEGER NOT NULL,
    "confidence" INTEGER,
    "answered" INTEGER,
    "correct" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StepDeclaration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MockTopicScore_mockExamId_topicId_key" ON "MockTopicScore"("mockExamId", "topicId");

-- CreateIndex
CREATE UNIQUE INDEX "StepDeclaration_planId_readingId_step_key" ON "StepDeclaration"("planId", "readingId", "step");

-- AddForeignKey
ALTER TABLE "MockTopicScore" ADD CONSTRAINT "MockTopicScore_mockExamId_fkey" FOREIGN KEY ("mockExamId") REFERENCES "MockExam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StepDeclaration" ADD CONSTRAINT "StepDeclaration_planId_fkey" FOREIGN KEY ("planId") REFERENCES "StudyPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
