// Nightly host-cron endpoint: freezes each active plan's progress for the day
// into a ProgressSnapshot, and sends the missed-day push.
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
import { writeSnapshotForPlan, startOfUTCDay, addUTCDays } from "../../../../lib/snapshot";
import { missedStudyDays, missedDaysWindow } from "../../../../core/pace";
// Namespace import, not destructured: tests spy on pushModule.sendPushToUser
// directly, which only intercepts calls made through this same object.
import * as pushModule from "../../../../lib/FUNC-push";

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

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
  for (const plan of activePlans) {
    try {
      const { outcome, weeklyAvailability, holidays, logDates } = await writeSnapshotForPlan(
        plan,
        today,
      );
      if (outcome === "skipped") {
        plansSkipped += 1;
        continue;
      }

      // Missed-day push: yesterday only, not today (still in progress) and not
      // the trailing week the progress route reports. Clipped to the plan's
      // valid window by the same helper the progress route uses, so a
      // brand-new plan has no "yesterday" to have missed.
      const yesterday = addUTCDays(today, -1);
      const window = missedDaysWindow(plan, { from: yesterday, to: yesterday }, today);
      const missedYesterday = window
        ? missedStudyDays(
            weeklyAvailability,
            logDates,
            { from: window.start, to: window.end },
            holidays,
          )
        : [];

      if (missedYesterday.length > 0) {
        const subscriptionCount = await db.pushSubscription.count({ where: { userId: plan.userId } });
        if (subscriptionCount > 0) {
          const weekdayName = WEEKDAY_NAMES[yesterday.getUTCDay()];
          await pushModule.sendPushToUser(plan.userId, {
            title: "You missed a study day",
            body: `You didn't log any study time on ${weekdayName}. Let's get back on track today.`,
          });
        }
      }
    } catch (err) {
      plansFailed += 1;
      console.error(`cron/tick: failed to snapshot plan ${plan.id}`, err);
    }
  }

  const plansProcessed = activePlans.length - plansFailed - plansSkipped;
  await db.cronRun.update({
    where: { id: run.id },
    data: { finishedAt: new Date(), ok: true, plansProcessed, plansFailed, plansSkipped },
  });

  return Response.json({ ok: true, plansProcessed, plansFailed, plansSkipped }, { status: 200 });
}
