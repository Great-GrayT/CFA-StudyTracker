"use client";

import { useQuery, useMutation, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { api } from "./api";
import type {
  Curriculum,
  LevelSummary,
  Plan,
  Progress,
  LogEntry,
  MockExam,
  StudyPackage,
  PlanPackage,
  Holiday,
  CronStatus,
  PushDevice,
  Los,
  Prescription,
} from "./types";
import type { Campaign } from "./campaign-types";

export const keys = {
  plan: ["plan"] as const,
  curriculum: (levelId: string) => ["curriculum", levelId] as const,
  levels: ["levels"] as const,
  progress: (planId: string) => ["progress", planId] as const,
  logs: (planId: string) => ["logs", planId] as const,
  mocks: (planId: string) => ["mocks", planId] as const,
  packages: ["packages"] as const,
  planPackages: (planId: string) => ["plan-packages", planId] as const,
  holidays: (planId: string) => ["holidays", planId] as const,
  cron: ["cron"] as const,
  devices: ["devices"] as const,
  prescription: (planId: string, from: string, to: string) =>
    ["prescription", planId, from, to] as const,
  campaign: (planId: string, periodDays: number) =>
    ["campaign", planId, periodDays] as const,
};

/**
 * The days themselves: which module, which video, which pages, how many
 * questions, and the link that opens them.
 *
 * Dates are the candidate's own calendar days as YYYY-MM-DD, never instants,
 * so a plan is not shifted a day by the reader's time zone.
 */
export function usePrescription(
  planId: string | undefined,
  from: string,
  to: string,
): UseQueryResult<Prescription> {
  return useQuery({
    queryKey: keys.prescription(planId ?? "", from, to),
    queryFn: () =>
      api.get<Prescription>(
        `plans/${encodeURIComponent(planId!)}/tasks?from=${from}&to=${to}`,
      ),
    enabled: !!planId,
  });
}

/**
 * The whole run to the exam, in periods.
 *
 * Fetched once and held, never per render: the projection runs the planner's
 * entire pipeline over every remaining day, which for a 21 week plan is
 * roughly 150 days of packing. It writes nothing, so it is safe to call; it
 * is just expensive. Only an actual plan change makes it stale, and saving
 * one already invalidates this key.
 */
export function useCampaign(
  planId: string | undefined,
  periodDays = 7,
): UseQueryResult<Campaign> {
  return useQuery({
    queryKey: keys.campaign(planId ?? "", periodDays),
    queryFn: () =>
      api.get<Campaign>(
        `plans/${encodeURIComponent(planId!)}/campaign?periodDays=${periodDays}`,
      ),
    enabled: !!planId,
    staleTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
}

export function usePlan(): UseQueryResult<Plan> {
  return useQuery({ queryKey: keys.plan, queryFn: () => api.get<Plan>("plans") });
}

/**
 * The level tree.
 *
 * staleTime Infinity because it only changes on a yearly reseed, and the ETag
 * handles that: the persisted cache means a returning user pays nothing, and a
 * reseed changes the ETag so the next conditional request refetches.
 */
export function useCurriculum(levelId: string | undefined): UseQueryResult<Curriculum> {
  return useQuery({
    queryKey: keys.curriculum(levelId ?? ""),
    queryFn: () => api.get<Curriculum>(`curriculum?levelId=${encodeURIComponent(levelId!)}`),
    enabled: !!levelId,
    staleTime: Infinity,
    gcTime: 1000 * 60 * 60 * 24 * 30,
  });
}

/**
 * The level chooser's list, and the one query that must never serve a stale
 * answer from disk.
 *
 * It used to cache for an hour. Combined with the IndexedDB persister that is
 * an hour ACROSS SESSIONS, so a reload does not help: the cache rehydrates and
 * no request is made. This response decides whether a level is offered at all,
 * so a stale copy does not merely show old numbers, it tells the candidate a
 * level does not exist. That is exactly what happened in production after Level
 * II was seeded.
 *
 * Revalidating on mount costs almost nothing now that the route sends an ETag:
 * the usual answer is a 304 with no body. React Query keeps showing the cached
 * list while that happens, so nothing flickers and nothing waits.
 */
export function useLevels(): UseQueryResult<{ levels: LevelSummary[] }> {
  return useQuery({
    queryKey: keys.levels,
    queryFn: () => api.get<{ levels: LevelSummary[] }>("curriculum/levels"),
    staleTime: 0,
    refetchOnMount: "always",
  });
}

export function useProgress(planId: string | undefined): UseQueryResult<Progress> {
  return useQuery({
    queryKey: keys.progress(planId ?? ""),
    queryFn: () => api.get<Progress>(`progress?planId=${encodeURIComponent(planId!)}`),
    enabled: !!planId,
  });
}

/**
 * The full log history.
 *
 * Fetched whole, not paged, because the client derives coverage, the new
 * versus review split, missed days across the whole axis, and the behind or
 * ahead figure from it. The API pages at 50, so this walks the cursor.
 *
 * At a few thousand rows after a full campaign this is still well under a
 * megabyte, and it is cached in IndexedDB between sessions.
 */
export function useLogs(planId: string | undefined): UseQueryResult<LogEntry[]> {
  return useQuery({
    queryKey: keys.logs(planId ?? ""),
    enabled: !!planId,
    queryFn: async () => {
      const all: LogEntry[] = [];
      let cursor: string | undefined;
      do {
        const qs = new URLSearchParams({ planId: planId!, limit: "200" });
        if (cursor) qs.set("cursor", cursor);
        const page = await api.get<{ items: LogEntry[]; nextCursor: string | null }>(
          `logs?${qs.toString()}`,
        );
        all.push(...page.items);
        cursor = page.nextCursor ?? undefined;
        // A server that kept returning the same cursor would spin forever.
        if (page.items.length === 0) break;
      } while (cursor);
      return all;
    },
  });
}

export function useMocks(planId: string | undefined): UseQueryResult<MockExam[]> {
  return useQuery({
    queryKey: keys.mocks(planId ?? ""),
    queryFn: () => api.get<MockExam[]>(`mock-exams?planId=${encodeURIComponent(planId!)}`),
    enabled: !!planId,
  });
}

export function usePackages(): UseQueryResult<StudyPackage[]> {
  return useQuery({ queryKey: keys.packages, queryFn: () => api.get<StudyPackage[]>("packages") });
}

export function usePlanPackages(planId: string | undefined): UseQueryResult<PlanPackage[]> {
  return useQuery({
    queryKey: keys.planPackages(planId ?? ""),
    queryFn: () => api.get<PlanPackage[]>(`plans/${planId}/packages`),
    enabled: !!planId,
  });
}

export function useHolidays(planId: string | undefined): UseQueryResult<Holiday[]> {
  return useQuery({
    queryKey: keys.holidays(planId ?? ""),
    queryFn: () => api.get<Holiday[]>(`plans/${planId}/holidays`),
    enabled: !!planId,
  });
}

export function useCronStatus(): UseQueryResult<CronStatus> {
  return useQuery({
    queryKey: keys.cron,
    queryFn: () => api.get<CronStatus>("cron/runs?limit=30"),
    staleTime: 60_000,
  });
}

export function usePushDevices(): UseQueryResult<{ subscriptions: PushDevice[] }> {
  return useQuery({
    queryKey: keys.devices,
    queryFn: () => api.get<{ subscriptions: PushDevice[] }>("push/subscriptions"),
  });
}

/**
 * Everything a logging write invalidates.
 *
 * Centralised because forgetting one of these is how a screen ends up showing
 * a number that contradicts the one beside it.
 */
export function useInvalidateAfterLog(planId: string | undefined) {
  const qc = useQueryClient();
  return () => {
    if (!planId) return;
    qc.invalidateQueries({ queryKey: keys.logs(planId) });
    qc.invalidateQueries({ queryKey: keys.progress(planId) });
  };
}

export function useCreateLog(planId: string | undefined) {
  const invalidate = useInvalidateAfterLog(planId);
  return useMutation({
    mutationFn: (body: {
      losId: string;
      confidence: number;
      questionsAnswered: number;
      questionsCorrect?: number;
      packageId?: string;
      note?: string;
      date?: string;
    }) => api.post<LogEntry>("logs", { planId, ...body }),
    onSuccess: invalidate,
  });
}

export function useDeleteLog(planId: string | undefined) {
  const invalidate = useInvalidateAfterLog(planId);
  return useMutation({
    mutationFn: (logId: string) => api.del<unknown>(`logs/${logId}`),
    onSuccess: invalidate,
  });
}

export type TaskSubmission =
  | { status: "done"; actualMinutes?: number }
  | { status: "partial"; actualMinutes: number }
  | { status: "pending" };

/**
 * Submits one task from the day view. The server rebuilds the coming days on
 * success, so every view of the schedule is refetched, not just this day.
 */
export function useSubmitTask(planId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, ...body }: TaskSubmission & { taskId: string }) =>
      api.patch<{ task: { id: string; status: string; actualMinutes: number | null } }>(
        `plans/${planId}/tasks/${taskId}`,
        body,
      ),
    // Returned so mutateAsync resolves only once the day has refetched;
    // otherwise the row flashes its old state between save and reload.
    onSuccess: () => {
      if (!planId) return;
      return Promise.all([
        qc.invalidateQueries({ queryKey: ["prescription", planId] }),
        qc.invalidateQueries({ queryKey: ["campaign", planId] }),
        qc.invalidateQueries({ queryKey: keys.progress(planId) }),
      ]);
    },
  });
}

/** Flattens the curriculum tree into a searchable list, with its parents attached. */
export type FlatLos = Los & {
  topicId: string;
  topicName: string;
  readingId: string;
  readingName: string;
};

export function flattenCurriculum(curriculum: Curriculum | undefined): FlatLos[] {
  if (!curriculum) return [];
  const out: FlatLos[] = [];
  for (const topic of curriculum.topics) {
    for (const reading of topic.readings) {
      for (const los of reading.los) {
        out.push({
          ...los,
          topicId: topic.id,
          topicName: topic.name,
          readingId: reading.id,
          readingName: reading.name,
        });
      }
    }
  }
  return out;
}
