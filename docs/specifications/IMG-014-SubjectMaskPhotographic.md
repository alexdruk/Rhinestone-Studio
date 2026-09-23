# IMG-014 — Subject Mask on Photographic Backgrounds

**Status: spec only.** No source file changes in this step; see the measurement and grep sections
below for what a future implementation step touches.

## Objective

`computeSubjectMask()`'s background route (`src/image/SubjectMask.js:104`, added by IMG-009) works
well on the fixtures IMG-009 measured itself — a near-uniform border, a single subject blob, no
holes. On real photographic backgrounds it is measurably wrong in three independent ways, all
traced to the same two mechanisms:

* **`averageBorderRgb()`** (`:35`) averages the *entire* border ring into one colour. If the border
  isn't one uniform colour — a second subject colour touching the frame, a shadow, dark hair against
  a light wall — the average is a blend that matches neither, and the ΔE test against it goes wrong
  in both directions at once (see the tiger and portrait figures below).
* **`largestConnectedComponent()`** (`:57`) keeps only the single largest on-component and drops
  everything else, including secondary subject parts (a logo's dot, a second word) that just happen
  to be smaller than the main one, and treats every enclosed background-coloured region as a hole
  that stays off — correct for a true cutout hole, wrong for the portrait's own mid-grey facial skin
  and the tiger's white fur, both subject that happens to render close to the background colour
  (measured in decision 3 below).

IMG-014 replaces both mechanisms with a border-ring analysis that tolerates a non-uniform border
(a modal colour, not a mean) and a background definition based on border-connectivity rather than
component size (background is what a flood fill from the border actually reaches; everything else,
enclosed regions included, is subject). Nothing outside `computeSubjectMask()`'s background route
changes: the alpha route, `maskMode`, the 0/1 mask convention, and the `{mask, route,
backgroundRgb}` return shape are all unchanged (decisions 5–6).

## Measured comparison — real images (provided)

Measured by the lead architect on real images; recorded here as provided, not re-derived. Coverage
is the fraction of the image the mask keeps.

| Image | shipped coverage | proposed coverage | pixel agreement | What went wrong (shipped) |
|---|---|---|---|---|
| tiger | 0.808 | 0.819 | 0.665 | Snow kept, white/grey fur dropped — the two errors cancel in the coverage figure alone; pixel agreement is the figure that exposes it. |
| portrait | 0.325 | 0.822 | 0.503 | Hair, brows, eyes and lips dropped: the averaged background `56,56,56` is pulled dark by hair on the border. |
| logo | 0.169 | 0.208 | 0.961 | The largest-component rule drops the dot, the word CREATIVE, and the slogan. |
| Einstein | 0.572 | 0.596 | 0.976 | (recorded as provided) |
| butterfly | 0.365 | 0.368 | 0.997 | (recorded as provided) |

The alpha route (cartoon 0.488, furry 0.335) is out of scope for this milestone and stays
byte-identical — recorded here as provided context, not a target this spec changes.

Decision 3's enclosed-region reversal (below) is itself measured on these same images, provided:
portrait skin forms a 12.8% enclosed region at mean ΔE 6.1 from background; tiger white fur is
0.86% at ΔE 8.8; the logo's largest enclosed background-coloured region is 0.09%.

No figure derived independently in this step disagreed with any of the above; all agree with the
values as given.

## Measured comparison — this milestone's own fixtures (derived)

Measured in `tools/scratch/img-014-mask-probe.mjs` / `img-014-run-fixtures.mjs` /
`img-014-fixture-e.mjs` (probe scripts, not part of the suite), by running both the shipped
`computeSubjectMask()` (imported unmodified from `src/image/SubjectMask.js`) and this spec's own
reference reimplementation of decisions 1–4 against the same buffers. Coverage is on-pixel count.

| Fixture | shipped coverage | proposed coverage | shipped `backgroundRgb` | proposed `backgroundRgb` |
|---|---|---|---|---|
| (a) split-border stripe (40×40, stripe 10×40=400 touching left edge) | 1600 (all — background wrongly kept) | 400 (exact) | `[166,184,225]` (blend of both colours) | `[240,240,240]` (correct) |
| (b) enclosed near-background hole (20×20 subject, 6×6 hole at ΔE≈4.4) | 364 (hole excluded) | 400 (hole filled — matches the 400px subject exactly) | `[240,240,240]` | `[240,240,240]` |
| (c) three components (large≈1520px/medium≈201px/small≈28px, 100×100) | 1517 (large only) | 1743 (all three; smallest is 0.28% of the image, above the 0.05% floor) | `[240,240,240]` | `[240,240,240]` |
| (d) single-pixel speckle (100×100, no other foreground) | 1 (kept — the *only* candidate component is trivially "largest") | 0 (dropped — below the 0.05%/5px floor) | `[240,240,240]` | `[240,240,240]` |
| (e-short) 3px border throat (<5% of a 100px side) into an otherwise-enclosed 79px pocket | 89 (pocket always excluded — shipped has no connectivity requirement) | 168 (pocket stranded by the run-length gate, becomes subject) | `[234,236,239]` (blended) | `[240,240,240]` (correct) |
| (e-long) 8px throat (≥5% of the same side) | 74 | 74 (pocket correctly seeds and floods as background) | `[237,238,239]` | `[240,240,240]` |

Fixture (d) is an incidental finding, not one of the five architect-described failure modes: the
shipped algorithm's "largest component" rule provides no noise floor at all when the lone speckle is
the *only* on-component in the image (it trivially wins by being the only entrant) — decision 4's
absolute 0.05% floor closes that gap as a side effect.

## Decisions

### 1. Background colour is the modal border colour, not the mean

Replaces `averageBorderRgb()` (`:35`). For every 7th pixel of the border ring (same ring
`averageBorderRgb()` already walks: row 0, row `h-1`, column 0, column `w-1`, each pixel counted
once), count how many border pixels overall are within ΔE 8 of it; the pixel with the highest count
is the winner (ties: first in the existing row-major-then-column border enumeration order — no
documented behaviour depends on which of two equal-count winners is picked, mirroring
`largestConnectedComponent()`'s own existing tie convention at `:56`). `backgroundLab` is the mean
Lab of every border pixel within ΔE 8 of that winner; this is what decision 2's classification test
runs against.

ΔE 8 here is a new, fixed, non-exported module constant local to the modal-colour step
(`BACKGROUND_CLUSTER_DE = 8`) — unrelated to `toleranceDe`/`DEFAULT_SUBJECT_TOLERANCE_DE`, which
keeps its existing role (decision 2). It is not measured to be tolerance-insensitive the way
`DEFAULT_SUBJECT_TOLERANCE_DE` was in IMG-009's own "Measured comparison" — it governs only which
border pixels seed *this milestone's own* colour vote, a step IMG-009 never had.

**`backgroundRgb` reporting rule (decision 6):** the returned `backgroundRgb` is the mean sRGB
(mean R, mean G, mean B, each rounded) of that same winning ΔE-8 cluster — not the mean Lab
converted back through an inverse Lab→sRGB transform. No inverse transform exists anywhere in this
codebase today (`ColorSpace.js` is one-directional, sRGB→Lab), and classification itself never
needs one: `backgroundLab` drives the ΔE test directly, in Lab space, with no round-trip. Building
and testing a Lab→sRGB inverse for a single cosmetic reporting field, with no other caller, is not
worth it. On a uniform border the two would agree exactly (verified: fixtures (a)–(d) above all
report the same triplet either way, since the border in each is either fully uniform or the winning
cluster is). Where the border is *not* uniform, mean-sRGB-of-cluster is measurably more accurate
than the shipped whole-ring mean: fixture (e-short)'s shipped `backgroundRgb` is `[234,236,239]`
(pulled off `[240,240,240]` by the tiny non-background arc it can't exclude), while the proposed
value is the exact `[240,240,240]` — the same failure mode the architect's portrait figure names
(`56,56,56` pulled dark by border-touching hair).

### 2. Background is border-connected, not merely far enough away

Replaces `largestConnectedComponent()`'s role in decision 3, and reuses (does not replace)
`toleranceDe`/`DEFAULT_SUBJECT_TOLERANCE_DE` (`:29`) as the closeness test: a pixel is
*background-eligible* when its ΔE from `backgroundLab` is ≤ `toleranceDe` (default 12 — this is
decision 2's "dE 12," the same parameter IMG-009's own tolerance-insensitivity measurement already
covers, not a second new constant). Treating the two differently — a fixed non-configurable ΔE 8 for
the colour vote, the existing configurable `toleranceDe` for membership — keeps `toleranceDe` doing
the one job it already has and avoids adding a second per-call option nobody asked for.

**Seeds:** border-ring pixels that are background-eligible *and* belong to a consecutive run, along
one side only (top row, bottom row, left column, right column — a run never wraps a corner from one
side to another), of length at least 5% of that side's own length (`widthPx` for top/bottom,
`heightPx` for left/right).

**Background** is the 4-connected flood fill from every seed, through background-eligible pixels,
run once over the whole image (not confined to the border). **Subject is everything the flood fill
does not reach** — this is the operative definition, and decision 3 below is its direct consequence,
not a separate rule.

The run-length floor exists to keep a single anti-aliased or noise pixel at the border from opening
a flood-fill path into an interior region that should stay enclosed; fixture (e) above measures its
actual effect — a genuine background pocket whose only border access is a 3px run (below 5% of a
100px side) is stranded and becomes subject, while the same pocket with an 8px run (above the floor)
correctly floods as background. This is a real, narrow regression risk this decision accepts: a
photograph where the true background is visible at the frame edge only through a gap narrower than
5% of that side loses that pocket to the subject mask. No milestone fixture or real image in the
"Measured comparison" tables above exercises this path in a way that changed its own recorded
figure; it is called out because the grep pass (below) found one existing repository fixture close
enough to this shape to be worth flagging on its own.

### 3. Everything not background is subject, including enclosed background-coloured regions

**This reverses IMG-009's decision 1** ("keeps holes as holes ... an enclosed region that is
background-coloured stays off, because it is simply not in the component"). Under decision 2 above,
an enclosed background-coloured region is, by construction, unreached by the border flood fill, so
it is subject with no separate rule needed — decision 3 is naming that consequence, not adding new
mechanism.

The reversal is measured, not asserted: on the portrait — a greyscale photograph — the 12.8%
enclosed region is mid-grey facial skin, at mean ΔE 6.1 from the background — well inside the
default ΔE-12 tolerance, so it was always being *classified* as background-like, and the shipped
"holes stay holes" rule was the only reason it was discarded. On the tiger, the 0.86% figure is the
largest of 15 enclosed white-fur regions each at or above decision 4's own 0.05% floor, at ΔE 8.8;
across the whole tiger frame, enclosed background-coloured pixels (of every size, not just the 15
above the floor) total 5.48%. The logo's largest enclosed background-coloured region is 0.09% of the
image — small enough that this decision's cost on that image is negligible next to the
largest-component-drop it also fixes (decision 4).

Fixture (b) above is the minimal case: a 6×6 island at ΔE≈4.4 from background, fully enclosed in a
20×20 subject square, is dropped by the shipped algorithm (364/400) and kept whole by the proposed
one (400/400).

### 4. Small subject components are dropped by size, not by rank

Replaces `largestConnectedComponent()`. After decision 2/3 produce the subject mask, 4-connected
subject components smaller than 0.05% of the image's total pixel count are removed; every component
at or above that floor survives, regardless of rank. This is what lets the logo keep its dot and its
two words (multiple legitimate components of different sizes) while still dropping true one- or
few-pixel noise (fixture (d): a lone speckle with no competing component, which the shipped
"keep the largest" rule cannot filter at all once it is the *only* candidate — see the incidental
finding above).

0.05% is bracketed by real per-component measurements on both sides, provided by the architect: the
largest proposed-mask component that still falls *below* the floor is 0.039% on the tiger and
0.034% on the portrait; the smallest real part that survives it is the logo's — 13 components in
the proposed mask, the smallest 0.078% (156 px of 199,820), none below the floor. The floor sits
about 1.3× above the largest measured speckle (0.05/0.039) and about 1.6× below the smallest
measured real part (0.078/0.05) — margin on both sides, not a knife-edge choice. Aggregate speckle
volume stays small next to what it removes: the tiger has 1248 components below the floor totalling
0.340% of its pixels, the portrait 158 components totalling 0.271% — both dwarfed by the coverage
gains in the real-image table above. The same margin holds on this milestone's own fixtures
(fixture (c)'s smallest real component is 0.28%, 5.6× the floor; fixture (d)'s speckle is 0.01%,
20× below it).

## Structure

Everything lives inside `src/image/SubjectMask.js`'s background route; no other source file changes
(a smaller surface than IMG-009's five wiring sites, because `maskMode`, the mask convention, and
the alpha route are all unchanged — decisions 5–6).

1. `src/image/SubjectMask.js` — `averageBorderRgb()` (`:35`) is replaced by a modal-colour function
   (decision 1); `largestConnectedComponent()` (`:57`) is replaced by a border-seeded flood fill
   (decision 2) plus a small-component prune (decision 4); `computeSubjectMask()`'s background
   branch (`:124`-`:132`) calls the new functions in place of the old two. The alpha branch
   (`:116`-`:121`), the function signature, `DEFAULT_SUBJECT_TOLERANCE_DE` (`:29`),
   `SUBJECT_ALPHA_PRESENCE_FRACTION` (`:30`), and the `{mask, route, backgroundRgb}` return shape
   are untouched.
2. `src/image/ColorSpace.js` — untouched; `rgbToLab()` (`:36`)/`cie76Distance()` (`:50`) are reused
   as-is, in both directions (colour-vote clustering and background-membership) this milestone adds.
3. No `src/image/index.js`, `app.js`, `index.html`, or `GeometryEngine.js` change: this milestone
   changes what the background route *computes*, not any call site's shape, option, or default.
4. `tools/test-img-014-subject-mask-photographic.mjs` (new, future implementation step) — the five
   fixtures pinned verbatim below, plus a re-pin of `tools/test-img-009-subject-mask.mjs`'s Item 5
   hole sub-case (see "Existing tests" below) since that literal changes under this milestone.
5. `tools/test-img-010-line-design.mjs` Item 20 (`:806`-`:864`, future implementation step) —
   re-fixtured onto the alpha route per "The Item 20 decision" below; not a
   `computeSubjectMask()`/`SubjectMask.js` change.
6. Docs — this spec; `docs/specifications/IMG-009-SubjectMask.md` gains one sentence noting the
   decision-1 reversal; `docs/BACKLOG.md` gains a row recording the shipped defect and pointing to
   this spec, plus a second row on the full-bleed/no-background case Item 20 exposed.

## Existing tests: every pinned literal expected to change

Grepped: every call to `computeSubjectMask(` and every `maskMode`/`route: 'background'` literal in
`tools/test-img-008-vector-first-svg.mjs`, `tools/test-img-009-subject-mask.mjs`,
`tools/test-img-010-line-design.mjs`, `tools/test-img-012-auto-colour-count.mjs`,
`tools/test-img-013-fill-empty-slots.mjs`. Every fixture any of the five files builds that reaches
the background route was run through both algorithms in `tools/scratch/img-014-*.mjs` (above); the
alpha route is out of scope and confirmed unreached by anything below that isn't already excluded.

| File | Fixture | Reaches background route? | Literal affected? | Old → new |
|---|---|---|---|---|
| `test-img-008-vector-first-svg.mjs:353`-`:365` | none (source-text guard on `resolveImageExportRegions()`'s key set only) | n/a | No | n/a |
| `test-img-009-subject-mask.mjs` Item 1 (`:100`) | wing, `maskMode:'threshold'` | No (threshold mode) | No | n/a |
| `test-img-009-subject-mask.mjs` Items 2/3/8/10 | clean wing (opaque + alpha variants) | opaque variant only | No — no holes/speckles/split border in this fixture; measured above (16916 → 16916) | unchanged |
| `test-img-009-subject-mask.mjs` Item 4 (`:156`) | wing + dedicated fringe fixture | Yes | No — measured above at ΔE 2/8/12/20, all four unchanged | unchanged |
| `test-img-009-subject-mask.mjs` Item 5 speckle (`:179`-`:191`) | wing + 3×3 speckle | Yes | No — dropped by both mechanisms (measured 16916 → 16916) | unchanged |
| `test-img-009-subject-mask.mjs` Item 5 **hole** (`:193`-`:209`) | wing + 6×6 enclosed background-coloured hole | Yes | **Yes** — decision 3's own reversal | `assert.equal(cleanOn - holeOn, holePixelCount /* 36 */, ...)` at `:209` → `cleanOn - holeOn` becomes `0` (the hole is filled; `holeOn` becomes `cleanOn`) |
| `test-img-009-subject-mask.mjs` Item 6 (`:213`) | clean wing, `colorCount:6` | Yes | No — same clean-wing mask as Items 2/3 | unchanged |
| `test-img-012-auto-colour-count.mjs` Item 4 (`:151`) | four-quadrant on white border | Yes | No — single connected blob, no holes/speckles (measured 14400 → 14400) | unchanged |
| `test-img-012-auto-colour-count.mjs` Item 5 (`:203`) | four-quadrant, engine end-to-end | Yes | No, by the same measurement — `resolvedCount`/distinct-colour assertions are unaffected since the mask itself doesn't change | unchanged |
| `test-img-013-fill-empty-slots.mjs` Item 13 (`:446`-`:479`) | four-quadrant, `colorCount:4` | Yes | No — identical fixture to IMG-012's, measured unchanged | unchanged |
| `test-img-010-line-design.mjs` `makeFixture()` (all items) | wings/veins fixture | **No** — background outside the blob is fully transparent (`data[i+3]=0`, `:154`), well above `SUBJECT_ALPHA_PRESENCE_FRACTION` (1%): alpha route | No — alpha route is out of scope and unchanged | unchanged |
| `test-img-010-line-design.mjs` Item 11 (`:512`) | disc, `maskMode:'threshold'` | No (threshold mode) | No | n/a |
| `test-img-010-line-design.mjs` **Item 20** (`:806`-`:864`) | 200×14, fully opaque, hard 2-colour vertical split at x=98, no true background at all | As shipped today: no fixture change, would take the background route | **Resolved by re-fixturing onto the alpha route, not a mask-algorithm change** — see below | Implementation step pads the fixture to 204×18 with a 2px fully-transparent margin on every side (the strip and the poke shifted `+2` in x and y) — `transparentFraction` then clears `SUBJECT_ALPHA_PRESENCE_FRACTION`, the same mechanism `makeFixture()` already uses elsewhere in this file, so the fixture takes the alpha route (untouched, out of scope) instead of the background route at all |

### The Item 20 decision

Item 20 exists to test the pocket pass's own modal-colour rule
(`LINE_DESIGN_MODAL_COLOR_RADIUS_RATIO`), not `computeSubjectMask()` itself — its 200×14, fully
opaque, hard 2-colour split was never meant to exercise the background route's border-colour logic,
and decision 1's modal-colour step cannot tell that apart from a real image with a genuinely
dominant border colour: both simply mean "whichever colour covers more of the border ring."

**The implementation step re-fixtures Item 20 instead of accepting the coverage loss.** It pads the
fixture to a 204×18 canvas with a 2px fully-transparent margin on every side (the strip and the poke
shifted `+2` in x and `+2` in y, preserving their relative geometry), which pushes
`transparentFraction` above `SUBJECT_ALPHA_PRESENCE_FRACTION` and sends the fixture down the alpha
route — the exact mechanism `makeFixture()` already uses elsewhere in the same file, so Item 20
becomes consistent with the rest of `test-img-010-line-design.mjs` rather than an outlier reaching
the background route at all. The straddling stone Item 20 searches for is re-located empirically
against the padded fixture's actual geometry, and the test is re-verified to still fail when the
pocket pass is reverted to a single-pixel point sample — the regression guard Item 20 exists for —
proving the padding fixes the mask path without quietly defanging the test.

**Why no border-share threshold can rescue the no-background case instead.** The natural
alternative — refuse to trust the modal colour as "background" unless its cluster covers less than
some share of the border ring — does not separate the two cases. Item 20's own modal cluster covers
0.509 of its border ring (measured directly, `tools/scratch/img-014-verify-followup.mjs`); the
portrait's — a real photograph with a real background — covers 0.515, provided by the architect. A
gate anywhere near 0.51 would misclassify one or the other; there is no threshold that keeps the
portrait on the background route while pushing Item 20 off it. This confirms the fixture-level fix
above is the right layer to resolve this at, not a new heuristic inside `computeSubjectMask()`
itself — and it is why the general case (any full-bleed, no-real-background image) is recorded as a
`docs/BACKLOG.md` row rather than solved here.

## Fixtures (pinned verbatim, for the future test file)

```js
// Shared helpers
function fill(data, widthPx, x0, y0, x1, y1, rgb) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * widthPx + x) * 4;
    data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = 255;
  }
}
function fillCircle(data, widthPx, cx, cy, r, rgb) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
      const i = (y * widthPx + x) * 4;
      data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = 255;
    }
}
const BG = [240, 240, 240];
const SUBJ = [40, 90, 200];

// (a) split border: a subject-coloured stripe occupies the whole left edge (columns 0-9, every
// row) of an otherwise-background 40x40 image -- expect coverage 400 (the stripe only).
function buildFixtureA() {
  const W = 40, H = 40;
  const data = new Uint8ClampedArray(W * H * 4);
  fill(data, W, 0, 0, W, H, BG);
  fill(data, W, 0, 0, 10, H, SUBJ);
  return { widthPx: W, heightPx: H, data };
}

// (b) enclosed near-background hole: a 20x20 subject square on a 40x40 background, with a 6x6
// interior square at [234,234,234] (ΔE~4.4 from BG [240,240,240], inside the ΔE-12 default) --
// expect coverage 400 (hole filled), vs the shipped 364 (hole excluded).
function buildFixtureB() {
  const W = 40, H = 40;
  const data = new Uint8ClampedArray(W * H * 4);
  fill(data, W, 0, 0, W, H, BG);
  fill(data, W, 10, 10, 30, 30, SUBJ);
  fill(data, W, 17, 17, 23, 23, [234, 234, 234]);
  return { widthPx: W, heightPx: H, data };
}

// (c) three disconnected subject components of different sizes on a 100x100 background: large
// (r=22, ~1520px/15.2%), medium (r=8, ~201px/2.0%), small (r=3, ~28px/0.28%, still above the 0.05%
// floor) -- expect all three kept (~1743px total), vs the shipped largest-only (~1517px).
function buildFixtureC() {
  const W = 100, H = 100;
  const data = new Uint8ClampedArray(W * H * 4);
  fill(data, W, 0, 0, W, H, BG);
  fillCircle(data, W, 25, 25, 22, SUBJ);
  fillCircle(data, W, 75, 25, 8, SUBJ);
  fillCircle(data, W, 75, 75, 3, SUBJ);
  return { widthPx: W, heightPx: H, data };
}

// (d) isolated single-pixel speckle on an otherwise uniform 100x100 background -- expect coverage
// 0 (below the 0.05%/5px floor), vs the shipped 1 (kept, since it is the only candidate component).
function buildFixtureD() {
  const W = 100, H = 100;
  const data = new Uint8ClampedArray(W * H * 4);
  fill(data, W, 0, 0, W, H, BG);
  const i = (50 * W + 50) * 4;
  data[i] = SUBJ[0]; data[i + 1] = SUBJ[1]; data[i + 2] = SUBJ[2]; data[i + 3] = 255;
  return { widthPx: W, heightPx: H, data };
}

// (e) a background-coloured pocket, fully enclosed by a subject wall on 3 sides, reaching the
// right image border (x=99) only through a narrow throat of width runPx. Background otherwise
// dominates the border overwhelmingly (this wall+pocket is ~14 of ~396 border-ring pixels), so the
// modal background colour is unaffected -- only the throat's own seed-eligibility is at stake.
// runPx=3 (<5% of the right side's 100px length): the throat fails the run-length gate, the pocket
// is stranded and becomes subject (coverage 168, vs the shipped 89 which always excludes it).
// runPx=8 (>=5%): the throat seeds normally, the pocket correctly floods as background (coverage
// 74, matching the shipped 74).
function buildFixtureE(runPx) {
  const W = 100, H = 100;
  const data = new Uint8ClampedArray(W * H * 4);
  fill(data, W, 0, 0, W, H, BG);
  fill(data, W, 88, 38, 100, 52, SUBJ);
  fill(data, W, 90, 40, 97, 50, BG);
  fill(data, W, 97, 43, 100, 43 + runPx, BG);
  return { widthPx: W, heightPx: H, data };
}
```

## Out of Scope

* The alpha route — untouched, confirmed byte-identical by not being reachable from any fixture
  this decision set touches (decisions 1–4 are all inside the background branch).
* `toleranceDe`'s own default or its exposure as a per-layer control — still not exposed, per
  IMG-009 decision 4; this milestone reuses it, it does not revisit whether it should be a Studio
  control.
* `LineDesignSampler.js`'s own `findEnclosedHoles()`/hole-inpainting pass (`:87`-`:164`). It runs on
  whatever mask `computeSubjectMask()` returns; once the background route no longer produces
  enclosed holes on its own (decision 3), that pass finds zero holes on background-route images and
  becomes dead weight there — it still matters on the alpha route, where a true alpha cutout can
  carry a real interior hole `computeSubjectMask()`'s alpha branch does not fill. Not touched or
  removed here; worth a `docs/BACKLOG.md` row of its own once this milestone actually ships and the
  redundancy is real rather than prospective.
* A general, algorithmic fix for full-bleed/no-real-background images — resolved for
  `test-img-010-line-design.mjs` Item 20 specifically by re-fixturing it onto the alpha route (above),
  not by any change inside `computeSubjectMask()`; the general case is a `docs/BACKLOG.md` row, not
  solved here.
* Any change to `computeSubjectMask()`'s call sites, `maskMode`, the Studio control, or the mask's
  0/1 convention (decisions 5–6) — all confirmed unchanged, no wiring surface this milestone
  touches.
* Performance: decision 1's modal-colour step only samples the same border ring `averageBorderRgb()`
  already walked, but decisions 2 and 4 each add a full-image pass — the border-seeded flood fill and
  the small-component prune — on top of the pre-existing per-pixel ΔE classification, replacing
  `largestConnectedComponent()`'s single pass with two. A reference prototype measured about 315ms
  against the shipped 215ms on a 1300×1302 photograph (provided). Lab conversion itself is not
  repeated per pass: the implementation computes each pixel's Lab once, reused by the eligibility
  test and the flood fill, and each border pixel's Lab once more, reused by the colour vote and the
  run-length seed scan — so the added cost is the extra full-image traversals, not extra
  colour-space conversion, and the existing `docs/BACKLOG.md` row on `computeSubjectMask()`'s
  native-resolution Lab-conversion cost already covers that class of cost and is not separately
  revisited here. Not optimized in this milestone.

## Compatibility

* `maskMode` values, defaults, and persistence are **unchanged** by this milestone — `'threshold'`
  still resolves permissively everywhere, `'subject'` still opts a layer into
  `computeSubjectMask()`. A layer already saved with `maskMode: 'subject'` (from IMG-009 onward)
  **regenerates with the new mask** the next time it renders — this is a behaviour change for every
  such layer's stones, not merely additive; stated here explicitly, as required.
* The 0/1 mask convention, the `{mask, route, backgroundRgb}` return shape, and the alpha route are
  unchanged (decision 6). `backgroundRgb`'s *value* on the background route can differ from today's
  (decision 1's modal colour vs. the shipped whole-ring mean) even where coverage does not — no
  caller of `computeSubjectMask()` reads `backgroundRgb` for anything but diagnostics/reporting today
  (grepped: only `tools/test-img-009-subject-mask.mjs` asserts on it, at `:136`), so this is not
  expected to cascade beyond that one pinned literal, already listed above as unchanged for the
  clean-wing fixture it uses.
* Threshold mode (`maskMode: 'threshold'` or absent) is untouched; every project without
  `maskMode: 'subject'` is unaffected by this milestone, exactly as it was unaffected by IMG-009.

## Anchor verification note

Re-grepped against `develop` at `14b7b95` (tip at the time this spec was written, IMG-010's second
follow-up), immediately before writing: `SubjectMask.js` `DEFAULT_SUBJECT_TOLERANCE_DE`/
`SUBJECT_ALPHA_PRESENCE_FRACTION` (`:29`-`:30`), `averageBorderRgb()` (`:35`),
`largestConnectedComponent()` (`:57`), `computeSubjectMask()` (`:104`), the background branch's
`averageBorderRgb()`/`largestConnectedComponent()` call sites (`:124`, `:132`); `ColorSpace.js`
`rgbToLab()` (`:36`), `cie76Distance()` (`:50`); `src/image/index.js`'s `computeSubjectMask`/
`DEFAULT_SUBJECT_TOLERANCE_DE`/`SUBJECT_ALPHA_PRESENCE_FRACTION` export block (`:55`-`:58`);
`LineDesignSampler.js`'s `computeSubjectMask` import (`:24`), `findEnclosedHoles()` (`:87`),
`computeFilledMaskAndInpaint()`'s own `computeSubjectMask()` call (`:154`). Test-file anchors:
`test-img-009-subject-mask.mjs` Item 5's hole assertion (`:209`); `test-img-010-line-design.mjs`
Item 20 (`:806`-`:864`); `test-img-012-auto-colour-count.mjs` Item 4 (`:151`);
`test-img-013-fill-empty-slots.mjs` Item 13 (`:446`-`:479`); `test-img-008-vector-first-svg.mjs`
Item 9's guard (`:353`-`:365`).
