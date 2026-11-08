import { db } from "../../../../../lib/db";
import { signJwt, requireMfaToken } from "../../../../../lib/FUNC-auth";
import { verifyTotp, hashRecoveryCode, hashesMatch } from "../../../../../lib/FUNC-totp";

// The second step of sign in.
//
// Accepts either a code from the authenticator app or one recovery code. Both
// paths end in the same full-access token, because a recovery code IS the
// second factor when the phone is gone, not a lesser substitute.
const INVALID = { error: "That code is not right. Check the current one and try again." };

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { mfaToken, code } = (body ?? {}) as { mfaToken?: unknown; code?: unknown };
  if (typeof mfaToken !== "string" || typeof code !== "string") {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const auth = await requireMfaToken(mfaToken);
  if (!auth) {
    // Expired or not an mfa token at all. Says so plainly because the holder
    // already proved the password, so there is nothing left to leak.
    return Response.json(
      { error: "That sign in attempt timed out. Enter your password again." },
      { status: 401 },
    );
  }

  const user = await db.user.findUnique({ where: { id: auth.userId } });
  if (!user?.totpEnabledAt || !user.totpSecret) {
    return Response.json(INVALID, { status: 400 });
  }

  let ok = verifyTotp(code, user.totpSecret);

  if (!ok) {
    // Recovery codes are checked second so a normal sign in never touches
    // them. Compared by hash in constant time, then spent immediately.
    const candidate = hashRecoveryCode(code);
    const unused = await db.recoveryCode.findMany({
      where: { userId: user.id, usedAt: null },
    });
    const match = unused.find((r) => hashesMatch(r.codeHash, candidate));
    if (match) {
      await db.recoveryCode.update({ where: { id: match.id }, data: { usedAt: new Date() } });
      ok = true;
    }
  }

  if (!ok) {
    return Response.json(INVALID, { status: 400 });
  }

  const token = signJwt({ userId: user.id, tokenVersion: user.tokenVersion, scope: "access" });
  const remaining = await db.recoveryCode.count({ where: { userId: user.id, usedAt: null } });
  return Response.json({ token, recoveryCodesRemaining: remaining }, { status: 200 });
}
