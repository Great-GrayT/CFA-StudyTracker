/**
 * The days either side of a break.
 *
 * These exist because a holiday is a three-act structure and the old model saw
 * only the middle one. The day before a break is the last chance to bank
 * anything; the day after is the one that decides whether a planned rest
 * quietly became a streak. Both are higher-leverage than the break itself, and
 * both used to receive ordinary copy that ignored the break entirely.
 */

import type { DialogueLine } from "./types.ts";

export const POOLS: Record<string, DialogueLine[]> = {
  // Last working day before a scheduled break. The one place where "do it now"
  // is literally true rather than theatre, because tomorrow has no slot at all.
  P_HOLIDAY_AHEAD: [
    {
      subject: "All work and no play. Then, briefly, the reverse.",
      opening: "{name}, tomorrow the plan lets go of you for {restDays} day(s). Today it does not.",
      pressure: "{taskCount} task(s), {todayMinutes} minutes. Whatever you skip today does not wait politely for your return, it queues.",
      close: "Start with {firstTask}. Then go and be a person.",
    },
    {
      subject: "Leave the laptop. Take the coverage.",
      opening: "A break begins tomorrow, which means today is the last day anything you do counts before the silence.",
      pressure: "{coveragePercent}% covered, {daysToExam} days left. The break is priced into the plan. An unfinished today is not.",
      close: "{taskCount} task(s). {firstTask} first. Earn the holiday.",
    },
    {
      subject: "I will be back. {restDays} day(s), in fact.",
      opening: "Last day before your {restDays}-day disappearance, {name}. I have your schedule, and I am patient.",
      pressure: "{todayMinutes} minutes standing between you and a clean conscience.",
      close: "Do {firstTask} now, not at eleven. I have seen your eleven.",
    },
    {
      subject: "Fortune and glory. Mostly glory, {restDays} days of it.",
      opening: "Tomorrow, {name}, the plan looks away for {restDays} day(s). Today it is still watching closely.",
      pressure: "{taskCount} task(s), {todayMinutes} minutes. Leave any of it undone and it will be waiting when the lights come back on.",
      close: "{firstTask} first. Earn the time off before you take it.",
    },
    {
      subject: "Yippee ki yay, see you in {restDays} days",
      opening: "Last working day before your {restDays}-day vanishing act, {name}. Make it count, because tomorrow I have nothing to say to you.",
      pressure: "{coveragePercent}% covered, {daysToExam} days to the exam. The break is already priced in. Today being wasted is not.",
      close: "{firstTask}, now. Then go enjoy your absence.",
    },
    {
      subject: "A storm before the calm, {restDays} days of it",
      opening: "There is a storm rolling in tonight, {name}, right on schedule for your last working day before {restDays} day(s) off.",
      pressure: "{taskCount} task(s), {todayMinutes} minutes, before both the weather and the plan let you go.",
      close: "{firstTask}, before the thunder gives you an excuse.",
      weather: ["storm"],
    },
    {
      subject: "Dark by five. Last day of light work.",
      opening: "The sun is already giving up for the day, {name}, same as you would like to. Not yet.",
      pressure: "{taskCount} task(s) before the evening and the break both close in.",
      close: "{firstTask} now, while there is still daylight to feel guilty in.",
      weather: ["dark-early"],
    },
  ],

  // Mid-break. There is no work, and pretending otherwise would teach the
  // candidate that the plan's own rest days are negotiable.
  P_REST_MID: [
    {
      subject: "Day {dayOfBlock} of doing nothing. Correctly.",
      opening: "Still your break, {name}. Day {dayOfBlock} of {restDays}. I have nothing to ask of you and it is making me itch.",
      pressure: "{daysToExam} days to go, {coveragePercent}% covered, and none of that is today's problem.",
      close: "Back on {finishDate}? No. Back when the break ends. Rest.",
    },
    {
      subject: "Life moves pretty fast. Today it does not.",
      opening: "You are mid-break and the plan knows it. No tasks, no minutes, no arithmetic for you to dodge.",
      pressure: "The exam is still {daysToExam} days away and the schedule already accounted for this. That is the whole point of a plan.",
      close: "Enjoy it. I will be insufferable again soon enough.",
    },
    {
      subject: "The candidate abides.",
      opening: "Nothing from me today, {name}. Day {dayOfBlock} of your break. Even I take notes off.",
      pressure: "{coveragePercent}% covered. The number does not move today and it is not supposed to.",
      close: "Rest properly. Half-resting is how people return tired and behind.",
    },
    {
      subject: "There is no place like day {dayOfBlock} of rest",
      opening: "There is no place like doing absolutely nothing, {name}, and day {dayOfBlock} of {restDays} proves it rather well.",
      pressure: "{daysToExam} days out, {coveragePercent}% covered. None of it is due for discussion today.",
      close: "Stay exactly where you are. Rest.",
    },
    {
      subject: "If you rest, the backlog will still come",
      opening: "If you rest, {name}, the plan will come. Just not today. Today it is day {dayOfBlock} of {restDays} and it is staying away.",
      pressure: "{coveragePercent}% covered, {daysToExam} days to the exam. The field is empty on purpose.",
      close: "Rest. I will reappear exactly on schedule.",
    },
    {
      subject: "Snowed in on day {dayOfBlock}. Excellent alibi.",
      opening: "It is snowing on your break, {name}, which means day {dayOfBlock} of {restDays} comes with a built-in excuse to stay under the blanket.",
      pressure: "{daysToExam} days away, {coveragePercent}% covered. None of it changes because of the weather, or because of you, today.",
      close: "Stay in. Use the snow as the reason, not the plan.",
      weather: ["snow"],
    },
    {
      subject: "Too hot to study. Lucky for you, no studying.",
      opening: "It is baking out there, {name}, and day {dayOfBlock} of {restDays} means you are under no obligation to notice.",
      pressure: "{coveragePercent}% covered. The heat does not change the number and neither should you try to.",
      close: "Find shade. Rest properly.",
      weather: ["heat"],
    },
  ],

  // Final day of the break, which is the hinge. Tomorrow is the day that
  // becomes a streak if it is missed, so this line's only job is to aim at it.
  P_REST_LAST: [
    {
      subject: "Last day off. Tomorrow I return.",
      opening: "Final day of your break, {name}. Savour it with the specific dread of someone who knows what tomorrow looks like.",
      pressure: "Tomorrow: {taskCount} task(s) and {todayMinutes} minutes, with {daysToExam} days to the exam.",
      close: "Sleep in. Then set an alarm you will actually obey.",
    },
    {
      subject: "Winter is coming. Winter is Fixed Income.",
      opening: "One more day of nothing, then the plan picks you back up exactly where it put you down.",
      pressure: "{coveragePercent}% covered. Tomorrow's first task is {firstTask}, and it has been waiting with impressive patience.",
      close: "Rest today. Tomorrow is not optional.",
    },
    {
      subject: "Tomorrow is another day. Tomorrow has {taskCount} tasks.",
      opening: "Your break ends tonight, which makes this the most important day of doing nothing you will have all month.",
      pressure: "Returns are where plans die. Not the break: the day after it.",
      close: "Be the exception. {firstTask}, tomorrow, early.",
    },
    {
      subject: "Where we're going, we need a schedule",
      opening: "Last day of the break, {name}. Where you're going tomorrow, you will need a plan, and I have already written it.",
      pressure: "{taskCount} task(s) and {todayMinutes} minutes waiting the moment the break ends, {daysToExam} days out.",
      close: "Rest today properly. {firstTask} is tomorrow's problem, not tonight's.",
    },
    {
      subject: "You cannot handle the truth. Tomorrow you will have to.",
      opening: "Today you get to not know. Tomorrow, {name}, the truth returns in the shape of {taskCount} task(s).",
      pressure: "{coveragePercent}% covered, {daysToExam} days left. The truth was always going to catch up with you, I simply scheduled it for tomorrow.",
      close: "Enjoy the last of the quiet. {firstTask} opens the next chapter.",
    },
  ],

  // First day back from a break, clean. Named separately because a generic
  // "here is your day" after a week away reads as the coach not having noticed.
  P_BACK_CLEAN: [
    {
      subject: "Welcome back. I kept your seat warm.",
      opening: "Break over, {name}. You left on good terms with the plan, which is rarer than you think.",
      pressure: "{taskCount} task(s), {todayMinutes} minutes, {daysToExam} days to the exam, {coveragePercent}% covered.",
      close: "{firstTask}. The first day back sets the next ten. No pressure.",
    },
    {
      subject: "Did you miss me? Do not answer that.",
      opening: "You are back and the arithmetic is unchanged, because the break was planned rather than taken.",
      pressure: "{todayMinutes} minutes today. The hardest part is the first twenty, and you know it.",
      close: "Open {firstTask} before you open anything else.",
    },
    {
      subject: "Back to work. The good kind of back.",
      opening: "First day back, zero days missed. I have very little to work with here, {name}, and I want you to know I am suffering.",
      pressure: "{coveragePercent}% covered with {daysToExam} days left. Clean slate, same deadline.",
      close: "{taskCount} task(s). Begin with {firstTask}.",
    },
    {
      subject: "Phone home. Then open {firstTask}.",
      opening: "You are back, {name}, in one piece and apparently in good standing with the plan. I find this almost moving.",
      pressure: "{taskCount} task(s), {todayMinutes} minutes, {daysToExam} days to the exam, {coveragePercent}% covered. Nothing broke while you were gone.",
      close: "{firstTask}. Welcome back to Earth.",
    },
    {
      subject: "The backlog cannot sit with you today",
      opening: "No backlog, {name}. None. It genuinely cannot sit with you today, because you left none behind.",
      pressure: "{coveragePercent}% covered, {daysToExam} days left, {taskCount} task(s) waiting, all of them ordinary.",
      close: "{firstTask}. Start the comeback nobody needed.",
    },
  ],

  // First day back while already behind. The break did not cause the streak,
  // but it is where the candidate will blame it, so this says otherwise.
  P_BACK_BEHIND: [
    {
      subject: "Back from the break you were already behind before.",
      opening: "You are back, {name}, and so is the {streak}-day streak you packed and took with you.",
      pressure: "{droppedCount} item(s) requeued, {coveragePercent}% covered, {daysToExam} days left. The break did not cause this and will not be allowed to take the blame.",
      close: "{firstTask}, today, in full. A return is a free restart and you get exactly one.",
    },
    {
      subject: "Houston, we have a backlog.",
      opening: "The holiday is over and the arithmetic did what arithmetic does while you were away: nothing, patiently.",
      pressure: "{streak} day(s) missed before you left. {taskCount} task(s) waiting now. {todayMinutes} minutes.",
      close: "Start with {firstTask}. Momentum is cheaper to buy today than tomorrow.",
    },
    {
      subject: "Rested, and still {streak} days behind.",
      opening: "You look refreshed. The plan looks exactly as neglected as the day you left it, {name}.",
      pressure: "{coveragePercent}% covered against {daysToExam} days. Rest fixed your energy, not your coverage.",
      close: "{firstTask} first. Use the energy on the thing you were avoiding.",
    },
    {
      subject: "Life, uh, finds a way around the plan",
      opening: "Life finds a way, {name}, and apparently so does a {streak}-day streak, straight through your entire break.",
      pressure: "{droppedCount} item(s) requeued, {coveragePercent}% covered against {daysToExam} days. The break did not do this. You know who did.",
      close: "{firstTask}, today. The backlog is patient, not kind.",
    },
    {
      subject: "The game is afoot. So is the backlog.",
      opening: "The game is afoot again, {name}, and so, unfortunately, is the {streak}-day backlog that waited for your return.",
      pressure: "{taskCount} task(s), {todayMinutes} minutes, {coveragePercent}% covered with {daysToExam} days left. Elementary, and expensive.",
      close: "{firstTask} first. Solve the oldest case on the list.",
    },
  ],
};
