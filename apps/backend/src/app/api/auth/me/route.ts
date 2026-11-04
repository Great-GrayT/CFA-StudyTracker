import { db } from "../../../../lib/db";
import { requireUser } from "../../../../lib/FUNC-auth";

export async function GET(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await db.user.findUnique({ where: { id: auth.userId } });
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  return Response.json(
    { id: user.id, email: user.email, createdAt: user.createdAt },
    { status: 200 },
  );
}
