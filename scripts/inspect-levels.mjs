// Read-only diagnostic: what the curriculum actually holds, per level.
// Run inside the app container, where DATABASE_URL is already set.
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const levels = await db.level.findMany({ orderBy: { id: "asc" } });
console.log("levels:", levels.map((l) => `${l.id}(version=${l.version ?? "null"})`).join(" "));

for (const level of levels) {
  const topics = await db.topic.count({ where: { levelId: level.id } });
  const readings = await db.reading.count({ where: { topic: { levelId: level.id } } });
  const los = await db.lOS.count({ where: { reading: { topic: { levelId: level.id } } } });
  const editions = await db.packageEdition.count({ where: { levelId: level.id } });
  console.log(
    `  level ${level.id}: topics=${topics} readings=${readings} los=${los} editions=${editions}`,
  );
}

const pkgs = await db.studyPackage.findMany({ select: { slug: true, name: true } });
console.log("packages:", pkgs.map((p) => p.slug).join(" ") || "(none)");

await db.$disconnect();
