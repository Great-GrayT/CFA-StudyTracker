import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { db } from "../../../../../lib/db";
import { signJwt } from "../../../../../lib/FUNC-auth";
import { rpId, rpOrigin, consumeChallenge } from "../../../../../lib/FUNC-webauthn";

const INVALID = { error: "That passkey was not recognised." };

export async function POST(req: Request): Promise<Response> {
  let body: { response?: { id?: string; response?: { clientDataJSON?: string } } };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  const response = body.response;
  if (!response?.id || !response.response?.clientDataJSON) {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  let expectedChallenge: string;
  try {
    const clientData = JSON.parse(
      Buffer.from(response.response.clientDataJSON, "base64url").toString("utf8"),
    ) as { challenge: string };
    expectedChallenge = clientData.challenge;
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const stored = await consumeChallenge(expectedChallenge, "login");
  if (!stored) {
    return Response.json(INVALID, { status: 401 });
  }

  const passkey = await db.passkey.findUnique({
    where: { credentialId: response.id },
    include: { user: true },
  });
  if (!passkey) {
    return Response.json(INVALID, { status: 401 });
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: response as never,
      expectedChallenge,
      expectedOrigin: rpOrigin(),
      expectedRPID: rpId(),
      credential: {
        id: passkey.credentialId,
        publicKey: new Uint8Array(passkey.publicKey),
        counter: Number(passkey.counter),
        transports: passkey.transports as never,
      },
      requireUserVerification: false,
    });
  } catch {
    return Response.json(INVALID, { status: 401 });
  }

  if (!verification.verified) {
    return Response.json(INVALID, { status: 401 });
  }

  // A counter that did not advance means the credential may have been cloned.
  // Authenticators that always report 0 are exempt, since they opt out of the
  // mechanism entirely rather than failing it.
  const next = verification.authenticationInfo.newCounter;
  if (next !== 0 && next <= Number(passkey.counter)) {
    return Response.json(INVALID, { status: 401 });
  }

  await db.passkey.update({
    where: { id: passkey.id },
    data: { counter: BigInt(next), lastUsedAt: new Date() },
  });

  // No second step after a passkey: it is already multi-factor (the device
  // plus the user verification that unlocked it), so demanding TOTP as well
  // would be theatre.
  const token = signJwt({
    userId: passkey.userId,
    tokenVersion: passkey.user.tokenVersion,
    scope: "access",
  });
  return Response.json({ token }, { status: 200 });
}
