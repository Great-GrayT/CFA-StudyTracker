import { createHash } from "node:crypto";
import { db } from "../../../lib/db";
import { requireUser } from "../../../lib/FUNC-auth";

// The level's topic/reading/outcome tree.
//
// This is the only route that ships CFA Institute's outcome wording, which is
// why the text lives in the database (loaded from private seed data) and never
// in the repo. It is static per level between yearly reseeds, so the frontend
// fetches it once and holds it in IndexedDB; everything else the client shows
// joins against that cached tree by id.

// A year is safe because the ETag, not the clock, decides freshness: a reseed
// changes Level.version, which changes the ETag, which invalidates every
// cached copy on the next conditional request.
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export async function GET(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const levelId = new URL(req.url).searchParams.get("levelId");
  if (!levelId) {
    return Response.json({ error: "levelId query parameter is required" }, { status: 400 });
  }

  const level = await db.level.findUnique({ where: { id: levelId } });
  if (!level) {
    return Response.json({ error: "Unknown level" }, { status: 404 });
  }

  const topics = await db.topic.findMany({
    where: { levelId },
    orderBy: { order: "asc" },
    include: {
      readings: {
        orderBy: { order: "asc" },
        include: { los: { orderBy: { order: "asc" } } },
      },
    },
  });

  if (topics.length === 0) {
    return Response.json({ error: "Level is not seeded yet" }, { status: 404 });
  }

  const body = {
    levelId: level.id,
    curriculumVersion: level.version,
    topics: topics.map((t) => ({
      id: t.id,
      name: t.name,
      order: t.order,
      examWeightMin: t.examWeightMin,
      examWeightMax: t.examWeightMax,
      readings: t.readings.map((r) => ({
        id: r.id,
        name: r.name,
        order: r.order,
        los: r.los.map((l) => ({ id: l.id, text: l.text, order: l.order })),
      })),
    })),
  };

  const payload = JSON.stringify(body);
  // Hash the payload rather than just the version string: a partial reseed that
  // forgets to bump the version still produces a new ETag, so the client can
  // never be pinned to a tree the database no longer has.
  const etag = `"${createHash("sha256").update(payload).digest("hex").slice(0, 32)}"`;

  // Private, not public: this sits behind a user token, so no shared cache may
  // keep a copy even though the content is identical for every user.
  const cacheHeaders = {
    etag,
    "cache-control": `private, max-age=${MAX_AGE_SECONDS}, must-revalidate`,
  };

  if (req.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: cacheHeaders });
  }

  return new Response(payload, {
    status: 200,
    headers: { ...cacheHeaders, "content-type": "application/json" },
  });
}
