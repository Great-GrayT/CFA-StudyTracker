import type { SessionKind } from "./hooks";

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
