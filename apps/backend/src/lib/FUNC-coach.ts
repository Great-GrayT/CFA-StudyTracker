// The sender: the only impure layer of the email coach. Composes the four
// pure layers (slots, coach-state, coach-dialogue, the renderer) with real
// data and sends exactly once per (plan, local date, slot).
//
// The order of operations below is load bearing, not incidental:
//   1. resolve due slots from the plan's own timezone
//   2. honour emailCoach (off / debrief-only / all)
//   3. regenerate the plan FIRST when a streak demands it; abort the whole
//      run on failure, because a coach emailing a stale list is worse than
//      silence
//   4. classify state, pick the dialogue, skip (not fail) on a null pick
//   5. claim the EmailSend row inside a transaction before sending, so a
//      concurrent or retried run loses the race instead of duplicating
//   6. send; record sentAt on success, failedAttempts/lastError on failure,
//      and never let a send failure touch plan state
import { db } from "./db";
import { sendMail, type Mail } from "./FUNC-mail";
import { generateHorizon } from "./FUNC-schedule";
import { renderCoachMail, type MailData, type MailTask } from "./FUNC-mail-render";
import { dueSlots, localDateFor, type Slot } from "../core/slots";
import { classify, type CoachInput } from "../core/coach-state";
import { dialogueFor, type DialogueVars, type LineContext } from "../core/coach-dialogue";
import { missedStudyDays, type WeeklyAvailability } from "../core/pace";
import { holidayFacts } from "../core/holiday";
import { splitLoggedWork } from "../core/logged-work";
import { weatherTags } from "../core/weather";
import { observationFor } from "./FUNC-weather";
// Namespace import, not destructured, matching the convention this codebase
// documents in FUNC-push.ts and cron/tick/route.ts: a destructured value import
// binds the function at import time, before any spy is installed, so a test
// spying on pushModule.sendPushToUser would never intercept the call made here.
import * as pushModule from "./FUNC-push";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
// Date.UTC's getDay() ordering (0 = Sunday); same convention core/pace.ts and
// FUNC-schedule.ts both use for plan dates, duplicated here per this
// codebase's existing pattern of not sharing these tiny helpers across files
// (see cron/tick/route.ts, progress/route.ts).
const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

const KIND_LABELS: Record<string, string> = {
  "content-notes": "Notes",
  "content-video": "Lecture",
  eocq: "End-of-chapter questions",
  questions: "Practice questions",
  seminar: "Seminar",
  review: "Review",
  mock: "Mock exam",
  "mock-review": "Mock review",
};

function startOfUTCDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addUTCDays(d: Date, days: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + days));
}

function toISODate(d: Date): string {
  return startOfUTCDay(d).toISOString().slice(0, 10);
}

type Sender = (mail: Mail) => Promise<void>;

type TodayTask = {
  id: string;
  kind: string;
  readingIds: string[];
  estimatedMinutes: number;
  status: string;
  insertedBecause: string | null;
};

/** Consecutive missed study days immediately before `yesterday`, walking
 * back no further than the plan's own start. Reuses missedStudyDays (the
 * spec: "the existing missedStudyDays already computes correctly") twice
 * over the same window: once with the real logs to find what was missed,
 * once with none at all to find which days were study days in the first
 * place (a non-study day must never break or extend the streak). */
async function computeStreakDays(
  planId: string,
  weeklyAvailability: Record<string, number>,
  startDate: Date,
  yesterday: Date,
): Promise<number> {
  const from = startOfUTCDay(startDate);
  if (yesterday.getTime() < from.getTime()) return 0;

  const [logs, holidayRows] = await Promise.all([
    db.studyLogEntry.findMany({ where: { planId }, select: { date: true } }),
    db.planHoliday.findMany({ where: { planId } }),
  ]);
  const loggedDates = logs.map((l) => l.date);
  const holidays = holidayRows.map((h) => ({ start: h.startDate, end: h.endDate }));
  const availability = weeklyAvailability as unknown as WeeklyAvailability;

  const missedSet = new Set(missedStudyDays(availability, loggedDates, { from, to: yesterday }, holidays));
  const studyDaySet = new Set(missedStudyDays(availability, [], { from, to: yesterday }, holidays));

  let streakDays = 0;
  let cursor = yesterday;
  while (cursor.getTime() >= from.getTime()) {
    const iso = toISODate(cursor);
    if (studyDaySet.has(iso)) {
      if (missedSet.has(iso)) {
        streakDays++;
      } else {
        break; // a logged study day stops the streak
      }
    }
    cursor = addUTCDays(cursor, -1);
  }
  return streakDays;
}

