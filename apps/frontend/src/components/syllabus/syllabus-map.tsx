"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useAtom } from "jotai";
import { Treemap, drillDownPathAtom, type TreemapDataItem, type TreemapNode } from "@/components/ui/tree-map";
import { useIsMobile } from "@/hooks/ui/use-mobile";
import { cellLabel, confidenceFill, weightLine, type NodeMeta } from "@/lib/syllabus";

const pct = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });
const STAGGER_MS = 40;
const REVEAL_MS = 240;

/** 45 degree hatch of --rule-strong on --raised: untouched, never a low rating. */
export const HATCH: CSSProperties = {
  backgroundColor: "var(--raised)",
  backgroundImage: "repeating-linear-gradient(45deg, var(--rule-strong) 0 1px, transparent 1px 7px)",
};

export function fillStyle(confidence: number | null): CSSProperties {
  const fill = confidenceFill(confidence);
  return fill === "untouched" ? HATCH : { backgroundColor: fill };
}

function inkFor(confidence: number | null): string {
  const fill = confidenceFill(confidence);
  return fill === "untouched" ? "var(--text)" : fill.replace("--conf-", "--conf-ink-");
}

const accuracyText = (m: NodeMeta) =>
  m.accuracy === null ? "No questions answered" : `Accuracy ${pct.format(m.accuracy)}%`;

function describe(node: TreemapNode): string {
  const m = node.metadata as NodeMeta;
  const parts = [node.name];
  parts.push(weightLine(m));
  parts.push(m.kind === "los" ? (m.covered ? "covered" : "not started") : `covered ${m.covered} of ${m.total}`);
  parts.push(accuracyText(m).toLowerCase());
  if (m.kind === "los") parts.push("opens the outcome");
  return parts.join(", ");
}

function Cell({ node }: { node: TreemapNode }) {
  const m = node.metadata as NodeMeta;
  // 12px of inner padding comes off the width a label may use.
  const label = node.height >= 22 ? cellLabel(node.name, node.width - 12) : null;
  return (
    <div className="absolute inset-0" style={fillStyle(m.confidence)}>
      {label ? (
        <div className="flex flex-col gap-0.5 p-1.5 text-left" style={{ color: inkFor(m.confidence) }}>
          <span className="text-[12px] leading-tight font-medium">{label}</span>
          {m.kind !== "los" && node.height >= 44 && node.width >= 72 ? (
            <span className="text-[12px] leading-tight tabular-nums opacity-90">
              {m.covered} of {m.total}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Tip({ node }: { node: TreemapNode }) {
  const m = node.metadata as NodeMeta;
  return (
    <div className="flex max-w-xs flex-col gap-0.5 text-[12px]">
      <span className={m.kind === "los" ? "font-prose text-[14px] leading-snug" : "font-medium"}>{node.name}</span>
      <span className="tabular-nums">{weightLine(m)}</span>
      <span className="tabular-nums">
        {m.kind === "los" ? (m.covered ? "Covered" : "Not started") : `Covered ${m.covered} of ${m.total}`}
      </span>
      <span className="tabular-nums">{accuracyText(m)}</span>
    </div>
  );
}

export function SyllabusMap({
  tree,
  onOutcome,
}: {
  tree: TreemapDataItem[];
  onOutcome: (losId: string) => void;
}) {
  const isMobile = useIsMobile();
  const wrap = useRef<HTMLDivElement>(null);
  const [path, setPath] = useAtom(drillDownPathAtom);

  // A path from an older tree (another level) would show nothing.
  useEffect(() => {
    if (path.length === 0) return;
    const ids = new Set<string>();
    const walk = (nodes: TreemapDataItem[]) => nodes.forEach((n) => (ids.add(n.id), n.children && walk(n.children)));
    walk(tree);
    if (!path.every((id) => ids.has(id))) setPath([]);
  }, [tree, path, setPath]);

  // The one orchestrated reveal: once per mount, topics only. Reduced motion
  // is honoured in CSS, so the first paint is already still.
  const [revealing, setRevealing] = useState(path.length === 0);
  useEffect(() => {
    if (!revealing) return;
    const id = window.setTimeout(() => setRevealing(false), tree.length * STAGGER_MS + REVEAL_MS);
    return () => window.clearTimeout(id);
  }, [revealing, tree.length]);

  // Drilling replaces every cell, which drops focus; hand it to the first new one.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const id = requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active && active !== document.body && wrap.current?.contains(active) && active.isConnected) return;
      wrap.current?.querySelector<HTMLElement>('[data-slot="treemap-cell"]')?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [path]);

  const topicId = path[0];

  const config = useMemo(
    () => ({
      height: isMobile ? 400 : 480,
      minCellSize: 0,
      padding: 0,
      borderRadius: 0,
      animationEnabled: false,
      selectable: false,
      showTooltip: true,
      showBreadcrumb: true,
      enableDrillDown: true,
      enableKeyboardNavigation: true,
      rootLabel: "All topics",
      ariaLabel: "Syllabus map. Area is exam weight, fill is confidence.",
      getAriaLabel: describe,
      renderCell: (node: TreemapNode) => <Cell node={node} />,
      renderTooltip: (node: TreemapNode) => <Tip node={node} />,
      cellStyle: (_node: TreemapNode, index: number) =>
        ({ ["--reveal-delay" as string]: `${index * STAGGER_MS}ms` }) as CSSProperties,
      onCellClick: (node: TreemapNode) => {
        if ((node.metadata as NodeMeta).kind === "los") onOutcome(node.id);
      },
    }),
    [isMobile, onOutcome],
  );

  return (
    <div ref={wrap} data-reveal={revealing ? "" : undefined} className="relative min-w-0">
      {/* Root level has no breadcrumb; this keeps the map from jumping when one appears. */}
      <div className="flex min-h-7 items-center justify-between gap-3">
        {path.length === 0 ? (
          <p className="text-muted-foreground text-[13px]">Choose a topic to see its readings.</p>
        ) : (
          <span />
        )}
        {topicId ? (
          <Link
            href={`/syllabus/${encodeURIComponent(topicId)}`}
            className="text-claimed-ink focus-visible:ring-ring inline-flex shrink-0 items-center rounded-sm text-[13px] underline underline-offset-4 outline-hidden focus-visible:ring-2 max-md:min-h-11"
          >
            Open topic page
          </Link>
        ) : null}
      </div>
      <Treemap data={tree} config={config} />
    </div>
  );
}

/** The ramp and hatch, keyed in words. */
export function MapKey() {
  return (
    <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
      <span className="flex items-center gap-1.5">
        <span aria-hidden="true" className="border-input size-3 border" style={HATCH} />
        Not started
      </span>
      <span className="flex items-center gap-1.5">
        Less sure
        <span aria-hidden="true" className="flex">
          {[1, 2, 3, 4].map((s) => (
            <span key={s} className="size-3" style={{ backgroundColor: `var(--conf-${s})` }} />
          ))}
        </span>
        More sure
      </span>
    </div>
  );
}
