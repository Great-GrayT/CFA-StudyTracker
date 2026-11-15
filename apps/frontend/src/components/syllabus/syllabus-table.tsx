"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Accordion as AccordionPrimitive } from "radix-ui";
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import { TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { LogEntry } from "@/lib/types";
import type { TopicRow } from "@/lib/syllabus";
import { StatusStrip } from "./status-strip";
import { TruncatedText } from "@/components/states/truncated-text";

const pct = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

type SortKey = "order" | "name" | "weight" | "coverage" | "accuracy";
type Sort = { key: SortKey; dir: "asc" | "desc" };

const mid = (r: TopicRow) => (r.weightMin + r.weightMax) / 2;
const frac = (r: TopicRow) => (r.total ? r.covered / r.total : 0);

function compare(a: TopicRow, b: TopicRow, key: SortKey, order: Map<string, number>): number {
  switch (key) {
    case "name":
      return a.name.localeCompare(b.name);
    case "weight":
      return mid(a) - mid(b);
    case "coverage":
      return frac(a) - frac(b);
    case "accuracy":
      return (a.accuracy ?? -1) - (b.accuracy ?? -1);
    default:
      return order.get(a.id)! - order.get(b.id)!;
  }
}

function SortHead({
  label,
  k,
  sort,
  onSort,
  className,
}: {
  label: string;
  k: SortKey;
  sort: Sort;
  onSort: (k: SortKey) => void;
  className?: string;
}) {
  const active = sort.key === k;
  const Icon = !active ? ChevronsUpDown : sort.dir === "asc" ? ChevronUp : ChevronDown;
  return (
    <TableHead
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      className={cn("h-9 px-2 text-left text-[12px] font-medium", className)}
    >
      <button
        type="button"
        onClick={() => onSort(k)}
        className="hover:text-foreground focus-visible:ring-ring -mx-1 inline-flex items-center gap-1 rounded-sm px-1 outline-hidden focus-visible:ring-2 max-md:min-h-11"
      >
        {label}
        <Icon aria-hidden="true" className={cn("size-3.5", !active && "opacity-50")} />
      </button>
    </TableHead>
  );
}

function CoverageBar({ covered, total }: { covered: number; total: number }) {
  return (
    <span className="flex items-center gap-2">
      <span aria-hidden="true" className="bg-border relative h-1.5 w-16 shrink-0 max-sm:hidden">
        <span className="bg-primary absolute inset-y-0 left-0" style={{ width: `${total ? (covered / total) * 100 : 0}%` }} />
      </span>
      <span className="tabular-nums">
        {covered} of {total}
      </span>
    </span>
  );
}

/**
 * Every topic as a row, readings behind each. The accessible twin of the map
 * and the home of what the weight-gap chart used to show.
 */
export function SyllabusTable({ rows, byLos }: { rows: TopicRow[]; byLos: Map<string, LogEntry[]> }) {
  const [sort, setSort] = useState<Sort>({ key: "order", dir: "asc" });
  const order = useMemo(() => new Map(rows.map((r, i) => [r.id, i])), [rows]);
  const sorted = useMemo(() => {
    const out = [...rows].sort((a, b) => compare(a, b, sort.key, order));
    return sort.dir === "desc" ? out.reverse() : out;
  }, [rows, sort, order]);

  const onSort = (key: SortKey) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : // Numbers start with the most at stake: heaviest, least covered, weakest.
          { key, dir: key === "weight" ? "desc" : "asc" },
    );

  return (
    <div className="w-full min-w-0 overflow-x-auto">
      {/* Radix Accordion on table parts: each topic is its own tbody, a trigger
          row plus a content row, which keeps the table semantics intact. */}
      <AccordionPrimitive.Root type="multiple" asChild>
        <table className="w-full table-fixed text-[13px]">
          <caption className="sr-only">
            Topics by exam weight, coverage and question accuracy. Expand a topic to see its readings.
          </caption>
          <colgroup>
            <col />
            <col className="w-24 max-sm:w-20" />
            <col className="w-32 max-sm:w-20" />
            <col className="w-20 max-sm:hidden" />
            <col className="w-[30%] max-lg:hidden" />
          </colgroup>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <SortHead label="Topic" k="name" sort={sort} onSort={onSort} />
              <SortHead label="Weight" k="weight" sort={sort} onSort={onSort} />
              <SortHead label="Coverage" k="coverage" sort={sort} onSort={onSort} />
              <SortHead label="Accuracy" k="accuracy" sort={sort} onSort={onSort} className="max-sm:hidden" />
              <TableHead className="h-9 px-2 text-left text-[12px] font-medium max-lg:hidden">Weakest reading</TableHead>
            </TableRow>
          </TableHeader>
          {sorted.map((r) => (
            <AccordionPrimitive.Item key={r.id} value={r.id} asChild>
              <tbody className="border-border group border-b">
                <tr className="hover:bg-accent/60">
                  <td className="p-0">
                    <AccordionPrimitive.Header asChild>
                      <div>
                        <AccordionPrimitive.Trigger className="focus-visible:ring-ring flex w-full min-w-0 items-center gap-1.5 px-2 py-2 text-left font-medium outline-hidden focus-visible:ring-2 focus-visible:ring-inset max-md:min-h-11 md:min-h-9">
                          <ChevronDown
                            aria-hidden="true"
                            className="text-muted-foreground size-3.5 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180 motion-reduce:transition-none"
                          />
                          <span className="min-w-0 truncate">{r.name}</span>
                        </AccordionPrimitive.Trigger>
                      </div>
                    </AccordionPrimitive.Header>
                  </td>
                  <td className="px-2 tabular-nums">
                    {r.weightMin} to {r.weightMax}%
                  </td>
                  <td className="px-2">
                    <CoverageBar covered={r.covered} total={r.total} />
                  </td>
                  <td className="px-2 tabular-nums max-sm:hidden">
                    {r.accuracy === null ? <span className="text-muted-foreground">None yet</span> : `${pct.format(r.accuracy)}%`}
                  </td>
                  <td className="min-w-0 px-2 max-lg:hidden">
                    {r.weakestReading ? (
                      <TruncatedText text={r.weakestReading.name} className="block" />
                    ) : (
                      <span className="text-muted-foreground">Nothing rated</span>
                    )}
                  </td>
                </tr>
                <tr>
                  <td colSpan={5} className="p-0">
                    <AccordionPrimitive.Content className="data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down overflow-hidden motion-reduce:animate-none">
                      <ul className="border-border mb-2 ml-6 border-l pl-3">
                        {/* The accuracy column is hidden on phones, and map tooltips need a pointer. */}
                        <li className="text-muted-foreground py-1 tabular-nums sm:hidden">
                          {r.accuracy === null
                            ? "No questions answered in this topic"
                            : `Accuracy ${pct.format(r.accuracy)}% over ${r.answered.toLocaleString("en")} answered`}
                        </li>
                        {r.readings.map(({ reading, covered, accuracy }) => (
                          <li
                            key={reading.id}
                            className="grid min-h-9 grid-cols-[minmax(0,1fr)_6rem_3.5rem] items-center gap-x-3 py-1 max-sm:grid-cols-[minmax(0,1fr)_3.5rem]"
                          >
                            <TruncatedText text={reading.name} className="block" />
                            <span className="max-sm:hidden">
                              <StatusStrip reading={reading} byLos={byLos} />
                            </span>
                            <span className="text-right tabular-nums">
                              {covered}/{reading.los.length}
                              <span className="sr-only">
                                {" "}
                                covered
                                {accuracy === null ? "" : `, accuracy ${pct.format(accuracy)}%`}
                              </span>
                            </span>
                          </li>
                        ))}
                        <li className="pt-1">
                          <Link
                            href={`/syllabus/${encodeURIComponent(r.id)}`}
                            className="text-claimed-ink focus-visible:ring-ring rounded-sm underline underline-offset-4 outline-hidden focus-visible:ring-2"
                          >
                            Open {r.name}
                          </Link>
                        </li>
                      </ul>
                    </AccordionPrimitive.Content>
                  </td>
                </tr>
              </tbody>
            </AccordionPrimitive.Item>
          ))}
        </table>
      </AccordionPrimitive.Root>
    </div>
  );
}
