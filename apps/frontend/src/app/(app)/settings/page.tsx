"use client";

import { useQuery } from "@tanstack/react-query";
import { usePlan } from "@/lib/hooks";
import { api } from "@/lib/api";
import { Footer } from "@/components/ui/footer";
import { SettingsNav } from "@/components/settings/settings-nav";
import { AccountSection, type Me } from "@/components/settings/account";
import { SecuritySection } from "@/components/settings/security";
import { CoachDevicesSection } from "@/components/settings/coach-devices";
import { LocationSection } from "@/components/settings/location";
import { SystemHealthSection } from "@/components/settings/system-health";
import { YourDataSection, useDataCounts } from "@/components/settings/your-data";
import { DangerZoneSection } from "@/components/settings/danger-zone";

// One page for who I am here and how the app reaches me. Sections keep the
// order of the spec; the sub-nav on desktop tracks which one is in view.
export default function SettingsPage() {
  const plan = usePlan();
  const planId = plan.data?.id;
  // Same key as the shell's account query, so the email is already here.
  const me = useQuery<Me>({
    queryKey: ["me"],
    queryFn: () => api.get<Me>("auth/me"),
    staleTime: 5 * 60_000,
  });
  const { counts } = useDataCounts(planId);

  return (
    <div className="mx-auto w-full max-w-5xl min-w-0 px-4 py-6 md:px-8 md:py-8">
      <h1 className="text-[26px] leading-tight font-semibold">Settings</h1>

      <div className="mt-6 lg:grid lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-12">
        <SettingsNav className="sticky top-6 hidden self-start lg:block" />

        <div className="min-w-0 max-w-[44rem]">
          <AccountSection query={me} />
          <SecuritySection loaded={!!me.data} twoStepEnabled={!!me.data?.twoStepEnabled} />
          <CoachDevicesSection
            plan={plan.data}
            planLoading={plan.isPending}
            onSaved={() => plan.refetch()}
          />
          <LocationSection
            plan={plan.data}
            planLoading={plan.isPending}
            onSaved={() => plan.refetch()}
          />
          <SystemHealthSection />
          <YourDataSection planId={planId} />
          <DangerZoneSection
            planId={planId}
            hasPassword={me.data?.hasPassword ?? true}
            twoStepEnabled={me.data?.twoStepEnabled ?? false}
            counts={counts}
          />

          <div className="border-border border-t pt-6">
            <Footer />
          </div>
        </div>
      </div>
    </div>
  );
}
