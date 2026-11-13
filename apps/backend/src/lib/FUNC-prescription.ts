// Turns a day's PlanTask rows into instructions a candidate can actually act
// on: which module, which video, which pages, how many questions, from which
// package, and a link that opens the thing.
//
// The task rows say "content-video, 56 minutes, reading X". That is a budget,
// not an instruction. A candidate cannot watch a reading id, and the Learning
// Outcome Statement the Today screen used to print instead ("evaluate how well
// a multiple regression model explains the dependent variable...") is a thing
// the exam asks of them, not a thing they can sit down and do. The provider
// catalogue already knows the actual material; nothing was joining the two.
//
// Resolved on READ rather than frozen into PlanTask.resourceId, because the
// packer has never set that column and the rows are frozen history: changing
// what a past task meant is not something a catalogue refresh should be able
// to do.
import { db } from "./db";
import { creditedMinutes } from "../core/task-credit";

/** A single thing to do, named the way the provider names it. */
export type PrescribedMaterial = {
  /** "Watch", "Read", "Questions" - the verb, so the UI never invents one. */
  action: string;
  /** What to open, e.g. "QM LM2 lecture" or "pages 6 to 10 of the notes". */
  label: string;
  /** Which provider it belongs to, named as the candidate chose it. */
  packageName: string;
  /** Opens the material, or null when the catalogue has no link for it. */
  url: string | null;
  /** Questions to attempt, when this is practice rather than content. */
  questionCount: number | null;
};

export type PrescribedTask = {
  id: string;
  order: number;
  kind: string;
  status: string;
  estimatedMinutes: number;
  /** Minutes the candidate reported, null until submitted. */
  actualMinutes: number | null;
  /** Confidence the task was recorded with, null until recorded. */
  confidence: number | null;
  /** Modules (readings) the task covers, so a record can be matched to it. */
  readingIds: string[];
  topicName: string | null;
  moduleTitle: string | null;
  materials: PrescribedMaterial[];
};

export type PrescribedDay = {
  date: string;
  /** Minutes the plan asks for on this day. */
  totalMinutes: number;
  /** Minutes of that which are settled: whole estimates for finished tasks, worked minutes for partials. */
  doneMinutes: number;
  doneTasks: number;
  totalTasks: number;
  /**
   * Outcomes logged on this day that no task scheduled for it covers.
   *
   * Counted, not timed: a log entry records an outcome, a confidence and a
   * question tally, and never a duration, so there are no minutes to report
   * here and inventing some would be worse than saying nothing.
   */
  offPlanLogs: number;
  tasks: PrescribedTask[];
};

/**
 * Google Drive is where both catalogued providers keep their files, and the
 * inventory records the file id rather than a URL. A file id is enough to
 * build the canonical viewer link, so a missing sourceUrl does not have to
 * mean a candidate is told to watch something they cannot open.
 */
function driveUrl(externalId: string | null, sourceUrl: string | null): string | null {
  if (sourceUrl) return sourceUrl;
  if (!externalId) return null;
  return `https://drive.google.com/file/d/${externalId}/view`;
}

/**
 * Which provider resource kinds satisfy which task kind.
 *
 * "content-notes" is absent on purpose: the providers ship one notes PDF per
 * topic rather than a per-module resource, so notes are described by the
 * unit's own page range instead of by a resource row.
 */
const RESOURCE_KINDS: Record<string, string[]> = {
  "content-video": ["lecture"],
  eocq: ["eocq"],
  seminar: ["seminar"],
  review: ["review"],
  questions: ["question_set"],
  "answer-review": ["answer_set"],
};

/** Whether a task wants the package the candidate tagged for questions. */
function roleFor(taskKind: string): "questions" | "content" {
  return taskKind === "questions" || taskKind === "answer-review" ? "questions" : "content";
}

/**
 * A human label for a provider unit reference.
 *
 * Refs look like "qm/lm2" or "uworld/quant/r1". The provider's own shorthand
 * is what the candidate sees in their folder listing, so it is what the
 * instruction should say: searching a Drive folder for "LM 2" finds the file,
 * searching it for a reading id finds nothing.
 */
function refLabel(ref: string): string {
  const tail = ref.split("/").filter(Boolean).slice(-2);
  return tail
    .map((part) => {
      const lm = /^lm(\d+)$/i.exec(part);
      if (lm) return `LM ${lm[1]}`;
      const r = /^r(\d+)$/i.exec(part);
      if (r) return `Reading ${r[1]}`;
      return part.toUpperCase();
    })
    .join(" ");
}

/**
 * The curriculum's own learning platform, which every registered candidate
 * has. It is the fallback whenever the provider packages do not cover a
 * module in the form the plan asked for.
 */
