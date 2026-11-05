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
  type WeeklyAvailability,
} from "../../../../core/pace";

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

  const header = req.headers.get("authorization") ?? req.headers.get("Authorization");
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

  for (const plan of activePlans) {
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
  }

  return Response.json({ ok: true, plansProcessed: activePlans.length }, { status: 200 });
}
