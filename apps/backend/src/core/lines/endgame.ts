/**
 * The last fortnight, the eve, the day, and after.
 *
 * These exist because the same streak means two different things at two hundred
 * days and at nine. Without a horizon the coach sounds equally alarmed all year,
 * which trains the candidate to discount it precisely when the alarm is real.
 *
 * Two hard rules in this module, and they are not matters of taste. On the eve
 * and the day itself the coach stops applying pressure entirely: there is no
 * behaviour left to change and anxiety is the only thing a nudge can add. And
 * nothing here tells a candidate their exam is lost, because that call belongs
 * to the candidate and the honest alternative (move the date) always exists.
 */

import type { DialogueLine } from "./types.ts";

export const POOLS: Record<string, DialogueLine[]> = {
  // Final week, on track. Earned, and said plainly for once.
  P_FINAL_WEEK: [
    {
      subject: "{daysToExam} days. You are, irritatingly, ready.",
      opening:
        "Final week, {name}. {coveragePercent}% covered, nothing missed, and I am contractually obliged to find this boring.",
      pressure:
        "{taskCount} task(s), {todayMinutes} minutes. No new material from here. Everything now is retrieval and timing.",
      close: "{firstTask}. Then sleep like it is part of the syllabus, because this week it is.",
    },
    {
      subject: "Hold the line. {daysToExam} days of it.",
      opening:
        "Seven days or fewer. This is the week where discipline pays and cleverness does not.",
      pressure:
        "{coveragePercent}% covered. The plan has you doing timed sets and review, which is the only thing that moves a score this late.",
      close: "{taskCount} task(s), starting with {firstTask}. Protect your sleep.",
    },
    {
      subject: "Fasten your seatbelt. Only {daysToExam} days of turbulence.",
      opening:
        "The last week, and you arrive at it clean. Do you know how few people read this sentence, {name}?",
      pressure:
        "{todayMinutes} minutes today. Resist the urge to open something new. New material this week costs more than it pays.",
      close: "{firstTask}, then stop on time.",
    },
    {
      subject: "The need for speed. {daysToExam} days of it.",
      opening:
        "Final week, {name}. {coveragePercent}% covered. I feel the need, the need to see you finish on time.",
      pressure:
        "{taskCount} task(s), {todayMinutes} minutes. No new material, only sharper passes on what you already know.",
      close: "{firstTask}. Fly it clean.",
    },
    {
      subject: "With great coverage comes great responsibility",
      opening:
        "{coveragePercent}% covered with {daysToExam} days left, {name}. That is a great deal of power to be careless with now.",
      pressure:
        "{taskCount} task(s), {todayMinutes} minutes. Spend the week on timing and retrieval, not on anything new.",
      close: "{firstTask}, then rest like it is part of the job.",
    },
  ],

  // Final week, behind. The hardest copy in the file: real urgency, no despair,
  // and an explicit instruction to stop widening and start consolidating.
  P_FINAL_WEEK_BEHIND: [
    {
      subject: "{daysToExam} days and {streak} missed. Triage, then.",
      opening:
        "Final week, {name}, carrying a {streak}-day streak. I am going to be useful instead of funny for a moment.",
      pressure:
        "{coveragePercent}% covered, {droppedCount} item(s) requeued. You cannot cover everything now. You can still pass, and the way to do it is to stop widening and start drilling what you half-know.",
      close: "{firstTask} today, in full. Abandon the backlog, not the exam.",
    },
    {
      subject: "The exam is inevitable. Your prep is still negotiable.",
      opening:
        "Seven days or fewer, and the plan has more in it than the week has hours. That is arithmetic, not judgement.",
      pressure:
        "{streak} day(s) missed. {coveragePercent}% covered. The marginal mark this week comes from questions on weak topics, not from new lectures.",
      close: "Do {firstTask}, then questions until you stop being surprised by them.",
    },
    {
      subject: "Tonight we dine on vignettes.",
      opening:
        "{daysToExam} days out and behind, which means every hour now has to earn more than it did in March.",
      pressure:
        "{taskCount} task(s) queued, {todayMinutes} minutes available. Timed questions beat passive review by a distance this late.",
      close:
        "{firstTask}. If something has to give this week, let it be the notes, never the sleep.",
    },
    {
      subject: "Red pill, blue pill. Both days are gone.",
      opening:
        "{daysToExam} days out, {streak} day(s) missed, {name}. There is no pill for lost days, only a choice about the ones left.",
      pressure:
        "{coveragePercent}% covered, {droppedCount} item(s) requeued. The marginal hour goes to your weakest topic, not to anything new.",
      close: "{firstTask}, fully. Leave the rest for after the exam, not for never.",
    },
    {
      subject: "In {daysToExam} days, no one can hear the backlog scream",
      opening:
        "{daysToExam} days, {streak} missed, and the backlog is making noise only you can hear right now.",
      pressure:
        "{coveragePercent}% covered, {todayMinutes} minutes today. Drill the weak topics. New material this late is a hull breach, not a plan.",
      close: "{firstTask}, then questions until the panic goes quiet.",
    },
  ],

  // The eve. No pressure to perform, no task list, no scorekeeping. The one
  // place in the whole file allowed to be kind without an edge.
  P_EXAM_EVE: [
    {
      subject: "Tomorrow. Nothing more from me.",
      opening:
        "{name}, it is the day before. Every single thing I have said to you was aimed at tomorrow morning.",
      pressure:
        "Today: light review of your own notes, your ID, your route, your sleep. No new material. None. I will not be negotiated with on this one.",
      close: "Finish early. Sleep. You have done the work.",
    },
    {
      subject: "Tomorrow, and tomorrow, and then it is done.",
      opening:
        "The eve. I have been unbearable on purpose and I am going to stop now, because tonight there is nothing left to push.",
      pressure:
        "Pack what you need tonight rather than tomorrow. Skim formulas if it calms you and skip them if it does not.",
      close: "Sleep is the highest-yield task on today's list. Go and do it.",
    },
    {
      subject: "Going the distance. Starting tomorrow.",
      opening:
        "Last day before the exam, {name}. {coveragePercent}% covered, and that number stops mattering at midnight.",
      pressure:
        "Nothing new today. A short confidence pass on your strongest topic, then away from the desk.",
      close: "Early night. Tomorrow you only have to turn up and remember.",
    },
    {
      subject: "I'm sorry, {name}. I can't do that tonight.",
      opening:
        "Even I am capable of stopping, {name}. Tonight I will not open a single door toward new material.",
      pressure:
        "Lay out your ID, your calculator, your route tonight rather than tomorrow. No new material. That door stays shut.",
      close: "Lights off early. Let tomorrow be the only thing left to do.",
    },
    {
      subject: "A spoonful of sleep. Nothing else.",
      opening:
        "The eve, {name}. Whatever you have not covered by tonight will not be covered by tonight either, so let it go.",
      pressure:
        "Pack your bag, check your route, set two alarms if it helps you sleep. Nothing from a textbook tonight.",
      close: "Bed. Early. That is the whole instruction.",
    },
  ],

  // The day. Short. Anything longer is the coach serving itself.
  P_EXAM_DAY: [
    {
      subject: "Today. Go.",
      opening: "It is the day, {name}. No tasks, no plan, no streak. Just you and a room.",
      pressure:
        "Read every vignette twice before you touch an answer. Bank the easy ones. Move on from the ones designed to eat your clock.",
      close: "Go and pass. I will be here with absolutely nothing to nag about.",
    },
    {
      subject: "Showtime, candidate.",
      opening:
        "Exam day. Everything from the first email to this one was for the next few hours.",
      pressure:
        "Time per vignette, not per question. A blank you return to beats a guess you forget to revisit.",
      close: "Good luck. You earned the right to be nervous.",
    },
    {
      subject: "Seize it. Then go and sleep for a week.",
      opening:
        "Today is the exam. I have run out of things to hold over you, which I want on the record as a loss for me.",
      pressure: "Trust the first instinct on valuation and the arithmetic on everything else.",
      close: "Go. Properly, this time.",
    },
    {
      subject: "I can do this all day. You only need one.",
      opening: "{name}, it is the day. One sitting, one shot, no plan left to consult.",
      pressure: "Read twice, answer once. Time the vignette, not the question.",
      close: "Go. One day. That is all this ever was.",
    },
    {
      subject: "Your mission, should you choose to accept it: one exam.",
      opening:
        "This message, like every one before it, is now obsolete, {name}. One exam, one room, one clock.",
      pressure: "Breathe before each vignette. Flag what stalls you and move on, return if time allows.",
      close: "Go sit it. That is the entire instruction.",
    },
  ],

  // After the exam. The plan is over, so the coach falls silent rather than
  // keep firing prescriptions into a void.
  P_PAST: [
    {
      subject: "It is done. I am switching myself off.",
      opening:
        "The exam date has passed, {name}. There is no plan left to prescribe and I refuse to invent one.",
      pressure:
        "{coveragePercent}% covered by the end, {streak} day(s) missed across the whole run. That was the shape of it.",
      close: "No more emails unless you start a new plan. Go and be a person for a while.",
    },
    {
      subject: "Here is looking at you, candidate.",
      opening:
        "Your exam is behind you. The schedule has nothing further to say and neither, remarkably, do I.",
      pressure: "Whatever the result, the work happened. {coveragePercent}% coverage does not unhappen.",
      close: "Start a new plan when you want me back. Not before.",
    },
    {
      subject: "That will do, candidate.",
      opening: "Past the date. The plan is closed.",
      pressure:
        "Final tally: {coveragePercent}% covered, {streak} day(s) missed. You can argue with me about it another time.",
      close: "Rest. If there is a next level, I will be waiting and I will remember everything.",
    },
    {
      subject: "So much time, and so little to prescribe",
      opening:
        "The exam is behind you, {name}, and I find I have, for the first time, nothing on the schedule.",
      pressure:
        "{coveragePercent}% covered, {streak} day(s) missed across the run. That is the whole record, and I am closing the file on it.",
      close: "No more emails until you start again. Go live without me for a while.",
    },
    {
      subject: "The ones you studied never really leave you",
      opening:
        "Past the exam date, {name}. Whatever the result, the hours you put in do not un-happen.",
      pressure:
        "Final shape of it: {coveragePercent}% covered, {streak} day(s) missed. Argue with the numbers later if you like.",
      close: "Rest now. Start a new plan whenever you are ready for me again.",
    },
  ],

  // Evening nudge in the final week, where a lost evening cannot be recovered
  // later because there is no later.
  N_FINAL_WEEK: [
    {
      subject: "{daysToExam} days left and today is still blank.",
      opening:
        "Final week, {name}, and nothing logged yet. This evening does not roll forward. There is nowhere for it to roll to.",
      pressure: "{taskCount} task(s), {todayMinutes} minutes, {daysToExam} days.",
      close: "{firstTask}. Thirty minutes. Now, not after one more thing.",
    },
    {
      subject: "Tick. Tock. {daysToExam} days.",
      opening:
        "I can see the whole week from here and it does not have room for a day like this one.",
      pressure: "Nothing logged. {todayMinutes} minutes were set aside and most of them are gone.",
      close: "Salvage it: {firstTask}, one timed set, then log it.",
    },
    {
      subject: "You are going to need a bigger evening.",
      opening:
        "Final week and today is empty, which at this range is not drift, it is the whole margin.",
      pressure: "{coveragePercent}% covered. Every remaining evening is now load-bearing.",
      close: "Open {firstTask} and start. Partial counts tonight.",
    },
    {
      subject: "Mad as hell, and {daysToExam} days to prove it",
      opening:
        "I am mad as hell about this blank evening, {name}, and I am not going to take it quietly. {daysToExam} days left.",
      pressure:
        "{taskCount} task(s), {todayMinutes} minutes, with no evenings left to spare this close to the date.",
      close: "{firstTask}. Now, not after the credits roll.",
    },
    {
      subject: "You have entered the blank zone. {daysToExam} days left.",
      opening:
        "Picture a candidate, {name}, submitted for your approval: {daysToExam} days out, tonight still at zero.",
      pressure:
        "{taskCount} task(s), {todayMinutes} minutes, and no evenings left to spare this close to the date.",
      close: "{firstTask}. Thirty minutes. Now, not after one more thing.",
    },
  ],

  // Debrief on the eve: a closing report, not a scorecard.
  D_EXAM_EVE: [
    {
      subject: "Last log before the exam.",
      opening:
        "That is the final entry, {name}. {coveragePercent}% covered across the whole plan, {streak} day(s) missed.",
      pressure: "Nothing more to do tonight. Bag packed, alarm set, phone charged.",
      close: "Sleep. Tomorrow is the only task left.",
    },
    {
      subject: "To sleep. Perchance to recall the formula.",
      opening:
        "The night before. Whatever you did today was the last of it, and it was enough to get you here.",
      pressure: "{coveragePercent}% covered. That is the number you take in with you.",
      close: "Lights off. Early. I mean it.",
    },
    {
      subject: "Closing the book on the plan.",
      opening:
        "Final debrief, {name}. {streak} day(s) missed, {coveragePercent}% covered, one exam to go.",
      pressure:
        "No revision after this email. Reading a formula sheet at midnight has never improved a single score.",
      close: "Go to bed. Good luck tomorrow.",
    },
    {
      subject: "Every time a bell rings, an exam gets closer",
      opening:
        "That is the last entry, {name}, before the exam. {coveragePercent}% covered across the whole plan is the number you carry in.",
      pressure: "Nothing left to do tonight. Phone on silent, alarm doubled, bag by the door.",
      close: "Sleep. Tomorrow rings the bell.",
    },
    {
      subject: "You are not dreaming. Tomorrow is real.",
      opening:
        "Final log before tomorrow, {name}. {streak} day(s) missed across the run, {coveragePercent}% covered: that is the whole record now closed.",
      pressure: "No revision tonight changes the paper. Lay out what you need and stop there.",
      close: "Lights off. Good luck tomorrow.",
    },
  ],

  // Logged work on a day the plan gave away. Worth noticing, and worth a mild
  // warning, because the candidates who cannot rest are the ones who burn out.
  D_REST_BONUS: [
    {
      subject: "You worked on your day off. Suspicious.",
      opening: "Today was a rest day and you logged {todayMinutes} minutes anyway, {name}.",
      pressure:
        "{coveragePercent}% covered, {daysToExam} days left. Credit where it is due. Also: rest days exist for a reason, and the reason arrives in exam week.",
      close: "Banked. Now actually rest tomorrow if tomorrow says rest.",
    },
    {
      subject: "Nobody puts the candidate in a corner.",
      opening:
        "The plan said nothing and you did {todayMinutes} minutes regardless. I am obliged to approve and inclined to worry.",
      pressure:
        "Extra work on rest days moves coverage forward. It also moves exhaustion forward, and only one of those is on the plan.",
      close: "Logged. Tomorrow: {firstTask}.",
    },
    {
      subject: "Overachieving on a technicality.",
      opening:
        "A rest day with {todayMinutes} minutes in it. That is not resting, {name}, that is negotiating.",
      pressure:
        "{coveragePercent}% covered against {daysToExam} days. You are ahead of where the plan put you.",
      close: "Counted in full. Take the next one properly.",
    },
    {
      subject: "A rest day on repeat, except you worked",
      opening:
        "Today was supposed to repeat quietly, {name}, and instead you logged {todayMinutes} minutes on it.",
      pressure:
        "{coveragePercent}% covered, {daysToExam} days left. Credit noted. Doing this every rest day is how burnout writes its own sequel.",
      close: "Banked. Rest, properly, next time the calendar offers it.",
    },
    {
      subject: "To boldly go where the rest day forbade",
      opening:
        "You boldly went and logged {todayMinutes} minutes on a day with nothing asked of you, {name}.",
      pressure:
        "{coveragePercent}% covered against {daysToExam} days. Extra credit, with a small warning attached about what rest days are actually for.",
      close: "Logged in full. Tomorrow: {firstTask}.",
    },
  ],
};
