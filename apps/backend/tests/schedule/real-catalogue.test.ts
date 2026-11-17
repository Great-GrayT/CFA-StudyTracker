import { test, expect } from "vitest";
import { db } from "../../src/lib/db";
import { resetDb } from "../helpers/test-db";
import { generateHorizon } from "../../src/lib/FUNC-schedule";
import { setupPlanWithRealCatalogue, hasRealSeedData } from "../helpers/fixtures";

/**
 * End-to-end validation against the REAL curriculum and provider catalogue
 * (51 Level II readings, 2 editions, ~230 resources - the same private
 * seed-data loaded into the dev database, seeded here into the disposable
 * test database). Previously this test called the synthetic
 * setupPlanWithCatalogue() fixture despite its name, and asserted almost
 * nothing: only that the max date stayed in the horizon and that some
 * tasks existed. The real invariants were merely console.logged.
 */
// Seeds the entire real catalogue (51 readings, 2 editions, ~230 resources) and
// then generates a full horizon over it, so it is legitimately slower than the
// 5s default. The timeout is generous rather than tight on purpose: a tight one
// here fails on a loaded machine and teaches everyone to ignore the suite.
const REAL_CATALOGUE_TIMEOUT_MS = 60_000;

/**
 * Local only, and skipped rather than failed where the inputs do not exist.
 *
 * It needs the private `prisma/seed-data/*.json` files and `.env.test`, both
 * gitignored because the curriculum text and provider inventories are licensed.
 * Neither reaches CI or the Docker image, so in CI this test could never pass:
 * it failed the deploy gate on the first push after it was written.
 *
 * Skipping is the honest option of the three. Failing breaks CI for something
 * that cannot work there. Substituting the synthetic fixture would be worse
 * still: this test exists precisely to check the REAL catalogue produces every
 * task kind, and a synthetic stand-in would make it a test that cannot fail,
 * which is exactly how `content-notes` stayed unreachable for so long.
 */
const describeRealCatalogue = hasRealSeedData() ? test : test.skip;

describeRealCatalogue("real catalogue: generate horizon and report first seven days", async () => {
  await resetDb();

  const { planId } = await setupPlanWithRealCatalogue();

  const result = await generateHorizon(planId, "2027-01-04");

  console.log("\n=== HORIZON GENERATION RESULT ===");
  console.log(
    `Created: ${result.created}, Frozen: ${result.frozen}, Kept: ${result.kept}, Deleted: ${result.deleted}`,
  );

  const allTasks = await db.planTask.findMany({
    where: { planId },
    orderBy: [{ date: "asc" }, { order: "asc" }],
  });

  console.log("\n=== FIRST SEVEN DAYS ===");

  const tasksByDate = new Map<string, typeof allTasks>();
  for (const task of allTasks) {
    const dateStr = task.date.toISOString().slice(0, 10);
    if (!tasksByDate.has(dateStr)) {
      tasksByDate.set(dateStr, []);
    }
    tasksByDate.get(dateStr)!.push(task);
  }

  let dayCount = 0;
  for (const [dateStr, dateTasks] of tasksByDate) {
    if (dayCount >= 7) break;

    const dayDate = new Date(dateStr + "T00:00:00Z");
    const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][
      dayDate.getUTCDay()
    ];

    const totalMinutes = dateTasks.reduce((sum, t) => sum + t.estimatedMinutes, 0);
    console.log(`\n${dateStr} (${weekday}): ${dateTasks.length} tasks, ${totalMinutes} minutes`);

    for (const task of dateTasks) {
      const reading = await db.reading.findUnique({
        where: { id: task.readingIds[0] ?? "" },
      });
      console.log(
        `  ${task.order + 1}. [${task.kind}] ${reading?.name ?? "unknown"} (${task.estimatedMinutes} min)`,
      );
    }

    dayCount++;
  }

  console.log("\n=== SUMMARY ===");
  console.log(`Total days with tasks: ${tasksByDate.size}`);
  console.log(`Total tasks generated: ${allTasks.length}`);
  const kindCounts = new Map<string, number>();
  for (const t of allTasks) {
    kindCounts.set(t.kind, (kindCounts.get(t.kind) ?? 0) + 1);
  }
  console.log("Kind distribution:", Object.fromEntries(kindCounts));

  // Verify horizon stays within 14 days.
  const maxDate = allTasks.length > 0 ? allTasks[allTasks.length - 1].date : new Date();
  const horizonStart = new Date("2027-01-04T00:00:00Z");
  const horizonEnd = new Date(horizonStart);
  horizonEnd.setUTCDate(horizonEnd.getUTCDate() + 14 - 1);

  expect(maxDate <= horizonEnd).toBe(true);
  expect(allTasks.length).toBeGreaterThan(0);

  const plan = await db.studyPlan.findUniqueOrThrow({ where: { id: planId } });
  const weeklyAvailability = plan.weeklyAvailability as Record<string, number>;
  const weekdayKeys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

  // Weekday availability is a hard cap in the step engine. A day may exceed it
  // only by the rounding of each task to whole minutes.
  for (const [dateStr, dateTasks] of tasksByDate) {
    const weekdayKey = weekdayKeys[new Date(dateStr + "T00:00:00Z").getUTCDay()];
    const availableMinutes = (weeklyAvailability[weekdayKey] ?? 0) * 60;
    const totalMinutes = dateTasks.reduce((sum, t) => sum + t.estimatedMinutes, 0);
    expect(
      totalMinutes,
      `day ${dateStr} total minutes vs its ${availableMinutes}-minute availability`,
    ).toBeLessThanOrEqual(availableMinutes + dateTasks.length);
  }

  // The real catalogue must yield reading and question work, tagged with steps.
  const kinds = new Set(allTasks.map((t) => t.kind));
  expect(kinds.has("read")).toBe(true);
  expect(kinds.has("questions")).toBe(true);
  expect(allTasks.every((t) => t.step !== null && t.workMinutes !== null && t.estimatedMinutes > 0)).toBe(true);
  expect(
    (await db.studyPlan.findUniqueOrThrow({ where: { id: planId } })).fitReport,
  ).not.toBeNull();
}, REAL_CATALOGUE_TIMEOUT_MS);
