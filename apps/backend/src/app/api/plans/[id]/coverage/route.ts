import { db } from "../../../../../lib/db";
import { requireUser } from "../../../../../lib/FUNC-auth";

// Handlers are called directly in tests, so the id comes from the path.
function planIdFromUrl(req: Request): string {
  return new URL(req.url).pathname.split("/")[3]!; // /api/plans/<id>/coverage
}

const VIDEO_KINDS = new Set(["lecture", "eocq", "seminar", "review"]);

type VideoAgg = { count: number; watched: number; partial: number; seconds: number; watchedSeconds: number };
type QAgg = { total: number; answered: number; correct: number; numbered: number };
type VideoStatus = "watched" | "partial" | "not-started";

export type Coverage = {
  packages: Array<{
    packageId: string; name: string; slug: string | null; year: string;
    videos: VideoAgg; questions: QAgg;
    topics: Array<{
      topicId: string; name: string; order: number; videos: VideoAgg; questions: QAgg;
      units: Array<{
        unitId: string; ref: string; providerLabel: string | null; title: string; readingIds: string[]; readingNames: string[];
        videos: Array<{ resourceId: string; title: string; seconds: number; status: VideoStatus }>;
        questions: { total: number; answered: number; correct: number; numbered: number[]; unnumbered: number; left: number[] | null };
        los: Array<{ losId: string | null; label: string; text: string; questionCount: number | null; answered: number; correct: number }>;
      }>;
    }>;
  }>;
};

const emptyVideos = (): VideoAgg => ({ count: 0, watched: 0, partial: 0, seconds: 0, watchedSeconds: 0 });
const emptyQ = (): QAgg => ({ total: 0, answered: 0, correct: 0, numbered: 0 });

function addVideos(into: VideoAgg, v: VideoAgg) {
  into.count += v.count; into.watched += v.watched; into.partial += v.partial; into.seconds += v.seconds; into.watchedSeconds += v.watchedSeconds;
}
function addQ(into: QAgg, q: QAgg) {
  into.total += q.total; into.answered += q.answered; into.correct += q.correct; into.numbered += q.numbered;
}

