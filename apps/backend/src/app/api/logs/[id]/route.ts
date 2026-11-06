import { db } from "../../../../lib/db";
import { requireUser } from "../../../../lib/FUNC-auth";

function idFromUrl(req: Request): string {
  const segments = new URL(req.url).pathname.split("/");
  return segments[3]!; // /api/logs/<id>
}

export async function DELETE(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const id = idFromUrl(req);
  const log = await db.studyLogEntry.findUnique({ where: { id } });
  if (!log || log.userId !== auth.userId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  await db.studyLogEntry.delete({ where: { id } });

  return Response.json({ ok: true }, { status: 200 });
}
