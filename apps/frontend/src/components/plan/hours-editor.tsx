"use client";

import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { WEEKDAYS, WEEKDAY_LABELS, type WeeklyAvailability } from "@/lib/types";

// Whole hours, capped where the planner's own ranges stop.
export const MAX_HOURS = 12;

const clampHours = (n: number) => Math.max(0, Math.min(MAX_HOURS, Math.round(Number.isFinite(n) ? n : 0)));

/**
 * Weekly hours, a slider and a number per weekday.
 *
 * Controlled: the caller holds the value and decides when to save, so
 * onboarding can use it without writing anything.
 */
export function HoursEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: WeeklyAvailability;
  onChange: (next: WeeklyAvailability) => void;
  disabled?: boolean;
}) {
  return (
    <ul className="flex flex-col">
      {WEEKDAYS.map((day) => {
        const id = `hours-${day}`;
        const hours = value[day] ?? 0;
        return (
          <li
            key={day}
            className="border-border flex min-h-11 items-center gap-4 border-b py-1 last:border-b-0 md:min-h-9"
          >
            <label htmlFor={id} className="w-24 shrink-0 text-[14px]">
              {WEEKDAY_LABELS[day]}
            </label>
            <Slider
              className="min-w-0 flex-1"
              min={0}
              max={MAX_HOURS}
              step={1}
              disabled={disabled}
              value={[hours]}
              onValueChange={([next]) => onChange({ ...value, [day]: clampHours(next) })}
            />
            <Input
              id={id}
              type="number"
              inputMode="numeric"
              min={0}
              max={MAX_HOURS}
              step={1}
              value={hours}
              disabled={disabled}
              className="tabular-nums h-9 max-md:h-11 w-16 shrink-0 text-right"
              onChange={(e) => onChange({ ...value, [day]: clampHours(Number(e.target.value)) })}
            />
          </li>
        );
      })}
    </ul>
  );
}
