import { db } from "../../../../../lib/db";
import { requireUser } from "../../../../../lib/FUNC-auth";

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;

  // Scoped to the caller in the delete itself, so another user's id simply
  // matches nothing rather than relying on a separate ownership check.
  const result = await db.passkey.deleteMany({ where: { id, userId: auth.userId } });
  if (result.count === 0) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json({ ok: true }, { status: 200 });
}
