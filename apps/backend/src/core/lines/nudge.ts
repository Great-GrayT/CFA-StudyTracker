/**
 * Evening nudge lines, sent only when the day is live and nothing is logged yet.
 * Short by design: this one lands while the candidate still has hours left.
 */

import type { DialogueLine } from "./types.ts";

export const POOLS: Record<string, DialogueLine[]> = {
  N_FIRST: [
    {
      subject: "Nothing logged yet. Just saying.",
      opening: "Show me the minutes. {todayMinutes} of them are sitting there untouched, like a patient little pile.",
      pressure: "The day closes at midnight and I write down what happened.",
      close: "Make it interesting.",
    },
    {
      subject: "{todayMinutes} minutes, still waiting",
      opening: "Just keep logging. That is the entire philosophy, and you have not started.",
      pressure: "Midnight closes the day. Whatever is unlogged is counted as missed, and I do the counting.",
      close: "One task is enough to keep the record clean.",
    },
    {
      subject: "Still time. Barely worth mentioning.",
      opening: "I am not nagging. I am simply here, at this hour, with a list, mentioning it.",
      pressure: "{taskCount} tasks and {todayMinutes} minutes remain untouched with the evening running out.",
      close: "Start with {firstTask}.",
    },
    {
      subject: "Don't panic. Just log something.",
      opening: "Don't panic, it says on the cover. Inside, it says {todayMinutes} minutes are still sitting untouched.",
      pressure: "Midnight closes the day, and I am the one holding the towel.",
      close: "One task. That is the entire guide.",
    },
    {
      subject: "I never drink wine. I do keep records.",
      opening: "I never drink wine, and I never skip the midnight count either. Tonight's log is still empty.",
      pressure: "{taskCount} tasks and {todayMinutes} minutes are still out there, undisturbed, like everything else in this house after dark.",
      close: "Start with {firstTask} before the sun, or I, come up.",
    },
    {
      subject: "Early dark, later excuse",
      opening: "The dark came down hours ago, and the list is still exactly as empty as it was in daylight.",
      pressure: "{todayMinutes} minutes remain before midnight does the counting for both of us.",
      close: "One task before the lights actually go out.",
      weather: ["dark-early"],
    },
    {
      subject: "Cold outside. No warmer on the list.",
      opening: "It is cold enough out there to make the desk look generous, and still nothing logged.",
      pressure: "{taskCount} tasks and {todayMinutes} minutes are waiting, unbothered by the temperature.",
      close: "Start with {firstTask}. The radiator is right there.",
      weather: ["cold"],
    },
  ],
  N_SLIP: [
    {
      subject: "Two in a row would be a pattern",
      opening: "You missed yesterday. It is evening again and the list is untouched again. I am seeing a theme.",
      pressure: "One missed day is bad luck. Two is a decision.",
      close: "One task tonight and it stays bad luck.",
    },
    {
      subject: "Day two is still avoidable",
      opening: "After all, tomorrow is another day. You said that yesterday, and look where we are.",
      pressure: "{todayMinutes} minutes unlogged, with midnight approaching and yesterday already on the record.",
      close: "Start with {firstTask}.",
    },
    {
      subject: "I will be back at midnight",
      opening: "I will be back at midnight to write this day down. I would prefer to write something flattering.",
      pressure: "Nothing logged yet, and yesterday was also nothing.",
      close: "One task. That is the whole request.",
    },
    {
      subject: "Inconceivable. And yet, two in a row.",
      opening: "Inconceivable, you said, when I warned you yesterday might repeat. And yet.",
      pressure: "{todayMinutes} minutes unlogged, with yesterday's zero still fresh on the record.",
      close: "Start with {firstTask}. The word still means what I think it means.",
    },
    {
      subject: "Bah, humbug, says the empty log",
      opening: "Bah, humbug, you might say, about logging two nights running. I remain unmoved and unconvinced.",
      pressure: "Nothing tonight, and yesterday was also nothing. The pattern is writing itself.",
      close: "One task tonight, before I start seeing ghosts of streaks past.",
    },
  ],
  N_DRIFT: [
    {
      subject: "Day {streak} is still salvageable. Barely.",
      opening: "Good evening, candidate. Nothing logged. Again. We both know how this one ends, but go on, surprise me.",
      pressure: "After all, tomorrow is another day. You have told yourself that {streak} times now.",
      close: "One task tonight holds the streak at {streak}. Such a small difference. Such an enormous difference.",
    },
    {
      subject: "{streak} days, and tonight is going the same way",
      opening: "I had hoped tonight would be different. Hope, it turns out, is not a scheduling strategy.",
      pressure: "{todayMinutes} minutes untouched. Logging one task stops the streak at {streak} instead of extending it.",
      close: "Start with {firstTask}.",
    },
    {
      subject: "Still nothing. Day {streak}.",
      opening: "Introduce a little anarchy, upset the established order, and everything becomes chaos. You have been very thorough.",
      pressure: "Midnight is coming and {todayMinutes} minutes are still sitting there.",
      close: "One task. Hold the line at {streak}.",
    },
    {
      subject: "I have a bad feeling about tonight, day {streak}",
      opening: "I have a bad feeling about this, and I have had it for {streak} nights running now.",
      pressure: "{todayMinutes} minutes untouched. The Force is not going to log this for you.",
      close: "One task tonight. Hold the streak at {streak}.",
    },
    {
      subject: "Second star to the right. Day {streak}, still dark.",
      opening: "Second star to the right, straight on till morning, and still nothing logged on night {streak}.",
      pressure: "{todayMinutes} minutes are sitting there, refusing to grow up and log themselves.",
      close: "One task. Hold {streak} where it is.",
    },
  ],
  N_SERIOUS: [
    {
      subject: "Day {streak}, and the evening is nearly gone",
      opening: "{streak} days. Nothing tonight either. I am no longer surprised, only attentive.",
      pressure: "Your projected finish is {finishDate} and every unlogged evening pushes it further out.",
      close: "One task tonight. It genuinely changes the number.",
    },
    {
      subject: "Nothing logged. {finishDate} is getting later.",
      opening: "What we have here is a failure to log, now in its {streak}th consecutive performance.",
      pressure: "{coveragePercent}% covered, {daysToExam} days left, finish projected {finishDate}.",
      close: "Start with {firstTask} before midnight files this one too.",
    },
    {
      subject: "Day {streak}. The evening is still yours.",
      opening: "You can still rescue tonight. That window closes in a few hours and I will note the exact minute.",
      pressure: "{streak} days missed, {droppedCount} items already dropped from the plan.",
      close: "One task.",
    },
    {
      subject: "Get busy logging, or get busy explaining",
      opening: "Get busy logging, or get busy explaining. Day {streak} does not leave much room for a third option.",
      pressure: "{coveragePercent}% covered, {daysToExam} days left, finish projected {finishDate}. A hole only gets smaller if you dig.",
      close: "One task tonight. It genuinely changes the number.",
    },
    {
      subject: "How do you like them numbers, day {streak}",
      opening: "How do you like them numbers. {streak} days, and the finish date keeps sliding to {finishDate}.",
      pressure: "{daysToExam} days left, {coveragePercent}% covered. Genius or not, nobody gets a bye on this arithmetic.",
      close: "Start with {firstTask} before midnight files this one too.",
    },
  ],
  N_CRISIS: [
    {
      subject: "Day {streak}. Tonight, or we talk properly.",
      opening: "{streak} days. I am not asking for the plan any more. I am asking for one task, tonight, as a gesture.",
      pressure: "{coveragePercent}% covered, {daysToExam} days left. The plan no longer fits regardless, but a zero tonight makes a liar of any recovery.",
      close: "One task. Or open the app and move the date. Both are better than this.",
    },
    {
      subject: "Still nothing, on day {streak}",
      opening: "I have made my peace with the arithmetic. I am curious whether you have.",
      pressure: "{daysToExam} days, {coveragePercent}% covered, finish projected {finishDate}.",
      close: "One task tonight, or choose a door in the app. Anything but another zero.",
    },
    {
      subject: "The evening is going the way of the week",
      opening: "Nothing logged, on day {streak}, with the exam {daysToExam} days out. At some point this stops being a study problem.",
      pressure: "{coveragePercent}% covered. Adding hours or moving the exam are both still available. Doing neither is not a third option, it is the first one with extra steps.",
      close: "Open the app.",
    },
    {
      subject: "Red pill, blue pill, day {streak}",
      opening: "There is no spoon, and after {streak} days there is no version of this plan either.",
      pressure: "{coveragePercent}% covered, {daysToExam} days left. One pill is more hours a week. The other pill is moving the exam date. There is no third pill.",
      close: "Choose tonight: add hours, or move the date.",
    },
    {
      subject: "Shall we play a game, day {streak}",
      opening: "Shall we play a game? Day {streak}, and the only losing move left is pretending the board has not changed.",
      pressure: "{coveragePercent}% covered, {daysToExam} days left. The machine ran every scenario. Two of them end well.",
      close: "Add hours this week, or move the exam date. Every other move loses.",
    },
  ],

  // --------------------------------------------------------------- debriefs,
};
