-- Catch-up migration. Everything below was developed with `prisma db push` and
-- so existed only in the dev and test databases; without this file a deploy
-- would bring up the new code against a schema that has none of it.
--
-- All additive except the EmailSend unique key, which gains `channel`. That is
-- safe to widen: the new key is a superset of the old one and `channel` has a
-- default, so no existing row can collide. Prisma wraps the whole file in one
-- transaction, so the index is never actually absent to a concurrent writer.
--
--   EmailSend.channel      email and push are independent deliveries of the
--                          same message, each claiming its own slot atomically
--   EmailSend.dialogueKey  which dialogue a candidate was actually told, and
--                          what lets the post-exam sign-off send only once
--   StudyPlan.pushCoach    per-channel coaching preference
--   StudyPlan location     city-level, user-entered, all nullable
--   WeatherReading         one day's weather per place, cached so the coach
--                          makes at most one upstream call per city per day

-- DropIndex
DROP INDEX "EmailSend_planId_localDate_slot_key";

-- AlterTable
ALTER TABLE "EmailSend" ADD COLUMN     "channel" TEXT NOT NULL DEFAULT 'email',
ADD COLUMN     "dialogueKey" TEXT;

-- AlterTable
ALTER TABLE "StudyPlan" ADD COLUMN     "city" TEXT,
ADD COLUMN     "countryCode" TEXT,
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION,
ADD COLUMN     "pushCoach" TEXT NOT NULL DEFAULT 'all';

-- CreateTable
CREATE TABLE "WeatherReading" (
    "id" TEXT NOT NULL,
    "gridKey" TEXT NOT NULL,
    "localDate" TEXT NOT NULL,
    "weatherCode" INTEGER NOT NULL,
    "tempMaxC" DOUBLE PRECISION NOT NULL,
    "daylightHours" DOUBLE PRECISION NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeatherReading_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WeatherReading_gridKey_localDate_key" ON "WeatherReading"("gridKey", "localDate");

-- CreateIndex
CREATE UNIQUE INDEX "EmailSend_planId_localDate_slot_channel_key" ON "EmailSend"("planId", "localDate", "slot", "channel");

