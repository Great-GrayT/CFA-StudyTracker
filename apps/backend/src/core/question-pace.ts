/**
 * Minutes per practice question, anchored to the exam. Pure.
 *
 * The Level II exam gives 264 minutes for 88 questions, so 3.0 minutes is the
 * pace a candidate must hold. The effort model's calc-share rate
 * (Q_BASE + (Q_CALC - Q_BASE) * calcShare) shapes it by topic; the anchor
 * rescales that rate so its question-weighted mean over the catalogue is
 * exactly exam pace. Review answers questions already seen, so it runs at
 * 2.5 / 3.0 of the learning rate.
 *
 * Answer-explanation reading is deliberately not priced in: the plan used to
 * add it, and a set of 8 questions came out at 85 minutes.
 */
import type { EffortConstants } from "./effort";

export const EXAM_MINUTES_PER_QUESTION = 264 / 88;
export const REVIEW_PACE_RATIO = 2.5 / 3.0;

export type QuestionSetShape = { questionCount: number; calcCount: number };

function rawRate(calcShare: number, c: EffortConstants): number {
  return c.Q_BASE + (c.Q_CALC - c.Q_BASE) * calcShare;
}

/** Factor that brings the catalogue's mean calc-share rate to exam pace; 1 with no data. */
export function questionPaceAnchor(sets: QuestionSetShape[], c: EffortConstants): number {
  let count = 0;
  let minutes = 0;
  for (const s of sets) {
    if (s.questionCount <= 0) continue;
    count += s.questionCount;
    minutes += s.questionCount * rawRate(s.calcCount / s.questionCount, c);
  }
  return count > 0 && minutes > 0 ? (EXAM_MINUTES_PER_QUESTION * count) / minutes : 1;
}

/** Learning-stage minutes per question for a topic with this calculation share. */
export function questionRate(calcShare: number, anchor: number, c: EffortConstants): number {
  return rawRate(calcShare, c) * anchor;
}

export function reviewQuestionMinutes(learningMinutes: number): number {
  return learningMinutes * REVIEW_PACE_RATIO;
}

/**
 * Questions a slice of a bank covers, so a task can say "9 questions" rather
 * than the whole bank's count. At least 1, at most the bank; undefined when
 * the bank's size is unknown.
 */
export function questionsIn(
  sliceMinutes: number,
  bankQuestions: number,
  bankMinutes: number,
): number | undefined {
  if (bankQuestions <= 0 || bankMinutes <= 0) return undefined;
  const n = Math.round((sliceMinutes / bankMinutes) * bankQuestions);
  return Math.min(bankQuestions, Math.max(1, n));
}

/**
 * Minutes to read a bank's worked solutions after answering it. The answer
 * file repeats the questions, so the text to review is the answer file's
 * words minus the question file's. Unmeasured or inconsistent files fall back
 * to a third of the answering time.
 */
export function answerReviewMinutes(
  words: { answerWords: number | null; questionWords: number | null },
  answeringMinutes: number,
  wordsPerMinute: number,
): number {
  const { answerWords, questionWords } = words;
  if (answerWords !== null && questionWords !== null && wordsPerMinute > 0) {
    const explanation = answerWords - questionWords;
    if (explanation > 0) return explanation / wordsPerMinute;
  }
  return answeringMinutes / 3;
}

/**
 * Splits a practice slice into its answering and reviewing tasks. Practice is
 * budgeted as one block so the two land on the same day; it is only presented
 * and submitted as two. Answering is never under a minute.
 */
export function splitPractice(
  minutes: number,
  answeringShare: number,
): { answering: number; review: number } {
  const total = Math.round(minutes);
  if (answeringShare >= 1 || total <= 1) return { answering: total, review: 0 };
  const answering = Math.min(total, Math.max(1, Math.round(total * answeringShare)));
  return { answering, review: total - answering };
}
