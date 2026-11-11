// Draws the octagonal rosette mark.
//
// Parametric rather than traced. The source artwork is a raster of an
// interwoven girih rosette, and tracing it would give a mark that is heavy,
// slightly asymmetric (the original mixes an eight-fold frame with a
// six-fold centre) and muddy at small sizes. Generating it from the geometry
// gives exact symmetry, a file small enough to inline, and one place to
// change a proportion.
//
// Emits both the .svg files AND the geometry the React component renders,
// because two hand-kept copies of a path this fiddly drift the first time a
// proportion changes, and the drift stays invisible until someone compares a
// favicon against the sidebar.
//
// Run: node scripts/generate-mark.mjs
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const PUBLIC = join(root, "apps", "frontend", "public");
const BRAND = join(root, "apps", "frontend", "brand", "icons");
const LIB = join(root, "apps", "frontend", "src", "lib");

const C = 32; // centre of the 64 unit canvas
const NAVY = "#122063";
const BLUE = "#1A5CFF";
const CHANNEL = "#FFFFFF"; // the interlace channel, and the page behind it

const rad = (deg) => (deg * Math.PI) / 180;
const pt = (angleDeg, radius) =>
  `${(C + radius * Math.cos(rad(angleDeg))).toFixed(2)} ${(C + radius * Math.sin(rad(angleDeg))).toFixed(2)}`;

/** Regular polygon path. */
function polygon(sides, radius, rotationDeg) {
  const points = Array.from({ length: sides }, (_, i) =>
    pt(rotationDeg + (360 / sides) * i, radius),
  );
  return `M${points.join(" L")} Z`;
}

/**
 * One petal, pointing up from the centre, as a lens between two arcs.
 *
 * The arc radius is the one whose bulge at the midpoint is exactly halfWidth:
 * r = (L^2/4 + w^2) / 2w. Guessing it is how the first pass produced needles
 * instead of petals, because a radius much larger than the chord flattens the
 * arc almost straight.
 */
function petal(innerRadius, outerRadius, halfWidth) {
  const tipY = C - outerRadius;
  const baseY = C - innerRadius;
  const L = outerRadius - innerRadius;
  const r = (L * L) / 4 / (2 * halfWidth) + halfWidth / 2;
  return (
    `M${C} ${baseY.toFixed(2)} ` +
    `A${r.toFixed(2)} ${r.toFixed(2)} 0 0 1 ${C} ${tipY.toFixed(2)} ` +
    `A${r.toFixed(2)} ${r.toFixed(2)} 0 0 1 ${C} ${baseY.toFixed(2)} Z`
  );
}

const ring = (count, startDeg = 0) =>
  Array.from({ length: count }, (_, i) => startDeg + (360 / count) * i);

/**
 * What each tier draws, measured at the size it is actually used.
 *
 * The channel widens as the mark shrinks: a 1.25 unit channel on a 64 unit
 * canvas is a quarter of a pixel at 16px, where it disappears and welds the
 * petals into one blob. Petal count drops for the same reason, since eight
 * petals inside 24px leaves three pixels each.
 */
const TIERS = {
  large: { channel: 1.25, petals: 8, petal: [2, 22, 5.5], innerPetals: true, centre: 7.5 },
  medium: { channel: 1.7, petals: 8, petal: [2, 21, 6], innerPetals: false, centre: 6.5 },
  small: { channel: 2.6, petals: 6, petal: [1.5, 20, 7.5], innerPetals: false, centre: 5 },
};

/**
 * The mark as a flat list of shapes, in paint order.
 *
 * @param mono when true every band is currentColor and the channels carry all
 *   the structure. Needed wherever the mark is tinted: a disabled state, a
 *   print stylesheet, forced colours.
 */
