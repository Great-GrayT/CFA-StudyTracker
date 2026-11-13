// Draws the heptagonal rosette mark.
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
const APP_DIR = join(root, "apps", "frontend", "src", "app");

const C = 32; // centre of the 64 unit canvas

// Seven-fold, not eight. One sector is 360/7 = 51.4285714 degrees, and the
// motif is drawn from 360/21 = 17.1428571 degrees to 68.5714286, which is
// exactly that sector start plus one whole sector. Offsetting the motif by a
// third of a sector rather than centring it on the axis is what gives the
// mark its shifted, spun look while staying truly seven-fold: the shape still
// lands on itself after a seventh of a turn.
const SIDES = 7;
const SECTOR = 360 / SIDES; // 51.4285714...
const MOTIF_START = 360 / (SIDES * 3); // 17.1428571...
const MOTIF_END = MOTIF_START + SECTOR; // 68.5714286...
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
 * The tile the whole mark is made of: an asymmetric trapezoid whose apex is
 * exactly one seventh of a turn.
 *
 * Its four interior angles are 360/7, 900/7, 540/7 and 720/7 degrees, which
 * is 51.4286, 128.5714 (the heptagon's own interior angle), 77.1429 and
 * 102.8571. They sum to 360, and they pair off to 180 across each leg, which
 * is what makes it a trapezoid: exactly one pair of sides is parallel.
 *
 * It is deliberately NOT symmetric. An isosceles tile spun seven times gives
 * a flower, which is the obvious thing and reads as one. This one has a long
 * leg and a short one, so the seven copies lean the same way and the figure
 * turns rather than sits.
 *
 * Solved by walking the perimeter from the centre: the exterior turn at each
 * vertex is 180 minus its interior angle, and the last edge is closed by
 * intersecting it with the ray the first edge left along. Nothing here is a
 * measured coordinate, so the angles are exact by construction rather than
 * right to three decimal places.
 */
function trapezoidTile(longLeg, shortSide, targetRadius) {
  const A1 = 360 / SIDES; // 51.4285714, at the centre
  const A2 = 900 / SIDES; // 128.5714286, the heptagon's interior angle
  const A3 = 540 / SIDES; // 77.1428571

  const V0 = [0, 0];
  let heading = 0;
  const V1 = [longLeg * Math.cos(rad(heading)), longLeg * Math.sin(rad(heading))];
  heading += 180 - A2;
  const V2 = [
    V1[0] + shortSide * Math.cos(rad(heading)),
    V1[1] + shortSide * Math.sin(rad(heading)),
  ];
  heading += 180 - A3;

  // Close the shape on the ray the first edge left the centre along.
  const dir = [Math.cos(rad(heading)), Math.sin(rad(heading))];
  const ray = [Math.cos(rad(A1)), Math.sin(rad(A1))];
  const det = dir[0] * -ray[1] - dir[1] * -ray[0];
  const t = ((0 - V2[0]) * -ray[1] - (0 - V2[1]) * -ray[0]) / det;
  const V3 = [V2[0] + t * dir[0], V2[1] + t * dir[1]];

  // Scale so the furthest vertex lands on the target radius, whatever lengths
  // were asked for.
  const pts = [V0, V1, V2, V3];
  const maxR = Math.max(...pts.map((p) => Math.hypot(p[0], p[1])));
  const k = targetRadius / maxR;
  return pts.map(([x, y]) => [x * k, y * k]);
}

/** Shrink a polygon toward its own centroid, for the inner colour. */
function inset(pts, factor) {
  const cx = pts.reduce((sum, p) => sum + p[0], 0) / pts.length;
  const cy = pts.reduce((sum, p) => sum + p[1], 0) / pts.length;
  return pts.map(([x, y]) => [cx + (x - cx) * factor, cy + (y - cy) * factor]);
}

/** Polygon path from centre-relative points. */
function pathOf(pts) {
  return `M${pts.map(([x, y]) => `${(C + x).toFixed(2)} ${(C + y).toFixed(2)}`).join(" L")} Z`;
}

/**
 * What each tier draws, measured at the size it is actually used.
 *
 * The channel widens as the mark shrinks: a 1.25 unit channel on a 64 unit
 * canvas is a quarter of a pixel at 16px, where it disappears and welds the
 * petals into one blob. Petal count drops for the same reason, since eight
 * petals inside 24px leaves three pixels each.
 */
const TIERS = {
  // `facets` is how far the tile is subdivided. At 24px the facet edges are
  // sub-pixel and the tile turns to mush, so the small tier draws the tile
  // and its core and nothing finer.
  large: { channel: 1.1, reach: 26.4, inset: 0.62, facets: 3, centre: 4.6 },
  medium: { channel: 1.5, reach: 26.2, inset: 0.6, facets: 2, centre: 4.4 },
  small: { channel: 2.4, reach: 25.8, inset: 0.58, facets: 1, centre: 4.2 },
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

  const band = (d, fill, strokeWidth = w, transform) =>
    shapes.push({ d, fill, stroke: CHANNEL, strokeWidth, transform });

  // The frame, on the shifted axis so the heptagon's own corners line up with
  // the tiles that fill it.
  shapes.push({ d: polygon(SIDES, 31, MOTIF_START), fill: navy });
  band(polygon(SIDES, 28, MOTIF_START), blue, w);

  // The tile, and the facets cut out of it. Every one of the seven copies is
  // this same shape: the figure is one trapezoid turned seven times, not
  // seven shapes arranged to look alike.
  const tile = trapezoidTile(26, 9.5, spec.reach);
  const [V0, V1, V2, V3] = tile;
  const core = inset(tile, spec.inset);
  const [W0, W1, W2, W3] = core;

  for (const angle of ring(SIDES, MOTIF_START)) {
    const spin = `rotate(${angle} ${C} ${C})`;

    // The tile itself, in the darker colour: this is the band left around
    // the core once the core is laid on top.
    band(pathOf(tile), navy, w, spin);

    if (spec.facets >= 2) {
      // The core, split along its own diagonal. The two halves take opposite
      // colours, which is what makes a single tile read as two-toned and
      // gives the spun figure its pinwheel.
      shapes.push({
        d: pathOf([W0, W1, W2]),
        fill: blue,
        stroke: CHANNEL,
        strokeWidth: w * 0.8,
        transform: spin,
      });
      shapes.push({
        d: pathOf([W0, W2, W3]),
        fill: navy,
        stroke: CHANNEL,
        strokeWidth: w * 0.8,
        transform: spin,
      });
    } else {
      band(pathOf(core), blue, w, spin);
    }

    if (spec.facets >= 3) {
      // A third facet on the long leg only. The tile has one long leg and one
      // short one, and marking the long one is what tells the eye which way
      // the figure turns.
      const legMid = [(V1[0] + V2[0]) / 2, (V1[1] + V2[1]) / 2];
      shapes.push({
        d: pathOf([V1, legMid, [(W1[0] + W2[0]) / 2, (W1[1] + W2[1]) / 2], W1]),
        fill: blue,
        stroke: CHANNEL,
        strokeWidth: w * 0.7,
        transform: spin,
      });

      // And a wedge on the short side, pointing the other way, so the tile
      // is read as asymmetric rather than as a slightly wonky symmetric one.
      // A triangle rather than a sliver: anything thinner than the channel
      // around it reads as a rendering fault, not as a facet.
      shapes.push({
        d: pathOf([V3, W3, W0]),
        fill: blue,
        stroke: CHANNEL,
        strokeWidth: w * 0.7,
        transform: spin,
      });
    }
  }

  // The centre, where all seven apexes meet. A disc rather than a flower:
  // seven tile points converging is already the detail, and anything drawn
  // on top of it reads as a smudge.
  shapes.push({ circle: true, r: spec.centre, fill: CHANNEL });
  shapes.push({ circle: true, r: spec.centre * 0.62, fill: blue });
  shapes.push({ circle: true, r: spec.centre * 0.24, fill: CHANNEL });

  return shapes;
}

function shapeToSvg(s) {
  if (s.circle) {
    const attrs = [
      `cx="${s.cx ?? C}"`,
      `cy="${s.cy ?? C}"`,
      `r="${s.r}"`,
      `fill="${s.fill}"`,
      s.stroke ? `stroke="${s.stroke}"` : "",
      s.strokeWidth ? `stroke-width="${s.strokeWidth}"` : "",
      s.transform ? `transform="${s.transform}"` : "",
    ].filter(Boolean);
    return `<circle ${attrs.join(" ")}/>`;
  }
  const attrs = [
    `d="${s.d}"`,
    `fill="${s.fill}"`,
    s.stroke ? `stroke="${s.stroke}"` : "",
    s.strokeWidth ? `stroke-width="${s.strokeWidth}"` : "",
    s.stroke ? `stroke-linejoin="round"` : "",
    s.stroke ? `stroke-linecap="round"` : "",
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
  // The browser tab icon. Written here, not by hand, because a hand-kept copy
  // is exactly how the tab ended up showing a retired mark.
  [join(APP_DIR, "icon.svg"), markSvg("small")],
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
