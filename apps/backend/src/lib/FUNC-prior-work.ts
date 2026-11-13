// Prior work by material: which sources a candidate can name, and how a
// submitted form becomes declared log rows.
//
// Sources come from what each package actually provides, never from a list of
// names, so a package added to the catalogue (Kaplan videos, a new Qbank)
// appears in the right column with no code change.
import { db } from "./db";
import { UNATTRIBUTED, type PriorWorkDeclaration } from "./validation";

export type SourceKind = "notes" | "videos" | "questions";
export type Source = { id: string; name: string };
export type Sources = Record<SourceKind, Source[]>;

/**
 * The official curriculum, declarable before it is in the catalogue. Its
 * readings are the material the notes condense and its practice problems are
 * questions, so it counts for both. Once seeded under this slug with real
 * resources, the capability queries find it and this stand-in is not needed.
 */
export const CFAI = { id: "cfai-curriculum", slug: "cfai-curriculum", name: "CFA Institute curriculum" };
const CFAI_PROVIDES: SourceKind[] = ["notes", "questions"];

export async function ensureCfaiPackage(): Promise<void> {
  await db.studyPackage.upsert({
    where: { slug: CFAI.slug },
    create: { id: CFAI.id, slug: CFAI.slug, name: CFAI.name, userId: null },
    update: {},
  });
}

export async function priorWorkSources(levelId: string, userId: string): Promise<Sources> {
  const visible = { OR: [{ userId: null }, { userId }] };
  const withUnits = (unitFilter: object) =>
    db.studyPackage.findMany({
      where: { ...visible, editions: { some: { levelId, units: { some: unitFilter } } } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });

  const [notes, videos, questions] = await Promise.all([
    withUnits({ notesPageCount: { not: null } }),
    withUnits({ resources: { some: { kind: "lecture" } } }),
    withUnits({ resources: { some: { kind: "question_set" } } }),
  ]);
  const sources: Sources = { notes, videos, questions };
  for (const kind of CFAI_PROVIDES) {
    if (!sources[kind].some((s) => s.id === CFAI.id)) sources[kind].push({ id: CFAI.id, name: CFAI.name });
  }
  return sources;
}

/** First source id in the form that is not offered for its column, if any. */
export function unknownSource(declarations: PriorWorkDeclaration[], sources: Sources): string | null {
  const allowed = (kind: SourceKind, id: string | null) =>
    id === null || id === UNATTRIBUTED || sources[kind].some((s) => s.id === id);
  for (const d of declarations) {
    if (!allowed("notes", d.notesFrom)) return d.notesFrom;
    if (!allowed("videos", d.videosFrom)) return d.videosFrom;
    if (d.questions && !allowed("questions", d.questions.from)) return d.questions.from;
  }
  return null;
}

export type DeclaredRow = {
  losId: string;
  packageId: string | null;
  confidence: number;
  questionsAnswered: number;
  questionsCorrect: number;
  declaredRead: boolean;
  declaredWatched: boolean;
};

type TopicShape = { id: string; readings: Array<{ id: string; los: Array<{ id: string }> }> };

/**
 * Rows for a whole form. A module row replaces its topic row for that module,
 * including a module row that declares nothing ("not this one").
 *
 * One row per outcome per source: notes and videos from the same source share
 * a row, so the original form's "I have read it" stays one row per outcome.
 * Question counts are spread over the scope's outcomes in equal shares, the
 * remainder on the first ones, so the stored totals are the typed totals.
 */
export function declaredRows(declarations: PriorWorkDeclaration[], topics: Map<string, TopicShape>): DeclaredRow[] {
  const overridden = new Set(declarations.filter((d) => d.readingId).map((d) => d.readingId!));
  const rows: DeclaredRow[] = [];

  for (const d of declarations) {
    const topic = topics.get(d.topicId)!;
    const readings = d.readingId
      ? topic.readings.filter((r) => r.id === d.readingId)
      : topic.readings.filter((r) => !overridden.has(r.id));
    const losIds = readings.flatMap((r) => r.los.map((l) => l.id));
    if (losIds.length === 0) continue;

    const answered = d.questions?.answered ?? 0;
    const accuracy = d.questions?.accuracyPercent ?? null;
    const correct = accuracy === null ? 0 : Math.round((answered * accuracy) / 100);
    const baseAnswered = Math.floor(answered / losIds.length);
    const baseCorrect = Math.floor(correct / losIds.length);
    let answeredLeft = answered - baseAnswered * losIds.length;
    let correctLeft = correct - baseCorrect * losIds.length;

    // The midpoint stands in for "not rated", as the original form did.
    const confidence = d.confidence ?? 3;
    const keyOf = (from: string | null) => from ?? UNATTRIBUTED;

    for (const losId of losIds) {
      const bySource = new Map<string, DeclaredRow>();
      const rowFor = (key: string) => {
        let row = bySource.get(key);
        if (!row) {
          row = {
            losId,
            packageId: key === UNATTRIBUTED ? null : key,
            confidence,
            questionsAnswered: 0,
            questionsCorrect: 0,
            declaredRead: false,
            declaredWatched: false,
          };
          bySource.set(key, row);
        }
        return row;
      };

      if (d.notesFrom) rowFor(d.notesFrom).declaredRead = true;
      if (d.videosFrom) rowFor(d.videosFrom).declaredWatched = true;
      if (d.questions && answered > 0) {
        const extraA = answeredLeft > 0 ? 1 : 0;
        const extraC = correctLeft > 0 ? 1 : 0;
        answeredLeft -= extraA;
        correctLeft -= extraC;
        const row = rowFor(keyOf(d.questions.from));
        row.questionsAnswered = baseAnswered + extraA;
        row.questionsCorrect = Math.min(row.questionsAnswered, baseCorrect + extraC);
      }
      rows.push(...bySource.values());
    }
  }
  return rows;
}
