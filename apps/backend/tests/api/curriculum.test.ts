import { describe, test, expect, beforeEach } from "vitest";
import { db } from "../../src/lib/db";
import { resetDb } from "../helpers/test-db";
import { jsonRequest, readJson } from "../helpers/request";
import { registerUser, seedLevel } from "../helpers/fixtures";
import { GET as CURRICULUM } from "../../src/app/api/curriculum/route";
import { GET as LEVELS } from "../../src/app/api/curriculum/levels/route";

function authed(token: string, url: string): Request {
  return jsonRequest("GET", url, undefined, { Authorization: `Bearer ${token}` });
}

beforeEach(async () => {
  await resetDb();
});

describe("GET /api/curriculum", () => {
  test("requires a token", async () => {
    const res = await CURRICULUM(jsonRequest("GET", "/api/curriculum?levelId=I"));
    expect(res.status).toBe(401);
  });

  test("requires a levelId", async () => {
    const user = await registerUser();
    const res = await CURRICULUM(authed(user.token, "/api/curriculum"));
    expect(res.status).toBe(400);
  });

  test("404s for a level that is not seeded", async () => {
    const user = await registerUser();
    const res = await CURRICULUM(authed(user.token, "/api/curriculum?levelId=III"));
    expect(res.status).toBe(404);
  });

  test("returns the tree in curriculum order with exam weights and a version", async () => {
    const user = await registerUser();
    await seedLevel("I");
    const res = await CURRICULUM(authed(user.token, "/api/curriculum?levelId=I"));
    expect(res.status).toBe(200);
    const body = await readJson(res);

    expect(body.levelId).toBe("I");
    expect(typeof body.curriculumVersion).toBe("string");
    expect(Array.isArray(body.topics)).toBe(true);

    const topic = body.topics[0];
    expect(topic).toMatchObject({
      name: expect.any(String),
      examWeightMin: expect.any(Number),
      examWeightMax: expect.any(Number),
    });
    expect(topic.readings[0].los[0]).toMatchObject({
      id: expect.any(String),
      text: expect.any(String),
    });
  });

  test("orders topics, readings and outcomes by their curriculum order, not by id", async () => {
    const user = await registerUser();
    await seedLevel("I");
    const body = await readJson(await CURRICULUM(authed(user.token, "/api/curriculum?levelId=I")));

    const topicOrders = body.topics.map((t: { order: number }) => t.order);
    expect(topicOrders).toEqual([...topicOrders].sort((a: number, b: number) => a - b));

    for (const t of body.topics) {
      const readingOrders = t.readings.map((r: { order: number }) => r.order);
      expect(readingOrders).toEqual([...readingOrders].sort((a: number, b: number) => a - b));
      for (const r of t.readings) {
        const losOrders = r.los.map((l: { order: number }) => l.order);
        expect(losOrders).toEqual([...losOrders].sort((a: number, b: number) => a - b));
      }
    }
  });

  test("sends a strong ETag and answers a matching If-None-Match with 304 and no body", async () => {
    const user = await registerUser();
    await seedLevel("I");
    const first = await CURRICULUM(authed(user.token, "/api/curriculum?levelId=I"));
    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();
    expect(first.headers.get("cache-control")).toContain("max-age");

    const second = await CURRICULUM(
      jsonRequest("GET", "/api/curriculum?levelId=I", undefined, {
        Authorization: `Bearer ${user.token}`,
        "If-None-Match": etag as string,
      }),
    );
    expect(second.status).toBe(304);
    expect(await second.text()).toBe("");
  });

  test("changes its ETag when the curriculum version changes, so a cached client refetches", async () => {
    const user = await registerUser();
    await seedLevel("I");
    const before = (await CURRICULUM(authed(user.token, "/api/curriculum?levelId=I"))).headers.get("etag");

    await db.level.update({ where: { id: "I" }, data: { version: "2027-curriculum" } });

    const after = (await CURRICULUM(authed(user.token, "/api/curriculum?levelId=I"))).headers.get("etag");
    expect(after).not.toBe(before);
  });

  test("caches privately, never in a shared cache, since it is behind a user token", async () => {
    const user = await registerUser();
    await seedLevel("I");
    const res = await CURRICULUM(authed(user.token, "/api/curriculum?levelId=I"));
    expect(res.headers.get("cache-control")).toContain("private");
  });
});

describe("GET /api/curriculum/levels", () => {
  test("requires a token", async () => {
    const res = await LEVELS(jsonRequest("GET", "/api/curriculum/levels"));
    expect(res.status).toBe(401);
  });

  test("summarises each seeded level without shipping the outcome text", async () => {
    const user = await registerUser();
    await seedLevel("I");
    const res = await LEVELS(authed(user.token, "/api/curriculum/levels"));
    expect(res.status).toBe(200);
    const body = await readJson(res);

    const level = body.levels.find((l: { id: string }) => l.id === "I");
    expect(level).toMatchObject({
      id: "I",
      topicCount: expect.any(Number),
      losCount: expect.any(Number),
      curriculumVersion: expect.any(String),
    });
    expect(level.topicCount).toBeGreaterThan(0);
    expect(level.losCount).toBeGreaterThan(0);

    // The whole reason this endpoint exists: the level chooser must not pull
    // the full tree for three levels before the user has picked one.
    expect(JSON.stringify(body)).not.toContain("Describe");
    expect(level.topics[0]).toMatchObject({
      name: expect.any(String),
      examWeightMin: expect.any(Number),
      examWeightMax: expect.any(Number),
    });
    expect(level.topics[0].los).toBeUndefined();
  });

  test("reports a level with no topics as unavailable rather than hiding it", async () => {
    const user = await registerUser();
    await seedLevel("I");
    await db.level.create({ data: { id: "III" } });

    const body = await readJson(await LEVELS(authed(user.token, "/api/curriculum/levels")));
    const three = body.levels.find((l: { id: string }) => l.id === "III");
    expect(three).toMatchObject({ id: "III", topicCount: 0, losCount: 0, available: false });

    const one = body.levels.find((l: { id: string }) => l.id === "I");
    expect(one.available).toBe(true);
  });
});
