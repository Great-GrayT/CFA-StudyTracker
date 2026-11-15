"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { usePlan } from "@/lib/hooks";
import { planGuardTarget, planStatus } from "@/lib/shell";

// Middleware already turns away visitors without a session; this catches the
// signed-in candidate with no plan, who would otherwise see empty pages.
export function PlanGuard({ children }: { children: React.ReactNode }) {
  const plan = usePlan();
  const pathname = usePathname();
  const router = useRouter();
  const status = planStatus(plan);
  const target = status === null ? null : planGuardTarget(status, pathname);

  useEffect(() => {
    if (target) router.replace(target);
  }, [target, router]);

  // Nothing to show while leaving; the page would only flash its error state.
  return target ? null : <>{children}</>;
}
