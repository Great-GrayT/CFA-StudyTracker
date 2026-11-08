import { generateRegistrationOptions } from "@simplewebauthn/server";
import { db } from "../../../../../lib/db";
import { requireUser } from "../../../../../lib/FUNC-auth";
import { rpId, RP_NAME, issueChallenge } from "../../../../../lib/FUNC-webauthn";

// Registering a passkey requires an existing session: a passkey is added to an
// account, it is not a way to create one.
export async function POST(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await db.user.findUnique({
    where: { id: auth.userId },
    include: { passkeys: true },
  });
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rpId(),
    userName: user.email,
    userDisplayName: user.email,
    attestationType: "none",
    // Excluding what is already registered makes the authenticator refuse a
    // duplicate itself, which is a clearer failure than a unique violation.
    excludeCredentials: user.passkeys.map((p) => ({
      id: p.credentialId,
      transports: p.transports as never,
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });

  await db.webAuthnChallenge.create({
    data: {
      challenge: options.challenge,
      kind: "register",
      userId: user.id,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    },
  });

  return Response.json(options, { status: 200 });
}
