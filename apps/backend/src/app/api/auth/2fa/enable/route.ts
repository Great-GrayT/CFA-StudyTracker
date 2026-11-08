import { db } from "../../../../../lib/db";
import { requireUser } from "../../../../../lib/FUNC-auth";
import {
  verifyTotp,
  generateRecoveryCodes,
  hashRecoveryCode,
} from "../../../../../lib/FUNC-totp";

// Turn two-step on, by proving the authenticator holds the secret.
//
// Recovery codes are generated here and returned ONCE in plaintext. They are
// the only way back in when the phone is gone, so they must exist before the
// account can be locked by this feature, not after.
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
  const code = (body as { code?: unknown })?.code;
  if (typeof code !== "string") {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const user = await db.user.findUnique({ where: { id: auth.userId } });
  if (!user?.totpSecret) {
    return Response.json({ error: "Start setup first." }, { status: 400 });
  }
  if (user.totpEnabledAt) {
    return Response.json({ error: "Two-step sign in is already on." }, { status: 409 });
  }
  if (!verifyTotp(code, user.totpSecret)) {
    return Response.json({ error: "That code is not right. Try the current one." }, { status: 400 });
  }

  const codes = generateRecoveryCodes();
  await db.$transaction([
    // Any codes from a previous run are dead the moment a new set is issued.
    db.recoveryCode.deleteMany({ where: { userId: user.id } }),
    db.recoveryCode.createMany({
      data: codes.map((c) => ({ userId: user.id, codeHash: hashRecoveryCode(c) })),
    }),
    db.user.update({ where: { id: user.id }, data: { totpEnabledAt: new Date() } }),
  ]);

  return Response.json({ ok: true, recoveryCodes: codes }, { status: 200 });
}
