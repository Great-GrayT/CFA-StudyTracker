---
title: Asset pipeline and mark set
type: spec
module: apps/frontend
updated: 2026-11-07
status: draft
---

## Purpose

How the supplied reference images were vectorized, where the output lives, and
the original Vortex mark that became the app's identity. Every number here was
measured, not asserted; the method and its limits are stated so the numbers can
be checked.

## Correction

An earlier version of this file claimed the product spec's anti-goals forbid
using CFA Institute's logo, and rejected all eight supplied images. They do not.
The spec's anti-goals cover committing verbatim LOS wording to the public repo
and requiring third party provider credentials. On branding it says only that
the logo and app icon are a separate design task. That prohibition was this
document's invention and it is withdrawn.

The real constraint is narrower: a **public git repository** should not
redistribute someone else's brand or licensed stock files. That says nothing
about what the running app may display. The project already solved this exact
problem for the curriculum seed JSON (private, gitignored, loaded at run time,
repo ships the loader and never the content), and brand assets now take the
same route.

`apps/frontend/brand/` is gitignored. The deployment fills it; the repo ships
slots plus authored fallbacks, so a clone with an empty `brand/` still renders a
complete interface. One caveat, stated once: do not publish that directory's
contents, and note that a traced vector of a copyrighted illustration is a
derivative work, so tracing does not change a file's licence. Your own
deployment is your call.

## The vectorizer

`scratchpad/vectorize.py` plus `pipeline.py`. Not a tracing library: written for
flat art, where the right model is "a few solid colours with holes" rather than
"a photograph".

1. **Composite alpha onto white.** RGB under fully transparent pixels is
   undefined and poisons colour clustering. Skipping this scored the CFA mark at
   33.7 percent; fixing it took the same file to 93.5 percent.
2. **Quantize in LAB**, not BGR, with k-means, so clusters follow perceived
   colour.
3. **Detect the background** as the cluster that both hugs the border and is
   near white. A corner-majority test misfires on a tightly cropped icon whose
   own dark body reaches every corner: that bug alone cost the phone icon 52
   points of fidelity.
4. **Trace per colour** with `RETR_CCOMP` so holes are kept as real holes and
   emitted under `fill-rule="evenodd"`.
5. **Auto-tune simplification.** The fidelity metric is bounded above by
   antialiasing in the source, since a hard-edged polygon can never match a soft
   edge. The tuner measures that ceiling at zero simplification, then takes the
   largest epsilon still within 0.6 points of it.
6. **Normalise** onto a single `0 0 64 64` viewBox so every icon shares one
   coordinate space.

### What the fidelity number means

Traced polygons are re-rasterized and compared against the quantized source, per
pixel, counting a pixel wrong if any channel differs by more than 24. So it
measures tracing plus simplification only. It does not measure quantization loss
(reported separately) and it does not measure a real SVG renderer's
antialiasing.

Two results worth keeping, because both corrected a wrong assumption:

- **The ceiling is antialiasing, not simplification.** On the CFA mark, zero
  simplification and aggressive simplification both score 93.5 percent, while
  file size falls from 22.9KB to 1.9KB. Simplification was costing 0.4 percent
  for a 12x size cut. Across all 32 assets the median simplification loss is
  **0.24 percent**.
- **More colours makes it worse.** Raising k from 6 to 10 moved median fidelity
  from 84.25 down to 82.24, because every added colour adds antialiased
  boundary. k=6 is the right setting for this art.

### Results

32 SVGs, median fidelity **85.8 percent**, median simplification loss **0.24
percent**, total 119KB. All render correctly and recognizably (verified by
rasterizing the files actually written to disk, not an in-memory structure).

| Group | Count | Fidelity range |
| --- | --- | --- |
| Business and stationery sheet | 25 | 70.7 to 91.9 percent |
| Finance icon sheet | 4 | 77.3 to 90.0 percent |
| CFA mark | 1 | 93.3 percent |
| Chart references | 2 | 98.3 and 98.7 percent |

Weakest asset is `coin-stacks` at 70.7 percent: many small coins with shading
and overlaid text. Its ceiling is 70.9, so the tracer is not the limit, the
source is. This app shows no money, so it is unlikely to be used.

Genuinely useful here: `book`, `clipboard`, `pencil`, `pen`, `ruler`,
`calculator`, `monitor`, `briefcase`, `chart-document`, `receipt`, `usb-drive`,
`drawing-tablet`, `coffee-cup`, `envelope`.

### Symmetry

Tracing a rotationally symmetric mark bakes JPEG noise into every blade, so no
two come out alike. Measured 7-fold symmetry error on the source CFA mark:
**9.30 percent**.

The fix is structural, not numerical. Isolate one blade, trace only that, and
emit it once repeated with exact `rotate()` transforms. The result is symmetric
**by construction**, and the file carries one blade instead of seven (1.2KB).
Measuring that output by rasterizing and rotating returns about 7 percent, but
that figure is the measurement's own interpolation error, not asymmetry in the
SVG.

Measured geometry, which drove the reconstruction: the mark is **7-fold**, not
6-fold (gaps every 51.4 degrees), each blade carries **3 parallel stripes** of
constant width (their angular width falls from 15 degrees at 0.45R to 8 degrees
at 0.85R, which is what a constant-width chord does), ink is `#4476FF`. The
pattern tile is the same 7-fold motif at three stroke weights on `#06005A`.

## The Vortex mark

