"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RegionError, regionState } from "@/components/states/region-states";
import { PackageView } from "@/components/packages/package-view";
import { useCoverage, usePlan } from "@/lib/hooks";
import { ApiError } from "@/lib/api";
import { packageLabel } from "@/lib/coverage-view";
import { useOnline } from "@/hooks/use-online";

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-[1200px] min-w-0 px-4 py-6 md:px-8 md:py-8">{children}</div>;
}

const Title = () => <h1 className="text-[26px] font-semibold tracking-tight">Packages</h1>;

export default function PackagesPage() {
  const online = useOnline();
  const plan = usePlan();
  const coverage = useCoverage(plan.data?.id);
  const [picked, setPicked] = useState<string | null>(null);
  const planState = regionState(plan);
  const covState = regionState(coverage);

  if (plan.error instanceof ApiError && plan.error.status === 404) {
    return (
      <Shell>
        <section className="flex max-w-lg flex-col items-start gap-3 py-12">
          <h1 className="text-[26px] leading-tight font-semibold">No study plan yet</h1>
          <p className="text-muted-foreground text-[14px]">Set up a plan and its packages show here.</p>
          <Button asChild>
            <Link href="/onboarding">Set up a plan</Link>
          </Button>
        </section>
      </Shell>
    );
  }
  if (planState.loading || (plan.data && covState.loading)) {
    return (
      <Shell>
        <div aria-busy="true" aria-label="Loading packages" className="space-y-6">
          <Skeleton className="h-8 w-40 rounded-sm" />
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14 rounded-sm" />
            ))}
          </div>
          <Skeleton className="h-64 w-full rounded-none" />
        </div>
      </Shell>
    );
  }
  if (!plan.data || !coverage.data) {
    const retry = () => void (plan.data ? coverage.refetch() : plan.refetch());
    return (
      <Shell>
        <Title />
        <RegionError error={plan.data ? covState.error : planState.error} online={online} onRetry={retry} />
      </Shell>
    );
  }

  const packages = coverage.data.packages;
  if (packages.length === 0) {
    return (
      <Shell>
        <Title />
        <section className="flex max-w-lg flex-col items-start gap-3 py-10">
          <p className="text-muted-foreground text-[14px]">
            No study package is on your plan yet. Add one to see which videos and questions you have covered.
          </p>
          <Button asChild>
            <Link href="/plan?tab=setup">Choose packages</Link>
          </Button>
        </section>
      </Shell>
    );
  }

  const current = packages.find((p) => p.packageId === picked) ?? packages[0];
  const label = (p: (typeof packages)[number]) => packageLabel(p.name, p.year);
  return (
    <Shell>
      <Title />
      <p className="text-muted-foreground mt-1 text-[14px]">What you have watched and answered, and how well.</p>
      <Tabs value={current.packageId} onValueChange={setPicked} className="mt-4 gap-0">
        {packages.length > 1 ? (
          <TabsList className="border-border h-auto w-full justify-start gap-6 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden rounded-none border-b bg-transparent p-0">
            {packages.map((p) => (
              <TabsTrigger
                key={p.packageId}
                value={p.packageId}
                className="data-[state=active]:border-primary -mb-px h-10 flex-none rounded-none border-b-2 whitespace-nowrap border-transparent px-0 text-[14px] max-md:h-11"
              >
                {label(p)}
              </TabsTrigger>
            ))}
          </TabsList>
        ) : (
          <h2 className="text-[15px] font-medium">{label(current)}</h2>
        )}
        <div className="pt-6">
          <PackageView pkg={current} />
        </div>
      </Tabs>
    </Shell>
  );
}
