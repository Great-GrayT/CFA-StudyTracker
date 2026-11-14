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
import { dueSlots, localDateFor, parseSchedule, type Slot } from "../core/slots";
import { classify, type CoachInput } from "../core/coach-state";
import { dialogueFor, type DialogueKey, type DialogueVars, type LineContext } from "../core/coach-dialogue";
import { missedStudyDays, type WeeklyAvailability } from "../core/pace";
import { holidayFacts } from "../core/holiday";
import { unsubscribeUrl } from "./FUNC-unsubscribe";
import { splitLoggedWork } from "../core/logged-work";
import { weatherTags } from "../core/weather";
import { observationFor } from "./FUNC-weather";
// Namespace import, not destructured, matching the convention this codebase
// documents in FUNC-push.ts and cron/tick/route.ts: a destructured value import
// binds the function at import time, before any spy is installed, so a test
// spying on pushModule.sendPushToUser would never intercept the call made here.
import * as pushModule from "./FUNC-push";
import type { PushPayload } from "./FUNC-push";

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

/** Records why a delivery failed, against the row that was claimed for it. */
async function recordFailure(id: string, err: unknown): Promise<void> {
  await db.emailSend.update({
    where: { id },
    data: {
      failedAttempts: { increment: 1 },
      lastError: err instanceof Error ? err.message : String(err),
    },
  });
}

/** A failed delivery is retried on later runs up to this many attempts. */
const MAX_SEND_ATTEMPTS = 3;

/** Claims the (planId, localDate, slot, channel) row before anything is sent. The
 * unique index is the actual guard: a concurrent or retried run loses the
 * race here, inside the DB, rather than by any application-level check that
 * could itself race.
 *
 * An existing row is re-claimed only when its last attempt recorded a failure.
 * Clearing lastError is the claim: a second run racing for the same retry finds
 * it already null and gets nothing. A row with no recorded failure is an
 * attempt still in flight (or one that crashed mid-send) and is never touched,
 * since sending it again could deliver twice. */
async function claimSend(
  planId: string,
  localDate: string,
  slot: Slot,
  channel: "email" | "push",
  dialogueKey: string,
): Promise<{ id: string } | null> {
  try {
    return await db.$transaction((tx) =>
      tx.emailSend.create({ data: { planId, localDate, slot, channel, dialogueKey } }),
    );
  } catch (err) {
    if (!isUniqueConstraintViolation(err)) throw err;
  }
  const retry = await db.emailSend.updateMany({
    where: {
      planId,
      localDate,
      slot,
      channel,
      sentAt: null,
      lastError: { not: null },
      failedAttempts: { lt: MAX_SEND_ATTEMPTS },
    },
    data: { lastError: null, dialogueKey },
  });
  if (retry.count === 0) return null;
  return db.emailSend.findFirstOrThrow({
    where: { planId, localDate, slot, channel },
    select: { id: true },
  });
}

/**
 * What one run did, per channel.
 *
 * `sent`/`failed` stay email-only and keep their original names so existing
 * callers are unaffected; push gets its own pair. `skipped` is shared and means
 * "no delivery on any channel", the only sense in which a slot is truly
 * skipped.
 */
export type CoachRunResult = {
  sent: Slot[];
  skipped: Slot[];
  failed: Slot[];
  pushSent: Slot[];
  pushFailed: Slot[];
};

/**
 * Which slots a preference allows. The closed set is documented on the
 * StudyPlan columns; an unrecognised value falls through to "all" rather than
 * to silence, because silence is the failure mode a candidate cannot see and
 * therefore cannot report.
 */
function slotsAllowedBy(preference: string, due: Slot[]): Slot[] {
  if (preference === "off") return [];
  if (preference === "debrief-only") return due.filter((s) => s === "debrief");
  return due;
}

