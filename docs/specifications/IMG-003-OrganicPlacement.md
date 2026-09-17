# IMG-003 — Organic Placement

## Objective

IMG-003 is the third of `IMG-001`'s eight-milestone roadmap (`docs/specifications/IMG-001-ImageToStrass.md`
item 3). It adds a fifth image fill mode, `'organic'`, that places stones with a Bridson Poisson-disk
(blue-noise) sampler instead of a regular grid — a non-grid, hand-set look distinct from Grid/Staggered/
Radial/Contour Fill's regular patterns, as `IMG-001-ImageToStrass.md` item 3 anticipated. Placement is
seeded and persisted per layer so regeneration is deterministic across imports and machines. No exporter
change, no `StoneLayout`/`Stone` schema change — an organic-mode image layer's stones are still ordinary
`Stone` instances, exactly what every exporter already reads (`docs/specifications/IMG-000-ImageToStrassAudit.md`,
"Exporters" section).

## Decisions

1. **Fifth image fill mode `'organic'`.** Added to `IMAGE_SAMPLE_MODES`
   (`src/geometry/GeometryEngine.js:54`), `IMAGE_FILL_MODES` (`app.js:666`), and
   `SUPPORTED_IMAGE_FILL_MODES` (`src/gallery/RhsFixtureBridge.js:49`). **Not** added to `SAMPLE_MODES`
   (`src/geometry/GeometryEngine.js:51`, the vector-shape mode set shapes/SVG/text/path/regions
   validate against) — `'organic'` samples a raster density field the way the other three
   `IMAGE_SAMPLE_MODES`-only modes do; there is no vector polygon for it to walk.

   A fifth `<option value="organic">` joins `#imageFillMode`'s existing four options
   (`index.html:1159`).

   `resolveImageFillMode()`'s exact source text —
   `function resolveImageFillMode(value){return IMAGE_FILL_MODES.has(value)?value:'fill'}`
   (`app.js:695`) — is pinned verbatim by `tools/test-fill-algorithms-integration.mjs`'s regex at
   `:132` and must not change. The regex matches the function body's own text, not `IMAGE_FILL_MODES`'s
   member list, so `IMAGE_FILL_MODES` gaining `'organic'` does not touch what that regex asserts;
   `resolveImageFillMode()` itself needs no edit — `'organic'` resolves through the same
   `IMAGE_FILL_MODES.has(value)` check every other mode already does.

