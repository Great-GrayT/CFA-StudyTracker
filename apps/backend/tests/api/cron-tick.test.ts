import { beforeEach, test, expect } from "vitest";
import { resetDb } from "../helpers/test-db";
import { jsonRequest } from "../helpers/request";
import { db } from "../../src/lib/db";
import { GET } from "../../src/app/api/cron/tick/route";
import { setupUserWithPlan, ensureLevel } from "../helpers/fixtures";

beforeEach(async () => {
  await resetDb();
  await ensureLevel("I");
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
