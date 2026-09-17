# IMG-001 — Image-to-Strass: Multi-Channel Field and Transparency Policy

## Objective

`IMG-001` is the first of eight milestones turning the existing Image Trace layer (RS-1008,
corrected by RS-1008A, extended with fill modes by RS-1011 and Mixed Stone-Size by S-200) into a
multi-color, multi-mode, production-checked image-to-strass generator. This milestone delivers only:

(a) this umbrella specification and its eight-milestone roadmap,
(b) a multi-channel field returned by `prepareImageField()`,
(c) a transparency policy (`'white'` | `'ignore'`) controlling how alpha is treated.

No new sampling algorithm, no color quantization, and no UI beyond the transparency toggle are in
scope. See `docs/specifications/IMG-000-ImageToStrassAudit.md` for the reuse audit this roadmap is
built on.

## Eight-Milestone Roadmap

1. **IMG-001 — Field + transparency (this milestone).** `prepareImageField()` returns
   `{widthPx, heightPx, data, luminance, alpha, labels}`; a `transparent` policy (`'white'`/
   `'ignore'`) controls how alpha-channel pixels are treated. `labels` is reserved `null` until
   IMG-002. No sampler, exporter, or color-quantization change.
2. **IMG-002 — Color quantization and color layers.** Quantize the traced image's colors to the
   nearest `CrystalColors.js` catalog entries; populate the `labels` field IMG-001 reserved (one
   quantized-color index per pixel) and generate one stone group per resulting color, concatenated
   into the layer's `StoneLayout` on one shared `layerId` (mirroring how `MonogramGenerator.js`
   already builds multiple independently-generated groups into one output — see IMG-000's audit).
   Reuses `findCrossGroupCollisions()` to prove the per-color groups never overlap.
3. **IMG-003 — Organic generator.** A non-grid placement mode for a more natural, hand-set look
   (distinct from Grid/Staggered/Radial/Contour Fill's existing regular patterns). Uses a persisted
   per-layer seed (see Architectural Rules) so regeneration is deterministic. **Specified** in
   `docs/specifications/IMG-003-OrganicPlacement.md` — merged into develop at `2b13b51`.
4. **IMG-004 — Edge awareness.** Bias placement/density near detected edges in the source image, for
   crisper silhouettes on high-contrast source art. Likely needs a new, edge-weighted sampler — the
   one place this roadmap anticipates new sampling code, not reuse. **Specified** in
   `docs/specifications/IMG-004-EdgeAwareness.md`: the "new sampling code" turned out to be a
   generalization of IMG-003's own `samplePoissonDiskPoints()` (a `radiusAt` hook), not a new sampler.
5. **IMG-005 — Check & fix.** A validation pass over a generated image layout that repairs spacing
   violations without ever violating the manufacturing floor (see Architectural Rules). Scoped to
   image layers only — vector Contour/Radial (shape/SVG/path/text layers) share the identical
   `sampleShapeFillPoints()` dedupe-floor defect and are explicitly out of scope; see
   `docs/specifications/IMG-005-CheckAndFix.md`, "Out of Scope".
6. **IMG-006 — Brightness sizes.** Map measured per-point brightness (from IMG-001's `luminance`
   channel) to a stone size from `StoneSizes.js`'s existing catalog: every fill mode is sampled once
   at the *largest* candidate size's pitch and each surviving point is assigned a size from its own
   measured luminance, with `dropOverlappingSizedStones()` running only as a safety net expected to
   drop nothing — not MONO-015's "sample small, assign, drop" shape (measured to leave per-band
   coverage roughly constant instead of graduated; see `docs/specifications/IMG-006-BrightnessSizes.md`
   section 6) — and a different mechanism from S-200's additive infill, not a replacement for it.
7. **IMG-007 — Studio UX.** Full Image Trace Lightbox UX for every capability IMG-002 through
   IMG-006 added (color layer list, organic/edge/brightness controls, check & fix trigger/report).
   IMG-007 was executed before IMG-002 as the studio shell; later milestones fill its placeholder
   groups — IDs are not renumbered.
