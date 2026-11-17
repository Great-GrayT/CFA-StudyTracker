import { beforeEach, expect, test } from "vitest";
import { db } from "../../src/lib/db";
import { resetDb } from "../helpers/test-db";
import { readJson } from "../helpers/request";
import { authedRequest, registerUser, setupPlanWithCatalogue } from "../helpers/fixtures";
import { GET } from "../../src/app/api/packages/route";

beforeEach(resetDb);

async function planWithMocks() {
  const { planId } = await setupPlanWithCatalogue();
  const user = await registerUser();
  await db.studyPlan.update({ where: { id: planId }, data: { userId: user.id } });
  const topic = await db.topic.findFirstOrThrow({ where: { levelId: "II", order: 2 } });
  const pkg = await db.studyPackage.create({ data: { slug: "pp-test", name: "PP", userId: null } });
  const ed = await db.packageEdition.create({ data: { packageId: pkg.id, levelId: "II", year: "2026" } });
  await db.packageResource.create({
    data: {
      editionId: ed.id, ref: "pp/mock/1", kind: "mock_session", title: "Mock 1", questionCount: 44,
      topicMix: { "2": 30, "99": 14 },
    },
  });
  await db.planPackage.create({ data: { planId, packageId: pkg.id, roles: ["mocks"] } });
  return { planId, user, pkg, topic };
}

test("with a plan, its packages list mock sessions with the topic mix resolved to topics", async () => {
  const { planId, user, pkg, topic } = await planWithMocks();
  const res = await GET(authedRequest(user, `/api/packages?planId=${planId}`));
  const body = await readJson(res);
  const mine = body.find((p: any) => p.id === pkg.id);
  expect(mine.mockSessions).toEqual([
    {
      ref: "pp/mock/1", title: "Mock 1", questionCount: 44, done: false,
      topicMix: [{ topicId: topic.id, name: topic.name, order: 2, questions: 30 }],
    },
  ]);
});

test("without a plan the list is unchanged, and another user's plan is forbidden", async () => {
  const { planId, user } = await planWithMocks();
  const plain = await readJson(await GET(authedRequest(user, "/api/packages")));
  expect(plain[0]).not.toHaveProperty("mockSessions");
  const intruder = await registerUser();
  expect((await GET(authedRequest(intruder, `/api/packages?planId=${planId}`))).status).toBe(403);
});
