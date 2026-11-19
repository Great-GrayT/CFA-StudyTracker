export const MAX_QUESTION_NUMBER = 5000;
export const MAX_QUESTION_ITEMS = 2000;

const DASHES = /[\u2010-\u2015\u2212]/g;

/** "1, 3-8, 12" to sorted unique numbers; an empty string is valid and empty. */
export function parseQuestionNumbers(text: string): { numbers: number[]; error: string | null } {
  // Tighten "3 - 8" so the whitespace split below keeps the range whole.
  const cleaned = text.replace(DASHES, "-").replace(/\s*-\s*/g, "-").trim();
  if (cleaned === "") return { numbers: [], error: null };
  const out = new Set<number>();
  for (const raw of cleaned.split(/[,;\s]+/)) {
    if (raw === "") continue;
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(raw);
    const single = /^\d+$/.test(raw);
    if (!range && !single) {
      return { numbers: [], error: `"${raw}" is not a question number. Use numbers and ranges like 1, 3-8, 12.` };
    }
    const lo = Number(range ? range[1] : raw);
    const hi = Number(range ? range[2] : raw);
    if (lo < 1 || hi < 1) return { numbers: [], error: "Question numbers start at 1." };
    if (lo > hi) return { numbers: [], error: `The range ${lo}-${hi} runs backwards.` };
    if (hi > MAX_QUESTION_NUMBER) return { numbers: [], error: `Question numbers go up to ${MAX_QUESTION_NUMBER}.` };
    if (hi - lo + 1 > MAX_QUESTION_ITEMS) return { numbers: [], error: `Enter at most ${MAX_QUESTION_ITEMS} questions.` };
    for (let n = lo; n <= hi; n++) out.add(n);
    if (out.size > MAX_QUESTION_ITEMS) return { numbers: [], error: `Enter at most ${MAX_QUESTION_ITEMS} questions.` };
  }
  return { numbers: [...out].sort((a, b) => a - b), error: null };
}

/** [2,3,4,7] to "2-4, 7". */
export function formatQuestionNumbers(numbers: number[]): string {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(j - i >= 1 ? `${sorted[i]}-${sorted[j]}` : `${sorted[i]}`);
    i = j + 1;
  }
  return parts.join(", ");
}
