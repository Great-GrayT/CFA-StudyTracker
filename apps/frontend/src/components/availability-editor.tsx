"use client";

import { useRef } from "react";
import { WEEKDAYS, WEEKDAY_LABELS, type WeeklyAvailability } from "@/lib/types";
import styles from "./availability-editor.module.css";

// Seven draggable columns, one per weekday.
//
// Each column is a real slider in the accessibility tree, not a div that
// happens to respond to pointers: arrow keys adjust, Home and End jump to the
// bounds, and aria-valuetext reads "3 hours on Wednesday" rather than a bare
// number. A column you can only set by dragging is unusable with a keyboard
// and invisible to a screen reader.

const MAX_HOURS = 12;
const plural = new Intl.PluralRules("en");

export function AvailabilityEditor({
  value,
  onChange,
}: {
  value: WeeklyAvailability;
  onChange: (next: WeeklyAvailability) => void;
}) {
  const trackRefs = useRef<Record<string, HTMLDivElement | null>>({});

  function set(day: keyof WeeklyAvailability, hours: number) {
    onChange({ ...value, [day]: Math.max(0, Math.min(MAX_HOURS, Math.round(hours * 2) / 2)) });
  }

  function onKey(e: React.KeyboardEvent, day: keyof WeeklyAvailability) {
    const current = value[day] ?? 0;
    const step = e.shiftKey ? 1 : 0.5;
    switch (e.key) {
      case "ArrowUp":
      case "ArrowRight":
        e.preventDefault();
        set(day, current + step);
        break;
      case "ArrowDown":
      case "ArrowLeft":
        e.preventDefault();
        set(day, current - step);
        break;
      case "Home":
        e.preventDefault();
        set(day, 0);
        break;
      case "End":
        e.preventDefault();
        set(day, MAX_HOURS);
        break;
    }
  }

  function fromPointer(e: React.PointerEvent, day: keyof WeeklyAvailability) {
    const track = trackRefs.current[day];
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const fraction = 1 - (e.clientY - rect.top) / rect.height;
    set(day, fraction * MAX_HOURS);
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.columns}>
        {WEEKDAYS.map((day) => {
          const hours = value[day] ?? 0;
          return (
            <div key={day} className={styles.column}>
              <div
                ref={(el) => {
                  trackRefs.current[day] = el;
                }}
                className={`${styles.track} data-surface`}
                role="slider"
                tabIndex={0}
                aria-valuenow={hours}
                aria-valuemin={0}
                aria-valuemax={MAX_HOURS}
                aria-valuetext={`${hours} ${plural.select(hours) === "one" ? "hour" : "hours"} on ${WEEKDAY_LABELS[day]}`}
                aria-label={WEEKDAY_LABELS[day]}
                onKeyDown={(e) => onKey(e, day)}
                onPointerDown={(e) => {
                  (e.target as HTMLElement).setPointerCapture(e.pointerId);
                  fromPointer(e, day);
                }}
                onPointerMove={(e) => {
                  if (e.buttons === 1) fromPointer(e, day);
                }}
              >
                <span
                  className={`${styles.fill} data-fill`}
                  style={{ height: `${(hours / MAX_HOURS) * 100}%` }}
                />
              </div>
              <span className={styles.day} aria-hidden="true">
                {WEEKDAY_LABELS[day].slice(0, 1)}
              </span>
              {/* A number input beside the slider, not instead of it: typing 3
                  is faster than dragging to 3, and it is the accessible
                  fallback if pointer capture misbehaves. */}
              <input
                className={`${styles.number} tnum`}
                type="number"
                min={0}
                max={MAX_HOURS}
                step={0.5}
                value={hours}
                aria-label={`Hours on ${WEEKDAY_LABELS[day]}`}
                onChange={(e) => set(day, Number(e.target.value))}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
