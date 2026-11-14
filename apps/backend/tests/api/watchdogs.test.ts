import { describe, test, expect, beforeEach, vi } from "vitest";
import { db } from "../../src/lib/db";
import { resetDb } from "../helpers/test-db";
import { jsonRequest, readJson } from "../helpers/request";
import { registerUser, setupUserWithPlan, fullWeek } from "../helpers/fixtures";
import { GET as CRON_RUNS } from "../../src/app/api/cron/runs/route";
import { POST as CRON_RUN } from "../../src/app/api/cron/run/route";
import { GET as PUSH_SUBS } from "../../src/app/api/push/subscriptions/route";
import { GET as TICK } from "../../src/app/api/cron/tick/route";
import { CRON_SCHEDULE } from "../../src/core/cron-schedule";

function authed(token: string, url: string, method = "GET", body?: unknown): Request {
  return jsonRequest(method, url, body, { Authorization: `Bearer ${token}` });
}

beforeEach(async () => {
  await resetDb();
  await db.cronRun.deleteMany({});
});

describe("GET /api/cron/runs", () => {
  test("requires a user token", async () => {
    const res = await CRON_RUNS(jsonRequest("GET", "/api/cron/runs"));
    expect(res.status).toBe(401);
  });

  test("reports the schedule and the next due run even with no history", async () => {
    const user = await registerUser();
    const body = await readJson(await CRON_RUNS(authed(user.token, "/api/cron/runs")));
    expect(body.runs).toEqual([]);
    expect(body.schedule).toBe(CRON_SCHEDULE);
    // A crontab is not introspectable over HTTP, so the server computes the
    // next occurrence rather than the client guessing from the expression.
    expect(typeof body.nextRunAt).toBe("string");
    expect(new Date(body.nextRunAt).getTime()).toBeGreaterThan(Date.now());
  });

  test("returns runs newest first and honours limit", async () => {
    const user = await registerUser();
    const base = Date.now();
    for (let i = 0; i < 5; i++) {
      await db.cronRun.create({
        data: {
          startedAt: new Date(base - i * 86_400_000),
          finishedAt: new Date(base - i * 86_400_000 + 1000),
          ok: true,
          plansProcessed: i,
        },
      });
    }
    const body = await readJson(await CRON_RUNS(authed(user.token, "/api/cron/runs?limit=3")));
    expect(body.runs).toHaveLength(3);
    const times = body.runs.map((r: { startedAt: string }) => new Date(r.startedAt).getTime());
    expect(times).toEqual([...times].sort((a: number, b: number) => b - a));
  });

  // Pressing "Run now" used to reset the stall clock, so the screen reported a
  // healthy scheduler while the scheduled sweep had been dead for days.
  test("a manual run does not hide a stalled scheduler", async () => {
    const user = await registerUser();
    const old = new Date(Date.now() - 6 * 3_600_000);
    await db.cronRun.create({ data: { startedAt: old, finishedAt: old, ok: true } });
    await db.cronRun.create({
      data: { finishedAt: new Date(), ok: true, triggeredByUserId: user.id },
    });
    const body = await readJson(await CRON_RUNS(authed(user.token, "/api/cron/runs")));
    expect(body.stalled).toBe(true);
    expect(new Date(body.lastRunAt).getTime()).toBe(old.getTime());
  });

  test("clamps an absurd limit rather than letting a caller read the whole table", async () => {
    const user = await registerUser();
    const res = await CRON_RUNS(authed(user.token, "/api/cron/runs?limit=100000"));
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.limit).toBeLessThanOrEqual(100);
  });

  test("surfaces a failed run as failed, not as absent", async () => {
    const user = await registerUser();
    await db.cronRun.create({
      data: { ok: false, plansFailed: 2, error: "boom", finishedAt: new Date() },
    });
    const body = await readJson(await CRON_RUNS(authed(user.token, "/api/cron/runs")));
    expect(body.runs[0]).toMatchObject({ ok: false, plansFailed: 2 });
  });
});

