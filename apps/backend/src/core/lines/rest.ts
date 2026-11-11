/**
 * Lines for days the plan itself gives away: scheduled rest and holidays.
 * Separated from `prescription.ts` because none of these days carry work, so
 * none of this copy may imply a task list.
 */

import type { DialogueLine } from "./types.ts";

export const POOLS: Record<string, DialogueLine[]> = {
  P_REST_CLEAN: [
    {
      subject: "A day off. How responsible of you.",
      opening: "Life moves pretty fast. Today the plan says stop and look around, so look around.",
      pressure: null,
      close: "I have {taskCount} things for you tomorrow. Sleep well.",
    },
    {
      subject: "Nothing today. Savour it.",
      opening: "No tasks, no worries. The plan insists, and for once I agree with it.",
      pressure: null,
      close: "Back tomorrow. I will bring {taskCount} tasks and my usual charm.",
    },
    {
      subject: "Your day off, as scheduled",
      opening: "I have no offer for you today. Not one you can refuse, not one you cannot. Nothing.",
      pressure: null,
      close: "Rest. Tomorrow we return to our arrangement.",
    },
    {
      subject: "Do, or do not. Today, neither.",
      opening: "There is no try today, {name}, because there is also no task. The plan has put the lightsaber down.",
      pressure: null,
      close: "Enjoy the ceasefire. Back tomorrow with {taskCount} tasks.",
    },
    {
      subject: "As you wish. Today, you wish for nothing.",
      opening: "As you wish, {name}. Today you wish for nothing, which is the easiest demand you will make of yourself all month.",
      pressure: null,
      close: "Rest. I will have {taskCount} tasks waiting when you are back.",
    },
    {
      subject: "Singing in the rain. Or just sitting in it.",
      opening: "It is raining on you, {name}, and for once the plan and the weather agree: stay in.",
      pressure: null,
      close: "Tea, a blanket, nothing resembling a textbook.",
      weather: ["rain"],
    },
    {
      subject: "A clear day wasted on rest. Perfect.",
      opening: "Clear skies today, {name}, and the plan has the audacity to tell you to enjoy them instead of studying.",
      pressure: null,
      close: "Go outside while it lasts. Tomorrow is indoors again.",
      weather: ["clear-warm"],
    },
  ],
  P_REST_BEHIND: [
    {
      subject: "A rest day. Of all the days.",
      opening: "Of all the days to be handed off, you get this one, with {streak} days of work already queued behind it.",
      pressure: "The plan says rest. The backlog says something considerably less restful.",
      close: "I will say nothing more. I will simply watch.",
    },
    {
      subject: "Rest day, {streak} days behind",
      opening: "You have earned a rest the way a man who never started earns a break.",
      pressure: "{streak} days are already waiting. Resting does not reduce them, it just postpones the reckoning.",
      close: "Enjoy it. I mean that in the most unsettling way available.",
    },
    {
      subject: "No tasks today. Lucky you.",
      opening: "The calendar has handed you an alibi. How very convenient.",
      pressure: "Your streak stands at {streak} and today cannot make it worse. Tomorrow has no such mercy.",
      close: "Tomorrow: {taskCount} tasks, and no excuses left in the drawer.",
    },
    {
      subject: "An offer the calendar could not refuse",
      opening: "The calendar made the backlog an offer it could not refuse, {name}: a day off, no questions, {streak} days of debt still attached.",
      pressure: "{streak} days behind, and resting today does not close the gap, it only delays the invoice.",
      close: "Rest today. Tomorrow: {taskCount} tasks, in full.",
    },
    {
      subject: "Hakuna matata. For precisely one day.",
      opening: "No worries, {name}, for the rest of your days, except the {streak} already filed under worry.",
      pressure: "{streak} days owed. The rest day pauses nothing except today's number.",
      close: "Rest. Tomorrow the philosophy changes back.",
    },
  ],

  // ------------------------------------------------------------- light days,
};
