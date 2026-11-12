import { db } from "../../../../../lib/db";
import { requireUser } from "../../../../../lib/FUNC-auth";
import { verifyPassword } from "../../../../../lib/FUNC-crypto";
import {
  hashRecoveryCode,
  hashesMatch,
  normaliseRecoveryCode,
  verifyTotp,
} from "../../../../../lib/FUNC-totp";
import { deleteAccountSchema } from "../../../../../lib/validation";

/**
 * Delete an account and everything in it.
 *
 * Irreversible, and there is no undo anywhere behind it: no soft-delete column,
 * no retention window, no export taken on the way out. The candidate asked for
 * the account to be emptied from the database and that is literally what this
 * does, so the whole design of the route is about making sure the person asking
 * is the account holder and meant it.
 *
 * TWO INDEPENDENT PROOFS, deliberately.
 *
 * A credential proves it is them. The session alone is not enough: a signed-in
 * laptop left open in an office is exactly the situation where an irreversible
 * destructive action needs a second look, and every other sensitive route here
 * (password change, two-step disable) already re-asks for the password rather
 * than trusting the token.
 *
 * A typed phrase proves they meant it. A credential alone cannot distinguish a
 * deliberate deletion from a misclick by someone who happens to know their own
 * password, which is everyone.
 *
 * WHICH CREDENTIAL depends on what the account actually has, checked in a fixed
 * order so a factor the account does not use can never become a way past the
 * one it does:
 *
 *   has a password                  -> the password, and nothing else will do
 *   no password, two-step enabled    -> a current code, or a recovery code
 *   neither                          -> the phrase alone
 *
 * That last case is an OAuth-only account with no second factor. It has no
 * credential this server can re-verify, and refusing would trap it forever with
 * no way to leave. The session is the only proof that exists, and it is the
 * same proof that signed them in, so it is the proof we accept. Saying that out
 * loud rather than quietly weakening the check for everyone.
 *
 * Rate limited under the login tier (see middleware.ts), because a route that
 * takes a password is a route someone will try passwords against.
 */
