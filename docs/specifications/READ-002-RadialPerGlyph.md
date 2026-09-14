# READ-002 — Radial Fill: per-component anchors + innermost-ring step count

Status: **Implemented** (`feature/read-002`, branched from `develop` @ `14cc6ad`, the
`feature/read-001` merge).

Part of the readability program — see `docs/specifications/READ-000-readability-architecture.md`,
§3 "Layer 0". Companion to READ-001, which fixed Contour Fill. Fixes two separable defects in
Radial Fill (`'radial'`) that make one word render as a bullseye at its centre and as near-straight
rows at its edges.

---

## Background — what was measured, and what was not wrong

Radial Fill rays outward from one anchor: the bounding-box centre of everything it is given. For a
word, that anchor is a point in the middle of the layout with no relation to any letter.

Two things were measured on the real pipeline before this milestone and are **not** what READ-002
changes:

- **Ring radii are exact.** Radial computes each ring radius in closed form (`k × spacingMm`); it
  does not pass through a discretised distance field, so there is no analogue of READ-001's Defect A
  (rings landing short of their own threshold). Measured max deviation of any stone from nominal
  `k × spacingMm` was 5.7e-14 mm over the 245 stones of Lilita One / "Vitalina" / 58mm / SS16 on
  `develop`. No seeding or interpolation correction is added here.
- **The angular step is correct for every ring except the innermost.** Chord length is ≥ `spacingMm`
  at k = 2..20 (over-spaced by 0.1–4.2%). At k = 1 it was over-spaced by 17.6% — see Part C.

The real defect is that **the pattern's scale is set by distance from the anchor.** On Lilita One /
"Vitalina" / 58mm / SS16 the whole-layout anchor sits well outside every letter, the word is
~198 × 42 mm, and the fill is locally near-straight (indistinguishable from Grid Fill) at the outer
letters and a tight bullseye at the middle letters — one mode, two behaviours in one word, decided
by where a letter happens to sit. On Cinzel the anchor falls in the gap between letters, inside no
glyph at all.

---

## Part A — group polygons into connected components (`StoneSampler.js`)

New exported `groupPolygonsIntoComponents(polygons)` → `Point2D[][][]` (an array of components, each
`[outer, ...holes]`).

The unit is a **connected component by even-odd nesting**, deliberately not a character:

- An `i`'s dot and stem get separate anchors. A per-character anchor would sit in the empty space
  between them.
- An `a`'s counter stays a hole of its outer, so `isPointInsidePolygons()`'s even-odd semantics are
  preserved with no hole-specific code — exactly as `sampleContourFillPoints()` already relies on.
- Grouping is derivable from the polygons already passed in, so the change stays inside
  `StoneSampler.js`. A per-character unit would need glyph identity threaded from
  `GeometryEngine._buildLineContours()` through `_textPolygons()` into the sampler, and would fix
  text only.
- It generalises to SVG imports and multi-part shape layers at no extra cost.

Algorithm: for each contour, `depth` = the number of other contours whose bounding box contains
this contour's bounding box (a prefilter) **and** for which
`isPointInsidePolygons(thisContour[0], [thatContour])` is true (the deciding test). Even `depth`
starts a component (an outer); odd `depth` is a hole, attached to the smallest-bounding-box-area
even-depth contour that contains it. An odd-depth contour with no containing outer (should not
occur; defensive) becomes its own component. Components are emitted in ascending order of their
outer contour's index in `polygons`, so the result is deterministic.

Verified structure on the real library, "Vitalina" at 58mm — every one of these gives **exactly 10
components**, all contours at nesting depth 0 or 1, no merged glyphs: Lilita One (12 contours),
Great Vibes (11), Dancing Script (11), Alex Brush (12), Allura (11), Cookie (14).

## Part B — per-component radial anchors (`StoneSampler.js`)

`sampleRadialFillPoints(polygons, boundingBox, spacingMm, stoneSizeMm = spacingMm)`:

1. `boundingBox` null → return `[]` (unchanged).
2. Group via Part A.
3. **Exactly one component** (a Circle, Rectangle, Slot, Polygon, single-glyph text, a one-piece
   SVG): use the `boundingBox` argument exactly as before and take the original code path unchanged.
   This is a correctness guarantee, not an optimisation — every existing single-component caller
   stays byte-identical, modulo the one extra innermost-ring stone Part C adds. The `boundingBox`
   argument is used as-is; it is **not** replaced with a recomputed box in this case.
4. **Two or more components:** for each component in order, build its own `BoundingBox` from its
   contours and run the existing ring generation against that box's centre and its own
   farthest-corner radius. A candidate is kept only if it is inside **both** its own component
   **and** the global `polygons` set. The global test preserves today's even-odd
   `isPointInsidePolygons()` semantics bit-for-bit; the component test stops one component's rings
   bleeding into another.
