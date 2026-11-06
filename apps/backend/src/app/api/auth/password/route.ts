import { db } from "../../../../lib/db";
import { requireUser } from "../../../../lib/FUNC-auth";
import { hashPassword, verifyPassword } from "../../../../lib/FUNC-crypto";
import { changePasswordSchema } from "../../../../lib/validation";

// Change-password: the only route in this codebase that ever bumps
// tokenVersion. requireUser (FUNC-auth.ts) checks it on every request, but
// without something incrementing it, a leaked JWT is unrevocable for its
// full TTL - this closes that gap. Bumping tokenVersion here immediately
// invalidates every JWT issued before this call, including the one used to
// make this very request; the caller must log in again afterward.
export async function POST(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = changePasswordSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { currentPassword, newPassword } = parsed.data;

  const user = await db.user.findUnique({ where: { id: auth.userId } });
  // An OAuth-only account (no passwordHash) has no current password to
  // verify against - fail closed rather than letting a missing hash be
  // treated as "no password required".
  if (!user || !user.passwordHash) {
    return Response.json({ error: "Invalid current password" }, { status: 400 });
  }

  const valid = await verifyPassword(currentPassword, user.passwordHash);
  if (!valid) {
    return Response.json({ error: "Invalid current password" }, { status: 400 });
  }

  const passwordHash = await hashPassword(newPassword);
  await db.user.update({
    where: { id: auth.userId },
    data: { passwordHash, tokenVersion: { increment: 1 } },
  });

  return Response.json({ ok: true }, { status: 200 });
}
