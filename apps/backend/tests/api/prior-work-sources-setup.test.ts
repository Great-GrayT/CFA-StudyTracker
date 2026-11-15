// Setup asks what was already studied before any plan exists, so it needs the
// same source list the plan's own form uses, keyed by level instead of plan.
import { beforeEach, expect, test } from "vitest";
import { resetDb } from "../helpers/test-db";
import { authedRequest, registerUser, setupPlanWithCatalogue } from "../helpers/fixtures";
import { readJson } from "../helpers/request";
import { GET } from "../../src/app/api/prior-work/sources/route";

beforeEach(async () => {
  await resetDb();
});

test("lists the sources for a level without a plan", async () => {
  await setupPlanWithCatalogue();
  const user = await registerUser();
  const res = await GET(authedRequest(user, "/api/prior-work/sources?levelId=II"));
  expect(res.status).toBe(200);
  const body = await readJson(res);
  expect(body.videos.map((s: { name: string }) => s.name)).toContain("Test Schedule Catalogue");
  expect(body.notes.map((s: { id: string }) => s.id)).toContain("cfai-curriculum");
  expect(body.questions.map((s: { id: string }) => s.id)).toContain("cfai-curriculum");
});

test("needs a level", async () => {
  const user = await registerUser();
  expect((await GET(authedRequest(user, "/api/prior-work/sources"))).status).toBe(400);
});

test("needs a signed-in user", async () => {
  expect((await GET(new Request("http://localhost/api/prior-work/sources?levelId=II"))).status).toBe(401);
});
