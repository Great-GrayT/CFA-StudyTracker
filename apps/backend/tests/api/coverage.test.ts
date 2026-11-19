import { beforeEach, describe, expect, test } from "vitest";
import { db } from "../../src/lib/db";
import { resetDb } from "../helpers/test-db";
import { readJson } from "../helpers/request";
import { authedRequest, registerUser, fullWeek } from "../helpers/fixtures";
import { GET } from "../../src/app/api/plans/[id]/coverage/route";

async function setup() {
  const user = await registerUser();
  await db.level.upsert({ where: { id: "II" }, create: { id: "II" }, update: {} });
  const t1 = await db.topic.create({ data: { levelId: "II", name: "Ethics", order: 1, examWeightMin: 1, examWeightMax: 2 } });
  const t2 = await db.topic.create({ data: { levelId: "II", name: "Quant", order: 2, examWeightMin: 1, examWeightMax: 2 } });
  const r1 = await db.reading.create({ data: { topicId: t1.id, name: "R1", order: 1 } });
  const r2 = await db.reading.create({ data: { topicId: t2.id, name: "R2", order: 1 } });
  const los1 = await db.lOS.create({ data: { readingId: r1.id, text: "L1", order: 1 } });
  const los2 = await db.lOS.create({ data: { readingId: r1.id, text: "L2", order: 2 } });
  const pkg = await db.studyPackage.create({ data: { name: "Pkg", slug: "pkg", userId: null } });
  const oldEd = await db.packageEdition.create({ data: { packageId: pkg.id, levelId: "II", year: "2025" } });
  const ed = await db.packageEdition.create({ data: { packageId: pkg.id, levelId: "II", year: "2026" } });
  await db.packageUnit.create({ data: { editionId: oldEd.id, ref: "old", order: 1 } });
  // Unit spans both topics: files under topic 1 (first reading by topic order).
  const unit = await db.packageUnit.create({ data: { editionId: ed.id, ref: "u1", order: 1, title: "Unit 1" } });
  await db.packageUnitReading.createMany({ data: [{ unitId: unit.id, readingId: r2.id }, { unitId: unit.id, readingId: r1.id }] });
  await db.packageUnitLos.create({ data: { unitId: unit.id, sourceLabel: "a", losId: los1.id, questionCount: 5 } });
  await db.packageUnitLos.create({ data: { unitId: unit.id, sourceLabel: "b", losId: null } });
  const lec = await db.packageResource.create({ data: { editionId: ed.id, unitId: unit.id, ref: "lec", kind: "lecture", title: "Lec", durationSeconds: 600 } });
  const lec2 = await db.packageResource.create({ data: { editionId: ed.id, unitId: unit.id, ref: "lec2", kind: "eocq", durationSeconds: 300 } });
  await db.packageResource.create({ data: { editionId: ed.id, unitId: unit.id, ref: "notes", kind: "notes", pageCount: 5 } });
  const qs = await db.packageResource.create({ data: { editionId: ed.id, unitId: unit.id, ref: "qs", kind: "question_set", questionCount: 10 } });
  const plan = await db.studyPlan.create({
    data: { userId: user.id, levelId: "II", examDate: new Date("2027-05-01"), startDate: new Date("2027-01-04"), weeklyAvailability: fullWeek },
  });
  await db.planPackage.create({ data: { planId: plan.id, packageId: pkg.id, roles: [] } });
  return { user, plan, pkg, unit, lec, lec2, qs, los1, los2, r1, r2 };
}

const get = (u: Awaited<ReturnType<typeof registerUser>>, planId: string) =>
  GET(authedRequest(u, `/api/plans/${planId}/coverage`));

let n = 0;
async function task(planId: string, data: Record<string, unknown>) {
  return db.planTask.create({
    data: { planId, date: new Date("2027-01-04"), order: n++, kind: "questions", estimatedMinutes: 30, ...data } as never,
  });
}

