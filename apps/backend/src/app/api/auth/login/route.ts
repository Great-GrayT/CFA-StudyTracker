import { db } from "../../../../lib/db";
import { hashPassword, verifyPassword } from "../../../../lib/FUNC-crypto";
import { signJwt, MFA_TOKEN_TTL_SECONDS } from "../../../../lib/FUNC-auth";
import { loginSchema } from "../../../../lib/validation";

// Same status and message for "no such email" and "wrong password" - never
// let a response distinguish the two, or an attacker can enumerate emails.
const INVALID_CREDENTIALS = { error: "Invalid email or password" };

// scrypt is deliberately slow; verifyPassword's cost is what makes the
// "wrong password" branch below take noticeably longer than a response that
// skips it. Precomputing (and caching) a dummy hash lets the "no such user" /
// "OAuth-only, no passwordHash" branches pay that same scrypt cost, so the
// two failure paths are not distinguishable by response time either -
// otherwise an attacker could enumerate valid emails via a timing side
// channel even though the status and body are identical.
const dummyPasswordHash: Promise<string> = hashPassword(
  "timing-safety-dummy-password-never-matches-anything",
);

export async function POST(req: Request): Promise<Response> {
  const body = await req.json();
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    await verifyPassword("", await dummyPasswordHash);
    return Response.json(INVALID_CREDENTIALS, { status: 401 });
  }
  const { email, password } = parsed.data;

  const user = await db.user.findUnique({ where: { email } });
  if (!user || !user.passwordHash) {
    await verifyPassword(password, await dummyPasswordHash);
    return Response.json(INVALID_CREDENTIALS, { status: 401 });
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return Response.json(INVALID_CREDENTIALS, { status: 401 });
  }

  // Two-step accounts get a short-lived token scoped to the second step only.
  // requireUser rejects that scope, so this response signs nobody in: it just
  // proves the password was right and carries that fact to /auth/2fa/verify.
  if (user.totpEnabledAt) {
    const mfaToken = signJwt(
      { userId: user.id, tokenVersion: user.tokenVersion, scope: "mfa" },
      { ttlSeconds: MFA_TOKEN_TTL_SECONDS },
    );
    return Response.json({ mfaRequired: true, mfaToken }, { status: 200 });
  }

  const token = signJwt({ userId: user.id, tokenVersion: user.tokenVersion, scope: "access" });
  return Response.json({ token }, { status: 200 });
}
