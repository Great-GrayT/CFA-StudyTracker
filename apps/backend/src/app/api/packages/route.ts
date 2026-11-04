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

  return Response.json(packages, { status: 200 });
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