2. **Bridson Poisson-disk sampler, split across two modules the way `ContourRingSampler.js` already
   splits from `StoneSampler.js`.** The pure geometry generator lives in a new sibling module,
   `src/geometry/OrganicSampler.js`, exporting:
   ```js
   samplePoissonDiskPoints({ insideAt, widthMm, heightMm, spacingMm, seed = 1, spread = 1 })
   ```
   working in LOCAL mm (0,0-rooted) — the same convention `computeInwardRingPolygons({ insideAt,
   boundingBox, spacingMm, startOffsetMm })` already uses for its own `boundingBox: { minXmm: 0,
   minYmm: 0, maxXmm: widthMm, maxYmm: heightMm }` contract (`src/geometry/StoneSampler.js:1768`).
   `insideAt(localXMm, localYMm) -> boolean` is supplied by the caller — `samplePoissonDiskPoints()`
   never reads `field.data` and carries no `FIELD_ON_THRESHOLD` of its own. It takes no `stoneSizeMm`:
   the algorithm never reads it — the only spacing floor is `r = spacingMm * max(1, spread)` (below),
   and there is deliberately no `dedupeStonePoints()` pass, which is the one place
   `sampleRadialFieldFillPoints()`/`sampleContourFieldFillPoints()` actually use their own
   `stoneSizeMm` (`src/geometry/StoneSampler.js:1738`/`:1787`).

   The field-aware counterpart, `sampleOrganicFieldFillPoints(field, placement, spacingMm, stoneSizeMm,
   {seed, spread})`, is exported from `src/geometry/StoneSampler.js` itself (not `OrganicSampler.js`)
   and is what `sampleFieldByMode()`'s new `'organic'` case dispatches to. It builds
   `const insideAt = (localXMm, localYMm) => fieldPixelOn(field, localXMm, localYMm, widthMm,
   heightMm);` — read verbatim from `sampleContourFieldFillPoints()`'s own identical construction just
   above its `computeInwardRingPolygons()` call (`src/geometry/StoneSampler.js:1767`) — calls
   `samplePoissonDiskPoints({ insideAt, widthMm, heightMm, spacingMm, seed, spread })`, then offsets
   each returned local point by `placement.xMm`/`placement.yMm` before returning, the same way
   `sampleContourFieldFillPoints()` offsets each ring
   (`const placedRing = ring.map((p) => ({ xMm: xMm + p.xMm, yMm: yMm + p.yMm }));`, `:1776`).
   `sampleOrganicFieldFillPoints()` keeps `stoneSizeMm` in its own parameter list only for dispatcher-
   signature symmetry — `sampleFieldByMode()` passes `stoneSizeMm` positionally to every mode — and
   deliberately does **not** forward it to `samplePoissonDiskPoints()`. This is written out so a later
   reader does not "fix" the wrapper by threading a parameter the sampler has no use for.

   `samplePoissonDiskPoints()` will be re-exported from `src/geometry/index.js` beside the
   `ContourRingSampler.js` block (`:69`) — the same "nothing else in `src/**`" ownership the
   implementation step's own `docs/ARCHITECTURE.md` module-table row will record (beside `:749`; see
   Files Touched for why that row does not land in this spec-authoring commit), naming
   `StoneSampler.js` as its only caller; `sampleOrganicFieldFillPoints()` will join the existing
   `StoneSampler.js` re-export list `sampleContourFieldFillPoints` already sits in. This deliberately
   avoids a third hand-matched `FIELD_ON_THRESHOLD` copy across the `src/image`/`src/geometry`
   boundary — `docs/specifications/IMG-002-ColorLayers.md`'s "Files Touched" section already records
   why there are exactly two such copies today (`StoneSampler.js`'s own `FIELD_ON_THRESHOLD` and
   `src/image/ColorQuantize.js`'s hand-matched copy of it), not three; a design that had
   `samplePoissonDiskPoints()` take `field` directly and test pixels itself would have needed its own
   third copy of that threshold, with no test pinning it the way the existing two are pinned. Taking
   `insideAt` as an opaque predicate instead means `OrganicSampler.js` never needs to know what
   "on-field" means at all.

   Algorithm, specified exactly:
   - Minimum centre distance `r = spacingMm * max(1, spread)`.
   - Background grid over the placement box, cell size `r / sqrt(2)` (the standard Bridson cell size
     that guarantees at most one accepted point per cell).
   - 30 candidates per active point, drawn in the annulus `[r, 2r]` around it.
   - A candidate is accepted only if: it lies inside the placement box; `insideAt(localXMm, localYMm)`
     returns true; and it has no already-accepted point within `r`.
   - The next active point is chosen by the PRNG (not simply the most-recently-added point — this is
     what keeps the frontier from collapsing into a single directional sweep).
   - Island re-seed scan, pinned exactly — the measured figures below depend on both rules:
     (a) When the active list empties, a scan cursor walks the background grid in raster order and
     **never rewinds**. Each time the scan finds an empty cell whose 30 seeded candidates yield an
     acceptable point, the Bridson active-list phase runs from that one point to full exhaustion (its
     own active list empties again) before the scan resumes — at the cell *after* the one that just
     seeded it, never from the start. So every background cell is examined at most once across the
     whole run, and the scan terminates the first time one full pass over the remaining cells accepts
     nothing. This is what covers disconnected islands in the source field — plain Bridson
     (active-list-only, no re-seed) would stop at the first island it happens to start sampling in and
     never reach a second, unconnected blob.
     (b) Each of the 30 attempts in an empty cell draws its candidate as
     `((cellX + rand()) * cellSize, (cellY + rand()) * cellSize)` in local mm — a uniform draw confined
     to that one cell, never a draw over the whole placement box.
     A rewinding scan, or a whole-box draw for the re-seed attempts, is the same algorithm in spirit
     but will not reproduce the counts below — the Test Plan's literal counts pin the implementation
     to exactly these two rules.
   - Output order is acceptance order (no post-hoc sort) — candidate generation order is itself already
     seed-determined, so this is not an additional source of nondeterminism.
   - No `dedupeStonePoints()` pass: the minimum-distance floor is enforced at acceptance time (the `r`
     check above), not as a separate pruning pass the other four field samplers rely on for their own
     construction (`sampleRadialFieldFillPoints()`/`sampleContourFieldFillPoints()` both end by calling
     `dedupeStonePoints()`, `src/geometry/StoneSampler.js:1738`/`:1787`). Organic doesn't need it because
     its acceptance criterion already *is* the minimum-distance floor, checked against every prior
     accepted point before a candidate is kept, not after.

   PRNG is `mulberry32`, the exact algorithm at `src/renderer/CrystalAppearance.js:29`:
   ```js
   function mulberry32(seed) {
     let a = seed >>> 0;
     return function next() {
       a = (a + 0x6d2b79f5) | 0;
       let t = Math.imul(a ^ (a >>> 15), 1 | a);
       t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
       return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
     };
   }
   ```
   `OrganicSampler.js` keeps its own private copy of this function rather than importing
   `CrystalAppearance.js`'s — `src/geometry` does not import `src/renderer` (the same directional
   boundary `docs/ARCHITECTURE.md`'s module table already enforces for every other `src/geometry/**`
   row). `mulberry32` is module-private in `CrystalAppearance.js` (grep-confirmed: `^export` in that
   file matches only `crystalSeedForStone`, `SPARKLE_VARIANT_COUNT`, and `getCrystalAppearance` —
   `mulberry32` itself carries no `export` keyword at `:29`), so there is nothing to import even if the
   boundary allowed it, and adding an `export` there is out of scope for this milestone — unlike
   `FIELD_ON_THRESHOLD`, which IMG-002 *did* export from `StoneSampler.js` specifically so a parity
   test could import both copies (`docs/specifications/IMG-002-ColorLayers.md`, "Files Touched"). See
   the Test Plan for how the two `mulberry32` copies are pinned instead, without an export.

   This re-establishes the on-pixel property **by construction**: every emitted point passed
   `insideAt()` — `StoneSampler.js`'s own `fieldPixelOn()`, under the hood — before being accepted,
   exactly like Fill/Staggered/Radial and *unlike* Contour, whose on-pixel guarantee is empirical
   rather than structural (`docs/specifications/IMG-002-ColorLayers.md` decision 1: Contour's points
   come from walking traced ring edges with no per-point field test, verified zero-off-field only by
   measurement across thousands of stones). Because Organic's guarantee is structural like the other
   three non-Contour modes, `fieldLabelAt()`'s (`src/geometry/StoneSampler.js:1645`) `NO_LABEL`
   fallback stays dead code for Organic under IMG-002's color-labeling path, the same as it already
   does for Fill/Staggered/Radial.

   **Measured figures** (measured on a 200px disc in a 60×60 mm box at a `(10, 7)` mm placement offset,
   `spread: 1` unless noted):
   | pitch (mm) | organic | grid | staggered | contour | measured min centre distance (mm) |
   |---|---|---|---|---|---|
   | 3.0 | 182 | 256 | 298 | 255 | 3.003 |
   | 4.3 | 90 | 120 | 142 | 121 | 4.317 |
   | 2.2 | 317 | 477 | 548 | 479 | 2.202 |

   Zero off-field points in every run. Seeds 1 through 20 (same disc, same pitch) give 174 to 186
   stones. Spread 1 / 1.25 / 1.5 / 2 / 3 gives 182 / 111 / 78 / 45 / 22 stones, with the measured minimum
   centre distance landing at `3 × spread` mm each time (i.e. `r` itself, confirming the acceptance
   check is the actual binding constraint, not an artifact of one measurement). 368 stones over a
   200×120 mm placement at pitch 2.2 mm complete in 22 ms.

   Organic at a given pitch carries roughly 60% of Staggered's stone count at that same pitch — stated
   plainly: this is inherent to blue-noise packing (a Poisson-disk process trades perfect density for
   an irregular, non-aligned point distribution, so it can never pack as tightly as a lattice at the
   same minimum spacing) and not a defect to fix in a later milestone. `S-200` Mixed Stone Size infill
   is the intended complement for callers who want Organic's look with grid-comparable density —
   Decision 4 below wires it through.

