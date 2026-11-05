import { z } from "zod";
import { db } from "../../../lib/db";
import { requireUser } from "../../../lib/FUNC-auth";
import {
  coverageCount,
  weightedCoveragePercent,
  studyNextList,
  classifyLosFlag,
  targetDailyPace,
  remainingHours,
  behindAhead,
  missedStudyDays,
  splitProgress,
  isPaceRealistic,
  shouldNudgeDiversity,
  recommendedSessionSplit,
  type DateRange,
  type LosWithStatus,
  type WeeklyAvailability,
} from "../../../core/pace";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Same UTC-calendar-day convention as pace.ts: plan dates are calendar days,
// not instants, so all "today"/"trailing week" math stays independent of
// the host machine's timezone.
function startOfUTCDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addUTCDays(d: Date, days: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + days));
}

const querySchema = z.object({ planId: z.string().min(1) });

async function findOwnedPlan(planId: string, userId: string) {
  const plan = await db.studyPlan.findUnique({ where: { id: planId } });
  if (!plan || plan.userId !== userId) return null;
  return plan;
}

export async function GET(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({ planId: url.searchParams.get("planId") });
  if (!parsed.success) {
    return Response.json({ error: "planId query parameter is required" }, { status: 400 });
  }
  const { planId } = parsed.data;

  const plan = await findOwnedPlan(planId, auth.userId);
  if (!plan) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const now = new Date();
  const today = startOfUTCDay(now);
  const weeklyAvailability = plan.weeklyAvailability as unknown as WeeklyAvailability;

  const [holidayRows, planPackageRows, losRows, logs, history] = await Promise.all([
    db.planHoliday.findMany({ where: { planId } }),
    db.planPackage.findMany({ where: { planId } }),
    db.lOS.findMany({
      where: { reading: { topic: { levelId: plan.levelId } } },
      include: { reading: { include: { topic: true } } },
    }),
    // Sorted ascending so the first log per losId (in this array order) is
    // that LOS's first-ever log - used below for isFirstEverLog.
    db.studyLogEntry.findMany({ where: { planId }, orderBy: [{ date: "asc" }, { id: "asc" }] }),
    db.progressSnapshot.findMany({ where: { planId }, orderBy: { date: "asc" } }),
  ]);

  const holidays: DateRange[] = holidayRows.map((h) => ({ start: h.startDate, end: h.endDate }));

  // Curriculum order: topic order, then reading order, then LOS order -
  // LOS.order is only unique within its reading, so a global index is
  // assigned below for LosWithStatus.order (studyNextList's not-started sort key).
  losRows.sort(
    (a, b) =>
      a.reading.topic.order - b.reading.topic.order ||
      a.reading.order - b.reading.order ||
      a.order - b.order,
  );

  const logsByLos = new Map<string, typeof logs>();
  for (const log of logs) {
    const arr = logsByLos.get(log.losId);
    if (arr) arr.push(log);
    else logsByLos.set(log.losId, [log]);
  }

  const losCountByTopic = new Map<string, number>();
  for (const los of losRows) {
    const topicId = los.reading.topic.id;
    losCountByTopic.set(topicId, (losCountByTopic.get(topicId) ?? 0) + 1);
  }

  const losWithStatus: LosWithStatus[] = [];
  const weightShareByLos = new Map<string, number>();
  const coveredByLos = new Map<string, boolean>();

  losRows.forEach((los, index) => {
    const topic = los.reading.topic;
    const weightShare =
      (topic.examWeightMin + topic.examWeightMax) / 2 / (losCountByTopic.get(topic.id) ?? 1);
    weightShareByLos.set(los.id, weightShare);

    const losLogs = logsByLos.get(los.id) ?? [];
    let status: LosWithStatus["status"];
    let lastRatedAt: Date | undefined;

    if (losLogs.length === 0) {
      status = "not-started";
      coveredByLos.set(los.id, false);
    } else {
      const mostRecent = losLogs[losLogs.length - 1]!;
      const questionsAnswered = losLogs.reduce((sum, l) => sum + l.questionsAnswered, 0);
      const questionsCorrect = losLogs.reduce((sum, l) => sum + l.questionsCorrect, 0);
      const flagged = classifyLosFlag(
        {
          confidence: mostRecent.confidence,
          questionsAnswered,
          questionsCorrect,
          lastTouchedAt: mostRecent.date,
        },
        now,
      );
      status = flagged ? "flagged" : "covered";
      lastRatedAt = mostRecent.date;
      coveredByLos.set(los.id, true);
    }

    losWithStatus.push({ losId: los.id, status, lastRatedAt, order: index });
  });

  const coveragePercent = weightedCoveragePercent(
    losRows.map((los) => ({
      covered: coveredByLos.get(los.id) ?? false,
      weightShare: weightShareByLos.get(los.id) ?? 0,
    })),
  );

  const studyNext = studyNextList(losWithStatus);

  // --- today's view: cumulative actual (new coverage + review work) vs.
  // cumulative target, both computed live for "today" per spec; past days
  // read their frozen ProgressSnapshot row instead (returned as `history`). ---

  const totalLosCount = losRows.length;
  const coveredLosCount = coverageCount(logs);
  const remainingLosCount = Math.max(0, totalLosCount - coveredLosCount);

  // Baseline pace fixed at the plan's own start-to-exam span (recomputed
  // each request from startDate/examDate/template, since nothing is stored
  // between requests) - this is what projects a target for "today".
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
  const { delta, percent } = behindAhead(actualCumulative, targetCumulative);

  // Pace-realism: required daily hours, going forward from today, derived
  // from targetDailyPace's LOS-per-hour rate. When remainingHoursFromToday
  // is positive this reduces (by that rate's own definition) to the
  // template's own average daily hours over the remaining span - a
  // non-trivial check when the template itself declares more hours/day than
  // the ceiling. When remainingHoursFromToday is zero (or negative) but work
  // still remains, the rate's zero-guard turns a genuine divide-by-zero into
  // an explicit Infinity here, correctly flagging "can't fit no matter what".
  const remainingHoursFromToday = remainingHours(weeklyAvailability, today, plan.examDate, holidays);
  const forwardRate = targetDailyPace(totalLosCount, remainingLosCount, remainingHoursFromToday);
  const totalHoursNeeded =
    remainingLosCount <= 0 ? 0 : forwardRate > 0 ? remainingLosCount / forwardRate : Infinity;
  const daysRemaining = Math.max(
    0,
    Math.round((startOfUTCDay(plan.examDate).getTime() - today.getTime()) / MS_PER_DAY) + 1,
  );
  const requiredDailyHours =
    daysRemaining > 0 ? totalHoursNeeded / daysRemaining : totalHoursNeeded > 0 ? Infinity : 0;
  const paceRealistic = isPaceRealistic(requiredDailyHours);

  // --- missed days: trailing 7 calendar days, today inclusive ---
  const sevenDaysAgo = addUTCDays(today, -6);
  const missedDays = missedStudyDays(
    weeklyAvailability,
    logs.map((l) => l.date),
    { from: sevenDaysAgo, to: today },
    holidays,
  );

  // --- diversity nudges: only questions-role packages count toward the
  // 20-question single-source threshold ---
  const questionsRolePackageIds = new Set(
    planPackageRows.filter((p) => p.roles.includes("questions")).map((p) => p.packageId),
  );
  const diversityNudges: string[] = [];
  for (const los of losRows) {
    const losLogs = logsByLos.get(los.id) ?? [];
    if (losLogs.length === 0) continue;

    const questionsByPackageId: Record<string, number> = {};
    for (const log of losLogs) {
      if (!log.packageId || !questionsRolePackageIds.has(log.packageId)) continue;
      questionsByPackageId[log.packageId] =
        (questionsByPackageId[log.packageId] ?? 0) + log.questionsAnswered;
    }

    const mostRecent = losLogs[losLogs.length - 1]!;
    if (shouldNudgeDiversity(questionsByPackageId, mostRecent.confidence)) {
      diversityNudges.push(los.id);
    }
  }

  // --- recommended split: the plan's full weekly-hours sum, not just today's ---
  const weeklyHoursSum =
    weeklyAvailability.mon +
    weeklyAvailability.tue +
    weeklyAvailability.wed +
    weeklyAvailability.thu +
    weeklyAvailability.fri +
    weeklyAvailability.sat +
    weeklyAvailability.sun;
  const recommendedSplit = recommendedSessionSplit(weeklyHoursSum);

  return Response.json(
    {
      coveragePercent,
      studyNext,
      today: { targetCumulative, newCoverage, reviewWork, actualCumulative, delta, percent },
      paceRealistic,
      diversityNudges,
      recommendedSplit,
      history,
      missedDays,
    },
    { status: 200 },
  );
}
