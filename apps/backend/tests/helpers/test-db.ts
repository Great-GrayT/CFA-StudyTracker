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
 * This implementation adds MockExam, PlanTask, PlanHoliday, PushSubscription, PlanPackage,
 * and EmailSend in the correct positions to maintain FK safety with the complete schema.
 */
export async function resetDb(): Promise<void> {
  // Delete in FK-safe order: each table after tables that reference it.
  await db.passkey.deleteMany({});
  await db.webAuthnChallenge.deleteMany({});
  await db.recoveryCode.deleteMany({});
  await db.passwordResetToken.deleteMany({});
  await db.cronRun.deleteMany({});
  await db.progressSnapshot.deleteMany({});
  await db.studyLogEntry.deleteMany({});
  await db.planTask.deleteMany({});
  await db.mockExam.deleteMany({});
  await db.planHoliday.deleteMany({});
  await db.planPackage.deleteMany({});
  await db.emailSend.deleteMany({});
  await db.studyPlan.deleteMany({});
  await db.packageUnitLos.deleteMany({});
  await db.packageUnitReading.deleteMany({});
  await db.packageResource.deleteMany({});
  await db.packageUnit.deleteMany({});
  await db.packageEdition.deleteMany({});
  await db.studyPackage.deleteMany({});
  await db.pushSubscription.deleteMany({});
  await db.lOS.deleteMany({});
  await db.reading.deleteMany({});
  await db.topic.deleteMany({});
  await db.level.deleteMany({});
  await db.oAuthAccount.deleteMany({});
  await db.user.deleteMany({});
}
