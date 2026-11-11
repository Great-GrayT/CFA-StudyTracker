import { describe, test, expect } from "vitest";
import type { Slot } from "./slots";
import { localDateFor, dueSlots } from "./slots";

describe("Email coach time slots", () => {
  test("the local date is the candidate's date, not the server's", () => {
    // 23:30 UTC is already tomorrow in Tokyo and still today in Los Angeles.
    const t = new Date("2027-01-04T23:30:00Z");
    expect(localDateFor(t, "Asia/Tokyo")).toBe("2027-01-05");
    expect(localDateFor(t, "America/Los_Angeles")).toBe("2027-01-04");
    expect(localDateFor(t, "UTC")).toBe("2027-01-04");
  });

  test("a slot is due once its local time has passed and it has not been sent", () => {
    // 07:00 UTC = 07:00 GMT in London. Prescription (06:30) has passed.
    const sevenAmLondon = new Date("2027-01-04T07:00:00Z");
    expect(dueSlots(sevenAmLondon, "Europe/London", [])).toEqual(["prescription"]);
  });

  test("a slot already sent is never due again", () => {
    // Same instant, but prescription is already in alreadySent.
    const sevenAmLondon = new Date("2027-01-04T07:00:00Z");
    expect(dueSlots(sevenAmLondon, "Europe/London", ["prescription"])).toEqual([]);
  });

  test("a later instant makes the earlier slots due together", () => {
    // 23:00 UTC = 23:00 GMT in London. All three have passed.
    const elevenPmLondon = new Date("2027-01-04T23:00:00Z");
    expect(dueSlots(elevenPmLondon, "Europe/London", [])).toEqual([
      "prescription",
      "nudge",
      "debrief",
    ]);
  });

  test("the debrief does not fire mid-afternoon for a western candidate", () => {
    // 23:00 UTC is 15:00 in Los Angeles. Only prescription (06:30) has passed.
    const t = new Date("2027-01-04T23:00:00Z");
    expect(dueSlots(t, "America/Los_Angeles", [])).toEqual(["prescription"]);
  });

  test("a DST transition does not duplicate or skip a day", () => {
    // London moves to BST on 2027-03-28. The clock jumps from 00:59:59 GMT to 02:00:00 BST.
    expect(localDateFor(new Date("2027-03-28T00:30:00Z"), "Europe/London")).toBe("2027-03-28");
    expect(localDateFor(new Date("2027-03-28T01:30:00Z"), "Europe/London")).toBe("2027-03-28");
    // 06:00 UTC is 07:00 BST, so the 06:30 prescription is due.
    expect(dueSlots(new Date("2027-03-28T06:00:00Z"), "Europe/London", [])).toEqual([
      "prescription",
    ]);
  });

  test("an unknown timezone is rejected rather than silently treated as UTC", () => {
    expect(() => localDateFor(new Date(), "Mars/Olympus")).toThrow(/time zone|timezone/i);
  });
});
