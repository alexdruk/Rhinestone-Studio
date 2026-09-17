# IMG-006 — Brightness Sizes

## Objective

IMG-006 is the sixth of `IMG-001`'s eight-milestone roadmap
(`docs/specifications/IMG-001-ImageToStrass.md:43`-`:47`: "**IMG-006 — Brightness sizes.** Map
measured per-point brightness... to a stone size from `StoneSizes.js`'s existing catalog"). It
fills the `#imageStudioGroupBrightness` placeholder (`index.html:1200`-`:1203`, `<p class="hint">
Coming in IMG-006</p>`) that `IMG-007` reserved for it.

The roadmap's own framing of the mechanism — "assigned via the existing 'assign then
`dropOverlappingSizedStones()`' shape `GeometryEngine.js` already uses for Mixed Stone-Size" — and
`IMG-000`'s audit (`docs/specifications/IMG-000-ImageToStrassAudit.md:48`-`:52`) both describe
IMG-006 as reusing MONO-015's weight-following shape (`GeometryEngine.js:227`-`:279`): sample at
the *smallest* candidate pitch, probe/assign a size per surviving point, then drop overlaps created
by the larger assigned sizes. **This is not what IMG-006 does, and section 6 below measures why.**
MONO-015 samples small because its per-point signal (local stroke width, `StrokeWidthProbe.js`) is
only meaningful *between* the outline's own edges — there is no coarser pitch at which to sample it
without missing narrow strokes entirely, and the whole point is to recover stem width the primary
outline pass already threw away. Brightness has no such requirement: luminance is defined at every
pixel regardless of sampling density, so nothing is gained by oversampling and then discarding most
of the samples via `dropOverlappingSizedStones()` — and section 6's measurement shows the discard
is not even conservative: a bigger stone drops more neighbours, so the "sample small, assign, drop"
shape leaves per-band coverage roughly *constant* across brightness levels instead of graduated,
which defeats the entire purpose of a brightness-to-size mapping. IMG-006 instead samples at the
*largest* rung's pitch — every stone the sampler places is already spaced far enough apart to hold
any assigned size in `brightnessSizesMm` without collision — and assigns each survivor a size from
its own measured luminance. `dropOverlappingSizedStones()` still runs, but as a safety net expected
to remove nothing (decision 1), not as the mechanism that shapes the output.

`docs/BACKLOG.md` carries three rows this milestone resolves or restates, all reviewed below:
row 49 (`DxfExporter.js` groups by color only, not size — stays deferred, decision 5), row 50
(`prepareImageField()`'s `luminance` channel and the `transparent` policy — resolved, decision 4),
and row 52 (Organic Fill has no luminance-driven density variant — deliberately not built here,
decision 2's scope note below).

## Decisions

### 1. Mechanism — sample at the largest rung's pitch, assign, drop as a safety net

`generateImageLayout()` (`GeometryEngine.js:1181`-`:1262`) computes `spacingMm =
options.stoneSizeMm + options.gapMm` and calls `sampleFieldByMode(options.mode, field, placement,
spacingMm, options.stoneSizeMm, {...})` once (`:1203`-`:1209`), unconditional of size mode. For
`sizeMode: 'brightness'` with two or more `brightnessSizesMm` entries, this milestone instead
computes `maxSizeMm = brightnessOptions.sizesMm[brightnessOptions.sizesMm.length - 1]`,
`spacingMm = maxSizeMm + options.gapMm`, and forwards `maxSizeMm` (not `options.stoneSizeMm`) as
the sampler's own `stoneSizeMm` argument — every one of the six image fill modes (`fill`,
`staggered`, `radial`, `contour`, `organic`, `edge`) is sampled at this single largest-rung pitch.
Each returned point is then assigned a diameter from its own measured luminance (decision 3), and
`dropOverlappingSizedStones(assigned)` (`StoneSampler.js:583`-`:622`) runs once over the assigned
set, exactly as it already does for MONO-015 (`GeometryEngine.js:267`).

This drops (structurally, not by luck) zero points in every mode: the sampler's own floor already
guarantees no two points land closer than `spacingMm = maxSizeMm + gapMm` apart (staggered/organic/
edge enforce this as their own placement floor; contour/radial enforce it via `IMG-005`'s
`nudgeOrDropStonePoints()`, `StoneSampler.js:333`-`:372`, floor `stoneSizeMm + gapMm`). The
strictest pairwise touching threshold `dropOverlappingSizedStones()` can ever apply is two points
both assigned the largest size, `(maxSizeMm + maxSizeMm) / 2 = maxSizeMm` — strictly less than the
sampler's own `maxSizeMm + gapMm` separation (`gapMm > 0` in every layer this milestone applies to;
`gapMm = 0` is not a real product configuration, see Compatibility). Every other pairing (one or
both stones smaller than `maxSizeMm`) has an even smaller threshold against the same
`maxSizeMm + gapMm` floor. Section 6 measures zero drops on the fixture across all six modes,
confirming the structural argument rather than resting on it alone.

**Why not the MONO-015 shape (measured).** The scratch script pinned in section 7, re-run as the
"Control row," reproduces the roadmap's literal shape: sample `fill` at the *smallest* rung's pitch
(`2.3` mm = `2.0 + 0.3`), assign each of the resulting 676 points a size from its own luminance, then
drop. `dropOverlappingSizedStones()` removes 299 of the 676 (44%) — overwhelmingly the larger
assigned stones, since a 4.0 mm stone at a 2.3 mm-pitched neighbourhood collides with far more
neighbours than a 2.0 mm one does. Net per-band coverage: dark 0.681, mid 0.467, bright 0.579 — the
bright third ends up *more* covered than the mid third, and dark-to-bright coverage spans only
0.681→0.579 (a 15% relative spread) instead of graduating with luminance. IMG-006's actual
mechanism (`fill` at the `4.3` mm max pitch) gives dark 0.733, mid 0.287, bright 0.183 — a
monotonic, 4×-wide spread that actually reads as a halftone. The MONO-015 shape's aggressive,
size-biased drop is appropriate there because MONO-015's goal is a single connected chain
(collisions there are a `SINGLE_CHAIN`-adjacent correctness concern, not a coverage one); it is the
wrong tool for a coverage-driven brightness map, where the drop step is only ever meant to catch an
edge case, never to do the actual shaping work.

### 2. Data model

A fourth `sizeMode` value, `'brightness'`, added to `MixedSizeGenerator.js`'s `SIZE_MODES` Set
(`:18`, currently `new Set(['uniform', 'mixed', 'weight'])`) and to `app.js`'s own mirrored copy
(`:757`, same three values) — both gain `'brightness'`. `resolveSizeMode()` (`app.js:758`) keeps
falling back to `'uniform'` for any unrecognized/missing value, so a project saved before this
milestone is untouched.

`normalizeMixedSizeParams(params, stoneSizeMm, { allowWeight, allowBrightness } = {})`
(`MixedSizeGenerator.js:61`) gains a second boolean option, `allowBrightness = false`, mirroring
`allowWeight`'s existing guard (`:66`-`:69`): `sizeMode: 'brightness'` throws
(`"sizeMode 'brightness' (brightness-driven stone size) is only supported for an image layer."`)
unless the caller passes `allowBrightness: true`. A new branch, structured exactly like the
existing `weight` branch (`:70`-`:87`) but reading `params.brightnessSizesMm` instead of
`params.weightSizesMm`, validates each entry with the same `assertPositiveNumber` call the `weight`
branch already uses and the same strict-ascending check (`:81`-`:85`), and returns
`{ sizeMode: 'brightness', mixedOptions: null, brightnessOptions: { sizesMm } }` where `sizesMm =
rawSizes.length ? [...rawSizes] : [stoneSizeMm]` — a `brightnessSizesMm` array with zero or one
entries reduces to a single-size `sizesMm`, which decision 1's `maxSizeMm` derivation and decision
3's rung assignment both reduce to `stoneSizeMm` for every point: uniform output, byte-identical to
`sizeMode: 'uniform'`.

`mixedOptions` is `null` in this mode (the same `null` the `weight` branch already returns), so
`generateImageLayout()`'s existing `if (options.mixedOptions) { ... }` S-200 infill gate
(`:1240`-`:1259`) never runs for a `'brightness'` layer — this exclusivity is deliberate: S-200
infill adds stones into gaps the primary field left uncovered, and brightness sizing already
produces sparse regions in bright areas *by design* (fewer, smaller assigned stones there);
additive infill would refill exactly the halftone effect this milestone creates.

Of the five `normalizeMixedSizeParams()` call sites in `GeometryEngine.js`, only
`normalizeImageParams()`'s (`:2355`, currently `...normalizeMixedSizeParams(params, stoneSizeMm)`)
gains `{ allowBrightness: true }`. The other four — `normalizeTextParams()` (`:1888`, already
`{ allowWeight: true }`, `allowBrightness` stays unset/false), `normalizeShapeParams()` (`:2165`),
`normalizeSvgParams()` (`:2268`), `normalizePathParams()` (`:2428`) — are untouched, so
`sizeMode: 'brightness'` throws from every non-image `generate*Layout()`, per the Test Plan.

**Persistence.** `layer.sizeMode = 'brightness'` and `layer.brightnessSizesMm` are flat fields,
read with the same permissive `??[]` default `mixedSizeParamsFor()` (`app.js:873`) already uses for
`weightSizesMm` — no `validateProject()` change, no project schema version bump, following the
`weightSizesMm` precedent exactly (`app.js:868`-`:872`'s own comment: "empty default mirrors
`allowedSizesMm`'s, and reduces weight mode to uniform output").

**`layer.brightnessThinning`** is a separate, always-read field (`number >= 0`, default `0`), with
a resolver `resolveImageBrightnessThinning(value)` beside `resolveImageEdgeThinning()`
(`app.js:703`, `return typeof value==='number'&&Number.isFinite(value)&&value>=0?value:1` —
the new resolver is the same shape with a `0` fallback, not `1`, since "no thinning" is the
neutral/off value here, unlike edge thinning). Unlike `brightnessSizesMm`, this field is read by
the `organic` and `edge` samplers **regardless of `sizeMode`** — it drives per-point placement
*density*, not assigned *size*, so it applies even to a plain `'uniform'` image layer. Per-point
ink (decision 3) already gives a `[0,1]` darkness signal at every field pixel; `radiusAt` in both
samplers multiplies its existing base radius (and, in `edge` mode, the existing edge factor) by
`(1 + brightnessThinning * (1 - ink))`, with `maxRadiusMm` raised to match — `brightnessThinning:
0` (the default, and every pre-IMG-006 layer) makes this factor exactly `1` everywhere, so both
samplers are byte-identical to before this milestone when the field is untouched (Compatibility).
This closes the `IMG-003` stippling row (`docs/BACKLOG.md` row 52): "Organic Fill samples uniform
density only... a luminance-driven stippling variant is IMG-006's to build on top of [`edge`'s
existing] `radiusAt` hook."

Both samplers currently compute `radiusAt`/`insideAt` in **local** (pre-placement) coordinates
against `field.luminance` via a private helper mirroring `fieldPixelOn()`/`fieldEdgeAt()`
(`StoneSampler.js:1744`-`:1756`), not the exported, absolute-coordinate `fieldLuminanceAt()`
decision 3 adds (which mirrors `fieldLabelAt()`'s absolute-coordinate contract for the
per-*assigned-point* lookup in decision 1's second pass). This is a second, local-coordinate ink
lookup with the same formula, the same relationship `fieldEdgeAt()`/`fieldPixelOn()` already have
to each other (`StoneSampler.js:1744`-`:1756` header note: two hand-matched local/absolute pairs is
the established pattern here, e.g. `fieldPixelOn` vs. nothing exported for it at all, `fieldLabelAt`
exported and absolute-only). Since `ink` also needs `threshold`/`invert` (not baked into
`field.luminance`, only into `field.data`'s on/off mask), both are forwarded into the `organic`/
`edge` `samplerOptions` bag alongside `brightnessThinning` — an addition beyond what a literal
reading of "read only by the organic and edge samplers" requires, but a necessary consequence of
computing `ink` there at all; `sampleFieldByMode()`'s own doc comment already documents
`samplerOptions` as "purely additive" (`:2019`-`:2022`), so this widens what `organic`/`edge` read
from the same bag without touching `fill`/`staggered`/`radial`/`contour`.

### 3. Mapping

Per-point ink, `ink(lum, threshold, invert) ∈ [0,1]`:

* `invert` off: `(threshold - lum) / threshold`, clamped to `[0,1]`; `0` when `threshold === 0`
  (divisor guard).
* `invert` on: `(lum - threshold) / (255 - threshold)`, clamped to `[0,1]`; `0` when
  `threshold === 255` (divisor guard).

Rung index into the ascending `sizesMm`: `min(n - 1, floor(ink * n))`, `n = sizesMm.length`. Darker
(`ink` closer to `1`) maps to a higher index, i.e. a **larger** assigned stone — the halftone
convention section 7's measured coverage table confirms (dark thirds measure the highest coverage
in every mode).

Luminance is read through a new exported `fieldLuminanceAt(field, placement, xMm, yMm)` in
`StoneSampler.js`, placed beside `fieldLabelAt()` (`:1778`-`:1789`) and built to mirror it exactly:
same absolute-coordinate `{xMm, yMm}` contract, same off-field bounds check, same clamped
`Math.floor((localMm / extentMm) * extentPx)` pixel arithmetic, reading `field.luminance` in place
of `field.labels`. This guarantees a stone's assigned size is read from the *same* pixel its
on-field (`field.data`) test used — the identical pixel-parity guarantee `fieldEdgeAt()`
(`:1749`-`:1756`) already states for `field.edge` against `field.data`.

**Rejected alternative — normalizing to the on-pixel luminance range (auto-levels).** Rescaling
`ink` against the image's own observed min/max luminance (rather than the fixed `threshold`/`255`
denominators above) was considered and rejected: the mapping from a given pixel's *raw* luminance
to a stone size would then depend on every other pixel in the image, and change every time
`threshold` was edited even for pixels far from the threshold boundary — a Studio user nudging the
threshold slider to clean up a mask edge would silently reshuffle every stone size in the layer.
The fixed-denominator rule keeps a pixel's assigned size a pure function of its own luminance,
`threshold`, and `invert`.

### 4. Transparent policy (`docs/BACKLOG.md` row 50) — resolved by construction

Row 50 flagged that `prepareImageField()`'s `luminance` channel always composites alpha onto white
(`ImageFieldPipeline.js:152`, `toGrayscale(imageBuffer)`, unconditional of `options.transparent`)
and asked whether IMG-006's brightness mapping needs to special-case a masked-off pixel. It does
not, and needs no `prepareImageField()` change: `fieldLuminanceAt()` is only ever called (decision
3) for a point `sampleFieldByMode()` already produced, and every field sampler only places points
where `field.data` is on (`fieldPixelOn()`, `FIELD_ON_THRESHOLD` gate) — `transparent: 'ignore'`
already excludes a transparent pixel from `field.data` upstream (`ImageFieldPipeline.js:159`-`:161`,
`maskOutTransparent()`), so a fully transparent pixel's `luminance` value is never read by this
mapping regardless of policy. The only pixels whose *composited* luminance differs from their raw
color are *partially* transparent ones (alpha between the mask threshold and 255) — under both
`transparent` policies these read lighter (closer to white) than their raw color, which matches
row 50's own framing of what "meaningful" should mean here (a half-transparent dark pixel reading
as lighter, not as fully dark). This row is resolved; no action beyond noting it in
`docs/BACKLOG.md`.

