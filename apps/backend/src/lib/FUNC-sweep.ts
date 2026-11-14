// One coach sweep: freeze each active plan's progress for the day, then run
// the coach for it. Called by the in-process scheduler and by GET
// /api/cron/tick, so both paths do exactly the same thing.
//
// The snapshot maths lives in lib/snapshot.ts because POST /api/cron/run runs
// the same computation for a single plan.
import { db } from "./db";
import { writeSnapshotForPlan, startOfUTCDay } from "./snapshot";
// Namespace import, not destructured, matching the convention documented in
// FUNC-push.ts: a destructured value import binds at import time, before any
// spy is installed, so a test could not intercept the call made here.
import * as coachModule from "./FUNC-coach";
import * as scheduleModule from "./FUNC-schedule";
import { parseSchedule, planningDate } from "../core/slots";
import type { StudyPlan } from "@prisma/client";

/**
 * The day-end replan. The study day ends at the plan's debrief time; from then
 * on the plan is built from tomorrow (planningDate). This rebuilds once each
 * time that day moves past the one the horizon was built for, so today's
 * tasks are frozen as they stand and skipped work goes back into the plan even
 * if the candidate never opens the app. Returns whether it rebuilt. A failure is logged and left for
 * the next sweep, never thrown, so one plan cannot cost the others theirs.
 */
export async function rebuildIfNewDay(plan: StudyPlan, now: Date): Promise<boolean> {
  const from = planningDate(now, plan.timeZone, parseSchedule(plan.coachSchedule));
  if (plan.horizonGeneratedFor && plan.horizonGeneratedFor >= from) return false;
  try {
    await scheduleModule.generateHorizon(plan.id, from);
    return true;
  } catch (err) {
    console.error(`sweep: day-end rebuild failed for plan ${plan.id}`, err);
    return false;
  }
}

export type SweepResult = {
  plansProcessed: number;
  plansFailed: number;
  plansSkipped: number;
  emailsSent: number;
};

export async function runSweep(): Promise<SweepResult> {
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

    // Last, in the order the day ends: the snapshot has judged the day, the
    // debrief has reported it, and only now is the plan rebuilt from tomorrow.
    await rebuildIfNewDay(plan, now);
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

  return { plansProcessed, plansFailed, plansSkipped, emailsSent };
}
