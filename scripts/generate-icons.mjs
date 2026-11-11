// Rasterises the PWA icon set from the brand mark.
//
// The manifest named icon-192.png, icon-512.png and icon-maskable-512.png
// from the day it was written and none of the three existed. A manifest whose
// icons 404 fails Chrome's installability check in silence: no error, no
// console warning, the install affordance simply never appears, which is why
// the app could not be added to a home screen. iOS is worse still, because an
// uninstallable app also cannot receive a push notification.
//
// Committed as a script rather than committing only the PNGs so the icons can
// be regenerated when the mark changes, instead of drifting away from it.
//
// Run: node scripts/generate-icons.mjs
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const PUBLIC = join(root, "apps", "frontend", "public");
const APP = join(root, "apps", "frontend", "src", "app");

// sharp arrives as a transitive dependency of Next (it is what next/image
// uses), so it is already installed and does not need to be added to any
// package.json. Resolved by name first; the explicit store path is the
// fallback for pnpm's non-hoisted layout, where a bare require misses.
function loadSharp() {
  try {
    return require("sharp");
  } catch {
    const pnpm = join(root, "node_modules", ".pnpm");
    const { readdirSync } = require("node:fs");
    const dir = readdirSync(pnpm).find((d) => d.startsWith("sharp@"));
    if (!dir) throw new Error("sharp is not installed; run pnpm install first.");
    return require(join(pnpm, dir, "node_modules", "sharp"));
  }
}

const sharp = loadSharp();

// Matches --ground and --claimed in the dark theme, which is what the
// manifest's background_color and theme_color already declare.
const GROUND = "#070B26";
const GLYPH = "#4476FF";

// The mark is drawn with `fill="currentColor"`, which has no cascade to
// inherit from once it is rendered on its own, so it would rasterise black.
async function glyphSvg() {
  const svg = await readFile(join(PUBLIC, "mark.svg"), "utf8");
  return Buffer.from(svg.replaceAll("currentColor", GLYPH));
}

// 68% leaves the margin the glyph needs to read as an icon rather than a
// sticker pressed against the edges.
async function squareIcon(size, out) {
  const inner = Math.round(size * 0.68);
  const glyph = await sharp(await glyphSvg(), { density: 384 })
    .resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const png = await sharp({
    create: { width: size, height: size, channels: 4, background: GROUND },
  })
    .composite([{ input: glyph, gravity: "center" }])
    .png()
    .toBuffer();

  await writeFile(out, png);
  return `${out} (${size}x${size}, ${png.length} bytes)`;
}

// The maskable source already paints its own ground and keeps the glyph
// inside the 80% safe circle, so it is rasterised whole rather than composed.
async function maskableIcon(size, out) {
  const svg = await readFile(join(PUBLIC, "mark-maskable.svg"));
  const png = await sharp(svg, { density: 384 }).resize(size, size).png().toBuffer();
  await writeFile(out, png);
  return `${out} (${size}x${size}, ${png.length} bytes)`;
}

const written = [
  await squareIcon(192, join(PUBLIC, "icon-192.png")),
  await squareIcon(512, join(PUBLIC, "icon-512.png")),
  await maskableIcon(512, join(PUBLIC, "icon-maskable-512.png")),
  // iOS ignores the manifest's icons for the home screen and reads
  // apple-touch-icon instead, so without this an installed app on an iPhone
  // gets a screenshot of the page as its icon. Next emits the link tag for
  // any file named apple-icon in the app directory.
  await squareIcon(180, join(APP, "apple-icon.png")),
];

console.log(written.join("\n"));