### 5. DXF per-size layers (`docs/BACKLOG.md` row 49) — stays deferred

`DxfExporter.js`'s `dxfLayerNameForColor()` groups by color only (verified unchanged at the row's
own citation). IMG-006 adds per-point size variation identical in kind to what S-200 Mixed
Stone-Size already sends to DXF today (stones of different `sizeMm` sharing one DXF layer as
differently-sized circles) — no *new* DXF gap, just more of the same one. `docs/BACKLOG.md` row 49
is updated to note this and that it now waits on a dedicated export milestone (`dxfLayerNameFor(color,
sizeMm)` or a second grouping key), not IMG-006 or IMG-008.

### 6. Studio UX and wiring

**`#imageStudioGroupBrightness`** (`index.html:1200`-`:1203`) loses its `<p class="hint">Coming in
IMG-006</p>` line, gaining:

* **`#imgBrightnessSteps`** — a `<select>`, `Off` plus one `<option>` per catalog rung available
  above the layer's own stone size, built by a new `brightnessStepsOptionsHtml(baseStoneSizeMm)`
  beside `weightStepsOptionsHtml()` (`app.js:781`-`:793`). It reuses that function's label-building
  idiom (`stoneSizesFromBaseMm(baseStoneSizeMm, step).map(d =>
  formatStoneSizeLabel(d).replace(/\s*\(.*\)$/, '')).join(' → ')`) but loops
  `step = 1..(STONE_SIZE_LIST.length - 1)` instead of `weightStepsOptionsHtml()`'s hardcoded
  `1..2` — brightness sizing has no product reason to cap at two extra rungs the way the
  weight-following step deliberately does, and decision 1's mechanism has no `SINGLE_CHAIN`-style
  ratio concern that would motivate a cap. Selecting a step writes both `layer.sizeMode`
  (`'brightness'` for any step `> 0`, `'uniform'` for `Off`) and re-derives `layer.brightnessSizesMm
  = stoneSizesFromBaseMm(l.stoneSize, step)` on every stone-size change too, exactly as the weight
  readback (`app.js:2675`-`:2684`) does for `weightSizesMm`.
