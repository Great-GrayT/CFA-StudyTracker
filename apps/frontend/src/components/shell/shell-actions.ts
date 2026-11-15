"use client";

import { useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { del } from "idb-keyval";
import { CACHE_KEY } from "@/lib/query-provider";
import { toast } from "sonner";
import { api, signOut } from "@/lib/api";

// Actions the sidebar, top bar and palette share, so each has one behaviour.

export type Account = { email: string };

const noop = () => () => {};
/** False during SSR and hydration, true after. */
export function useHydrated(): boolean {
  return useSyncExternalStore(noop, () => true, () => false);
}

export function useAccount() {
  const query = useQuery({ queryKey: ["me"], queryFn: () => api.get<Account>("auth/me"), staleTime: 5 * 60_000 });
  // The persisted cache restores the email before hydration; the server never has it.
  const hydrated = useHydrated();
  return { ...query, data: hydrated ? query.data : undefined };
}

export function initialsOf(email: string | undefined): string {
  return (email?.trim()[0] ?? "?").toUpperCase();
}

// The query cache is persisted to IndexedDB, so a page load alone would
// restore this account's plan and email for the next person at the browser.
// Clearing memory first stops the persister writing it back.
export function useSignOut(): () => Promise<void> {
  const queryClient = useQueryClient();
  return async () => {
    try {
      await signOut();
    } finally {
      queryClient.clear();
      await del(CACHE_KEY).catch(() => undefined);
      window.location.assign("/login");
    }
  };
}

export async function exportEverything(): Promise<void> {
  const id = toast.loading("Preparing your export");
  try {
    const res = await fetch("/api/proxy/export/all");
    if (!res.ok) throw new Error(String(res.status));
    const url = URL.createObjectURL(await res.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = `cfa-tracker-all-${new Date().toISOString().split("T")[0]}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast.success("Export saved", { id });
  } catch {
    toast.error("Export failed. Check your connection and try again.", { id });
  }
}

// Each form lives on its page's tab, so the palette lands on the form, not the page default.
export const ADD_MOCK_HREF = "/progress?tab=mocks";
export const ADD_HOLIDAY_HREF = "/plan?tab=setup";
