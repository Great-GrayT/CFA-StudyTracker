import { test, expect } from "vitest";
import { db } from "../../src/lib/db";
import { resetDb } from "../helpers/test-db";
import { generateHorizon } from "../../src/lib/FUNC-schedule";
import { setupPlanWithRealCatalogue } from "../helpers/fixtures";

/**
 * End-to-end validation against the REAL curriculum and provider catalogue
 * (51 Level II readings, 2 editions, ~230 resources - the same private
 * seed-data loaded into the dev database, seeded here into the disposable
 * test database). Previously this test called the synthetic
 * setupPlanWithCatalogue() fixture despite its name, and asserted almost
 * nothing: only that the max date stayed in the horizon and that some
 * tasks existed. The real invariants were merely console.logged.
 */
test("real catalogue: generate horizon and report first seven days", async () => {
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

  // No weekday inside the horizon that has availability is left empty.
  const plan = await db.studyPlan.findUniqueOrThrow({ where: { id: planId } });
  const weeklyAvailability = plan.weeklyAvailability as Record<string, number>;
  const weekdayKeys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

  for (let d = new Date(horizonStart); d <= horizonEnd; d.setUTCDate(d.getUTCDate() + 1)) {
    const dateStr = d.toISOString().slice(0, 10);
    const weekdayKey = weekdayKeys[d.getUTCDay()];
    const availableMinutes = weeklyAvailability[weekdayKey] ?? 0;
    if (availableMinutes <= 0) continue;

    // Only a day the scheduler could still have reached (i.e. before the
    // last task's date) is required to carry work - a day past the point
    // where material ran out legitimately has nothing to schedule.
    if (new Date(dateStr + "T00:00:00Z") > maxDate) continue;

    const dayTasks = tasksByDate.get(dateStr) ?? [];
    expect(dayTasks.length, `expected tasks on ${dateStr} (${weekdayKey}, ${availableMinutes} min available)`).toBeGreaterThan(0);
  }

  // No day's total ever exceeds its own availability.
  for (const [dateStr, dateTasks] of tasksByDate) {
    const weekdayKey = weekdayKeys[new Date(dateStr + "T00:00:00Z").getUTCDay()];
    const availableMinutes = weeklyAvailability[weekdayKey] ?? 0;
    const totalMinutes = dateTasks.reduce((sum, t) => sum + t.estimatedMinutes, 0);
    expect(totalMinutes, `day ${dateStr} total minutes vs its ${availableMinutes}-minute availability`).toBeLessThanOrEqual(availableMinutes);
  }

  // The task-kind distribution must include real question practice, not
  // only notes - this is exactly what would have caught CRITICAL1
  // (vignetteCount hardcoded to 0, so no "questions" task could ever be
  // generated) on the first pass.
  const kinds = new Set(allTasks.map((t) => t.kind));
  expect(kinds.has("questions")).toBe(true);
  expect(kinds.size).toBeGreaterThan(1);
});
