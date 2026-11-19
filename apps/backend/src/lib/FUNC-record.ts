// Recording study: the one act behind ticking a task and logging a session.
//
// A record against a plan task settles the task (status and minutes, which the
// planner and the pace model read) and writes the log rows for its outcomes
// (confidence and questions, which mastery and the coach read). Both entry
// points, a task's Record button and the Record study sheet, come here, so the
// two can never disagree about what was studied.
import type { Prisma } from "@prisma/client";
import { spread } from "../core/spread";

export type RecordInput = {
  status: "done" | "partial" | "pending";
  actualMinutes?: number;
  confidence?: number;
  questionsAnswered?: number;
  questionsCorrect?: number;
  questionNumbers?: number[];
  answerReviewDone?: boolean;
  answerReviewMinutes?: number;
  note?: string;
};

type Tx = Prisma.TransactionClient;

/**
 * Applies a record to a task inside the caller's transaction. A task owns its
 * rows, so recording again replaces them and "pending" (undo) deletes them.
 */
export async function recordTask(
  tx: Tx,
  userId: string,
  task: { id: string; planId: string; date: Date; estimatedMinutes: number; readingIds: string[] },
  input: RecordInput,
): Promise<{ id: string; status: string; actualMinutes: number | null }> {
  await tx.studyLogEntry.deleteMany({ where: { taskId: task.id } });

  const numbers = [...new Set(input.questionNumbers ?? [])].sort((a, b) => a - b);
  // Numbers imply how many were answered when the count is not given.
  const questionsAnswered = input.questionsAnswered ?? (numbers.length > 0 ? numbers.length : undefined);

  const cap = (n: number) => Math.min(600, Math.max(0, n));
  const updated = await tx.planTask.update({
    where: { id: task.id },
    data:
      input.status === "pending"
        ? { status: "pending", actualMinutes: null, answerReviewMinutes: null, answerReviewDone: false, questionNumbers: [] }
        : {
            status: input.status,
            actualMinutes: cap(input.actualMinutes ?? task.estimatedMinutes),
            // Kept apart so answering time stays the pace sample. Only a done task takes it: a partial's
            // credit ratio is spent over estimated, and review minutes would inflate it.
            answerReviewMinutes: input.status === "done" && input.answerReviewMinutes !== undefined
              ? cap(input.answerReviewMinutes) : null,
            answerReviewDone: input.answerReviewDone ?? false,
            // Omitted means unchanged: an edit that never showed the field must not wipe saved numbers.
            ...(input.questionNumbers !== undefined ? { questionNumbers: numbers } : {}),
          },
  });
  if (input.status === "pending") return updated;

  const los = await tx.lOS.findMany({
    where: { readingId: { in: task.readingIds } },
    select: { id: true },
    orderBy: [{ readingId: "asc" }, { order: "asc" }],
  });
  const answered = spread(questionsAnswered ?? 0, los.length);
  const correct = spread(input.questionsCorrect ?? 0, los.length);
  await tx.studyLogEntry.createMany({
    data: los.map((l, i) => ({
      userId,
      planId: task.planId,
      losId: l.id,
      confidence: input.confidence!,
      questionsAnswered: answered[i]!,
      questionsCorrect: Math.min(answered[i]!, correct[i]!),
      // Dated on the task's day: the work belongs to the day it was planned
      // for, even when recorded the morning after.
      date: task.date,
      taskId: task.id,
      note: i === 0 ? (input.note ?? null) : null,
    })),
  });
  return updated;
}
