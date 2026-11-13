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

  // A module whose first pass has both notes and video, found from a real
  // schedule so the test does not hard-code catalogue shape.
  const { generateHorizon } = await import("../../src/lib/FUNC-schedule");
  await generateHorizon(planId, TODAY, { horizonDays: 30 });
  const baseline = await db.planTask.findMany({ where: { planId } });
  const readingId = baseline
    .map((t) => t.readingIds[0])
    .find((id) => {
      const mine = baseline.filter((t) => t.readingIds[0] === id);
      return mine.some((t) => t.kind === "content-video") && mine.some((t) => t.kind === "content-notes");
    })!;
  const reading = await db.reading.findUniqueOrThrow({ where: { id: readingId } });
  return { planId, token: user.token, videoPkg, bankPkg, readingId, topicId: reading.topicId };
}

/** Rebuild from scratch and return this module's first-pass minutes by kind. */
async function minutesByKind(planId: string, readingId: string): Promise<Record<string, number>> {
  const { generateHorizon } = await import("../../src/lib/FUNC-schedule");
  await db.planTask.deleteMany({ where: { planId } });
  await generateHorizon(planId, TODAY, { horizonDays: 30 });
  const tasks = (await db.planTask.findMany({ where: { planId } })).filter((t) =>
    t.readingIds.includes(readingId),
  );
  const out: Record<string, number> = {};
  for (const t of tasks) out[t.kind] = (out[t.kind] ?? 0) + t.estimatedMinutes;
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

  test("notes read keep the video; videos watched keep the notes", async () => {
    const { planId, token, videoPkg, readingId, topicId } = await setup();
    const before = await minutesByKind(planId, readingId);

    await POST(req(planId, token, { declarations: [{ topicId, readingId, notesFrom: videoPkg }] }));
    const notesOnly = await minutesByKind(planId, readingId);
    expect(notesOnly["content-notes"] ?? 0).toBe(0);
    // The rest of the reading is untouched. Compared as a total: the packer
    // puts rounding drift on the largest chunk, which can move a few minutes'
    // label between video and seminar at a slice boundary.
    const rest = (m: Record<string, number>) => (m["content-video"] ?? 0) + (m["seminar"] ?? 0);
    expect(Math.abs(rest(notesOnly) - rest(before))).toBeLessThanOrEqual(1);
    expect(notesOnly["content-video"]).toBeGreaterThan(0);

    await POST(req(planId, token, { declarations: [{ topicId, readingId, videosFrom: videoPkg }] }));
    const videoOnly = await minutesByKind(planId, readingId);
    expect(videoOnly["content-video"] ?? 0).toBe(0);
    expect(videoOnly["content-notes"]).toBe(before["content-notes"]);
  }, 240_000);

  test("reading the CFA curriculum counts as the notes", async () => {
    const { planId, token, readingId, topicId } = await setup();
    await POST(req(planId, token, { declarations: [{ topicId, readingId, notesFrom: "cfai-curriculum" }] }));
    const after = await minutesByKind(planId, readingId);
    expect(after["content-notes"] ?? 0).toBe(0);
    const rows = await db.studyLogEntry.findMany({ where: { planId, selfDeclared: true } });
    expect(rows.every((r) => r.packageId === "cfai-curriculum")).toBe(true);
  }, 120_000);

  test("questions from the scheduled bank settle that share of it; from elsewhere only inform mastery", async () => {
    const { planId, token, bankPkg, readingId, topicId } = await setup();
    const practice = (m: Record<string, number>) => (m["questions"] ?? 0) + (m["answer-review"] ?? 0);
    const bank = await db.packageResource.findFirstOrThrow({
      where: { kind: "question_set", unit: { readings: { some: { readingId } } } },
    });
    const before = practice(await minutesByKind(planId, readingId));
    expect(before).toBeGreaterThan(0);

    const half = Math.floor(bank.questionCount! / 2);
    await POST(req(planId, token, {
      declarations: [{ topicId, readingId, questions: { from: bankPkg, answered: half, accuracyPercent: 60 } }],
    }));
    const after = practice(await minutesByKind(planId, readingId));
    expect(after).toBeLessThan(before * 0.65);
    expect(after).toBeGreaterThan(before * 0.35);

    await POST(req(planId, token, {
      declarations: [{ topicId, readingId, questions: { from: "cfai-curriculum", answered: 40, accuracyPercent: 60 } }],
    }));
    expect(practice(await minutesByKind(planId, readingId))).toBe(before);
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