3. **Persistence: `layer.seed` and `layer.spread`.** `layer.seed` (integer ≥ 0; absent or invalid
   resolves to `1`) and `layer.spread` (number ≥ 1; absent or invalid resolves to `1`) — read-site
   permissive defaults via two new helpers, `resolveImageSeed()`/`resolveImageSpread()`, declared beside
   `resolveImageFillMode()` (`app.js:695`). No `validateProject()` change, no project version bump —
   the same precedent `layer.transparent` and `layer.colorCount` already established
   (`docs/specifications/IMG-001-ImageToStrass.md`/`IMG-002-ColorLayers.md`, "Compatibility").

   Default seed is a fixed `1`, not random: the same image at the same params must produce the same
   layout across imports and across machines, matching every other deterministic-by-default generation
   path in this codebase. The fresh-import layer literal at `app.js:5181` gains `seed:1, spread:1`
   alongside its existing `colorCount:1`.

   `normalizeImageParams()` (`src/geometry/GeometryEngine.js:2254`) gains `seed`/`spread`, defaulted the
   same permissive way `colorCount`/`palette`/`colorMap` already are there (`:2317`-`:2319`).
   `generateImageLayout()` (`:1171`) forwards `{seed, spread}` to `sampleFieldByMode()` as its new sixth
   `samplerOptions` argument (Decision 4).

   Any new `app.js` default constant here must be a plain literal, not a computed expression. Several
   test harnesses `new Function()`-evaluate a fixed span of `app.js` starting at
   `const DEFAULT_TEXT_FONT_ID=` (`app.js:176`, **not** `'use strict'` at `:173`) through
   `validateProject()` (`:1072`) — `appJs.indexOf('const DEFAULT_TEXT_FONT_ID=')` marks that span's
   start in `tools/test-project-validation-security.mjs:46` and `tools/test-s200-app-integration.mjs:159`
   (grep-confirmed: both call sites read identically). This is the same constraint
   `imageColorPalette()`'s module-level cache pattern already respects at `app.js:706`-`:707`
   (`let imageColorPaletteCache=null; function imageColorPalette(){...}` — a lazily-computed cache
   behind a function, not a top-level computed constant).