describe("GET /api/plans/:id/coverage", () => {
  beforeEach(async () => { await resetDb(); n = 0; });

  test("rejects other users and missing auth", async () => {
    const s = await setup();
    const other = await registerUser();
    expect((await get(other, s.plan.id)).status).toBe(403);
    expect((await GET(new Request(`http://localhost/api/plans/${s.plan.id}/coverage`))).status).toBe(401);
  });

  test("empty progress: totals and unit shape, latest edition, unit under first topic", async () => {
    const s = await setup();
    const body = await readJson(await get(s.user, s.plan.id));
    expect(body.packages).toHaveLength(1);
    const p = body.packages[0];
    expect(p.year).toBe("2026");
    expect(p.videos).toEqual({ count: 2, watched: 0, seconds: 900, watchedSeconds: 0 });
    expect(p.questions).toEqual({ total: 10, answered: 0, correct: 0, numbered: 0 });
    expect(p.topics).toHaveLength(1);
    expect(p.topics[0].name).toBe("Ethics");
    const u = p.topics[0].units[0];
    expect(u.readingNames).toEqual(["R1", "R2"]);
    expect(u.questions.left).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(u.los.map((l: { label: string }) => l.label)).toEqual(["a", "b"]);
    expect(u.videos.every((v: { status: string }) => v.status === "not-started")).toBe(true);
  });

  test("video status from done and partial tasks", async () => {
    const s = await setup();
    await task(s.plan.id, { kind: "content-video", status: "done", resourceIds: [s.lec.id] });
    await task(s.plan.id, { kind: "eocq", status: "partial", resourceIds: [s.lec2.id] });
    const p = (await readJson(await get(s.user, s.plan.id))).packages[0];
    const vids = p.topics[0].units[0].videos;
    expect(vids.map((v: { status: string }) => v.status)).toEqual(["watched", "partial"]);
    expect(p.videos.watched).toBe(1);
    expect(p.videos.watchedSeconds).toBe(600);
  });

  test("self-declared watched credits the unit's videos for this package only", async () => {
    const s = await setup();
    await db.studyLogEntry.create({ data: { userId: s.user.id, planId: s.plan.id, losId: s.los1.id, packageId: s.pkg.id, confidence: 3, selfDeclared: true, declaredWatched: true } });
    const p = (await readJson(await get(s.user, s.plan.id))).packages[0];
    expect(p.videos.watched).toBe(2);
  });

  test("numbered question work lists what is left; unnumbered work hides it", async () => {
    const s = await setup();
    const t = await task(s.plan.id, { status: "done", resourceIds: [s.qs.id], questionNumbers: [1, 2, 3, 7] });
    await db.studyLogEntry.createMany({ data: [
      { userId: s.user.id, planId: s.plan.id, losId: s.los1.id, taskId: t.id, confidence: 3, questionsAnswered: 2, questionsCorrect: 2 },
      { userId: s.user.id, planId: s.plan.id, losId: s.los2.id, taskId: t.id, confidence: 3, questionsAnswered: 2, questionsCorrect: 1 },
    ] });
    let p = (await readJson(await get(s.user, s.plan.id))).packages[0];
    let u = p.topics[0].units[0];
    expect(u.questions.numbered).toEqual([1, 2, 3, 7]);
    expect(u.questions.left).toEqual([4, 5, 6, 8, 9, 10]);
    expect(u.questions).toMatchObject({ answered: 4, correct: 3, unnumbered: 0 });
    expect(u.los[0]).toMatchObject({ answered: 2, correct: 2 });
    expect(p.questions).toMatchObject({ total: 10, answered: 4, numbered: 4 });

    const t2 = await task(s.plan.id, { status: "done", resourceIds: [s.qs.id] });
    await db.studyLogEntry.create({ data: { userId: s.user.id, planId: s.plan.id, losId: s.los1.id, taskId: t2.id, confidence: 3, questionsAnswered: 3, questionsCorrect: 3 } });
    p = (await readJson(await get(s.user, s.plan.id))).packages[0];
    u = p.topics[0].units[0];
    expect(u.questions.left).toBeNull();
    expect(u.questions).toMatchObject({ unnumbered: 3, answered: 7 });
  });

  test("answered is capped at the bank size", async () => {
    const s = await setup();
    const t = await task(s.plan.id, { status: "done", resourceIds: [s.qs.id] });
    await db.studyLogEntry.create({ data: { userId: s.user.id, planId: s.plan.id, losId: s.los1.id, taskId: t.id, confidence: 3, questionsAnswered: 50, questionsCorrect: 40 } });
    const u = (await readJson(await get(s.user, s.plan.id))).packages[0].topics[0].units[0];
    expect(u.questions.answered).toBe(10);
    expect(u.questions.correct).toBe(10);
  });

  test("packages without an edition at the plan's level are skipped", async () => {
    const s = await setup();
    const other = await db.studyPackage.create({ data: { name: "NoEd", slug: "noed", userId: null } });
    await db.planPackage.create({ data: { planId: s.plan.id, packageId: other.id, roles: [] } });
    expect((await readJson(await get(s.user, s.plan.id))).packages).toHaveLength(1);
  });
});
