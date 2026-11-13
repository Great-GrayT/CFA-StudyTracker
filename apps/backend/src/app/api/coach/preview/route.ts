// Previewing the coach from Settings: read what it would send for a slot, or
// for any event it can write, and optionally receive it. Previews are never
// recorded as sends, so they cannot use up the day's real message.
import { z } from "zod";
import { db } from "../../../../lib/db";
import { requireUser } from "../../../../lib/FUNC-auth";
import { previewCoach } from "../../../../lib/FUNC-coach";
import { mailConfigured, sendMail } from "../../../../lib/FUNC-mail";
import { sendPushToUser } from "../../../../lib/FUNC-push";
import { ALL_DIALOGUE_KEYS } from "../../../../core/coach-dialogue";
import { formatSchedule, parseSchedule, SLOTS_ORDERED } from "../../../../core/slots";

const KEY_PREFIX = { prescription: "P_", nudge: "N_", debrief: "D_" } as const;

const previewSchema = z.union([
  z.object({ slot: z.enum(["prescription", "nudge", "debrief"]), deliver: z.enum(["email", "push"]).optional() }).strict(),
  z.object({ key: z.enum(ALL_DIALOGUE_KEYS as unknown as [string, ...string[]]), deliver: z.enum(["email", "push"]).optional() }).strict(),
]);

async function activePlan(userId: string) {
  return db.studyPlan.findFirst({ where: { userId, isActive: true } });
}

export async function GET(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const plan = await activePlan(auth.userId);
  if (!plan) return Response.json({ error: "No active plan" }, { status: 404 });

  const events = Object.fromEntries(
    SLOTS_ORDERED.map((slot) => [slot, ALL_DIALOGUE_KEYS.filter((k) => k.startsWith(KEY_PREFIX[slot]))]),
  );
  return Response.json({
    schedule: formatSchedule(parseSchedule(plan.coachSchedule)),
    timeZone: plan.timeZone,
    events,
  });
}

export async function POST(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = previewSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Name a slot or an event" }, { status: 400 });
  const plan = await activePlan(auth.userId);
  if (!plan) return Response.json({ error: "No active plan" }, { status: 404 });

  const target =
    "slot" in parsed.data ? { slot: parsed.data.slot } : { key: parsed.data.key as (typeof ALL_DIALOGUE_KEYS)[number] };
  const preview = await previewCoach(plan.id, new Date(), target);

  const deliver = parsed.data.deliver;
  if (!deliver || !preview.message) return Response.json(preview);

  const user = await db.user.findUniqueOrThrow({ where: { id: auth.userId } });
  if (deliver === "email") {
    if (!mailConfigured()) {
      return Response.json({ ...preview, delivered: false, reason: "Email is not configured on the server.", error: "Email is not configured on the server." }, { status: 503 });
    }
    try {
      await sendMail({
        to: user.email,
        subject: `Preview: ${preview.message.subject}`,
        text: preview.message.text,
        html: preview.message.html,
      });
    } catch (err) {
      console.error("coach/preview: email send failed", err);
      return Response.json({ ...preview, delivered: false, reason: "The server could not send the email.", error: "The server could not send the email." }, { status: 502 });
    }
    return Response.json({ ...preview, delivered: true, to: user.email });
  }

  const devices = await db.pushSubscription.count({ where: { userId: auth.userId } });
  if (devices === 0) {
    return Response.json({ ...preview, delivered: false, reason: "No device is registered for notifications yet.", error: "No device is registered for notifications yet." }, { status: 409 });
  }
  await sendPushToUser(auth.userId, { ...preview.message.push, tag: "coach-preview" });
  return Response.json({ ...preview, delivered: true });
}
