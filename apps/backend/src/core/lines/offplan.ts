/**
 * Lines for a candidate who studied, but not what the plan asked for.
 *
 * This file exists to fix a specific bug: the coach used to score effort by
 * counting ticked tasks, so a candidate who spent two hours on a topic the
 * plan never scheduled was told they had done nothing, and a candidate who
 * studied the right topic but forgot to tick the box got the same insult.
 * Both were working. The counting was wrong, not the candidate.
 *
 * The voice here never treats off-plan study as idleness. Every line credits
 * the work in the opening, in full, before the pressure names the mismatch.
 * The joke is misdirection, not laziness: the candidate escaped the room and
 * walked into a different one. Think of a villain who is genuinely impressed
 * by the escape and only then points out which trap it led to.
 */

import type { DialogueLine } from "./types.ts";

export const POOLS: Record<string, DialogueLine[]> = {
  // Evening nudge, around 8pm. Today's log has real minutes in it, just not
  // against today's list, and there are still hours left to fix that. Short,
  // energetic, and never mentions the streak: there is nothing to blame yet.
  N_OFF_PLAN: [
    {
      subject: "I will find you. And your task list.",
      opening:
        "You logged {offPlanCount} off-plan time(s) tonight, {name}, starting with {offPlanTopic}. A desk was clearly involved.",
      pressure:
        "I will find you, and I will redirect you: {firstTask} is still open, {taskCount} task(s) waiting, and the evening is not done.",
      close: "Open {firstTask} now. You have the hours.",
    },
    {
      subject: "Any road gets you somewhere. Not the exam.",
      opening: "Real work tonight, {name}: {offPlanTopic}, properly studied.",
      pressure:
        "Which road you take depends a good deal on where you want to get to, and tonight's destination was {firstTask}, still untouched with {daysToExam} day(s) on the clock.",
      close: "Pivot now. Open {firstTask}.",
    },
    {
      subject: "42 Wallaby Way is a fine address. Wrong one.",
      opening:
        "Real studying happened tonight, {name}, just at an address the plan never gave you: {offPlanTopic}.",
      pressure:
        "{firstTask} is the actual address, {taskCount} task(s) waiting, and there is still time to get there tonight.",
      close: "Redirect now: {firstTask}, before the evening closes.",
    },
    {
      subject: "Your compass works. It points at the wrong topic.",
      opening:
        "Jack Sparrow's compass points at what you want most, and tonight yours pointed, correctly, at {offPlanTopic}.",
      pressure:
        "It does not point at what today needed, which is {firstTask}, and the night is not over.",
      close: "Swing it back to {firstTask}. Now, while the hours last.",
    },
    {
      subject: "Not all who wander are lost. You, slightly.",
      opening:
        "Not all who wander are lost, {name}, but tonight's wandering landed on {offPlanTopic} instead of the list.",
      pressure:
        "{firstTask} is still waiting, {daysToExam} day(s) out, and there are hours left to find your way back to it.",
      close: "Open {firstTask}. Find your way back tonight.",
    },
    {
      subject: "Beam me up. Wrong coordinates, Scotty.",
      opening:
        "You beamed down somewhere real tonight, {name}: {offPlanTopic}. Just not the coordinates I sent.",
      pressure:
        "{firstTask} is still on today's manifest, {taskCount} task(s) in total, with time left on the clock.",
      close: "Re-route: {firstTask}, now, while the evening holds.",
    },
  ],

  // Night debrief for a candidate otherwise on track. Credit the work, name
  // the mismatch, say what it costs (the planned work requeues), point at
  // tomorrow. Wry, not harsh: this candidate is fine, just misdirected.
  D_OFF_PLAN: [
    {
      subject: "I have made fire. Wrong cave, candidate.",
      opening:
        "You put in real minutes tonight, {name}, on {offPlanTopic}, worked properly, which counts as effort nobody can take from you.",
      pressure:
        "It was not what today's list asked for. {firstTask} did not get touched, so it requeues, and {requeueCount} item(s) now move to tomorrow.",
      close: "Tomorrow, same desk, right island: start with {firstTask}.",
    },
    {
      subject: "Odysseus also took the scenic route",
      opening:
        "You did the work tonight, {name}, on {offPlanTopic} of all things, which is at least an interesting detour.",
      pressure:
        "{firstTask} stayed exactly where you left it, and {requeueCount} item(s) now sail into tomorrow with it.",
      close: "Tomorrow, skip the cyclops and start with {firstTask}.",
    },
    {
      subject: "Great effort. Wrong universe entirely.",
      opening:
        "You studied tonight, properly, {name}: {offPlanTopic} got real attention.",
      pressure:
        "It just was not the universe today's plan was set in. {firstTask} sits untouched, and {requeueCount} item(s) requeue to tomorrow.",
      close: "Tomorrow, swing back to this universe: {firstTask} first.",
    },
    {
      subject: "You went deeper. Into the wrong level.",
      opening: "Real hours tonight, {name}, spent properly on {offPlanTopic}.",
      pressure:
        "Today's level was {firstTask}, and it is still waiting, along with {requeueCount} item(s) now queued for tomorrow.",
      close: "Tomorrow, surface at the right level: start with {firstTask}.",
    },
    {
      subject: "Are you not entertained? I am, slightly.",
      opening:
        "{offPlanTopic}, {name}, worked hard and worked well tonight. Credit where it is owed.",
      pressure:
        "Today's arena was {firstTask}, and it did not get touched, so {requeueCount} item(s) step into tomorrow's lineup.",
      close: "Tomorrow, enter the right arena: {firstTask} first.",
    },
    {
      subject: "Wally World was closed. You still drove all day.",
      opening:
        "You drove hard tonight, {name}: {offPlanTopic}, properly covered, no argument there.",
      pressure:
        "Wrong destination, though. {firstTask} never got visited, and {requeueCount} item(s) pack themselves for tomorrow's trip.",
      close: "Tomorrow, point the car at {firstTask} first.",
    },
  ],

  // Night debrief for a candidate also carrying a missed-day streak. Still
  // credits the work in full, but firmer: effort pointed the wrong way while
  // already behind compounds the backlog instead of shrinking it.
  D_OFF_PLAN_BEHIND: [
    {
      subject: "Get busy living. Not get busy elsewhere.",
      opening:
        "You worked tonight, {name}, {streak} day(s) missed and all: {offPlanTopic} got real time, and that is not nothing.",
      pressure:
        "But effort pointed away from {firstTask} while you are already {streak} day(s) behind does not slow the backlog, it feeds it. {requeueCount} item(s) requeue on top of what was already waiting.",
      close: "Tomorrow, point it at {firstTask} first, before anything else.",
    },
    {
      subject: "True places never are on the map. Neither was tonight.",
      opening:
        "{offPlanTopic} got worked properly tonight, {name}. The effort is real and I am not pretending otherwise.",
      pressure:
        "That is the {streak}th day in a row the map and your evening have disagreed, and {firstTask} is still untouched. {requeueCount} item(s) now stack behind it.",
      close: "Tomorrow the map wins: {firstTask} first, no detours.",
    },
    {
      subject: "The battle is won before it starts. This one is not.",
      opening:
        "You put in the hours tonight, {name}, on {offPlanTopic}, and real hours always count.",
      pressure:
        "But {streak} day(s) behind, hours in the wrong place are a battle lost before {firstTask} even opens. {requeueCount} item(s) now wait behind it.",
      close: "Tomorrow, fight the actual battle: {firstTask} first.",
    },
    {
      subject: "Slow and steady loses, if it's running the wrong race",
      opening: "{offPlanTopic} again, {name}: steady effort, genuinely creditable.",
      pressure:
        "Slow and steady wins the race only if it is the right race. {streak} day(s) behind, and the hours keep landing somewhere other than {firstTask}. {requeueCount} item(s) now queue behind it.",
      close: "Tomorrow, {firstTask} first. Run the actual race.",
    },
    {
      subject: "Sisyphus had one rock. You have {requeueCount}.",
      opening:
        "Real effort went in tonight, {name}: {offPlanTopic}, properly studied.",
      pressure:
        "But {streak} day(s) behind, pushing the wrong rock up the hill does not move the real one. {firstTask} is still at the bottom, and {requeueCount} item(s) are stacked beside it.",
      close: "Tomorrow, pick up the actual rock: {firstTask} first.",
    },
    {
      subject: "A real clue, Leonard. Wrong file entirely.",
      opening:
        "{offPlanTopic} was a real clue tonight, {name}, chased down properly.",
      pressure:
        "It was not the file today needed, and {streak} day(s) behind, chasing the wrong clue does not reset the case, it reopens it. {firstTask} is still cold, {requeueCount} item(s) stacked behind it.",
      close: "Tomorrow, open the right file: {firstTask} first.",
    },
  ],
};
