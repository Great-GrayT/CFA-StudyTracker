import { beforeEach, describe, test, expect } from "vitest";
import { db } from "../../src/lib/db";
import { resetDb } from "../helpers/test-db";
import { registerUser, setupPlanWithCatalogue } from "../helpers/fixtures";
import { POST as DELETE_ACCOUNT } from "../../src/app/api/auth/account/delete/route";
import { generateHorizon } from "../../src/lib/FUNC-schedule";
import { hashPassword } from "../../src/lib/FUNC-crypto";
import { generateSecret } from "../../src/lib/FUNC-totp";
import { generateSync } from "otplib";

const PHRASE = "delete my account";
const PASSWORD = "correct-horse-battery";

function deleteRequest(token: string | null, body: unknown): Request {
  return new Request("http://localhost/api/auth/account/delete", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

/**
 * A registered user who owns a generated plan, a log, a mock exam and a device.
 *
 * The catalogue is seeded once and then shared. setupPlanWithCatalogue
 * hardcodes its package refs and collides with itself on a second call in the
 * same test, so the second user gets a plan of their own on the SAME
 * curriculum. That is the more useful shape anyway: it proves one candidate
 * deleting their account leaves another candidate's data alone even when both
 * read the same material.
 */
let seededPlanId: string | null = null;

async function userWithEverything() {
  const user = await registerUser();
  let planId: string;

  if (seededPlanId === null) {
    const seeded = await setupPlanWithCatalogue();
    seededPlanId = seeded.planId;
    planId = seeded.planId;
    await db.studyPlan.update({ where: { id: planId }, data: { userId: user.id } });
  } else {
    // A second plan on the same curriculum, owned by this user from the start.
    const template = await db.studyPlan.findUniqueOrThrow({ where: { id: seededPlanId } });
    const created = await db.studyPlan.create({
      data: {
        userId: user.id,
        levelId: template.levelId,
        examDate: template.examDate,
        startDate: template.startDate,
        weeklyAvailability: template.weeklyAvailability as object,
      },
    });
    planId = created.id;
  }

  await db.studyPlan.updateMany({ where: {}, data: { isActive: false } });
  await db.studyPlan.update({ where: { id: planId }, data: { isActive: true } });
  await generateHorizon(planId, "2027-01-04");

  const reading = await db.reading.findFirstOrThrow();
  const los =
    (await db.lOS.findFirst({ where: { readingId: reading.id } })) ??
    (await db.lOS.create({
      data: { readingId: reading.id, text: "Outcome", order: 1 },
    }));

  await db.studyLogEntry.create({
    data: {
      userId: user.id,
      planId,
      losId: los.id,
      confidence: 4,
      questionsAnswered: 10,
      questionsCorrect: 7,
    },
  });
  await db.mockExam.create({
    data: { userId: user.id, planId, date: new Date("2027-02-01"), scorePercent: 61 },
  });
  await db.pushSubscription.create({
    data: { userId: user.id, endpoint: `https://push.example/${user.id}`, p256dh: "k1", auth: "k2" },
  });
  await db.progressSnapshot.create({
    data: {
      planId,
      date: new Date("2027-01-05"),
      targetCumulative: 10,
      actualCumulative: 4,
    },
  });
  await db.planHoliday.create({
    data: {
      planId,
      startDate: new Date("2027-02-10"),
      endDate: new Date("2027-02-12"),
    },
  });

  return { user, planId };
}

async function rowsFor(userId: string, planId: string) {
  const [plans, tasks, logs, mocks, pushes, snapshots, holidays, users] = await Promise.all([
    db.studyPlan.count({ where: { userId } }),
    db.planTask.count({ where: { planId } }),
    db.studyLogEntry.count({ where: { userId } }),
    db.mockExam.count({ where: { userId } }),
    db.pushSubscription.count({ where: { userId } }),
    db.progressSnapshot.count({ where: { planId } }),
    db.planHoliday.count({ where: { planId } }),
    db.user.count({ where: { id: userId } }),
  ]);
  return { plans, tasks, logs, mocks, pushes, snapshots, holidays, users };
}

describe("POST /api/auth/account/delete", () => {
  beforeEach(async () => {
    await resetDb();
    seededPlanId = null;
  });

  test("needs a session", async () => {
    const res = await DELETE_ACCOUNT(
      deleteRequest(null, { password: PASSWORD, confirmation: PHRASE }),
    );
    expect(res.status).toBe(401);
  });

  test("the right password and the right phrase erase every trace of the account", async () => {
    const { user, planId } = await userWithEverything();
    const before = await rowsFor(user.id, planId);
    expect(before.plans).toBe(1);
    expect(before.tasks).toBeGreaterThan(0);
    expect(before.logs).toBe(1);
    expect(before.mocks).toBe(1);
    expect(before.pushes).toBe(1);
    expect(before.snapshots).toBe(1);
    expect(before.holidays).toBe(1);

    const res = await DELETE_ACCOUNT(
      deleteRequest(user.token, { password: PASSWORD, confirmation: PHRASE }),
    );
    expect(res.status).toBe(200);

    expect(await rowsFor(user.id, planId)).toEqual({
      plans: 0,
      tasks: 0,
      logs: 0,
      mocks: 0,
      pushes: 0,
      snapshots: 0,
      holidays: 0,
      users: 0,
    });
  });

  test("the email is free to register again afterwards", async () => {
    const { user } = await userWithEverything();
    await DELETE_ACCOUNT(deleteRequest(user.token, { password: PASSWORD, confirmation: PHRASE }));
    expect(await db.user.count({ where: { email: user.email } })).toBe(0);
  });

  test("the session stops working the moment the account is gone", async () => {
    const { user } = await userWithEverything();
    await DELETE_ACCOUNT(deleteRequest(user.token, { password: PASSWORD, confirmation: PHRASE }));
    const again = await DELETE_ACCOUNT(
      deleteRequest(user.token, { password: PASSWORD, confirmation: PHRASE }),
    );
    expect(again.status).toBe(401);
  });

  test("a wrong password deletes nothing", async () => {
    const { user, planId } = await userWithEverything();
    const res = await DELETE_ACCOUNT(
      deleteRequest(user.token, { password: "not-the-password", confirmation: PHRASE }),
    );
    expect(res.status).toBe(400);
    expect((await rowsFor(user.id, planId)).users).toBe(1);
    expect((await rowsFor(user.id, planId)).plans).toBe(1);
  });

  test("the wrong phrase deletes nothing, even with the right password", async () => {
    const { user, planId } = await userWithEverything();
    const res = await DELETE_ACCOUNT(
      deleteRequest(user.token, { password: PASSWORD, confirmation: "delete" }),
    );
    expect(res.status).toBe(400);
    expect((await rowsFor(user.id, planId)).users).toBe(1);
  });

  test("the phrase must match exactly, not merely contain the words", async () => {
    const { user } = await userWithEverything();
    for (const confirmation of [
      "Delete My Account",
      " delete my account",
      "delete my account please",
      "deletemyaccount",
      "",
    ]) {
      const res = await DELETE_ACCOUNT(
        deleteRequest(user.token, { password: PASSWORD, confirmation }),
      );
      expect(res.status, confirmation).toBe(400);
    }
    expect(await db.user.count({ where: { id: user.id } })).toBe(1);
  });

  test("a missing confirmation deletes nothing", async () => {
    const { user } = await userWithEverything();
    const res = await DELETE_ACCOUNT(deleteRequest(user.token, { password: PASSWORD }));
    expect(res.status).toBe(400);
    expect(await db.user.count({ where: { id: user.id } })).toBe(1);
  });

  test("one user deleting their account leaves another user's data untouched", async () => {
    const mine = await userWithEverything();
    const theirs = await userWithEverything();

    await DELETE_ACCOUNT(
      deleteRequest(mine.user.token, { password: PASSWORD, confirmation: PHRASE }),
    );

    const survivors = await rowsFor(theirs.user.id, theirs.planId);
    expect(survivors.users).toBe(1);
    expect(survivors.plans).toBe(1);
    expect(survivors.tasks).toBeGreaterThan(0);
    expect(survivors.logs).toBe(1);
    expect(survivors.mocks).toBe(1);
  });

  test("a two-step account with no password is deleted with a current code", async () => {
    const { user } = await userWithEverything();
    const secret = generateSecret();
    await db.user.update({
      where: { id: user.id },
      data: { passwordHash: null, totpSecret: secret, totpEnabledAt: new Date() },
    });

    const res = await DELETE_ACCOUNT(
      deleteRequest(user.token, {
        totpCode: generateSync({ strategy: "totp", secret }),
        confirmation: PHRASE,
      }),
    );
    expect(res.status).toBe(200);
    expect(await db.user.count({ where: { id: user.id } })).toBe(0);
  });

  test("a two-step account is not deleted by a wrong code", async () => {
    const { user } = await userWithEverything();
    await db.user.update({
      where: { id: user.id },
      data: { passwordHash: null, totpSecret: generateSecret(), totpEnabledAt: new Date() },
    });

    const res = await DELETE_ACCOUNT(
      deleteRequest(user.token, { totpCode: "000000", confirmation: PHRASE }),
    );
    expect(res.status).toBe(400);
    expect(await db.user.count({ where: { id: user.id } })).toBe(1);
  });

  test("a two-step account accepts a recovery code in place of the authenticator", async () => {
    const { user } = await userWithEverything();
    const { hashRecoveryCode } = await import("../../src/lib/FUNC-totp");
    await db.user.update({
      where: { id: user.id },
      data: { passwordHash: null, totpSecret: generateSecret(), totpEnabledAt: new Date() },
    });
    await db.recoveryCode.create({
      data: { userId: user.id, codeHash: hashRecoveryCode("ABCD-EFGH") },
    });

    const res = await DELETE_ACCOUNT(
      deleteRequest(user.token, { recoveryCode: "ABCD-EFGH", confirmation: PHRASE }),
    );
    expect(res.status).toBe(200);
    expect(await db.user.count({ where: { id: user.id } })).toBe(0);
  });

  test("an account with a password ignores a code and still demands the password", async () => {
    // A credential the account does not use must never become a way past the
    // one it does.
    const { user } = await userWithEverything();
    const secret = generateSecret();
    await db.user.update({
      where: { id: user.id },
      data: { totpSecret: secret, totpEnabledAt: new Date() },
    });

    const res = await DELETE_ACCOUNT(
      deleteRequest(user.token, {
        totpCode: generateSync({ strategy: "totp", secret }),
        confirmation: PHRASE,
      }),
    );
    expect(res.status).toBe(400);
    expect(await db.user.count({ where: { id: user.id } })).toBe(1);
  });

  test("an account with neither a password nor two-step is deleted on the phrase alone", async () => {
    // An OAuth-only account with no second factor has no credential to
    // re-verify. Refusing would trap it forever; the session is the only proof
    // that exists, and it is the same proof that signed them in.
    const { user } = await userWithEverything();
    await db.user.update({ where: { id: user.id }, data: { passwordHash: null } });
    await db.oAuthAccount.create({
      data: { userId: user.id, provider: "google", providerAccountId: "g-1" },
    });

    const res = await DELETE_ACCOUNT(deleteRequest(user.token, { confirmation: PHRASE }));
    expect(res.status).toBe(200);
    expect(await db.user.count({ where: { id: user.id } })).toBe(0);
    expect(await db.oAuthAccount.count({ where: { userId: user.id } })).toBe(0);
  });

  test("credentials and second factors go with the account", async () => {
    const { user } = await userWithEverything();
    const { hashRecoveryCode } = await import("../../src/lib/FUNC-totp");
    await Promise.all([
      db.user.update({
        where: { id: user.id },
        data: { totpSecret: generateSecret(), totpEnabledAt: new Date() },
      }),
      db.recoveryCode.create({
        data: { userId: user.id, codeHash: hashRecoveryCode("AAAA-BBBB") },
      }),
      db.oAuthAccount.create({
        data: { userId: user.id, provider: "github", providerAccountId: "gh-1" },
      }),
      db.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: "hash",
          expiresAt: new Date(Date.now() + 60_000),
        },
      }),
      db.passkey.create({
        data: {
          userId: user.id,
          credentialId: `cred-${user.id}`,
          publicKey: Buffer.from("key"),
          counter: 0,
          transports: [],
        },
      }),
    ]);

    await DELETE_ACCOUNT(deleteRequest(user.token, { password: PASSWORD, confirmation: PHRASE }));

    const [codes, oauth, resets, passkeys] = await Promise.all([
      db.recoveryCode.count({ where: { userId: user.id } }),
      db.oAuthAccount.count({ where: { userId: user.id } }),
      db.passwordResetToken.count({ where: { userId: user.id } }),
      db.passkey.count({ where: { userId: user.id } }),
    ]);
    expect({ codes, oauth, resets, passkeys }).toEqual({
      codes: 0,
      oauth: 0,
      resets: 0,
      passkeys: 0,
    });
  });

  test("the response says what was destroyed, so the screen can confirm it honestly", async () => {
    const { user } = await userWithEverything();
    const res = await DELETE_ACCOUNT(
      deleteRequest(user.token, { password: PASSWORD, confirmation: PHRASE }),
    );
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.deleted.plans).toBe(1);
    expect(body.deleted.logs).toBe(1);
    expect(body.deleted.mockExams).toBe(1);
    expect(body.deleted.planTasks).toBeGreaterThan(0);
  });

  test("a candidate's own study package is deleted with them", async () => {
    const { user } = await userWithEverything();
    const pkg = await db.studyPackage.create({
      data: { userId: user.id, name: "My own notes" },
    });
    const edition = await db.packageEdition.create({
      data: { packageId: pkg.id, levelId: "II", year: "2026" },
    });
    const unit = await db.packageUnit.create({
      data: { editionId: edition.id, ref: "mine/u1", order: 1, title: "Unit" },
    });
    await db.packageResource.create({
      data: {
        editionId: edition.id,
        unitId: unit.id,
        ref: "mine/u1/r1",
        kind: "notes",
        pageCount: 3,
      },
    });

    const res = await DELETE_ACCOUNT(
      deleteRequest(user.token, { password: PASSWORD, confirmation: PHRASE }),
    );
    expect(res.status).toBe(200);
    expect(await db.studyPackage.count({ where: { id: pkg.id } })).toBe(0);
    expect(await db.packageEdition.count({ where: { packageId: pkg.id } })).toBe(0);
    expect(await db.packageUnit.count({ where: { editionId: edition.id } })).toBe(0);
    expect(await db.packageResource.count({ where: { editionId: edition.id } })).toBe(0);
  });

  test("a shared catalogue package nobody owns is left alone", async () => {
    const { user } = await userWithEverything();
    const shared = await db.studyPackage.count({ where: { userId: null } });
    expect(shared).toBeGreaterThan(0);

    await DELETE_ACCOUNT(deleteRequest(user.token, { password: PASSWORD, confirmation: PHRASE }));
    expect(await db.studyPackage.count({ where: { userId: null } })).toBe(shared);
  });

  test("the curriculum is never touched", async () => {
    const { user } = await userWithEverything();
    const before = await db.reading.count();
    expect(before).toBeGreaterThan(0);
    await DELETE_ACCOUNT(deleteRequest(user.token, { password: PASSWORD, confirmation: PHRASE }));
    expect(await db.reading.count()).toBe(before);
  });
});