export async function GET(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const planId = planIdFromUrl(req);
  const plan = await db.studyPlan.findUnique({ where: { id: planId } });
  if (!plan || plan.userId !== auth.userId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const planPackages = await db.planPackage.findMany({
    where: { planId },
    include: { package: true },
    orderBy: { id: "asc" },
  });
  const packageIds = planPackages.map((p) => p.packageId);
  if (packageIds.length === 0) return Response.json({ packages: [] } satisfies Coverage);

  // Four batched reads; everything below is in-memory joins.
  const [editions, tasks, declared] = await Promise.all([
    db.packageEdition.findMany({
      where: { packageId: { in: packageIds }, levelId: plan.levelId },
      orderBy: { year: "desc" },
      include: {
        units: {
          orderBy: { order: "asc" },
          include: {
            readings: { include: { reading: { include: { topic: true, los: { orderBy: { order: "asc" }, select: { id: true, text: true } } } } } },
            los: { include: { los: { select: { text: true } } } },
            resources: { orderBy: { ref: "asc" } },
          },
        },
      },
    }),
    db.planTask.findMany({
      where: { planId, status: { in: ["done", "partial"] } },
      select: {
        id: true, status: true, kind: true, packageId: true, estimatedMinutes: true, actualMinutes: true, workMinutes: true, readingIds: true, resourceIds: true, questionNumbers: true,
        logs: { select: { losId: true, questionsAnswered: true, questionsCorrect: true, los: { select: { readingId: true } } } },
      },
    }),
    db.studyLogEntry.findMany({
      where: { planId, selfDeclared: true, declaredWatched: true, packageId: { in: packageIds } },
      select: { packageId: true, los: { select: { readingId: true } } },
    }),
  ]);

  // Latest edition per package (editions arrive year-descending).
  const editionOf = new Map<string, (typeof editions)[number]>();
  for (const e of editions) if (!editionOf.has(e.packageId)) editionOf.set(e.packageId, e);

  const declaredReadings = new Map<string, Set<string>>();
  for (const d of declared) {
    if (!d.packageId) continue;
    const set = declaredReadings.get(d.packageId) ?? new Set<string>();
    set.add(d.los.readingId);
    declaredReadings.set(d.packageId, set);
  }

  const packages: Coverage["packages"] = [];
  for (const pp of planPackages) {
    const edition = editionOf.get(pp.packageId);
    if (!edition) continue;
    const declaredHere = declaredReadings.get(pp.packageId) ?? new Set<string>();

    // An off-plan session names its package and module but no resources, so it reaches the
    // package's units through its readings instead.
    const touches = (t: (typeof tasks)[number], unit: (typeof edition.units)[number]) => {
      const setIds = unit.resources.filter((r) => r.kind === "question_set").map((r) => r.id);
      if (t.resourceIds.some((id) => setIds.includes(id))) return true;
      return t.resourceIds.length === 0 && t.kind === "questions" && t.packageId === pp.packageId
        && setIds.length > 0 && unit.readings.some((r) => t.readingIds.includes(r.readingId));
    };
    // Numbers belong to one bank; a task spanning units cannot say which unit each number is in.
    const unitsTouched = new Map<string, number>();
    for (const t of tasks) unitsTouched.set(t.id, edition.units.filter((u) => touches(t, u)).length);

    const videoSecs = (t: (typeof tasks)[number], unit: (typeof edition.units)[number]) =>
      unit.resources.reduce((s, r) => s + (VIDEO_KINDS.has(r.kind) && t.resourceIds.includes(r.id) ? r.durationSeconds ?? 0 : 0), 0);

    const topics = new Map<string, Coverage["packages"][number]["topics"][number]>();
    for (const unit of edition.units) {
      // A unit spanning topics files under its first reading's topic.
      const readings = unit.readings
        .map((r) => r.reading)
        .sort((a, b) => a.topic.order - b.topic.order || a.order - b.order);
      if (readings.length === 0) continue;
      const readingIds = new Set(readings.map((r) => r.id));
      const topic = readings[0]!.topic;
      const selfDeclared = [...readingIds].some((id) => declaredHere.has(id));

      const videoRes = unit.resources.filter((r) => VIDEO_KINDS.has(r.kind) && (r.durationSeconds ?? 0) > 0);
      // A task's minutes are credited to the unit's videos in ref order. Read tasks list every
      // video of a module, so a task spanning units splits by each unit's share of listed video time.
      let creditSec = 0;
      for (const t of tasks) {
        const mine = videoSecs(t, unit);
        if (mine === 0) continue;
        const total = edition.units.reduce((s, u) => s + videoSecs(t, u), 0);
        const est = Math.max(1, t.estimatedMinutes);
        const spent = t.actualMinutes ?? (t.status === "done" ? t.estimatedMinutes : 0);
        const credited = Math.min(est, spent) * ((t.workMinutes ?? t.estimatedMinutes) / est);
        creditSec += credited * 60 * (mine / total);
      }
      let cum = 0;
      let partialSec = 0;
      const videos = videoRes.map((r) => {
        const sec = r.durationSeconds!;
        let status: VideoStatus = "not-started";
        if (selfDeclared || cum + sec <= creditSec + 1e-6) status = "watched";
        else if (creditSec > cum) { status = "partial"; partialSec += creditSec - cum; }
        cum += sec;
        return { resourceId: r.id, title: r.title ?? r.ref, seconds: sec, status };
      });
      const sets = unit.resources.filter((r) => r.kind === "question_set");
      const total = sets.reduce((s, r) => s + (r.questionCount ?? 0), 0);
      const numbered = new Set<number>();
      let unnumbered = 0;
      let correct = 0;
      const losAnswered = new Map<string, { answered: number; correct: number }>();
      for (const t of tasks) {
        if (!touches(t, unit)) continue;
        // Only the logs on this unit's readings, so a task spanning units is not counted twice over.
        const mine = t.logs.filter((l) => readingIds.has(l.los.readingId));
        if (t.questionNumbers.length > 0 && unitsTouched.get(t.id) === 1) t.questionNumbers.forEach((n) => numbered.add(n));
        // Numbers spread over several units count as answered without knowing which.
        else unnumbered += mine.reduce((s, l) => s + l.questionsAnswered, 0);
        for (const l of mine) {
          correct += l.questionsCorrect;
          const cur = losAnswered.get(l.losId) ?? { answered: 0, correct: 0 };
          cur.answered += l.questionsAnswered;
          cur.correct += l.questionsCorrect;
          losAnswered.set(l.losId, cur);
        }
      }
      const numberedList = [...numbered].filter((n) => total === 0 || n <= total).sort((a, b) => a - b);
      const answered = Math.min(total, numberedList.length + unnumbered);
      let left: number[] | null = null;
      if (unnumbered === 0) {
        left = [];
        for (let n = 1; n <= total; n++) if (!numbered.has(n)) left.push(n);
      }

      const vAgg = emptyVideos();
      for (const v of videos) {
        vAgg.count += 1; vAgg.seconds += v.seconds;
        if (v.status === "watched") { vAgg.watched += 1; vAgg.watchedSeconds += v.seconds; }
        else if (v.status === "partial") vAgg.partial += 1;
      }
      vAgg.watchedSeconds += Math.round(partialSec);
      const qAgg: QAgg = { total, answered, correct: Math.min(correct, answered), numbered: numberedList.length };

      let entry = topics.get(topic.id);
      if (!entry) {
        entry = { topicId: topic.id, name: topic.name, order: topic.order, videos: emptyVideos(), questions: emptyQ(), units: [] };
        topics.set(topic.id, entry);
      }
      addVideos(entry.videos, vAgg);
      addQ(entry.questions, qAgg);
      entry.units.push({
        unitId: unit.id,
        ref: unit.ref,
        providerLabel: unit.providerLabel,
        title: unit.title ?? unit.providerLabel ?? unit.ref,
        readingIds: readings.map((r) => r.id),
        readingNames: readings.map((r) => r.name),
        videos,
        questions: { total, answered, correct: qAgg.correct, numbered: numberedList, unnumbered, left },
        los: unit.los.filter((l) => !l.retired).length > 0
          ? unit.los
            .filter((l) => !l.retired)
            .map((l) => {
              const got = l.losId ? losAnswered.get(l.losId) : undefined;
              return {
                losId: l.losId,
                label: l.sourceLabel,
                text: l.los?.text ?? "",
                questionCount: l.questionCount,
                answered: got?.answered ?? 0,
                correct: got?.correct ?? 0,
              };
            })
          // No package mapping: fall back to the curriculum outcomes of the unit's readings.
          : readings.flatMap((r) => r.los.map((l, i) => {
            const got = losAnswered.get(l.id);
            return {
              losId: l.id,
              label: readings.length > 1 ? `${r.name} LOS ${i + 1}` : `LOS ${i + 1}`,
              text: l.text,
              questionCount: null,
              answered: got?.answered ?? 0,
              correct: got?.correct ?? 0,
            };
          })),
      });
    }

    const topicList = [...topics.values()].sort((a, b) => a.order - b.order);
    const videos = emptyVideos();
    const questions = emptyQ();
    for (const t of topicList) { addVideos(videos, t.videos); addQ(questions, t.questions); }
    packages.push({
      packageId: pp.packageId, name: pp.package.name, slug: pp.package.slug, year: edition.year,
      videos, questions, topics: topicList,
    });
  }

  return Response.json({ packages } satisfies Coverage);
}