export async function runCoachForPlan(
  planId: string,
  now: Date,
  sender: Sender = sendMail,
): Promise<CoachRunResult> {
  const plan = await db.studyPlan.findUniqueOrThrow({ where: { id: planId } });
  const localDate = localDateFor(now, plan.timeZone);
  const todayDate = new Date(localDate + "T00:00:00Z");
  const yesterday = addUTCDays(todayDate, -1);

  const existingSends = await db.emailSend.findMany({ where: { planId, localDate } });
  const sentOn = (channel: string): Set<Slot> =>
    new Set(
      existingSends
        .filter((row) => row.channel === channel && row.sentAt !== null)
        .map((row) => row.slot as Slot),
    );

  // Deliberately not pre-filtered by what has already gone out, because what
  // counts as sent now differs per channel. Each channel filters its own list
  // below, and the atomic claim stays the real guard either way.
  const due = dueSlots(now, plan.timeZone, [], parseSchedule(plan.coachSchedule));

  const sent: Slot[] = [];
  const skipped: Slot[] = [];
  const failed: Slot[] = [];
  const pushSent: Slot[] = [];
  const pushFailed: Slot[] = [];

  const emailAlready = sentOn("email");
  const pushAlready = sentOn("push");
  const emailSlots = slotsAllowedBy(plan.emailCoach, due).filter((s) => !emailAlready.has(s));
  const pushSlots = slotsAllowedBy(plan.pushCoach, due).filter((s) => !pushAlready.has(s));

  // Any slot either channel still wants. Everything expensive below
  // (regenerating the horizon, classifying state, building the mail) runs once
  // and feeds both channels, so it is gated on the union rather than per
  // channel.
  const candidateSlots = due.filter((s) => emailSlots.includes(s) || pushSlots.includes(s));
  skipped.push(...due.filter((s) => !candidateSlots.includes(s)));

  if (candidateSlots.length === 0) {
    return { sent, skipped, failed, pushSent, pushFailed };
  }

  const weeklyAvailability = plan.weeklyAvailability as Record<string, number>;
  const streakDays = await computeStreakDays(planId, weeklyAvailability, plan.startDate, yesterday);

  let droppedCount = 0;
  if (candidateSlots.includes("prescription") && streakDays >= 1) {
    try {
      const result = await generateHorizon(planId, localDate);
      droppedCount = result.deleted;
    } catch (err) {
      // The whole point of the email is that the list is current. A coach
      // emailing yesterday's list is worse than silence: abort entirely,
      // not just the prescription slot. Nothing is claimed, so the next sweep
      // tries again; logged because otherwise this reads as a mute coach.
      console.error(`FUNC-coach: regenerating plan ${planId} failed, sending nothing`, err);
      return { sent: [], skipped: candidateSlots, failed: [], pushSent: [], pushFailed: [] };
    }
  }

  // No placeholder fallback for the app URL: a deployment missing it would
  // send mail in which every link, unsubscribe included, is dead.
  const appUrl = process.env.FRONTEND_BASE_URL;
  if (!appUrl) {
    console.error(
      `FUNC-coach: FRONTEND_BASE_URL is not set, refusing to send for plan ${planId}. ` +
        `Every link in the email, unsubscribe included, would be dead.`,
    );
    return { sent: [], skipped: candidateSlots, failed: [], pushSent: [], pushFailed: [] };
  }

  const { state, vars, mailData, context, user, emailUnsubscribe } = await buildCoachContext(
    plan,
    now,
    localDate,
    streakDays,
    droppedCount,
    appUrl,
  );

  // Once the exam has passed the coach signs off, exactly once, and then stops.
  // The uniqueness guard is per local DATE, so without this the sign-off, whose
  // own copy says there will be no further emails, would be sent every single
  // morning for the rest of the plan's life.
  let signedOff = false;
  if (state.horizon === "past") {
    signedOff =
      (await db.emailSend.count({ where: { planId, dialogueKey: "P_PAST" } })) > 0;
  }

  // Push is not claimed without a device, so a phone registered later the
  // same day still receives the slot instead of finding it already "sent".
  const hasDevice = (await db.pushSubscription.count({ where: { userId: plan.userId } })) > 0;

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

    // Rendered ONCE for both channels. Two render calls could legitimately pick
    // different variants, since the picker rotates by date, and the candidate
    // would then get a notification contradicting their inbox.
    //
    // localDate is what rotates the variant, and the context is what lets the
    // horizon, phase and weather tags narrow the pool. Omitting either would
    // collapse every pool to one fixed line for the life of the plan.
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

    let claimedEither = false;

    if (emailSlots.includes(slot)) {
      const claimed = await claimSend(planId, localDate, slot, "email", key);
      if (claimed) {
        claimedEither = true;
        try {
          await sender({
            to: user.email,
            subject,
            html,
            text,
            priority: "high",
            headers: {
              // RFC 8058 one-click. The Post header is what turns the
              // List-Unsubscribe URL into Gmail's and Outlook's own native
              // control, and it POSTs, which is why the route separates a GET
              // that confirms from a POST that acts.
              "List-Unsubscribe": `<${emailUnsubscribe}>`,
              "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            },
          });
          await db.emailSend.update({ where: { id: claimed.id }, data: { sentAt: now } });
          sent.push(slot);
        } catch (err) {
          await recordFailure(claimed.id, err);
          failed.push(slot);
        }
      }
    }

    // An independent delivery with its own claim. A candidate with email off
    // and push on must still receive exactly one notification per slot per day,
    // and a bounced email must not suppress the phone: same message, different
    // send.
    if (pushSlots.includes(slot) && hasDevice) {
      const claimed = await claimSend(planId, localDate, slot, "push", key);
      if (claimed) {
        claimedEither = true;
        try {
          const result = await pushModule.sendPushToUser(plan.userId, { ...push, urgent: true });
          if (result.delivered === 0) {
            throw new Error(`no device accepted the push (${result.failed} failed)`);
          }
          await db.emailSend.update({ where: { id: claimed.id }, data: { sentAt: now } });
          pushSent.push(slot);
        } catch (err) {
          await recordFailure(claimed.id, err);
          pushFailed.push(slot);
        }
      }
    }

    // Neither channel claimed: both lost the race to a concurrent or earlier
    // run of this exact slot.
    if (!claimedEither) {
      skipped.push(slot);
    }
  }

  return { sent, skipped, failed, pushSent, pushFailed };
}

