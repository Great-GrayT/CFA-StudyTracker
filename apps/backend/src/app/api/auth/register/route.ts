import { Prisma } from "@prisma/client";
import { db } from "../../../../lib/db";
import { hashPassword } from "../../../../lib/FUNC-crypto";
import { signJwt } from "../../../../lib/FUNC-auth";
import { registerSchema } from "../../../../lib/validation";

const EMAIL_TAKEN = { error: "Email already registered" };

export async function POST(req: Request): Promise<Response> {
  const body = await req.json();
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { email, password } = parsed.data;

  // Fast path only - saves a wasted hashPassword call in the common case.
  // It is NOT what makes this race-safe: two concurrent registrations for
  // the same email can both pass this check before either create() lands.
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    return Response.json(EMAIL_TAKEN, { status: 409 });
  }

  const passwordHash = await hashPassword(password);

  let user;
  try {
    user = await db.user.create({ data: { email, passwordHash } });
  } catch (error) {
    // The real guard: the DB's unique constraint on email is the only thing
    // that can't race. P2002 means another request's create() won the race.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return Response.json(EMAIL_TAKEN, { status: 409 });
    }
    throw error;
  }

  const token = signJwt({ userId: user.id, tokenVersion: user.tokenVersion });
  return Response.json({ token }, { status: 201 });
}