export async function POST(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = deleteAccountSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Type the confirmation phrase exactly as shown." },
      { status: 400 },
    );
  }
  const { password, totpCode, recoveryCode } = parsed.data;

  const user = await db.user.findUnique({ where: { id: auth.userId } });
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ---- proof one: a credential, whichever one this account has -------------
  let usedRecoveryCodeId: string | null = null;

  if (user.passwordHash) {
    if (typeof password !== "string" || !(await verifyPassword(password, user.passwordHash))) {
      return Response.json({ error: "That password is not right." }, { status: 400 });
    }
  } else if (user.totpEnabledAt && user.totpSecret) {
    const codeOk = typeof totpCode === "string" && verifyTotp(totpCode, user.totpSecret);

    let recoveryOk = false;
    if (!codeOk && typeof recoveryCode === "string") {
      const wanted = hashRecoveryCode(normaliseRecoveryCode(recoveryCode));
      const stored = await db.recoveryCode.findMany({
        where: { userId: user.id, usedAt: null },
        select: { id: true, codeHash: true },
      });
      const match = stored.find((row) => hashesMatch(row.codeHash, wanted));
      if (match) {
        recoveryOk = true;
        usedRecoveryCodeId = match.id;
      }
    }

    if (!codeOk && !recoveryOk) {
      return Response.json(
        { error: "That code is not right. Try your authenticator or a recovery code." },
        { status: 400 },
      );
    }
  }
  // else: no password and no second factor. The phrase, already validated by
  // the schema, is the only proof available and it has been given.

  // usedRecoveryCodeId is deliberately not marked used: the row is about to be
  // deleted along with everything else, and marking it first would be a write
  // we then throw away.
  void usedRecoveryCodeId;

  // ---- the deletion -------------------------------------------------------
  // Nothing in this schema cascades (there is not one onDelete rule), so every
  // table is cleared by hand, children before parents. One transaction, so a
  // failure anywhere leaves the account exactly as it was rather than half
  // erased, which is the worst possible outcome for a destructive operation.
  const plans = await db.studyPlan.findMany({
    where: { userId: user.id },
    select: { id: true },
  });
  const planIds = plans.map((p) => p.id);

  const packages = await db.studyPackage.findMany({
    where: { userId: user.id },
    select: { id: true },
  });
  const packageIds = packages.map((p) => p.id);

  const editions = packageIds.length
    ? await db.packageEdition.findMany({
        where: { packageId: { in: packageIds } },
        select: { id: true },
      })
    : [];
  const editionIds = editions.map((e) => e.id);

  const units = editionIds.length
    ? await db.packageUnit.findMany({
        where: { editionId: { in: editionIds } },
        select: { id: true },
      })
    : [];
  const unitIds = units.map((u) => u.id);

  try {
    const deleted = await db.$transaction(async (tx) => {
      // The candidate's own package subtree, deepest first.
      if (unitIds.length) {
        await tx.packageUnitLos.deleteMany({ where: { unitId: { in: unitIds } } });
        await tx.packageUnitReading.deleteMany({ where: { unitId: { in: unitIds } } });
      }
      if (editionIds.length) {
        await tx.packageResource.deleteMany({ where: { editionId: { in: editionIds } } });
        await tx.packageUnit.deleteMany({ where: { editionId: { in: editionIds } } });
      }
      if (packageIds.length) {
        await tx.packageEdition.deleteMany({ where: { packageId: { in: packageIds } } });
      }

      // Everything hanging off their plans.
      const planTasks = planIds.length
        ? await tx.planTask.deleteMany({ where: { planId: { in: planIds } } })
        : { count: 0 };
      if (planIds.length) {
        await tx.planHoliday.deleteMany({ where: { planId: { in: planIds } } });
        await tx.planPackage.deleteMany({ where: { planId: { in: planIds } } });
        await tx.emailSend.deleteMany({ where: { planId: { in: planIds } } });
        await tx.progressSnapshot.deleteMany({ where: { planId: { in: planIds } } });
      }
      if (packageIds.length) {
        // A plan of theirs may tag a package of theirs, already gone above, but
        // another plan could tag it too. Clearing those rows is what lets the
        // package itself go.
        await tx.planPackage.deleteMany({ where: { packageId: { in: packageIds } } });
      }

      // Their work. Logs reference plan AND package, so they go before both.
      const logs = await tx.studyLogEntry.deleteMany({ where: { userId: user.id } });
      const mockExams = await tx.mockExam.deleteMany({ where: { userId: user.id } });
      const studyPlans = await tx.studyPlan.deleteMany({ where: { userId: user.id } });
      await tx.studyPackage.deleteMany({ where: { userId: user.id } });

      // Their devices and credentials.
      await tx.pushSubscription.deleteMany({ where: { userId: user.id } });
      await tx.passwordResetToken.deleteMany({ where: { userId: user.id } });
      await tx.passkey.deleteMany({ where: { userId: user.id } });
      await tx.recoveryCode.deleteMany({ where: { userId: user.id } });
      await tx.oAuthAccount.deleteMany({ where: { userId: user.id } });
      await tx.webAuthnChallenge.deleteMany({ where: { userId: user.id } });

      await tx.user.delete({ where: { id: user.id } });

      return {
        plans: studyPlans.count,
        planTasks: planTasks.count,
        logs: logs.count,
        mockExams: mockExams.count,
      };
    });

    return Response.json({ ok: true, deleted }, { status: 200 });
  } catch (err) {
    // The commonest way this fails is a foreign key: something outside this
    // account still points at one of their study packages. Failing whole is
    // right, and saying so beats a 500 that reads like a server fault.
    console.error(`account delete: could not delete user ${user.id}`, err);
    return Response.json(
      {
        error:
          "Your account could not be deleted because something else still refers to it. Nothing was removed. Please get in touch.",
      },
      { status: 409 },
    );
  }
}
