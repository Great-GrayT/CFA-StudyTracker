"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { useDeclarations, useDeclare, usePlan, useProjection } from "@/lib/hooks";
import { dateError, defaultDeclaredDate, todayIn } from "@/lib/starting-point";
import { DeclaredDate } from "./declared-date";
import { declarationError, declarationItem, questionsError } from "@/lib/record";
import type { StepNo } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { dayText } from "@/lib/history";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export const STEP_LABELS: Record<StepNo, string> = {
  1: "First read",
  2: "First questions",
  3: "Review reading",
  4: "Review questions",
};
const CONF_WORD = ["Shaky", "Unsure", "Fair", "Solid", "Sure"];

export type DeclareTarget = { readingId: string; moduleName: string; step: StepNo };

/**
 * "Did this before": states one module's step as already done, so the engine
 * stops planning it. Steps 3 and 4 need their first pass stated or done first.
 */
export function DeclareSheet({
  planId,
  target,
  onOpenChange,
}: {
  planId: string;
  target: DeclareTarget | null;
  onOpenChange: (open: boolean) => void;
}) {
  const declare = useDeclare(planId);
  const declarations = useDeclarations(planId);
  const projection = useProjection(planId);
  const plan = usePlan();
  const today = todayIn(plan.data?.timeZone);
  const firstDay = defaultDeclaredDate(plan.data?.startDate, today);
  const [date, setDate] = useState(firstDay);
  const [step, setStep] = useState<StepNo>(1);
  const [confidence, setConfidence] = useState(3);
  const [answered, setAnswered] = useState("");
  const [correct, setCorrect] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    setStep(target.step);
    setConfidence(3);
    setAnswered("");
    setCorrect("");
    setDate(firstDay);
    setError(null);
    // firstDay is read once per opening; a plan refetch must not reset a chosen date.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  // What is already stated or finished, as "readingId|step".
  const doneSteps = useMemo(() => {
    const set = new Set<string>();
    for (const d of declarations.data ?? []) set.add(`${d.readingId}|${d.step}`);
    for (const sec of projection.data?.sections ?? []) {
      for (const m of sec.modules) for (const w of m.windows) if (w.status === "done") set.add(`${m.readingId}|${w.step}`);
    }
    return set;
  }, [declarations.data, projection.data]);

  const asksCounts = step === 2 || step === 4;
  const countsMsg = asksCounts && (answered !== "" || correct !== "") ? questionsError(answered, correct) : null;
  const orderMsg = target ? declarationError([{ readingId: target.readingId, step }], doneSteps) : null;
  const dateMsg = target
    ? dateError([{ readingId: target.readingId, step, date }], declarations.data ?? [], today)
    : null;
  const message = countsMsg ?? orderMsg ?? dateMsg;

  async function submit() {
    if (!target) return;
    if (message) return setError(message);
    setError(null);
    try {
      await declare.mutateAsync([declarationItem(target.readingId, step, { confidence, answered, correct, date })]);
      toast.success(`Noted. The plan was rebuilt from today with this work counted on ${dayText(date)}.`);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save that. Nothing was changed.");
    }
  }

  const shown = message ?? error;

  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5 sm:max-w-md">
        <DialogHeader className="text-left sm:text-left">
          <DialogTitle className="text-[20px] font-semibold">Did this before</DialogTitle>
          <DialogDescription className="text-[13px]">
            {target?.moduleName}. Say which step you already finished and when. It counts as real study on that day, and the plan stops asking for it.
          </DialogDescription>
        </DialogHeader>
        <form
          id="declare-form"
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <fieldset className="grid gap-1.5">
            <legend className="mb-1.5 text-[13px] font-medium">Step</legend>
            <ToggleGroup
              type="single"
              variant="outline"
              value={String(step)}
              onValueChange={(v) => v && setStep(Number(v) as StepNo)}
              className="flex w-full flex-wrap gap-1.5"
              aria-label="Step already done"
            >
              {([1, 2, 3, 4] as StepNo[]).map((n) => (
                <ToggleGroupItem
                  key={n}
                  value={String(n)}
                  className="h-9 flex-none rounded-md border-l px-3 first:rounded-md last:rounded-md data-[state=on]:border-primary data-[state=on]:bg-accent max-md:h-11"
                >
                  {STEP_LABELS[n]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </fieldset>

          {asksCounts ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="declare-answered" className="text-[13px]">
                  Questions answered
                </Label>
                <Input
                  id="declare-answered"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  className="tabular-nums max-md:h-11"
                  value={answered}
                  onChange={(e) => setAnswered(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="declare-correct" className="text-[13px]">
                  Correct
                </Label>
                <Input
                  id="declare-correct"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  className="tabular-nums max-md:h-11"
                  value={correct}
                  aria-invalid={countsMsg !== null}
                  onChange={(e) => setCorrect(e.target.value)}
                />
              </div>
            </div>
          ) : (
            <fieldset>
              <legend className="mb-1.5 text-[13px] font-medium">Confidence</legend>
              <ToggleGroup
                type="single"
                variant="outline"
                value={String(confidence)}
                onValueChange={(v) => v && setConfidence(Number(v))}
                className="grid w-full grid-cols-5 gap-1"
                aria-label="Confidence, 1 to 5"
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <ToggleGroupItem
                    key={n}
                    value={String(n)}
                    aria-label={`${n} of 5, ${CONF_WORD[n - 1].toLowerCase()}`}
                    className="h-11 flex-col gap-0 px-0 data-[state=on]:border-primary data-[state=on]:bg-accent"
                  >
                    <span className="tabular-nums">{n}</span>
                    <span className="text-[12px] font-normal">{CONF_WORD[n - 1]}</span>
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              {step === 1 && confidence <= 2 ? (
                <p className="text-muted-foreground mt-1.5 text-[13px]">
                  At 2 or below, the plan swaps the read for a shorter review pass.
                </p>
              ) : null}
            </fieldset>
          )}

          <DeclaredDate id="declare-date" value={date} max={today} onChange={setDate} />

          {shown ? (
            <p className="text-alarm-ink text-[13px]" role="alert">
              {shown}
            </p>
          ) : null}
        </form>
        <DialogFooter className="sm:justify-end">
          <Button variant="outline" className="max-md:h-11" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="declare-form" className="max-md:h-11" disabled={declare.isPending || message !== null}>
            {declare.isPending ? "Saving" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
