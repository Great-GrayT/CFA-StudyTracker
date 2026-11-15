"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CartesianGrid, ComposedChart, Line, Scatter, Tooltip, XAxis, YAxis } from "recharts";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { keys, useMocks, usePackages } from "@/lib/hooks";
import { usePaged } from "@/lib/paging";
import type { MockExam } from "@/lib/types";
import { OfflineLine, RegionError, regionState } from "@/components/states/region-states";
import { TruncatedText } from "@/components/states/truncated-text";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AddMockDialog } from "./add-mock-dialog";
import { Pager } from "./pager";

const pct = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });
const plural = new Intl.PluralRules("en");
const examWord = (n: number) => (plural.select(n) === "one" ? "mock" : "mocks");
const dayFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const monthFmt = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
const dayOf = (m: MockExam) => new Date(`${m.date.slice(0, 10)}T00:00:00Z`);

// Shape, not colour, tells packages apart: blue stays the one accent.
const SHAPES = ["circle", "square", "triangle", "diamond", "cross", "star", "wye"] as const;
type Shape = (typeof SHAPES)[number];
const chartConfig = { score: { label: "Score", color: "var(--claimed)" } } satisfies ChartConfig;

export function MocksTab({ planId, online }: { planId: string; online: boolean }) {
  const mocks = useMocks(planId);
  const packages = usePackages();
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<MockExam | null>(null);

  const names = useMemo(() => new Map((packages.data ?? []).map((p) => [p.id, p.name])), [packages.data]);
  const newestFirst = useMemo(
    () => [...(mocks.data ?? [])].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)),
    [mocks.data],
  );
  // A full campaign ends with a lot of these.
  const paged = usePaged(newestFirst, 10);
  const state = regionState(mocks);

  const addButton = (
    <Button size="sm" onClick={() => setAdding(true)}>
      Add mock
    </Button>
  );

  let body: React.ReactNode;
  if (!mocks.data) {
    body = state.error ? (
      <RegionError error={state.error} online={online} onRetry={() => void mocks.refetch()} />
    ) : (
      <MocksSkeleton />
    );
  } else if (mocks.data.length === 0) {
    body = (
      <div className="flex flex-col items-start gap-3 py-8">
        <p className="text-[14px]">Your mock scores and their trend appear here once you add the first one.</p>
        {addButton}
      </div>
    );
  } else {
    const packageName = (id: string | null) => (id ? (names.get(id) ?? "Unknown package") : "No package");
    body = (
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="font-prose text-[20px] leading-snug text-balance md:text-[26px]">{summaryText(newestFirst)}</p>
            {!online ? <OfflineLine /> : null}
          </div>
          {addButton}
        </div>
        {state.error ? <RegionError error={state.error} online={online} onRetry={() => void mocks.refetch()} /> : null}
        <MockChart exams={newestFirst} packageName={packageName} />
        <section aria-labelledby="mocks-table" className="border-border flex flex-col gap-3 border-t pt-6">
          <h2 id="mocks-table" className="text-[16px] font-semibold">
            Every mock
          </h2>
          <Table className="table-fixed text-[13px] tabular-nums">
            <caption className="sr-only">Mock exams, newest first</caption>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-9 w-28 px-0 text-[12px]">Date</TableHead>
                <TableHead className="h-9 w-16 text-right text-[12px]">Score</TableHead>
                <TableHead className="h-9 text-[12px]">Package</TableHead>
                <TableHead className="h-9 text-[12px] max-md:hidden">Note</TableHead>
                <TableHead className="h-9 w-11 px-0 text-[12px]">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.slice.map((m) => (
                <TableRow key={m.id} className="h-9 hover:bg-transparent max-md:h-11">
                  <TableHead scope="row" className="text-foreground h-auto px-0 font-normal">
                    {dayFmt.format(dayOf(m))}
                  </TableHead>
                  <TableCell className="text-right font-medium">{pct.format(m.scorePercent)}%</TableCell>
                  <TableCell className="min-w-0">
                    <span className="flex min-w-0">
                      <TruncatedText text={packageName(m.packageId)} />
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground min-w-0 max-md:hidden">
                    <span className="flex min-w-0">{m.note ? <TruncatedText text={m.note} /> : null}</span>
                  </TableCell>
                  <TableCell className="px-0 text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-alarm-ink size-8 max-md:size-11"
                      aria-label={`Delete the mock of ${dayFmt.format(dayOf(m))}`}
                      onClick={() => setDeleting(m)}
                    >
                      <Trash2 />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pager paged={paged} label="Mocks" />
        </section>
      </div>
    );
  }

  return (
    <>
      {body}
      <AddMockDialog planId={planId} open={adding} onOpenChange={setAdding} />
      <DeleteMockDialog planId={planId} mock={deleting} onClose={() => setDeleting(null)} />
    </>
  );
}

function summaryText(newestFirst: MockExam[]): string {
  const last = newestFirst[0];
  if (newestFirst.length === 1) return `Last ${pct.format(last.scorePercent)}%, your first mock so far.`;
  const first = newestFirst[newestFirst.length - 1];
  const delta = Math.round(last.scorePercent - first.scorePercent);
  const move = delta === 0 ? "level" : `${delta > 0 ? "up" : "down"} ${Math.abs(delta)} points`;
  return `Last ${pct.format(last.scorePercent)}%, ${move} across ${newestFirst.length} ${examWord(newestFirst.length)} since ${monthFmt.format(dayOf(first))}.`;
}

type Point = { t: number; score: number; date: string; pkg: string };

function MockChart({ exams, packageName }: { exams: MockExam[]; packageName: (id: string | null) => string }) {
  const { points, groups } = useMemo(() => {
    const oldestFirst = [...exams].reverse();
    const points: Point[] = oldestFirst.map((m) => ({
      t: dayOf(m).getTime(),
      score: m.scorePercent,
      date: dayFmt.format(dayOf(m)),
      pkg: packageName(m.packageId),
    }));
    const byPkg = new Map<string, Point[]>();
    for (const p of points) byPkg.set(p.pkg, [...(byPkg.get(p.pkg) ?? []), p]);
    const groups = [...byPkg].map(([name, data], i) => ({ name, data, shape: SHAPES[i % SHAPES.length] as Shape }));
    return { points, groups };
  }, [exams, packageName]);

  const first = points[0];
  const last = points[points.length - 1];
  // Pad a lone point so the axis has a span to sit in.
  const span = Math.max(last.t - first.t, 14 * 86_400_000);
  const pad = span * 0.05;

  return (
    <figure className="flex flex-col gap-2">
      <ChartContainer
        config={chartConfig}
        className="aspect-auto h-[200px] w-full md:h-[240px]"
        role="img"
        aria-label={`Mock scores, ${points.length} ${examWord(points.length)}, from ${pct.format(first.score)}% on ${first.date} to ${pct.format(last.score)}% on ${last.date}.`}
      >
        <ComposedChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid vertical={false} stroke="var(--rule)" />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={[first.t - pad, last.t + pad]}
            tickFormatter={(t: number) => monthFmt.format(new Date(t))}
            tickLine={false}
            axisLine={{ stroke: "var(--rule-strong)" }}
            minTickGap={32}
            fontSize={12}
          />
          <YAxis
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 100]}
            tickLine={false}
            axisLine={false}
            fontSize={12}
            tickFormatter={(v: number) => `${v}`}
          />
          <Tooltip
            cursor={false}
            isAnimationActive={false}
            content={({ active, payload }) => {
              const p = active ? (payload?.[0]?.payload as Point | undefined) : undefined;
              if (!p) return null;
              return (
                <div className="bg-popover border-border rounded-lg border px-2.5 py-1.5 text-[12px] tabular-nums shadow-[var(--shadow-float)]">
                  <div className="font-medium">{pct.format(p.score)}%</div>
                  <div className="text-muted-foreground">
                    {p.date}, {p.pkg}
                  </div>
                </div>
              );
            }}
          />
          {/* One line through every mock, oldest first: the trend is the candidate's, not a package's. */}
          {points.length > 1 ? (
            <Line
              dataKey="score"
              type="linear"
              stroke="var(--rule-strong)"
              strokeWidth={1.5}
              strokeDasharray={points.length === 2 ? "4 3" : undefined}
              dot={false}
              activeDot={false}
              isAnimationActive={false}
            />
          ) : null}
          {groups.map((g) => (
            <Scatter
              key={g.name}
              name={g.name}
              data={g.data}
              dataKey="score"
              shape={g.shape}
              fill="var(--color-score)"
              isAnimationActive={false}
            />
          ))}
        </ComposedChart>
      </ChartContainer>
      <ul className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
        {groups.map((g) => (
          <li key={g.name} className="flex min-w-0 items-center gap-1.5">
            <ShapeMark shape={g.shape} />
            <span className="truncate">{g.name}</span>
          </li>
        ))}
        {points.length === 1 ? <li>One mock is a data point, not a trend yet.</li> : null}
      </ul>
    </figure>
  );
}

