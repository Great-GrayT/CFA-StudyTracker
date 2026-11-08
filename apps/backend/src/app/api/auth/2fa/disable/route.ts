import { db } from "../../../../../lib/db";
import { requireUser } from "../../../../../lib/FUNC-auth";
import { verifyPassword } from "../../../../../lib/FUNC-crypto";

// Turn two-step off.
//
// Requires the password, not just a session. Turning off a second factor is
// exactly what someone who has stolen an unlocked device would do, so a
// hijacked session alone must not be enough.
export async function POST(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  const password = (body as { password?: unknown })?.password;
  if (typeof password !== "string") {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const user = await db.user.findUnique({ where: { id: auth.userId } });
  if (!user?.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
    return Response.json({ error: "That password is not right." }, { status: 400 });
  }

  await db.$transaction([
    db.recoveryCode.deleteMany({ where: { userId: user.id } }),
    db.user.update({
      where: { id: user.id },
      data: { totpSecret: null, totpEnabledAt: null },
    }),
  ]);

  return Response.json({ ok: true }, { status: 200 });
}
