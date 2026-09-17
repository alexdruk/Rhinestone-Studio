# IMG-005 — Check & Fix

## Objective

IMG-005 is the fifth of `IMG-001`'s eight-milestone roadmap (`docs/specifications/IMG-001-ImageToStrass.md:38`-`:39`: "**IMG-005 — Check & fix.** A validation pass over a generated image layout that repairs spacing
violations without ever violating the manufacturing floor"). It fills the `#imageStudioGroupCheckFix`
placeholder (`index.html:1196`-`:1199`, `<p class="hint">Coming in IMG-005</p>`) that `IMG-007`
reserved for it (`docs/specifications/IMG-007-StudioShell.md:48`-`:52`, "Five closed placeholder
groups").

`dedupeStonePoints()` (`src/geometry/StoneSampler.js:333`) floors at `stoneSizeMm` — literal physical
overlap — not the manufacturing floor `stoneSizeMm + gapMm`, in both `sampleContourFieldFillPoints()`
(`:1777`, dedupe call at `:1805`) and `sampleRadialFieldFillPoints()` (`:1727`, dedupe call at
`:1756`). This is deliberate, not an oversight: `docs/specifications/RS-1011-FillAlgorithms.md:171`-
`:180` records that flooring at the full gap-inclusive `spacingMm` there "culled sub-pitch lanes
wholesale where contour branches converge — the same reasoning RC-002 applied to outline mode." So
today, a Contour or Radial image layer can legally ship same-layer stone pairs closer than
`stoneSizeMm + gapMm` (never closer than `stoneSizeMm` itself — `dedupeStonePoints()` still guarantees
no literal overlap) wherever the traced shape's rings converge or its boundary curves tightly.

Measured directly against `develop@34e237c` (re-run for this document, not copied from the brief) on
a plain disc, placement `{xMm:10, yMm:7, widthMm:60, heightMm:60}`, `stoneSizeMm 2.7` / `gapMm 0.3`
(`spacingMm` 3.0):

| mode | stone count | pairs under `spacingMm` but `>= stoneSizeMm` | min pairwise distance |
|---|---|---|---|
| contour | 255 | **286** | 2.7787 mm |
| radial | 245 | 0 | 3.0000 mm |
| fill | 256 | 0 | 3.0000 mm |
| staggered | 298 | 0 | 3.0000 mm |
| organic (seed 1, spread 1) | 182 | 0 | — |
| edge (seed 1, spread 1, thinning 1, no `field.edge` populated — see note below) | 48 | 0 | — |

(Edge mode above was measured by calling `sampleEdgeFieldFillPoints()` directly on the raw disc field
with no `.edge` channel attached — `fieldEdgeAt()`, `StoneSampler.js:1637`-`:1641`, returns `0`
unconditionally when `field.edge` is absent, so this reduces to uniform maximum thinning everywhere
(`radiusAt = base * (1 + edgeThinning)`) rather than a true edge-aware measurement; irrelevant to the
point being made here, which is only that its violation count is zero.)

Radial and every other image mode measure zero violations on this fixture — Radial's own
`dedupeStonePoints()` call is RS-1011's stated "defensive second layer" (`:182`-`:186`: "polar
sampling can occasionally place two rings' stones closer than the nominal pitch"), not a mode that
routinely produces sub-floor pairs the way Contour's ring-convergence geometry does. IMG-005 therefore
adds a same-layer repair pass for image layers specifically (`docs/specifications/IMG-001-ImageToStrass.md`
roadmap item 5). Vector Contour/Radial (the shape/SVG/path/text samplers reached through
`sampleShapeFillPoints()`) share the identical latent defect — `dedupeStonePoints()` is the same
function, called the same way, for the same RC-002/READ-001 reason — and are explicitly out of scope;
recorded as a new `docs/BACKLOG.md` row (see Files Touched).

## Decisions

1. **New function `nudgeOrDropStonePoints(points, insideAt, stoneSizeMm, gapMm, stats = null)`**, in
   `src/geometry/StoneSampler.js` immediately beside `dedupeStonePoints()` (`:333`-`:372`) — generalizing
   that function's own bucket-hash scan (grid cells sized to the floor, 3×3-neighbourhood lookup) rather
   than duplicating it, the same "same grid-hash bucket technique... generalized to..." relationship
   `selectNonOverlappingSizedStones()`'s own doc comment already describes for its kinship with
   `dedupeStonesByRadius()` (`src/geometry/MixedSizeGenerator.js:147`-`:149`). Walks `points` in input
   order, same as `dedupeStonePoints()`; `cellSizeMm = stoneSizeMm + gapMm` (the true floor, wider than
   `dedupeStonePoints()`'s `stoneSizeMm`-only cell).

   For each candidate:
   - Scan the candidate's 3×3 cell neighbourhood of already-kept points. If none is closer than
     `stoneSizeMm + gapMm`, keep the point as-is (push to `kept`, index it at its own cell) — the common
     case, identical cost shape to `dedupeStonePoints()`.
   - Otherwise identify the **single nearest** offending kept point (minimum distance among all
     neighbours closer than the floor) and attempt **exactly one nudge**: move the candidate directly
     away from that nearest point, to precisely `stoneSizeMm + gapMm` from it —
     `nudged = nearest + normalize(candidate - nearest) * (stoneSizeMm + gapMm)`. If `candidate` and
     `nearest` coincide exactly (zero distance — direction undefined), the nudge is not attempted and the
     point drops immediately (see the degenerate case below).
   - Re-validate the nudged position from scratch: `insideAt(nudged.xMm, nudged.yMm)` must be true, and
     the nudged position's **own** 3×3 cell neighbourhood (recomputed at its new coordinates — a nudge can
     cross a cell boundary) must clear the same `stoneSizeMm + gapMm` floor against every kept point found
     there, including the original `nearest` point and any other kept point the nudge happened to move
     toward.
   - On success, keep the **nudged** position (a new `Point2D`, not the original candidate) and index it
     at its own cell. On failure (off-field, or still too close to some kept point), drop the candidate
     entirely.
   - **No iterative retry and no multi-point relaxation** — single-shot and deterministic, the same
     posture `dedupeStonePoints()` already has (first-of-any-conflicting-pair-wins, scan-order dependent,
     no backtracking).

   `stats`, when non-null, is a mutable accumulator `{violationsFound, repaired, dropped}` incremented in
   place — the same "caller-owned accumulator, mutated in place, not returned" convention
   `sampleShapeFillPoints()`'s own `outlineStats` parameter already established
   (`src/geometry/GeometryEngine.js:981`-`:1013` increments `outlineStats.rawSampleCount`/`.keptCount` in
   place across multiple contour passes). Every candidate that enters the "too close" branch increments
   `violationsFound`; a successful nudge also increments `repaired`; a drop also increments `dropped`. So
   `violationsFound === repaired + dropped` always, and `kept.length === (points.length - violationsFound)
   + repaired`. `stats` defaults to `null` (no accounting overhead) for every call site that does not need
   a report — see decision 3.

   **Coordinate-space note.** `points` in both call sites (decision 2) are already in *placed* (absolute
   project-mm) coordinates — `sampleContourFieldFillPoints()` offsets each ring point by
   `xMm`/`yMm` before it ever reaches the dedupe call (`:1794`), and `sampleRadialFieldFillPoints()`
   pushes `new Point2D(xMm + localXMm, yMm + localYMm)` directly (`:1741`, `:1751`). But
   `sampleContourFieldFillPoints()`'s own existing `insideAt` closure (`:1785`) is defined in *local*
   (pre-placement) coordinates for `computeInwardRingPolygons()`'s use, and `sampleRadialFieldFillPoints()`
   has no `insideAt` closure at all — it calls `fieldPixelOn()` inline, also in local coordinates
   (`:1740`, `:1750`). Passing either of those directly to `nudgeOrDropStonePoints()` would silently
   offset every field lookup by the placement's own `xMm`/`yMm` and misvalidate every nudge. Both call
   sites therefore build a **second**, placement-aware closure —
   `const insideAtPlaced = (absXMm, absYMm) => fieldPixelOn(field, absXMm - xMm, absYMm - yMm, widthMm, heightMm);`
   — immediately before the `nudgeOrDropStonePoints()` call, and pass that, not the existing local one.

2. **Wired only at `sampleContourFieldFillPoints()`'s and `sampleRadialFieldFillPoints()`'s existing
   `dedupeStonePoints(points, stoneSizeMm)` call sites** (`:1805`, `:1756`) — replaced outright with
   `nudgeOrDropStonePoints(points, insideAtPlaced, stoneSizeMm, gapMm, stats)`. Both functions gain two
   new trailing optional parameters, `gapMm = 0` and `checkFixStats = null`, appended after their existing
   `stoneSizeMm = spacingMm` parameter — the same trailing-optional-parameter shape `outlineStats`
   already uses on `sampleShapeFillPoints()`. `gapMm` defaulting to `0` means an omitted `gapMm` reduces
   the floor to exactly `stoneSizeMm` — a *narrower* floor than today's `spacingMm`-derived pitch could
   ever require, so no existing direct caller of either function (there is none outside
   `sampleFieldByMode()`) can regress.

   `sampleFieldByMode()` (`:1891`-`:1902`) forwards two new keys read out of its existing
   `samplerOptions` bag: its `'radial'` and `'contour'` cases become
   `sampleRadialFieldFillPoints(field, placement, spacingMm, stoneSizeMm, samplerOptions?.gapMm ?? 0, samplerOptions?.checkFixStats ?? null)`
   and the `'contour'` equivalent — `samplerOptions` is already documented as "purely additive" (its own
   doc comment, `:1886`-`:1888`: "read only by the 'organic'... and 'edge'... Every other case ignores
   it"); this widens which keys `'radial'`/`'contour'` read from the same bag, unchanged for
   `'organic'`/`'edge'`/`'fill'`/`'staggered'`.

   `GeometryEngine.generateImageLayout()`'s base `sampleFieldByMode()` call (`:1204`) is the only site
   that supplies `gapMm`/`checkFixStats`: `spacingMm = options.stoneSizeMm + options.gapMm` is already
   computed there (`:1203`) — `options.gapMm` simply needed threading into the `samplerOptions` object
   the call already builds, alongside a fresh accumulator:
   ```js
   const checkFixStats = (options.mode === 'contour' || options.mode === 'radial')
     ? { violationsFound: 0, repaired: 0, dropped: 0 }
     : null;
   const points = sampleFieldByMode(options.mode, field, placement, spacingMm, options.stoneSizeMm,
     { seed: options.seed, spread: options.spread, edgeThinning: options.edgeThinning, gapMm: options.gapMm, checkFixStats });
   ```
   `checkFixStats` is then read back (populated in place by the sampler call above) and passed into the
   returned `StoneLayout` — see decision 4.

3. **S-200 mixed infill needs no separate pass — measured, not assumed.** The S-200 infill call site
   (`generateImageLayout()`, `:1235`-`:1254`) is deliberately **not** widened to pass `gapMm`/
   `checkFixStats` — its own `samplerOptions` object (`:1242`) stays `{ seed, spread, edgeThinning }`,
   unchanged. Two independent reasons, both grounded in the actual code:
   - `generateMixedSizeInfillPoints()`'s field-mode branch (`src/geometry/MixedSizeGenerator.js:240`)
     already calls `sampleFieldByMode(mode, source.field, source.placement, pitchMm, pitchMm, samplerOptions)`
     — note `pitchMm` is passed as *both* `spacingMm` and `stoneSizeMm`, and `pitchMm =
     (smallestEligibleMm + gapMm) * (2 - conservativeDetail)` (`infillPitchMm()`, `:134`-`:137`) is
     already gap-inclusive and inflated by a `1×`–`2×` safety multiplier. So candidate generation for
     infill already dedupes/nudges at a floor at or above the true gap-inclusive pitch for the *smallest*
     eligible size, even with `gapMm` defaulting to `0` on top of it in the new function's own signature.
   - More fundamentally: `selectNonOverlappingSizedStones()` (`MixedSizeGenerator.js:157`-`:211`) is the
     **authoritative** accept/reject pass over every candidate — it independently re-derives the true
     `(a.sizeMm + b.sizeMm)/2 + gapMm` threshold per pair, per actually-assigned size, against every
     already-placed stone (primary *and* infill accepted so far), via its own grid-hash index
     (`:176`-`:194`). A candidate that reaches it from an under-floor `sampleContourFieldFillPoints()`/
     `sampleRadialFieldFillPoints()` pass could never have been *accepted* as an overlapping stone —
     `selectNonOverlappingSizedStones()` would reject it regardless of how the candidate was generated.
     The old `dedupeStonePoints()`-based candidate generation could therefore only ever **under-produce**
     (drop a geometrically valid candidate too early), never over-produce an invalid one. This is exactly
     the same "Never create physical overlap" guarantee
     `docs/specifications/S-200-MixedStoneSizeLayouts.md:172`-`:176` already documents for Step 4,
     independent of anything upstream.

   Because `nudgeOrDropStonePoints()` unconditionally replaces `dedupeStonePoints()` at both call sites
   (decision 2), S-200 infill under Contour/Radial mode automatically inherits the same nudge-before-drop
   behavior at the candidate stage, for free, with `gapMm` defaulting to `0` (the pre-existing effective
   floor, since `pitchMm` already carries `gapMm`). This can only ever let a previously-culled, genuinely
   valid candidate reach `selectNonOverlappingSizedStones()` that could not reach it before — the final,
   authoritative filter is untouched. Expected effect: Contour/Radial S-200 infill counts are unchanged or
   slightly higher, never lower, and never in violation. Test Plan item 9 measures this on the disc/
   dumbbell fixtures rather than asserting it by argument alone.

4. **Per-layer report: `StoneLayout` gains an optional `checkFixStats` field**, following the exact
   precedent `outlineStats` already set (`src/geometry/StoneLayout.js:24`, doc comment: "Layout-quality
   metrics... Additive and optional: null/absent for every non-outline layout and every layout produced
   before this field existed"). Constructor (`:39`) gains `checkFixStats = null`; `toJSON()` (`:86`-`:111`)
   gains the same `if (this.checkFixStats) json.checkFixStats = { ...this.checkFixStats };` guard
   `outlineStats` uses (`:96`-`:98`); `fromJSON()` (`:113`-`:124`) gains `checkFixStats: value.checkFixStats
   ?? null`. This is a `StoneLayout` field, not a `layer.*` project field — `StoneLayout` is the
   pipeline's computed output (`CLAUDE.md`, "Core Architecture": Project JSON → GeometryEngine →
   StoneLayout), regenerated from the project on every call, never itself written into a saved project —
   so this is genuinely transient: no `validateProject()` change, no schema version bump, nothing for an
   old saved project to be incompatible with. (Same as `outlineStats`, it does ride along whenever
   `StoneLayout.toJSON()` backs the app's own JSON Export — `app.js` calls
   `JSON.stringify(layout, null, 2)`, per `src/geometry/README.md:339`-`:342` — but that is the existing,
   already-accepted precedent `outlineStats` set, not a new exposure this milestone introduces.)

   `generateImageLayout()` (`GeometryEngine.js:1256`, the `return new StoneLayout({...})` line) passes
   `checkFixStats` alongside `layerId`/`sourceMode`/`stones` — the same accumulator object decision 2
   built and handed to `sampleFieldByMode()`, now populated. It is `null` for every mode except
   `'contour'`/`'radial'`, and — per decision 3 — never reflects S-200 infill's own incidental
   nudge/drop activity, only the base layer's.

   **App wiring**, following the existing `includeStats` convention exactly (`app.js:943`
   `generateLiveStonesForCandidateLayer()` dispatches to five per-type methods, each already returning
   `{stones, outlineStats}` when `includeStats` is true): `generateImageStonesLive()` (`:994`) is the only
   one of the five that changes — its `includeStats` branch widens from `{stones,
   outlineStats:result.outlineStats??null}` to also read `checkFixStats:result.checkFixStats??null` off
   the same `result`. The other four generate-live methods are untouched; their own `StoneLayout`s never
   set `checkFixStats`, so `result.checkFixStats` would just be `undefined` there — not worth a
   defensive `??null` on branches that can never produce the field.

   `renderImageStudio()` (`:6083`) currently derives its Studio stats (`imageStudioStatCount`/`Sizes`/
   `Colors`/`Box`, `:6192`-`:6199`) from the **global cached** `layout.stones` filtered by `layerId`
   (`:6123`) — a project-wide regenerate that carries no per-call `checkFixStats`. `renderImageStudio()`
   therefore makes its own additional call, `await engine.generateImageStonesLive(l, {includeStats:
   true})` (`engine` is the module-level `GeometryEngine` instance, `:1201`), the same way it already
   makes its own separate `prepareImageField()` preview calls for the Mask/source views (`:990`'s own
   comment already documents this "preview-only... calls" pattern as pre-existing) — an accepted,
   already-established cost of a live Studio preview, not a new one. `#imageStudioGroupCheckFix`
   (`index.html:1196`-`:1199`) loses its `<p class="hint">Coming in IMG-005</p>` line; in its place:
   - When `l.fillMode` resolves to `'contour'`/`'radial'` and `checkFixStats` is non-null: a line reading
     e.g. `"3 spacing violations found, 2 repaired, 1 dropped"` (all three counts, always — including the
     zero-violation case, which reads `"No spacing violations found."`, the same "state the non-event
     explicitly" precedent the Edge Studio group's own conditional hints use).
   - Otherwise (any other fill style): a static hint, `"Only applies to Contour Fill and Radial Fill."`
     — the same "disabled-with-an-explanatory-title" register `#imgSeed`/`#imgEdgeWidth` already use
     for mode-gated controls (`:6108`-`:6111`), adapted to a read-only report rather than a disabled
     input (there is nothing to disable — Check & Fix has no user-facing control, it runs automatically).

   `#imageStudioGroupCheckFix` is **not** added to `IMAGE_STUDIO_LIVE_GROUP_IDS` (`:6082`) — that list
   gates `.inert` on groups holding live *input controls*; Check & Fix holds only a read-only report
   `renderImageStudio()` itself repaints every call, so it needs no separate live-group wiring.

5. **The manufacturing floor itself never changes, and nothing here can relax it.** Restating the
   Architectural Rule this milestone is bound by
   (`docs/specifications/IMG-001-ImageToStrass.md:78`-`:83`): *"Check & fix (IMG-005) never violates
   `diameter/2 + diameter/2 + gap`... a 'fix' pass may remove or nudge a stone to satisfy it, but may
   never relax it, add a second spacing formula, or accept a caller-supplied override that would violate
   it."* `nudgeOrDropStonePoints()` takes no override parameter for the floor — `stoneSizeMm`/`gapMm` are
   the same two values every other sampler in this codebase already derives its own floor from, and a
   nudge that cannot satisfy `stoneSizeMm + gapMm` against `insideAt()` and every neighbour is dropped,
   never placed anyway. There is no configuration, no project field, and no Studio control that weakens
   this — Check & Fix has no user-facing settings at all (decision 4), by design: a validation/repair
   pass with a tunable floor would itself be the "second spacing formula" the rule forbids.

## Structure

Data flow, extending IMG-004's field-and-sampler contract:

```
GeometryEngine.generateImageLayout({..., mode: 'contour'|'radial', stoneSizeMm, gapMm})
  -> normalizeImageParams(): stoneSizeMm/gapMm already validated/normalized (RS-1008A, pre-existing;
     no IMG-005 change here)
  -> spacingMm = stoneSizeMm + gapMm  (pre-existing, :1203)
  -> checkFixStats = (mode is 'contour'/'radial') ? {violationsFound:0, repaired:0, dropped:0} : null
  -> sampleFieldByMode(mode, field, placement, spacingMm, stoneSizeMm,
       {seed, spread, edgeThinning, gapMm, checkFixStats})
       -> 'contour' -> sampleContourFieldFillPoints(field, placement, spacingMm, stoneSizeMm,
            samplerOptions.gapMm, samplerOptions.checkFixStats)
            -> rings computed exactly as before (ContourRingSampler.js, splitSliverRuns -- untouched)
            -> insideAtPlaced(absXMm, absYMm) = fieldPixelOn(field, absXMm-xMm, absYMm-yMm, widthMm, heightMm)
            -> nudgeOrDropStonePoints(points, insideAtPlaced, stoneSizeMm, gapMm, checkFixStats)
                 replaces dedupeStonePoints(points, stoneSizeMm) -- floors at stoneSizeMm+gapMm,
                 attempts one nudge per violator before dropping, mutates checkFixStats in place
       -> 'radial' -> sampleRadialFieldFillPoints(...) -- same substitution, same insideAtPlaced pattern
       -> 'fill'/'staggered'/'organic'/'edge' -- byte-identical, ignore gapMm/checkFixStats entirely
  -> stones built from the (repaired) points, exactly as before
  -> S-200 infill (if options.mixedOptions set): generateMixedSizeInfillPoints() called with the
     SAME {seed, spread, edgeThinning} samplerOptions as before IMG-005 (gapMm/checkFixStats
     deliberately not forwarded here, decision 3) -- its own field-mode dispatch still reaches the new
     nudgeOrDropStonePoints() incidentally (gapMm defaulting to 0 on top of its own already-gap-inclusive
     pitchMm), but selectNonOverlappingSizedStones() remains the sole authority on what is actually kept
  -> return new StoneLayout({layerId, sourceMode, stones, checkFixStats})
```

UI flow: `renderImageStudio()` already regenerates the Studio preview on every relevant control edit; it
now also calls `generateImageStonesLive(l, {includeStats:true})` once per render to read
`result.checkFixStats` and paint the Check & Fix report — no new event listeners, no new live-group
wiring (decision 4).

## Out of Scope

* **Vector Contour/Radial (shape/SVG/path/text layers).** `sampleShapeFillPoints()`'s own dedupe pass
  (the vector-sampler counterpart `sampleContourFillPoints()`/`sampleRadialFillPoints()` route through)
  has the identical `stoneSizeMm`-only floor, for the identical RC-002/READ-001 reason. Not touched by
  this milestone — `docs/specifications/IMG-001-ImageToStrass.md`'s roadmap scopes IMG-005 to image
  layers only. Recorded as a new `docs/BACKLOG.md` row (Files Touched).
* **S-200 mixed infill getting its own dedicated repair pass** — decision 3 found (measured, not assumed)
  that it needs none: `selectNonOverlappingSizedStones()` is already the authoritative floor-enforcing
  pass for infill, independent of how its candidates were generated.
* **A user-facing Check & Fix control of any kind** — no toggle, no threshold, no "run fix" button. The
  repair pass always runs for Contour/Radial image layers; there is nothing to configure (decision 5).
* **`IMG-006` (Brightness)** — `#imageStudioGroupBrightness` stays closed and inert, untouched by this
  milestone.
* **Any exporter change** — a nudged or dropped point changes which `Stone`s exist, but every surviving
  stone is still an ordinary `Stone` instance; every exporter already reads `stone.xMm`/`.yMm`/`.sizeMm`/
  `.color` (`docs/specifications/IMG-000-ImageToStrassAudit.md`, "Exporters") with no knowledge of how the
  point was produced.
* **`src/gallery/RhsFixtureBridge.js`** — same omission precedent as IMG-003's `seed`/`spread` and
  IMG-004's `edgeWidthMm`/`edgeThinning` (`docs/specifications/IMG-004-EdgeAwareness.md`, Out of Scope):
  `.rhs` fixtures need no Check & Fix wiring, since `generateImageLayout()`'s repair pass runs
  automatically from `stoneSizeMm`/`gapMm`/`mode` alone — every field a `.rhs` fixture already carries.
* **Relaxing, overriding, or parameterizing the manufacturing floor** — see decision 5. Not a future
  possibility this milestone leaves a hook for; there is no hook.
* **Any project-schema version bump or `validateProject()` change** — `checkFixStats` is a `StoneLayout`
  field, never a `layer.*` project field (decision 4).

## Files Touched

* `src/geometry/StoneSampler.js` — new exported `nudgeOrDropStonePoints(points, insideAt, stoneSizeMm,
  gapMm, stats = null)` beside `dedupeStonePoints()` (`:333`); `sampleContourFieldFillPoints()` (`:1777`)
  and `sampleRadialFieldFillPoints()` (`:1727`) each gain trailing `gapMm = 0, checkFixStats = null`
  parameters, build a placement-aware `insideAtPlaced` closure, and replace their `dedupeStonePoints(...)`
  call (`:1805`, `:1756`) with `nudgeOrDropStonePoints(...)`; `sampleFieldByMode()`'s `'radial'`/
  `'contour'` cases (`:1894`-`:1895`) forward `samplerOptions?.gapMm`/`samplerOptions?.checkFixStats`.
* `src/geometry/index.js` — `nudgeOrDropStonePoints` joins the `StoneSampler.js` re-export list
  `dedupeStonePoints` already sits in (`:48`).
* `src/geometry/GeometryEngine.js` — `generateImageLayout()`'s `sampleFieldByMode()` call (`:1204`) builds
  a `checkFixStats` accumulator (non-null only for `'contour'`/`'radial'`) and forwards `options.gapMm`
  in the `samplerOptions` object; its `return new StoneLayout(...)` (`:1256`) gains `checkFixStats`. The
  S-200 infill call (`:1236`-`:1243`) is deliberately unchanged (decision 3).
* `src/geometry/StoneLayout.js` — constructor (`:39`) gains `checkFixStats = null`; `toJSON()` (`:86`)
  and `fromJSON()` (`:113`) gain the same guarded pass-through `outlineStats` already has (`:96`-`:98`,
  `:121`).
* `app.js` — `generateImageStonesLive()`'s `includeStats` branch (`:994`) gains
  `checkFixStats:result.checkFixStats??null`; `renderImageStudio()` (`:6083`) gains one new
  `engine.generateImageStonesLive(l,{includeStats:true})` call and repaints
  `#imageStudioGroupCheckFix`'s body from its `checkFixStats` (replacing the static
  `index.html:1198` hint via a script-managed element, the same way `imageStudioStatCount` etc. are
  script-managed rather than static markup).
* `index.html` — `#imageStudioGroupCheckFix` (`:1196`-`:1199`) gains an element for the live report,
  replacing the static `<p class="hint">Coming in IMG-005</p>` line; not added to
  `IMAGE_STUDIO_LIVE_GROUP_IDS`.
* `tools/test-img-005-check-and-fix.mjs` (new).
* `tools/test-groups.mjs` — registers the new test file in the `core` (`:62`) and `geometry` (`:183`)
  groups, immediately after `test-img-004-edge-awareness.mjs`, matching that file's own registration
  precedent.
* `docs/specifications/IMG-001-ImageToStrass.md` — roadmap item 5 (`:38`-`:39`) gets one sentence noting
  IMG-005 is scoped to image layers only, per this spec's Out of Scope.
* `docs/BACKLOG.md` — new row in "Deferred technical follow-ups" (after row 54, `:54`), recording that
  vector Contour/Radial's `sampleShapeFillPoints()` dedupe pass carries the identical `stoneSizeMm`-only
  floor `StoneSampler.js`'s field samplers had before this milestone, deliberately out of scope here.
* `docs/specifications/IMG-005-CheckAndFix.md` (this file).

## Compatibility

* `mode` `'fill'`/`'staggered'`/`'organic'`/`'edge'`: byte-identical to before this milestone —
  `sampleFieldByMode()`'s cases for them are untouched, and neither reads `gapMm`/`checkFixStats` from
  `samplerOptions`.
* `sampleContourFieldFillPoints()`/`sampleRadialFieldFillPoints()` called with `gapMm` omitted (every
  pre-IMG-005 call site, since the parameter is new): `gapMm` defaults to `0`, so
  `nudgeOrDropStonePoints()`'s floor is exactly `stoneSizeMm` — identical to `dedupeStonePoints()`'s own
  floor. The two functions are **not** byte-identical in this case, though, because
  `nudgeOrDropStonePoints()` attempts a nudge before dropping where `dedupeStonePoints()` only ever drops
  — a caller passing `gapMm: 0` explicitly can still see a repositioned (not just removed) point set.
  There is no pre-IMG-005 caller of either sampler that omits `gapMm` and depends on the old
  drop-only behavior, so this is not a compatibility break for any real caller — see Test Plan item 9
  for the one caller that does hit this path (S-200 infill) and what is actually asserted about it.
* Every pre-IMG-005 `image` layer with `mode: 'contour'`/`'radial'`: its saved `stoneSizeMm`/`gapMm` are
  unchanged fields, already present since the layer type's introduction — nothing new to default.
  Regenerating it now runs the repair pass and can produce a **different** (denser, in-floor) stone set
  than before this milestone — this is the intended effect of "fixes spacing violations," not a
  regression; Fill/Staggered/Organic/Edge layers of any age are unaffected (previous bullet).
* No `StoneLayout`/`Stone` schema change beyond the new optional `checkFixStats` field (decision 4, same
  precedent as `outlineStats`); no project version bump; no `validateProject()` change.
* `.rhs` fixture format: no `fillMode`/param change — Check & Fix runs automatically from existing fields
  (Out of Scope).

## Test Plan

`tools/test-img-005-check-and-fix.mjs` (new, registered in `tools/test-groups.mjs`'s `core` and
`geometry` groups immediately after `test-img-004-edge-awareness.mjs`):

**Fixtures**, given verbatim as code blocks (the test file copies them), per this repo's "pin the
fixture, not just the numbers" convention (`docs/specifications/IMG-004-EdgeAwareness.md` decision 8
already establishes it — a `disc()`/`frame()` pair given as literal generator code, not just a results
table):

```js
function disc(n) {
  const d = new Uint8ClampedArray(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = x - n / 2 + 0.5, dy = y - n / 2 + 0.5;
    d[y * n + x] = dx * dx + dy * dy < (n * 0.45) ** 2 ? 255 : 0;
  }
  return { widthPx: n, heightPx: n, data: d };
}
function dumbbell(n) {
  const d = new Uint8ClampedArray(n * n);
  const lobeR = n * 0.22;
  const cx1 = n * 0.28, cx2 = n * 0.72, cy = n / 2;
  const neckHalfH = n * 0.06;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx1 = x - cx1 + 0.5, dy1 = y - cy + 0.5;
    const dx2 = x - cx2 + 0.5, dy2 = y - cy + 0.5;
    const inLobe1 = dx1 * dx1 + dy1 * dy1 < lobeR * lobeR;
    const inLobe2 = dx2 * dx2 + dy2 * dy2 < lobeR * lobeR;
    const inNeck = (x + 0.5) >= cx1 && (x + 0.5) <= cx2 && Math.abs(y - cy + 0.5) < neckHalfH;
    d[y * n + x] = (inLobe1 || inLobe2 || inNeck) ? 255 : 0;
  }
  return { widthPx: n, heightPx: n, data: d };
}
```

Both at `n = 200`, placement `{ xMm: 10, yMm: 7, widthMm: 60, heightMm: 60 }`, `stoneSizeMm 2.7`,
`gapMm 0.3` (`spacingMm 3.0`) unless a test item states otherwise. Measured baselines (re-run against
`develop@34e237c` for this document — see Objective):

| fixture | mode | count (pre-fix) | pairs `< spacingMm` (`>= stoneSizeMm`) | min pairwise distance |
|---|---|---|---|---|
| disc | contour | 255 | **286** | 2.7787 mm |
| disc | radial | 245 | 0 | 3.0000 mm |
| dumbbell | contour | 120 | **138** | 2.7467 mm |
| dumbbell | radial | 117 | 0 | 3.0000 mm |

Disc fill/staggered/organic(seed 1,spread 1)/edge(seed 1,spread 1,thinning 1, no `field.edge`
populated — see Objective note): 256/298/182/48 stones, 0 violations each. Dumbbell fill/staggered/
organic/edge (same caveat): 120/141/89/27 stones, 0 violations each. If a later measurement disagrees
with any figure above, stop and report the disagreement — do not adjust either side to make them match.

1. **Regression baseline.** Disc and dumbbell, Contour and Radial, post-fix: violation count (pairs
   `< stoneSizeMm + gapMm`) is exactly `0` for all four cases, using the disc/dumbbell numbers above as
   the pre-fix reference the fix is measured against.
2. **Nudge validity.** Every nudged position (identified via `checkFixStats.repaired` matching a position
   not in the pre-fix candidate set at the same index) satisfies `insideAt()` and is `>= stoneSizeMm +
   gapMm` from every *other* kept point in the final output — an exhaustive pairwise scan, not just
   against the point it was nudged away from.
3. **Nudge-impossible falls back to drop, not a failed nudge left in place.** A small constructed case —
   three already-kept points placed so that a fourth candidate's single-direction nudge away from its
   nearest offender always lands within the floor of at least one of the other two (verified
   computationally in the test file, not hand-derived coordinates) — confirms the candidate is absent
   from the output and `checkFixStats.dropped` incremented, never a point left at a position that still
   violates the floor.
4. **Byte-identity guard.** `nudgeOrDropStonePoints()` called with every candidate already `>=
   stoneSizeMm + gapMm` apart reproduces `dedupeStonePoints(points, stoneSizeMm)`'s output exactly (no
   nudges triggered, `violationsFound === 0`).
