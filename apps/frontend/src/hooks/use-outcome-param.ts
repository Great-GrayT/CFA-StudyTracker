"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { arrivalAction, closeAction, flagsAfter, openAction } from "@/lib/outcome-history";

// Native history, not router.push: a search-param push through the router
// fetches the route's payload, so the sheet would not open offline. Next
// patches pushState and replaceState to sync useSearchParams, but only for
// state objects without its own `__NA` key, so every call passes a fresh one.

const MARK = "outcomeSheet";

function urlWith(los: string | null): string {
  const url = new URL(window.location.href);
  if (los) url.searchParams.set("los", los);
  else url.searchParams.delete("los");
  return `${url.pathname}${url.search}${url.hash}`;
}

const mark = (los: string | null) => (los ? { [MARK]: los } : {});
const push = (los: string | null) => window.history.pushState(mark(los), "", urlWith(los));
const replace = (los: string | null) => window.history.replaceState(mark(los), "", urlWith(los));

/**
 * Next installs its history patch in the app router's effect, which runs after
 * this child's effects on a hard load. Calls made before it lack Next's state,
 * and Next reloads the page on popstate to such an entry, so wait for it.
 * The patch is an own property; the native method lives on the prototype.
 */
function whenPatched(fn: () => void, tries = 20) {
  if (Object.prototype.hasOwnProperty.call(window.history, "pushState") || tries === 0) fn();
  else window.setTimeout(() => whenPatched(fn, tries - 1), 0);
}

function navType(): string {
  const entry = performance.getEntriesByType?.("navigation")[0] as PerformanceNavigationTiming | undefined;
  return entry?.type ?? "navigate";
}

// Module scope, so every caller's close agrees with the one history owner.
let backable = false; // the entry under the open sheet is this page without it
let closing = false; // a Back is in flight
let arrived = false; // the document's first arrival has been seen

/**
 * The open outcome lives in `?los=`, so any page, link or palette entry can
 * open the sheet. Opening pushes a history entry so Back closes it; switching
 * outcome inside the sheet replaces. Exactly one caller (the sheet in the app
 * layout) passes `syncHistory`, and inserts the sheetless page underneath when
 * the sheet arrives without one.
 */
export function useOutcomeParam(
  { syncHistory = false }: { syncHistory?: boolean } = {},
): [losId: string | null, set: (id: string | null) => void] {
  const params = useSearchParams();
  const pathname = usePathname();
  const losId = params.get("los");
  const last = useRef<{ pathname: string; los: string | null } | null>(null);

  useEffect(() => {
    if (!syncHistory) return;
    const action = arrivalAction({
      prev: last.current,
      pathname,
      los: losId,
      navType: navType(),
      mark: window.history.state?.[MARK],
      firstArrival: !arrived,
    });
    arrived = true;
    last.current = { pathname, los: losId };
    ({ backable, closing } = flagsAfter(action, { backable, closing }));
    if (action === "insert") {
      whenPatched(() => {
        replace(null);
        push(losId);
      });
    }
  }, [syncHistory, pathname, losId]);

  const set = useCallback((id: string | null) => {
    const current = new URLSearchParams(window.location.search).get("los");
    if (id) {
      const a = openAction(current, id);
      if (a === "push") push(id);
      else if (a === "replace") replace(id);
      return;
    }
    const a = closeAction({ backable, closing });
    if (a === "back") {
      backable = false;
      closing = true;
      window.history.back();
    } else if (a === "replace") {
      replace(null);
    }
  }, []);

  return [losId, set];
}
