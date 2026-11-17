import { db } from "../../../../../lib/db";
import { requireUser } from "../../../../../lib/FUNC-auth";
import { declarationsSchema } from "../../../../../lib/validation";
import { generateHorizon } from "../../../../../lib/FUNC-schedule";

// Handlers are called directly in tests, so the id comes from the path.
function planIdFromUrl(req: Request): string {
  return new URL(req.url).pathname.split("/")[3]!; // /api/plans/<id>/declarations
}

/**
 * "Did this before" self-states, one per module and step. A later step cannot be
 * stated without its predecessor, either already stored or in the same request,
 * because the engine would otherwise drop it silently.
 */
export async function POST(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const planId = planIdFromUrl(req);
  const plan = await db.studyPlan.findUnique({ where: { id: planId } });
  if (!plan || plan.userId !== auth.userId) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const parsed = declarationsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid request body", issues: parsed.error.issues }, { status: 400 });
  }
  // A repeated module and step in one request: the last one wins.
  const items = [...new Map(parsed.data.items.map((i) => [`${i.readingId}|${i.step}`, i])).values()];

  const ids = [...new Set(items.map((i) => i.readingId))];
  const owned = await db.reading.count({ where: { id: { in: ids }, topic: { levelId: plan.levelId } } });
  if (owned !== ids.length) {
    return Response.json({ error: "A module does not belong to this plan's level" }, { status: 400 });
  }

  const existing = await db.stepDeclaration.findMany({ where: { planId, readingId: { in: ids } } });
  const has = new Set([...existing, ...items].map((d) => `${d.readingId}|${d.step}`));
  for (const i of items) {
    if (i.step === 3 && !has.has(`${i.readingId}|1`)) {
      return Response.json({ error: "Review needs the first read first" }, { status: 400 });
    }
    if (i.step === 4 && !has.has(`${i.readingId}|2`)) {
      return Response.json({ error: "Review questions need the initial questions first" }, { status: 400 });
    }
  }

  await db.$transaction(
    items.map((i) =>
      db.stepDeclaration.upsert({
        where: { planId_readingId_step: { planId, readingId: i.readingId, step: i.step } },
        create: {
          planId, readingId: i.readingId, step: i.step,
          confidence: i.confidence ?? null, answered: i.answered ?? null, correct: i.correct ?? null,
        },
        update: { confidence: i.confidence ?? null, answered: i.answered ?? null, correct: i.correct ?? null },
      }),
    ),
  );

  // Show the effect now; the declarations are stored either way and the next tick rebuilds.
  try {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: plan.timeZone ?? "UTC" }).format(new Date());
    await generateHorizon(planId, today);
  } catch (err) {
    console.error(`declarations POST: could not replan plan ${planId}`, err);
  }

  return Response.json({ saved: items.length }, { status: 201 });
}

/** The stored self-states, for the starting-point screens. */
export async function GET(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const planId = planIdFromUrl(req);
  const plan = await db.studyPlan.findUnique({ where: { id: planId } });
  if (!plan || plan.userId !== auth.userId) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const rows = await db.stepDeclaration.findMany({
    where: { planId },
    select: { readingId: true, step: true, confidence: true, answered: true, correct: true },
    orderBy: [{ readingId: "asc" }, { step: "asc" }],
  });
  return Response.json({ items: rows });
}
