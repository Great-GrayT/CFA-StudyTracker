"use client";

import { RestartPlan } from "@/components/restart-plan";
import { DeleteAccount } from "@/components/delete-account";

// The two resets sit together, the milder first. Start over retires the plan
// and keeps history; delete account removes everything, so it comes last.
// Each block has its own anchor, so Today and Plan can link straight to Start over.

export function DangerZoneSection({
  planId,
  hasPassword,
  twoStepEnabled,
  counts,
}: {
  planId: string | undefined;
  hasPassword: boolean;
  twoStepEnabled: boolean;
  counts: { logCount: number; mockCount: number; historyDays: number } | null;
}) {
  return (
    <section aria-labelledby="danger-heading" className="border-border border-t py-8">
      <h2 id="danger-heading" className="text-[16px] leading-tight font-semibold">
        Danger zone
      </h2>

      <div id="start-over" className="scroll-mt-16 mt-5 flex flex-col gap-3">
        <h3 className="text-[14px] font-medium">Start over</h3>
        {planId ? (
          <RestartPlan planId={planId} />
        ) : (
          <p className="text-muted-foreground text-[13px] leading-relaxed">
            You have no plan to start over yet.
          </p>
        )}
      </div>

      <div id="delete" className="border-border scroll-mt-16 mt-8 flex flex-col gap-3 border-t pt-6">
        <h3 className="text-[14px] font-medium">Delete account</h3>
        <DeleteAccount hasPassword={hasPassword} twoStepEnabled={twoStepEnabled} counts={counts} />
      </div>
    </section>
  );
}
