import { db } from "../../src/lib/db";

/**
 * Reset the test database by deleting all rows.
 *
 * Requires DATABASE_URL to point at a disposable test database (configured in
 * .env.test), separate from the dev database. Deletes in FK-safe order to avoid
 * constraint violations.
 *
 * The base order from the task is: ProgressSnapshot, StudyLogEntry, StudyPlan,
 * StudyPackage, LOS, Reading, Topic, Level, OAuthAccount, User.
 * This implementation adds MockExam, PlanHoliday, PushSubscription, and PlanPackage
 * in the correct positions to maintain FK safety with the complete schema.
 */
export async function resetDb(): Promise<void> {
  // Delete in FK-safe order: each table after tables that reference it.
  await db.cronRun.deleteMany({});
  await db.progressSnapshot.deleteMany({});
  await db.studyLogEntry.deleteMany({});
  await db.mockExam.deleteMany({});
  await db.planHoliday.deleteMany({});
  await db.planPackage.deleteMany({});
  await db.studyPlan.deleteMany({});
  await db.studyPackage.deleteMany({});
  await db.pushSubscription.deleteMany({});
  await db.lOS.deleteMany({});
  await db.reading.deleteMany({});
  await db.topic.deleteMany({});
  await db.level.deleteMany({});
  await db.oAuthAccount.deleteMany({});
  await db.user.deleteMany({});
}