function titleForTask(task: TodayTask, readingNames: Map<string, string>): string {
  const names = task.readingIds.map((id) => readingNames.get(id)).filter((n): n is string => !!n);
  const label = KIND_LABELS[task.kind] ?? task.kind;
  return names.length > 0 ? `${names.join(", ")} (${label})` : label;
}

/** Unweighted LOS coverage for this plan's level: fraction of LOS with at
 * least one log entry on this plan. The weighted version (pace.ts's
 * weightedCoveragePercent) needs a full topic-weight join this composition
 * layer doesn't otherwise need; unweighted is an honest simplification for
 * the coach's own copy, not a claim of exactness. */
async function coveragePercentFor(planId: string, levelId: string): Promise<number> {
  const totalLos = await db.lOS.count({ where: { reading: { topic: { levelId } } } });
  if (totalLos === 0) return 0;
  const coveredLos = await db.lOS.count({
    where: { reading: { topic: { levelId } }, logs: { some: { planId } } },
  });
  return Math.round((coveredLos / totalLos) * 100);
}

function isUniqueConstraintViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: unknown }).code === "P2002";
}

/** Claims the (planId, localDate, slot) row before anything is sent. The
 * unique index is the actual guard: a concurrent or retried run loses the
 * race here, inside the DB, rather than by any application-level check that
 * could itself race. */
async function claimEmailSend(
  planId: string,
  localDate: string,
  slot: Slot,
  dialogueKey: string,
): Promise<{ id: string } | null> {
  try {
    return await db.$transaction((tx) =>
      tx.emailSend.create({ data: { planId, localDate, slot, dialogueKey } }),
    );
  } catch (err) {
    if (isUniqueConstraintViolation(err)) return null;
    throw err;
  }
}

