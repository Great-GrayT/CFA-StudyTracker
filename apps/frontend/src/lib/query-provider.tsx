"use client";

import { useState, type ReactNode } from "react";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { get, set, del } from "idb-keyval";

// One tool covers both server state and the read-only offline requirement.
// Persisting the cache IS the offline story: no second data layer, no sync
// engine, and nothing to go stale in a way the user cannot see.
//
// IndexedDB rather than localStorage, for two reasons that both bite here: the
// cached curriculum tree runs to a few hundred kilobytes against localStorage's
// ~5MB ceiling shared with everything else, and localStorage is synchronous, so
// writing a payload that size blocks the main thread on every persist.
//
// Writes are never queued. The product spec puts offline writes out of scope
// for v1, so a failed mutation says so in place rather than pretending.
const idbPersister = {
  persistClient: async (client: unknown) => {
    await set("cfa-cache", client);
  },
  restoreClient: async () => {
    return (await get("cfa-cache")) ?? undefined;
  },
  removeClient: async () => {
    await del("cfa-cache");
  },
};

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Progress changes when the user logs something, which invalidates
            // it explicitly. A minute of staleness between those is fine and
            // saves a request on every navigation.
            staleTime: 60_000,
            gcTime: 1000 * 60 * 60 * 24 * 7,
            retry: (count, error) => {
              // Never retry an auth or permission failure: the answer will not
              // change, and retrying a 401 just delays the redirect.
              const status = (error as { status?: number })?.status;
              if (status === 401 || status === 403 || status === 404) return false;
              return count < 2;
            },
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <PersistQueryClientProvider
      client={client}
      persistOptions={{
        persister: idbPersister as never,
        maxAge: 1000 * 60 * 60 * 24 * 7,
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
