import { db } from "../../../../lib/db";
import { hashPassword } from "../../../../lib/FUNC-crypto";
import { signJwt } from "../../../../lib/FUNC-auth";
import { registerSchema } from "../../../../lib/validation";

export async function POST(req: Request): Promise<Response> {
  const body = await req.json();
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { email, password } = parsed.data;

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    return Response.json({ error: "Email already registered" }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);
  const user = await db.user.create({ data: { email, passwordHash } });

  const token = signJwt({ userId: user.id, tokenVersion: user.tokenVersion });
  return Response.json({ token }, { status: 201 });
}
