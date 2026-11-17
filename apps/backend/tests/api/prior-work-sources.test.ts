// The prior-work intake, by material: which package (or the CFA Institute
// curriculum) the notes, videos and questions came from, per topic with
// per-module overrides, and a confidence rating.
import { beforeEach, describe, expect, test } from "vitest";
import { db } from "../../src/lib/db";
import { resetDb } from "../helpers/test-db";
import { readJson } from "../helpers/request";
import { hasRealSeedData, registerUser, setupPlanWithRealCatalogue } from "../helpers/fixtures";
import { GET, POST } from "../../src/app/api/plans/[id]/prior-work/route";

const TODAY = "2027-01-04";

function req(planId: string, token: string, body?: unknown): Request {
  return new Request(`http://localhost/api/plans/${planId}/prior-work`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function setup() {
  const { planId } = await setupPlanWithRealCatalogue();
  const user = await registerUser();
  await db.studyPlan.update({ where: { id: planId }, data: { userId: user.id } });

  const pkgWith = async (kind: string) =>
    (await db.studyPackage.findFirstOrThrow({
      where: { editions: { some: { units: { some: { resources: { some: { kind } } } } } } },
    })).id;
  const videoPkg = await pkgWith("lecture");
  const bankPkg = await pkgWith("question_set");

  // A module that has step 1 reading and step 2 practice, found from a real
  // dry-run schedule so the test does not hard-code catalogue shape.
  const { generateHorizon } = await import("../../src/lib/FUNC-schedule");
  const plan0 = await generateHorizon(planId, TODAY, { dryRun: true });
  const readingId = plan0.catalog.find((m) => {
    const mine = plan0.tasks.filter((t) => t.item.readingId === m.readingId);
    return mine.some((t) => t.item.step === 1) && mine.some((t) => t.item.step === 2);
  })!.readingId;
  const reading = await db.reading.findUniqueOrThrow({ where: { id: readingId } });
  return { planId, token: user.token, videoPkg, bankPkg, readingId, topicId: reading.topicId };
}

/** Whole-schedule uncrashed work minutes of this module by step. */
async function minutesByStep(planId: string, readingId: string): Promise<Record<number, number>> {
  const { generateHorizon } = await import("../../src/lib/FUNC-schedule");
  const r = await generateHorizon(planId, TODAY, { dryRun: true });
  const out: Record<number, number> = {};
  for (const t of r.tasks) {
    if (t.item.readingId === readingId) out[t.item.step] = (out[t.item.step] ?? 0) + t.workMinutes;
  }
  return out;
}

describe.runIf(hasRealSeedData())("prior work by material", () => {
  beforeEach(resetDb);

  test("sources are offered by what each package provides, plus the CFA curriculum", async () => {
    const { planId, token, videoPkg, bankPkg } = await setup();
    const body = await readJson(await GET(req(planId, token)));
    const ids = (k: string) => body.sources[k].map((s: { id: string }) => s.id);
    expect(ids("notes")).toEqual(expect.arrayContaining([videoPkg, "cfai-curriculum"]));
    expect(ids("videos")).toEqual([videoPkg]);
    expect(ids("questions")).toEqual(expect.arrayContaining([bankPkg, "cfai-curriculum"]));
    expect(ids("videos")).not.toContain(bankPkg);
  }, 120_000);

  test("declaring notes or videos credits step 1 and leaves the later steps", async () => {
    const { planId, token, videoPkg, readingId, topicId } = await setup();
    const before = await minutesByStep(planId, readingId);
    expect(before[1]).toBeGreaterThan(0);

    await POST(req(planId, token, { declarations: [{ topicId, readingId, notesFrom: videoPkg }] }));
    const after = await minutesByStep(planId, readingId);
    expect(after[1] ?? 0).toBe(0);
    expect(after[2]).toBeCloseTo(before[2]!, 0);
    expect(after[3]).toBeCloseTo(before[3]!, 0);

    await POST(req(planId, token, { declarations: [{ topicId, readingId, videosFrom: videoPkg }] }));
    expect((await minutesByStep(planId, readingId))[1] ?? 0).toBe(0);
  }, 240_000);

  test("reading the CFA curriculum counts as step 1", async () => {
    const { planId, token, readingId, topicId } = await setup();
    await POST(req(planId, token, { declarations: [{ topicId, readingId, notesFrom: "cfai-curriculum" }] }));
    expect((await minutesByStep(planId, readingId))[1] ?? 0).toBe(0);
    const rows = await db.studyLogEntry.findMany({ where: { planId, selfDeclared: true } });
    expect(rows.every((r) => r.packageId === "cfai-curriculum")).toBe(true);
  }, 120_000);

  test("declared questions become step 2 attempts: half the bank at 60% leaves a top-up", async () => {
    const { planId, token, bankPkg, readingId, topicId } = await setup();
    const bank = await db.packageResource.findFirstOrThrow({
      where: { kind: "question_set", unit: { readings: { some: { readingId } } } },
    });
    const before = (await minutesByStep(planId, readingId))[2]!;
    expect(before).toBeGreaterThan(0);

    const half = Math.floor(bank.questionCount! / 2);
    await POST(req(planId, token, {
      declarations: [{ topicId, readingId, questions: { from: bankPkg, answered: half, accuracyPercent: 60 } }],
    }));
    const after = (await minutesByStep(planId, readingId))[2]!;
    // 60% misses the 80% bar, so step 2 is not done, but the attempts reduce the work still owed.
    expect(after).toBeGreaterThan(0);
    expect(after).toBeLessThan(before);
  }, 240_000);

  test("confidence is stored on every row the declaration writes", async () => {
    const { planId, token, videoPkg, readingId, topicId } = await setup();
    await POST(req(planId, token, { declarations: [{ topicId, readingId, videosFrom: videoPkg, confidence: 1 }] }));
    const rows = await db.studyLogEntry.findMany({ where: { planId, selfDeclared: true } });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.confidence === 1 && r.declaredWatched)).toBe(true);
  }, 120_000);

  test("a module row overrides its topic row", async () => {
    const { planId, token, videoPkg, readingId, topicId } = await setup();
    await POST(req(planId, token, {
      declarations: [
        { topicId, notesFrom: videoPkg, videosFrom: videoPkg },
        { topicId, readingId },
      ],
    }));
    const losIds = (await db.lOS.findMany({ where: { readingId } })).map((l) => l.id);
    const rows = await db.studyLogEntry.findMany({ where: { planId, losId: { in: losIds } } });
    expect(rows).toHaveLength(0);
    expect(await db.studyLogEntry.count({ where: { planId } })).toBeGreaterThan(0);
  }, 120_000);

  test("what was submitted is returned to fill the form again", async () => {
    const { planId, token, videoPkg, topicId } = await setup();
    const declarations = [{ topicId, notesFrom: videoPkg, videosFrom: null, questions: null, confidence: 4 }];
    await POST(req(planId, token, { declarations }));
    const body = await readJson(await GET(req(planId, token)));
    expect(body.declarations).toEqual([expect.objectContaining({ topicId, notesFrom: videoPkg, confidence: 4 })]);
  }, 120_000);

  test("an unknown source or a module outside its topic is rejected", async () => {
    const { planId, token, readingId, topicId } = await setup();
    expect((await POST(req(planId, token, { declarations: [{ topicId, notesFrom: "nope" }] }))).status).toBe(400);
    const other = await db.reading.findFirstOrThrow({ where: { topicId: { not: topicId }, topic: { levelId: "II" } } });
    expect((await POST(req(planId, token, { declarations: [{ topicId, readingId: other.id }] }))).status).toBe(400);
    expect(readingId).toBeTruthy();
  }, 120_000);
});
