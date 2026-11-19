-- AlterTable
ALTER TABLE "PlanTask" ADD COLUMN "questionNumbers" INTEGER[] DEFAULT ARRAY[]::INTEGER[];
