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

  const passkeyCount = await db.passkey.count({ where: { userId: user.id } });

  return Response.json(
    {
      id: user.id,
      email: user.email,
      createdAt: user.createdAt,
      // Booleans, not the secret or the keys themselves: the settings screen
      // needs to know what is on, never what the credentials are.
      twoStepEnabled: user.totpEnabledAt !== null,
      passkeyCount,
      // An OAuth-only account has no password, so the screen must not offer to
      // change one or to use it as confirmation.
      hasPassword: user.passwordHash !== null,
    },
    { status: 200 },
  );
}
