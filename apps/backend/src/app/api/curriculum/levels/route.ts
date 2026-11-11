import { createHash } from "node:crypto";
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

  const body = {
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
  };

  const payload = JSON.stringify(body);
  // Hashed like the full tree's ETag, and for a sharper reason here. This is
  // the response that decides whether the chooser shows a level at all, so a
  // client pinned to a stale copy is told a level does not exist. That happened
  // in production: a seed loaded Level II and candidates kept seeing Level I
  // only, because their cached copy predated it and nothing made them ask
  // again. Hashing the payload rather than the version means even a partial
  // reseed that forgets to bump a version produces a new ETag.
  const etag = `"${createHash("sha256").update(payload).digest("hex").slice(0, 32)}"`;

  // Private, not public: this sits behind a user token, so no shared cache may
  // keep a copy even though the content is identical for every user.
  // must-revalidate with max-age=0 so the client always asks, and almost always
  // gets a 304 for its trouble. The body is a couple of kilobytes; being wrong
  // about which levels exist is far more expensive than the round trip.
  const cacheHeaders = {
    etag,
    "cache-control": "private, max-age=0, must-revalidate",
  };

  if (req.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: cacheHeaders });
  }

  return new Response(payload, {
    status: 200,
    headers: { ...cacheHeaders, "content-type": "application/json" },
  });
}
