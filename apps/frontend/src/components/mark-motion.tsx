"use client";

import { motion, useReducedMotion } from "motion/react";
import { MARK_GEOMETRY, type MarkShape } from "@/lib/mark-geometry";
import { tierFor } from "./mark";

/**
 * The mark, assembling itself once.
 *
 * One orchestrated moment on the sign-in screen rather than motion scattered
 * through the app: the frame settles, the petals turn into place, the centre
 * lands last. It plays on arrival and then holds still, because a logo that
 * keeps moving while someone is typing their password is a distraction with
 * no information in it.
 *
 * The rosette has eight-fold symmetry, so the petals can turn in from a
 * fraction of a turn and land exactly on themselves. Only transform and
 * opacity are animated, so the whole thing stays on the compositor.
 */

const SPRING = { type: "spring", stiffness: 220, damping: 26, mass: 0.9 } as const;

// Centred rotation and scale on an SVG child needs an explicit box: without
// transform-box the origin is the user-space origin, not the shape, and every
// petal swings in from the top left corner.
const CENTRED = { transformBox: "view-box", transformOrigin: "32px 32px" } as const;

function Shape({ shape }: { shape: MarkShape }) {
  if (shape.circle) {
    return <circle cx={32} cy={32} r={shape.r} fill={shape.fill} />;
  }
  return (
    <path
      d={shape.d}
      fill={shape.fill}
      stroke={shape.stroke}
      strokeWidth={shape.strokeWidth}
      strokeLinejoin={shape.stroke ? "round" : undefined}
      transform={shape.transform}
    />
  );
}

export function MarkMotion({
  size = 56,
  title = "Study Tracker",
  className,
}: {
  size?: number;
  title?: string;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const tier = tierFor(size);
  const shapes = MARK_GEOMETRY[tier].colour;

  // The first three shapes are the octagon frame; everything after is the
  // rosette and its centre. They move differently, so they are split here
  // rather than animated as one block.
  const frame = shapes.slice(0, 3);
  const rosette = shapes.slice(3);

  if (reduced) {
    return (
      <svg viewBox="0 0 64 64" width={size} height={size} role="img" aria-label={title} className={className}>
        <title>{title}</title>
        {shapes.map((shape, i) => (
          <Shape key={i} shape={shape} />
        ))}
      </svg>
    );
  }

  return (
    <motion.svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      role="img"
      aria-label={title}
      className={className}
      initial="hidden"
      animate="shown"
    >
      <title>{title}</title>

      <motion.g
        style={CENTRED}
        variants={{
          hidden: { opacity: 0, scale: 0.94 },
          shown: { opacity: 1, scale: 1, transition: { duration: 0.32, ease: [0, 0, 0.2, 1] } },
        }}
      >
        {frame.map((shape, i) => (
          <Shape key={i} shape={shape} />
        ))}
      </motion.g>

      <motion.g
        variants={{
          hidden: {},
          // The frame has to exist before anything turns inside it, so the
          // petals wait for it rather than racing it.
          shown: { transition: { delayChildren: 0.18, staggerChildren: 0.035 } },
        }}
      >
        {rosette.map((shape, i) => (
          <motion.g
            key={i}
            style={CENTRED}
            variants={{
              // An eighth of a turn back, so each petal arrives on the
              // position its neighbour just left.
              hidden: { opacity: 0, rotate: -45, scale: 0.55 },
              shown: { opacity: 1, rotate: 0, scale: 1, transition: SPRING },
            }}
          >
            <Shape shape={shape} />
          </motion.g>
        ))}
      </motion.g>
    </motion.svg>
  );
}
