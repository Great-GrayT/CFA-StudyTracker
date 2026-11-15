"use client";

import { SecuritySettings } from "@/components/security-settings";
import { Skeleton } from "@/components/ui/skeleton";
import { SettingsSection } from "./section";

// Waits for the account before mounting: SecuritySettings reads two-step state
// once, on mount, so mounting early would keep the first (wrong) answer.
export function SecuritySection({ loaded, twoStepEnabled }: { loaded: boolean; twoStepEnabled: boolean }) {
  return (
    <SettingsSection
      id="security"
      title="Security"
      lede="Passkeys and two-step sign in. Both are optional and both can be turned off."
    >
      {loaded ? (
        <SecuritySettings twoStepEnabled={twoStepEnabled} />
      ) : (
        <Skeleton className="h-24 w-full rounded-none" />
      )}
    </SettingsSection>
  );
}