8. **IMG-008 — Vector-first SVG.** An SVG export path for image-derived layers that emits vector
   shapes reflecting the traced structure, rather than only per-stone circles.

Milestone numbers are fixed by this roadmap; scope within each is subject to refinement by its own
milestone brief when reached (per `docs/MILESTONE_WORKFLOW.md`).

## Architectural Rules (govern all eight milestones)

* **`src/image/**` stays pure and never imports `src/geometry/**`.** It prepares neutral,
  DOM-free input only (a field, and — from IMG-002 on — per-pixel color/label data); it never
  constructs a `Stone` or `StoneLayout`. This is RS-1008A's correction, unchanged and non-negotiable
  for every future image milestone — see `docs/specifications/RS-1008A-ImageTraceArchitectureCorrection.md`
  and `src/image/README.md`.
* **`generateImageLayout()` remains the only stone producer** for image-derived layers. IMG-002's
  color groups, IMG-003's organic placement, IMG-004's edge weighting, and IMG-006's brightness
  sizes are all computed *inside* `GeometryEngine.js` (directly, or via a narrowly-scoped sibling
  module it alone imports — the same relationship `ContourRingSampler.js` and
  `MixedSizeGenerator.js` already have to `GeometryEngine.js`/`StoneSampler.js`, per RS-1011 and
  S-200). No renderer or exporter ever generates or edits stone positions.
* **Every dimension is millimeters before sampling.** `src/image/**` only ever produces/consumes
  pixel (`*Px`) values and unitless 0-255/0-1 channel values; the mm placement box
  (`xMm`/`yMm`/`widthMm`/`heightMm`) is applied once, inside `GeometryEngine.generateImageLayout()`,
  exactly as today — unchanged by this roadmap.
* **Organic modes use a persisted seed.** Any placement mode with a random or pseudo-random element
  (IMG-003, and any organic variant IMG-004/IMG-006 might add) must derive its randomness from a
  seed value stored on the layer (`layer.seed` or equivalent), never from wall-clock time or
  iteration order — so "Deterministic output" (the same non-negotiable property every existing
  sampler already guarantees, per RS-1011/S-200) continues to hold: identical params always produce
  a `deepEqual` `StoneLayout`.
* **Check & fix (IMG-005) never violates `diameter/2 + diameter/2 + gap`.** The same manufacturing
  spacing floor S-200's Mixed Stone-Size infill already enforces
  (`docs/specifications/S-200-MixedStoneSizeLayouts.md`, "Manufacturing rules" table) is the one
  spacing law this entire roadmap operates under; a "fix" pass may remove or nudge a stone to satisfy
  it, but may never relax it, add a second spacing formula, or accept a caller-supplied override that
  would violate it.

## Field Contract (delivered by this milestone)

`prepareImageField(imageBuffer, params)` returns:

```
{
  widthPx: number,
  heightPx: number,
  data: Uint8ClampedArray,       // unchanged: binary/blurred density, 0-255, post threshold/invert/
                                  // transparency-mask/blur/resize -- byte-identical to pre-IMG-001
                                  // output for every existing caller (transparent:'white', the
                                  // default when omitted)
  luminance: Uint8ClampedArray,  // 0-255 grayscale (the existing toGrayscale() output, alpha always
                                  // flattened onto white here regardless of `transparent` -- see
                                  // "Why luminance never depends on `transparent`" below), resized
                                  // to the same widthPx/heightPx as `data`
  alpha: Uint8ClampedArray,      // 0/255 coverage mask (255 = opaque-enough source pixel), box-
                                  // averaged down to the same widthPx/heightPx as `data` then
                                  // re-thresholded to a strict 0/255 mask -- never a continuous value
  labels: null                   // reserved for IMG-002's per-pixel quantized-color index; every
                                  // IMG-001 caller receives exactly `null`
}
```

