import { db } from "../../../../lib/db";
import { verifyPassword } from "../../../../lib/FUNC-crypto";
import { signJwt } from "../../../../lib/FUNC-auth";
import { loginSchema } from "../../../../lib/validation";

// Same status and message for "no such email" and "wrong password" - never
// let a response distinguish the two, or an attacker can enumerate emails.
const INVALID_CREDENTIALS = { error: "Invalid email or password" };

export async function POST(req: Request): Promise<Response> {
  const body = await req.json();
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(INVALID_CREDENTIALS, { status: 401 });
  }
  const { email, password } = parsed.data;

  const user = await db.user.findUnique({ where: { email } });
  if (!user || !user.passwordHash) {
    return Response.json(INVALID_CREDENTIALS, { status: 401 });
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return Response.json(INVALID_CREDENTIALS, { status: 401 });
  }

  const token = signJwt({ userId: user.id, tokenVersion: user.tokenVersion });
  return Response.json({ token }, { status: 200 });
}
