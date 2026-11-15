"use client";

import { toast } from "sonner";
import { useSubmitTask } from "@/lib/hooks";
import { ApiError, messageForStatus } from "@/lib/api";

/** Puts a recorded cell back to pending, with the same toasts wherever Undo lives. */
export function useUndoRecord(planId: string | undefined) {
  const submitTask = useSubmitTask(planId);
  return {
    pending: submitTask.isPending,
    undo(taskId: string): Promise<void> {
      return submitTask.mutateAsync({ taskId, status: "pending" }).then(
        () => void toast("Undone. The cell is back on your plan."),
        (err) =>
          void toast.error(err instanceof ApiError ? err.message : messageForStatus(0, "Could not undo that.")),
      );
    },
  };
}
