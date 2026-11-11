// Host-cron endpoint: freezes each active plan's progress for the day into a
// ProgressSnapshot, then runs the email coach for every active plan.
//
// Must be scheduled FREQUENTLY, not nightly. The coach has three delivery slots
// in the candidate's own local time (06:30, 20:00, 22:30) and candidates are in
// different zones, so a single nightly tick would miss almost all of them.
// Every 15 to 30 minutes is right. The snapshot half upserts on [planId, date],
// so running it repeatedly within a day costs a write and changes nothing.
//
// Being late is safe by design: dueSlots has no upper bound, so a slot stays
// due until it is actually sent, and the EmailSend uniqueness guard makes a
// second attempt at an already-sent slot a no-op rather than a duplicate.
//
// Hit by the host's cron scheduler, not a browser, so it authenticates with a
// shared Bearer secret (CRON_SECRET) rather than a user JWT. There is no
// requireUser here on purpose.
//
// The snapshot maths lives in lib/snapshot.ts because POST /api/cron/run runs
// the same computation for a single plan. Two copies would drift, and a manual
// run that disagreed with the nightly one would be worse than no manual run.
import { timingSafeEqual } from "node:crypto";
import { db } from "../../../../lib/db";
import { writeSnapshotForPlan, startOfUTCDay } from "../../../../lib/snapshot";
// Namespace import, not destructured, matching the convention documented in
// FUNC-push.ts: a destructured value import binds at import time, before any
// spy is installed, so a test could not intercept the call made here.
import * as coachModule from "../../../../lib/FUNC-coach";

// Constant-time Bearer-secret check, mirroring verifyJwt's signature
// comparison: never compare a secret with ===, and guard the length before
// timingSafeEqual, which throws on a length mismatch.
function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const header = req.headers.get("authorization");
  if (!header || !header.startsWith("Bearer ")) return false;
  const token = header.slice("Bearer ".length).trim();
  if (!token) return false;

  const expectedBuf = Buffer.from(secret, "utf8");
  const actualBuf = Buffer.from(token, "utf8");
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}

export async function GET(req: Request): Promise<Response> {
  if (!isAuthorized(req)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = startOfUTCDay(new Date());

  // Recorded from the start, not at the end: a run that crashes midway must
  // still leave a row, otherwise a crash looks identical to "never ran".
  const run = await db.cronRun.create({ data: {} });

  const activePlans = await db.studyPlan.findMany({ where: { isActive: true } });

  // Each plan is isolated behind its own try/catch: this is an unattended
  // nightly batch, so one bad record must never cost every other plan its
  // snapshot. Failures are counted and logged with the planId, not swallowed.
  let plansFailed = 0;
  let plansSkipped = 0;
  let emailsSent = 0;
  const now = new Date();

  for (const plan of activePlans) {
    try {
      const { outcome } = await writeSnapshotForPlan(plan, today);
      if (outcome === "skipped") {
        plansSkipped += 1;
      }
    } catch (err) {
      plansFailed += 1;
      console.error(`cron/tick: failed to snapshot plan ${plan.id}`, err);
    }

    // Deliberately outside the snapshot's try, and deliberately still reached
    // when the snapshot reports "skipped". That outcome means the exam date has
    // passed, and a `continue` there would mean a finished plan never received
    // the coach's sign-off, which is the one email a finished plan should get.
    // The coach decides for itself what a past exam warrants, and sends that
    // sign-off exactly once.
    //
    // Its own try/catch for the same reason as the snapshot's: this is an
    // unattended batch and one plan's bad data must not cost every other
    // candidate their email. runCoachForPlan already isolates individual send
    // failures internally and reports them, so reaching this catch means
    // something structural, not a bounced message.
    try {
      const result = await coachModule.runCoachForPlan(plan.id, now);
      emailsSent += result.sent.length;
    } catch (err) {
      console.error(`cron/tick: coach failed for plan ${plan.id}`, err);
    }
  }

  // The ad-hoc "You missed a study day" push that used to live here is gone.
  // The coach supersedes it completely: it covers the same event with the
  // streak bands, the revised plan and copy that escalates, and on the same
  // push channel. Keeping both meant a candidate who missed a day received two
  // notifications saying the same thing in two different voices.

  const plansProcessed = activePlans.length - plansFailed - plansSkipped;
  await db.cronRun.update({
    where: { id: run.id },
    data: { finishedAt: new Date(), ok: true, plansProcessed, plansFailed, plansSkipped },
  });

  return Response.json(
    { ok: true, plansProcessed, plansFailed, plansSkipped, emailsSent },
    { status: 200 },
  );
}
