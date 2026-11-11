import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { CRON_SCHEDULE, nextRunAt, isScheduleStalled } from "./cron-schedule";

describe("the published schedule", () => {
  // The watchdogs screen shows CRON_SCHEDULE to the operator as the
  // authoritative answer to "when does this run", while the thing that
  // actually runs is deploy/cron-schedule, installed into the server's
  // crontab by the deploy workflow. Nothing but this test connects them, and
  // a screen confidently reporting a schedule the server is not on is worse
  // than one that reports nothing.
  test("matches the crontab the deploy installs", () => {
    const committed = readFileSync(
      join(__dirname, "..", "..", "deploy", "cron-schedule"),
      "utf8",
    ).trim();
    expect(CRON_SCHEDULE).toBe(committed);
  });

  // Not a style preference. The coach's three delivery slots are in each
  // candidate's own local time across every time zone, so a daily expression
  // cannot reach them.
  test("fires many times a day, not once", () => {
    expect(CRON_SCHEDULE).toMatch(/^\*\/\d+ \* \* \* \*$/);
  });
});

describe("nextRunAt", () => {
  test("returns the next interval boundary", () => {
    expect(nextRunAt(new Date("2026-11-11T09:07:30Z")).toISOString()).toBe(
      "2026-11-11T09:15:00.000Z",
    );
  });

  test("is strictly after a time that lands exactly on a boundary", () => {
    expect(nextRunAt(new Date("2026-11-11T09:15:00Z")).toISOString()).toBe(
      "2026-11-11T09:30:00.000Z",
    );
  });

  test("rolls over the hour and the day", () => {
    expect(nextRunAt(new Date("2026-11-11T23:51:00Z")).toISOString()).toBe(
      "2026-11-12T00:00:00.000Z",
    );
  });
});

describe("isScheduleStalled", () => {
  const now = new Date("2026-11-11T12:00:00Z");

  test("no run yet is not a stall", () => {
    expect(isScheduleStalled(null, now)).toBe(false);
  });

  // A reboot or one slow run must not raise an alarm, which is the whole
  // reason the threshold is not a single missed window.
  test("a few missed windows is still idle", () => {
    expect(isScheduleStalled(new Date("2026-11-11T11:00:00Z"), now)).toBe(false);
  });

  test("hours without a run is a stopped scheduler", () => {
    expect(isScheduleStalled(new Date("2026-11-11T09:00:00Z"), now)).toBe(true);
  });
});