5. Concatenate in component order, then `dedupeStonePoints(points, stoneSizeMm)` **once** over the
   combined set.

The `stoneSizeMm` dedupe floor is READ-001's settled decision and applies unchanged, including
across components. No separate cross-component floor is introduced.

**Out of scope:** `sampleRadialFieldFillPoints()` (image/raster layers). It has the same defect but
needs raster connected-component labelling on a density field, a different technique. Left
untouched; see `docs/BACKLOG.md`.

## Part C — innermost-ring step count (`StoneSampler.js`)

`radialStepCount()` solves `2r·sin(π/n) = spacingMm` and floors. At `r = spacingMm` the ratio is
exactly 0.5 and the exact answer is exactly 6 (`2r·sin(π/6) = r = spacingMm`). But `Math.asin(0.5)`
rounds a half-ulp above `π/6`, so `Math.PI / Math.asin(0.5)` evaluates to `5.999999999999999` and a
bare floor returns **5** — a 3.527 mm chord where 3.000 mm was intended, 17.6% over-spaced, on the
innermost ring of every radial field ever produced.

Fix: `Math.max(1, Math.floor(Math.PI / Math.asin(halfChordRatio) + 1e-9))`. k = 2..20 were checked
and are unchanged by the epsilon; the worst-case chord shortfall it can introduce is ~1e-9 relative,
far below any physical tolerance.

In scope for READ-002 rather than the backlog because Part B multiplies its blast radius: before,
2 of 245 stones on the reference case; after Part B, every component gains an innermost ring, so it
is 54 of 238 (Parts B+C) — see the tables below. `radialStepCount()` is now exported so
`tools/test-read-002-radial-per-glyph.mjs` can assert it directly.

---

## Measurements (`tools/scratch/` throwaway, real pipeline via `buildCandidateEngine()`)

### 1. Radial placement accuracy

Max `|distance(stone, its own component's anchor) − nearest k·spacingMm|` over **every stone** of
Lilita One / "Vitalina" / 58mm / SS16, where "own component" is the one whose filled region actually
contains the stone (`isPointInsidePolygons`): **1.155e-14 mm**, at stone (133.4950, −14.5290),
component index 6, k = 1. All 238 stones are owned by exactly one component. (`develop` prototype:
1.2e-14 mm.) Radial is still exact.

### 2. Per-component table — Lilita One / "Vitalina" / 58mm / SS16 (stone 4.0, gap 0.3, spacing 4.3)

| comp | contours | anchor (x, y) mm | anchor inside component | stones |
|---|---|---|---|---|
| 0 (`V`) | 1 | (19.17, −20.31) | **no** | 49 |
| 1 | 1 | (46.25, −14.53) | yes | 17 |
| 2 | 1 | (46.25, −36.48) | yes | 7 |
| 3 | 1 | (65.28, −17.46) | yes | 27 |
| 4 | 2 | (90.57, −14.50) | yes | 31 |
| 5 | 1 | (113.39, −20.36) | yes | 21 |
| 6 | 1 | (129.19, −14.53) | yes | 17 |
| 7 | 1 | (129.19, −36.48) | yes | 7 |
| 8 (`n`) | 1 | (152.51, −14.70) | **no** | 31 |
| 9 | 2 | (184.12, −14.50) | yes | 31 |

Total: 10 components, 238 stones. Components 0 (`V`) and 8 (`n`) have anchors outside the glyph —
their bounding-box centre falls in the letter's open bay. Reported, not a failure: the outside
anchor still produces correctly-spaced concentric arcs *within* the glyph, which is the whole point
of anchoring per component rather than per layout.

### 3. Innermost-ring occupancy

Stones at exactly `spacingMm` from their anchor: **54**. `n` returned for every component's
innermost ring: **6** (ten components, `[6,6,6,6,6,6,6,6,6,6]`) — never 5.

### 4. Nearest-neighbour distances

**What is guaranteed:** the final `dedupeStonePoints(points, stoneSizeMm)` pass runs over the
concatenated multi-component set, so **no two stones — from the same component or from two different
ones — are ever closer than one stone diameter.** A 320-case sweep (8 fonts × 10 personal-name
strings × 4 stone sizes, all at 58 mm text height) never produced a pair below 1.0×; the tightest
cross-component pair in the whole sweep was **1.5038 mm at a 1.5 mm stone — 1.0025× the diameter**,
on Cookie / "Vitalina" / stone 1.5 mm / gap 0.2 mm (an independent re-run with a different string
set bottomed out at 1.0008× on Dancing Script / "mimi"). READ-001 already ships contour at 2.57 mm
with 2.5 mm stones (1.028×); this is the same class of change, marginally tighter.

