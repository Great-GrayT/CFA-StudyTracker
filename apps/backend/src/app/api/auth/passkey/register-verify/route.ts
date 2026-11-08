import { verifyRegistrationResponse } from "@simplewebauthn/server";
import { db } from "../../../../../lib/db";
import { requireUser } from "../../../../../lib/FUNC-auth";
import { rpId, rpOrigin, consumeChallenge } from "../../../../../lib/FUNC-webauthn";

export async function POST(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { response?: unknown; label?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const response = body.response as { response?: { clientDataJSON?: string } } | undefined;
  if (!response) {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  // The challenge is read from the client data and then looked up, so a
  // response for a challenge this server never issued cannot verify.
  let expectedChallenge: string;
  try {
    const clientData = JSON.parse(
      Buffer.from(response.response!.clientDataJSON!, "base64url").toString("utf8"),
    ) as { challenge: string };
    expectedChallenge = clientData.challenge;
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const stored = await consumeChallenge(expectedChallenge, "register");
  if (!stored || stored.userId !== auth.userId) {
    return Response.json({ error: "That attempt expired. Try again." }, { status: 400 });
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: response as never,
      expectedChallenge,
      expectedOrigin: rpOrigin(),
      expectedRPID: rpId(),
      requireUserVerification: false,
    });
  } catch {
    return Response.json({ error: "That passkey could not be verified." }, { status: 400 });
  }

  if (!verification.verified || !verification.registrationInfo) {
    return Response.json({ error: "That passkey could not be verified." }, { status: 400 });
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

  await db.passkey.create({
    data: {
      userId: auth.userId,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey),
      counter: BigInt(credential.counter),
      transports: (credential.transports ?? []) as string[],
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      label: typeof body.label === "string" && body.label.trim() ? body.label.trim().slice(0, 60) : null,
    },
  });

  return Response.json({ ok: true }, { status: 201 });
}
