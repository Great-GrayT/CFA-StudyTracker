import { db } from "../../../../../lib/db";
import { requireUser } from "../../../../../lib/FUNC-auth";
import { declarationsSchema } from "../../../../../lib/validation";
import { todayIn } from "../../../../../lib/FUNC-today";
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
  // Omitted fields keep what is stored, so the merged row is what gets validated.
  const stored = new Map(existing.map((d) => [`${d.readingId}|${d.step}`, d]));
  for (const i of items) {
    const old = stored.get(`${i.readingId}|${i.step}`);
    const answered = i.answered !== undefined ? i.answered : old?.answered ?? null;
    const correct = i.correct !== undefined ? i.correct : old?.correct ?? null;
    if ((correct ?? 0) > (answered ?? 0)) {
      return Response.json({ error: "More correct than answered" }, { status: 400 });
    }
  }
  // Dates: a stored one is kept when none is sent, a new one defaults to the plan's first day.
  const today = todayIn(plan.timeZone);
  const startDay = plan.startDate.toISOString().slice(0, 10);
  const dateOf = new Map(existing.map((d) => [`${d.readingId}|${d.step}`, d.date.toISOString().slice(0, 10)]));
  for (const i of items) {
    if (i.date !== undefined) {
      if (i.date > today) return Response.json({ error: "A date cannot be after today" }, { status: 400 });
      dateOf.set(`${i.readingId}|${i.step}`, i.date);
    } else if (!dateOf.has(`${i.readingId}|${i.step}`)) {
      dateOf.set(`${i.readingId}|${i.step}`, startDay);
    }
  }
  // A review cannot be dated before the step it follows.
  for (const id of ids) {
    for (const [later, first, msg] of [
      [3, 1, "Review cannot be dated before the first read"],
      [4, 2, "Review questions cannot be dated before the initial questions"],
    ] as const) {
      const a = dateOf.get(`${id}|${first}`), b = dateOf.get(`${id}|${later}`);
      if (a && b && b < a) return Response.json({ error: msg }, { status: 400 });
    }
  }
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
          date: new Date(`${dateOf.get(`${i.readingId}|${i.step}`)}T00:00:00Z`),
          confidence: i.confidence ?? null, answered: i.answered ?? null, correct: i.correct ?? null,
        },
        update: {
          ...(i.date !== undefined && { date: new Date(`${i.date}T00:00:00Z`) }),
          ...(i.confidence !== undefined && { confidence: i.confidence }),
          ...(i.answered !== undefined && { answered: i.answered }),
          ...(i.correct !== undefined && { correct: i.correct }),
        },
      }),
    ),
  );

  // Show the effect now; the declarations are stored either way and the next tick rebuilds.
  try {
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
    select: { readingId: true, step: true, confidence: true, answered: true, correct: true, date: true },
    orderBy: [{ readingId: "asc" }, { step: "asc" }],
  });
  return Response.json({ items: rows.map((r) => ({ ...r, date: r.date.toISOString().slice(0, 10) })) });
}