4. **Mixed infill under Organic.** `sampleFieldByMode()` (`src/geometry/StoneSampler.js:1805`) gains an
   optional sixth parameter, `samplerOptions = null`, passed through only to the `'organic'` case (every
   other case ignores it, so `'fill'`/`'staggered'`/`'radial'`/`'contour'` stay byte-identical — no
   existing call site anywhere in the codebase passes a sixth argument today, so this is purely
   additive).

   `generateMixedSizeInfillPoints()` (`src/geometry/MixedSizeGenerator.js:228`) gains an optional
   `samplerOptions` argument and, at its `sampleFieldByMode()` call site (`:237`, currently
   `sampleFieldByMode(mode, source.field, source.placement, pitchMm)`), passes it as:
   ```js
   sampleFieldByMode(mode, source.field, source.placement, pitchMm, pitchMm, samplerOptions)
   ```
   `pitchMm` is passed explicitly as the fifth argument (rather than left to default) specifically so
   that adding the sixth argument does not disturb the existing `stoneSizeMm = spacingMm` default the
   four existing modes rely on — this keeps `'fill'`/`'staggered'`/`'radial'`/`'contour'` infill output
   byte-identical to today's. `generateImageLayout()`'s own infill call site
   (`src/geometry/GeometryEngine.js:1219`-`:1225`) passes `samplerOptions: { seed: options.seed, spread:
   options.spread }` alongside its existing `mode`/`source`/`mixedOptions`/`gapMm`/`baseStones` fields.

   The base pass and the infill pass use the same seed. No derived per-pass seed is introduced or
   needs documenting: the infill pass already samples at the smaller infill pitch
   (`infillPitchMm()`-derived, `src/geometry/MixedSizeGenerator.js`), which on its own produces a
   different candidate sequence from the base pass even with an identical seed and identical PRNG
   state progression — there is no risk of the two passes producing coincident point sets.

   This is the one additive, optional change to `MixedSizeGenerator.js`; `generateMixedSizeInfillStones()`
   (`:255`, the shape/svg/path Stone-wrapping convenience) is unaffected — image layers already call
   `generateMixedSizeInfillPoints()` directly, not that wrapper (`docs/specifications/IMG-002-ColorLayers.md`,
   Structure).

