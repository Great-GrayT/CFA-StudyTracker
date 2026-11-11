import { beforeEach, afterEach, test, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { resetDb } from "../helpers/test-db";
import { jsonRequest } from "../helpers/request";
import { db } from "../../src/lib/db";
import { GET } from "../../src/app/api/cron/tick/route";
import { setupUserWithPlan, ensureLevel, fullWeek, daysAgo, isoDate } from "../helpers/fixtures";
import * as pushModule from "../../src/lib/FUNC-push";
import * as coachModule from "../../src/lib/FUNC-coach";

beforeEach(async () => {
  await resetDb();
  await ensureLevel("I");
});

afterEach(() => {
  vi.restoreAllMocks();
});

test("tick without the correct bearer secret returns 401", async () => {
  const res = await GET(jsonRequest("GET", "/api/cron/tick"));
  expect(res.status).toBe(401);
});

test("tick writes one ProgressSnapshot per active plan for today", async () => {
  await setupUserWithPlan();
  await setupUserWithPlan();
  const res = await GET(
    jsonRequest("GET", "/api/cron/tick", undefined, { Authorization: `Bearer ${process.env.CRON_SECRET}` }),
  );
  expect(res.status).toBe(200);
  expect(await db.progressSnapshot.count()).toBe(2);
});

test("running tick twice the same day upserts rather than duplicating the row", async () => {
  await setupUserWithPlan();
  const req = () =>
    GET(jsonRequest("GET", "/api/cron/tick", undefined, { Authorization: `Bearer ${process.env.CRON_SECRET}` }));
  await req();
  await req();
  expect(await db.progressSnapshot.count()).toBe(1);
});

// Regresses a bug where one plan throwing mid-batch (e.g. malformed data)
// aborted the whole request, silently costing every other plan its nightly
// snapshot. Forces a real throw for one plan by writing JSON null into its
// required weeklyAvailability column (plannedHoursFor then reads a property
// off null), and asserts the other, healthy plan still gets its snapshot.
test("one plan's processing failure doesn't prevent a second, healthy active plan from getting its snapshot", async () => {
  const { plan: badPlan } = await setupUserWithPlan();
  const { plan: goodPlan } = await setupUserWithPlan();
  await db.studyPlan.update({ where: { id: badPlan.id }, data: { weeklyAvailability: Prisma.JsonNull } });

  const res = await GET(
    jsonRequest("GET", "/api/cron/tick", undefined, { Authorization: `Bearer ${process.env.CRON_SECRET}` }),
  );

  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.plansFailed).toBe(1);
  expect(await db.progressSnapshot.findFirst({ where: { planId: goodPlan.id } })).not.toBeNull();
  expect(await db.progressSnapshot.findFirst({ where: { planId: badPlan.id } })).toBeNull();
});

// The plan's startDate must be well before "yesterday" here - otherwise
// this would pass for the wrong reason (the now-fixed startDate-clipping
// bug: a brand-new plan created today has no valid "yesterday" to have
// missed yet, so missedDaysWindow is null and nothing would be sent
// regardless of whether the push logic itself works). Backdating startDate
// makes yesterday a genuine missed day, so this actually exercises the push.
test("tick sends a push notification for each user with a missed day and an active subscription", async () => {
  const { user } = await setupUserWithPlan({ weeklyAvailability: fullWeek, startDate: isoDate(daysAgo(10)) });
  await db.pushSubscription.create({ data: { userId: user.id, endpoint: "https://push.example/abc", p256dh: "k1", auth: "k2" } });
  const sendSpy = vi.spyOn(pushModule, "sendPushToUser").mockResolvedValue(undefined);

  await GET(jsonRequest("GET", "/api/cron/tick", undefined, { Authorization: `Bearer ${process.env.CRON_SECRET}` }));

  expect(sendSpy).toHaveBeenCalledWith(user.id, expect.objectContaining({ title: expect.any(String) }));
});

