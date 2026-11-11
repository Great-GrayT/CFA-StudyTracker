import { test, expect } from "vitest";
import { holidayFacts, type HolidayBlock } from "./holiday";

function day(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

/** A single four-day break, the 10th to the 13th of February inclusive. */
const BREAK: HolidayBlock[] = [{ startDate: day("2027-02-10"), endDate: day("2027-02-13") }];

test("a day well clear of any break has every flag off", () => {
  const facts = holidayFacts(BREAK, day("2027-01-20"));
  expect(facts).toEqual({
    isHoliday: false,
    holidayYesterday: false,
    holidayTomorrow: false,
    holidayStartsTomorrow: false,
    restDays: 0,
    dayOfBlock: 0,
  });
});

// THE FOUR DAYS THAT MATTER, walked one at a time across the break's edges.
// These boundaries are the whole point of the module and an off-by-one on any
// of them sends the wrong email on the highest-leverage day of the month.

test("the day before the break is the last working day, not a holiday", () => {
  const facts = holidayFacts(BREAK, day("2027-02-09"));
  expect(facts.isHoliday).toBe(false);
  expect(facts.holidayStartsTomorrow).toBe(true);
  expect(facts.holidayTomorrow).toBe(true);
  // The length of the break that is about to start, so the copy can name it
  // before the candidate is inside it.
  expect(facts.restDays).toBe(4);
});

test("the first day of the break is day one, with more to come", () => {
  const facts = holidayFacts(BREAK, day("2027-02-10"));
  expect(facts.isHoliday).toBe(true);
  expect(facts.dayOfBlock).toBe(1);
  expect(facts.holidayTomorrow).toBe(true);
  expect(facts.holidayYesterday).toBe(false);
  expect(facts.restDays).toBe(4);
});

test("a middle day of the break knows which day it is", () => {
  expect(holidayFacts(BREAK, day("2027-02-11")).dayOfBlock).toBe(2);
  expect(holidayFacts(BREAK, day("2027-02-12")).dayOfBlock).toBe(3);
});

test("the last day of the break has no holiday tomorrow", () => {
  // This is what separates the mid-break line from the last-day line. If
  // holidayTomorrow leaked through here the candidate would never be warned
  // that the plan picks them back up in the morning.
  const facts = holidayFacts(BREAK, day("2027-02-13"));
  expect(facts.isHoliday).toBe(true);
  expect(facts.dayOfBlock).toBe(4);
  expect(facts.holidayTomorrow).toBe(false);
});

test("the first day back is not a holiday but had one yesterday", () => {
  const facts = holidayFacts(BREAK, day("2027-02-14"));
  expect(facts.isHoliday).toBe(false);
  expect(facts.holidayYesterday).toBe(true);
  expect(facts.holidayStartsTomorrow).toBe(false);
});

test("a break is inclusive of its end date", () => {
  // A row for the 10th to the 13th is four days off, not three. An exclusive
  // end would work the candidate on the final day of every break they booked.
  expect(holidayFacts(BREAK, day("2027-02-13")).isHoliday).toBe(true);
  expect(holidayFacts(BREAK, day("2027-02-10")).restDays).toBe(4);
});

test("a one-day break is both its first and its last day", () => {
  const single: HolidayBlock[] = [
    { startDate: day("2027-03-05"), endDate: day("2027-03-05") },
  ];
  const facts = holidayFacts(single, day("2027-03-05"));
  expect(facts.isHoliday).toBe(true);
  expect(facts.restDays).toBe(1);
  expect(facts.dayOfBlock).toBe(1);
  expect(facts.holidayTomorrow).toBe(false);
  expect(facts.holidayYesterday).toBe(false);
});

test("a break does not claim to start tomorrow from inside itself", () => {
  // The bug this exists to prevent: checking only "is tomorrow a holiday"
  // makes every day of a long break also a last-chance-before-the-break day,
  // so the coach tells a resting candidate to bank work for a break they are
  // already on.
  for (const d of ["2027-02-10", "2027-02-11", "2027-02-12"]) {
    const facts = holidayFacts(BREAK, day(d));
    expect(facts.holidayTomorrow).toBe(true);
    expect(facts.holidayStartsTomorrow).toBe(false);
  }
});

test("two breaks back to back are read as the blocks they are", () => {
  const two: HolidayBlock[] = [
    { startDate: day("2027-04-01"), endDate: day("2027-04-02") },
    { startDate: day("2027-04-20"), endDate: day("2027-04-24") },
  ];
  // Inside the first: day 2 of 2, and nothing tomorrow.
  const first = holidayFacts(two, day("2027-04-02"));
  expect(first.dayOfBlock).toBe(2);
  expect(first.restDays).toBe(2);
  expect(first.holidayTomorrow).toBe(false);

  // Inside the second: the length must come from THIS block, not the first one
  // or the array as a whole.
  const second = holidayFacts(two, day("2027-04-22"));
  expect(second.dayOfBlock).toBe(3);
  expect(second.restDays).toBe(5);
});

test("the eve of the second break reports the second break's length", () => {
  const two: HolidayBlock[] = [
    { startDate: day("2027-04-01"), endDate: day("2027-04-02") },
    { startDate: day("2027-04-20"), endDate: day("2027-04-24") },
  ];
  const facts = holidayFacts(two, day("2027-04-19"));
  expect(facts.holidayStartsTomorrow).toBe(true);
  expect(facts.restDays).toBe(5);
});

test("a gap of one working day between two breaks is read correctly", () => {
  // The nastiest shape: a single day back at the desk between two breaks. It is
  // simultaneously a first-day-back and a last-day-before, and both flags must
  // be true so the tree can choose which matters more.
  const two: HolidayBlock[] = [
    { startDate: day("2027-05-01"), endDate: day("2027-05-03") },
    { startDate: day("2027-05-05"), endDate: day("2027-05-07") },
  ];
  const facts = holidayFacts(two, day("2027-05-04"));
  expect(facts.isHoliday).toBe(false);
  expect(facts.holidayYesterday).toBe(true);
  expect(facts.holidayStartsTomorrow).toBe(true);
});

test("no holiday rows at all is an ordinary day, not a crash", () => {
  expect(() => holidayFacts([], day("2027-02-10"))).not.toThrow();
  expect(holidayFacts([], day("2027-02-10")).isHoliday).toBe(false);
});

test("a block crossing a month boundary counts its days correctly", () => {
  // Would catch day arithmetic done by incrementing getUTCDate rather than by
  // adding milliseconds.
  const block: HolidayBlock[] = [
    { startDate: day("2027-01-30"), endDate: day("2027-02-02") },
  ];
  expect(holidayFacts(block, day("2027-02-01")).dayOfBlock).toBe(3);
  expect(holidayFacts(block, day("2027-02-01")).restDays).toBe(4);
  expect(holidayFacts(block, day("2027-01-29")).holidayStartsTomorrow).toBe(true);
});

test("a block given with a mid-day timestamp is still read as whole days", () => {
  // Holiday rows come from the database as DateTime. If any comparison here
  // used the raw value rather than the start of the day, a row stored at noon
  // would make the first day of every break a half-day.
  const noonish: HolidayBlock[] = [
    { startDate: new Date("2027-02-10T13:45:00Z"), endDate: new Date("2027-02-13T09:15:00Z") },
  ];
  expect(holidayFacts(noonish, day("2027-02-10")).isHoliday).toBe(true);
  expect(holidayFacts(noonish, day("2027-02-13")).isHoliday).toBe(true);
  expect(holidayFacts(noonish, day("2027-02-10")).restDays).toBe(4);
});
