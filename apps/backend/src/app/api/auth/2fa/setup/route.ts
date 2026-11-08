import { db } from "../../../../../lib/db";
import { requireUser } from "../../../../../lib/FUNC-auth";
import { generateSecret, otpauthUri } from "../../../../../lib/FUNC-totp";

// Begin two-step setup: mint a secret and hand back the otpauth URI to scan.
//
// The secret is written but two-step stays OFF until a code proves the app
// actually holds it (see ./enable). Enabling on setup would lock out anyone
// who closed the tab before scanning.
export async function POST(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await db.user.findUnique({ where: { id: auth.userId } });
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (user.totpEnabledAt) {
    // Re-running setup on an active account would silently invalidate the
    // authenticator the user is currently relying on.
    return Response.json(
      { error: "Two-step sign in is already on. Turn it off first to set up a new app." },
      { status: 409 },
    );
  }

  const secret = generateSecret();
  await db.user.update({ where: { id: user.id }, data: { totpSecret: secret } });

  return Response.json(
    {
      // Returned so the client can render a QR code locally rather than
      // fetching an image of the secret from a third party.
      otpauthUri: otpauthUri(user.email, secret),
      // For the "cannot scan" path, where the user types it in by hand.
      secret,
    },
    { status: 200 },
  );
}
