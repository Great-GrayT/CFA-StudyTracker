-- AlterTable
ALTER TABLE "StudyLogEntry" ADD COLUMN     "declaredWatched" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "StudyPlan" ADD COLUMN     "priorWork" JSONB;

-- The official curriculum as a declarable source. Not yet in the catalogue,
-- so it has no editions; seeding it later under this slug fills it in.
INSERT INTO "StudyPackage" ("id", "name", "slug", "userId")
VALUES ('cfai-curriculum', 'CFA Institute curriculum', 'cfai-curriculum', NULL)
ON CONFLICT ("slug") DO NOTHING;