5. **Studio Organic group.** `#imageStudioGroupOrganic` (`index.html:1183`-`:1186`, the closed
   `Coming in IMG-003` placeholder `IMG-007`/IMG-002 reserved) gets real content and joins
   `IMAGE_STUDIO_LIVE_GROUP_IDS` (`app.js:6068`), open by default like Colours — it stops being one of
   the still-inert placeholders once it has content, matching the precedent
   `docs/specifications/IMG-002-ColorLayers.md` decision 4 set for Colours.

   Contents:
   - `#imgSeed` — number input, `min="0"`, `step="1"`.
   - `#imgShuffle` — a button, wired the same way `#imgColorReset` already is (`app.js:5200`:
     `el('imgColorReset').onclick=()=>{const l=selectedLayer();if(!l||l.type!=='image')return;commitHistory();l.colorMap={};updateAll(true)}`):
     ```js
     el('imgShuffle').onclick=()=>{const l=selectedLayer();if(!l||l.type!=='image')return;commitHistory();l.seed=resolveImageSeed(l.seed)+1;updateAll(true)};
     ```
     `updateAll(true)` for the same reason `#imgColorReset` uses it: a discrete action that commits its
     own history entry rather than the generic `HISTORY_TRACKED_CONTROL_IDS` input/change session
     coalescing.
   - `#imgSpread` — range input, `min="1"`, `max="2.5"`, `step="0.05"`, paired with a live-value
     readout span (the `#monogramLetterSpacingValue` precedent, `index.html:875` /
     `app.js:5540`: `<label>Spread <span id="imgSpreadValue" class="hint"></span></label>`, updated
     inside `renderImageStudio()` with the current numeric value — no unit suffix, since spread is a
     dimensionless multiplier, not a length).

   `#imgSeed` and `#imgSpread` join `HISTORY_TRACKED_CONTROL_IDS` (`app.js:4743`); `#imgShuffle` does
   not. `#imgColorReset` **is** already listed inside `HISTORY_TRACKED_CONTROL_IDS` (`:4743`) — but a
   `<button>` fires neither `'input'` nor `'change'`, the only two events the loop right below it wires
   (`:4744`: `el(id).addEventListener('input',...); el(id).addEventListener('change',...)`), so that
   membership does nothing. It is vestigial — left over from before `#imgColorReset` got its own
   `onclick` (`:5200`) and never removed from the array. IMG-003 does not copy the vestigial pattern:
   `#imgShuffle` gets its own `onclick` (Contents, above) and stays out of the
   `HISTORY_TRACKED_CONTROL_IDS` array entirely.

   `renderImageStudio()` (`app.js:6069`) disables `#imgSeed`/`#imgShuffle`/`#imgSpread` with an
   explanatory `title` while `resolveImageFillMode(l.fillMode) !== 'organic'` — the same
   disabled-with-a-hint treatment `#stoneColor` already gets while `colorCount > 1`
   (`docs/specifications/IMG-002-ColorLayers.md` decision 4).

   Sync at `app.js:2455` (the `imgThreshold`/`imgInvert`/`imgTransparent`/`imgBlurRadius`/
   `imgMaxWidth`/`imgMaxHeight`/`imgColorCount` block) and readback at `app.js:2606`/`:2611` (the
   image-layer readback branch) both gain `seed`/`spread` reads and writes, using
   `resolveImageSeed()`/`resolveImageSpread()` at the sync site the same way `resolveImageFillMode()`
   is used there today (`:2448`).

   The three new control ids join the studio id list `tools/test-ui-shell-structure.mjs` asserts
   against — at `:204`, the second of test 9's two consecutive loops: `:201` iterates container/group
   ids (`imageStudioGroupColors`, `imageStudioGroupOrganic`, etc.) and already contains
   `imageStudioGroupOrganic` from IMG-002/IMG-007's placeholder reservation, so IMG-003 changes nothing
   there; `:204` iterates editing-control ids (`imgThreshold` through `imgColorCount`/`imgColorReset` —
   IMG-002's own control ids), which is where `imgSeed`/`imgShuffle`/`imgSpread` belong. See the Anchor
   verification note at the end of this document.

   Edges/CheckFix/Brightness placeholders (`#imageStudioGroupEdges`/`CheckFix`/`Brightness`) stay closed
   and inert — unrelated to this milestone (IMG-004/005/006).

6. **Browser baseline (MAINT-007).** `src/geometry/OrganicSampler.js` and the new `index.html` markup
   both fall inside `tools/test-browser-baseline.mjs`'s scan set automatically — it scans every tracked
   `.js` file under `src/` (recursively, via `jsFilesUnder()`) plus `app.js` and `index.html` by
   construction (`tools/test-browser-baseline.mjs:99`-`:103`), so a brand-new file needs no separate
   registration to be covered. `CLAUDE.md`'s "Browser baseline (MAINT-007)" section (`:187`) is a
   standing rule, not a one-time gate, and applies to every line IMG-003 adds.

   Everything IMG-003 adds is Chrome 103-compatible. What that rules out for this milestone
   specifically: the neighbour-check (the `r`-distance test against already-accepted points) and the
   island-scan bookkeeping (tracking which background-grid cells already hold an accepted point) must
   use plain `Set`/`Map` `.has()`/`.add()`/`.set()`/`.get()` and typed arrays only — **no** `Set.prototype`
   methods newer than Chrome 103, i.e. no `.union()`, `.intersection()`, or `.difference()` anywhere in
   `OrganicSampler.js`. (`tools/test-browser-baseline.mjs` does not itself scan for these — see its own
   header comment, `:9`-`:12` — so this is a hand-followed rule for this file, not a guard that would
   catch a violation automatically.) No CSS nesting, `:has()`, or container queries in the new
   `index.html` markup either — the Organic group's markup is plain `<details>`/`<label>`/`<input>`
   elements with no new stylesheet rules, the same flat structure every other Studio group already
   uses.

## Structure

Data flow, extending IMG-002's field-and-label contract:

```
GeometryEngine.generateImageLayout({..., mode: 'organic', seed, spread})
  -> normalizeImageParams(): seed/spread permissively defaulted to 1/1
  -> sampleFieldByMode('organic', field, placement, spacingMm, stoneSizeMm, {seed, spread})
       -> dispatches to StoneSampler.js's own sampleOrganicFieldFillPoints(field, placement, ...)
            -> builds insideAt(localXMm, localYMm) from the module-private fieldPixelOn(), exactly
               as sampleContourFieldFillPoints() already does for computeInwardRingPolygons()
            -> delegates to OrganicSampler.js's samplePoissonDiskPoints({insideAt, widthMm,
               heightMm, spacingMm, seed, spread}) -- no stoneSizeMm; the wrapper accepts it only
               for dispatcher-signature symmetry and does not forward it, see decision 2 -- (new
               module; imported by StoneSampler.js only) -- pure Bridson Poisson-disk sample in
               local mm, on-field by construction via insideAt at every acceptance, never a
               post-hoc prune
            -> offsets the returned local points by placement.xMm/yMm before returning
  -> every emitted point already on-field -> fieldLabelAt()'s NO_LABEL fallback (IMG-002 color
     labeling) stays dead code for organic, same as Fill/Staggered/Radial
  -> S-200 infill (if options.mixedOptions set): generateMixedSizeInfillPoints() called with the
     same {seed, spread} via its new samplerOptions argument -- same seed, different (smaller) pitch,
     so no coincident point sets between base and infill passes
```

UI flow: picking "Organic" in `#imageFillMode` enables `#imgSeed`/`#imgShuffle`/`#imgSpread` inside the
Organic Studio group (`renderImageStudio()`); editing seed or spread, or clicking Shuffle, re-runs
`generateImageLayout()` with the new params and re-renders the live preview and stats, exactly like
every other Studio control's live-regeneration path.

## Out of Scope

* Edge/check-fix/brightness generation — IMG-004 through IMG-006 placeholders
  (`#imageStudioGroupEdges`/`CheckFix`/`Brightness`) stay closed and inert.
* Any change to Fill/Staggered/Radial/Contour sampling — `sampleFieldByMode()`'s four existing cases
  are untouched; `samplerOptions` is read only by the new `'organic'` case.
* Any exporter change — Organic-mode stones are ordinary `Stone` instances, already handled by every
  exporter that reads `stone.color`/`stone.xMm`/`stone.yMm`/`stone.sizeMm`
  (`docs/specifications/IMG-000-ImageToStrassAudit.md`, "Exporters").
* Closing the density gap versus Staggered Fill at the same pitch — the ~60% stone-count figure
  (decision 2) is inherent to blue-noise packing, not a defect; `S-200` Mixed infill (decision 4) is
  the documented way to add density on top of Organic, not a change to Organic's own sampler.
* Luminance-driven density (true stippling — darker source regions denser, a variable-radius Poisson
  disk keyed to `field.luminance`) — deferred to IMG-006, which owns the brightness-to-stone mapping
  (`docs/specifications/IMG-000-ImageToStrassAudit.md`'s `luminance` bullet). Density-from-brightness
  and size-from-brightness are one design decision, not two, so both stay with IMG-006 rather than
  splitting the density half off into this milestone. `OrganicSampler.js`'s `samplePoissonDiskPoints()`
  takes one uniform `spacingMm`/`r` for the whole placement box; a luminance-driven variant would need
  `r` to vary per grid cell, keyed to `field.luminance` at that cell — a design IMG-006 should make
  together with its size-from-brightness rule, not ahead of it. Recorded as a new row in
  `docs/BACKLOG.md`'s "Deferred technical follow-ups" table, naming IMG-003 as the origin and IMG-006
  as where it gets decided.
* `src/gallery/RhsFixtureBridge.js`'s fixture-rendering helper, `generateImageStonesForLayer()`
  (`:483`-`:504`) — it does not forward `seed`/`spread` into `generateImageLayout()`'s params, the same
  omission that already exists there for IMG-002's `colorCount`/`palette`/`colorMap` (none of those
  three appear anywhere in `src/gallery/RhsFixtureBridge.js` either — grep-confirmed). `.rhs` fixtures
  only need `'organic'` to be a *valid* `fillMode` value for schema validation; a fixture rendered
  through this bridge with `fillMode: 'organic'` falls back to whatever default seed/spread
  `generateImageLayout()` itself defaults to, matching the existing colour-layer precedent exactly.
* Any project-schema version bump or `validateProject()` change — see decision 3.

## Files Touched

* `src/geometry/OrganicSampler.js` (new) — `samplePoissonDiskPoints({insideAt, widthMm, heightMm,
  spacingMm, seed, spread})` (no `stoneSizeMm` — see decision 2), local-mm, field-agnostic; private
  `mulberry32()` copy; no `src/renderer`/`src/image` imports.
* `src/geometry/StoneSampler.js` — imports `samplePoissonDiskPoints` from `OrganicSampler.js` (`:10`
  neighborhood, beside the existing `ContourRingSampler.js` import); gains its own new exported
  `sampleOrganicFieldFillPoints(field, placement, spacingMm, stoneSizeMm, {seed, spread})`, the
  field-aware wrapper built the same way `sampleContourFieldFillPoints()` (`:1759`) already builds
  `insideAt` and delegates to `computeInwardRingPolygons()`; `sampleFieldByMode()` (`:1805`) gains the
  `samplerOptions = null` sixth parameter and an `'organic'` case dispatching to it.
* `src/geometry/index.js` — re-exports `samplePoissonDiskPoints` beside the `ContourRingSampler.js`
  block (`:69` neighborhood); `sampleOrganicFieldFillPoints` joins the existing `StoneSampler.js`
  re-export list `sampleContourFieldFillPoints` already sits in.
* `src/geometry/GeometryEngine.js` — `IMAGE_SAMPLE_MODES` (`:54`) gains `'organic'`;
  `normalizeImageParams()` (`:2254`) gains `seed`/`spread`; `generateImageLayout()` (`:1171`) forwards
  `{seed, spread}` to `sampleFieldByMode()` and to its own S-200 infill call
  (`:1219`-`:1225` neighborhood).
* `src/geometry/MixedSizeGenerator.js` — `generateMixedSizeInfillPoints()` (`:228`) gains the optional
  `samplerOptions` argument, forwarded at its `sampleFieldByMode()` call site (`:237`) with `pitchMm`
  now passed explicitly as the fifth argument.
* `docs/ARCHITECTURE.md` — **not touched by this spec-authoring commit.** The implementation step
  (once `src/geometry/OrganicSampler.js` actually exists) adds a normal, unmarked module-table row
  beside the existing `ContourRingSampler.js` row (`:749`), with the same "nothing else in `src/**`"
  ownership statement, naming `StoneSampler.js` as its only caller — this document's own header states
  it reflects "the actual state of the implementation," so a row for code that does not exist yet does
  not belong here even labeled as a forward reference; adding one was tried and reverted in this
  branch's history (see `docs/ARCHITECTURE.md`'s untouched state at `develop@3878f65`).
