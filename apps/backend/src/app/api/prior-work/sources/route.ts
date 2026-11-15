import { requireUser } from "../../../../lib/FUNC-auth";
import { priorWorkSources } from "../../../../lib/FUNC-prior-work";

/**
 * The material the "already studied" form may name, for a level rather than a
 * plan. Setup asks this question before the plan exists; the answers are
 * saved through the plan's own prior-work route once it does.
 */
export async function GET(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const levelId = new URL(req.url).searchParams.get("levelId");
  if (!levelId) return Response.json({ error: "levelId is required" }, { status: 400 });

  return Response.json(await priorWorkSources(levelId, auth.userId), { status: 200 });
}
