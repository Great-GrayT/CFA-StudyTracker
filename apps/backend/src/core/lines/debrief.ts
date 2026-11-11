/**
 * Night debrief lines, keyed by what was actually logged against what was asked.
 * This is the only slot that reports rather than instructs.
 */

import type { DialogueLine } from "./types.ts";

export const POOLS: Record<string, DialogueLine[]> = {
  D_LOST_FIRST: [
    {
      subject: "Day closed. Nothing logged.",
      opening: "I see dead days. This was one. Gone, and written down as the zero it was.",
      pressure: "{todayMinutes} minutes have moved to tomorrow to sit with everything else.",
      close: "Tomorrow we try again. I will be back at half six.",
    },
    {
      subject: "That is one day, then.",
      opening: "Frankly, my dear, the exam does not give a damn. Neither does the calendar. I, however, took notes.",
      pressure: "Your first missed day. Tomorrow inherits {todayMinutes} minutes.",
      close: "One clean day erases this. Two more and it becomes a story.",
    },
    {
      subject: "Nothing. Noted.",
      opening: "The day asked you a simple question and received no answer at all.",
      pressure: "Streak: 1. Tomorrow carries today, which makes tomorrow heavier than it was designed to be.",
      close: "Start tomorrow with {firstTask}.",
    },
    {
      subject: "Pay no attention to the empty log behind the curtain",
      opening: "{name}, today asked a simple question and got silence for an answer. I noticed. I always notice.",
      pressure: "{todayMinutes} minutes slide into tomorrow's pile, which did not need the company.",
      close: "Start tomorrow with {firstTask}.",
    },
    {
      subject: "One ghost of a missed day. No more needed.",
      opening: "Consider this the ghost of today's absence, {name}. It arrives once, politely, and does not need a sequel.",
      pressure: "{todayMinutes} minutes carry forward. One clean day puts this behind you entirely.",
      close: "{firstTask}, tomorrow, first thing.",
    },
    {
      subject: "Cold out, and colder in the log tonight",
      opening: "It was cold today, {name}, and the log is colder: nothing in it at all.",
      pressure: "{todayMinutes} minutes move to tomorrow. The weather is a reason. It is not an excuse twice.",
      close: "Start tomorrow with {firstTask}.",
      weather: ["cold"],
    },
    {
      subject: "Dark by five, and the log went dark too",
      opening: "The sun left early today, {name}, and apparently so did you, before a single task got touched.",
      pressure: "{todayMinutes} minutes carry over into a day with more daylight to use them.",
      close: "Tomorrow, start with {firstTask} before the dark comes back.",
      weather: ["dark-early"],
    },
  ],
  D_LOST_STREAK: [
    {
      subject: "Day closed. Day {streak}.",
      opening: "And that is another one. Gone. I am writing it down as a zero, because that is exactly what it was.",
      pressure: "The streak is now {streak}, and {todayMinutes} minutes have joined the pile waiting for tomorrow.",
      close: "Tomorrow we try again. Or we do not, and I keep counting.",
    },
    {
      subject: "{streak} days. The ledger is unforgiving.",
      opening: "I see dead days, and tonight I am rather spoiled for choice.",
      pressure: "{streak} consecutive zeros. {coveragePercent}% covered with {daysToExam} days remaining. The projection moves to {finishDate}.",
      close: "Tomorrow: {taskCount} tasks, every one of them older than it should be.",
    },
    {
      subject: "Another zero for the collection",
      opening: "Round up the usual excuses. I have heard them, filed them, and found them wanting.",
      pressure: "Streak {streak}. {todayMinutes} minutes deferred again. The pile does not forget, and neither do I.",
      close: "Tomorrow starts with {firstTask}.",
    },
    {
      subject: "Day {streak} closed with nothing",
      opening: "You wanted to know how you got this backlog. Tonight is the answer, repeated for the {streak}th time.",
      pressure: "{coveragePercent}% covered, {daysToExam} days left, finish projected {finishDate}.",
      close: "One task tomorrow breaks this. Just one.",
    },
    {
      subject: "Say my name. It is Day {streak}.",
      opening: "Say my name. Day {streak}, and I intend to keep saying it until the number changes.",
      pressure: "{coveragePercent}% covered, {daysToExam} days left, projected finish {finishDate}. The pile grows regardless of how quietly it arrives.",
      close: "Tomorrow: {firstTask}, first thing.",
    },
  ],
  D_PARTIAL: [
    {
      subject: "{n} of {taskCount}. Partial credit.",
      opening: "{n} out of {taskCount} is not bad. It is also not {taskCount}.",
      pressure: "The rest rolls into tomorrow, which is heavier now than it was this morning. The pile does not forget.",
      close: "Start tomorrow with {firstTask}.",
    },
    {
      subject: "Some of it. Credited.",
      opening: "You did part of the work, which puts you ahead of the version of you that did none.",
      pressure: "{n} of {taskCount} logged. The remainder moves to tomorrow with interest.",
      close: "Tomorrow begins with {firstTask}.",
    },
    {
      subject: "{n} logged. {taskCount} asked.",
      opening: "Half measures. I have seen worse tonight, and I have certainly seen worse from you.",
      pressure: "{coveragePercent}% covered, {daysToExam} days to go. Partial days keep the streak at zero, which is the point.",
      close: "Tomorrow: {firstTask} first.",
    },
    {
      subject: "Life finds a way to {n} of {taskCount}",
      opening: "Life finds a way, apparently, to exactly {n} of {taskCount} tasks tonight.",
      pressure: "{coveragePercent}% covered, {daysToExam} days to go. The rest of the list did not finish itself, and will not.",
      close: "Tomorrow starts with {firstTask}.",
    },
    {
      subject: "O candidate, my candidate, {n} of {taskCount} done",
      opening: "O captain, my captain, you logged {n} of {taskCount} tonight, which is not nothing and is not everything either.",
      pressure: "The remainder moves to tomorrow, {coveragePercent}% covered with {daysToExam} days left to close the gap.",
      close: "{firstTask} first, tomorrow.",
    },
  ],
  D_PARTIAL_BEHIND: [
    {
      subject: "{n} of {taskCount}, and the streak is broken",
      opening: "You logged something. After {streak} days of nothing, I will take it and I will not even be sarcastic about it. Much.",
      pressure: "{n} of {taskCount} done. The streak resets to zero, which is worth more than the minutes.",
      close: "Do that again tomorrow, starting with {firstTask}.",
    },
    {
      subject: "Partial day, streak ended",
      opening: "Snap out of it, you said to yourself, apparently. It worked, partially.",
      pressure: "{n} of {taskCount} logged after {streak} days of silence. The remainder moves to tomorrow, but the streak is dead and that matters more.",
      close: "Tomorrow: {firstTask}.",
    },
    {
      subject: "{n} tasks. A pulse, at last.",
      opening: "It is alive. Your study plan, I mean. Barely, and with visible stitching.",
      pressure: "{n} of {taskCount} done. {coveragePercent}% covered, {daysToExam} days remaining.",
      close: "Again tomorrow, starting with {firstTask}.",
    },
    {
      subject: "How do you like them {n} of {taskCount}?",
      opening: "After {streak} days of silence, you logged {n} of {taskCount}. How do you like that, said nobody, except me, just now.",
      pressure: "The remainder moves to tomorrow, but the streak is finished, and that is the number that mattered tonight.",
      close: "Again tomorrow, starting with {firstTask}.",
    },
    {
      subject: "The game is afoot again. {n} of {taskCount}.",
      opening: "The game is afoot again, after {streak} days of nothing. {n} of {taskCount}, which counts as a confession of life.",
      pressure: "The rest carries forward, but the silence is over, and that was the harder part to fix.",
      close: "Tomorrow: {firstTask}, and keep the pulse going.",
    },
  ],
  D_DONE: [
    {
      subject: "Done. {todayMinutes} minutes.",
      opening: "Everything on the list, logged. How disappointing. I had material prepared.",
      pressure: "{coveragePercent}% covered, {daysToExam} days to go.",
      close: "That will do, candidate. I will be back at half six.",
    },
    {
      subject: "Full day logged",
      opening: "All {taskCount} tasks. Not a single opening for me to work with. Infuriating.",
      pressure: "{coveragePercent}% covered with {daysToExam} days left. This is what on pace looks like.",
      close: "Same time tomorrow.",
    },
    {
      subject: "{todayMinutes} minutes, all accounted for",
      opening: "You did the work and now I have nothing clever to say, which is its own kind of victory for you.",
      pressure: "{coveragePercent}% covered, {daysToExam} days remaining.",
      close: "Tomorrow: {taskCount} tasks. I will bring better jokes.",
    },
    {
      subject: "Chariots of fire, tasks of done",
      opening: "Every task done, {todayMinutes} minutes logged, and somewhere a slow motion beach run is playing in your honour.",
      pressure: "{coveragePercent}% covered, {daysToExam} days to go. This is what on pace actually looks like, in case you forgot.",
      close: "Same time tomorrow.",
    },
    {
      subject: "Wax on, wax off. Every task, logged.",
      opening: "{taskCount} tasks, all of them done, the hard way, the only way that actually works.",
      pressure: "{coveragePercent}% covered, {daysToExam} days remaining. Clean runs like this are the whole point of a plan.",
      close: "Tomorrow: {taskCount} tasks. Same standard.",
    },
    {
      subject: "A clear evening to match a clear log",
      opening: "Clear outside, clear in the log: {todayMinutes} minutes, everything done, {name}.",
      pressure: "{coveragePercent}% covered, {daysToExam} days to go. Go and enjoy the evening you actually earned.",
      close: "Same time tomorrow.",
      weather: ["clear-warm"],
    },
    {
      subject: "Rain outside, nothing left undone inside",
      opening: "It is pouring out there, {name}, and in here every task on the list is logged regardless.",
      pressure: "{coveragePercent}% covered, {daysToExam} days remaining. Weather like this makes the discipline count double.",
      close: "Dry off. Same time tomorrow.",
      weather: ["rain"],
    },
  ],
  D_DONE_COMEBACK: [
    {
      subject: "A full day. After all that.",
      opening: "Every task, logged, after {streak} days of nothing. I had written the obituary. I shall have to file it.",
      pressure: "The streak is dead at {streak}. {coveragePercent}% covered, {daysToExam} days left.",
      close: "Do it again tomorrow and I will start to look foolish. Please make me look foolish.",
    },
    {
      subject: "You came back. Noted properly.",
      opening: "Why do we fall, candidate? So we can get up and clear an entire day's list, apparently.",
      pressure: "{todayMinutes} minutes logged, streak broken at {streak}, {coveragePercent}% covered.",
      close: "Tomorrow: {firstTask}. Keep this going.",
    },
    {
      subject: "Streak broken. Day complete.",
      opening: "I am genuinely pleased, which I will deny if asked.",
      pressure: "A complete day after {streak} missed. The backlog is still there, but the trend has turned, and the trend is what kills or saves you.",
      close: "Same time tomorrow. Bring that again.",
    },
    {
      subject: "Everything logged. I am almost speechless.",
      opening: "Round up the usual suspects, and then release them, because tonight you did the work.",
      pressure: "{coveragePercent}% covered, {daysToExam} days remaining, streak reset from {streak} to zero.",
      close: "Tomorrow starts with {firstTask}.",
    },
    {
      subject: "Groundhog day ends. A real one begins.",
      opening: "Same alarm, same desk, but tonight, unlike the {streak} before it, the day actually happened.",
      pressure: "{todayMinutes} minutes logged, {coveragePercent}% covered, {daysToExam} days left. The streak is dead and I am, reluctantly, pleased.",
      close: "Tomorrow: {firstTask}. Keep showing up.",
    },
  ],
  D_OVER: [
    {
      subject: "You overdid it. Delightful.",
      opening: "You went to eleven. Every minute past the plan is credited in full, because I am not a monster.",
      pressure: "A word of caution, and I do hate being sensible: the plan runs on your real weekly hours, not your best night. One heroic evening is not a strategy.",
      close: "Tomorrow is still tomorrow.",
    },
    {
      subject: "Past the plan. Showing off.",
      opening: "More than I asked for. I will take it, and I will quietly wonder what you are compensating for.",
      pressure: "{coveragePercent}% covered, {daysToExam} days left. Worth saying: a sprint tonight does not buy a lie-in tomorrow. The plan does not work that way.",
      close: "Tomorrow: {taskCount} tasks, as scheduled.",
    },
    {
      subject: "Overshot. Credited in full.",
      opening: "To the exam and beyond, apparently. Mostly to the exam, but the enthusiasm is noted.",
      pressure: "Every extra minute counts toward coverage. One caution: the plan assumes your weekly hours, so tonight does not license tomorrow off.",
      close: "Same time tomorrow.",
    },
    {
      subject: "More than asked. Less than wise.",
      opening: "You beat the plan. I am impressed, and slightly suspicious of the sustainability.",
      pressure: "{coveragePercent}% covered with {daysToExam} days to go. Consistency beats heroics, and the plan is built on the former.",
      close: "Tomorrow: {firstTask}.",
    },
    {
      subject: "A quarter mile at a time. You did the whole mile.",
      opening: "You went well past what was asked, and I am crediting every minute of it, because I am not a monster twice in one file.",
      pressure: "{coveragePercent}% covered, {daysToExam} days left. One strong night does not rewrite the weekly plan, so do not expect tomorrow to be light.",
      close: "Tomorrow: {firstTask}, same as any other day.",
    },
  ],
};