* **`#imgBrightnessThinning`** — a `<input type="range" min="0" max="3" step="0.1" value="0">`,
  matching `#imgEdgeThinning`'s existing control shape exactly (`index.html:1194`) but with a `0`
  default value, not `1`. Disabled unless Fill style is Organic or Edge, following the exact
  `isPoisson`/`edgeDisabledTitle` gating `renderImageStudio()` already applies to
  `#imgEdgeWidth`/`#imgEdgeThinning` (`app.js:6104`-`:6117`) — `#imgBrightnessThinning` joins the
  `isPoisson` group (disabled/titled the same as `#imgSeed`/`#imgShuffle`/`#imgSpread`, decision 2:
  it applies to Organic *and* Edge, unlike `#imgEdgeWidth`/`#imgEdgeThinning` which gate on Edge
  alone).

**Shared inspector.** `#sizeMode` (`index.html:1507`, currently three `<option>`s — Uniform, Mixed,
Weight-following) gains a fourth, `<option value="brightness">Brightness-following</option>`. Its
absence would not merely omit a UI affordance: `syncSelectedControlsFromLayer()`'s inspector-sync
line (`app.js:2471`, `el('sizeMode').value=sizeMode`) silently no-ops when asked to select a value
with no matching `<option>` (native `<select>` behavior — the element's `.value` stays whatever it
was), so a `'brightness'` layer would display as whatever `sizeMode` the control last held; the
write-back at `app.js:2656` (`l.sizeMode=resolveSizeMode(el('sizeMode').value)`) would then read
that stale value back and silently coerce the layer to `'uniform'` on the very next edit of *any*
tracked control. A new `updateBrightnessSizeCapabilityUI()`, structured identically to
`updateWeightSizeCapabilityUI()` (`app.js:3468`-`:3488`) — same `option.disabled`/`.title`
idiom, same coerce-back-to-uniform-if-ineligible guard — gates this option on `l.type==='image'`
(vs. weight's outline-text-with-OpenType-font eligibility) and is called alongside it
(`app.js:3281`-`:3282`, `updateMixedSizeCapabilityUI(); updateWeightSizeCapabilityUI();` gains a
third call). In practice `#imgBrightnessSteps` (Studio) is the control an operator actually uses;
`#sizeMode`'s own `brightness` option exists chiefly so the shared field round-trips correctly
without depending on which panel is open, the same "belt-and-braces write-side guard" `app.js:2670`
already documents for `weight`'s own equivalent coercion.

**Every site a new field touches**, per `docs/BACKLOG.md` row 54's standing convention ("any new
per-layer image field needs the same two things — a resolver used at both the Studio sync/readback
sites *and* `generateImageStonesLive()`'s params object, and an app-path source-text guard"):

* Creation defaults, `app.js:5191` — the new `image` layer literal gains `sizeMode:'uniform'` (the
  default is implicit/omitted for every other layer type via `resolveSizeMode()`'s own fallback,
  but `weightSizesMm` has no explicit default there either — `brightnessSizesMm`/`brightnessThinning`
  need no explicit entry here either, same reasoning: `mixedSizeParamsFor()`'s `??[]`/
  `resolveImageBrightnessThinning()`'s `??0`-equivalent fallback already covers a layer with neither
  field set).
* Inspector sync, `app.js:2471` (the `sizeMode`/`weightSteps` block) — no change needed beyond the
  new `<option>` above; `#imgBrightnessSteps`/`#imgBrightnessThinning` are Studio-only controls,
  synced by `renderImageStudio()` instead (next bullet).
* Inspector readback, `app.js:2656`, `:2670`-`:2684` — the `weight` coercion block gains an
  `else if` sibling for `brightness` (coerce back to `uniform` when `l.type !== 'image'`), and a
  parallel `brightnessSizesMm` re-derivation block mirroring `:2675`-`:2687`'s `weightSizesMm` one.
* Image Studio sync, near `app.js:6116` — `renderImageStudio()` gains
  `el('imgBrightnessSteps').innerHTML=brightnessStepsOptionsHtml(l.stoneSize);
  el('imgBrightnessSteps').value=String(brightnessStepForSizes(l.brightnessSizesMm));
  el('imgBrightnessThinning').value=resolveImageBrightnessThinning(l.brightnessThinning);`, and
  `#imgBrightnessThinning` joins the `isPoisson`-gated id list alongside `#imgSeed`/`#imgSpread`
  (`:6110`).
* `generateImageStonesLive()` params (`app.js:994`) — `brightnessSizesMm` arrives already via the
  existing `...mixedSizeParamsFor(layer)` spread (once `mixedSizeParamsFor()`, `app.js:873`, gains
  `brightnessSizesMm:layer.brightnessSizesMm??[]`, mirroring its own `weightSizesMm` field);
  `brightnessThinning:resolveImageBrightnessThinning(layer.brightnessThinning)` is added as its own
  explicit key, the same way `edgeWidthMm`/`edgeThinning` already are on that line.
* `HISTORY_TRACKED_CONTROL_IDS`, `app.js:4753` — `'imgBrightnessSteps'` and
  `'imgBrightnessThinning'` appended after the existing `'weightSteps'` entry, so both fire
  `openHistorySession()`/`closeHistorySession()` like every other tracked control.
* App-path source-text guard — `tools/test-img-006-brightness-sizes.mjs` (decision 8) asserts, via
  the same brace-balanced source-text extraction convention `docs/BACKLOG.md` row 54 established,
  that `generateImageStonesLive()`'s params object literally includes both `brightnessSizesMm` (via
  the `mixedSizeParamsFor()` spread) and `brightnessThinning`.

