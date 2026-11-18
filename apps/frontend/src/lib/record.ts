import type { SessionKind } from "./hooks";
import type { DeclarationItem, StepNo } from "./types";

// Pure half of the Record sheet's presets, so applying one can be tested.

const SESSION_KINDS = new Set<string>(["content-notes", "content-video", "eocq", "questions", "review"]);

type PresetInput = { taskId?: string; losId?: string; date?: string };
type TopicLike = { id: string; readings: { id: string; los: { id: string }[] }[] };
type TaskLike = { id: string; kind: string; readingIds: string[] };
export type PresetFields = { topicId?: string; readingId?: string; kind?: SessionKind };

/**
 * The fields a preset sets, or undefined while what it needs is still loading.
 * The sheet applies the result once per preset, so a refetch never overwrites
 * what the candidate has since changed.
 */
export function resolvePreset(
  preset: PresetInput,
  topics: TopicLike[],
  day: { date: string; tasks: TaskLike[] } | undefined,
  today: string,
): PresetFields | undefined {
  if (!preset.taskId && !preset.losId) return {};
  if (topics.length === 0) return undefined;

  if (preset.taskId) {
    // Only the preset's own day can say a cell is missing; on the open render
    // the sheet may still hold the previous date's cells.
    if (!day || day.date !== (preset.date ?? today)) return undefined;
    const task = day.tasks.find((t) => t.id === preset.taskId);
    const rid = task?.readingIds[0];
    const topic = rid ? topics.find((t) => t.readings.some((r) => r.id === rid)) : undefined;
    if (task && topic) {
      return {
        topicId: topic.id,
        readingId: rid,
        ...(SESSION_KINDS.has(task.kind) ? { kind: task.kind as SessionKind } : {}),
      };
    }
  }

  if (preset.losId) {
    for (const t of topics) {
      const r = t.readings.find((rd) => rd.los.some((l) => l.id === preset.losId));
      if (r) return { topicId: t.id, readingId: r.id };
    }
  }
  return {};
}

// Self-state and question entry helpers for Record and "Did this before".

type MaterialLike = { action: string; questionCount: number | null };

/**
 * Questions the package sets for a task, or null when unknown. Answer review
 * materials carry a count too (the answers to review), which is not a count
 * to answer, so they are skipped.
 */
export function taskQuestionCount(task: { questionCount: number | null; materials: MaterialLike[] }): number | null {
  if (task.questionCount) return task.questionCount;
  const sum = task.materials
    .filter((m) => m.action !== "Review answers" && m.questionCount)
    .reduce((s, m) => s + (m.questionCount ?? 0), 0);
  return sum > 0 ? sum : null;
}

const WHOLE = /^\d+$/;

/** Message for the answered and correct fields, or null when they can be saved. */
export function questionsError(answered: string, correct: string): string | null {
  if ((answered !== "" && !WHOLE.test(answered)) || (correct !== "" && !WHOLE.test(correct))) {
    return "Use whole numbers for questions.";
  }
  const a = Number(answered);
  if (answered === "" || a === 0) return "Enter how many questions you answered.";
  if (correct === "") return "Enter how many you got correct.";
  if (Number(correct) > a) return "Correct answers cannot exceed questions answered.";
  return null;
}

/** The step a task belongs to, or null for mocks and tasks written before the engine. */
export function stepForTask(task: { step: number | null }): StepNo | null {
  return task.step && task.step >= 1 && task.step <= 4 ? (task.step as StepNo) : null;
}

/**
 * The server's ordering rule, checked early for a clear message. `doneSteps`
 * holds "readingId|step" for what is already stated or done.
 */
export function declarationError(items: { readingId: string; step: StepNo }[], doneSteps: Set<string>): string | null {
  const has = new Set([...doneSteps, ...items.map((i) => `${i.readingId}|${i.step}`)]);
  for (const i of items) {
    if (i.step === 3 && !has.has(`${i.readingId}|1`)) return "Review needs the first read first";
    if (i.step === 4 && !has.has(`${i.readingId}|2`)) return "Review questions need the initial questions first";
  }
  return null;
}

/** Reads carry a confidence, question steps carry counts; both are optional. */
export function declarationItem(
  readingId: string,
  step: StepNo,
  f: { confidence: number; answered: string; correct: string; date?: string },
): DeclarationItem {
  const item: DeclarationItem = { readingId, step, ...(f.date ? { date: f.date } : {}) };
  if (step === 1 || step === 3) {
    if (f.confidence >= 1) item.confidence = f.confidence;
  } else if (f.answered !== "" && WHOLE.test(f.answered)) {
    item.answered = Number(f.answered);
    if (f.correct !== "" && WHOLE.test(f.correct)) item.correct = Number(f.correct);
  }
  return item;
}
