"use client";

import { Suspense, useCallback, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { MapKey, SyllabusMap } from "@/components/syllabus/syllabus-map";
import { SyllabusTable } from "@/components/syllabus/syllabus-table";
import { OfflineLine, RegionError, regionState } from "@/components/states/region-states";
import { useCurriculum, useLogs, usePlan } from "@/lib/hooks";
import { logsByLos, syllabusTotals, syllabusTree, toCoverage, topicRows } from "@/lib/syllabus";
import { useOnline } from "@/hooks/use-online";
import { useOutcomeParam } from "@/hooks/use-outcome-param";

// three.js and R3F load only when the 3D view is chosen.
const Massif = dynamic(() => import("@/components/massif").then((m) => m.Massif), {
  ssr: false,
  loading: () => <Skeleton className="h-[420px] w-full rounded-none" aria-label="Loading the 3D view" />,
});

const pct = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });
type View = "map" | "table" | "3d";
const VIEWS: { value: View; label: string }[] = [
  { value: "map", label: "Map" },
  { value: "table", label: "Table" },
  { value: "3d", label: "3D" },
];

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-[1200px] min-w-0 px-4 py-6 md:px-8 md:py-8">{children}</div>;
}

export default function SyllabusPage() {
  return (
    // useSearchParams needs a boundary to prerender.
    <Suspense fallback={<SyllabusSkeleton />}>
      <Syllabus />
    </Suspense>
  );
}

