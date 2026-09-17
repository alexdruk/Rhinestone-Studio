# IMG-004 — Edge Awareness

## Objective

IMG-004 is the fourth of `IMG-001`'s eight-milestone roadmap (`docs/specifications/IMG-001-ImageToStrass.md`
item 4). It adds a sixth image fill mode, `'edge'`, that keeps stones at full Organic density in a band
along every detected edge of the source image and thins the interior — so a traced silhouette stays crisp
with fewer total stones than plain Organic, instead of every region of the image reading the same density
regardless of how much visual information it carries.

The manufacturing floor forbids placing stones closer than `stoneSizeMm + gapMm` (see `CLAUDE.md`,
"Primary Goal", and every existing sampler's own minimum-spacing enforcement). Edge awareness therefore
can only ever **thin away from edges**, never pack an edge tighter than that floor — there is no direction
in which "denser" is a legal move once a region is already at Organic's own minimum spacing. This is
stated explicitly because it is the reason edge awareness is a *thinning* mechanism (interior radius grows
with distance from an edge) rather than a densifying one (edge radius shrinking below the floor), and it is
the same constraint that already shapes every other sampler in this codebase.

Placement is seeded and persisted per layer, same as Organic (`docs/specifications/IMG-003-OrganicPlacement.md`
decision 3) — deterministic regeneration across imports and machines. No exporter change, no
`StoneLayout`/`Stone` schema change — an edge-mode image layer's stones are still ordinary `Stone`
instances (`docs/specifications/IMG-000-ImageToStrassAudit.md`, "Exporters").

## Decisions

1. **Sixth image fill mode `'edge'`.** Added to `IMAGE_SAMPLE_MODES` (`src/geometry/GeometryEngine.js:56`),
   `IMAGE_FILL_MODES` (`app.js:666`), and `SUPPORTED_IMAGE_FILL_MODES`
   (`src/gallery/RhsFixtureBridge.js:49`). A sixth `<option value="edge">Edge - dense along edges, thinner
   inside</option>` joins `#imageFillMode`'s existing five options (`index.html:1159`). **Not** added to
   `SAMPLE_MODES` (`GeometryEngine.js:51`) — same reasoning `docs/specifications/IMG-003-OrganicPlacement.md`
   decision 1 already recorded for `'organic'`: a raster density field has no vector polygon for the mode
   to walk, and the vector-shape samplers (shapes/SVG/text/path/regions) have no edge-detection
   counterpart to dispatch to.

2. **No new sampler module — `samplePoissonDiskPoints()` (`src/geometry/OrganicSampler.js:45`) gains a
   variable-radius mode.** Two new optional arguments: `radiusAt(localXMm, localYMm) -> number` (default
   `null`) and `maxRadiusMm` (required when `radiusAt` is given). Semantics:
   - `rMin = spacingMm * max(1, spread)` — unchanged from today's `r` (`OrganicSampler.js:54`).
   - `cell = rMin / sqrt(2)` — unchanged (`:55`).
   - Neighbourhood reach = `ceil((radiusAt ? maxRadiusMm : rMin) / cell)`. Today's `farEnough()`
     (`:68`-`:85`) hardcodes a 2-cell reach in every direction (`cx - 2` / `cx + 2` /
     `cy - 2` / `cy + 2`, `:70`-`:73`), which is exactly `ceil(rMin / cell) = ceil(sqrt(2)) = 2` — the
     `radiusAt`-null path keeps this literal 2-cell reach; the `radiusAt`-given path replaces it with the
     wider reach the largest possible radius in the field requires, so a neighbour whose own stored radius
     is large is never missed by a search window sized only for `rMin`.
   - Each accepted point stores its own radius, `rc = radiusAt ? radiusAt(x, y) : rMin`, alongside its
     `{xMm, yMm}` in the `points` array `tryAccept()` (`:87`-`:97`) already builds.
   - The Bridson annulus draw (`:108`, `const d = r * (1 + rand())`) becomes `d = rParent * (1 + rand())`,
     using the active point's own stored radius rather than the single module-wide `r`.
   - Acceptance (`farEnough()`, `:68`-`:85`) rejects a candidate when its distance to any neighbour is
     below `max(rc, rNeighbour)` — the *larger* of the candidate's own intended radius and the neighbour's
     already-committed radius, rather than a single shared `r * r` comparison (`:81`).
   - With `radiusAt` null, every one of the above reduces to exactly today's arithmetic — one radius,
     reach 2, `d = r * (1 + rand())`, `farEnough()`'s existing `r * r` comparison — so the existing
     `IMG-003` suite is the byte-identity guard for this path, and Test Plan item 1 below pins it directly.
   - `rand()`-consumption order is unchanged and must stay so: same swap-with-last removal from `active`
     (`:117`-`:118`), same raster re-seed scan (`:122`-`:144`), same `ang`-then-`d` draw order in the
     active-list phase (`:107`-`:108`), same `x`-then-`y` draw order in the re-seed phase (`:132`-`:133`).
     Changing draw order would silently break every seed-pinned count this and `IMG-003`'s own Test Plan
     assert.

   This `radiusAt` hook is the variable-radius primitive `docs/BACKLOG.md` row 52 already anticipated for
   a future luminance-keyed stippling milestone (IMG-006, per that row's own framing) — see decision 8 and
   Out of Scope.

3. **New pure module, `src/image/Edge.js`, exporting `edgeChannel(field, bandRadiusPx)`.** Sobel gradient
   magnitude of `field.data` — 3×3 kernels, clamp-to-edge sampling at the border, the same convention
   `Blur.js`'s `clamp()` helper already uses for its own box-blur passes (`src/image/Blur.js:15`-`:17`) —
   then `min(255, round(hypot(gx, gy) / 4))` per pixel, then a separable square max filter of radius
   `bandRadiusPx` implemented as a monotonic-deque sliding-window maximum: O(`widthPx * heightPx`),
   independent of `bandRadiusPx` — measured 153 ms at 2000×2000px, radius 75px, the same "independent of
   radius" performance shape `Blur.js`'s own doc comment already claims for its box blur
   (`src/image/Blur.js:4`-`:6`). `bandRadiusPx = 0` returns the raw per-pixel Sobel magnitude (the max
   filter degenerates to identity at radius 0). No `src/geometry` import — `src/image/**` never imports
   `src/geometry/**` (`docs/ARCHITECTURE.md`'s directional boundary, RS-1008A); `Edge.js` is a pure
   field-in/field-out transform, exactly like `Blur.js`.

4. **`prepareImageField()` (`src/image/ImageFieldPipeline.js:125`) computes `field.edge` unconditionally**,
   at working resolution, after resize — i.e. from the same `data.data` the returned `field.data` is built
   from (`ImageFieldPipeline.js:139` computes `data`; the `field` object literal at `:144`-`:150` gains an
   `edge` key alongside `data`/`luminance`/`alpha`/`labels`), with `bandRadiusPx = params.edgeBandPx`. New
   `normalizeParams()` (`ImageFieldPipeline.js:39`) validation: `edgeBandPx` an integer `>= 0`, default `0`
   — the same integer-non-negative shape `blurRadiusPx` already validates (`:46`-`:49`). The four lattice
   samplers (Fill/Staggered/Radial/Contour) and plain Organic never read `field.edge` — grep-confirmed
   (`field.edge` appears nowhere in `sampleFillPoints`/`sampleStaggeredFieldFillPoints`/
   `sampleRadialFieldFillPoints`/`sampleContourFieldFillPoints`/`sampleOrganicFieldFillPoints`) — and this
   spec states it so a later reader does not "wire it in" unprompted; only the new `'edge'` sampler (below)
   reads it. The function's own return-shape doc comment (`ImageFieldPipeline.js:118`-`:123`) gains the
   `edge` key.

5. **Field-aware wrapper `sampleEdgeFieldFillPoints(field, placement, spacingMm, stoneSizeMm, {seed, spread,
   edgeThinning})`, in `src/geometry/StoneSampler.js` beside `sampleOrganicFieldFillPoints()`
   (`:1814`).** Built the same way: `const insideAt = (localXMm, localYMm) => fieldPixelOn(field, localXMm,
   localYMm, widthMm, heightMm);` — `fieldPixelOn()` is `StoneSampler.js:1617`. `base = spacingMm * max(1,
   spread)` (the same floor Organic itself uses). `radiusAt = (localXMm, localYMm) => base * (1 +
   edgeThinning * (1 - edgeAt / 255))`, where `edgeAt` reads `field.edge` through the same clamped-floor
   pixel lookup `fieldPixelOn()` already performs against `field.data` — so a point sitting exactly on a
   maximal-edge pixel (`edgeAt = 255`) gets `radiusAt = base` (full Organic density, the floor, never
   below it), and a point in a zero-edge interior gets `radiusAt = base * (1 + edgeThinning)`, the maximum
   thinning this call allows. `maxRadiusMm = base * (1 + edgeThinning)`. Delegates to
   `samplePoissonDiskPoints({ insideAt, widthMm, heightMm, spacingMm, seed, spread, radiusAt,
   maxRadiusMm })`, then offsets each returned local point by `placement.xMm`/`placement.yMm`, exactly like
   `sampleOrganicFieldFillPoints()` (`:1817`). The on-field guarantee is **structural**, same as Organic
   and unlike Contour: every emitted point passed `insideAt()` at acceptance — state this explicitly,
   since Contour's own on-field guarantee is empirical only (`docs/specifications/IMG-003-OrganicPlacement.md`
   decision 2's own contrast). New `'edge'` case in `sampleFieldByMode()` (`:1838`), forwarding
   `samplerOptions` (now potentially carrying `edgeThinning` alongside `seed`/`spread`) unchanged from how
   the `'organic'` case already forwards it (`:1843`).

6. **Two persisted layer fields, permissive defaults, no schema version change** — the same precedent
   `layer.seed`/`layer.spread` already established (`docs/specifications/IMG-003-OrganicPlacement.md`
   decision 3): `edgeWidthMm` (number > 0, default `6`) and `edgeThinning` (number ≥ 0, default `1`).
   `normalizeImageParams()` (`src/geometry/GeometryEngine.js:2257`) gains `edgeWidthMm`/`edgeThinning`,
   defaulted the same permissive way `seed`/`spread` already are, immediately beside those two lines
   (`:2327`-`:2328`). `generateImageLayout()` converts `edgeWidthMm` to `edgeBandPx = round(edgeWidthMm *
   maxWidthPx / widthMm)` for `prepareImageField()` at its existing `prepareImageField()` call site
   (`GeometryEngine.js:1176`), forwarding `{ seed, spread, edgeThinning }` in both the `sampleFieldByMode()`
   call (`:1189`) and the S-200 infill `samplerOptions` (`:1227`). `app.js` gains
   `resolveImageEdgeWidth()`/`resolveImageEdgeThinning()` beside `resolveImageSeed()`/`resolveImageSpread()`
   (`app.js:700`-`:701`).

7. **Studio: `#imageStudioGroupEdges` (`index.html:1190`) becomes live.** `#imgEdgeWidth` (a length input,
   mm) and `#imgEdgeThinning` (a range input, `min="0"` `max="3"` `step="0.1"`), with a hint "Only used
   when Fill style is Edge". `imageStudioGroupEdges` must be added to `IMAGE_STUDIO_LIVE_GROUP_IDS`
   (`app.js:6080`), exactly as `imageStudioGroupOrganic` was added in IMG-003 — otherwise
   `renderImageStudio()` leaves the group inert. Only `imgEdgeWidth`/`imgEdgeThinning` join
   `HISTORY_TRACKED_CONTROL_IDS` (`app.js:4751`); the sync/readback sites gain `edgeWidthMm`/`edgeThinning`
   reads and writes at `app.js:2461` and `app.js:2614` (the same pair `seed`/`spread` already use). The
   enable/disable block (`app.js:6102`-`:6106`) changes its `isOrganic` gate from "mode is organic" to
   "mode is organic or edge" for the seed/shuffle/spread controls — both modes are Poisson-disk-based and
   both read seed/spread — and gains a new `isEdge` gate (`resolveImageFillMode(l.fillMode) === 'edge'`)
   disabling `#imgEdgeWidth`/`#imgEdgeThinning` otherwise, the same disabled-with-a-title treatment the
   Organic controls already get. `#imageStudioGroupCheckFix`/`Brightness` placeholders stay closed and
   inert (IMG-005/IMG-006).

8. **Documented behaviour, not a defect: a feature whose interior is narrower than the thinned radius gets
   no interior stones, and results converge across thinning values once that happens.** On the frame
   fixture below, at a 6mm band, thinning 1 and thinning 2 both produce 171 stones — the frame's own ring
   is narrow enough that the "interior" `radiusAt` would open up never actually fits a second row of
   points once `edgeThinning` passes a certain point, so further thinning has nothing left to remove. This
   is the mechanism working as specified, not a bug to chase: the band keeps the silhouette intact
   regardless of how aggressively the interior is asked to thin.

   **Measured figures.** Both fixture generators below are given verbatim as code blocks; the test file
   (Test Plan) copies them:

   ```js
   function disc(n) {
     const d = new Uint8ClampedArray(n * n);
     for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
       const dx = x - n / 2 + 0.5, dy = y - n / 2 + 0.5;
       d[y * n + x] = dx * dx + dy * dy < (n * 0.45) ** 2 ? 255 : 0;
     }
     return { widthPx: n, heightPx: n, data: d };
   }
   function frame(n) {
     const d = new Uint8ClampedArray(n * n);
     for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
       const m = Math.max(Math.abs(x - n / 2 + 0.5), Math.abs(y - n / 2 + 0.5));
       d[y * n + x] = m >= n * 0.15 && m < n * 0.45 ? 255 : 0;
     }
     return { widthPx: n, heightPx: n, data: d };
   }
   ```

   Both at `n = 200`, placement `{ xMm: 10, yMm: 7, widthMm: 60, heightMm: 60 }`, pitch 3.0, seed 1,
   spread 1, edge computed directly with `edgeChannel(field, round(edgeWidthMm * 200 / 60))` — no
   `prepareImageField()`, so every sampler under comparison reads the identical pixel grid. `edgeWidthMm`
   is the parameter that drives the band column; `edgeThinning` drives the count column.

   Disc, count / stones with `edge === 255` at their own pixel / min pairwise distance:

   | edgeWidthMm | edgeThinning | count | stones with edge===255 at their pixel | min pairwise distance (mm) |
   |---|---|---|---|---|
   | 3 | 0.5 | 111 | 59 | 3.001 |
   | 3 | 1 | 92 | 69 | 3.008 |
   | 3 | 2 | 74 | 65 | 3.019 |
   | 6 | 0.5 | 126 | 87 | 3.001 |
   | 6 | 1 | 113 | 93 | 3.008 |
   | 6 | 2 | 107 | 102 | 3.005 |
   | 9 | 0.5 | 153 | 132 | 3.013 |
   | 9 | 1 | 137 | 127 | 3.004 |
   | 9 | 2 | 129 | 127 | 3.015 |

   Zero off-field stones in every cell above. Disc, 6mm, thinning 1, seeds 1–8: 113, 115, 117, 117, 117,
   119, 111, 113. Disc, 6mm, thinning 0: 182 stones, positionally identical to Organic (thinning 0 makes
   `radiusAt` constant at `base` everywhere, i.e. plain Organic).

   Frame: organic 202, grid 288, contour 272 (`stoneSizeMm` 2.7). The frame fixture is new in IMG-004 —
   it does not come from `docs/specifications/IMG-003-OrganicPlacement.md`'s measured-figures section,
   which only ever used the disc fixture; the 202/288/272 baselines above were measured for the first
   time in this milestone, using the `frame()` generator given above. Edge: 3mm/1 → 115/97, 3mm/2 →
   91/86, 6mm/1 → 171/171, 6mm/2 → 171/171 (the convergence decision 8 describes above).

   If a later measurement disagrees with any figure in this section, stop and report the disagreement —
   do not adjust either side to make them match.

## Structure

Data flow, extending IMG-003's field-and-sampler contract:

```
GeometryEngine.generateImageLayout({..., mode: 'edge', seed, spread, edgeWidthMm, edgeThinning})
  -> normalizeImageParams(): edgeWidthMm/edgeThinning permissively defaulted to 6/1 (beside seed/spread)
  -> edgeBandPx = round(edgeWidthMm * maxWidthPx / widthMm)
  -> prepareImageField(imageBuffer, {..., edgeBandPx})
       -> field.edge = edgeChannel(field.data-at-working-resolution, edgeBandPx)  -- src/image/Edge.js,
          no src/geometry import, unread by the four lattice samplers and plain Organic
  -> sampleFieldByMode('edge', field, placement, spacingMm, stoneSizeMm, {seed, spread, edgeThinning})
       -> dispatches to StoneSampler.js's own sampleEdgeFieldFillPoints(field, placement, ...)
            -> builds insideAt(localXMm, localYMm) from fieldPixelOn(), exactly as
               sampleOrganicFieldFillPoints() already does
            -> radiusAt(localXMm, localYMm) = base * (1 + edgeThinning * (1 - edgeAt/255)), base =
               spacingMm * max(1, spread); edgeAt read from field.edge via the same fieldPixelOn()
               lookup convention
            -> delegates to OrganicSampler.js's samplePoissonDiskPoints({insideAt, widthMm, heightMm,
               spacingMm, seed, spread, radiusAt, maxRadiusMm}) -- the same module, same function,
               generalized in decision 2, not a new sampler
            -> offsets the returned local points by placement.xMm/yMm before returning
  -> every emitted point already on-field (structural, same as Organic)
  -> S-200 infill (if options.mixedOptions set): generateMixedSizeInfillPoints() called with the same
     {seed, spread, edgeThinning} via samplerOptions -- same seed, different (smaller) pitch, same
     structural on-field guarantee
```

UI flow: picking "Edge" in `#imageFillMode` enables `#imgEdgeWidth`/`#imgEdgeThinning` (and, since Edge is
Poisson-disk-based like Organic, also `#imgSeed`/`#imgShuffle`/`#imgSpread`) inside the Edges Studio group;
editing any of the five controls re-runs `generateImageLayout()` and re-renders the live preview and
stats, exactly like every other Studio control's live-regeneration path.

## Out of Scope

* Luminance-keyed variable-radius stippling — `radiusAt` is the shared primitive (decision 2), but keying
  it to `field.luminance` for true brightness-driven density is IMG-006's own decision, not this
  milestone's. `docs/BACKLOG.md` row 52 already deferred this; this spec updates that row's last sentence
  to point at the now-real `radiusAt` hook rather than a hypothetical one.
* Edge snapping for the four lattice modes (Fill/Staggered/Radial/Contour) — pulling their regular-grid
  stones onto the detected boundary is a different mechanism (a post-placement nudge, not a sampling-time
  radius) and is not part of this milestone. Recorded as a new `docs/BACKLOG.md` row (see Files Touched).
* Any change to Fill/Staggered/Radial/Contour/Organic sampling — `sampleFieldByMode()`'s five existing
  cases are untouched; `field.edge` is computed unconditionally but read only by the new `'edge'` case.
* Any exporter change — Edge-mode stones are ordinary `Stone` instances, already handled by every exporter
  that reads `stone.color`/`stone.xMm`/`stone.yMm`/`stone.sizeMm`
  (`docs/specifications/IMG-000-ImageToStrassAudit.md`, "Exporters").
* Densifying beyond the manufacturing floor at an edge — see Objective. `radiusAt` is bounded below by
  `base` (`edgeAt = 255` gives `radiusAt = base`, never less), so this is a structural property of the
  formula, not a runtime check.
* `#imageStudioGroupCheckFix`/`Brightness` — IMG-005/IMG-006 placeholders, stay closed and inert.
* `src/gallery/RhsFixtureBridge.js`'s `generateImageStonesForLayer()` (`:483`-`:504`) — it does not
  forward `seed`/`spread` today (`docs/specifications/IMG-003-OrganicPlacement.md`, Out of Scope), and
  gains no forwarding of `edgeWidthMm`/`edgeThinning` either, the same omission for the
  same reason: `.rhs` fixtures only need `'edge'` to be a *valid* `fillMode` for schema validation, and a
  fixture using it falls back to `generateImageLayout()`'s own defaults (6mm / thinning 1).
* Any project-schema version bump or `validateProject()` change — see decision 6.

## Files Touched

* `src/image/Edge.js` (new) — `edgeChannel(field, bandRadiusPx)`: Sobel magnitude + monotonic-deque max
  filter, pure, field-in/field-out; no `src/geometry` import.
* `src/image/ImageFieldPipeline.js` — `normalizeParams()` (`:39`) gains `edgeBandPx`; `prepareImageField()`
  (`:125`) computes `field.edge` unconditionally via `edgeChannel()` at its `data` construction site
  (`:139`-`:150` neighborhood); its own `@returns` doc comment (`:118`-`:123`) gains the `edge` key.
* `src/geometry/OrganicSampler.js` — `samplePoissonDiskPoints()` (`:45`) gains optional `radiusAt`/
  `maxRadiusMm` params; `farEnough()` (`:68`-`:85`) and the annulus draw (`:108`) generalize to per-point
  stored radii, reducing to today's exact arithmetic when `radiusAt` is omitted (decision 2).
* `src/geometry/StoneSampler.js` — gains its own new exported `sampleEdgeFieldFillPoints(field, placement,
  spacingMm, stoneSizeMm, {seed, spread, edgeThinning})` beside `sampleOrganicFieldFillPoints()` (`:1814`);
  `sampleFieldByMode()` (`:1838`) gains an `'edge'` case dispatching to it, beside the existing `'organic'`
  case (`:1843`).
* `src/geometry/index.js` — `sampleEdgeFieldFillPoints` joins the `StoneSampler.js` re-export list
  `sampleOrganicFieldFillPoints` already sits in (`:44`).
* `src/geometry/GeometryEngine.js` — `IMAGE_SAMPLE_MODES` (`:56`) gains `'edge'`; `normalizeImageParams()`
  (`:2257`) gains `edgeWidthMm`/`edgeThinning` beside `seed`/`spread` (`:2327`-`:2328` neighborhood);
  `generateImageLayout()` converts `edgeWidthMm` to `edgeBandPx` at its `prepareImageField()` call site
  (`:1176`) and forwards `edgeThinning` at `:1189` and `:1227` (both already forward `seed`/`spread`).
* `app.js` — `IMAGE_FILL_MODES` (`:666`) gains `'edge'`; new `resolveImageEdgeWidth()`/
  `resolveImageEdgeThinning()` beside `resolveImageSeed()`/`resolveImageSpread()` (`:700`-`:701`
  neighborhood); sync at `:2461` and readback at `:2614` gain `edgeWidthMm`/`edgeThinning`;
  `HISTORY_TRACKED_CONTROL_IDS` (`:4751`) gains `imgEdgeWidth`/`imgEdgeThinning`;
  `IMAGE_STUDIO_LIVE_GROUP_IDS` (`:6080`) gains `imageStudioGroupEdges`, exactly as
  `imageStudioGroupOrganic` was added in IMG-003 — without it the group stays inert regardless of the
  enable/disable block below; the enable/disable block
  (`:6102`-`:6106`) widens `isOrganic` to "organic or edge" and adds a new `isEdge` gate for the two new
  controls.
* `index.html` — `#imageFillMode` (`:1159`) gains a sixth `<option value="edge">`;
  `#imageStudioGroupEdges` (`:1190`) filled in with `#imgEdgeWidth`/`#imgEdgeThinning`.
* `tools/test-img-004-edge-awareness.mjs` (new).
* `tools/test-groups.mjs` — registers the new test file in the `core`/`geometry` groups, immediately after
  `test-img-003-organic-placement.mjs` (`:61`, `:181`).
* `docs/specifications/IMG-001-ImageToStrass.md` — roadmap item 4 (`:35`-`:36`) gets one sentence
  recording that the "new sampling code" it anticipated turned out to be a generalization of IMG-003's
  existing `samplePoissonDiskPoints()`, not a new sampler.
* `docs/specifications/IMG-000-ImageToStrassAudit.md` — the IMG-003 note (`:26`-`:30`) gets one sentence
  noting IMG-004 reuses the same (now generalized) fifth sampler via `radiusAt`, rather than adding a
  sixth.
* `docs/ARCHITECTURE.md` — new module-table row for `src/image/Edge.js` immediately after the
  `OrganicSampler.js` row (`:750`); that row's own "nothing else in `src/**`" caller note is updated to
  record that `samplePoissonDiskPoints()` is now also called with `radiusAt`/`maxRadiusMm` (IMG-004),
  still with `StoneSampler.js` as its only caller.
* `docs/BACKLOG.md` — row 52's last sentence is updated to point at the now-real `radiusAt` hook (was
  hypothetical, describing what a variable-radius variant "would need"); a new row is added recording the
  lattice-mode edge-snapping deferral (see Out of Scope).
* `docs/specifications/IMG-004-EdgeAwareness.md` (this file).

## Compatibility

* `mode` omitted, or any of `'fill'`/`'staggered'`/`'radial'`/`'contour'`/`'organic'`: byte-identical to
  before this milestone. `field.edge` is computed unconditionally but read by no existing sampler;
  `sampleFieldByMode()`'s five existing cases ignore the widened `samplerOptions` shape entirely.
* `samplePoissonDiskPoints()` called without `radiusAt` (every pre-IMG-004 call site, including
  `sampleOrganicFieldFillPoints()` itself, which does not pass it): byte-identical output to before this
  milestone — see decision 2's reduction argument, pinned by Test Plan item 1.
* Every pre-IMG-004 saved `image` layer has no `edgeWidthMm`/`edgeThinning` fields and resolves to `6`/`1`
  — the documented defaults — the same "nothing to distinguish an old project from a freshly authored one"
  property `seed`/`spread` already established.
* No `StoneLayout`/`Stone` schema change; no project version bump; no `validateProject()` change —
  `edgeWidthMm`/`edgeThinning` are new, optional, permissively-defaulted layer fields, the same precedent
  `layer.seed`/`layer.spread` (IMG-003), `layer.colorCount` (IMG-002), and `layer.transparent` (IMG-001)
  already established.
* `.rhs` fixture format (`src/gallery/RhsFixtureBridge.js`): `'edge'` becomes a valid `fillMode` value;
  fixtures using it fall back to `generateImageLayout()`'s own `edgeWidthMm`/`edgeThinning` defaults,
  matching how `seed`/`spread` are already never forwarded through that bridge (see Out of Scope).

## Test Plan

`tools/test-img-004-edge-awareness.mjs` (new, registered in `tools/test-groups.mjs`'s `core` and
`geometry` groups immediately after `test-img-003-organic-placement.mjs`):

1. `samplePoissonDiskPoints()` called without `radiusAt` reproduces the existing IMG-003 baseline counts
   (182/90/317 across the three pitch-table rows) and the existing spread sweep (182/111/78/45/22) —
   the byte-identity guard for decision 2's generalization.
2. `edgeThinning: 0` on the disc fixture `deepEqual`s plain Organic's own output at the same
   seed/pitch/spread (both reduce to a constant `radiusAt = base`).
3. The disc table (decision 8) — exact count, exact "stones with `edge===255` at their pixel" count, for
   all nine `(edgeWidthMm, edgeThinning)` pairs.
4. Seed band: disc, 6mm, thinning 1, seeds 1–8 reproduce 113/115/117/117/117/119/111/113 exactly.
5. The frame table (decision 8) — organic/grid/contour baselines plus all four edge cells, including the
   171/171 convergence at 6mm thinning 1 vs. thinning 2.
6. Minimum-pairwise-distance invariant: since `samplePoissonDiskPoints()` returns only `{xMm, yMm}` and
   its return shape does not change, the test recomputes each point's `rc` itself from `field.edge` at
   that point's pixel, using the same `radiusAt` formula (`base * (1 + edgeThinning * (1 - edgeAt /
   255))`), then checks every pair via exhaustive scan against `max(rc_i, rc_j)`. Separately, in every
   disc cell, asserts the observed minimum pairwise distance is `>= pitch`, matching the table's last
   column.
7. Zero off-field stones: every accepted point's own pixel is at/above `FIELD_ON_THRESHOLD`, checked via a
   local copy of `fieldPixelOn()`'s lookup convention, across the disc and frame fixtures.
8. `edgeChannel()`'s monotonic-deque max filter equals a naive O(`width*height*radius²`) max filter at
   five spot pixels on a 64×64 random field, radius 5.
9. `prepareImageField()` returns an `edge` key of the working (post-resize) size; `edgeBandPx: 0` yields
   the raw Sobel magnitude (all-zero on a uniform field, since a constant field has zero gradient
   everywhere).
10. Round-trip: `edgeWidthMm`/`edgeThinning` persist through `normalizeImageParams()`; invalid values
    (non-positive `edgeWidthMm`, negative `edgeThinning`) fall back to `6`/`1`.
11. S-200 mixed infill in `'edge'` mode: every infill point is on-field (same per-pair collision check
    convention `docs/specifications/IMG-003-OrganicPlacement.md`'s own S-200 test case uses).
12. The four lattice modes and plain Organic produce identical output whether or not `field.edge` is
    present on the field passed to `sampleFieldByMode()` — proves the addition disturbs nothing about the
    five existing modes.

Report the raw per-test list above in this section, not a pass/fail count, per this repo's testing policy
for shared-architecture milestones.

---

## Anchor verification note

Every line number cited above was re-grepped against this branch's actual `develop@2b13b51` tip
immediately before writing this document; none disagreed with the milestone brief this spec was written
from. One citation was given as an approximation in the brief (`normalizeImageParams()` "around
`GeometryEngine.js:2325`") — the real anchor for the `seed`/`spread` default lines it was pointing at is
`:2327`-`:2328` (an `IMG-003`-labeled comment block occupies `:2323`-`:2326` immediately above them, which
is what the brief's `:2325` actually lands inside) — not a disagreement, since "around" already hedged it,
but this document cites the precise lines rather than repeating the approximation.
