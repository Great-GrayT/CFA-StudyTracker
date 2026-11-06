// Nightly host-cron endpoint: freezes today's targetCumulative/actualCumulative
// into a ProgressSnapshot row per active StudyPlan. Hit by the host's cron
// scheduler, not a browser - authenticated via a shared Bearer secret
// (CRON_SECRET), not a user JWT, so there is no requireUser/db.user lookup here.
import { timingSafeEqual } from "node:crypto";
import { db } from "../../../../lib/db";
import {
  targetDailyPace,
  remainingHours,
  splitProgress,
  missedStudyDays,
  missedDaysWindow,
  type WeeklyAvailability,
} from "../../../../core/pace";
// Namespace import, not destructured: tests spy on
// `pushModule.sendPushToUser` directly, which only intercepts calls made
// through this same object (see FUNC-push.ts's own top comment).
import * as pushModule from "../../../../lib/FUNC-push";

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Same UTC-calendar-day convention as progress/route.ts (Task 10) and pace.ts.
function startOfUTCDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addUTCDays(d: Date, days: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + days));
}

// Constant-time Bearer-secret check, mirroring FUNC-auth.ts's verifyJwt
// signature comparison: never string/`===` compare a secret, and guard the
// length check before timingSafeEqual (which throws on a length mismatch).
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

  const now = new Date();
  const today = startOfUTCDay(now);

  const activePlans = await db.studyPlan.findMany({ where: { isActive: true } });

  // Each plan is isolated behind its own try/catch: this is an unattended
  // nightly batch, so one bad record (malformed data, a deleted curriculum
  // row, etc.) must never cost every OTHER plan its snapshot for the day.
  // Failures are logged with planId (diagnosable) and counted, not swallowed
  // silently, so a caller can tell the batch didn't silently drop plans.
  let plansFailed = 0;
  let plansSkipped = 0;
  for (const plan of activePlans) {
    try {
      // Once the exam date has passed, this plan gets neither a fresh
      // snapshot nor a missed-day push, ever again - otherwise a candidate
      // keeps getting "you missed a study day" pushes forever post-exam.
      if (startOfUTCDay(plan.examDate).getTime() < today.getTime()) {
        plansSkipped += 1;
        continue;
      }

      const weeklyAvailability = plan.weeklyAvailability as unknown as WeeklyAvailability;

      const [holidayRows, losRows, logs] = await Promise.all([
        db.planHoliday.findMany({ where: { planId: plan.id } }),
        db.lOS.findMany({
          where: { reading: { topic: { levelId: plan.levelId } } },
          include: { reading: { include: { topic: true } } },
        }),
        // Sorted ascending so the first log per losId (in this array order) is
        // that LOS's first-ever log - used below for isFirstEverLog, same as
        // Task 10's /api/progress.
        db.studyLogEntry.findMany({ where: { planId: plan.id }, orderBy: [{ date: "asc" }, { id: "asc" }] }),
      ]);

      const holidays = holidayRows.map((h) => ({ start: h.startDate, end: h.endDate }));

      // Same fixed-baseline-pace math as Task 10's /api/progress: the rate is
      // fixed from the plan's own whole start-to-exam span, not recomputed from
      // today's live remaining backlog/hours.
      const totalLosCount = losRows.length;
      const totalHoursWhole = remainingHours(weeklyAvailability, plan.startDate, plan.examDate, holidays);
      const basePaceRate = targetDailyPace(totalLosCount, totalLosCount, totalHoursWhole);
      const hoursElapsedBeforeToday = remainingHours(
        weeklyAvailability,
        plan.startDate,
        addUTCDays(today, -1),
        holidays,
      );
      const targetCumulative = Math.max(
        0,
        Math.min(totalLosCount, Math.round(basePaceRate * hoursElapsedBeforeToday)),
      );

      // First log (in the date/id-ascending array above) per losId is that
      // LOS's first-ever log on this plan - everything after it is review work.
      const seenLos = new Set<string>();
      const isFirstEverLogById = new Map<string, boolean>();
      for (const log of logs) {
        if (!seenLos.has(log.losId)) {
          isFirstEverLogById.set(log.id, true);
          seenLos.add(log.losId);
        } else {
          isFirstEverLogById.set(log.id, false);
        }
      }
      const { newCoverage, reviewWork } = splitProgress(
        logs.map((l) => ({ isFirstEverLog: isFirstEverLogById.get(l.id) ?? false })),
      );
      const actualCumulative = newCoverage + reviewWork;

      await db.progressSnapshot.upsert({
        where: { planId_date: { planId: plan.id, date: today } },
        create: { planId: plan.id, date: today, targetCumulative, actualCumulative },
        update: { targetCumulative, actualCumulative },
      });

      // Missed-day push: yesterday only (not today - still in progress - and
      // not the trailing week Task 10's /api/progress checks), clipped to
      // the plan's valid window by the same shared missedDaysWindow helper
      // /api/progress uses - a brand-new plan (startDate today) has no
      // valid "yesterday" to have missed yet, so window is null and no push
      // fires.
      const yesterday = addUTCDays(today, -1);
      const window = missedDaysWindow(plan, { from: yesterday, to: yesterday }, today);
      const missedYesterday = window
        ? missedStudyDays(
            weeklyAvailability,
            logs.map((l) => l.date),
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

  return Response.json(
    {
      ok: true,
      plansProcessed: activePlans.length - plansFailed - plansSkipped,
      plansFailed,
      plansSkipped,
    },
    { status: 200 },
  );
}