* `src/gallery/RhsFixtureBridge.js` — `SUPPORTED_IMAGE_FILL_MODES` (`:49`) gains `'organic'`; its check
  (`:228`) and `resolveImageFillMode()` (`:530`) need no other change (the check and resolver both work
  against the set by reference).
* `app.js` — `IMAGE_FILL_MODES` (`:666`) gains `'organic'`; new `resolveImageSeed()`/
  `resolveImageSpread()` beside `resolveImageFillMode()` (`:695` neighborhood); sync at `:2455` and
  readback at `:2606`/`:2611` gain `seed`/`spread`; fresh-import literal (`:5181`) gains `seed:1,
  spread:1`; new `#imgShuffle` `onclick` beside `#imgColorReset` (`:5200` neighborhood);
  `HISTORY_TRACKED_CONTROL_IDS` (`:4743`) gains `imgSeed`/`imgSpread`; `IMAGE_STUDIO_LIVE_GROUP_IDS`
  (`:6068`) gains `imageStudioGroupOrganic`; `renderImageStudio()` (`:6069`) renders the Organic group,
  its live spread readout, and the three controls' disabled/enabled state.
* `index.html` — `#imageFillMode` (`:1159`) gains a fifth `<option value="organic">`;
  `#imageStudioGroupOrganic` (`:1183`-`:1186`) filled in with `#imgSeed`, `#imgShuffle`, `#imgSpread` +
  `#imgSpreadValue`.
