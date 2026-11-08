import { randomBytes, createHash } from "node:crypto";
import { db } from "../../../../lib/db";
import { forgotPasswordSchema } from "../../../../lib/validation";
import * as mailer from "../../../../lib/FUNC-mail";

// Start a password reset.
//
// The governing rule is that this route must answer identically whether or not
// the address exists. A different status, a different body, or a noticeably
// different response time all turn it into an account-enumeration oracle, and
// it is unauthenticated and rate limited precisely because anyone can call it.
//
// Rate limiting is already applied: middleware.ts puts this path in the
// register tier.

const TOKEN_TTL_MS = 60 * 60 * 1000;

// Always-identical success body, built once so no branch can accidentally
// return a subtly different shape.
const ACCEPTED = {
  ok: true,
  message: "If that email has an account, a reset link is on its way.",
};

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = forgotPasswordSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  const email = parsed.data.email.toLowerCase();

  const user = await db.user.findUnique({ where: { email } });

  // An OAuth-only account has no password to reset. Treated exactly like an
  // unknown address: no mail, same response.
  if (user && user.passwordHash) {
    // 32 bytes of CSPRNG output, base64url so it survives a query string
    // without escaping.
    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");

    // Any older token is spent first: requesting a new link must retire the
    // previous one, so a link forwarded or leaked earlier stops working.
    await db.$transaction([
      db.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      }),
      db.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
        },
      }),
    ]);

    const base = (process.env.FRONTEND_BASE_URL ?? "").replace(/\/$/, "");
    const link = `${base}/reset-password?token=${token}`;

    try {
      // Namespace import so tests can spy on the module's own binding.
      await mailer.sendMail({
        to: user.email,
        subject: "Reset your Study Tracker password",
        text: [
          "Someone asked to reset the password on your Study Tracker account.",
          "",
          "Open this link within the hour to choose a new one:",
          link,
          "",
          "If that was not you, nothing has changed and you can ignore this message.",
          "Signing in with your current password will cancel the request.",
        ].join("\n"),
      });
    } catch (err) {
      // Swallowed on purpose. A 500 here would tell an attacker the address
      // exists, since an unknown address never reaches this branch at all.
      console.error("forgot-password: could not send mail", err);
    }
  }

  return Response.json(ACCEPTED, { status: 200 });
}
