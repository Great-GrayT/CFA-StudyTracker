// Per-topic mock entry: rows are typed text until sent.

export type MockRow = { topicId: string; answered: string; correct: string };
type Mix = { topicId: string; questions: number }[];

export const rowsFromMix = (mix: Mix): MockRow[] =>
  mix.map((m) => ({ topicId: m.topicId, answered: String(m.questions), correct: "" }));

const WHOLE = /^\d+$/;

export function totals(rows: MockRow[]): { answered: number; correct: number; percent: number | null } {
  let answered = 0;
  let correct = 0;
  for (const r of rows) {
    answered += WHOLE.test(r.answered) ? Number(r.answered) : 0;
    correct += WHOLE.test(r.correct) ? Number(r.correct) : 0;
  }
  return { answered, correct, percent: answered > 0 ? Math.round((correct / answered) * 100) : null };
}

/** `sessionSize` is the session's question count when known; its mix may be unknown. */
export function mockError(rows: MockRow[], sessionSize: number | null): string | null {
  if (rows.length === 0) return "Add at least one topic with its question counts.";
  if (rows.some((r) => !r.topicId)) return "Choose a topic for every row.";
  if (new Set(rows.map((r) => r.topicId)).size !== rows.length) return "Each topic can appear once.";
  for (const r of rows) {
    if ((r.answered !== "" && !WHOLE.test(r.answered)) || (r.correct !== "" && !WHOLE.test(r.correct))) {
      return "Use whole numbers for questions.";
    }
  }
  if (rows.some((r) => r.answered === "" || Number(r.answered) === 0)) return "Enter questions answered for every topic.";
  if (rows.some((r) => r.correct === "")) return "Enter the correct count for every topic.";
  if (rows.some((r) => Number(r.correct) > Number(r.answered))) return "Correct answers cannot exceed questions answered.";
  const t = totals(rows);
  if (sessionSize !== null && t.answered !== sessionSize) {
    return `Questions answered add up to ${t.answered}, but this session has ${sessionSize}.`;
  }
  return null;
}

export const toTopicScores = (rows: MockRow[]) =>
  rows.map((r) => ({ topicId: r.topicId, answered: Number(r.answered), correct: Number(r.correct) }));
