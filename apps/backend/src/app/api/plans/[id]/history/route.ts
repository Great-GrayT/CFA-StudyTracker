// Everything a candidate did on one topic, per module and per engine step, newest first.
import { db } from "../../../../../lib/db";
import { requireUser } from "../../../../../lib/FUNC-auth";
import { todayIn } from "../../../../../lib/FUNC-today";
import { generateHorizon } from "../../../../../lib/FUNC-schedule";
import { resolveMaterials } from "../../../../../lib/FUNC-prescription";
import { adequateQuestions, owedExtraQuestions, stepOf } from "../../../../../lib/FUNC-projection";
import { plannedMinutes } from "../../../../../core/steps/metrics";
import { adequateMinutes } from "../../../../../core/steps/catalog";
import { OFF_PLAN } from "../../../../../core/task-credit";

function planIdFromUrl(req: Request): string {
  return new URL(req.url).pathname.split("/")[3]!; // /api/plans/<id>/history
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
type Step = 1 | 2 | 3 | 4;
const STEPS: Step[] = [1, 2, 3, 4];

export async function GET(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const planId = planIdFromUrl(req);
  const plan = await db.studyPlan.findUnique({ where: { id: planId } });
  if (!plan || plan.userId !== auth.userId) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const topicId = new URL(req.url).searchParams.get("topicId");
  if (!topicId) return Response.json({ error: "topicId query parameter is required" }, { status: 400 });

  // The dry run holds the engine's own state and catalog, so the numbers match Today and Pace.
  const hz = await generateHorizon(planId, todayIn(plan.timeZone), { dryRun: true });
  const mods = hz.catalog.filter((m) => m.topicId === topicId).sort((a, b) => a.readingOrder - b.readingOrder);
  if (mods.length === 0) return Response.json({ error: "Not found" }, { status: 404 });
  const readingIds = mods.map((m) => m.readingId);

  const [readings, tasks, decls, mockRows] = await Promise.all([
    db.reading.findMany({ where: { id: { in: readingIds } }, select: { id: true, name: true } }),
    db.planTask.findMany({
      where: { planId, status: { in: ["done", "partial"] }, readingIds: { hasSome: readingIds } },
      orderBy: [{ date: "desc" }, { order: "desc" }],
      include: { logs: { select: { date: true, confidence: true, questionsAnswered: true, questionsCorrect: true, note: true, los: { select: { readingId: true } } } } },
    }),
    db.stepDeclaration.findMany({ where: { planId, readingId: { in: readingIds } } }),
    db.mockExam.findMany({
      where: { planId, topicScores: { some: { topicId } } },
      include: { topicScores: { where: { topicId } } },
      orderBy: [{ date: "desc" }, { updatedAt: "desc" }],
    }),
  ]);
  const nameOf = new Map(readings.map((r) => [r.id, r.name]));
  const { materialsByTask } = await resolveMaterials(planId, tasks);

  const packageIds = [...new Set([
    ...tasks.map((t) => t.packageId), ...mockRows.map((m) => m.packageId),
  ].filter((x): x is string => !!x))];
  const packages = await db.studyPackage.findMany({ where: { id: { in: packageIds } }, select: { id: true, name: true } });
  const packageName = new Map(packages.map((p) => [p.id, p.name]));

  const owedQ = owedExtraQuestions(hz);

  const mocks = mockRows.map((m) => {
    const s = m.topicScores[0]!;
    return {
      id: m.id, date: iso(m.date),
      // The schema keeps no creation time; updatedAt is the nearest stamp.
      createdAt: m.updatedAt.toISOString(),
      sessionRef: m.sessionRef, packageName: m.packageId ? (packageName.get(m.packageId) ?? null) : null,
      scorePercent: s.answered > 0 ? Math.round((s.correct / s.answered) * 100) : 0,
      answered: s.answered, correct: s.correct,
    };
  });

  const modules = mods.map((m) => {
    const st = hz.state.get(m.readingId)!;
    const mine = tasks.filter((t) => t.readingIds.includes(m.readingId));
    const steps = STEPS.map((step) => {
      const taskRecs = mine.filter((t) => stepOf(t) === step).map((t) => {
        const logs = t.logs.filter((l) => l.los.readingId === m.readingId);
        const latest = t.logs.reduce<Date | null>((a, l) => (!a || l.date > a ? l.date : a), null);
        const recordedAt = (latest ?? t.updatedAt).toISOString();
        return {
          day: iso(t.date), sort: Date.parse(recordedAt),
          rec: {
            type: "task" as const, id: t.id, date: iso(t.date), recordedAt, kind: t.kind, step: t.step, round: t.round,
            status: t.status as "done" | "partial",
            offPlan: t.insertedBecause === OFF_PLAN, extraReason: t.extraReason,
            packageId: t.packageId, packageName: t.packageId ? (packageName.get(t.packageId) ?? null) : null,
            materials: (materialsByTask.get(t.id) ?? []).map((x) => ({ label: x.label, url: x.url })),
            estimatedMinutes: t.estimatedMinutes, actualMinutes: t.actualMinutes,
            answerReviewDone: t.answerReviewDone, answerReviewMinutes: t.answerReviewMinutes,
            answered: logs.reduce((a, l) => a + l.questionsAnswered, 0),
            correct: logs.reduce((a, l) => a + l.questionsCorrect, 0),
            confidence: t.logs[0]?.confidence ?? null,
            note: t.logs.find((l) => l.note)?.note ?? null,
          },
        };
      });
      const declRecs = decls.filter((d) => d.readingId === m.readingId && d.step === step).map((d) => ({
        day: iso(d.date), sort: d.updatedAt.getTime(),
        rec: {
          type: "declaration" as const, step, date: iso(d.date), createdAt: d.createdAt.toISOString(), updatedAt: d.updatedAt.toISOString(),
          confidence: d.confidence, answered: d.answered, correct: d.correct,
        },
      }));
      const records = [...taskRecs, ...declRecs].sort((a, b) => b.day.localeCompare(a.day) || b.sort - a.sort).map((x) => x.rec);

      const doneMin = Math.round(step === 1 ? st.s1.doneMin : step === 3 ? st.s3.doneMin : step === 2 ? st.s2.minutes : st.s4.minutes);
      const passed = step === 1 ? st.s1.done : step === 3 ? st.s3.done : step === 2 ? st.s2.passed : st.s4.passed;
      const r = step === 2 ? st.s2 : step === 4 ? st.s4 : null;
      const targetMin = Math.round(plannedMinutes(m, step));
      const status = passed ? "done" as const
        : doneMin > 0 || (r?.answered ?? 0) > 0 || records.length > 0 ? "in-progress" as const : "not-started" as const;
      const questions = r ? (() => {
        const { adequateQ } = adequateQuestions(m, step as 2 | 4);
        return {
          n: r.answered, m: adequateQ, q: owedQ.get(`${m.readingId}|${step}|${r.round}`) ?? 0,
          answered: r.answered, correct: r.correct, adequateMin: Math.round(adequateMinutes(m, step as 2 | 4)),
          minutes: Math.round(r.minutes), passed: r.passed,
        };
      })() : null;
      return { step, status, round: r ? r.round : null, doneMin, targetMin, questions, records };
    });
    return { readingId: m.readingId, name: nameOf.get(m.readingId) ?? m.readingId, order: m.readingOrder, steps };
  });

  return Response.json({ topicId, mocks, modules });
}