function Syllabus() {
  const online = useOnline();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, setLos] = useOutcomeParam();
  const raw = params.get("view");
  const view: View = raw === "table" || raw === "3d" ? raw : "map";

  const plan = usePlan();
  const curriculum = useCurriculum(plan.data?.levelId);
  const logs = useLogs(plan.data?.id);

  const c = curriculum.data;
  const l = logs.data;
  const data = c && l ? { c, l } : null;
  const tree = useMemo(() => (c && l ? syllabusTree(c, l) : []), [c, l]);
  const rows = useMemo(() => (c && l ? topicRows(c, l) : []), [c, l]);
  const totals = useMemo(() => (c && l ? syllabusTotals(c, l) : null), [c, l]);
  const byLos = useMemo(() => logsByLos(logs.data ?? []), [logs.data]);

  // Replace, not push: switching views is not a place Back should return to.
  const setView = (v: string) => {
    if (!v) return;
    const next = new URLSearchParams(params.toString());
    if (v === "map") next.delete("view");
    else next.set("view", v);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  const openOutcome = useCallback((id: string) => setLos(id), [setLos]);

  const states = [plan, curriculum, logs].map(regionState);
  const failed = states.find((s) => s.error)?.error;
  const retry = () => void (plan.isError ? plan.refetch() : curriculum.isError ? curriculum.refetch() : logs.refetch());

  if (!data) {
    if (failed) {
      return (
        <Shell>
          <h1 className="text-[26px] font-semibold tracking-tight">Syllabus</h1>
          <RegionError error={failed} online={online} onRetry={retry} />
        </Shell>
      );
    }
    return <SyllabusSkeleton />;
  }

  if (data.c.topics.length === 0) {
    return (
      <Shell>
        <h1 className="text-[26px] font-semibold tracking-tight">Syllabus</h1>
        <div className="flex flex-col items-start gap-3 py-8">
          <p className="text-[14px]">Your level&apos;s topics will appear here once the curriculum loads.</p>
          <Button variant="outline" size="sm" onClick={() => void curriculum.refetch()}>
            Load it again
          </Button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <header className="flex flex-col gap-1">
        <h1 className="text-[26px] font-semibold tracking-tight">Syllabus</h1>
        <p className="text-[14px]">
          <span className="text-[20px] font-semibold tabular-nums">{pct.format(totals!.coverage)}%</span>{" "}
          <span className="text-muted-foreground">of exam weight covered, each topic counted by its official weight</span>
        </p>
        <p className="text-[14px]">
          {totals!.accuracy === null ? (
            <span className="text-muted-foreground">No questions answered yet</span>
          ) : (
            <>
              <span className="text-[20px] font-semibold tabular-nums">{pct.format(totals!.accuracy)}%</span>{" "}
              <span className="text-muted-foreground tabular-nums">
                question accuracy over {totals!.answered.toLocaleString("en")} answered
              </span>
            </>
          )}
        </p>
        {!online ? <OfflineLine /> : null}
        {failed ? <RegionError error={failed} online={online} onRetry={retry} /> : null}
      </header>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl.Root
          type="single"
          value={view}
          onValueChange={setView}
          aria-label="View"
          className="border-border h-9 rounded-md border bg-transparent p-0.5 max-md:h-11"
        >
          {VIEWS.map((v) => (
            <SegmentedControl.Item
              key={v.value}
              value={v.value}
              className="data-[state=on]:bg-accent h-full rounded-sm px-3 text-[13px] data-[state=on]:font-semibold"
            >
              {v.label}
            </SegmentedControl.Item>
          ))}
        </SegmentedControl.Root>
        {view !== "3d" ? <MapKey /> : null}
      </div>

      <div className="mt-4">
        {view === "map" ? (
          <>
            <SyllabusMap tree={tree} onOutcome={openOutcome} />
            <p className="text-muted-foreground mt-2 text-[12px]">
              Area is exam weight. Inside a topic every outcome counts the same.
            </p>
          </>
        ) : view === "table" ? (
          <SyllabusTable rows={rows} byLos={byLos} />
        ) : (
          <ThreeD rows={rows} onTable={() => setView("table")} onTopic={(id) => router.push(`/syllabus/${encodeURIComponent(id)}`)} />
        )}
      </div>
    </Shell>
  );
}

function ThreeD({
  rows,
  onTable,
  onTopic,
}: {
  rows: ReturnType<typeof topicRows>;
  onTable: () => void;
  onTopic: (id: string) => void;
}) {
  const [supported] = useState(() => {
    if (typeof window === "undefined") return true;
    try {
      const canvas = document.createElement("canvas");
      return !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
    } catch {
      return false;
    }
  });
  const topics = useMemo(() => toCoverage(rows), [rows]);
  const readingCounts = useMemo(() => new Map(rows.map((r) => [r.id, r.readings.length])), [rows]);

  if (!supported) {
    return (
      <div className="flex flex-col items-start gap-3 py-8">
        <p className="text-[14px]">This device cannot draw the 3D view. The table has the same numbers.</p>
        <Button variant="outline" size="sm" onClick={onTable}>
          Show the table
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <Massif topics={topics} readingCounts={readingCounts} onSelect={onTopic} />
      <p className="text-muted-foreground text-[12px]">
        Each stack is a topic, as wide as its share of the exam. Each disc is a reading, filled once covered. Drag to
        orbit, tap a stack to open it. The{" "}
        <button
          type="button"
          onClick={onTable}
          className="text-claimed-ink focus-visible:ring-ring rounded-sm underline underline-offset-4 outline-hidden focus-visible:ring-2"
        >
          table
        </button>{" "}
        has the same numbers.
      </p>
    </div>
  );
}

function SyllabusSkeleton() {
  return (
    <Shell>
      <div aria-busy="true" aria-label="Loading the syllabus" className="flex flex-col gap-1">
        <Skeleton className="h-8 w-40 rounded-sm" />
        <Skeleton className="mt-1 h-6 w-80 max-w-full rounded-sm" />
        <Skeleton className="h-6 w-72 max-w-full rounded-sm" />
        <div className="mt-6 flex items-center justify-between">
          <Skeleton className="h-9 w-44 rounded-md" />
          <Skeleton className="h-4 w-48 rounded-sm max-sm:hidden" />
        </div>
        {/* The map's own shape: a few large blocks, data marks square. */}
        <div className="mt-4 grid h-[400px] grid-cols-[3fr_2fr] grid-rows-3 gap-0.5 md:h-[480px]">
          <Skeleton className="row-span-2 rounded-none" />
          <Skeleton className="rounded-none" />
          <Skeleton className="row-span-2 rounded-none" />
          <Skeleton className="rounded-none" />
        </div>
      </div>
    </Shell>
  );
}
