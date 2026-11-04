import { db } from "../../../../../lib/db";
import { requireUser } from "../../../../../lib/FUNC-auth";
import { planPackageSchema } from "../../../../../lib/validation";

function planIdFromUrl(req: Request): string {
  const segments = new URL(req.url).pathname.split("/");
  return segments[3]!; // /api/plans/<id>/packages
}

async function findOwnedPlan(planId: string, userId: string) {
  const plan = await db.studyPlan.findUnique({ where: { id: planId } });
  if (!plan || plan.userId !== userId) return null;
  return plan;
}

export async function GET(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const planId = planIdFromUrl(req);
  const plan = await findOwnedPlan(planId, auth.userId);
  if (!plan) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const rows = await db.planPackage.findMany({
    where: { planId },
    include: { package: true },
  });

  return Response.json(
    rows.map((row) => ({
      id: row.id,
      planId: row.planId,
      packageId: row.packageId,
      roles: row.roles,
      name: row.package.name,
    })),
    { status: 200 },
  );
}

export async function POST(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const planId = planIdFromUrl(req);
  const plan = await findOwnedPlan(planId, auth.userId);
  if (!plan) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = planPackageSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { packageId, roles } = parsed.data;

  // Unique on [planId, packageId]: re-tagging the same package replaces its
  // roles in place rather than creating a second row for the pair.
  const planPackage = await db.planPackage.upsert({
    where: { planId_packageId: { planId, packageId } },
    create: { planId, packageId, roles },
    update: { roles },
  });

  return Response.json(planPackage, { status: 201 });
}