function markShapes(tier, mono = false) {
  const navy = mono ? "currentColor" : NAVY;
  const blue = mono ? "currentColor" : BLUE;
  const spec = TIERS[tier];
  const w = spec.channel;
  const shapes = [];

  // The frame: a navy octagon, a blue band inside it, then the navy field the
  // rosette sits on, so the petals read against navy rather than against the
  // frame's own blue.
  shapes.push({ d: polygon(8, 31, 22.5), fill: navy });
  shapes.push({ d: polygon(8, 25.5, 22.5), fill: blue, stroke: CHANNEL, strokeWidth: w });
  shapes.push({ d: polygon(8, 23, 22.5), fill: navy, stroke: CHANNEL, strokeWidth: w });

  // The rosette: petals wide enough to overlap their neighbours, which is
  // what makes the shape read as woven rather than as a ring of leaves.
  const outer = petal(...spec.petal);
  for (const a of ring(spec.petals)) {
    shapes.push({
      d: outer,
      fill: blue,
      stroke: CHANNEL,
      strokeWidth: w,
      transform: `rotate(${a} ${C} ${C})`,
    });
  }

  if (spec.innerPetals) {
    // A second layer offset by half a step, so the two interlock rather than
    // sit on top of one another.
    const inner = petal(1.5, 15, 4.2);
    for (const a of ring(8, 22.5)) {
      shapes.push({
        d: inner,
        fill: navy,
        stroke: CHANNEL,
        strokeWidth: w,
        transform: `rotate(${a} ${C} ${C})`,
      });
    }
  }

  // The centre flower, in the channel colour so it reads as a hole through
  // the weave rather than as another band.
  const centreOuter = spec.centre;
  const centre = petal(0, centreOuter, centreOuter * 0.42);
  for (const a of ring(spec.petals, 360 / spec.petals / 2)) {
    shapes.push({ d: centre, fill: CHANNEL, transform: `rotate(${a} ${C} ${C})` });
  }
  shapes.push({ circle: true, r: Number((centreOuter * 0.2).toFixed(2)), fill: blue });

  return shapes;
}

function shapeToSvg(s) {
  if (s.circle) return `<circle cx="${C}" cy="${C}" r="${s.r}" fill="${s.fill}"/>`;
  const attrs = [
    `d="${s.d}"`,
    `fill="${s.fill}"`,
    s.stroke ? `stroke="${s.stroke}"` : "",
    s.strokeWidth ? `stroke-width="${s.strokeWidth}"` : "",
    s.stroke ? `stroke-linejoin="round"` : "",
    s.transform ? `transform="${s.transform}"` : "",
  ].filter(Boolean);
  return `<path ${attrs.join(" ")}/>`;
}

function markSvg(tier, mono = false) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Study Tracker">` +
    `<title>Study Tracker</title>` +
    markShapes(tier, mono).map(shapeToSvg).join("") +
    `</svg>\n`
  );
}

/** Full bleed, its own ground, glyph inside the 80% safe circle. */
function maskableSvg() {
  const inner = markShapes("medium").map(shapeToSvg).join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="Study Tracker, maskable">` +
    `<title>Study Tracker, maskable</title>` +
    `<desc>Glyph sits inside the 80 percent safe circle so round and squircle masks never clip it.</desc>` +
    `<rect width="512" height="512" fill="${NAVY}"/>` +
    `<g transform="translate(102.4 102.4) scale(4.8)">${inner}</g>` +
    `</svg>\n`
  );
}

/** The same geometry as data, for the React component to render. */
function geometryModule() {
  const body = ["large", "medium", "small"]
    .map(
      (t) =>
        `  ${t}: { colour: ${JSON.stringify(markShapes(t, false))}, mono: ${JSON.stringify(
          markShapes(t, true),
        )} },`,
    )
    .join("\n");

  return `// GENERATED by scripts/generate-mark.mjs. Do not edit by hand.
//
// The brand mark's geometry, so the component and the .svg files in public/
// are the same shape by construction rather than by someone remembering to
// update both.

export type MarkShape = {
  d?: string;
  circle?: boolean;
  r?: number;
  fill: string;
  stroke?: string;
  strokeWidth?: number;
  transform?: string;
};

export type MarkTier = "large" | "medium" | "small";

export const MARK_CENTRE = ${C};

export const MARK_GEOMETRY: Record<MarkTier, { colour: MarkShape[]; mono: MarkShape[] }> = {
${body}
};
`;
}

await mkdir(BRAND, { recursive: true });

const files = [
  [join(PUBLIC, "mark.svg"), markSvg("large")],
  [join(PUBLIC, "mark-maskable.svg"), maskableSvg()],
  [join(BRAND, "mark-large.svg"), markSvg("large")],
  [join(BRAND, "mark-medium.svg"), markSvg("medium")],
  [join(BRAND, "mark-small.svg"), markSvg("small")],
  [join(BRAND, "mark-large-mono.svg"), markSvg("large", true)],
  [join(BRAND, "mark-medium-mono.svg"), markSvg("medium", true)],
  [join(BRAND, "mark-small-mono.svg"), markSvg("small", true)],
  [join(LIB, "mark-geometry.ts"), geometryModule()],
];

for (const [path, contents] of files) {
  await writeFile(path, contents, "utf8");
  console.log(`${path} (${contents.length} bytes)`);
}