describe("the nightly tick records its run", () => {
  test("writes a CronRun row the watchdogs screen can read", async () => {
    await setupUserWithPlan({ weeklyAvailability: fullWeek });
    const res = await TICK(
      jsonRequest("GET", "/api/cron/tick", undefined, {
        Authorization: `Bearer ${process.env.CRON_SECRET}`,
      }),
    );
    expect(res.status).toBe(200);

    const runs = await db.cronRun.findMany({});
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ ok: true, triggeredByUserId: null });
    expect(runs[0].finishedAt).not.toBeNull();
  });

  test("records nothing when the caller is not the scheduler", async () => {
    await TICK(jsonRequest("GET", "/api/cron/tick", undefined, { Authorization: "Bearer wrong" }));
    expect(await db.cronRun.count()).toBe(0);
  });
});

describe("POST /api/cron/run", () => {
  test("requires a user token", async () => {
    const res = await CRON_RUN(jsonRequest("POST", "/api/cron/run"));
    expect(res.status).toBe(401);
  });

  test("404s when the caller has no active plan", async () => {
    const user = await registerUser();
    const res = await CRON_RUN(authed(user.token, "/api/cron/run", "POST"));
    expect(res.status).toBe(404);
  });

  test("writes today's snapshot for the caller's own plan only", async () => {
    const mine = await setupUserWithPlan({ weeklyAvailability: fullWeek });
    const theirs = await setupUserWithPlan({ weeklyAvailability: fullWeek });

    const res = await CRON_RUN(authed(mine.user.token, "/api/cron/run", "POST"));
    expect(res.status).toBe(200);

    const snapshots = await db.progressSnapshot.findMany({});
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].planId).toBe(mine.plan.id);

    // The nightly tick is global; a user-triggered run must never sweep other
    // people's plans, which is why this is scoped rather than reusing the tick.
    expect(snapshots.some((s) => s.planId === theirs.plan.id)).toBe(false);
  });

  test("is idempotent: running twice in a day updates one snapshot, never duplicates", async () => {
    const { user, plan } = await setupUserWithPlan({ weeklyAvailability: fullWeek });
    await CRON_RUN(authed(user.token, "/api/cron/run", "POST"));
    await CRON_RUN(authed(user.token, "/api/cron/run", "POST"));
    expect(await db.progressSnapshot.count({ where: { planId: plan.id } })).toBe(1);
  });

  test("attributes the run to the user who asked for it", async () => {
    const { user } = await setupUserWithPlan({ weeklyAvailability: fullWeek });
    await CRON_RUN(authed(user.token, "/api/cron/run", "POST"));
    const run = await db.cronRun.findFirstOrThrow({});
    expect(run.triggeredByUserId).toBe(user.id);
  });

  test("never sends a push, so a manual run cannot be used to spam a device", async () => {
    const pushModule = await import("../../src/lib/FUNC-push");
    const spy = vi.spyOn(pushModule, "sendPushToUser").mockResolvedValue(undefined as never);
    const { user } = await setupUserWithPlan({ weeklyAvailability: fullWeek });
    await CRON_RUN(authed(user.token, "/api/cron/run", "POST"));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("GET /api/push/subscriptions", () => {
  test("requires a token", async () => {
    const res = await PUSH_SUBS(jsonRequest("GET", "/api/push/subscriptions"));
    expect(res.status).toBe(401);
  });

  test("lists only the caller's own devices and never leaks the keys", async () => {
    const mine = await registerUser();
    const theirs = await registerUser();
    await db.pushSubscription.create({
      data: { userId: mine.id, endpoint: "https://push.example/mine", p256dh: "P256DH-SECRET-MINE", auth: "AUTH-SECRET-MINE" },
    });
    await db.pushSubscription.create({
      data: { userId: theirs.id, endpoint: "https://push.example/theirs", p256dh: "P256DH-SECRET-THEIRS", auth: "AUTH-SECRET-THEIRS" },
    });

    const body = await readJson(await PUSH_SUBS(authed(mine.token, "/api/push/subscriptions")));
    expect(body.subscriptions).toHaveLength(1);
    expect(body.subscriptions[0]).toMatchObject({ endpoint: "https://push.example/mine" });

    // The keys authorise sending to that device. The list screen never needs
    // them, so they must not be in the response at all.
    const serialized = JSON.stringify(body);
    // Distinctive values: "k1"/"a1" turned up inside random cuid ids and
    // failed the test about once in a few dozen runs.
    expect(serialized).not.toContain("P256DH-SECRET");
    expect(serialized).not.toContain("AUTH-SECRET");
  });
});
