"use client";

import { ApiError, messageForStatus } from "@/lib/api";
import { Button } from "@/components/ui/button";

// The four states every data region shares, so the wording never drifts.

export type QueryLike = { isPending: boolean; fetchStatus: string; error: unknown };

/**
 * Loading only while a fetch can run. A query paused offline with nothing
 * cached would otherwise skeleton forever, so it reads as an offline error.
 */
export function regionState(q: QueryLike): { loading: boolean; error: unknown } {
  const paused = q.isPending && q.fetchStatus === "paused";
  return {
    loading: q.isPending && !paused && !q.error,
    error: q.error ?? (paused ? new ApiError(0, "You are offline.") : null),
  };
}

export function errorText(error: unknown, online: boolean): string {
  if (!online) return "Offline, and nothing saved for this yet.";
  // ApiError already carries the copy-deck sentence for its status.
  return error instanceof ApiError ? error.message : messageForStatus(0, "This could not load.");
}

export function RegionError({
  error,
  online,
  onRetry,
}: {
  error: unknown;
  online: boolean;
  onRetry: () => void;
}) {
  return (
    // status, not alert: several regions can fail together offline.
    <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2 text-[13px]">
      <p className="text-muted-foreground">{errorText(error, online)}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

export function OfflineLine() {
  return (
    <p role="status" className="text-muted-foreground text-[12px]">
      Offline, showing saved data
    </p>
  );
}