// The two tests that used to sit here asserted that the tick's own ad-hoc
// "You missed a study day" push did not fire in two cases. That push is gone:
// the coach supersedes it on the same channel, with the streak bands and the
// revised plan. The behaviours those tests protected are still covered where
// they now live, in pace.test.ts (a zero-hour weekday is not a missed day) and
// push.test.ts (no subscriptions means nothing is delivered). What the tick is
// still responsible for is calling the coach at all, which is what these
// replacements pin.

test("the coach runs for every active plan", async () => {
  await setupUserWithPlan();
  await setupUserWithPlan();
  const coachSpy = vi
    .spyOn(coachModule, "runCoachForPlan")
    .mockResolvedValue({ sent: [], skipped: [], failed: [] });

  await GET(jsonRequest("GET", "/api/cron/tick", undefined, { Authorization: `Bearer ${process.env.CRON_SECRET}` }));

  expect(coachSpy).toHaveBeenCalledTimes(2);
});

test("the coach still runs for a plan whose snapshot was skipped", async () => {
  // "skipped" means the exam date has passed. If the coach sat inside that skip
  // branch, a finished plan would never receive the sign-off, which is the one
  // email a finished plan should get. The coach itself decides what a past exam
  // warrants and sends that sign-off once.
  await setupUserWithPlan({
    weeklyAvailability: fullWeek,
    startDate: isoDate(daysAgo(10)),
    examDate: isoDate(daysAgo(1)),
  });
  const coachSpy = vi
    .spyOn(coachModule, "runCoachForPlan")
    .mockResolvedValue({ sent: [], skipped: [], failed: [] });

  const res = await GET(
    jsonRequest("GET", "/api/cron/tick", undefined, { Authorization: `Bearer ${process.env.CRON_SECRET}` }),
  );
  const body = await res.json();

  expect(body.plansSkipped).toBe(1);
  expect(coachSpy).toHaveBeenCalledTimes(1);
});

test("one plan's coach failure does not stop the next plan's", async () => {
  // Unattended batch: one bad record must never cost every other candidate
  // their email.
  await setupUserWithPlan();
  await setupUserWithPlan();
  const coachSpy = vi
    .spyOn(coachModule, "runCoachForPlan")
    .mockRejectedValueOnce(new Error("boom"))
    .mockResolvedValue({ sent: [], skipped: [], failed: [] });

  const res = await GET(jsonRequest("GET", "/api/cron/tick", undefined, { Authorization: `Bearer ${process.env.CRON_SECRET}` }));

  expect(res.status).toBe(200);
  expect(coachSpy).toHaveBeenCalledTimes(2);
});

test("the tick reports how many emails the coach sent", async () => {
  await setupUserWithPlan();
  vi.spyOn(coachModule, "runCoachForPlan").mockResolvedValue({
    sent: ["prescription", "nudge"],
    skipped: [],
    failed: [],
  });

  const res = await GET(jsonRequest("GET", "/api/cron/tick", undefined, { Authorization: `Bearer ${process.env.CRON_SECRET}` }));
  const body = await res.json();

  expect(body.emailsSent).toBe(2);
});

// Regresses the "forever post-exam" bug: once a plan's exam date has passed,
// cron must write no further snapshots, even though yesterday really was a
// missed day under the plan's own template.
test("tick writes no snapshot once a plan's exam date has passed", async () => {
  const { plan } = await setupUserWithPlan({
    weeklyAvailability: fullWeek,
    startDate: isoDate(daysAgo(10)),
    examDate: isoDate(daysAgo(1)),
  });
  // Stubbed so this test is about the snapshot half only. The coach's own
  // post-exam behaviour is pinned in tests/coach/.
  vi.spyOn(coachModule, "runCoachForPlan").mockResolvedValue({ sent: [], skipped: [], failed: [] });

  const res = await GET(
    jsonRequest("GET", "/api/cron/tick", undefined, { Authorization: `Bearer ${process.env.CRON_SECRET}` }),
  );
  const body = await res.json();

  expect(body.plansSkipped).toBe(1);
  expect(await db.progressSnapshot.findFirst({ where: { planId: plan.id } })).toBeNull();
});
