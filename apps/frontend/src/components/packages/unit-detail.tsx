import { Check, CircleDashed, CircleDot } from "lucide-react";
import type { CoverageUnit, VideoStatus } from "@/lib/coverage-types";
import { accuracyPct, pctLabel, questionChips } from "@/lib/coverage-view";
import { formatQuestionNumbers } from "@/lib/question-numbers";
import { cn } from "@/lib/utils";

const STATUS: Record<VideoStatus, { label: string; Icon: typeof Check; cls: string }> = {
  watched: { label: "Watched", Icon: Check, cls: "text-strong" },
  partial: { label: "Partly watched", Icon: CircleDot, cls: "text-gate" },
  "not-started": { label: "Not started", Icon: CircleDashed, cls: "text-muted-foreground" },
};

function minutes(seconds: number) {
  return `${Math.max(1, Math.round(seconds / 60))} min`;
}

function QuestionGrid({ q }: { q: CoverageUnit["questions"] }) {
  if (q.total === 0) return <p className="text-muted-foreground text-[13px]">This unit has no question set.</p>;
  const chips = questionChips(q.total, q.numbered);
  const summary =
    q.left === null
      ? `${q.answered} of ${q.total} answered. Some answers were recorded without question numbers, so the exact remaining numbers are unknown.`
      : `${q.answered} of ${q.total} answered. ${q.left.length === 0 ? "None left." : `Left: ${formatQuestionNumbers(q.left)}.`}`;
  return (
    <div className="space-y-2">
      <p className="text-[13px]">{summary}</p>
      {q.numbered.length > 0 ? (
        <>
          <ul
            aria-label="Question numbers"
            className="flex max-h-48 flex-wrap gap-1 overflow-y-auto"
          >
            {chips.map((c) => (
              <li
                key={c.n}
                className={cn(
                  "min-w-7 px-1 text-center text-[11.5px] leading-6 tabular-nums",
                  c.answered
                    ? "bg-claimed text-primary-foreground font-medium"
                    : "border-rule-strong text-muted-foreground border border-dashed",
                )}
              >
                <span className="sr-only">{c.answered ? "Answered: " : q.left === null ? "Not recorded: " : "Left: "}</span>
                {c.n}
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground text-[12px]">{q.left === null ? "Filled numbers are answered, dashed ones have no answer recorded by number." : "Filled numbers are answered, dashed ones are left."}</p>
        </>
      ) : null}
    </div>
  );
}

export function UnitDetail({ unit }: { unit: CoverageUnit }) {
  const hasLos = unit.los.length > 0;
  return (
    <section className="border-border space-y-4 border-t py-4 first:border-t-0" aria-labelledby={`u-${unit.unitId}`}>
      <div>
        <h4 id={`u-${unit.unitId}`} className="text-[14px] font-semibold">
          {unit.ref ? `${unit.ref} ` : ""}
          {unit.title}
        </h4>
        {unit.readingNames.length > 0 ? (
          <p className="text-muted-foreground text-[12.5px]">{unit.readingNames.join(", ")}</p>
        ) : null}
      </div>

      {unit.videos.length > 0 ? (
        <div>
          <h5 className="mb-1 text-[13px] font-medium">Videos</h5>
          <ul className="divide-border divide-y">
            {unit.videos.map((v) => {
              const st = STATUS[v.status];
              return (
                <li key={v.resourceId} className="flex min-h-9 items-center gap-2 py-1 text-[13px]">
                  <st.Icon aria-hidden="true" className={cn("size-4 shrink-0", st.cls)} />
                  <span className="min-w-0 flex-1 truncate" title={v.title}>
                    {v.title}
                  </span>
                  <span className="text-muted-foreground shrink-0 tabular-nums">{minutes(v.seconds)}</span>
                  <span className={cn("w-28 shrink-0 text-right", st.cls)}>{st.label}</span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <div>
        <h5 className="mb-1 text-[13px] font-medium">Questions</h5>
        <QuestionGrid q={unit.questions} />
      </div>

      {hasLos ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-[13px]">
            <caption className="mb-1 text-left text-[13px] font-medium">Learning outcomes</caption>
            <thead>
              <tr className="border-border text-muted-foreground border-b text-left text-[12px]">
                <th scope="col" className="py-1 pr-3 font-normal">Outcome</th>
                <th scope="col" className="py-1 pr-3 font-normal">Text</th>
                <th scope="col" className="py-1 pr-3 text-right font-normal">Questions</th>
                <th scope="col" className="py-1 pr-3 text-right font-normal">Answered</th>
                <th scope="col" className="py-1 text-right font-normal">Accuracy</th>
              </tr>
            </thead>
            <tbody>
              {unit.los.map((l, i) => (
                <tr key={l.losId ?? i} className="border-border border-b last:border-b-0">
                  <th scope="row" className="py-1.5 pr-3 text-left font-medium whitespace-nowrap">{l.label}</th>
                  <td className="max-w-[28ch] truncate py-1.5 pr-3" title={l.text}>{l.text}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{l.questionCount ?? "Unknown"}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{l.answered}</td>
                  <td className="py-1.5 text-right tabular-nums">{pctLabel(accuracyPct(l.correct, l.answered))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
