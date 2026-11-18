-- AlterTable
ALTER TABLE "StepDeclaration" ADD COLUMN "date" TIMESTAMP(3);

-- Existing self-states date from the plan's first day of study, at UTC midnight.
UPDATE "StepDeclaration" d
SET "date" = date_trunc('day', p."startDate")
FROM "StudyPlan" p
WHERE p."id" = d."planId";

ALTER TABLE "StepDeclaration" ALTER COLUMN "date" SET NOT NULL;