* `tools/test-ui-shell-structure.mjs` — studio id list (`:204`, the editing-control-ids loop — not the
  `:201` container/group-ids loop, which already contains `imageStudioGroupOrganic` and needs no
  change) gains `imgSeed`/`imgShuffle`/`imgSpread`.
* `tools/test-img-003-organic-placement.mjs` (new).
* `tools/test-groups.mjs` — registers the new test file in the `core`/`geometry` groups, following the
  `test-img-002-color-layers.mjs` registration precedent (`:60`, `:179`).
* `docs/specifications/IMG-001-ImageToStrass.md` — roadmap item 3 (`:29`) gets a line noting IMG-003
  is specified in this document, implementation not yet landed.
* `docs/specifications/IMG-000-ImageToStrassAudit.md` — the "no new sampler is anticipated before
  IMG-004" line (`:25`) gets one sentence noting IMG-003 specifies a fifth sampler ahead of that
  framing, scoped to image-only placement (not a new vector-shape sampler), so IMG-004's own "may need
  a fifth, edge-weighted sampler" framing (`IMG-001-ImageToStrass.md` roadmap item 4) is now about a
  sixth.
* `docs/BACKLOG.md` — new row in the "Deferred technical follow-ups" table (bottom, beside the
  existing `findCrossGroupCollisions()` float-noise row, `:51`) recording the luminance-driven-density
  (stippling) deferral to IMG-006 — see Out of Scope.
* `docs/specifications/IMG-003-OrganicPlacement.md` (this file).

## Compatibility

* `mode` omitted, or any of `'fill'`/`'staggered'`/`'radial'`/`'contour'`: byte-identical to before this
  milestone. `sampleFieldByMode()`'s four existing cases ignore the new `samplerOptions` parameter
  entirely; `seed`/`spread` are read from the layer but have nothing to do.
* Every pre-IMG-003 saved `image` layer has no `seed`/`spread` fields and resolves to `1`/`1` — the
  fixed, non-random default (decision 3) means this is not merely "some deterministic value" but the
  *same* value a fresh Organic-mode layer gets, so there is nothing to distinguish between an old
  project reopened after this milestone ships and a project authored after it.
* No `StoneLayout`/`Stone` schema change; no project version bump; no `validateProject()` change —
  `seed`/`spread` are new, optional, permissively-defaulted layer fields, the same precedent
  `layer.transparent` (IMG-001) and `layer.colorCount` (IMG-002) already established.
* `.rhs` fixture format (`src/gallery/RhsFixtureBridge.js`): `'organic'` becomes a valid `fillMode`
  value; fixtures using it fall back to `generateImageLayout()`'s own seed/spread defaults, matching
  how IMG-002's `colorCount`/`palette`/`colorMap` are already never forwarded through that bridge (see
  Out of Scope).

## Test Plan

`tools/test-img-003-organic-placement.mjs` (new, registered in `tools/test-groups.mjs`'s `core` and
`geometry` groups immediately after `test-img-002-color-layers.mjs`):

* Determinism: `sampleOrganicFieldFillPoints()` run twice with the same field/placement/spacing/seed
  produces `deepEqual` point lists (same order, same coordinates).
* Different seeds (1..20) on the same fixture/pitch each produce a point count within the measured
  174–186 range (decision 2) and pairwise-distinct point lists.
* Minimum-distance invariant: for every accepted point, no other accepted point lies within
  `spacingMm * max(1, spread)` mm (checked directly against the full output, not sampled).
* On-field invariant: every accepted point's own pixel is at/above `FIELD_ON_THRESHOLD` — zero
  exceptions, across the disc fixture and at least one disconnected multi-island fixture (proving the
  full-scan re-seed step actually reaches every island).
* Disconnected islands: a fixture with two or more field regions with no on-pixel path between them
  gets points in every region, not only the region containing the first active point.
* `spread` scaling: spread 1 / 1.25 / 1.5 / 2 / 3 on the same fixture/pitch/seed reproduces the
  182/111/78/45/22 counts and the `3 × spread` mm measured minimum centre distance from decision 2.
* `sampleFieldByMode('organic', ...)` dispatches to `sampleOrganicFieldFillPoints()` with
  `samplerOptions` forwarded.
* Byte-identity vs. `develop`: for each of Fill/Staggered/Radial/Contour, `generateImageLayout()`'s
  result with `mode` unchanged is `deepEqual` to a stone list captured by running
  `generateImageLayout()` at `develop@3878f65` against `tools/test-image-pipeline.mjs`'s existing
  fixture(s), frozen as a literal in the test file — with its provenance documented in a comment in
  the shape `tools/test-img-001-field.mjs:170`'s case 9 uses: the git ref, confirmation the
  intervening image/geometry code is unchanged, and that the capture script itself was discarded. The
  comment must also record that `git diff ef190d0 3878f65 -- src/image/ src/geometry/` produces no
  output — MAINT-007 (`3878f65`) changed nothing under either directory since `ef190d0` (the `IMG-002`
  merge commit) — so this capture is equal to the reference `docs/specifications/IMG-002-ColorLayers.md`'s
  own byte-identity case already froze at `ef190d0`; it is not a second, independent capture that could
  silently diverge from it. `sampleFieldByMode()`'s new sixth `samplerOptions` parameter and the new
  `'organic'` case are both unreachable from any of these four calls, so this proves the addition
  disturbs nothing about the four existing modes.