All four arrays share one `widthPx`/`heightPx` pair — the same post-resize working resolution
`data` has always had. `existing consumers (GeometryEngine.generateImageLayout()`'s
`sampleFieldByMode()` call, and the "preview before commit" density canvas) read only `data` and
gain no new behavior; they are unmodified by this milestone.

IMG-002 populates `labels` (in place of this milestone's reserved `null`) and adds a seventh field
key, `colorGroups`, whenever its caller passes `colorCount > 1` — see
`docs/specifications/IMG-002-ColorLayers.md` for the full contract; every caller that omits
`colorCount` (every caller this milestone has) keeps receiving exactly the six-key shape above.

### Why `luminance` never depends on `transparent`

`luminance` is documented above as "the 0-255 grayscale before threshold" — i.e. `toGrayscale()`'s
existing, unmodified output, which has always composited alpha onto white
(`src/image/Grayscale.js`'s own doc comment: "a PNG with a transparent background should trace only
its visible artwork"). This is deliberate, not an oversight: `luminance` is a brightness channel for
IMG-006 (brightness sizes) to read, and "how bright is this pixel, treating transparent as
background" is the only meaning of brightness that stays well-defined for a fully transparent pixel
(raw, un-composited RGB behind full transparency is frequently `0,0,0` or undefined by the source
codec — not a meaningful brightness). The `transparent` policy instead controls only whether a pixel
is *eligible to become a stone at all* (`data`), a separate, orthogonal question from *how bright it
is if eligible* (`luminance`).

## Transparency Policy

New `transparent` param on `prepareImageField()` and `GeometryEngine`'s `normalizeImageParams()`:

* **`'white'`** (default when omitted) — current behavior: alpha is flattened onto white before
  thresholding (`toGrayscale()`'s existing compositing), exactly as every pre-IMG-001 project and
  call site already behaves. No masking step runs.
* **`'ignore'`** — pixels whose source alpha is `< 128` are forced **off** in `data` (excluded from
  stone generation) regardless of what their composited luminance/threshold would otherwise say.
  Applied once, at native (pre-resize) resolution, immediately after threshold + optional invert and
  before blur — so a transparent region reads as a hard, un-blurred cutout rather than diffusing into
  its neighbors' density, and an `invert`ed mask cannot turn transparent background into foreground.

`layer.transparent` persists this choice per image layer. Migration/default rule (read-site
permissive default, following this codebase's established S-200/RS-1011 precedent — no
`validateProject()` change):

* Any image layer with no `transparent` field at all (every project saved before this milestone)
  resolves to `'white'` at every read site, via `resolveImageTransparentMode()`'s own
  missing/invalid → `'white'` fallback — so a saved project regenerates byte-identical geometry.
* A freshly imported image defaults its Lightbox toggle to `'ignore'`, which is what gets written
  onto the new layer at commit time unless the user changes it first.

### Measured behavior: when `'ignore'` actually differs from `'white'`

Re-derived directly against the real `toGrayscale()`/`applyThreshold()` (an exhaustive sweep over a
5-level-per-channel RGB grid × every `alpha` `0`-`127`, plus the analytic worst case) rather than
assumed: **at `threshold: 128` (the shipped default) with `invert` off, `'ignore'` changes nothing.**
`toGrayscale()`'s alpha-onto-white compositing (`luminosity·a + 255·(1-a)`) already maps every pixel
with `alpha < 128` to a composited luminance `>= 128` — the minimum any such pixel can reach is
exactly `128`, achieved only by an opaque-leaning black pixel at `alpha: 127`
(`255 - 127 = 128`) — and `applyThreshold()`'s strict "`luminance < threshold`" foreground rule
already treats `128` as background at `threshold: 128`. So the `'ignore'` masking step never has
anything left to override at the default threshold with invert off; confirmed by exhaustive sweep
(zero foreground classifications among 16,000 `(r,g,b,alpha)` combinations) and directly through
`prepareImageField()` itself.

`'ignore'` only diverges from `'white'` when:

* **`invert` is on** — invert flips every background pixel, including every transparent one, to
  foreground; `'ignore'` then forces the transparent ones back off. Measured: a fully transparent
  pixel (`alpha: 0`) at `threshold: 128`, `invert: true` produces `data: 255` (traced) under
  `'white'` and `data: 0` (excluded) under `'ignore'`.
* **`threshold` is raised above `128`** — once `threshold > 128`, a transparent pixel whose
  composited luminance falls in `[128, threshold)` becomes foreground under plain thresholding even
  without invert; `'ignore'` still excludes it. Measured: the boundary pixel (black, `alpha: 127`,
  composited luminance `128`) produces `data: 255` under `'white'` at `threshold: 129` and `data: 0`
  under `'ignore'`, while at `threshold: 128` the two agree (`data: 0` both).

The default stays `'ignore'`, not because it changes anything at the shipped default threshold with
invert off, but because it is the correct policy the moment a user inverts or raises the threshold
above `128` — both routine Image Trace adjustments — and because it becomes load-bearing for
IMG-002's color quantization: a transparent pixel must never be assigned a quantized color or stone
regardless of what its alpha-on-white luminance happens to composite to, and `'ignore'` is what
makes that guarantee hold from the start rather than being retrofitted once IMG-002 lands.

Exposed as a two-option control (`imgTransparent` in the edit panel, `imgPreviewTransparent` in the
import-preview panel — both next to their respective Invert control) in the Image Trace Lightbox.

## Out of Scope (deferred to later milestones per the roadmap above)

* No color quantization, no per-color layers, no `labels` population (IMG-002).
* No organic/edge/brightness/check-and-fix generation modes (IMG-003 through IMG-006).
* No Lightbox UX beyond the transparency toggle (IMG-007).
* No vector-first SVG export path (IMG-008).
* No `DxfExporter.js` per-size layer grouping (confirmed color-only by IMG-000's audit; a future
  milestone's concern, not this one's).

## Compatibility

* `prepareImageField()`'s `data` output is byte-identical for every existing caller
  (`transparent` omitted or `'white'`) — proven by `tools/test-img-001-field.mjs` against the same
  fixtures `tools/test-image-pipeline.mjs` already uses.
* `GeometryEngine.generateImageLayout()`'s existing callers (every pre-IMG-001 saved `image` layer,
  which has no `transparent` field) generate byte-identical `StoneLayout` output — `transparent`
  resolves to `'white'` and takes the pre-existing code path with no masking step inserted.
* No `StoneLayout`/`Stone` schema change; no project version bump — `transparent` is a new, optional,
  permissively-defaulted layer field, following the exact precedent
  `docs/specifications/S-200-MixedStoneSizeLayouts.md`'s "Compatibility Strategy" section already
  established for `sizeMode`/`allowedSizesMm`/etc.

## Test Plan

`tools/test-img-001-field.mjs` (new, registered in `tools/test-groups.mjs`'s `core` and `geometry`
groups alongside `test-image-pipeline.mjs`):

* `data` is byte-identical to the pre-IMG-001 pipeline on the fixtures `tools/test-image-pipeline.mjs`
  already uses.
* `alpha` correctness on a synthetic RGBA buffer with a fully transparent quadrant.
* `'ignore'` vs `'white'` produce different `data` on that same buffer, and identical `data` on a
  fully opaque buffer (no alpha channel in play — both policies must agree when there is nothing to
  ignore).
* Migration default: `transparent` omitted resolves to `'white'`-equivalent output.

## Deliverables

* `docs/specifications/IMG-000-ImageToStrassAudit.md`, `docs/specifications/IMG-001-ImageToStrass.md`
  (this file).
* `src/image/Alpha.js` (new), `src/image/ImageFieldPipeline.js`, `src/image/index.js`,
  `src/image/README.md`.
* `src/geometry/GeometryEngine.js` (`normalizeImageParams()`, `generateImageLayout()`).
* `app.js`, `index.html` (transparency toggle, both Image Trace Lightbox panels).
* `tools/test-img-001-field.mjs` (new), `tools/test-groups.mjs`.
* `docs/BACKLOG.md` (deferred items noticed during this milestone).
