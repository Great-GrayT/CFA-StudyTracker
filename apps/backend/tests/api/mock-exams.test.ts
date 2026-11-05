import { beforeEach, test, expect } from "vitest";
import { resetDb } from "../helpers/test-db";
import { readJson } from "../helpers/request";
import { registerUser, setupUserWithPlan, authedRequest } from "../helpers/fixtures";
import { POST, GET } from "../../src/app/api/mock-exams/route";
import { DELETE } from "../../src/app/api/mock-exams/[id]/route";

beforeEach(resetDb);

test("POST /api/mock-exams logs a score for the caller's plan", async () => {
  const { user, plan } = await setupUserWithPlan();
  const res = await POST(
    authedRequest(user, "/api/mock-exams", { planId: plan.id, date: "2026-11-01", scorePercent: 68 }),
  );
  expect(res.status).toBe(201);
});

test("scorePercent outside 0-100 is rejected with 400", async () => {
  const { user, plan } = await setupUserWithPlan();
  const res = await POST(
    authedRequest(user, "/api/mock-exams", { planId: plan.id, date: "2026-11-01", scorePercent: 142 }),
  );
  expect(res.status).toBe(400);
});

test("POST /api/mock-exams is forbidden against another user's plan", async () => {
  const { plan } = await setupUserWithPlan();
  const intruder = await registerUser();
  const res = await POST(
    authedRequest(intruder, "/api/mock-exams", { planId: plan.id, date: "2026-11-01", scorePercent: 68 }),
  );
  expect(res.status).toBe(403);
});

test("GET /api/mock-exams lists the caller's scores for a plan, ordered by date", async () => {
  const { user, plan } = await setupUserWithPlan();
  await POST(authedRequest(user, "/api/mock-exams", { planId: plan.id, date: "2026-10-01", scorePercent: 55 }));
  await POST(authedRequest(user, "/api/mock-exams", { planId: plan.id, date: "2026-11-01", scorePercent: 68 }));
  const res = await GET(authedRequest(user, `/api/mock-exams?planId=${plan.id}`));
  const body = await readJson(res);
  expect(body.map((m: any) => m.scorePercent)).toEqual([55, 68]);
});

test("GET /api/mock-exams is forbidden against another user's plan", async () => {
  const { user, plan } = await setupUserWithPlan();
  const intruder = await registerUser();
  await POST(authedRequest(user, "/api/mock-exams", { planId: plan.id, date: "2026-11-01", scorePercent: 68 }));
  const res = await GET(authedRequest(intruder, `/api/mock-exams?planId=${plan.id}`));
  expect(res.status).toBe(403);
});

test("DELETE /api/mock-exams/:id removes one, 403 if it isn't the caller's", async () => {
  const { user, plan } = await setupUserWithPlan();
  const other = await registerUser();
  const mock = await readJson(
    await POST(authedRequest(user, "/api/mock-exams", { planId: plan.id, date: "2026-11-01", scorePercent: 68 })),
  );
  expect((await DELETE(authedRequest(other, `/api/mock-exams/${mock.id}`))).status).toBe(403);
  expect((await DELETE(authedRequest(user, `/api/mock-exams/${mock.id}`))).status).toBe(200);
});