## Structure

Data flow, extending `IMG-005`'s field-and-sampler contract:

```
GeometryEngine.generateImageLayout({..., sizeMode: 'brightness', brightnessSizesMm, brightnessThinning})
  -> normalizeImageParams(): ...normalizeMixedSizeParams(params, stoneSizeMm, {allowBrightness: true})
     -> sizeMode: 'brightness', mixedOptions: null,
        brightnessOptions: { sizesMm } (>=2 ascending entries, or [stoneSizeMm] if <2 -- uniform reduction)
  -> isBrightness = sizeMode === 'brightness' && brightnessOptions.sizesMm.length > 1
  -> sampleStoneSizeMm = isBrightness ? brightnessOptions.sizesMm.at(-1) : options.stoneSizeMm
  -> spacingMm = sampleStoneSizeMm + options.gapMm
  -> points = sampleFieldByMode(mode, field, placement, spacingMm, sampleStoneSizeMm,
       {seed, spread, edgeThinning, gapMm, checkFixStats, threshold, invert, brightnessThinning})
       -> every one of fill/staggered/radial/contour/organic/edge, unchanged dispatch
       -> organic/edge only: radiusAt multiplies its existing base (and, for edge, its existing
          edge factor) by (1 + brightnessThinning * (1 - ink(localLuminance, threshold, invert)))
  -> if isBrightness:
       assigned = points.map(p => ({xMm, yMm, sizeMm: rungFor(ink(fieldLuminanceAt(field, placement, p.xMm, p.yMm), threshold, invert), brightnessOptions.sizesMm)}))
       survivors = dropOverlappingSizedStones(assigned)   -- safety net, structurally zero drops (decision 1)
       stones = survivors.map(...) -- per-point sizeMm, colorAt() unchanged
     else:
       stones = points.map(...) -- unchanged, every stone at options.stoneSizeMm (byte-identical path)
  -> S-200 infill: skipped whenever isBrightness (mixedOptions is null in this mode)
  -> return new StoneLayout({layerId, sourceMode: mode, stones, checkFixStats})
```

