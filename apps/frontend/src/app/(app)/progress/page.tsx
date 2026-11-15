"use client";

import { Suspense } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { RegionError, regionState } from "@/components/states/region-states";
import { PaceTab, PaceTabSkeleton } from "@/components/progress/pace-tab";
import { usePlan } from "@/lib/hooks";
import { ApiError } from "@/lib/api";
import { examPhase } from "@/lib/today";
import { useOnline } from "@/hooks/use-online";

type Tab = "pace" | "mocks" | "journal";
const TABS: { value: Tab; label: string }[] = [
  { value: "pace", label: "Pace" },
  { value: "mocks", label: "Mocks" },
  { value: "journal", label: "Journal" },
];

// Loaded when their tab opens: recharts and the virtualised list are most of
// the page's weight, and Pace is the tab most visits land on.
const tabSkeleton = () => <Skeleton className="h-[240px] w-full rounded-none" aria-label="Loading" />;
const MocksTab = dynamic(() => import("@/components/progress/mocks-tab").then((m) => m.MocksTab), {
  ssr: false,
  loading: tabSkeleton,
});
const JournalTab = dynamic(() => import("@/components/progress/journal-tab").then((m) => m.JournalTab), {
  ssr: false,
  loading: tabSkeleton,
});

const fullDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-[1200px] min-w-0 px-4 py-6 md:px-8 md:py-8">{children}</div>;
}

export default function ProgressPage() {
  return (
    // useSearchParams needs a boundary to prerender.
    <Suspense fallback={<ProgressSkeleton />}>
      <Progress />
    </Suspense>
  );
}

function Progress() {
  const online = useOnline();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const raw = params.get("tab");
  const tab: Tab = raw === "mocks" || raw === "journal" ? raw : "pace";

  const plan = usePlan();
  const planState = regionState(plan);

  // Replace, not push: switching tabs is not a place Back should return to.
  // Other params (an open ?los=) are kept.
  const setTab = (v: string) => {
    const next = new URLSearchParams(params.toString());
    if (v === "pace") next.delete("tab");
    else next.set("tab", v);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  if (planState.loading) return <ProgressSkeleton />;

  // Only a 404 means no plan; any other miss is an error.
  if (plan.error instanceof ApiError && plan.error.status === 404) {
    return (
      <Shell>
        <section className="flex max-w-lg flex-col items-start gap-3 py-12">
          <h1 className="text-[26px] leading-tight font-semibold">No study plan yet</h1>
          <p className="text-muted-foreground text-[14px]">Set up a plan and your pace, mocks and journal collect here.</p>
          <Button asChild>
            <Link href="/onboarding">Set up a plan</Link>
          </Button>
        </section>
      </Shell>
    );
  }
  if (!plan.data) {
    return (
      <Shell>
        <h1 className="text-[26px] font-semibold tracking-tight">Progress</h1>
        <RegionError error={planState.error} online={online} onRetry={() => void plan.refetch()} />
      </Shell>
    );
  }

  const todayISO = new Intl.DateTimeFormat("en-CA").format(new Date());
  const ended = examPhase(plan.data.examDate, todayISO) === "after";

  return (
    <Shell>
      <h1 className="text-[26px] font-semibold tracking-tight">Progress</h1>
      {ended ? (
        <p className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[14px]">
          <span className="text-muted-foreground">
            Your exam was on {fullDate.format(new Date(`${plan.data.examDate.slice(0, 10)}T00:00:00Z`))}. Your
            history stays here.
          </span>
          <Link
            href="/settings#start-over"
            className="text-claimed-ink focus-visible:ring-ring rounded-sm underline underline-offset-4 outline-hidden focus-visible:ring-2"
          >
            Start a new plan
          </Link>
        </p>
      ) : null}

      <Tabs value={tab} onValueChange={setTab} className="mt-4 gap-0">
        <TabsList className="border-border h-auto w-full justify-start gap-6 rounded-none border-b bg-transparent p-0">
          {TABS.map((t) => (
            <TabsTrigger
              key={t.value}
              value={t.value}
              className="data-[state=active]:border-primary -mb-px h-10 flex-none rounded-none border-b-2 border-transparent px-0 text-[14px] max-md:h-11"
            >
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="pace" className="pt-6">
          <PaceTab plan={plan.data} ended={ended} online={online} />
        </TabsContent>
        <TabsContent value="mocks" className="pt-6">
          <MocksTab planId={plan.data.id} online={online} />
        </TabsContent>
        <TabsContent value="journal" className="pt-6">
          <JournalTab plan={plan.data} online={online} />
        </TabsContent>
      </Tabs>
    </Shell>
  );
}

function ProgressSkeleton() {
  return (
    <Shell>
      <div aria-busy="true" aria-label="Loading progress">
        <Skeleton className="h-8 w-36 rounded-sm" />
        <div className="border-border mt-4 flex h-10 items-center gap-6 border-b">
          <Skeleton className="h-4 w-10 rounded-sm" />
          <Skeleton className="h-4 w-12 rounded-sm" />
          <Skeleton className="h-4 w-14 rounded-sm" />
        </div>
        <div className="pt-6">
          <PaceTabSkeleton />
        </div>
      </div>
    </Shell>
  );
}
