"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { CoveragePackage, CoverageTopic } from "@/lib/coverage-types";
import { accuracyPct, hoursLabel, pctLabel } from "@/lib/coverage-view";
import { Bar } from "./bar";
import { UnitDetail } from "./unit-detail";

const focus = "focus-visible:ring-ring rounded-sm outline-hidden focus-visible:ring-2";

function Figure({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground text-[12.5px]">{label}</dt>
      <dd className="text-[22px] leading-tight font-semibold tabular-nums">{value}</dd>
      {sub ? <dd className="text-muted-foreground text-[12.5px]">{sub}</dd> : null}
    </div>
  );
}

function Summary({ pkg }: { pkg: CoveragePackage }) {
  const { videos: v, questions: q } = pkg;
  const unnumbered = Math.max(0, q.answered - q.numbered);
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4">
      {v.count > 0 ? (
        <Figure
          label="Videos watched"
          value={`${v.watched} of ${v.count}`}
          sub={`${hoursLabel(v.seconds - v.watchedSeconds)} left`}
        />
      ) : (
        <Figure label="Videos" value="None" sub="No videos in this package" />
      )}
      {q.total > 0 ? (
        <>
          <Figure
            label="Questions answered"
            value={`${q.answered} of ${q.total}`}
            sub={`${Math.max(0, q.total - q.answered)} left`}
          />
          <Figure label="Accuracy" value={pctLabel(accuracyPct(q.correct, q.answered))} sub={`${q.correct} correct`} />
          <Figure
            label="Tracked by number"
            value={`${q.numbered} of ${q.answered}`}
            sub={unnumbered > 0 ? `${unnumbered} without numbers` : "All numbered"}
          />
        </>
      ) : (
        <Figure label="Questions" value="None" sub="No question bank" />
      )}
    </dl>
  );
}

function TopicRows({ topic, showV, showQ }: { topic: CoverageTopic; showV: boolean; showQ: boolean }) {
  const [open, setOpen] = useState(false);
  const { videos: v, questions: q } = topic;
  const panelId = `topic-${topic.topicId}`;
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <>
      <tr className="border-border border-b align-middle">
        <th scope="row" className="py-1 pr-3 text-left font-normal">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((o) => !o)}
            className={`${focus} flex min-h-11 w-full items-center gap-2 text-left text-[14px] font-medium md:min-h-9`}
          >
            <Chevron aria-hidden="true" className="text-muted-foreground size-4 shrink-0" />
            <span className="min-w-0">{topic.name}</span>
          </button>
        </th>
        {showV ? (
          <td className="py-2 pr-4">
            <div className="text-[13px] tabular-nums">
              {v.watched} of {v.count}
            </div>
            <Bar n={v.watchedSeconds} of={v.seconds} className="mt-1 w-24" />
          </td>
        ) : null}
        {showQ ? (
          <>
            <td className="py-2 pr-4">
              <div className="text-[13px] tabular-nums">
                {q.answered} of {q.total}
              </div>
              <Bar n={q.answered} of={q.total} className="mt-1 w-24" />
            </td>
            <td className="py-2 text-right text-[13px] tabular-nums">{pctLabel(accuracyPct(q.correct, q.answered))}</td>
          </>
        ) : null}
      </tr>
      {open ? (
        <tr id={panelId} className="border-border border-b">
          <td colSpan={1 + (showV ? 1 : 0) + (showQ ? 2 : 0)} className="pb-2 pl-6">
            {topic.units.length === 0 ? (
              <p className="text-muted-foreground py-3 text-[13px]">This package has no units for this topic.</p>
            ) : (
              topic.units.map((u) => <UnitDetail key={u.unitId} unit={u} />)
            )}
          </td>
        </tr>
      ) : null}
    </>
  );
}

export function PackageView({ pkg }: { pkg: CoveragePackage }) {
  const showV = pkg.videos.count > 0;
  const showQ = pkg.questions.total > 0;
  return (
    <div className="space-y-6">
      <Summary pkg={pkg} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[360px]">
          <caption className="sr-only">{pkg.name} coverage by topic</caption>
          <thead>
            <tr className="border-border text-muted-foreground border-b text-left text-[12.5px]">
              <th scope="col" className="py-1.5 pr-3 font-normal">
                Topic
              </th>
              {showV ? (
                <th scope="col" className="py-1.5 pr-4 font-normal">
                  Videos
                </th>
              ) : null}
              {showQ ? (
                <>
                  <th scope="col" className="py-1.5 pr-4 font-normal">
                    Questions
                  </th>
                  <th scope="col" className="py-1.5 text-right font-normal">
                    Accuracy
                  </th>
                </>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {[...pkg.topics]
              .sort((a, b) => a.order - b.order)
              .map((t) => (
                <TopicRows key={t.topicId} topic={t} showV={showV} showQ={showQ} />
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