## Out of Scope

* **S-200 Mixed Stone-Size infill alongside Brightness sizing** — `mixedOptions` is `null` in
  `'brightness'` mode by construction (decision 2); not a gap, a deliberate exclusivity.
* **DXF per-size cutting layers** (`docs/BACKLOG.md` row 49) — stays deferred to its own export
  milestone (decision 5).
* **Auto-levels / image-content-relative brightness normalization** — considered and rejected
  (decision 3).
* **A brightness-driven variant of the four lattice fill modes' *placement* (not size)** — Fill/
  Staggered/Radial/Contour still place on their existing regular/polar/contour-offset lattices;
  only `organic`/`edge` gain `brightnessThinning`-driven density variation (decision 2), matching
  the existing `radiusAt` hook's current reach (`IMG-004`'s `edge` mode is its only prior user).
* **Any `prepareImageField()` / `ImageFieldPipeline.js` change** — `field.luminance` already exists
  and already carries the values this milestone needs (decision 4); nothing in the field-prep
  pipeline changes.
* **Any exporter change beyond what S-200 already sends** — every surviving stone is an ordinary
  `Stone`, read the same way by every exporter regardless of how its size was assigned
  (`docs/specifications/IMG-000-ImageToStrassAudit.md`, "Exporters").
* **Any `StoneLayout` schema field** (unlike `IMG-005`'s `checkFixStats`) — brightness sizing needs
  no per-layer report; each stone's own `sizeMm` already carries the outcome.
* **Any project-schema version bump or `validateProject()` change** — `brightnessSizesMm`/
  `brightnessThinning` are read-site permissive-default fields, the same precedent `weightSizesMm`/
  `edgeThinning` already established.
* **`src/gallery/RhsFixtureBridge.js`** — same omission precedent `IMG-003`/`IMG-004`/`IMG-005`
  already established for `seed`/`spread`/`edgeWidthMm`/`edgeThinning`/Check & Fix: `.rhs` fixtures
  need no brightness wiring, since `generateImageLayout()`'s mapping runs automatically from
  `sizeMode`/`brightnessSizesMm`/`brightnessThinning` alone, fields a `.rhs` fixture already either
  carries or permissively defaults.

## Files Touched

* `src/geometry/StoneSampler.js` — new exported `fieldLuminanceAt(field, placement, xMm, yMm)`
  beside `fieldLabelAt()` (`:1778`); a private local-coordinate ink helper beside
  `fieldPixelOn()`/`fieldEdgeAt()` (`:1744`-`:1756`); `sampleOrganicFieldFillPoints()` (`:1964`) and
  `sampleEdgeFieldFillPoints()` (`:1993`) gain `brightnessThinning`/`threshold`/`invert` reads from
  their existing options bag and a `radiusAt` multiplier (organic currently has none at all —
  gains one; edge's existing `radiusAt`, `:1996`-`:1998`, gains the extra factor).
* `src/geometry/MixedSizeGenerator.js` — `SIZE_MODES` (`:18`) gains `'brightness'`;
  `normalizeMixedSizeParams()` (`:61`) gains the `allowBrightness` option and a `brightness` branch
  mirroring the existing `weight` branch (`:66`-`:87`).
* `src/geometry/GeometryEngine.js` — `normalizeImageParams()`'s `normalizeMixedSizeParams()` call
  (`:2355`) gains `{ allowBrightness: true }`; `normalizeImageParams()`'s return object (`:2319`
  -`:2356`) gains `brightnessThinning` via the same read-site-permissive-default pattern
  `edgeThinning` uses (`:2353`); `generateImageLayout()` (`:1181`-`:1262`) gains the
  `isBrightness`/`sampleStoneSizeMm` branch (Structure, above) around its existing `spacingMm`/
  `sampleFieldByMode()`/stone-building lines (`:1202`-`:1232`).
* `src/renderer/StoneSizes.js` — no change; `stoneSizeRungsAvailable()`/`stoneSizesFromBaseMm()`
  (`:106`/`:120`) are reused as-is, exactly as `IMG-000`'s audit already anticipated
  (`docs/specifications/IMG-000-ImageToStrassAudit.md:87`-`:91`).
* `app.js` — `resolveImageBrightnessThinning()` beside `resolveImageEdgeThinning()` (`:703`);
  `mixedSizeParamsFor()` (`:873`) gains `brightnessSizesMm:layer.brightnessSizesMm??[]`;
  `brightnessStepsOptionsHtml()`/`brightnessStepForSizes()` beside `weightStepsOptionsHtml()`/
  `weightStepForSizes()` (`:781`-`:796`); inspector readback (`:2656`, `:2670`-`:2687`) gains the
  `brightness` coercion + re-derivation blocks; `generateImageStonesLive()` (`:994`) gains
  `brightnessThinning:resolveImageBrightnessThinning(layer.brightnessThinning)` in its params
  object; `renderImageStudio()` (near `:6110`-`:6117`) gains `#imgBrightnessSteps`/
  `#imgBrightnessThinning` sync and adds `#imgBrightnessThinning` to the `isPoisson`-gated id list;
  new `updateBrightnessSizeCapabilityUI()` beside `updateWeightSizeCapabilityUI()`
  (`:3468`-`:3488`), called alongside it (`:3281`-`:3282`); `HISTORY_TRACKED_CONTROL_IDS`
  (`:4753`) gains `'imgBrightnessSteps'`, `'imgBrightnessThinning'`.
* `index.html` — `#sizeMode` (`:1507`) gains `<option value="brightness">`; `#imageStudioGroupBrightness`
  (`:1200`-`:1203`) loses its placeholder hint and gains `#imgBrightnessSteps`/
  `#imgBrightnessThinning` (decision 6).
* `tools/test-img-006-brightness-sizes.mjs` (new).
* `tools/test-groups.mjs` — registers the new test file, following `test-img-005-check-and-fix.mjs`'s
  own registration precedent (immediately after it, in the same groups).
* `docs/specifications/IMG-001-ImageToStrass.md` — roadmap item 6 (`:43`-`:47`) gets one sentence
  correcting the mechanism (section "Objective" above).
* `docs/specifications/IMG-000-ImageToStrassAudit.md` — the `dropOverlappingSizedStones()` entry
  (`:48`-`:52`) gets its mechanism claim corrected and its stale citations `StoneSampler.js:467` /
  `GeometryEngine.js:257` re-pointed to the function's current location, `StoneSampler.js:583` and
  its current call site, `GeometryEngine.js:267`.
* `docs/BACKLOG.md` — rows 49, 50, 52 updated (decisions 4/5 above; row 52 gets a one-line note that
  IMG-006 lands `brightnessThinning`-driven organic/edge density, closing that row, without a
  separate always-on stippling mode for the two lattice-adjacent samplers).
* `docs/specifications/IMG-006-BrightnessSizes.md` (this file).

## Compatibility

* Every pre-IMG-006 `image` layer has no `sizeMode` field at all (or `'uniform'`/`'mixed'`/
  `'weight'` from an already-shipped mode) and no `brightnessSizesMm`/`brightnessThinning` fields —
  `resolveSizeMode()` still falls back to `'uniform'`, `mixedSizeParamsFor()`'s `??[]` fallback
  gives `brightnessSizesMm: []` (reduces to uniform per decision 2), and
  `resolveImageBrightnessThinning()`'s `??0` fallback gives `brightnessThinning: 0` (the organic/
  edge `radiusAt` multiplier is exactly `1`) — every existing image layer of any fill mode
  regenerates byte-identical geometry.
