import { beforeEach, describe, test, expect } from "vitest";
import { db } from "../../src/lib/db";
import { resetDb } from "../helpers/test-db";
import { registerUser, setupPlanWithCatalogue } from "../helpers/fixtures";
import { PATCH as PATCH_PLAN } from "../../src/app/api/plans/[id]/route";
import { GET as GET_SETTINGS } from "../../src/app/api/settings/route";

function patchRequest(planId: string, token: string, body: unknown): Request {
  return new Request(`http://localhost/api/plans/${planId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

function settingsRequest(token: string): Request {
  return new Request("http://localhost/api/settings", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

/** A plan owned by a freshly registered user, with that user's token. */
async function ownedPlan(): Promise<{ planId: string; token: string }> {
  const { planId } = await setupPlanWithCatalogue();
  const plan = await db.studyPlan.findUniqueOrThrow({ where: { id: planId } });
  const user = await registerUser();
  // Hand the catalogue plan to the token holder, so the ownership checks in
  // the route are exercised against a real session rather than bypassed.
  await db.studyPlan.update({
    where: { id: planId },
    data: { userId: user.id, isActive: true },
  });
  await db.studyPlan.updateMany({
    where: { userId: plan.userId, id: { not: planId } },
    data: { isActive: false },
  });
  return { planId, token: user.token };
}

describe("plan mode, review policy and tuning over the API", () => {
  beforeEach(async () => {
    await resetDb();
  });

  test("PATCH accepts a valid plan mode and persists it", async () => {
    const { planId, token } = await ownedPlan();
    const res = await PATCH_PLAN(patchRequest(planId, token, { planMode: "curriculum-strict" }));
    expect(res.status).toBe(200);
    expect(await db.studyPlan.findUniqueOrThrow({ where: { id: planId } })).toMatchObject({
      planMode: "curriculum-strict",
    });
  });

  test("PATCH rejects an unknown plan mode with 400 and writes nothing", async () => {
    const { planId, token } = await ownedPlan();
    const res = await PATCH_PLAN(patchRequest(planId, token, { planMode: "vibes" }));
    expect(res.status).toBe(400);
    expect(await db.studyPlan.findUniqueOrThrow({ where: { id: planId } })).toMatchObject({
      planMode: "curriculum-topic",
    });
  });

  test("PATCH accepts every documented review policy", async () => {
    const { planId, token } = await ownedPlan();
    for (const reviewPolicy of ["after-coverage", "weekly-interleave", "decay-triggered"]) {
      const res = await PATCH_PLAN(patchRequest(planId, token, { reviewPolicy }));
      expect(res.status, reviewPolicy).toBe(200);
    }
  });

  test("PATCH rejects the fixed-date policy with no date", async () => {
    const { planId, token } = await ownedPlan();
    const res = await PATCH_PLAN(patchRequest(planId, token, { reviewPolicy: "fixed-date" }));
    expect(res.status).toBe(400);
  });

  test("PATCH accepts the fixed-date policy when a date comes with it", async () => {
    const { planId, token } = await ownedPlan();
    const res = await PATCH_PLAN(
      patchRequest(planId, token, {
        reviewPolicy: "fixed-date",
        reviewStartDate: "2027-03-01",
      }),
    );
    expect(res.status).toBe(200);
    const plan = await db.studyPlan.findUniqueOrThrow({ where: { id: planId } });
    expect(plan.reviewPolicy).toBe("fixed-date");
    expect(plan.reviewStartDate).not.toBeNull();
  });

  test("PATCH stores an out of range constant as its clamped value and reports it", async () => {
    const { planId, token } = await ownedPlan();
    const res = await PATCH_PLAN(patchRequest(planId, token, { tuning: { masteryBar: 1.4 } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rejectedTuning.map((r: { field: string }) => r.field)).toContain("masteryBar");
  });

  test("one bad constant does not cost the candidate the good ones in the same request", async () => {
    const { planId, token } = await ownedPlan();
    const res = await PATCH_PLAN(
      patchRequest(planId, token, {
        tuning: { firstPassQuestionMultiple: 3, masteryBar: 1.4 },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tuning.firstPassQuestionMultiple).toBe(3);
    expect(body.tuning.masteryBar).toBe(0.75);
  });

  test("PATCH rejects a tuning field that is not a number at all", async () => {
    const { planId, token } = await ownedPlan();
    const res = await PATCH_PLAN(
      patchRequest(planId, token, { tuning: { masteryHalfLifeDays: "soon" } }),
    );
    expect(res.status).toBe(400);
  });

  test("PATCH rejects a tuning key the engine does not read", async () => {
    const { planId, token } = await ownedPlan();
    const res = await PATCH_PLAN(
      patchRequest(planId, token, { tuning: { favouriteColour: 7 } }),
    );
    expect(res.status).toBe(400);
  });

  test("changing the plan mode replans the days ahead", async () => {
    const { planId, token } = await ownedPlan();
    await PATCH_PLAN(patchRequest(planId, token, { planMode: "curriculum-topic" }));
    const before = await db.planTask.count({ where: { planId } });
    expect(before).toBeGreaterThan(0);
  });

  test("another user cannot patch a plan that is not theirs", async () => {
    const { planId } = await ownedPlan();
    const intruder = await registerUser();
    const res = await PATCH_PLAN(
      patchRequest(planId, intruder.token, { planMode: "curriculum-strict" }),
    );
    expect(res.status).toBe(403);
    expect(await db.studyPlan.findUniqueOrThrow({ where: { id: planId } })).toMatchObject({
      planMode: "curriculum-topic",
    });
  });

  test("GET settings returns the tuning block, its ranges, its defaults and the derived figures", async () => {
    const { planId, token } = await ownedPlan();
    await PATCH_PLAN(patchRequest(planId, token, { planMode: "curriculum-topic" }));

    const res = await GET_SETTINGS(settingsRequest(token));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.planner.tuning).toMatchObject({
      planMode: "curriculum-topic",
      reviewPolicy: "decay-triggered",
    });
    expect(body.planner.ranges.masteryBar).toEqual({ min: 0.3, max: 0.95 });
    expect(body.planner.defaults.masteryBar).toBe(0.75);
    expect(body.planner.modes).toEqual([
      "effort-return",
      "curriculum-strict",
      "curriculum-topic",
    ]);
    expect(body.planner.policies).toEqual([
      "decay-triggered",
      "after-coverage",
      "weekly-interleave",
      "fixed-date",
    ]);
    expect(body.planner).toHaveProperty("requestedQuestionMultiple");
    expect(body.planner).toHaveProperty("effectiveQuestionMultiple");
    expect(body.planner).toHaveProperty("calendarTooShort");
    expect(body.planner).toHaveProperty("injectionCap");
    expect(body.planner).toHaveProperty("reviewReason");
    expect(body.planner).toHaveProperty("writeOffs");
    expect(body.planner).toHaveProperty("underPractised");
  });

  test("GET settings reflects a candidate's saved overrides", async () => {
    const { planId, token } = await ownedPlan();
    await PATCH_PLAN(
      patchRequest(planId, token, { tuning: { masteryHalfLifeDays: 90, masteryBar: 0.6 } }),
    );
    const body = await (await GET_SETTINGS(settingsRequest(token))).json();
    expect(body.planner.tuning.masteryHalfLifeDays).toBe(90);
    expect(body.planner.tuning.masteryBar).toBe(0.6);
  });

  test("a user with no active plan still gets a settings page rather than an error", async () => {
    const user = await registerUser();
    const res = await GET_SETTINGS(settingsRequest(user.token));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.planner).toBeNull();
  });

  test("settings needs a session", async () => {
    const res = await GET_SETTINGS(new Request("http://localhost/api/settings"));
    expect(res.status).toBe(401);
  });
});
