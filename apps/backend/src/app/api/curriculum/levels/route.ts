import { db } from "../../../../lib/db";
import { requireUser } from "../../../../lib/FUNC-auth";

// A cheap summary of every level, for the onboarding level chooser.
//
// Without this the chooser would have to fetch the full tree for all three
// levels (close to a megabyte of outcome text) before the user has picked
// anything. This carries topic names and exam weights only, which is what the
// chooser actually draws, at roughly two kilobytes per level.
//
// `available` is reported rather than the level being omitted: a level that
// exists but has no curriculum seeded yet is a real state the chooser should
// show as disabled with a reason, not silently hide.
export async function GET(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const levels = await db.level.findMany({
    orderBy: { id: "asc" },
    include: {
      topics: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          name: true,
          order: true,
          examWeightMin: true,
          examWeightMax: true,
          _count: { select: { readings: true } },
        },
      },
    },
  });

  // One grouped count instead of a query per topic: at three levels and thirty
  // topics the N+1 version is thirty round trips for a screen that has not
  // drawn anything yet.
  const losCounts = await db.lOS.groupBy({
    by: ["readingId"],
    _count: { _all: true },
  });
  const readings = await db.reading.findMany({ select: { id: true, topicId: true } });
  const topicIdByReading = new Map(readings.map((r) => [r.id, r.topicId]));
  const losByTopic = new Map<string, number>();
  for (const row of losCounts) {
    const topicId = topicIdByReading.get(row.readingId);
    if (!topicId) continue;
    losByTopic.set(topicId, (losByTopic.get(topicId) ?? 0) + row._count._all);
  }

  return Response.json(
    {
      levels: levels.map((level) => {
        const topics = level.topics.map((t) => ({
          id: t.id,
          name: t.name,
          order: t.order,
          examWeightMin: t.examWeightMin,
          examWeightMax: t.examWeightMax,
          readingCount: t._count.readings,
          losCount: losByTopic.get(t.id) ?? 0,
        }));
        const losCount = topics.reduce((sum, t) => sum + t.losCount, 0);
        return {
          id: level.id,
          curriculumVersion: level.version,
          topicCount: topics.length,
          losCount,
          available: topics.length > 0 && losCount > 0,
          topics,
        };
      }),
    },
    { status: 200 },
  );
}
