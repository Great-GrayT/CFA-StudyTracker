import { db } from "../../../../lib/db";
import { requireUser } from "../../../../lib/FUNC-auth";

// The caller's registered passkeys. The public key and counter are internal
// and never leave the server.
export async function GET(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const passkeys = await db.passkey.findMany({
    where: { userId: auth.userId },
    orderBy: { createdAt: "desc" },
    select: { id: true, label: true, deviceType: true, backedUp: true, createdAt: true, lastUsedAt: true },
  });

  return Response.json(
    {
      passkeys: passkeys.map((p) => ({
        ...p,
        createdAt: p.createdAt.toISOString(),
        lastUsedAt: p.lastUsedAt ? p.lastUsedAt.toISOString() : null,
      })),
    },
    { status: 200 },
  );
}