const CFA_STUDY_TOOLS = "https://cfaprogram.cfainstitute.org/studytools";

const ACTIONS: Record<string, string> = {
  "content-notes": "Read",
  "content-video": "Watch",
  eocq: "Watch",
  seminar: "Watch",
  review: "Watch",
  questions: "Questions",
  "answer-review": "Review answers",
  mock: "Sit",
  "mock-review": "Review",
};

/**
 * The prescription for one plan over a date range, inclusive.
 *
 * Returns a day per date asked for, including days with nothing on them, so
 * the caller can render a week without inventing the gaps.
 */
export async function getPrescription(
  planId: string,
  fromISO: string,
  toISO: string,
): Promise<PrescribedDay[]> {
  const from = new Date(`${fromISO}T00:00:00Z`);
  const to = new Date(`${toISO}T00:00:00Z`);

  const tasks = await db.planTask.findMany({
    where: { planId, date: { gte: from, lte: to } },
    orderBy: [{ date: "asc" }, { order: "asc" }],
  });

  // A record writes one row per outcome, all with the same confidence.
  const recorded = await db.studyLogEntry.findMany({
    where: { taskId: { in: tasks.map((t) => t.id) } },
    select: { taskId: true, confidence: true },
    distinct: ["taskId"],
  });
  const confidenceByTask = new Map(recorded.map((r) => [r.taskId!, r.confidence]));

  // Which package plays which role for THIS candidate. A plan that tagged
  // UWorld for questions and Mark Meldrum for content must never be told to
  // watch a UWorld lecture that does not exist.
  const planPackages = await db.planPackage.findMany({
    where: { planId },
    include: { package: true },
  });
  const packageIdsByRole = new Map<string, Set<string>>();
  for (const pp of planPackages) {
    for (const role of pp.roles) {
      if (!packageIdsByRole.has(role)) packageIdsByRole.set(role, new Set());
      packageIdsByRole.get(role)!.add(pp.packageId);
    }
  }

  const readingIds = [...new Set(tasks.flatMap((t) => t.readingIds))];
  const readings = await db.reading.findMany({
    where: { id: { in: readingIds } },
    include: { topic: true },
  });
  const readingById = new Map(readings.map((r) => [r.id, r]));

  // Every unit covering any reading in the window, with its resources, in one
  // query rather than one per task.
  const unitReadings = await db.packageUnitReading.findMany({
    where: { readingId: { in: readingIds } },
    include: {
      unit: {
        include: {
          resources: true,
          edition: { include: { package: true } },
        },
      },
    },
  });

  const unitsByReading = new Map<string, typeof unitReadings>();
  for (const ur of unitReadings) {
    const list = unitsByReading.get(ur.readingId) ?? [];
    list.push(ur);
    unitsByReading.set(ur.readingId, list);
  }

  const byDate = new Map<string, PrescribedTask[]>();

  for (const task of tasks) {
    const dateStr = task.date.toISOString().slice(0, 10);
    const reading = task.readingIds.map((id) => readingById.get(id)).find(Boolean);
    const wantedRole = roleFor(task.kind);
    const allowedPackages = packageIdsByRole.get(wantedRole) ?? new Set<string>();

    const candidateUnits = task.readingIds
      .flatMap((id) => unitsByReading.get(id) ?? [])
      // A plan with no package tagged for this role still gets the material,
      // because a candidate who skipped the tagging step is better served by
      // "watch this" than by a blank row.
      .filter((ur) =>
        allowedPackages.size === 0 ? true : allowedPackages.has(ur.unit.edition.packageId),
      );

    const materials: PrescribedMaterial[] = [];
    const action = ACTIONS[task.kind] ?? "Study";

    if (task.kind === "content-notes") {
      for (const ur of candidateUnits) {
        const start = ur.unit.notesPageStart;
        const count = ur.unit.notesPageCount;
        if (start === null || count === null) continue;
        materials.push({
          action,
          label: `${refLabel(ur.unit.ref)} notes, pages ${start} to ${start + count - 1}`,
          packageName: ur.unit.edition.package.name,
          url: null,
          questionCount: null,
        });
      }
    } else {
      const wantedKinds = RESOURCE_KINDS[task.kind] ?? [];
      for (const ur of candidateUnits) {
        for (const resource of ur.unit.resources) {
          if (!wantedKinds.includes(resource.kind)) continue;
          // A question set is usually split across several days, so the
          // label has to say WHICH part. Without it two consecutive days
          // both read "8 questions from the UWorld set" and the candidate
          // cannot tell whether they have already done them.
          const slice =
            task.vignetteFrom !== null && task.vignetteTo !== null
              ? task.vignetteFrom === task.vignetteTo
                ? `, vignette ${task.vignetteFrom + 1}`
                : `, vignettes ${task.vignetteFrom + 1} to ${task.vignetteTo + 1}`
              : "";
          const base = resource.title
            ? `${refLabel(ur.unit.ref)}, ${resource.title}`
            : `${refLabel(ur.unit.ref)} ${resource.kind.replace("_", " ")}`;
          materials.push({
            action,
            label: `${base}${slice}`,
            packageName: ur.unit.edition.package.name,
            url: driveUrl(resource.externalId, resource.sourceUrl),
            // The task's own target wins when the packer set one: it is a
            // slice of the set sized to the day, not the whole set.
            questionCount: task.questionTarget ?? resource.questionCount,
          });
        }
      }
    }

    // Fall back to the curriculum's own material rather than reporting a
    // dead end.
    //
    // The planner budgets time per kind from a topic's overall shape, so it
    // can set aside twenty minutes for an end-of-chapter walkthrough on a
    // module where the candidate's package ships none. Every candidate has
    // CFA Institute's own study tools by virtue of being registered, so that
    // gap has an answer: send them there instead of telling them their
    // packages have failed them.
    if (materials.length === 0) {
      materials.push({
        // "Use", not the task's own verb: nobody watches a study-tools site,
        // and the task kind only says what the plan budgeted for, not what
        // the fallback actually is.
        action: "Use",
        label: "CFA Institute study tools",
        packageName: "Included with your exam registration",
        url: CFA_STUDY_TOOLS,
        questionCount: null,
      });
    }

    const entry: PrescribedTask = {
      id: task.id,
      order: task.order,
      kind: task.kind,
      status: task.status,
      estimatedMinutes: task.estimatedMinutes,
      actualMinutes: task.actualMinutes,
      confidence: confidenceByTask.get(task.id) ?? null,
      readingIds: task.readingIds,
      topicName: reading?.topic.name ?? null,
      moduleTitle: reading?.name ?? null,
      materials,
    };

    const list = byDate.get(dateStr) ?? [];
    list.push(entry);
    byDate.set(dateStr, list);
  }

  // What was actually logged in the window, so a day can say how much of its
  // plan is behind the candidate and how much they did off it.
  const logs = await db.studyLogEntry.findMany({
    where: { planId, date: { gte: from, lt: new Date(to.getTime() + 86_400_000) } },
    select: { date: true, losId: true },
  });
  const loggedLos = [...new Set(logs.map((l) => l.losId))];
  const losReading = await db.lOS.findMany({
    where: { id: { in: loggedLos } },
    select: { id: true, readingId: true },
  });
  const readingOfLos = new Map(losReading.map((l) => [l.id, l.readingId]));

  // Which readings each day's plan covers. A log counts as on-plan when its
  // outcome belongs to a reading that day was scheduled to study; anything
  // else is work the candidate chose for themselves, which is worth showing
  // rather than quietly folding into the same number.
  const plannedReadingsByDate = new Map<string, Set<string>>();
  for (const task of tasks) {
    const dateStr = task.date.toISOString().slice(0, 10);
    const set = plannedReadingsByDate.get(dateStr) ?? new Set<string>();
    for (const id of task.readingIds) set.add(id);
    plannedReadingsByDate.set(dateStr, set);
  }

  const offPlanByDate = new Map<string, number>();
  for (const log of logs) {
    const dateStr = log.date.toISOString().slice(0, 10);
    const planned = plannedReadingsByDate.get(dateStr);
    const reading = readingOfLos.get(log.losId);
    if (!planned || !reading || !planned.has(reading)) {
      offPlanByDate.set(dateStr, (offPlanByDate.get(dateStr) ?? 0) + 1);
    }
  }

  const isDone = (status: string) => status === "done" || status === "completed";

  const days: PrescribedDay[] = [];
  for (let d = new Date(from); d <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    const dateStr = d.toISOString().slice(0, 10);
    const dayTasks = byDate.get(dateStr) ?? [];
    const done = dayTasks.filter((t) => isDone(t.status));
    days.push({
      date: dateStr,
      totalMinutes: dayTasks.reduce((sum, t) => sum + t.estimatedMinutes, 0),
      doneMinutes: dayTasks.reduce(
        (sum, t) => sum + creditedMinutes({ ...t, status: isDone(t.status) ? "done" : t.status }),
        0,
      ),
      doneTasks: done.length,
      totalTasks: dayTasks.length,
      offPlanLogs: offPlanByDate.get(dateStr) ?? 0,
      tasks: dayTasks,
    });
  }
  return days;
}