export type CoachContext = {
  state: ReturnType<typeof classify>;
  vars: DialogueVars;
  mailData: MailData;
  context: LineContext;
  user: { id: string; email: string };
  emailUnsubscribe: string;
};

/**
 * Everything the coach knows about a plan's day: its state and the variables
 * its copy needs. Shared by the real run and the preview, so a preview shows
 * exactly what a send would. Reads only; regeneration is the caller's call.
 */
export async function buildCoachContext(
  plan: Awaited<ReturnType<typeof db.studyPlan.findUniqueOrThrow>>,
  now: Date,
  localDate: string,
  streakDays: number,
  droppedCount: number,
  appUrl: string,
): Promise<CoachContext> {
  const planId = plan.id;
  const todayDate = new Date(localDate + "T00:00:00Z");
  const weeklyAvailability = plan.weeklyAvailability as Record<string, number>;
  void now;

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
  // Per channel, because the signature covers the channel: an email footer link
  // must not be editable into one that silences the phone.
  const emailUnsubscribe = unsubscribeUrl(planId, "email", appUrl);

  const mailData: MailData = {
    tasks: mailTasks,
    coveragePercent,
    daysToExam,
    planUrl: `${appUrl}/plan/today`,
    unsubscribeUrl: emailUnsubscribe,
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

  return { state, vars, mailData, context, user, emailUnsubscribe };
}

export type CoachPreview = {
  slot: Slot | null;
  /** The event the coach chose, or null when it would stay quiet. */
  key: DialogueKey | null;
  state: { horizon: string; phase: string; streakDays: number; tasksDone: number; taskCount: number };
  message: { subject: string; text: string; html: string; push: PushPayload } | null;
};

/**
 * What the coach would send, without sending, claiming the day's slot or
 * rebuilding the plan. Either the slot (the coach picks the event from the
 * candidate's real state, as at send time) or a specific event (rendered with
 * the same real numbers, to read any message the coach can write).
 */
export async function previewCoach(
  planId: string,
  now: Date,
  target: { slot: Slot } | { key: DialogueKey },
): Promise<CoachPreview> {
  const plan = await db.studyPlan.findUniqueOrThrow({ where: { id: planId } });
  const localDate = localDateFor(now, plan.timeZone);
  const yesterday = addUTCDays(new Date(localDate + "T00:00:00Z"), -1);
  const streakDays = await computeStreakDays(
    planId,
    plan.weeklyAvailability as Record<string, number>,
    plan.startDate,
    yesterday,
  );
  const appUrl = process.env.FRONTEND_BASE_URL ?? "";
  const built = await buildCoachContext(plan, now, localDate, streakDays, 0, appUrl);

  const slot = "slot" in target ? target.slot : null;
  const key = "slot" in target ? dialogueFor(target.slot, built.state) : target.key;
  const state = {
    horizon: built.state.horizon,
    phase: built.state.phase,
    streakDays,
    tasksDone: built.vars.n,
    taskCount: built.vars.taskCount,
  };
  if (key === null) return { slot, key, state, message: null };

  const rendered = renderCoachMail(key, built.vars, built.mailData, localDate, built.context, "coach-preview");
  return { slot, key, state, message: rendered };
}
