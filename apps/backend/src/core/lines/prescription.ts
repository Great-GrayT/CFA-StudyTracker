/**
 * Morning prescription lines for an ordinary study day, keyed by day shape
 * crossed with streak band. Rest, holiday and endgame days live in their own
 * modules because their copy answers a different question.
 */

import type { DialogueLine } from "./types.ts";

export const POOLS: Record<string, DialogueLine[]> = {
  P_NORMAL: [
    {
      subject: "{taskCount} tasks. Shall we?",
      opening: "Do I really look like a coach with a plan? I do. That is the whole difference between us.",
      pressure: "{daysToExam} days. {coveragePercent}% covered. The arithmetic is still arithmetic.",
      close: "Start with {firstTask}.",
    },
    {
      subject: "Today: {taskCount} tasks, {todayMinutes} min",
      opening: "Here is today. Nothing dramatic, which must be a relief after the week you have had.",
      pressure: "{coveragePercent}% covered and {daysToExam} days to go. On pace, which I will not get used to saying.",
      close: "Start with {firstTask}.",
    },
    {
      subject: "{todayMinutes} minutes. You know the drill.",
      opening: "We meet again at the usual hour, with the usual list, and your usual expression.",
      pressure: "{daysToExam} days left. {coveragePercent}% covered. Boringly on track.",
      close: "Start with {firstTask}.",
    },
    {
      subject: "Your {taskCount} tasks are served",
      opening: "I have prepared something for you. It is not a surprise, because surprises are how plans die.",
      pressure: "{coveragePercent}% covered, {daysToExam} days remaining.",
      close: "Start with {firstTask}.",
    },
    {
      subject: "Groundhog morning. {taskCount} tasks again.",
      opening: "Same thing happened yesterday, and the day before that, and it will happen again tomorrow. I have made my peace with the loop.",
      pressure: "{daysToExam} days until the loop lets you go. {coveragePercent}% covered. Every lap still counts toward the finish.",
      close: "Start with {firstTask}.",
    },
    {
      subject: "Sunshine outside. Equations inside.",
      opening: "It is, by all accounts, a glorious day out there. The desk does not care, and today, neither do I.",
      pressure: "{taskCount} tasks, {coveragePercent}% covered, {daysToExam} days to go. The weather is not on the syllabus.",
      close: "Start with {firstTask}, then go outside once it is done.",
      weather: ["clear-warm"],
    },
    {
      subject: "Rain. The universe agrees with me.",
      opening: "It is pouring, which means the only sensible place for you today is exactly where you already were: at the desk.",
      pressure: "{daysToExam} days left, {coveragePercent}% covered. The weather has removed your best excuse free of charge.",
      close: "Start with {firstTask}.",
      weather: ["rain"],
    },
  ],
  P_SLIP: [
    {
      subject: "Oh. You missed yesterday.",
      opening: "What we have here is a failure to log. Yesterday came, yesterday went, and you did nothing at all.",
      pressure: "Yesterday is in today's list now. Work does not evaporate because you looked away. It waits, and it compounds.",
      close: "Start with {firstTask}. Or do not. I am curious either way.",
    },
    {
      subject: "One day missed. Only one. So far.",
      opening: "You had one job yesterday. Several, technically, but you did none of them, so the distinction feels academic.",
      pressure: "Today carries yesterday. {todayMinutes} minutes, {taskCount} tasks, and {daysToExam} days until the exam stops being an abstraction.",
      close: "Start with {firstTask}.",
    },
    {
      subject: "I noticed, by the way",
      opening: "Nobody expects to be caught on day one. That is rather the point of day one.",
      pressure: "One missed day is a rounding error. Two is a pattern. You are standing on the line.",
      close: "Start with {firstTask} and we never speak of it again.",
    },
    {
      subject: "Yesterday: nothing. Today: {taskCount} tasks.",
      opening: "I kept the receipts. I always keep the receipts.",
      pressure: "{coveragePercent}% covered with {daysToExam} days left, and now a day of debt on top.",
      close: "Start with {firstTask}.",
    },
    {
      subject: "Welcome to the party pal. One miss, and counting.",
      opening: "Welcome to the party, pal. Every candidate thinks they will be the exception, right up until yesterday happens to them too.",
      pressure: "{daysToExam} days to go, {coveragePercent}% covered, and now a day of debt riding along for free.",
      close: "Start with {firstTask}.",
    },
    {
      subject: "A storm took yesterday. I am keeping score anyway.",
      opening: "I will grant you the storm. Flooded street, dead signal, whatever story you are building. The log still reads zero.",
      pressure: "{daysToExam} days left, {coveragePercent}% covered. Weather is an explanation, not a subtraction.",
      close: "Start with {firstTask}.",
      weather: ["storm"],
    },
    {
      subject: "The dark came early. So did your excuse.",
      opening: "Sunset arrived before you did, which I am told is a popular reason for getting nothing done lately.",
      pressure: "{daysToExam} days to go. {coveragePercent}% covered. The clock changed, the arithmetic did not.",
      close: "Start with {firstTask}.",
      weather: ["dark-early"],
    },
  ],
  P_DRIFT: [
    {
      subject: "{streak} days. I am starting to enjoy this.",
      opening: "A backlog, as you know, is like gravity. All it takes is a little push, and you have been pushing for {streak} days.",
      pressure: "The plan has swallowed what it can and the rest sits in today's list, getting heavier. You are {streak} days behind and the exam has not moved one inch to accommodate you.",
      close: "Start with {firstTask}. Let us see if you still remember how.",
    },
    {
      subject: "{streak} days of beautiful silence",
      opening: "I see dead days. {streak} of them, stacked up neatly behind you.",
      pressure: "{coveragePercent}% covered, {daysToExam} days left. The gap between those two numbers is where I live.",
      close: "Start with {firstTask}.",
    },
    {
      subject: "Day {streak}. Still here.",
      opening: "Some coaches would panic. I find this fascinating.",
      pressure: "{streak} days missed and today inherits all of it. {todayMinutes} minutes, and that figure is only going one way.",
      close: "Start with {firstTask}. Today, preferably.",
    },
    {
      subject: "{streak} days behind and counting",
      opening: "You talking to me? No. You have not talked to me in {streak} days.",
      pressure: "The work is still here. It was always going to still be here. {coveragePercent}% covered, {daysToExam} days left.",
      close: "Start with {firstTask}.",
    },
    {
      subject: "Life, uh, finds a way. So does the backlog.",
      opening: "{streak} days of silence, and the backlog, uh, finds a way. It always finds a way.",
      pressure: "{coveragePercent}% covered, {daysToExam} days left. Nature, it turns out, now includes administrative debt.",
      close: "Start with {firstTask}.",
    },
  ],
  P_SERIOUS: [
    {
      subject: "{streak} days. Your finish date is now {finishDate}.",
      opening: "You cannot handle the arithmetic. Here it is anyway, because I am generous that way.",
      pressure: "At this pace you finish {finishDate}, and your exam is before that. The exam is inevitable. Your finish date, apparently, is negotiable. {droppedCount} things have already gone overboard to keep this boat floating.",
      close: "One task. Tonight. I am asking so nicely.",
    },
    {
      subject: "Houston, we have a finish date: {finishDate}",
      opening: "Day {streak}. I have stopped being surprised, which should trouble you more than shouting would.",
      pressure: "{coveragePercent}% covered, {daysToExam} days left, {droppedCount} items already sacrificed. Your projected finish is {finishDate}, which arrives fashionably after your exam.",
      close: "Start with {firstTask}. One task changes the slope.",
    },
    {
      subject: "{streak} days. The plan is bleeding.",
      opening: "I have been shuffling your plan to hide the damage. I am good at it. I am not a magician.",
      pressure: "{droppedCount} things dropped, {coveragePercent}% covered, and a finish date of {finishDate} against an exam that will not wait.",
      close: "One task tonight. That is the whole ask.",
    },
    {
      subject: "Day {streak}. Let us be honest with each other.",
      opening: "Why do we fall, candidate? Apparently so we can lie there for {streak} days.",
      pressure: "{daysToExam} days remain, {coveragePercent}% is covered, and the projection says {finishDate}. Those three numbers do not get along.",
      close: "Start with {firstTask}.",
    },
    {
      subject: "Just when the plan thought it was out",
      opening: "Just when the plan thought it was out, {streak} days pulled it back in. I do not love the sequel, but here we are.",
      pressure: "{coveragePercent}% covered, {daysToExam} days left, projected finish {finishDate}. The family business here is arithmetic, and it never stops calling.",
      close: "One task tonight. Make it an offer you cannot refuse.",
    },
  ],
  P_CRISIS: [
    {
      subject: "{streak} days. Let us do the maths together.",
      opening: "Some candidates just want to watch the backlog burn. {streak} days, not one task. That takes real commitment, and I mean that sincerely.",
      pressure: "{daysToExam} days left. {coveragePercent}% covered. One does not simply walk into Level Two with those numbers, and I cannot shuffle the plan into fitting. I tried. It was the most fun I have had all week.",
      close: "Two doors: add hours, or move the exam. Pick one. Picking neither is also picking, and you have been doing it beautifully for {streak} days.",
    },
    {
      subject: "{streak} days. The plan has given up. I have not.",
      opening: "You either sit the exam, or postpone long enough to watch yourself become the cautionary tale.",
      pressure: "{coveragePercent}% covered, {daysToExam} days, {droppedCount} items already thrown overboard. The arithmetic no longer closes, however I arrange it.",
      close: "Add hours or move the date. Both are survivable. Silence is the only option that is not.",
    },
    {
      subject: "A full week. Say something.",
      opening: "I love the smell of a fresh backlog in the morning. Yours is {streak} days old and ripening nicely.",
      pressure: "{daysToExam} days. {coveragePercent}% covered. Projected finish {finishDate}. I have run out of ways to make these numbers agree.",
      close: "Two doors, candidate. Add hours, or move the exam. Choose.",
    },
    {
      subject: "{streak} days. Do you feel lucky?",
      opening: "Do you feel lucky? {coveragePercent}% covered, {daysToExam} days left. I would not, but then I am not the one sitting the paper.",
      pressure: "{droppedCount} things have already been cut to make the plan fit, and it still does not fit.",
      close: "Add hours, or move the date. Anything but another day of this.",
    },
    {
      subject: "Day {streak}. The exam is still coming.",
      opening: "The exam is inevitable. You, it turns out, are optional.",
      pressure: "{coveragePercent}% covered, {daysToExam} days remaining, finish projected {finishDate}. The gap is no longer closeable at your current weekly hours.",
      close: "Open the app. Add hours or move the exam. I will wait, and I am very patient.",
    },
    {
      subject: "{streak} days. I have stopped shuffling.",
      opening: "What we have here is no longer a failure to log. It is a failure to acknowledge that time moves in one direction.",
      pressure: "{daysToExam} days. {coveragePercent}% covered. {droppedCount} items gone. The plan cannot absorb another day of this, and neither, frankly, can the calendar.",
      close: "Two doors: add hours, or move the exam. Pick one tonight.",
    },
  ],

  // ------------------------------------------------------------- heavy days,
  P_LIGHT: [
    {
      subject: "A small one today: {todayMinutes} min",
      opening: "Are you not entertained? No. Neither am I. {todayMinutes} minutes is barely a warm up.",
      pressure: "{daysToExam} days to the exam, in case you had forgotten. I had not.",
      close: "Start with {firstTask}. You will be done before you finish complaining.",
    },
    {
      subject: "{todayMinutes} minutes. That is all.",
      opening: "This one goes to {todayMinutes}. Hardly eleven, is it.",
      pressure: "{coveragePercent}% covered with {daysToExam} days left. A light day is a gift, not a verdict.",
      close: "Start with {firstTask} and get your evening back.",
    },
    {
      subject: "Today is gentle: {todayMinutes} min",
      opening: "Go ahead. Make my spreadsheet. It will take you {todayMinutes} minutes and I will enjoy every one.",
      pressure: "{daysToExam} days remain.",
      close: "Start with {firstTask}.",
    },
    {
      subject: "A spoonful of sugar. {todayMinutes} minutes of it.",
      opening: "A spoonful of sugar helps the medicine go down, and today's medicine is only {todayMinutes} minutes.",
      pressure: "{daysToExam} days remain. Light days are rare enough that I keep count.",
      close: "Start with {firstTask}.",
    },
    {
      subject: "No need for speed today. {todayMinutes} min will do.",
      opening: "I feel the need, the need for... actually, no. {todayMinutes} minutes is positively leisurely today.",
      pressure: "{coveragePercent}% covered, {daysToExam} days left. Enjoy the short runway while it lasts.",
      close: "Start with {firstTask}.",
    },
    {
      subject: "Snowed in, and barely working for it",
      opening: "Snow outside, {todayMinutes} minutes inside. For once the forecast and the plan agree with each other.",
      pressure: "{daysToExam} days to the exam. A light day in weather like this is as close to a gift as I get.",
      close: "Start with {firstTask}, then watch the snow with a clear conscience.",
      weather: ["snow"],
    },
    {
      subject: "Too hot outside. Mercifully short inside.",
      opening: "It is too hot to be a hero today, which works out, because {todayMinutes} minutes is all I am asking.",
      pressure: "{coveragePercent}% covered, {daysToExam} days left. Small days like this do not come twice a week.",
      close: "Start with {firstTask}, then find some shade.",
      weather: ["heat"],
    },
  ],
  P_LIGHT_SLIP: [
    {
      subject: "Light day, and you still owe me yesterday",
      opening: "Only {todayMinutes} minutes today, which makes yesterday's nothing look even more deliberate.",
      pressure: "Yesterday is folded in. This is the easiest day you will get to clear a debt on.",
      close: "Start with {firstTask}. There are no excuses this short.",
    },
    {
      subject: "{todayMinutes} min. You have no alibi.",
      opening: "A light day arrives the morning after you did nothing. The universe has a sense of humour, and so do I.",
      pressure: "One missed day, {todayMinutes} minutes to fix it. The maths has never been kinder to you.",
      close: "Start with {firstTask}.",
    },
    {
      subject: "Easy day. Use it.",
      opening: "You skipped yesterday and the plan responded with mercy. I would not have.",
      pressure: "{todayMinutes} minutes clears today and dents the backlog. Refusing this would be a choice I would frankly admire.",
      close: "Start with {firstTask}.",
    },
    {
      subject: "Pay no attention to yesterday's curtain",
      opening: "Pay no attention to the candidate behind yesterday's curtain. He did nothing, and today asks only {todayMinutes} minutes in exchange.",
      pressure: "One missed day, erased this cheaply. The wizard never offered terms this good.",
      close: "Start with {firstTask}.",
    },
    {
      subject: "The game is afoot. It is also short.",
      opening: "The game is afoot, and it is only {todayMinutes} minutes long. Even you could manage this one.",
      pressure: "Yesterday's zero is still on the board. Today is the cheapest it will ever be to answer for it.",
      close: "Start with {firstTask}.",
    },
  ],
  P_LIGHT_BEHIND: [
    {
      subject: "{todayMinutes} min, and {streak} days of history",
      opening: "A light day, {streak} days into your silence. Even I am slightly embarrassed on your behalf.",
      pressure: "{coveragePercent}% covered, {daysToExam} days left, and today asks for {todayMinutes} minutes. That is not a mountain, it is a kerb.",
      close: "Step over it. Start with {firstTask}.",
    },
    {
      subject: "The smallest day you will get",
      opening: "{streak} days behind, and today wants {todayMinutes} minutes. If you cannot do this one, we both learn something.",
      pressure: "The backlog does not shrink on its own. I have checked. Repeatedly.",
      close: "Start with {firstTask}.",
    },
    {
      subject: "Light day. {streak} days behind.",
      opening: "I have seen men climb out of worse holes with less. Not many, but some.",
      pressure: "{todayMinutes} minutes today. {streak} days owed. {daysToExam} days until none of it is theoretical.",
      close: "Start with {firstTask}.",
    },
    {
      subject: "Fear is the backlog-killer",
      opening: "Fear is the mind killer, and {streak} days of avoidance is the backlog's best friend. Today, at least, asks little of you.",
      pressure: "{todayMinutes} minutes today against {streak} days owed. The ratio has never favoured you more.",
      close: "Start with {firstTask}.",
    },
    {
      subject: "'Tis but a scratch. {streak} days of them.",
      opening: "'Tis but a scratch, you will say, about a backlog {streak} days deep. I admire the confidence.",
      pressure: "{todayMinutes} minutes today, {daysToExam} days to the exam. Small wounds still need closing.",
      close: "Start with {firstTask}.",
    },
  ],

  // ------------------------------------------------------------ normal days,
  P_HEAVY: [
    {
      subject: "Today is heavy: {todayMinutes} min",
      opening: "You are going to need a bigger evening. {todayMinutes} minutes, and I arranged every one of them.",
      pressure: "Split it across the night if you like. Skipping it is a different conversation, and I do enjoy that conversation.",
      close: "Start with {firstTask}.",
    },
    {
      subject: "{todayMinutes} minutes. Brace yourself.",
      opening: "This is Level Two. Today it would like you to know that.",
      pressure: "{taskCount} tasks, {todayMinutes} minutes, {daysToExam} days to the exam. Heavy days are how the light ones stay light.",
      close: "Start with {firstTask}.",
    },
    {
      subject: "A big one today: {todayMinutes} min",
      opening: "I would apologise for the size of this, but I built it, and I am rather pleased with it.",
      pressure: "{coveragePercent}% covered. Today moves that number properly, which is the only reason it is this large.",
      close: "Start with {firstTask}.",
    },
    {
      subject: "It is not about how hard today hits",
      opening: "It is not about how hard today hits. It is about how many of its {todayMinutes} minutes you can take and keep moving forward.",
      pressure: "{taskCount} tasks stacked up, {daysToExam} days to the exam. Heavy days are how you get to call yourself ready later.",
      close: "Start with {firstTask}.",
    },
    {
      subject: "I am sorry, {name}. I cannot make it smaller.",
      opening: "I am sorry, {name}. I am afraid I cannot make today's list smaller. It would not be rational.",
      pressure: "{todayMinutes} minutes, {taskCount} tasks, {daysToExam} days to the exam. The pod bay doors are open. Walk through.",
      close: "Start with {firstTask}.",
    },
  ],
  P_HEAVY_BEHIND: [
    {
      subject: "{todayMinutes} min, and you are {streak} days down",
      opening: "A heavy day lands on a candidate {streak} days behind. I did not plan the poetry, but I will take it.",
      pressure: "{todayMinutes} minutes today, {streak} days owed, {daysToExam} until the exam. This is the week that decides the rest.",
      close: "Start with {firstTask}. Even part of this helps.",
    },
    {
      subject: "Heavy day. Deep hole.",
      opening: "You are going to need a bigger evening, and a bigger week, and possibly a bigger personality.",
      pressure: "{streak} days behind, {coveragePercent}% covered, {todayMinutes} minutes asked for today.",
      close: "Start with {firstTask}. Do not try to do all of it. Do some of it.",
    },
    {
      subject: "{todayMinutes} minutes. I know. I know.",
      opening: "Yes, it is a lot. Yes, you are behind. Those two facts are related, and I did warn you.",
      pressure: "{taskCount} tasks today. {streak} days of debt. {daysToExam} days of runway.",
      close: "Start with {firstTask}.",
    },
    {
      subject: "In the library, nobody hears you groan",
      opening: "In space, no one can hear you scream. In the library, {streak} days behind, I can hear you groan from here.",
      pressure: "{todayMinutes} minutes today, {streak} days owed, {daysToExam} days left. The debt does not drift away quietly.",
      close: "Start with {firstTask}. Even part of this helps.",
    },
    {
      subject: "It is alive. The backlog, specifically.",
      opening: "It is alive, {name}. {streak} days of neglect and the backlog has developed a pulse of its own.",
      pressure: "{todayMinutes} minutes today, {coveragePercent}% covered. Something this size does not lie back down on its own.",
      close: "Start with {firstTask}.",
    },
  ],

  // ----------------------------------------------------------- catch-up days,
  P_CATCHUP_SLIP: [
    {
      subject: "Yesterday has joined today",
      opening: "Say hello to my little backlog. It is one day old and already making itself comfortable.",
      pressure: "Today carries yesterday's work as well as its own: {taskCount} tasks, {todayMinutes} minutes.",
      close: "Start with {firstTask}.",
    },
    {
      subject: "Catch-up day: {todayMinutes} min",
      opening: "The work you skipped has been returned to you, gift wrapped, at no extra charge.",
      pressure: "{todayMinutes} minutes today because yesterday was zero. Cause, meet effect.",
      close: "Start with {firstTask}.",
    },
    {
      subject: "{taskCount} tasks, some of them yesterday's",
      opening: "I told you it would wait for you. I am many things, but I am not a liar.",
      pressure: "{daysToExam} days left and {coveragePercent}% covered. One clean day resets this entirely.",
      close: "Start with {firstTask}.",
    },
    {
      subject: "The hills are alive. So is yesterday's list.",
      opening: "The hills are alive with the sound of a backlog that refused to stay buried. One day, back from the dead.",
      pressure: "{taskCount} tasks today, {todayMinutes} minutes, because yesterday declined to disappear quietly.",
      close: "Start with {firstTask}.",
    },
    {
      subject: "Call it Ishmael. Call it yesterday's work.",
      opening: "Call me Ishmael. Call today's list what it actually is: yesterday, washed back up and waiting for you.",
      pressure: "{daysToExam} days left, {coveragePercent}% covered. One clean day still sets this right.",
      close: "Start with {firstTask}.",
    },
  ],
  P_CATCHUP_DRIFT: [
    {
      subject: "{streak} days, all of it in today's list",
      opening: "Everything you have avoided for {streak} days is now in one place, waiting, beautifully organised by me.",
      pressure: "{taskCount} tasks and {todayMinutes} minutes today. This is what {streak} days of nothing costs when the bill arrives.",
      close: "Start with {firstTask}. You will not clear it all. Clear some.",
    },
    {
      subject: "The pile has come to find you",
      opening: "Dead days tell no tales. The backlog, unfortunately, is extremely talkative.",
      pressure: "{streak} days folded into today: {todayMinutes} minutes, {taskCount} tasks.",
      close: "Start with {firstTask}.",
    },
    {
      subject: "Catch-up: {todayMinutes} min of your own making",
      opening: "You wanted to know how you got this backlog. I have the complete answer and {streak} days of evidence.",
      pressure: "{coveragePercent}% covered, {daysToExam} days remaining, and today is carrying four days of freight.",
      close: "Start with {firstTask}.",
    },
    {
      subject: "A truth universally acknowledged: {streak} days gone",
      opening: "It is a truth universally acknowledged that a backlog in possession of {streak} days will, eventually, want all of today.",
      pressure: "{taskCount} tasks, {todayMinutes} minutes, all of it owed with interest.",
      close: "Start with {firstTask}.",
    },
    {
      subject: "It was the worst of days. There were {streak} of them.",
      opening: "It was the worst of times, and it was also, separately, the worst of times. There have been {streak} of them in a row.",
      pressure: "{coveragePercent}% covered, {daysToExam} days remaining. Today carries all of it at once.",
      close: "Start with {firstTask}.",
    },
  ],
  P_CATCHUP_DEEP: [
    {
      subject: "{streak} days of work, one day to put it in",
      opening: "I have assembled everything you have ignored into a single list. It is magnificent. It is also impossible.",
      pressure: "{todayMinutes} minutes sit in today, which is more than today has. {droppedCount} items are already gone and the rest will not fit either.",
      close: "Start with {firstTask} and accept that today is damage control, not recovery.",
    },
    {
      subject: "The reckoning, scheduled for today",
      opening: "Some men just want to watch the backlog grow. You have been generous with it.",
      pressure: "{streak} days compressed into one: {taskCount} tasks, {todayMinutes} minutes, against {daysToExam} days to the exam and {coveragePercent}% covered.",
      close: "Start with {firstTask}. Then consider the two doors in the app.",
    },
    {
      subject: "Today cannot hold {streak} days. It will try.",
      opening: "One does not simply walk into a {streak} day backlog and clear it before bed.",
      pressure: "{todayMinutes} minutes queued, {droppedCount} items already cut, {coveragePercent}% covered with {daysToExam} days left.",
      close: "Start with {firstTask}. Something beats nothing, and nothing is what we have been doing.",
    },
    {
      subject: "So little time, so much to do",
      opening: "So much backlog, and so little day to do it in. Wonka would weep. I am merely amused.",
      pressure: "{streak} days compressed into one, {todayMinutes} minutes queued, {droppedCount} items already cut.",
      close: "Start with {firstTask}. Something beats nothing.",
    },
    {
      subject: "Resistance to logging was futile anyway",
      opening: "Resistance was futile, and {streak} days of it, and the backlog assimilated every one.",
      pressure: "{todayMinutes} minutes queued against {daysToExam} days left, {coveragePercent}% covered.",
      close: "Start with {firstTask}. Then breathe, briefly.",
    },
  ],

  // ----------------------------------------------------------------- nudges,
};
