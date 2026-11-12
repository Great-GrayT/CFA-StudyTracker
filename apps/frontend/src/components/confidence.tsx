"use client";

import { MARK_GEOMETRY } from "@/lib/mark-geometry";
import styles from "./confidence.module.css";

/**
 * Confidence as five slots filled with the mark, never as a bare number.
 *
 * A "3" tells you nothing without the scale beside it, which is why every
 * place that showed one also had to print "of 5". Five slots carry the scale
 * in the shape, so the reading is instant and the same everywhere it appears.
 *
 * Fractions are real here: an average of several ratings is usually not a
 * whole number, and rounding 3.5 to 4 overstates it. A half is drawn as half
 * a mark, clipped down the middle.
 */

const SLOTS = [1, 2, 3, 4, 5];

/**
 * The simplest tier of the mark. At 18px the full figure's facets are far
 * below a pixel and turn to grey mush, so the slot uses the tier that was
 * drawn for exactly this size.
 */
const GLYPH = MARK_GEOMETRY.small.colour;

function Glyph() {
  return (
    <svg viewBox="0 0 64 64" className={styles.glyph} aria-hidden="true" focusable="false">
      {GLYPH.map((shape, i) =>
        shape.circle ? (
          <circle key={i} cx={32} cy={32} r={shape.r} fill={shape.fill} />
        ) : (
          <path
            key={i}
            d={shape.d}
            fill={shape.fill}
            stroke={shape.stroke}
            strokeWidth={shape.strokeWidth}
            strokeLinejoin={shape.stroke ? "round" : undefined}
            transform={shape.transform}
          />
        ),
      )}
    </svg>
  );
}

function Slot({ fill }: { fill: "empty" | "half" | "full" }) {
  if (fill === "empty") return <span className={styles.slotEmpty} aria-hidden="true" />;
  if (fill === "full")
    return (
      <span className={styles.slot} aria-hidden="true">
        <Glyph />
      </span>
    );
  // Half: the glyph is drawn whole and the slot shows the left half of it.
  // Clipping rather than scaling, so the half reads as a mark cut down the
  // middle instead of a smaller mark sitting in a big circle.
  return (
    <span className={styles.slot} aria-hidden="true">
      <span className={styles.half}>
        <Glyph />
      </span>
    </span>
  );
}

function fillFor(slot: number, value: number): "empty" | "half" | "full" {
  if (value >= slot) return "full";
  // Anything at least a quarter into this slot shows as a half; below that it
  // is nearer empty than filled, and a sliver of logo reads as a rendering
  // fault rather than a value.
  if (value >= slot - 0.75) return "half";
  return "empty";
}

export function ConfidenceMeter({
  value,
  label = "Confidence",
  className,
}: {
  value: number;
  label?: string;
  className?: string;
}) {
  const rounded = Math.round(value * 10) / 10;
  return (
    <span
      className={`${styles.meter} ${className ?? ""}`}
      role="img"
      aria-label={`${label} ${rounded} of 5`}
      title={`${label} ${rounded} of 5`}
    >
      {SLOTS.map((slot) => (
        <Slot key={slot} fill={fillFor(slot, value)} />
      ))}
    </span>
  );
}

/**
 * The same five slots, as the control for choosing a rating.
 *
 * Radio semantics rather than buttons: it is one choice out of five, and a
 * row of buttons gives a keyboard user five tab stops and no arrow keys.
 */
export function ConfidencePicker({
  value,
  onChange,
  name,
  legend = "Confidence",
}: {
  value: number;
  onChange: (value: number) => void;
  name: string;
  legend?: string;
}) {
  return (
    <div className={styles.picker} role="radiogroup" aria-label={`${legend}, 1 to 5`}>
      {SLOTS.map((slot) => {
        const selected = value >= slot;
        return (
          <label key={slot} className={styles.pickerSlot}>
            <input
              type="radio"
              name={name}
              className={styles.pickerInput}
              checked={value === slot}
              onChange={() => onChange(slot)}
              // The whole row reads as one value, so the accessible name is
              // the rating this slot sets, not "slot 3".
              aria-label={`${slot} of 5`}
            />
            <span className={selected ? styles.slot : styles.slotEmpty}>
              {selected ? <Glyph /> : null}
            </span>
          </label>
        );
      })}
    </div>
  );
}
