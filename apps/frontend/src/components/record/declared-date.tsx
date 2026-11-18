"use client";

import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

// Local midnight, not UTC: the API speaks calendar days.
const toDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const toISO = (d: Date) => new Intl.DateTimeFormat("en-CA").format(d);

/**
 * "When did you do it?" for any self-state. The hint says where the default
 * comes from, so a candidate who accepts it knows what was recorded.
 */
export function DeclaredDate({
  id,
  value,
  max,
  onChange,
  disabled,
  label = "When did you do it?",
  hint = "Defaults to your first day of study.",
  compact = false,
  className,
}: {
  id: string;
  value: string;
  /** Last selectable day, YYYY-MM-DD: today in the plan's zone. */
  max: string;
  onChange: (iso: string) => void;
  disabled?: boolean;
  label?: string;
  hint?: string | null;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={id} className={compact ? "text-[12px]" : "text-[13px]"}>
        {label}
      </Label>
      <DatePicker
        id={id}
        value={value ? toDate(value) : undefined}
        onChange={(d) => d && onChange(toISO(d))}
        max={toDate(max)}
        disabled={disabled}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="max-md:[&_button]:h-11"
      />
      {hint ? (
        <p id={`${id}-hint`} className="text-muted-foreground text-[12px]">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
