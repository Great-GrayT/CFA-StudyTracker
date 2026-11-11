// The Study Tracker mark: an octagonal rosette, interwoven, in the two blues.
//
// The geometry is generated, not written here. scripts/generate-mark.mjs emits
// both src/lib/mark-geometry.ts and the .svg files in public/, so the sidebar
// and the favicon cannot drift apart. To change a proportion, edit the script
// and re-run it.
//
// Three tiers exist because one geometry cannot span 256px to 16px: measured
// at real sizes, the interlace channels close up and weld the petals into a
// blob well before 32px, so the small tier draws six wider petals with a
// channel twice as thick rather than eight thin ones.

import { MARK_CENTRE, MARK_GEOMETRY, type MarkShape, type MarkTier } from "@/lib/mark-geometry";

type Props = {
  size?: number;
  title?: string;
  className?: string;
  /** Draw every band in currentColor, for tinted and forced-colour contexts. */
  mono?: boolean;
};

export function tierFor(size: number): MarkTier {
  if (size >= 96) return "large";
  if (size >= 32) return "medium";
  return "small";
}

export function MarkShapes({ shapes }: { shapes: MarkShape[] }) {
  return (
    <>
      {shapes.map((shape, i) =>
        shape.circle ? (
          <circle key={i} cx={MARK_CENTRE} cy={MARK_CENTRE} r={shape.r} fill={shape.fill} />
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
    </>
  );
}

export function Mark({ size = 32, title = "Study Tracker", className, mono = false }: Props) {
  const tier = tierFor(size);
  const shapes = mono ? MARK_GEOMETRY[tier].mono : MARK_GEOMETRY[tier].colour;

  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      role="img"
      aria-label={title}
      className={className}
    >
      <title>{title}</title>
      <MarkShapes shapes={shapes} />
    </svg>
  );
}