/** The legend's copy of each scatter shape, drawn the way recharts' Symbols draws it. */
function ShapeMark({ shape }: { shape: Shape }) {
  const d: Record<Shape, string> = {
    circle: "M5 1a4 4 0 1 0 0.01 0Z",
    square: "M1 1h8v8H1Z",
    triangle: "M5 1L9 9H1Z",
    diamond: "M5 0L9 5L5 10L1 5Z",
    cross: "M3.5 1h3v2.5H9v3H6.5V9h-3V6.5H1v-3h2.5Z",
    star: "M5 0.5L6.2 3.7L9.6 3.8L6.9 5.9L7.9 9.2L5 7.3L2.1 9.2L3.1 5.9L0.4 3.8L3.8 3.7Z",
    wye: "M4 1h2v3.3l2.9 1.7-1 1.7L5 6l-2.9 1.7-1-1.7L4 4.3Z",
  };
  return (
    <svg aria-hidden width="10" height="10" viewBox="0 0 10 10" className="shrink-0">
      <path d={d[shape]} fill="var(--claimed)" />
    </svg>
  );
}

function DeleteMockDialog({ planId, mock, onClose }: { planId: string; mock: MockExam | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const del = useMutation({
    mutationFn: (id: string) => api.del<unknown>(`mock-exams/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.mocks(planId) }),
  });
  // Kept through the close animation, so the text does not blank as it fades.
  const [shown, setShown] = useState<MockExam | null>(null);
  if (mock && mock !== shown) setShown(mock);

  async function confirm() {
    if (!mock) return;
    try {
      await del.mutateAsync(mock.id);
      toast.success("Mock deleted");
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete that. The mock is still there.");
    }
  }

  return (
    <Dialog
      open={!!mock}
      onOpenChange={(o) => {
        if (!o) {
          setError(null);
          onClose();
        }
      }}
    >
      <DialogContent className="gap-5 sm:max-w-md">
        <DialogHeader className="text-left sm:text-left">
          <DialogTitle className="text-[20px] font-semibold">Delete this mock?</DialogTitle>
          <DialogDescription className="text-[13px] tabular-nums">
            {shown
              ? `${pct.format(shown.scorePercent)}% on ${dayFmt.format(dayOf(shown))} leaves your trend and table. This cannot be undone.`
              : null}
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="text-alarm-ink text-[13px]" role="alert">
            {error}
          </p>
        ) : null}
        <DialogFooter className="sm:justify-end">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => void confirm()} disabled={del.isPending}>
            {del.isPending ? "Deleting" : "Delete mock"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MocksSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading mocks" className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-3">
        <Skeleton className="h-7 w-96 max-w-full rounded-sm" />
        <Skeleton className="h-8 w-24 rounded-md" />
      </div>
      <Skeleton className="h-[200px] w-full rounded-none md:h-[240px]" />
      <div className="border-border flex flex-col gap-2 border-t pt-6">
        <Skeleton className="h-5 w-28 rounded-sm" />
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-9 w-full rounded-none" />
        ))}
      </div>
    </div>
  );
}
