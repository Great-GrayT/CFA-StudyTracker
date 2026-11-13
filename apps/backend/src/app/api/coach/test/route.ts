// Send the candidate one message, now, so they can see whether a channel
// actually works.
//
// The coach only speaks at three fixed local times, so until one of them came
// round there was no way to tell a working setup from a broken one. Both
// channels had in fact been silently broken for the whole life of the app
// (the scheduler was answered 401 on every tick, and the subscribe payload
// was rejected as malformed), and nothing in the interface could have shown
// that. This is the button that would have.
//
// Deliberately NOT a real coach message. It writes no EmailSend row, so it
// cannot claim a slot and suppress the genuine send later in the day, and it
// needs none of the plan state a real message is built from. It proves the
// pipe, which is the only thing being asked.
import { db } from "../../../../lib/db";
import { requireUser } from "../../../../lib/FUNC-auth";
import { mailConfigured, sendMail } from "../../../../lib/FUNC-mail";
import { sendPushToUser } from "../../../../lib/FUNC-push";

type Channel = "email" | "push";

export async function POST(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const channel = (body as { channel?: unknown })?.channel;
  if (channel !== "email" && channel !== "push") {
    return Response.json(
      { error: 'channel must be "email" or "push"' },
      { status: 400 },
    );
  }

  const user = await db.user.findUniqueOrThrow({ where: { id: auth.userId } });

  if ((channel as Channel) === "email") {
    // Reported rather than silently dropped. sendMail logs and returns when
    // SMTP is unset, which is right for the coach (best effort) and wrong
    // here, where the entire point is to find out.
    if (!mailConfigured()) {
      return Response.json(
        { ok: false, reason: "Email is not configured on the server." },
        { status: 503 },
      );
    }
    try {
      await sendMail({
        to: user.email,
        subject: "Study Tracker: test message",
        text: "Your email notifications are working. The coach writes at the three times set in Settings, in your own time zone.",
        html: "<p>Your email notifications are working.</p><p>The coach writes at the three times set in Settings, in your own time zone.</p>",
      });
    } catch (err) {
      console.error("coach/test: email send failed", err);
      return Response.json(
        { ok: false, reason: "The server could not send the email." },
        { status: 502 },
      );
    }
    return Response.json({ ok: true, channel: "email", to: user.email });
  }

  const devices = await db.pushSubscription.count({ where: { userId: auth.userId } });
  if (devices === 0) {
    return Response.json(
      { ok: false, reason: "No device is registered for notifications yet." },
      { status: 409 },
    );
  }

  // sendPushToUser never throws: a dead endpoint is deleted and anything else
  // is logged, because the coach must not lose a whole run to one bad device.
  // That makes "it returned" a weaker signal than it looks, so the count of
  // devices still registered afterwards is what gets reported.
  await sendPushToUser(auth.userId, {
    title: "Study Tracker",
    body: "Your notifications are working.",
    tag: "coach-test",
    url: "/today",
  });

  const remaining = await db.pushSubscription.count({ where: { userId: auth.userId } });
  return Response.json({ ok: true, channel: "push", devices: remaining });
}
