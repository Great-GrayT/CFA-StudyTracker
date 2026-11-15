"use client";

import { Suspense, useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { RegionError, regionState } from "@/components/states/region-states";
import { CampaignTab } from "@/components/plan/campaign-tab";
import { CalendarTab } from "@/components/plan/calendar-tab";
import { SetupTab } from "@/components/plan/setup-tab";
import { usePlan } from "@/lib/hooks";
import { ApiError } from "@/lib/api";
import { examPhase } from "@/lib/today";
import { useOnline } from "@/hooks/use-online";

type Tab = "campaign" | "calendar" | "setup";
const TABS: { value: Tab; label: string }[] = [
  { value: "campaign", label: "Campaign" },
  { value: "calendar", label: "Calendar" },
  { value: "setup", label: "Setup" },
];

const fullDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-[44rem] min-w-0 px-4 py-6 md:px-8 md:py-8">{children}</div>;
}

function PlanSkeleton() {
  return (
    <Shell>
      <div aria-busy="true" aria-label="Loading plan" className="flex flex-col gap-6">
        <Skeleton className="h-8 w-40 rounded-sm" />
        <Skeleton className="h-9 w-full rounded-none" />
        <Skeleton className="h-[280px] w-full rounded-none" />
      </div>
    </Shell>
  );
}

function PageState({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <section className="flex max-w-lg flex-col items-start gap-3 py-12">
      <h1 className="text-[26px] leading-tight font-semibold">{title}</h1>
      <p className="text-muted-foreground text-[14px]">{body}</p>
      {children}
    </section>
  );
}

export default function PlanPage() {
  return (
    // useSearchParams needs a boundary to prerender.
    <Suspense fallback={<PlanSkeleton />}>
      <Plan />
    </Suspense>
  );
}

function Plan() {
  const online = useOnline();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const raw = params.get("tab");
  const tab: Tab = raw === "calendar" || raw === "setup" ? raw : "campaign";

  const plan = usePlan();
  const state = regionState(plan);
  const todayISO = useMemo(() => new Intl.DateTimeFormat("en-CA").format(new Date()), []);

  // Replace, not push: switching tabs is not a place Back should return to.
  const setTab = (v: string) => {
    const next = new URLSearchParams(params.toString());
    if (v === "campaign") next.delete("tab");
    else next.set("tab", v);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  if (state.loading) return <PlanSkeleton />;

  // Only a 404 means no plan; any other miss is an error, never an invitation to start over.
  if (plan.error instanceof ApiError && plan.error.status === 404) {
    return (
      <Shell>
        <PageState title="No study plan yet" body="Set up a plan and its campaign, calendar and setup appear here.">
          <Button asChild>
            <Link href="/onboarding">Set up a plan</Link>
          </Button>
        </PageState>
      </Shell>
    );
  }

  if (!plan.data) {
    return (
      <Shell>
        <RegionError error={state.error} online={online} onRetry={() => void plan.refetch()} />
      </Shell>
    );
  }

  // The exam has passed: no countdown, only the way forward.
  if (examPhase(plan.data.examDate, todayISO) === "after") {
    return (
      <Shell>
        <PageState
          title={`Your exam was on ${fullDate.format(new Date(`${plan.data.examDate.slice(0, 10)}T00:00:00Z`))}`}
          body="The campaign is closed. Your history stays readable in Progress."
        >
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href="/progress">Open Progress</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/settings#start-over">Start a new plan</Link>
            </Button>
          </div>
        </PageState>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="flex flex-col gap-6">
        <h1 className="text-[26px] leading-tight font-semibold">Plan</h1>
        <Tabs value={tab} onValueChange={setTab} className="gap-0">
          <TabsList className="border-border h-auto w-full justify-start gap-6 rounded-none border-b bg-transparent p-0">
            {TABS.map((t) => (
              <TabsTrigger
                key={t.value}
                value={t.value}
                className="data-[state=active]:border-primary text-muted-foreground data-[state=active]:text-foreground h-11 flex-none rounded-none border-0 border-b-2 border-transparent bg-transparent px-0 text-[14px] shadow-none data-[state=active]:bg-transparent md:h-10"
              >
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="campaign" className="pt-6">
            <CampaignTab planId={plan.data.id} />
          </TabsContent>
          <TabsContent value="calendar" className="pt-6">
            <CalendarTab plan={plan.data} todayISO={todayISO} />
          </TabsContent>
          <TabsContent value="setup" className="pt-6">
            <SetupTab plan={plan.data} />
          </TabsContent>
        </Tabs>
      </div>
    </Shell>
  );
}
