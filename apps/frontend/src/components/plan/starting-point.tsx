"use client";

import { useMemo } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { canState, itemsError, patchItem, setStep } from "@/lib/starting-point";
import { cn } from "@/lib/utils";
import type { DeclarationItem, StepNo, Topic } from "@/lib/types";

const STEPS: { step: StepNo; label: string }[] = [
  { step: 1, label: "First read" },
  { step: 2, label: "First questions" },
  { step: 3, label: "Review reading" },
  { step: 4, label: "Review questions" },
];
const CONF = ["Shaky", "Unsure", "Fair", "Solid", "Sure"];

const find = (items: DeclarationItem[], readingId: string, step: StepNo) =>
  items.find((i) => i.readingId === readingId && i.step === step);

/**
 * Starting point: per module, which of the four steps you already did before
 * the plan took over. `stored` rows are saved and shown locked; `value` holds
 * the new ones. Step 3 opens after step 1, step 4 after step 2.
 */
export function StartingPoint({
  topics,
  stored,
  value,
  onChange,
  disabled = false,
  loading = false,
  failed = false,
  onRemove,
}: {
  topics: Topic[];
  stored: DeclarationItem[];
  value: DeclarationItem[];
  onChange: (next: DeclarationItem[]) => void;
  disabled?: boolean;
  loading?: boolean;
  failed?: boolean;
  /** Takes back a stored step. Omitted where nothing is stored yet. */
  onRemove?: (item: DeclarationItem) => void;
}) {
  const sorted = useMemo(
    () =>
      [...topics]
        .sort((a, b) => a.order - b.order)
        .map((t) => ({ ...t, readings: [...t.readings].sort((a, b) => a.order - b.order) })),
    [topics],
  );
  const all = useMemo(() => [...stored, ...value], [stored, value]);
  const error = itemsError(value);

  if (loading) return <Skeleton aria-label="Loading modules" className="h-40 w-full rounded-none" />;
  if (failed) return <p className="text-alarm-ink text-[14px]">The modules did not load. Reload to try again.</p>;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-[16px] font-semibold">Starting point</h2>
        <p className="text-muted-foreground max-w-prose text-[14px]">
          Tick each step you already finished for a module. The plan skips it and plans what is left. Remove a saved step to have it planned again. Review reading
          opens after the first read, and review questions after the first questions.
        </p>
      </div>

      <div className="border-border border-t">
        {sorted.map((topic) => {
          const count = topic.readings.reduce(
            (n, r) => n + STEPS.filter((s) => find(all, r.id, s.step)).length,
            0,
          );
          return (
            <details key={topic.id} className="border-border group border-b">
              <summary className="focus-visible:ring-ring flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-sm text-[14px] font-medium outline-hidden focus-visible:ring-2">
                <span className="min-w-0 truncate">{topic.name}</span>
                <span className="text-muted-foreground shrink-0 text-[13px] font-normal tabular-nums">
                  {count > 0 ? `${count} ${count === 1 ? "step" : "steps"} stated` : "None stated"}
                </span>
              </summary>
              <ul className="pb-2">
                {topic.readings.map((r) => (
                  <li key={r.id} className="border-border flex flex-col gap-1.5 border-t py-2">
                    <p className="text-[14px]">{r.name}</p>
                    <div className="flex flex-wrap gap-x-5 gap-y-1">
                      {STEPS.map(({ step, label }) => {
                        const isStored = !!find(stored, r.id, step);
                        const on = isStored || !!find(value, r.id, step);
                        const open = canState(all, r.id, step);
                        const id = `sp-${r.id}-${step}`;
                        return (
                          <div key={step} className="flex min-h-9 items-center gap-2 max-md:min-h-11">
                            <Checkbox
                              id={id}
                              checked={on}
                              disabled={disabled || isStored || (!on && !open)}
                              onCheckedChange={(v) => onChange(setStep(value, r.id, step, v === true))}
                            />
                            <Label
                              htmlFor={id}
                              className={cn("text-[13px] font-normal", !on && !open && "text-muted-foreground")}
                            >
                              {label}
                              {isStored ? " (saved)" : ""}
                            </Label>
                            {isStored && onRemove ? (
                              <button
                                type="button"
                                disabled={disabled}
                                onClick={() => onRemove(find(stored, r.id, step)!)}
                                aria-label={`Remove ${label} for ${r.name}`}
                                className="text-muted-foreground hover:text-foreground focus-visible:ring-ring min-h-9 rounded-sm px-1 text-[12px] underline underline-offset-2 outline-hidden focus-visible:ring-2 disabled:opacity-50 max-md:min-h-11"
                              >
                                Remove
                              </button>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                    {STEPS.map(({ step, label }) => {
                      const it = find(value, r.id, step);
                      if (!it) return null;
                      return (
                        <Detail
                          key={step}
                          label={label}
                          item={it}
                          disabled={disabled}
                          onPatch={(p) => onChange(patchItem(value, r.id, step, p))}
                        />
                      );
                    })}
                  </li>
                ))}
              </ul>
            </details>
          );
        })}
      </div>
      {error ? (
        <p className="text-alarm-ink text-[13px]" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Detail({
  label,
  item,
  disabled,
  onPatch,
}: {
  label: string;
  item: DeclarationItem;
  disabled: boolean;
  onPatch: (p: Partial<Pick<DeclarationItem, "confidence" | "answered" | "correct">>) => void;
}) {
  const base = `sp-${item.readingId}-${item.step}`;
  const num = (v: string) => (v === "" ? undefined : Math.max(0, Math.floor(Number(v))));
  if (item.step === 2 || item.step === 4) {
    return (
      <div className="grid grid-cols-2 gap-3 pl-6 sm:max-w-sm" role="group" aria-label={`${label} results`}>
        <div className="grid gap-1">
          <Label htmlFor={`${base}-a`} className="text-[12px]">
            Questions answered
          </Label>
          <Input
            id={`${base}-a`}
            type="number"
            inputMode="numeric"
            min={0}
            disabled={disabled}
            className="tabular-nums max-md:h-11"
            value={item.answered ?? ""}
            onChange={(e) => onPatch({ answered: num(e.target.value) })}
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`${base}-c`} className="text-[12px]">
            Correct
          </Label>
          <Input
            id={`${base}-c`}
            type="number"
            inputMode="numeric"
            min={0}
            disabled={disabled}
            className="tabular-nums max-md:h-11"
            value={item.correct ?? ""}
            aria-invalid={item.correct !== undefined && (item.answered ?? 0) < item.correct}
            onChange={(e) => onPatch({ correct: num(e.target.value) })}
          />
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 pl-6">
      <span className="text-muted-foreground text-[12px]">{label} confidence</span>
      <div role="radiogroup" aria-label={`${label} confidence`} className="flex gap-1">
        {CONF.map((w, i) => (
          <button
            key={w}
            type="button"
            role="radio"
            aria-checked={item.confidence === i + 1}
            aria-label={`${i + 1} of 5, ${w.toLowerCase()}`}
            disabled={disabled}
            onClick={() => onPatch({ confidence: i + 1 })}
            className={cn(
              "border-border focus-visible:ring-ring size-9 rounded-sm border text-[13px] tabular-nums outline-hidden focus-visible:ring-2 max-md:size-11",
              item.confidence === i + 1 && "border-primary bg-accent font-semibold",
            )}
          >
            {i + 1}
          </button>
        ))}
      </div>
    </div>
  );
}