* `generateImageLayout({mode:'organic', seed, spread})`: `normalizeImageParams()` defaults `seed`/
  `spread` to `1`/`1` when omitted or invalid (non-integer seed, `spread < 1`), and forwards the
  resolved values into the sampler call.
* S-200 infill under organic: `generateMixedSizeInfillPoints()` with `mode: 'organic'` and a
  `samplerOptions` seed produces additive points — no overlap with base stones, verified via
  `findCrossGroupCollisions()` with a **per-pair** threshold `d = (a.sizeMm + b.sizeMm) / 2 + gapMm`,
  not the uniform `stoneSizeMm + gapMm` a same-size sweep would use, since infill stones are smaller
  than base stones (`docs/specifications/S-200-MixedStoneSizeLayouts.md`) — and the run is
  deterministic for a fixed seed. Per `docs/BACKLOG.md`'s `findCrossGroupCollisions()` float-noise row
  (`:51` — raised by IMG-002's own cross-colour collision test, which worked around it with `1e-9`mm
  slack in the `d` it passes), this case carries the same `1e-9`mm slack. The four existing modes'
  infill output is unchanged by the new optional argument's presence.
* `mulberry32` pinning: `OrganicSampler.js`'s private copy is pinned two ways, since
  `CrystalAppearance.js:29`'s `mulberry32` is module-private and cannot be imported by a test
  (grep-confirmed: `^export` in that file matches only `crystalSeedForStone`/`SPARKLE_VARIANT_COUNT`/
  `getCrystalAppearance`) — (a) a frozen literal of `OrganicSampler.js`'s own `mulberry32(1)`'s first 8
  outputs, captured at implementation time with a provenance comment recording the capture, the same
  convention `tools/test-img-001-field.mjs:170`'s case 9 uses for a captured reference; (b) a
  source-text assertion that `CrystalAppearance.js:29`'s function body and `OrganicSampler.js`'s copy
  are character-identical apart from indentation — the same source-text-pinning technique
  `tools/test-fill-algorithms-integration.mjs:132` already uses on `resolveImageFillMode()`.
* `IMAGE_SAMPLE_MODES`/`IMAGE_FILL_MODES`/`SUPPORTED_IMAGE_FILL_MODES` each contain `'organic'`;
  `SAMPLE_MODES` does not.
* `app.js` source-text assertions: `HISTORY_TRACKED_CONTROL_IDS` contains `imgSeed`/`imgSpread` (not
  `imgShuffle`); the fresh-import literal contains `seed:1,spread:1`; `IMAGE_STUDIO_LIVE_GROUP_IDS`
  contains `imageStudioGroupOrganic`.
* `index.html` structure: `#imageFillMode` has an `organic` option with no `outline` option (mirroring
  `test-fill-algorithms-integration.mjs`'s existing case 4 pattern, `:79`); `#imageStudioGroupOrganic`
  contains `#imgSeed`/`#imgShuffle`/`#imgSpread`/`#imgSpreadValue`.
* `tools/test-ui-shell-structure.mjs`'s studio id list case (`:204`, the editing-control-ids loop)
  passes with the three new ids added; the `:201` container/group-ids loop is untouched (it already
  contains `imageStudioGroupOrganic`).
* `tools/test-browser-baseline.mjs` passes with `src/geometry/OrganicSampler.js` and the updated
  `index.html` included in its scan (automatic — no test file change needed, see decision 6); a
  hand-check confirms no `.union()`/`.intersection()`/`.difference()` call appears anywhere in
  `OrganicSampler.js`.

Report the raw per-case list above in this section, not a pass/fail count, per this repo's testing
policy for shared-architecture milestones.

---

## Anchor verification note

* `src/gallery/RhsFixtureBridge.js` resolver — **not a disagreement.** `:530` is
  `function resolveImageFillMode(value) {` and `:531` is its return line,
  `return SUPPORTED_IMAGE_FILL_MODES.has(value) ? value : 'fill';`. The milestone brief's `:531`
  pointed at the constant's own occurrence inside the function body; a fresh grep for the function's
  declaration lands one line earlier, at `:530`. Same site, one line apart.
* `tools/test-ui-shell-structure.mjs` studio id list — the one real correction in this document. Test
  9 has two consecutive loops: `:201` iterates container/group ids and already contains
  `imageStudioGroupOrganic` (unchanged by IMG-003); `:204` iterates editing-control ids (`imgThreshold`
  through `imgColorCount`/`imgColorReset`) and is where `imgSeed`/`imgShuffle`/`imgSpread` belong. The
  milestone brief's `:204` was correct throughout. An earlier pass of this document grepped for the
  literal string `imageStudioGroupOrganic` to locate "the studio id list," which matches only the
  `:201` loop (the only one that already contains that particular id) and wrongly reported `:201` as
  a disagreement with the brief's `:204`. Both loops assert the identical
  `traceBody.includes(`id="${id}"`)` check (`:202`/`:205`), so filing the three new control ids under
  `:201` instead of `:204` would still have passed that assertion — the correction is about the two
  lists keeping their own meaning (containers vs. editing controls), not about a test that would have
  failed either way.