export async function runCoachForPlan(
  planId: string,
  now: Date,
  sender: Sender = sendMail,
): Promise<{ sent: Slot[]; skipped: Slot[]; failed: Slot[] }> {
  const plan = await db.studyPlan.findUniqueOrThrow({ where: { id: planId } });
  const localDate = localDateFor(now, plan.timeZone);
  const todayDate = new Date(localDate + "T00:00:00Z");
  const yesterday = addUTCDays(todayDate, -1);

  const existingSends = await db.emailSend.findMany({ where: { planId, localDate } });
  const alreadySent = existingSends.filter((s) => s.sentAt !== null).map((s) => s.slot as Slot);

  const due = dueSlots(now, plan.timeZone, alreadySent);

  const sent: Slot[] = [];
  const skipped: Slot[] = [];
  const failed: Slot[] = [];

  let candidateSlots: Slot[];
  if (plan.emailCoach === "off") {
    return { sent: [], skipped: due, failed: [] };
  } else if (plan.emailCoach === "debrief-only") {
    candidateSlots = due.filter((s) => s === "debrief");
    skipped.push(...due.filter((s) => s !== "debrief"));
  } else {
    candidateSlots = due;
  }

  if (candidateSlots.length === 0) {
    return { sent, skipped, failed };
  }

  const weeklyAvailability = plan.weeklyAvailability as Record<string, number>;
  const streakDays = await computeStreakDays(planId, weeklyAvailability, plan.startDate, yesterday);

  let droppedCount = 0;
  if (candidateSlots.includes("prescription") && streakDays >= 1) {
    try {
      const result = await generateHorizon(planId, localDate);
      droppedCount = result.deleted;
    } catch {
      // The whole point of the email is that the list is current. A coach
      // emailing yesterday's list is worse than silence: abort entirely,
      // not just the prescription slot.
      return { sent: [], skipped: candidateSlots, failed: [] };
    }
  }

  const todayTasks: TodayTask[] = await db.planTask.findMany({
    where: { planId, date: todayDate },
    orderBy: { order: "asc" },
    select: { id: true, kind: true, readingIds: true, estimatedMinutes: true, status: true, insertedBecause: true },
  });

  const readingIds = [...new Set(todayTasks.flatMap((t) => t.readingIds))];
  const readingRows = readingIds.length
    ? await db.reading.findMany({ where: { id: { in: readingIds } }, select: { id: true, name: true } })
    : [];
  const readingNames = new Map(readingRows.map((r) => [r.id, r.name]));

  const taskMinutes = todayTasks.reduce((sum, t) => sum + t.estimatedMinutes, 0);
  const availableMinutes = weeklyAvailability[WEEKDAY_KEYS[todayDate.getUTCDay()]] ?? 0;

  const holidayRows = await db.planHoliday.findMany({ where: { planId } });
  // The full three-act picture rather than just "is today off". The day before
  // a break and the first day back are both higher-leverage than the break,
  // and both used to receive copy that ignored the break entirely.
  const holiday = holidayFacts(holidayRows, todayDate);
  const isHoliday = holiday.isHoliday;

  const hasRequeued = todayTasks.some((t) => t.insertedBecause !== null);
  const hasMock = todayTasks.some((t) => t.kind === "mock" || t.kind === "mock-review");
  const taskCount = todayTasks.length;
  const tasksDone = todayTasks.filter((t) => t.status === "done").length;

  // What was actually studied today, resolved to readings so it can be compared
  // against what was asked for. Counting tasks ticked is not enough: a candidate
  // who studied the prescribed reading without ticking the box, and one who
  // studied two hours of something else entirely, both tick zero boxes and used
  // to come out as having done nothing.
  const todayLogs = await db.studyLogEntry.findMany({
    where: { planId, date: { gte: todayDate, lt: addUTCDays(todayDate, 1) } },
    select: { losId: true },
  });
  const loggedTodayCount = todayLogs.length;
  const extraLogged = Math.max(0, loggedTodayCount - taskCount);

  const loggedLos = loggedTodayCount
    ? await db.lOS.findMany({
        where: { id: { in: [...new Set(todayLogs.map((l) => l.losId))] } },
        select: { id: true, readingId: true, reading: { select: { name: true } } },
      })
    : [];
  const losToReading = new Map(loggedLos.map((l) => [l.id, l]));

  // Per log entry, not per distinct reading: three sessions on one hard topic is
  // three pieces of work and must not be credited as one.
  const studiedReadingIds = todayLogs
    .map((l) => losToReading.get(l.losId)?.readingId)
    .filter((id): id is string => id !== undefined);
  const split = splitLoggedWork(studiedReadingIds, readingIds);

  // Named so the copy can say what they studied instead. Falls back to a
  // neutral phrase rather than an empty string, since the renderer throws on an
  // unsupplied variable and a blank topic name would read as a bug.
  const firstOffPlan = todayLogs
    .map((l) => losToReading.get(l.losId))
    .find((l) => l !== undefined && !readingIds.includes(l.readingId));
  const offPlanTopic = firstOffPlan?.reading.name ?? "something off the list";

  // NOT clamped at zero. A negative value is how the state model recognises
  // that the exam has passed, and clamping it would pin a finished plan to
  // "today is the exam" forever, so the coach would keep wishing the candidate
  // luck every morning for the rest of time.
  const daysToExam = Math.round(
    (startOfUTCDay(plan.examDate).getTime() - todayDate.getTime()) / MS_PER_DAY,
  );
  const planStart = startOfUTCDay(plan.startDate).getTime();
  const planTotalDays = Math.max(
    0,
    Math.round((startOfUTCDay(plan.examDate).getTime() - planStart) / MS_PER_DAY),
  );
  const planElapsedDays = Math.max(0, Math.round((todayDate.getTime() - planStart) / MS_PER_DAY));

  const input: CoachInput = {
    streakDays,
    taskMinutes,
    availableMinutes,
    isHoliday,
    hasRequeued,
    hasMock,
    taskCount,
    tasksDone,
    extraLogged,
    onPlanLogged: split.onPlan,
    offPlanLogged: split.offPlan,
    daysToExam,
    planTotalDays,
    planElapsedDays,
    holidayStartsTomorrow: holiday.holidayStartsTomorrow,
    holidayYesterday: holiday.holidayYesterday,
    holidayTomorrow: holiday.holidayTomorrow,
  };
  const state = classify(input);

  const user = await db.user.findUniqueOrThrow({ where: { id: plan.userId } });
  const coveragePercent = await coveragePercentFor(planId, plan.levelId);
  const firstTask = todayTasks[0] ? titleForTask(todayTasks[0], readingNames) : "today's plan";
  const appUrl = process.env.FRONTEND_BASE_URL ?? "https://app.example.com";

  const vars: DialogueVars = {
    name: user.email,
    daysToExam,
    streak: streakDays,
    todayMinutes: taskMinutes,
    taskCount,
    coveragePercent,
    // No backlog-depth projection exists yet in this codebase (pace.ts has
    // no "projected finish date"); the exam date is the honest placeholder
    // until that projection is built, and no test pins this value.
    finishDate: toISODate(plan.examDate),
    droppedCount,
    // What actually rolls into tomorrow, as distinct from what regeneration
    // deleted this morning. The debrief has no regeneration behind it, so
    // droppedCount is zero there and copy about tomorrow needs this instead.
    requeueCount: Math.max(0, taskCount - tasksDone),
    firstTask,
    offPlanCount: split.offPlan,
    offPlanTopic,
    restDays: holiday.restDays,
    dayOfBlock: holiday.dayOfBlock,
    n: tasksDone,
  };

  const mailTasks: MailTask[] = todayTasks.map((t) => ({
    title: titleForTask(t, readingNames),
    minutes: t.estimatedMinutes,
    done: t.status === "done",
  }));
  const mailData: MailData = {
    tasks: mailTasks,
    coveragePercent,
    daysToExam,
    planUrl: `${appUrl}/plan/today`,
  };

  // Weather, when the candidate has told us where they are. Everything about
  // this is best effort: no location, a dead forecast service or a malformed
  // response all end the same way, with `weather` undefined and the untagged
  // copy carrying the day. Weather must never be able to stop an email.
  let weather: LineContext["weather"];
  if (plan.latitude !== null && plan.longitude !== null) {
    try {
      const observation = await observationFor(plan.latitude, plan.longitude, localDate);
      if (observation) weather = weatherTags(observation);
    } catch {
      // observationFor already swallows its own failures; this is belt and
      // braces so a future change in there cannot cost a candidate their email.
    }
  }
  const context: LineContext = { horizon: state.horizon, phase: state.phase, weather };

  // Once the exam has passed the coach signs off, exactly once, and then stops.
  // The uniqueness guard is per local DATE, so without this the sign-off, whose
  // own copy says there will be no further emails, would be sent every single
  // morning for the rest of the plan's life.
  let signedOff = false;
  if (state.horizon === "past") {
    signedOff =
      (await db.emailSend.count({ where: { planId, dialogueKey: "P_PAST" } })) > 0;
  }

  for (const slot of candidateSlots) {
    const key = dialogueFor(slot, state);
    if (key === null) {
      skipped.push(slot);
      continue;
    }
    if (key === "P_PAST" && signedOff) {
      skipped.push(slot);
      continue;
    }

    const claimed = await claimEmailSend(planId, localDate, slot, key);
    if (!claimed) {
      // Lost the race to a concurrent or earlier run of this exact slot.
      skipped.push(slot);
      continue;
    }

    // localDate is what rotates the variant, and the context is what lets the
    // horizon, phase and weather tags narrow the pool. Omitting either would
    // collapse every pool to a single fixed line for the life of the plan.
    const { subject, html, text, push } = renderCoachMail(
      key,
      vars,
      mailData,
      localDate,
      context,
      // Tagged per slot so the three daily notifications coexist instead of
      // replacing one another, while a retry of the same slot still collapses
      // into one.
      `coach-${slot}`,
    );

    try {
      await sender({ to: user.email, subject, html, text });
      await db.emailSend.update({ where: { id: claimed.id }, data: { sentAt: now } });
      sent.push(slot);

      // The same dialogue, on the phone. Sent after the email is recorded, and
      // deliberately not awaited into the success path: push is a second
      // channel for a message already delivered, so a dead subscription must
      // never mark a sent email as failed. sendPushToUser handles its own
      // per-subscription failures and resolves either way.
      await pushModule.sendPushToUser(plan.userId, push).catch(() => {
        // Already logged inside FUNC-push. Nothing here can improve on it.
      });
    } catch (err) {
      await db.emailSend.update({
        where: { id: claimed.id },
        data: { failedAttempts: { increment: 1 }, lastError: err instanceof Error ? err.message : String(err) },
      });
      failed.push(slot);
    }
  }

  return { sent, skipped, failed };
}
