/**
 * Lines for the message ladder: the stage-specific morning, the mock-window midday,
 * the extra nudges that stack up when the candidate is behind, and the one daily
 * "plan does not fit" notice. Tone gets firmer as the ladder climbs.
 */

import type { DialogueLine } from "./types.ts";

export const POOLS: Record<string, DialogueLine[]> = {
  P_STAGE_REVIEW: [
    {
      subject: "Review season. {todayMinutes} minutes.",
      opening: "The first pass is behind you, so now the work is making it stick. {taskCount} tasks today, starting with {firstTask}.",
      pressure: "Material you read once is material you will forget by the exam. Review is where the marks are kept.",
      close: "Do the review before anything new.",
    },
    {
      subject: "Today is about retrieval",
      opening: "Reading it again is not review. Answering questions on it is. {firstTask} is first.",
      pressure: "{daysToExam} days to the exam and {readiness} percent of the plan is passed so far.",
      close: "Start with the questions you would rather skip.",
    },
    {
      subject: "{taskCount} review tasks, no hiding",
      opening: "This stretch is steps 3 and 4: review, then practice that proves it. {todayMinutes} minutes are set aside.",
      pressure: "Every pass you bank now is one fewer surprise later.",
      close: "Begin with {firstTask}.",
    },
    {
      subject: "Lock it in",
      opening: "You have learned it. Now prove it. {firstTask} is where that starts.",
      pressure: "Nobody regrets the hour they spent on this.",
      close: "{todayMinutes} minutes, then you are done for the day.",
    },
  ],
  P_STAGE_MOCK: [
    {
      subject: "Mock window. {daysToExam} days out.",
      opening: "This is the stretch where mocks decide what you revise. {taskCount} tasks today, {todayMinutes} minutes, starting with {firstTask}.",
      pressure: "A mock score is the only honest forecast you will get, and the plan bends around it.",
      close: "Treat every sitting like the real one.",
    },
    {
      subject: "Mocks, review, repeat",
      opening: "Within a month of the exam the loop is simple: sit a mock, mark it, fix what it exposed. {firstTask} first today.",
      pressure: "{readiness} percent passed against {readinessPlan} percent where the plan wants you.",
      close: "Do not skip the mock review. That is where the learning is.",
    },
    {
      subject: "The final stretch begins at {firstTask}",
      opening: "Your day is built from mock results now. {todayMinutes} minutes of exactly what will cost you marks.",
      pressure: "{daysToExam} days is enough, if none of them are wasted.",
      close: "Start now.",
    },
    {
      subject: "No new ground, only gaps",
      opening: "Mock window. Every task today closes a gap a mock found, or tests that a gap has closed.",
      pressure: "The plan only works if the middle of the day gets used.",
      close: "{taskCount} tasks, {todayMinutes} minutes. Go.",
    },
  ],
  M_MIDDAY_MOCK: [
    {
      subject: "Midday check: where are you?",
      opening: "Halfway through the day and {daysToExam} days from the exam. {taskCount} tasks are on the list.",
      pressure: "In the mock window the middle of the day is where the day is won or lost.",
      close: "Log what you have done and start the next one.",
    },
    {
      subject: "Mock window, midday",
      opening: "A quick look at the clock and at the list. {firstTask} should not still be waiting.",
      pressure: "Every hour from here is a smaller slice of a shrinking {daysToExam} days.",
      close: "One task now.",
    },
    {
      subject: "Noon in the mock window",
      opening: "Nothing dramatic, just a reminder that the plan expects progress by now.",
      pressure: "A day behind costs one session. A habit of it costs the exam.",
      close: "Tick something off and keep going.",
    },
    {
      subject: "Midday, {todayMinutes} minutes owed",
      opening: "The exam does not care that it is lunchtime. {taskCount} tasks are on today's list, and they are yours.",
      pressure: "Fall behind now and the final weeks get crowded.",
      close: "Start with {firstTask}.",
    },
  ],
  X_BEHIND_1: [
    {
      subject: "You are a day behind",
      opening: "One day has slipped and the plan has noticed. Overdue: {overdueList}.",
      pressure: "A day behind is easy to recover. A week behind is a different conversation.",
      close: "Clear one overdue task today.",
    },
    {
      subject: "Small gap, easy fix",
      opening: "You are {daysBehind} day behind. Still on the list: {overdueList}.",
      pressure: "Small slips compound faster than they look.",
      close: "Do one of them now and the gap starts to close.",
    },
    {
      subject: "Catch-up check",
      opening: "Overdue and waiting: {overdueList}. Extra work on file: {extraReason}.",
      pressure: "Readiness stands at {readiness} percent, and the plan wants {readinessPlan} percent by now.",
      close: "Pick the first one and begin.",
    },
    {
      subject: "Behind by a day, not by much",
      opening: "This is a nudge, not a lecture. {overdueList} is still open.",
      pressure: "A tight plan has no days to spare.",
      close: "Ten focused minutes counts.",
    },
  ],
  X_BEHIND_3: [
    {
      subject: "{daysBehind} days behind. This needs attention.",
      opening: "The backlog is no longer a rounding error. Overdue: {overdueList}.",
      pressure: "Readiness is {readiness} percent against {readinessPlan} percent planned, and the gap widens with every skipped day.",
      close: "Stop what you are doing and clear the first item.",
    },
    {
      subject: "The gap is growing",
      opening: "You are {daysBehind} days behind and I am writing again because the list has not moved. {overdueList}.",
      pressure: "Extra work is being added for a reason: {extraReason}.",
      close: "Open the plan and do one thing now.",
    },
    {
      subject: "Time to catch up, properly",
      opening: "{daysBehind} days of work are queued: {overdueList}. {daysToExam} days remain.",
      pressure: "Waiting for a better day is how a gap becomes a crisis.",
      close: "Today, not tomorrow.",
    },
    {
      subject: "Please do not ignore this one",
      opening: "I have been patient. {daysBehind} days behind is where patience stops being useful.",
      pressure: "Still open: {overdueList}.",
      close: "Start with the smallest and build momentum.",
    },
  ],
  X_BEHIND_7: [
    {
      subject: "{daysBehind} days behind. This is serious.",
      opening: "A week or more of work is outstanding: {overdueList}. {daysToExam} days to the exam.",
      pressure: "At {readiness} percent against {readinessPlan} percent planned, the plan will not recover on its own.",
      close: "Open the plan now and work through the list in order.",
    },
    {
      subject: "Last call before the plan breaks",
      opening: "You are {daysBehind} days behind and the messages will keep coming until the list moves. {overdueList}.",
      pressure: "Extra work on file: {extraReason}. None of this is optional any more.",
      close: "Do the first task now. Not after dinner.",
    },
    {
      subject: "The backlog is the whole plan now",
      opening: "{daysBehind} days of work, {overdueList}. There is no new material until this is cleared.",
      pressure: "Every day you wait makes the remaining days heavier.",
      close: "One hour, no phone, starting now.",
    },
    {
      subject: "This is the loudest I get",
      opening: "{daysBehind} days behind with {daysToExam} to go. The arithmetic is not on your side yet, but it can be.",
      pressure: "Overdue: {overdueList}.",
      close: "Begin. Report back when the first one is done.",
    },
  ],
  X_BELOW_PASS: [
    {
      subject: "The plan you chose is below a pass",
      opening: "You accepted a plan that trims work below what a pass needs, so every minute counts double. Overdue: {overdueList}.",
      pressure: "Readiness is {readiness} percent against {readinessPlan} percent planned, with {daysToExam} days left.",
      close: "No slack in this plan. Do the next task now.",
    },
    {
      subject: "No margin for error",
      opening: "This plan was cut to fit, and it only works if you hit every task. {overdueList} is still open.",
      pressure: "You can change the plan any time, but until you do, it holds you to this.",
      close: "Start with the first overdue item.",
    },
    {
      subject: "Another reminder, because the plan is tight",
      opening: "Below-pass plans fail on small slips. {daysBehind} days behind is not small here.",
      pressure: "No plan survives a gap this wide without a decision.",
      close: "Log something in the next hour.",
    },
    {
      subject: "Twelve a day is not a typo",
      opening: "You consented to a plan with no room. I will keep writing so it does not slip further.",
      pressure: "Overdue right now: {overdueList}.",
      close: "Do one, tell me, and I will go quiet for a while.",
    },
  ],
  D_PLAN_DOES_NOT_FIT: [
    {
      subject: "Your plan does not fit before the exam",
      opening: "The work you have left cannot be done in the days you have, even with every holiday cancelled.",
      pressure: "{daysToExam} days remain and readiness is {readiness} percent. Something has to change, and it is your call.",
      close: "Either add study time or accept a below-pass plan in the app. Both are one tap.",
    },
    {
      subject: "Decision needed: more time or a lighter plan",
      opening: "I cannot schedule everything you need before the exam. This message repeats each night until you choose.",
      pressure: "Your two options: raise your weekly availability, or accept the trimmed plan and the risk that comes with it.",
      close: "Open the plan settings and pick one.",
    },
    {
      subject: "The numbers do not add up",
      opening: "Required study exceeds what your calendar allows. Overdue so far: {overdueList}.",
      pressure: "Until you choose, the plan stays unbuildable as it stands.",
      close: "Extend your hours or accept below-pass. Tonight is a good night to decide.",
    },
    {
      subject: "Tonight: one decision",
      opening: "{daysToExam} days left, and the plan no longer fits. No judgment, only a fork.",
      pressure: "The longer this waits, the fewer options remain.",
      close: "Add time, or accept a lighter plan. Both are in settings.",
    },
  ],
};
