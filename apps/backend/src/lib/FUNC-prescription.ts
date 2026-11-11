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
  topicName: string | null;
  moduleTitle: string | null;
  materials: PrescribedMaterial[];
};

export type PrescribedDay = {
  date: string;
  totalMinutes: number;
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
};

/** Whether a task wants the package the candidate tagged for questions. */
function roleFor(taskKind: string): "questions" | "content" {
  return taskKind === "questions" ? "questions" : "content";
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

const ACTIONS: Record<string, string> = {
  "content-notes": "Read",
  "content-video": "Watch",
  eocq: "Watch",
  seminar: "Watch",
  review: "Watch",
  questions: "Questions",
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

    // Say so rather than render an empty row. The planner budgets time per
    // kind from a topic's overall shape, so it can set aside twenty minutes
    // for an end-of-chapter walkthrough on a module where the candidate's
    // package ships none. Silence there reads as a bug; naming it lets them
    // spend the time on something else.
    if (materials.length === 0) {
      materials.push({
        // No verb: there is nothing to do, and "Watch nothing in your
        // packages covers this" reads as a broken sentence.
        action: "",
        label: "Nothing in your packages covers this module in that form.",
        packageName: "",
        url: null,
        questionCount: null,
      });
    }

    const entry: PrescribedTask = {
      id: task.id,
      order: task.order,
      kind: task.kind,
      status: task.status,
      estimatedMinutes: task.estimatedMinutes,
      topicName: reading?.topic.name ?? null,
      moduleTitle: reading?.name ?? null,
      materials,
    };

    const list = byDate.get(dateStr) ?? [];
    list.push(entry);
    byDate.set(dateStr, list);
  }

  const days: PrescribedDay[] = [];
  for (let d = new Date(from); d <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    const dateStr = d.toISOString().slice(0, 10);
    const dayTasks = byDate.get(dateStr) ?? [];
    days.push({
      date: dateStr,
      totalMinutes: dayTasks.reduce((sum, t) => sum + t.estimatedMinutes, 0),
      tasks: dayTasks,
    });
  }
  return days;
}
