"use client";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const item =
  "h-7 px-2.5 text-[12px] max-md:h-11 max-md:px-3 data-[state=on]:bg-accent data-[state=on]:font-semibold data-[state=on]:text-foreground";

/** Single-choice zoom control. A radix toggle group: arrow keys move, one is always on. */
export function ZoomChips<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  label: string;
}) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      value={value}
      onValueChange={(v) => v && onChange(v as T)}
      aria-label={label}
      className="flex-wrap"
    >
      {options.map((o) => (
        <ToggleGroupItem key={o.value} value={o.value} className={item}>
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