* `sizeMode: 'brightness'` on any non-image layer throws from `normalizeMixedSizeParams()` — a
  caller bug, not a silently-absorbed case, matching the existing `'weight'`-on-non-text precedent.
* No `validateProject()` change, no project schema version bump (decision 2).
* No `StoneLayout`/`Stone` schema change — every stone this mode produces is an ordinary `Stone`
  with its own `sizeMm`, nothing new on the layout object itself.
* `gapMm: 0` is not assumed safe by decision 1's structural zero-drop argument (it requires
  `gapMm > 0`); `gapMm` is already `assertFiniteNumber`-validated `>= 0` at
  `normalizeImageParams()` (`:2287`-`:2290`) and every existing catalog stone size ships with a
  positive default gap in practice — the Test Plan measures the fixture's own `gapMm 0.3`, not a
  `gapMm 0` edge case, and this is flagged rather than silently assumed.

## Test Plan

`tools/test-img-006-brightness-sizes.mjs` (new, registered in `tools/test-groups.mjs` immediately
after `test-img-005-check-and-fix.mjs`):

**Fixture**, given verbatim as the code block the test file copies (per this repo's "pin the
fixture, not just the numbers" convention, `docs/specifications/IMG-004-EdgeAwareness.md` decision
8 / `IMG-005`'s own Test Plan):

```js
const N = 200, W = 60, H = 60, GAP = 0.3, SIZES = [2.0, 2.8, 4.0], THRESH = 200;
const d = new Uint8ClampedArray(N * N * 4);
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const i = (y * N + x) * 4; d[i] = d[i + 1] = d[i + 2] = x; d[i + 3] = 255; }
const field = prepareImageField(createImageBuffer({ widthPx: N, heightPx: N, data: d }), { threshold: THRESH, maxWidthPx: N, maxHeightPx: N, edgeBandFraction: 6 / W });
const placement = { xMm: 0, yMm: 0, widthMm: W, heightMm: H };
// sampler options for organic/edge/radial/contour: { seed: 1, spread: 1, edgeThinning: 1, gapMm: GAP }
```

A left-to-right x-gradient (`lum = x`), `threshold 200` (every pixel on), giving a clean dark→bright
left→right image and letting "band" simply mean an x-third: dark `[0,20)`, mid `[20,40)`, bright
`[40,60)` mm. Coverage is `Σ(π·d²/4)` over stones whose `xMm` falls in the band, divided by the
band's own `20 × 60` mm² area.

Measured baselines (re-run for this document via the scratch script cited in the Anchor
verification note — not copied from the brief), sampling every mode at `maxPitch = 4.3` mm
(`SIZES[-1] + GAP`):

| mode | assigned | dropped | coverage dark/mid/bright |
|---|---|---|---|
| fill | 196 | 0 | 0.733 / 0.287 / 0.183 |
| staggered | 216 | 0 | 0.754 / 0.369 / 0.188 |
| radial | 181 | 0 | 0.618 / 0.328 / 0.152 |
| contour | 141 | 0 | 0.545 / 0.210 / 0.126 |
| organic | 137 | 0 | 0.503 / 0.216 / 0.128 |
| edge | 40 | 0 | 0.136 / 0.062 / 0.039 |

Control row (`fill` at the roadmap's originally-proposed `2.3` mm min pitch, assign, drop — decision
1's rejected-mechanism measurement, not IMG-006's own output): 676 assigned, 299 dropped, coverage
0.681 / 0.467 / 0.579. If a later measurement disagrees with any figure above, stop and report the
disagreement — do not adjust either side to make them match.

1. **Ink rule, both `invert` settings.** `ink()` matches decision 3's formula at representative
   `lum`/`threshold` pairs for `invert` off and on, including both divisor-guard cases
   (`threshold === 0` for `invert` off, `threshold === 255` for `invert` on) returning `0` rather
   than throwing or returning `NaN`/`Infinity`.
2. **`fieldLuminanceAt()` pixel parity with `fieldLabelAt()`.** For a field carrying both `labels`
   and `luminance`, both functions resolve the identical pixel index for the same `(xMm, yMm)` —
   asserted by comparing their internal pixel-coordinate arithmetic against a shared set of
   absolute points, including off-field points (both return their own "not found" sentinel).
3. **Zero drops in all six modes**, on the fixture above, at `maxPitch`: `dropOverlappingSizedStones()`
   removes exactly `0` points in `fill`/`staggered`/`radial`/`contour`/`organic`/`edge`.
4. **Per-mode assigned counts and coverage** match the table above exactly, for all six modes.
5. **Control-row measurement** (the rejected "sample small, assign, drop" shape, `fill` only) matches
   676 assigned / 299 dropped / 0.681/0.467/0.579 coverage — pinned as a permanent regression guard
   on the rejected-mechanism comparison, not as a recommendation to build it.
6. **Byte-identity guard.** For every one of the six modes, `sizeMode: 'uniform'` (or omitted) with
   `brightnessThinning: 0` (or omitted) reproduces the exact same stone set as the pinned `IMG-003`/
   `IMG-004`/`IMG-005` baselines those milestones' own test files already assert — this milestone's
   test file re-asserts `deepEqual` against those same fixtures rather than re-deriving new ones.
7. **`sizeMode: 'brightness'` throws from every non-image `generate*Layout()`** — `generateTextLayout()`,
   `generateShapeLayout()`, `generateSvgLayout()`, `generatePathLayout()`, each called with
   `sizeMode: 'brightness'` and a valid `brightnessSizesMm`, all throw the same
   `allowBrightness`-guard error `normalizeMixedSizeParams()` raises.
8. **`brightnessSizesMm` reduction to uniform.** Zero or one entries in `brightnessSizesMm` produces
   output identical to `sizeMode: 'uniform'` at the layer's own `stoneSizeMm`, for a representative
   mode (`fill`).
9. **App-path source-text guards**, via the brace-balanced extraction convention
   `docs/BACKLOG.md` row 54 established: `generateImageStonesLive()`'s params object literally
   includes `brightnessSizesMm` (through the `mixedSizeParamsFor()` spread) and
   `brightnessThinning`; `HISTORY_TRACKED_CONTROL_IDS` literally includes `'imgBrightnessSteps'` and
   `'imgBrightnessThinning'`.

Report the raw per-test list above in this section, not a pass/fail count, per this repo's testing
policy for shared-architecture milestones.

---

## Anchor verification note

Every line number and function name cited above was re-grepped/re-read against this branch's actual
tip (`develop@7472614`) immediately before writing this document — `GeometryEngine.js`'s
`generateImageLayout()` (`:1181`-`:1262`) and MONO-015 weight branch (`:227`-`:279`),
`WeightSizing.js`, `MixedSizeGenerator.js`'s `normalizeMixedSizeParams()` (`:61`-`:88`),
`StoneSampler.js`'s `dropOverlappingSizedStones()` (`:583`), `fieldLabelAt()` (`:1778`),
`fieldEdgeAt()`/`fieldPixelOn()` (`:1744`-`:1756`), `sampleEdgeFieldFillPoints()` (`:1993`),
`sampleOrganicFieldFillPoints()` (`:1964`), `sampleFieldByMode()` (`:2025`), `StoneSizes.js`'s
`stoneSizeRungsAvailable()`/`stoneSizesFromBaseMm()` (`:106`/`:120`), `ImageFieldPipeline.js`'s
`prepareImageField()` (`:149`-`:197`), and every `app.js`/`index.html` line the brief named. All
matched; the two stale `IMG-000` citations (`StoneSampler.js:467`, `GeometryEngine.js:257`) were
confirmed stale against the actual current lines (`:583`, `:267`) and are corrected in Files
Touched.

Section 7's figures were reproduced exactly, not adjusted to fit: a scratch script at
`tools/scratch/img-006-brightness-sizes-check.mjs` (gitignored, per `.gitignore`'s `tools/scratch/`
convention — not tracked) built the fixture verbatim, sampled all six modes at
`maxPitch = 4.3` via the real `sampleFieldByMode()`, assigned sizes via the ink rule against the
real `field.luminance` (reading it with the exact `fieldLabelAt()`-style pixel arithmetic
`fieldLuminanceAt()` is specified to use, decision 3), ran the real `dropOverlappingSizedStones()`,
and computed per-band coverage. Every one of the six per-mode rows and the control row matched the
brief's figures exactly (`assigned`/`dropped`/coverage to three decimal places) on the first run —
no disagreement to report.
