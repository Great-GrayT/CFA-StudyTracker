import { db } from "../../../../lib/db";
import { requireUser } from "../../../../lib/FUNC-auth";

const HEADER = ["date", "losId", "confidence", "questionsAnswered", "packageId", "note"];

// Quotes a field only when it needs it (contains a comma, quote, or
// newline), doubling any embedded quotes - standard RFC 4180 escaping.
function csvField(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export async function GET(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const logs = await db.studyLogEntry.findMany({
    where: { userId: auth.userId },
    orderBy: { date: "asc" },
  });

  const rows = logs.map((log) =>
    [
      log.date.toISOString(),
      log.losId,
      String(log.confidence),
      String(log.questionsAnswered),
      log.packageId ?? "",
      log.note ?? "",
    ]
      .map(csvField)
      .join(","),
  );

  const csv = [HEADER.join(","), ...rows].join("\n");

  return new Response(csv, {
    status: 200,
    headers: { "Content-Type": "text/csv; charset=utf-8" },
  });
}
