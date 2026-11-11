import { test, expect } from "vitest";
import { db } from "../../src/lib/db";
import { resetDb } from "../helpers/test-db";
import { generateHorizon } from "../../src/lib/FUNC-schedule";
import { setupPlanWithCatalogue } from "../helpers/fixtures";

/**
 * Test with real catalogue data (if available in test DB) or complete test fixtures.
 * This test demonstrates the real-world usage: a plan using catalogue editions
 * over a loaded curriculum, generating a 14-day horizon and reporting the first 7 days.
 */
test("real catalogue: generate horizon and report first seven days", async () => {
  await resetDb();

  // Set up a plan with a linked catalogue (like the real Meldrum/UWorld)
  const { planId } = await setupPlanWithCatalogue();

  // Generate horizon
  const result = await generateHorizon(planId, "2027-01-04");

  console.log("\n=== HORIZON GENERATION RESULT ===");
  console.log(`Created: ${result.created}, Frozen: ${result.frozen}, Kept: ${result.kept}`);

  // Get all tasks and group by date
  const allTasks = await db.planTask.findMany({
    where: { planId },
    orderBy: [{ date: "asc" }, { order: "asc" }],
  });

  console.log("\n=== FIRST SEVEN DAYS ===");

  // Group tasks by date
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

  // Verify horizon stays within 14 days
  const maxDate = allTasks.length > 0 ? allTasks[allTasks.length - 1].date : new Date();
  const horizonEnd = new Date("2027-01-04T00:00:00Z");
  horizonEnd.setUTCDate(horizonEnd.getUTCDate() + 14 - 1);

  expect(maxDate <= horizonEnd).toBe(true);
  expect(allTasks.length).toBeGreaterThan(0);
});
