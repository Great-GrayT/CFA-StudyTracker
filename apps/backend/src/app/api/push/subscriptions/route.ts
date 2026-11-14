import { db } from "../../../../lib/db";
import { requireUser } from "../../../../lib/FUNC-auth";

// The caller's registered push devices, for the watchdogs screen.
//
// Removal is not here: DELETE /api/push/subscribe already exists and takes the
// endpoint in its body, so adding a second delete would be two routes for one
// job.
//
// p256dh and auth are deliberately absent from the response. They are the keys
// that authorise encrypting a push for that device; a list screen never needs
// them, so they never leave the server.
export async function GET(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const subscriptions = await db.pushSubscription.findMany({
    where: { userId: auth.userId },
    orderBy: { createdAt: "desc" },
    select: { id: true, endpoint: true, label: true, createdAt: true },
  });

  return Response.json(
    {
      subscriptions: subscriptions.map((s) => ({
        id: s.id,
        endpoint: s.endpoint,
        label: s.label,
        createdAt: s.createdAt.toISOString(),
      })),
    },
    { status: 200 },
  );
}
