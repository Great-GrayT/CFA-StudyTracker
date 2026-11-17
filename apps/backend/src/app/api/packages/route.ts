import { db } from "../../../lib/db";
import { requireUser } from "../../../lib/FUNC-auth";
import { createPackageSchema } from "../../../lib/validation";

export async function GET(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const packages = await db.studyPackage.findMany({
    where: { OR: [{ userId: null }, { userId: auth.userId }] },
  });

  // With a plan, each of its packages also lists its mock sessions and how their
  // questions split by topic, so a result can be entered per topic.
  const planId = new URL(req.url).searchParams.get("planId");
  if (!planId) return Response.json(packages, { status: 200 });

  const plan = await db.studyPlan.findUnique({ where: { id: planId } });
  if (!plan || plan.userId !== auth.userId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const inPlan = await db.planPackage.findMany({ where: { planId }, select: { packageId: true } });
  const ids = inPlan.map((p) => p.packageId);
  const [resources, topics, done] = await Promise.all([
    db.packageResource.findMany({
      where: { kind: "mock_session", edition: { levelId: plan.levelId, packageId: { in: ids } } },
      select: { ref: true, title: true, questionCount: true, topicMix: true, edition: { select: { packageId: true } } },
    }),
    db.topic.findMany({ where: { levelId: plan.levelId }, select: { id: true, name: true, order: true } }),
    db.mockExam.findMany({ where: { planId, sessionRef: { not: null } }, select: { sessionRef: true } }),
  ]);
  const byOrder = new Map(topics.map((t) => [t.order, t]));
  const doneRefs = new Set(done.map((d) => d.sessionRef));
  const sessionsOf = (packageId: string) =>
    resources
      .filter((r) => r.edition.packageId === packageId)
      .sort((a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true }))
      .map((r) => {
        const mix = r.topicMix && typeof r.topicMix === "object" && !Array.isArray(r.topicMix)
          ? (r.topicMix as Record<string, number>) : {};
        // Keys are topic orders; an order the level does not have is dropped.
        const topicMix = Object.entries(mix)
          .flatMap(([order, questions]) => {
            const t = byOrder.get(Number(order));
            return t ? [{ topicId: t.id, name: t.name, order: t.order, questions }] : [];
          })
          .sort((a, b) => a.order - b.order);
        return { ref: r.ref, title: r.title ?? r.ref, questionCount: r.questionCount, topicMix, done: doneRefs.has(r.ref) };
      });
  return Response.json(
    packages.map((p) => ({ ...p, mockSessions: ids.includes(p.id) ? sessionsOf(p.id) : [] })),
    { status: 200 },
  );
}

export async function POST(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = createPackageSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const pkg = await db.studyPackage.create({
    data: { name: parsed.data.name, userId: auth.userId },
  });

  return Response.json(pkg, { status: 201 });
}
