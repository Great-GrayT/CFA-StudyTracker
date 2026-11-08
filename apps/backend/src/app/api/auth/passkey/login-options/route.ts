import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { db } from "../../../../../lib/db";
import { rpId, pruneChallenges } from "../../../../../lib/FUNC-webauthn";

// Passkey sign in, discoverable (no email asked for first).
//
// allowCredentials is deliberately empty: naming the credentials for a given
// email would turn this unauthenticated route into an account-enumeration
// oracle, which is exactly what the login route works to avoid.
export async function POST(): Promise<Response> {
  await pruneChallenges();

  const options = await generateAuthenticationOptions({
    rpID: rpId(),
    userVerification: "preferred",
  });

  await db.webAuthnChallenge.create({
    data: {
      challenge: options.challenge,
      kind: "login",
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    },
  });

  return Response.json(options, { status: 200 });
}
