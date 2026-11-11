import { db } from "../../../../lib/db";
import { verifyUnsubscribeToken } from "../../../../lib/FUNC-unsubscribe";

/**
 * Stops the coach on one channel, from a link in an email, with no login.
 *
 * GET CONFIRMS, POST ACTS. That split is not ceremony. Mail clients and
 * security scanners prefetch links in messages, so a GET that performed the
 * unsubscribe would silence candidates who never clicked anything. The GET
 * returns a page with a button; the button posts.
 *
 * POST is also exactly what RFC 8058 one-click unsubscribe sends, so the same
 * endpoint serves the List-Unsubscribe-Post header that Gmail and Outlook
 * render as their own native unsubscribe control. One endpoint, both paths.
 *
 * No authentication, by design: the signed token IS the authorisation, and
 * requiring a login would defeat the entire purpose. The token only ever
 * authorises turning one channel off for one plan, which is the least harmful
 * capability in the system, and the signature covers the channel so a link that
 * silences email cannot be edited into one that silences push.
 */

const CHANNEL_LABEL = {
  email: "email",
  push: "phone notification",
} as const;

function page(title: string, body: string, status: number): Response {
  // Self-contained and inline-styled. This is opened from a mail client, often
  // in an in-app browser with no session and no access to the app's bundle, so
  // it cannot rely on anything the app ships.
  return new Response(
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
</head>
<body style="margin:0;background:#ffffff;color:#1a1a1a;font:16px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="max-width:34rem;margin:0 auto;padding:3rem 1.25rem;">
${body}
</div>
</body>
</html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } }
  );
}

function tokenFrom(req: Request): string {
  return new URL(req.url).searchParams.get("token") ?? "";
}

const INVALID = {
  title: "This link is not valid",
  body: `<h1 style="margin:0 0 1rem;font-size:1.5rem;font-weight:600;">This link is not valid</h1>
<p style="margin:0 0 1rem;color:#5a5a5a;">It may have been altered in transit, or truncated by a mail client that wrapped the line.</p>
<p style="margin:0;color:#5a5a5a;">You can turn the coach off at any time in your account settings.</p>`,
};

export async function GET(req: Request): Promise<Response> {
  const verified = verifyUnsubscribeToken(tokenFrom(req));
  if (!verified) {
    return page(INVALID.title, INVALID.body, 400);
  }

  const label = CHANNEL_LABEL[verified.channel];

  // Nothing is changed here. The button below is what acts.
  return page(
    `Stop coach ${label}s?`,
    `<h1 style="margin:0 0 1rem;font-size:1.5rem;font-weight:600;">Stop coach ${label}s?</h1>
<p style="margin:0 0 1.5rem;color:#5a5a5a;">Your study plan and all your logged progress stay exactly as they are. Only the daily ${label}s stop. You can turn them back on in your account settings whenever you like.</p>
<form method="post" action="/api/coach/unsubscribe?token=${encodeURIComponent(tokenFrom(req))}">
<button type="submit" style="display:inline-block;padding:0.75rem 1.25rem;background:#1452cc;color:#ffffff;border:0;border-radius:0.375rem;font:inherit;font-weight:600;cursor:pointer;">Stop the ${label}s</button>
</form>`,
    200
  );
}

export async function POST(req: Request): Promise<Response> {
  const verified = verifyUnsubscribeToken(tokenFrom(req));
  if (!verified) {
    return page(INVALID.title, INVALID.body, 400);
  }

  const { planId, channel } = verified;
  const label = CHANNEL_LABEL[channel];

  // updateMany rather than update: a plan deleted since the email was sent is
  // not an error worth showing somebody who is trying to leave. They wanted the
  // messages to stop, and they have.
  await db.studyPlan.updateMany({
    where: { id: planId },
    data: channel === "email" ? { emailCoach: "off" } : { pushCoach: "off" },
  });

  return page(
    "Done",
    `<h1 style="margin:0 0 1rem;font-size:1.5rem;font-weight:600;">Done. No more ${label}s.</h1>
<p style="margin:0 0 1rem;color:#5a5a5a;">Your plan and your progress are untouched. ${
      channel === "email"
        ? "Phone notifications are unaffected, and have their own setting."
        : "Emails are unaffected, and have their own setting."
    }</p>
<p style="margin:0;color:#5a5a5a;">Changed your mind? Turn them back on in your account settings.</p>`,
    200
  );
}
