import { createHash } from "node:crypto";
import { db } from "../../../../lib/db";
import { hashPassword } from "../../../../lib/FUNC-crypto";
import { resetPasswordSchema } from "../../../../lib/validation";

// Redeem a reset token and set a new password.
//
// Every failure returns the same 400 with the same message. Distinguishing
// "expired" from "already used" from "never existed" would tell an attacker
// holding a guessed token which part of the guess was wrong.

const INVALID = { error: "That reset link is invalid or has expired. Request a new one." };

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = resetPasswordSchema.safeParse(body);
  if (!parsed.success) {
    // A weak new password is a different failure from a bad token, and saying
    // so is safe: the caller already holds a valid link. The token is NOT
    // spent here, so a typo does not force another round trip through email.
    return Response.json({ error: "Use at least 8 characters." }, { status: 400 });
  }
  const { token, password } = parsed.data;

  // Looked up by hash, so a database leak yields no usable links. No
  // timing-safe compare is needed because the lookup is an indexed equality on
  // the hash, not a secret comparison in application code.
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const row = await db.passwordResetToken.findUnique({ where: { tokenHash } });

  if (!row || row.usedAt !== null || row.expiresAt.getTime() < Date.now()) {
    return Response.json(INVALID, { status: 400 });
  }

  const passwordHash = await hashPassword(password);

  // One transaction: the token must be spent and the password changed
  // together, or a crash between them would leave a live link for an account
  // whose password had already moved.
  await db.$transaction([
    db.passwordResetToken.update({
      where: { id: row.id },
      data: { usedAt: new Date() },
    }),
    db.user.update({
      where: { id: row.userId },
      // Bumping tokenVersion is the point of a reset, not a side effect:
      // whoever was signed in with the old password is signed out everywhere.
      data: { passwordHash, tokenVersion: { increment: 1 } },
    }),
  ]);

  return Response.json({ ok: true }, { status: 200 });
}