**What is _not_ guaranteed:** the *gap* between two stones belonging to different components. Per-
component anchors are independent, so the facing edge stones of two adjacent glyphs can land
arbitrarily close — down to zero gap (the 1.0025× case above is two stones from adjacent glyphs
effectively touching, where the layer asked for a 0.2 mm gap). The per-component and global
`isPointInsidePolygons()` gates stop one component's rings entering *another glyph's interior*; they
say nothing about stones near the two glyphs' *outer edges*. The 5.5 mm (Lilita One) / 5.7 mm (Great
Vibes) minimum cross-component distance measured for "Vitalina" at SS16 is a property of that one
word at that one size, **not** a structural property of the algorithm.

The READ-002 scoping note's concern (adjacent-glyph stones touching at a script join) was therefore
correct in principle; it simply does not surface on Lilita One or Great Vibes at SS16 once Part C
regenerates the innermost rings. For "Vitalina" / 58mm / SS16 specifically the global minimum
nearest-neighbour distance stays at the intra-ring 4.300 mm pitch for both fonts.

**READ-002 is the first time Radial Fill produces sub-pitch spacing at all.** Before it, a single
whole-layout anchor made min NN ≥ `spacingMm` *structurally*: any two stones either sat on the same
ring (chord ≥ `spacingMm`) or on rings a full `spacingMm` apart. Per-component anchors remove that
structural floor, leaving only the `stoneSizeMm` dedupe floor — the same floor contour already
relies on.

### 5. Stone counts — baseline / Part B only / Parts B+C ("Vitalina", 58mm, stone 4.0, gap 0.3)

| font | `develop` baseline | Part B only | Parts B+C |
|---|---|---|---|
| Lilita One | 245 | 228 | 238 |
| Great Vibes | 81 | 78 | 79 |
| Dancing Script | 83 | 71 | 75 |
| Alex Brush | 67 | 62 | 64 |
| Anton | 289 | 284 | 293 |
| Caveat | 73 | 70 | 71 |

Part B (per-component anchors, tighter discs, fewer candidates) removes stones; Part C (every
component gains a full 6-stone innermost ring instead of 5, some of which land inside) adds a few
back. Anton nets *up* because its heavy strokes accept more of the extra innermost-ring stones than
Part B removes. The *Part B only* column reproduces the prototype exactly on all six fonts.

### 6. Fixture — `examples/mixed-fill-styles-and-sizes.rhs`

Its radial layer is a plain 50 × 36 mm rectangle — one component — so Part B is a no-op and only
Part C moves it. Predicted **1534 → 1535**; measured **1535**. `examples/baselines.json` regenerated
(only that one line and nothing else changed; bounds unchanged; the `image-trace-monogram.rhs`
raster fixture's own decoder-noise count was unchanged this run).

### 7. Complete stone list

Lilita One / "Vitalina" / 58mm / SS16 — 238 rows, `index,xMm,yMm,componentIndex,distanceToAnchorMm,k`
— written to `tools/scratch/read-002/vitalina-lilita-ss16.csv` during the measurement run (scratch,
gitignored).

### 8. Timing

`groupPolygonsIntoComponents()` / `sampleRadialFillPoints()` before → after:

| case | contours | `groupPolygonsIntoComponents()` | radial before | radial after |
|---|---|---|---|---|
| Cinzel "Vitalina" | 45 | 0.14 ms | 1.97 ms | 0.69 ms |
| Cinzel "Vitalina Katarina" | 93 | 0.33 ms | 11.27 ms | 1.89 ms |
| Lilita One "Vitalina Katarina" | 24 | 0.04 ms | 7.92 ms | 2.97 ms |

Radial fill is *faster* after: per-component discs are far smaller than one disc spanning the whole
word, so the point-in-polygon candidate count drops sharply (the prototype measured 3.32× fewer
candidates). Grouping cost is negligible at realistic contour counts.

---

## Single-component regression

| shape | before | after |
|---|---|---|
| rectangle 50 × 36 mm, spacing 4.3, stone 4.0 | 94 stones, first (25, 18), last (49.326238, 9.404993) | **95** stones, first + last **identical** |
| circle r = 15 mm (240-gon), spacing 3.0, stone 2.5 | 61 stones, first (20, 20), last (31.622998, 17.015721) | **62** stones, first + last **identical** |

Outside the innermost ring the single-component output is unchanged. Part C **regenerates** the
innermost ring (at exactly `spacingMm` from the anchor) from 5 evenly-spaced stones to 6, so **4
stones move and 5 are added** for a net count of +1 — measured identically on both shapes above (+5
/ −4, every added and removed point at exactly the ring radius; the only position common to the 5-
and the 6-stone ring is the angle-0 stone). The centre and every outer ring are byte-identical, and
because the innermost ring is generated right after the centre, the first and last returned points
are unchanged.
