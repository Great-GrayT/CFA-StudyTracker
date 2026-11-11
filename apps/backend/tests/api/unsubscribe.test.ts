import { beforeEach, test, expect } from "vitest";
import { resetDb } from "../helpers/test-db";
import { db } from "../../src/lib/db";
import { GET, POST } from "../../src/app/api/coach/unsubscribe/route";
import { setupUserWithPlan, anyLosIdForLevel } from "../helpers/fixtures";
import {
  unsubscribeToken,
  unsubscribeUrl,
  verifyUnsubscribeToken,
} from "../../src/lib/FUNC-unsubscribe";

beforeEach(async () => {
  await resetDb();
  await anyLosIdForLevel("I");
});

function url(token: string): string {
  return `http://test/api/coach/unsubscribe?token=${encodeURIComponent(token)}`;
}

// THE TOKEN

test("a token round-trips to the plan and channel it was issued for", () => {
  const token = unsubscribeToken("plan-abc", "email");
  expect(verifyUnsubscribeToken(token)).toEqual({ planId: "plan-abc", channel: "email" });
});

test("the same plan gets different tokens per channel", () => {
  // The channel is inside the signed payload, so one cannot be swapped for the
  // other by editing the URL.
  expect(unsubscribeToken("plan-abc", "email")).not.toBe(unsubscribeToken("plan-abc", "push"));
});

test("editing the channel in a valid token invalidates it", () => {
  // The attack this prevents: taking an email unsubscribe link and turning it
  // into one that silences somebody's phone notifications.
  const token = unsubscribeToken("plan-abc", "email");
  const tampered = token.replace(".email.", ".push.");
  expect(verifyUnsubscribeToken(tampered)).toBeNull();
});

test("editing the plan id in a valid token invalidates it", () => {
  const token = unsubscribeToken("plan-abc", "email");
  const tampered = token.replace("plan-abc", "plan-xyz");
  expect(verifyUnsubscribeToken(tampered)).toBeNull();
});

test.each([
  ["an empty string", ""],
  ["no signature", "plan-abc.email"],
  ["too many parts", "plan-abc.email.sig.extra"],
  ["an empty plan id", ".email.sig"],
  ["an unknown channel", "plan-abc.sms.sig"],
  ["a wrong signature of the right length", "plan-abc.email.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
])("a malformed token is rejected: %s", (_label, token) => {
  expect(verifyUnsubscribeToken(token)).toBeNull();
});

test("the url contains the token and does not double its slashes", () => {
  const link = unsubscribeUrl("plan-abc", "email", "https://app.test/");
  expect(link).toContain(unsubscribeToken("plan-abc", "email"));
  expect(link).not.toContain("//api");
});

// THE ROUTE

test("GET confirms without changing anything", async () => {
  // Mail clients and security scanners prefetch links. A GET that performed the
  // unsubscribe would silence candidates who never clicked.
  const { plan } = await setupUserWithPlan();
  const res = await GET(new Request(url(unsubscribeToken(plan.id, "email"))));

  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain("<form method=\"post\"");

  const after = await db.studyPlan.findUniqueOrThrow({ where: { id: plan.id } });
  expect(after.emailCoach).toBe("all");
});

test("POST turns the email channel off and leaves push alone", async () => {
  const { plan } = await setupUserWithPlan();
  const res = await POST(new Request(url(unsubscribeToken(plan.id, "email")), { method: "POST" }));

  expect(res.status).toBe(200);
  const after = await db.studyPlan.findUniqueOrThrow({ where: { id: plan.id } });
  expect(after.emailCoach).toBe("off");
  // The whole point of splitting the preference: leaving the inbox does not
  // silence the phone.
  expect(after.pushCoach).toBe("all");
});

test("POST turns the push channel off and leaves email alone", async () => {
  const { plan } = await setupUserWithPlan();
  await POST(new Request(url(unsubscribeToken(plan.id, "push")), { method: "POST" }));

  const after = await db.studyPlan.findUniqueOrThrow({ where: { id: plan.id } });
  expect(after.pushCoach).toBe("off");
  expect(after.emailCoach).toBe("all");
});

test("unsubscribing never touches the plan or the logged progress", async () => {
  // Somebody leaving the mailing list has not asked to lose their study plan,
  // and a candidate who found that out afterwards would be entitled to be
  // furious.
  const { plan } = await setupUserWithPlan();
  const before = await db.studyPlan.findUniqueOrThrow({ where: { id: plan.id } });

  await POST(new Request(url(unsubscribeToken(plan.id, "email")), { method: "POST" }));

  const after = await db.studyPlan.findUniqueOrThrow({ where: { id: plan.id } });
  expect(after.examDate).toEqual(before.examDate);
  expect(after.weeklyAvailability).toEqual(before.weeklyAvailability);
  expect(after.isActive).toBe(before.isActive);
  expect(await db.studyPlan.count({ where: { id: plan.id } })).toBe(1);
});

test("a second POST is harmless", async () => {
  // One-click unsubscribe can be delivered more than once, and a recipient may
  // simply click twice.
  const { plan } = await setupUserWithPlan();
  const token = unsubscribeToken(plan.id, "email");
  await POST(new Request(url(token), { method: "POST" }));
  const second = await POST(new Request(url(token), { method: "POST" }));

  expect(second.status).toBe(200);
  const after = await db.studyPlan.findUniqueOrThrow({ where: { id: plan.id } });
  expect(after.emailCoach).toBe("off");
});

test("a token for a plan that no longer exists still reports success", async () => {
  // They wanted the messages to stop, and they have. An error page here would
  // tell somebody trying to leave that leaving failed.
  const res = await POST(
    new Request(url(unsubscribeToken("plan-that-never-existed", "email")), { method: "POST" }),
  );
  expect(res.status).toBe(200);
  expect(await res.text()).toContain("Done");
});

test.each(["GET", "POST"])("%s rejects a tampered token with a 400 and no change", async (method) => {
  const { plan } = await setupUserWithPlan();
  const tampered = `${unsubscribeToken(plan.id, "email")}x`;
  const req = new Request(url(tampered), method === "POST" ? { method: "POST" } : undefined);
  const res = method === "POST" ? await POST(req) : await GET(req);

  expect(res.status).toBe(400);
  const after = await db.studyPlan.findUniqueOrThrow({ where: { id: plan.id } });
  expect(after.emailCoach).toBe("all");
});

test("the confirmation page is not indexable and needs no app session", async () => {
  // Opened from a mail client, often in an in-app browser with no session and
  // no access to the app bundle, so it must be self-contained.
  const { plan } = await setupUserWithPlan();
  const html = await (await GET(new Request(url(unsubscribeToken(plan.id, "email"))))).text();

  expect(html).toContain('name="robots" content="noindex"');
  expect(html).not.toContain("<script");
  expect(html).not.toMatch(/<link[^>]+stylesheet/);
});
