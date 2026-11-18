"use client";

import { useId, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatValue } from "@/components/today/question-stats";
import {
  answersText,
  CONF_WORD,
  dayText,
  minutesText,
  rateIsMet,
  rateText,
  recordKey,
  recordWhen,
  roundWord,
  sourceOf,
  STEP_STATUS_WORD,
  STEP_TITLES,
  stepMinutes,
  stepStats,
} from "@/lib/history";
import { cn } from "@/lib/utils";
import type { HistoryMock, HistoryRecord, HistoryStep } from "@/lib/types";

export type RecordAction = (rec: HistoryRecord, step: HistoryStep) => void;

/** The four steps of one module as a quiet list; each opens onto its records, newest first. */
export function ModuleSteps({
  steps,
  onEdit,
  onDelete,
}: {
  steps: HistoryStep[];
  onEdit: RecordAction;
  onDelete: RecordAction;
}) {
  return (
    <ul className="border-border border-t">
      {[...steps]
        .sort((a, b) => a.step - b.step)
        .map((s) => (
          <StepRow key={s.step} step={s} onEdit={onEdit} onDelete={onDelete} />
        ))}
    </ul>
  );
}

function StepRow({ step, onEdit, onDelete }: { step: HistoryStep; onEdit: RecordAction; onDelete: RecordAction }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const stats = stepStats(step);
  const round = roundWord(step);
  const title = STEP_TITLES[step.step];
  const count = step.records.length;

  return (
    <li className="border-border border-b">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className="focus-visible:ring-ring hover:bg-accent/50 flex min-h-11 w-full flex-wrap items-center gap-x-4 gap-y-0.5 px-1 py-2 text-left outline-hidden focus-visible:ring-2 focus-visible:ring-inset md:min-h-10"
      >
        <span className="flex min-w-0 items-center gap-2 lg:w-52">
          <ChevronRight
            aria-hidden="true"
            className={cn(
              "text-muted-foreground size-4 shrink-0 transition-transform duration-(--dur-move) motion-reduce:transition-none",
              open && "rotate-90",
            )}
          />
          <span className="text-[14px]">
            <span className="text-muted-foreground tabular-nums">{step.step} </span>
            {title}
          </span>
        </span>
        <span
          className={cn(
            "w-28 shrink-0 text-[13px]",
            step.status === "not-started" ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {STEP_STATUS_WORD[step.status]}
          {round ? <span className="text-muted-foreground tabular-nums">, {round.toLowerCase()}</span> : null}
        </span>
        <span className="text-muted-foreground w-28 shrink-0 text-[13px] tabular-nums">{stepMinutes(step)}</span>
        <span className="text-muted-foreground ml-auto text-[13px] tabular-nums">
          {count === 0 ? "No records" : `${count} record${count === 1 ? "" : "s"}`}
        </span>
      </button>
      {/* Outside the toggle: the values are focusable for their tooltips, and a control cannot nest one. */}
      {stats ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 pb-2 pl-7 text-[13px] tabular-nums">
          <StatValue stat={stats.progress} />
          {stats.round ? <StatValue stat={stats.round} /> : null}
          {stats.overall ? <StatValue stat={stats.overall} /> : null}
        </div>
      ) : null}
      <div id={panelId} hidden={!open}>
        {open ? (
          count === 0 ? (
            <p className="text-muted-foreground pb-3 pl-7 text-[13px]">Nothing recorded for this step yet.</p>
          ) : (
            <ul className="pb-2 pl-7">
              {step.records.map((rec) => (
                <RecordRow
                  key={recordKey(rec)}
                  rec={rec}
                  onEdit={() => onEdit(rec, step)}
                  onDelete={() => onDelete(rec, step)}
                />
              ))}
            </ul>
          )
        ) : null}
      </div>
    </li>
  );
}

const SOURCE_STYLE = {
  recorded: "text-foreground",
  self: "text-claimed-ink",
  "off-plan": "text-muted-foreground",
  extra: "text-foreground",
} as const;

function RecordRow({ rec, onEdit, onDelete }: { rec: HistoryRecord; onEdit: () => void; onDelete: () => void }) {
  const source = sourceOf(rec);
  const when = recordWhen(rec);
  const detail: { label: string; value: React.ReactNode }[] = [];

  if (rec.type === "task") {
    detail.push({ label: "Time", value: minutesText(rec) });
    const a = answersText(rec);
    if (a) detail.push({ label: "Answers", value: <AnswerRate text={a} correct={rec.correct} answered={rec.answered} /> });
    if (rec.answerReviewDone) {
      detail.push({
        label: "Answer review",
        value: rec.answerReviewMinutes ? `done, ${rec.answerReviewMinutes}m` : "done",
      });
    }
    if (rec.status === "partial") detail.push({ label: "Status", value: "partway" });
    if (rec.confidence) detail.push({ label: "Confidence", value: `${rec.confidence} of 5, ${CONF_WORD[rec.confidence - 1].toLowerCase()}` });
  } else {
    const a = answersText(rec);
    if (a) detail.push({ label: "Answers", value: <AnswerRate text={a} correct={rec.correct ?? 0} answered={rec.answered ?? 0} /> });
    if (rec.confidence) detail.push({ label: "Confidence", value: `${rec.confidence} of 5, ${CONF_WORD[rec.confidence - 1].toLowerCase()}` });
  }

  return (
    <li className="border-border border-t py-2 first:border-t-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-[13px] font-medium tabular-nums">{when}</span>
        <Badge
          variant="outline"
          className={cn("rounded-sm px-1.5 text-[12px] font-medium", SOURCE_STYLE[source.kind])}
        >
          {source.label}
        </Badge>
        {rec.type === "task" && rec.packageName ? (
          <span className="text-muted-foreground min-w-0 truncate text-[13px]">{rec.packageName}</span>
        ) : null}
        <span className="ml-auto flex shrink-0 gap-1">
          <Button variant="ghost" size="sm" className="rounded-sm text-[13px] max-md:h-11" onClick={onEdit} aria-label={`Edit record from ${when}`}>
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-alarm-ink hover:text-alarm-ink rounded-sm text-[13px] max-md:h-11"
            onClick={onDelete}
            aria-label={`Delete record from ${when}`}
          >
            Delete
          </Button>
        </span>
      </div>
      {detail.length > 0 ? (
        <dl className="mt-0.5 flex flex-wrap gap-x-5 gap-y-0.5 text-[13px] tabular-nums">
          {detail.map((d) => (
            <div key={d.label} className="flex gap-1.5">
              <dt className="text-muted-foreground">{d.label}</dt>
              <dd>{d.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {rec.type === "task" && rec.materials.length > 0 ? (
        <p className="mt-0.5 flex flex-wrap gap-x-3 text-[13px]">
          <span className="text-muted-foreground">Materials</span>
          {rec.materials.map((m, i) =>
            m.url ? (
              <a
                key={i}
                href={m.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-claimed-ink focus-visible:ring-ring rounded-sm underline underline-offset-4 outline-hidden focus-visible:ring-2"
              >
                {m.label}
              </a>
            ) : (
              <span key={i}>{m.label}</span>
            ),
          )}
        </p>
      ) : null}
      {rec.type === "task" && rec.note ? (
        <p className="font-prose text-muted-foreground mt-1 text-[14px] leading-snug">{rec.note}</p>
      ) : null}
    </li>
  );
}

/** Answers with the 80% verdict: text plus a spoken cue, never colour alone. */
function AnswerRate({ text, correct, answered }: { text: string; correct: number; answered: number }) {
  const met = rateIsMet(correct, answered);
  return (
    <span className={cn(met === true && "text-strong", met === false && "text-alarm-ink")}>
      {text}
      {met === null ? null : <span className="sr-only">{met ? ", meets 80%" : ", below 80%"}</span>}
    </span>
  );
}

/** Topic-level mocks: scored per topic, so each row shows this topic's counts beside the whole-mock score. */
export function MocksSection({
  mocks,
  onEdit,
  onDelete,
}: {
  mocks: HistoryMock[];
  onEdit: (m: HistoryMock) => void;
  onDelete: (m: HistoryMock) => void;
}) {
  return (
    <section aria-labelledby="topic-mocks" className="mt-8 flex flex-col gap-2">
      <h2 id="topic-mocks" className="text-[16px] font-semibold">
        Mocks
      </h2>
      {mocks.length === 0 ? (
        <p className="text-muted-foreground text-[14px]">No mock covers this topic yet.</p>
      ) : (
        <ul className="border-border border-t">
          {mocks.map((m) => {
            const rate = rateText(m.correct, m.answered);
            const met = rateIsMet(m.correct, m.answered);
            const when = dayText(m.date);
            return (
              <li key={m.id} className="border-border flex flex-wrap items-center gap-x-4 gap-y-0.5 border-b px-1 py-2">
                <span className="w-28 shrink-0 text-[13px] font-medium tabular-nums">{when}</span>
                <span className="min-w-0 flex-1 basis-40 truncate text-[13px]">
                  {m.packageName ?? "No package"}
                  {m.sessionRef ? <span className="text-muted-foreground">, {m.sessionRef}</span> : null}
                </span>
                <span className="w-24 shrink-0 text-[13px] tabular-nums">
                  <span className="text-muted-foreground">Score </span>
                  {Math.round(m.scorePercent)}%
                </span>
                <span className="shrink-0 text-[13px] tabular-nums">
                  <span className="text-muted-foreground">This topic </span>
                  <span className={cn(met === true && "text-strong", met === false && "text-alarm-ink")}>
                    {m.answered} answered, {m.correct} correct{rate ? `, ${rate}` : ""}
                    {met === null ? null : <span className="sr-only">{met ? ", meets 80%" : ", below 80%"}</span>}
                  </span>
                </span>
                <span className="flex shrink-0 gap-1">
                  <Button variant="ghost" size="sm" className="rounded-sm text-[13px] max-md:h-11" onClick={() => onEdit(m)} aria-label={`Edit mock from ${when}`}>
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-alarm-ink hover:text-alarm-ink rounded-sm text-[13px] max-md:h-11"
                    onClick={() => onDelete(m)}
                    aria-label={`Delete mock from ${when}`}
                  >
                    Delete
                  </Button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