5. **Fill/Staggered/Organic/Edge byte-identical.** All four disc and dumbbell outputs (default mode
   dispatch, no `gapMm`/`checkFixStats` read by their `sampleFieldByMode()` cases) are `deepEqual` to
   `develop@34e237c`'s own pre-IMG-005 output at the same seed/pitch — they never reach the new code path
   at all.
6. **`checkFixStats` accounting invariant.** For every disc/dumbbell Contour/Radial run,
   `violationsFound === repaired + dropped`, and `kept.length === (candidateCount - violationsFound) +
   repaired`.
7. **`checkFixStats` is `null` for every non-Contour/Radial mode**, and present (possibly all-zero) for
   every Contour/Radial run, including the zero-violation Radial cases above.
8. **`gapMm` omitted reduces to `dedupeStonePoints()`'s floor exactly `stoneSizeMm`** — called directly
   with `gapMm` unset, `nudgeOrDropStonePoints()`'s accepted set has the same minimum pairwise distance
   `dedupeStonePoints()` already guarantees (`>= stoneSizeMm`), even though it may include repositioned
   points `dedupeStonePoints()` would have dropped outright.
9. **S-200 infill under Contour/Radial mode** (decision 3): disc and dumbbell, `mixedOptions` set,
   Contour and Radial — infill stone count is `>=` the pre-IMG-005 baseline (never lower) and every
   accepted infill stone clears `(a.sizeMm + b.sizeMm)/2 + gapMm` against every other primary and infill
   stone (the same per-pair collision check convention
   `docs/specifications/IMG-003-OrganicPlacement.md`'s own S-200 test case uses).
10. **App-path guard.** `generateImageStonesLive()`'s (`app.js:994`) `includeStats` branch is checked,
    via the same brace-balanced source-text extraction convention `tools/test-autosave-recovery-wiring.mjs`
    and `test-img-004-edge-awareness.mjs`'s own item 14 use, to actually include
    `checkFixStats:result.checkFixStats` in its returned object.
11. **The full `IMG-003`/`IMG-004` suites still pass unchanged** — `tools/test-img-003-organic-placement.mjs`
    and `tools/test-img-004-edge-awareness.mjs` run as part of this milestone's verification and are
    expected to report the exact same results as on `develop@34e237c`.

Report the raw per-test list above in this section, not a pass/fail count, per this repo's testing
policy for shared-architecture milestones.

---

## Anchor verification note

Every line number and function name cited above was re-grepped against this branch's actual
`develop@34e237c` tip (via direct `grep`/`Read`, and a live `node` run of `sampleContourFieldFillPoints()`/
`sampleRadialFieldFillPoints()`/`sampleFieldFillPoints()`/`sampleStaggeredFieldFillPoints()`/
`sampleOrganicFieldFillPoints()`/`sampleEdgeFieldFillPoints()` against the disc and dumbbell fixtures
above, to confirm the violation counts directly rather than trust the brief's own figures) immediately
before writing this document.

The brief that prompted this document attributed the Architectural Rule quoted in decision 5 to
`docs/specifications/IMG-000-ImageToStrassAudit.md`. That file contains no such text — a full-text grep
for "Check & fix", "never violates", and "diameter/2" against it returns nothing. The actual source is
`docs/specifications/IMG-001-ImageToStrass.md:78`-`:83`, in its "Architectural Rules" list, immediately
after the roadmap item 5 entry (`:38`-`:39`) this document's Objective also cites. This document quotes
the real location, not the brief's approximate one — not a disagreement in substance (the quoted text
itself matches verbatim), only in which file carries it.

The brief's disc-fixture violation count (286 same-layer Contour pairs) was independently reproduced by
direct execution against `src/geometry/StoneSampler.js`'s real exported functions (not assumed): 286
pairs strictly under `spacingMm` 3.0 and `>= stoneSizeMm` 2.7, minimum pairwise distance 2.7787 mm,
confirming no literal overlap exists today either. Radial and every other image mode measured zero
violations on the same fixture, also confirmed by direct execution. The dumbbell fixture and its 138/120/
2.7467mm baseline are new measurements for this document — the brief specified the dumbbell's *shape*
(two lobes joined by a narrow neck) but not its own numbers, so this document derived and pinned them by
running the actual sampler against the `dumbbell()` generator above, the same way `IMG-004`'s own `frame()`
baseline (202/288/272) was a first-time measurement in that milestone rather than carried over from
`IMG-003`.
