import { db } from "../../../../lib/db";
import { requireUser } from "../../../../lib/FUNC-auth";
import { subscribePushSchema, unsubscribePushSchema } from "../../../../lib/validation";

export async function POST(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = subscribePushSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { endpoint, keys } = parsed.data;

  // Upsert by endpoint: a browser re-registering the same push subscription
  // (e.g. after a service-worker update) must update the existing row, not
  // create a duplicate. Re-ownership on re-subscribe is intentional too -
  // if the endpoint moved to a different account, the new owner wins.
  const subscription = await db.pushSubscription.upsert({
    where: { endpoint },
    create: { userId: auth.userId, endpoint, p256dh: keys.p256dh, auth: keys.auth },
    update: { userId: auth.userId, p256dh: keys.p256dh, auth: keys.auth },
  });

  return Response.json(subscription, { status: 201 });
}

export async function DELETE(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = unsubscribePushSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Scoped to the caller's own userId so one user can't unsubscribe another
  // user's endpoint; deleteMany is a no-op (not an error) if no row matches,
  // so retrying a DELETE for an already-removed subscription stays safe.
  await db.pushSubscription.deleteMany({
    where: { endpoint: parsed.data.endpoint, userId: auth.userId },
  });

  return Response.json({ ok: true }, { status: 200 });
}