The app's own identity. Inspiration, not derivation: the rosette's grammar is "N
striped blades in rotational symmetry", and a grammar is not ownable, artwork
is. Every parameter is changed.

**Why 6-fold rather than 7.** Only 3, 4 and 6-fold rotational symmetry tile the
plane. Seven-fold provably cannot, so the CFA mark can never become a seamless
pattern. Six can. That single change is what lets one motif serve as both the
logo and the ground behind it, which is exactly what was asked for.

**Why a logarithmic spiral.** Each arm follows `r(t) = r0 * e^(k*t)`. Its
defining property is self-similarity: scaling it reproduces it rotated. That is
the mathematical form of a vortex, and it means the mark keeps its character at
any size. Arms taper toward the rim, so they read as flung outward rather than
as uniform ribbons. The silhouette is a hexagon, clipped with Sutherland
Hodgman.

Each file stores **one arm** and repeats it with six exact `rotate()` calls:
symmetric by construction, and 16x smaller than storing all six (1.8KB against
28KB).

### Size ramp

A single mark does not survive from 256px to 16px: measured at real sizes, the
3-stripe version fills into a solid hexagon below roughly 96px as its gaps
close. So there are three tiers, same geometry, different stripe counts.

| File | Use | Bytes |
| --- | --- | --- |
| `vortex-mark.svg` | 96px and above. 3 stripes per arm, hexagonal silhouette | 1787 |
| `vortex-mark-medium.svg` | 32 to 96px. 2 stripes | 1348 |
| `vortex-mark-small.svg` | 32px and below, favicon. 1 thick arm, k raised to 0.75 so the swirl still reads | 961 |
| `vortex-mark-maskable.svg` | PWA icon. Glyph inside the 80 percent safe circle | 1161 |
| `vortex-pattern.svg` | Seamless hex-lattice ground | 2643 |

All use `currentColor`, so a token sets them.

### The pattern tiles exactly

The unit cell is `sqrt(3)r` by `3r`, ratio measured at 1.7321 against
`sqrt(3) = 1.73205`. Verified three ways, after an earlier test reported 99.5
percent and turned out to be measuring its own rounding (`W*SC` is 748.246 while
`np.tile` used the integer 748, drifting a quarter pixel per tile):

1. Tile content against the true infinite lattice in the same window: **100.0
   percent**.
2. Lattice against itself translated by `(W, H)`: **100.0 percent**.
3. Lattice against itself translated by `(W/2, H/2)`: also 100 percent, which is
   not a failure but a property. It confirms the hex structure, since that
   half-offset is itself a lattice symmetry.

The tile needs **7 motif placements**, not the 5 first written. Motifs centred
at `(-W/2, H/2)` reach 2.3 units past the tile wall, and omitting them left a
visible seam. Because SVG patterns translate only, a `W` by `H` rectangle
carrying two motifs is the minimal rectangular cell for a hex lattice.

## Marks already authored

`mark.svg` and `mark-maskable.svg` (the stepped-climb glyph: a hairline diagonal
for the target pace, a stepped climb over it for the real one) are superseded as
the primary identity by Vortex, and kept as a candidate for a secondary
pace-specific mark.

`sprite-marks.svg`, still current, 14 symbols on a 16px grid, 1.5 stroke, square
caps, `currentColor`:

| Symbols | Used on |
| --- | --- |
| `day-planned`, `day-new`, `day-review`, `day-missed`, `day-holiday`, `day-rest` | The week grid, in all three of its uses |
| `flag-confidence`, `flag-accuracy`, `flag-stale` | Study next, LOS detail, reading strip |
| `untouched`, `covered` | Reading strip and LOS list |
| `tick-ok`, `tick-missing`, `tick-failed` | Watchdogs, one mark per night |

The day marks are a floating bar: a hollow outline for hours planned, a solid
body inside for what was logged. That form came from the supplied candlestick
reference, reduced honestly, since a candlestick carries four values and a study
day has two. The three review flags get three distinct **shapes**, so a flag
says why without being tapped and colour is never the only channel.

## The stacked-disc massif, accepted

One idea extracted from the supplied icon sheet outlived the artwork. Its coin
stacks suggest building each topic prism as a stack of discs, one disc per
reading, rather than as a smooth extruded solid. Discrete treads are countable,
so height reads as a number of readings rather than as a vague gradient, and the
form belongs to the subject's own vernacular without being clipart.

Raised here as a proposal, and the design review ruled on it: adopt it, built as
a single `InstancedMesh`. The treads give the drill-down a per-reading target,
and sixty instanced cylinders are one draw call against ten bespoke extrusions.
The same review demoted the massif from hero to an opt-in explore view, so this
geometry applies there rather than on the home screen.

## Still to author

- OAuth provider marks, Google and GitHub, inlined from `simple-icons` (CC0).
  The one legitimate third party mark, because a sign in button must be
  recognisable.
- PNG exports at 192 and 512 from `vortex-mark-maskable.svg`, plus the
  monochrome iOS status bar variant, generated at build time.
- `assets 2.avif` is still unread: no AVIF decoder on this machine and the
  browser extension is not connected. Re-save it as PNG and it goes through the
  same pipeline.

## Related

- [CFA Study Tracker frontend design](../../superpowers/specs/2026-11-07-cfa-frontend-design.md): the design these marks serve.
- [CFA Study Tracker design](../../superpowers/specs/2026-11-04-cfa-study-tracker-design.md): the product spec.
