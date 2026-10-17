# IMG-008 — Vector-First SVG

## Objective

IMG-008 is the eighth and last milestone of `IMG-001`'s roadmap
(`docs/specifications/IMG-001-ImageToStrass.md:55`-`:56`: "**IMG-008 — Vector-first SVG.** An SVG
export path for image-derived layers that emits vector shapes reflecting the traced structure,
rather than only per-stone circles").

The roadmap does not say what "vector shapes reflecting the traced structure" are for a
raster-derived layer, and the three plausible readings produce very different exports. This spec
settles that by measurement (next section) before anything else: the shapes are the **per-colour
silhouettes traced from the layer's own working field** (`field.data`, split by `field.labels` when
the layer is quantized), traced by the marching-squares vectorizer `src/geometry/PathBoolean.js`
already uses for Boolean operations, with every region smaller than one stone footprint dropped.
They are emitted *underneath* the stones in the same `2D SVG` export (`index.html:1253`,
`app.js:5290`), and the stones themselves gain `<g>` grouping by layer, colour and size. Nothing
about DXF, PNG, the production sheet, or any non-image layer's SVG output changes.

Today `stoneLayoutToSvg()` (`src/export/SvgExporter.js:47`-`:61`) emits one `<circle>` per stone
and nothing else. The project-level `StoneLayout` it receives is built by `generate()`
(`app.js:957`), which flattens every visible layer's stones into one list and keeps nothing
per-layer beyond each stone's own `layerId`/`color`/`sizeMm` — so the traced structure cannot come
*through* the layout; it has to be resolved at export time from the image layers themselves, the
way `resolveLayerShapeSource()` (`app.js:3173`-`:3219`) already resolves an image layer into a
`{kind:'field'}` source for Boolean operations.

## Measured comparison (the decision's evidence)

Two fixtures, each 240×240 px, placed at 60×60 mm at the origin, `stoneSizeMm` 2.8, `gapMm` 0.5,
`threshold` 128, no blur, no invert. Both generators are pinned verbatim below and reused as-is by
`tools/test-img-008-vector-first-svg.mjs`; they are what every number in this document was
measured on, against `develop@49b3b26`.

```js
const N = 240;
const W = 60, H = 60;
const STONE = 2.8, GAP = 0.5;
const PALETTE = [
  { id: 'siam', hex: '#c81414' },
  { id: 'citrine', hex: '#e6c81e' },
  { id: 'sapphire', hex: '#1414c8' },
  { id: 'crystal', hex: '#ffffff' }
];

function lcg(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function heartInside(u, v) {
  const x = (u - 0.5) * 3.2, y = -(v - 0.5) * 3.2;
  const a = x * x + y * y - 1;
  return a * a * a - x * x * y * y * y < 0;
}
function starInside(u, v) {
  const cx = 0.5, cy = 0.5, R = 0.14, r = 0.06;
  const dx = u - cx, dy = v - cy;
  const ang = Math.atan2(dy, dx), d = Math.hypot(dx, dy);
  const k = 5, t = ((ang + Math.PI / 2) % (2 * Math.PI / k) + 2 * Math.PI) % (2 * Math.PI / k);
  const phase = Math.abs(t - Math.PI / k) / (Math.PI / k);
  return d < r + (R - r) * phase;
}
function ringInside(u, v) {
  const d = Math.hypot(u - 0.5, v - 0.5);
  return d > 0.44 && d < 0.49;
}
function logoBuffer() {
  const d = new Uint8ClampedArray(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let r = 0, g = 0, b = 0;
    for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
      const u = (x + (sx + 0.5) / 4) / N, v = (y + (sy + 0.5) / 4) / N;
      let c = [255, 255, 255];
      if (ringInside(u, v)) c = [20, 20, 200];
      if (heartInside(u, v)) c = [200, 20, 20];
      if (starInside(u, v)) c = [180, 120, 10];
      r += c[0]; g += c[1]; b += c[2];
    }
    const i = (y * N + x) * 4;
    d[i] = r / 16; d[i + 1] = g / 16; d[i + 2] = b / 16; d[i + 3] = 255;
  }
  return createImageBuffer({ widthPx: N, heightPx: N, data: d });
}
function photoBuffer() {
  const d = new Uint8ClampedArray(N * N * 4);
  const rnd = lcg(7);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N;
    const dd = Math.hypot(u - 0.45, v - 0.42);
    let lum = 235 - 210 * Math.max(0, 1 - dd / 0.42);
    lum += 40 * Math.sin(u * 40) * Math.sin(v * 33);
    const sh = Math.hypot(u - 0.6, v - 0.75);
    if (sh < 0.2) lum -= 90 * (1 - sh / 0.2);
    lum += (rnd() - 0.5) * 50;
    lum = Math.max(0, Math.min(255, lum));
    const i = (y * N + x) * 4;
    d[i] = lum; d[i + 1] = lum; d[i + 2] = lum; d[i + 3] = 255;
  }
  return createImageBuffer({ widthPx: N, heightPx: N, data: d });
}
```

`logo` is a red heart inside a blue ring with a dark-gold star cut into the heart, 4×4
supersampled so its edges are anti-aliased; at threshold 128 the star is an on-region of its own
(luminance ≈ 124), so it is a hole in the heart's label mask and a filled region in its own.
`photo` is a shaded, textured, noisy grayscale sphere with a cast shadow, so its threshold mask is
ragged the way a thresholded photograph is. `colorCount` drives the per-label rows; `stoneSizeMm`
drives the area floor (π·1.4² = 6.158 mm²); `stoneSizeMm + gapMm` (3.3 mm) is the
`targetSpacingMm` handed to `combineShapeSources()` and therefore drives the vertex counts through
`computeAdaptiveCellSizeMm()` (`PathBoolean.js:115`).

Candidates: **(a)** contours traced from the working field by `combineShapeSources()`
(`PathBoolean.js:206`), one label at a time; **(b)** the Contour-mode ring polygons
`computeInwardRingPolygons()` (`ContourRingSampler.js:716`) already computes during sampling;
**(c)** a potrace-style curve fit, approximated for measurement by Douglas-Peucker simplification
of (a) since curve fitting changes vertex count, not shape count. Circles are today's export via
`generateImageLayout()` + `stoneLayoutToSvg()`.

| Fixture, `colorCount` | Circles today (fill / contour / organic) | (a) raw contours | (a) after the one-stone floor | IoU of (a) vs its own mask | (b) rings |
|---|---|---|---|---|---|
| logo, 1 | 166 / 80 / 124 | 3 | 3 (657 vertices; areas 2713.7, 81.9, 835.1 mm²) | 0.988 | 7 rings, outermost IoU 0.614 |
| logo, 3 — siam | same | 2 | 2 (287 vertices; 1278.5, 118.6 mm²) | 0.991 | — |
| logo, 3 — citrine | same | 32 | 1 (99 vertices; 118.6 mm²) | 0.959 | — |
| logo, 3 — sapphire | same | 2 | 2 (516 vertices; 2713.7, 2198.7 mm²) | 0.971 | — |
| photo, 1 | 51 / 21 / 58 | 448 | 3 (987 vertices; 541.8, 7.8, 14.0 mm²) | 0.825 | 6 rings, outermost IoU 0.320 |
| photo, 3 — citrine | same | 182 | 2 (440 vertices) | 0.716 | — |
| photo, 3 — siam | same | 405 | 7 (1187 vertices) | 0.536 | — |
| photo, 3 — crystal | same | 559 | 7 (596 vertices) | 0.205 | — |

IoU is the area overlap between the vector fill and the on-pixel mask it was traced from, sampled
on a 2 px grid (1.0 = identical). (c)'s proxy on `logo` reduces 657 vertices to 306 (ε 0.15 mm,
IoU 0.985) or 92 (ε 0.3 mm, IoU 0.982) with the shape count unchanged.

What the table settles:

* **(b) is not the traced structure — it is the sampling.** The outermost ring sits half a pitch
  inside the true edge by construction (`startOffsetMm: spacingMm / 2`,
  `StoneSampler.js:1975`), so as a filled shape it is wrong (IoU 0.61 on a clean logo), and it
  only exists for Contour mode. Rejected.
* **(c) buys nothing this milestone needs.** Fidelity loss from simplification is under 1 % and the
  polyline export is already smaller than the circle export it accompanies (8,982 bytes of region
  paths vs 20,032 bytes of circles on `logo`). New curve-fitting code is not justified. Rejected;
  (a)'s polylines are already simplified at `cellSizeMm * 0.35` by `simplifyContour()`
  (`PathBoolean.js:426`).
* **(a) needs the area floor, non-negotiably.** A thresholded photograph traces to 448 regions of
  which 445 are smaller than one stone; with the floor it is 3. On `logo` the floor turns the
  citrine label's 32 fragments (anti-aliased edge pixels quantized to the nearest palette entry) into
  the one real star and drops nothing real. Tiny per-colour islands at quantized edges are normal,
  not a defect.

## Decisions

### 1. Vector representation — per-colour silhouettes from the working field, floored at one stone

For each visible image layer, `GeometryEngine.resolveImagePolygons()` (new; decision 3) prepares
the layer's working field exactly as `generateImageLayout()` does (`GeometryEngine.js:1189`-`:1200`,
the same `prepareImageField()` call with the same threshold/invert/blur/transparent/colorCount/
palette), then:

* if `colorCount > 1` and `field.labels` is non-null, for every label value present in
  `field.labels` on an on-pixel, in ascending label order, traces the mask `data >= 128 && labels
  === label` — one region set per label, coloured by the same rule `colorAt()` uses for stones
  (`GeometryEngine.js:1242`-`:1248`: `colorMap[colorGroups[label].nearestId] ??
  colorGroups[label].nearestId`);
* otherwise traces `data >= 128` once, coloured `options.color`.

Tracing is `combineShapeSources(source, null, 'union', { targetSpacingMm: stoneSizeMm + gapMm })`
with `source = { kind: 'field', field, xMm, yMm, widthMm, heightMm, label }` — `label` is a new
optional key on the field source that `sampleSource()` (`PathBoolean.js:168`-`:180`) honours by
additionally requiring `field.labels[i] === label`; absent, `sampleSource()` is byte-identical to
today. A `null` clip source already works: `sourceBoundingBox(null)` returns null and
`sampleSource(null)` returns 0, and union with 0 is the identity — measured identical output to a
self-union on every fixture row above, at half the sampling cost.

Every traced contour whose `contourAreaAbs()` (`PathBoolean.js:461`) is below
`Math.PI * (stoneSizeMm / 2) ** 2` is dropped. This applies to holes as well as outers: a hole
smaller than one stone footprint can never hold a stone, so filling it over loses nothing a stone
could have shown. A label whose region set is empty after the floor is omitted entirely.

Regions are absolute project millimetres (the field source carries the placement, so
`combineShapeSources()` returns them placed), the same space every stone already lives in.

### 2. SVG document structure — regions under stones, stones grouped

`stoneLayoutToSvg(stoneLayout, canvas, options)` gains an optional third parameter. With `options`
omitted the output is **byte-identical** to today for every stone list (Compatibility and Test
Plan item 1). With `options.regions` supplied — an array, possibly empty, of
`{ layerId, colorId, contours }` records — the document becomes:

```
<svg ...>
<rect width="100%" height="100%" fill="white"/>
<g id="regions">
<g data-layer="…" data-color="…"><path d="M…L…Z M…L…Z" fill="…" fill-opacity="0.35" stroke="…" stroke-width="0.12" fill-rule="evenodd"/></g>
…
</g>
<g id="stones">
<g data-layer="…" data-color="…" data-size="2.800">
<circle …/>
…
</g>
…
</g>
</svg>
```

* One `<path>` per region record, every contour of that record as a subpath of the same `d`,
  `fill-rule="evenodd"` — a hole contour nested in an outer contour of the same colour renders as a
  hole without this module knowing which is which, the same even-odd convention every existing
  consumer of a contour list already relies on (`PathBoolean.js:28`-`:32`). Fill and stroke come
  from `STONE_COLORS[colorId]` exactly as `stoneCircleSvg()` resolves them, falling back to
  `crystal`. Coordinates to 3 decimals, like circles.
* Region records are emitted in the order given (app.js gives them in `project.layers` order, then
  ascending label order).
* Stones are grouped by `layerId` in order of first appearance in `stoneLayout.stones`, then by
  `color` sorted ascending, then by `sizeMm` ascending — colour-then-size mirrors
  `computeSizeBreakdown()` (`ProductionSheetExporter.js:115`-`:133`). Within a group, circles keep
  their relative order from `stoneLayout.stones`. Each circle is still `stoneCircleSvg(stone)`,
  unchanged, so `ProductionSheetExporter.js`'s reuse of that helper is untouched.
* `regions` empty still selects this structure (a `<g id="regions">` with no children, then grouped
  stones): the app's export always passes the array, so a project with no image layers gets the
  grouped document, not the legacy flat one. The legacy shape exists only for callers that never
  pass `options` — the four test files that call `stoneLayoutToSvg()` directly and any external
  consumer of the module.

The export stays one button. A second "vector only" export was considered and rejected: the value
of the regions is to sit under the stones as editable, selectable silhouettes in Illustrator /
Inkscape / a cutter's software; separated from the stones they are a worse version of a Boolean-op
result the app can already produce.

### 3. Architecture — a resolver on the engine, an optional input on the exporter

`GeometryEngine.resolveImagePolygons(params)` mirrors `resolveShapePolygons()`
(`GeometryEngine.js:842`) and `resolveSvgPolygons()` (`:1058`): it takes the same params object
`generateImageLayout()` takes, runs it through `normalizeImageParams()` (`:2328`) unchanged (so
`stoneSizeMm`, `layerId`, `imageBuffer` are validated identically and `mode` is accepted and
ignored), and returns `{ regions: [{ colorId, contours }], boundingBox }` with `boundingBox` the
union of every kept contour (null when there are none). It produces no `Stone` and no
`StoneLayout`; `generateImageLayout()` remains the only stone producer for image layers
(`IMG-001-ImageToStrass.md`, Architectural Rules) and `src/image/**` is untouched.

`app.js`'s `exportSVG` handler (`:5290`) stays synchronous — `test-production-export-validation.mjs:216`
pins every export handler's exact opening `el('exportSVG').onclick=()=>{if(!layout){…return}try{`,
and an `async` arrow would break that regex — and, inside its existing `try`, builds `regions` via a
new synchronous `resolveImageExportRegions(project)`: for every `project.layers` entry that is
visible, `type === 'image'`, has `imageSrc` and `w > 0 && h > 0`, it reads the decoded buffer from
`imageBufferCache` and throws `Error('Image layer "<name>" is not decoded yet.')` on a miss (the
handler's existing `catch` turns that into the `Export failed: …` status line; a miss cannot happen
once `layout` is ready, because `generateImageStonesLive()` at `:1018` populates the cache for every
visible image layer during `generate()`), calls `permanentEngine.resolveImagePolygons(params)`, and
pushes `{ layerId: layer.id, colorId, contours }` per returned region. Nothing is added to
`project.layers`, to any schema, or to `StoneLayout`; nothing is persisted.

`SvgExporter.js` keeps its purity guard (`tools/test-render-export-pipeline.mjs:124`-`:132`): the
region records it receives are plain `{layerId, colorId, contours}` data, and the module still
never references `project.layers`, a layer's type, or a layer-type literal.

### 4. Wiring — the params object at the new site is a guarded duplicate

The field the regions are traced from must be the field the stones were sampled from, or the
silhouettes will not match the stones. `resolveImageExportRegions()`'s params object therefore
carries every field-shaping key `generateImageStonesLive()` (`app.js:1018`) forwards —
`threshold`, `invert`, `blurRadiusPx`, `maxWidthPx`, `maxHeightPx`, `transparent` (via
`resolveImageTransparentMode()`), `colorCount`, `palette` (via `imageColorPalette()`),
`colorMap`, `color`, `stoneSizeMm`, `gapMm`, `xMm`/`yMm`/`widthMm`/`heightMm`,
`edgeWidthMm` (via `resolveImageEdgeWidth()`, so `prepareImageField()` receives the same
`edgeBandFraction` and the field object is built identically even though `edge` is not read here).
This is the third such params object in `app.js` (after `generateImageStonesLive()` and
`resolveLayerShapeSource()`); the IMG-003 → IMG-006 lesson (`docs/BACKLOG.md:54`) is that a
duplicate without a guard drifts silently, so Test Plan item 9 pins the key set by source text.
`generateImageStonesLive()` itself is not refactored: three existing guards
(`test-img-004-edge-awareness.mjs:413`, `test-img-005-check-and-fix.mjs:332`,
`test-img-006-brightness-sizes.mjs:304`) pin its body by `extractFunctionBody()`, and a shared
helper would hollow that body out from under them.

### 5. DXF per-size layers (`docs/BACKLOG.md:49`) — stays deferred, explicitly

IMG-008 is an export milestone, so this row's "waiting on a dedicated export milestone" clause is
now answered: **not here.** Renaming DXF layers from `STONES_<COLOR>` to a colour-and-size key
changes the cutting-template output for every layer type, not only image layers, and cutter
operators may already key on the current names. IMG-008's SVG stone grouping (decision 2) lands the
colour-then-size structure DXF would mirror; the row is updated to cite it as the precedent and to
name the follow-on as a small standalone `RS-30xx`, not an `IMG-` item.

### 6. Vector Contour/Radial spacing floor (`docs/BACKLOG.md:55`) — out of scope

IMG-008 touches no sampler and changes no stone; the row is untouched and stays open for the
milestone that generalizes `nudgeOrDropStonePoints()` to `sampleShapeFillPoints()`.

## Structure

1. `src/geometry/PathBoolean.js` — `sampleSource()` honours an optional `source.label` on a
   `'field'` source. No other change; `combineShapeSources()`'s signature and every existing
   caller's output are unchanged.
2. `src/geometry/GeometryEngine.js` — `resolveImagePolygons(params)` (decision 3), placed next to
   `generateImageLayout()`. Exported through `src/geometry/index.js` only via the engine instance
   (like the other `resolve*Polygons()` methods; no new barrel export).
3. `src/export/SvgExporter.js` — `stoneLayoutToSvg(stoneLayout, canvas, options)` (decision 2), a
   new exported `regionPathSvg(region)` helper alongside `stoneCircleSvg()`, and a module-level
   comment documenting the two document shapes.
4. `app.js` — synchronous `resolveImageExportRegions(project)` and the `exportSVG` handler's
   `try` body (decisions 3 and 4). `imageColorPalette()` (`:720`), `resolveImageTransparentMode()` and
   `resolveImageEdgeWidth()` are reused, not duplicated.
5. `tools/test-img-008-vector-first-svg.mjs` — Test Plan below, registered in
   `tools/test-groups.mjs` next to `test-img-006-brightness-sizes.mjs` (both occurrences,
   `:64` and `:187`).
6. Docs — this spec; `IMG-001-ImageToStrass.md` roadmap item 8 gains one sentence naming this spec
   and the chosen representation; `IMG-000-ImageToStrassAudit.md:118`-`:122`'s "for IMG-006/IMG-008
   to pick up" note on DXF per-size layers is appended with decision 5's outcome; `docs/BACKLOG.md`
   row 49 is updated per decision 5; `docs/ARCHITECTURE.md:938`'s export edge label "(one <circle>
   per stone)" is corrected to name the grouped document and regions.

## Out of Scope

* No DXF change of any kind (decision 5).
* No sampler change (decision 6); no change to any stone's position, size or colour.
* No curve fitting (measured comparison, candidate c).
* No new per-layer field, no schema/version change, no persistence of regions.
* No PNG or production-sheet change; `stoneCircleSvg()` is unchanged.
* No Studio UI: there is no control to add. The Export panel's button text is unchanged.
* Vector (non-image) layers get no traced regions — their polygons are already vector and a
  separate "export layer outlines" feature would be its own milestone.
* Brightness mode (`sizeMode: 'brightness'`) traces at the layer's own `stoneSizeMm`, not the
  largest rung, for the area floor; stones larger than the floor are still stones over a region
  that exists. Not a defect; noted so it is not mistaken for one.

## Files Touched

* `src/geometry/PathBoolean.js` — `sampleSource()` (`:168`-`:180`).
* `src/geometry/GeometryEngine.js` — new `resolveImagePolygons()` after `generateImageLayout()`
  (`:1181`); reads `normalizeImageParams()` (`:2328`) and the `colorAt()` colour rule
  (`:1242`-`:1248`), which is factored into a small private `imageRegionColorId(options, field,
  label)` used by both `colorAt()` and the resolver so the two cannot drift.
* `src/export/SvgExporter.js` — `stoneLayoutToSvg()` (`:47`-`:61`), new `regionPathSvg()`.
* `app.js` — `exportSVG` handler (`:5290`), new `resolveImageExportRegions()` next to
  `resolveLayerShapeSource()` (`:3173`).
* `tools/test-img-008-vector-first-svg.mjs` (new), `tools/test-groups.mjs` (`:64`, `:187`).
* `docs/specifications/IMG-008-VectorFirstSvg.md` (this file),
  `docs/specifications/IMG-001-ImageToStrass.md` (`:55`-`:56`),
  `docs/specifications/IMG-000-ImageToStrassAudit.md` (`:118`-`:122`), `docs/BACKLOG.md` (`:49`),
  `docs/ARCHITECTURE.md` (`:938`).

## Compatibility

* `stoneLayoutToSvg(layout, canvas)` with no third argument is byte-identical to `develop@49b3b26`
  for every input. Pinned by Test Plan item 1 against two SHA-256 digests measured on pristine
  `develop@49b3b26` before any implementation existed (not against anything this milestone
  produces).
* `combineShapeSources()` with a field source that carries no `label` key is byte-identical; every
  existing Boolean-op caller passes none.
* `generateImageLayout()`'s output is untouched: the colour-rule factoring in `GeometryEngine.js`
  is a pure move, guarded by Test Plan item 8.
* `ProductionSheetExporter.js` is untouched and still imports the unchanged `stoneCircleSvg()`.
* Saved projects are unaffected: nothing new is read from or written to a layer.

## Test Plan

`tools/test-img-008-vector-first-svg.mjs`, using the pinned generators above verbatim. Every
literal below is inline in the test file, measured on `develop@49b3b26` (items 1, 8) or from this
spec's implementation of decisions 1-2 as measured with the scratch probe (items 2-7); none is
recomputed at test time.

1. **Byte-identity of the legacy document.** `stoneLayoutToSvg(layout, {widthMm:60,heightMm:60})`
   with no third argument, for `logo` at `mode:'fill'`, `colorCount:1` (166 stones) has SHA-256
   `4b18330655e8903eba719c38314039a15bdc0ec94a39b1c521692146fd46f475`; for `photo` at
   `mode:'organic'`, `seed:1`, `spread:1`, `colorCount:3`, `palette:PALETTE`, `colorMap:{}`
   (58 stones) it is `e8d4f4506fa19dc4a8298f1ee0a7d66c2325848527ea09b628ae44651567e70e`. Both
   measured on pristine `develop@49b3b26`.
2. **`sampleSource()` label filter.** Tracing `logo`'s `colorCount:3` field with `label` 0, 1, 2
   yields raw contour counts 2, 32, 2 respectively; without `label`, 3. A `null` clip source gives
   output deep-equal to a self-union for all four calls.
3. **`resolveImagePolygons()` on `logo`, `colorCount:1`.** One region, `colorId` equal to the
   `color` passed (`null` when omitted, since `normalizeImageParams()` defaults `color` to `null`
   — `GeometryEngine.js:2361` — not to a color id; `regionPathSvg()` still falls back to
   `STONE_COLORS.crystal` for fill/stroke on a `null`/unknown `colorId`, so the rendered path is
   unaffected), 3 contours, 657 vertices in total, contour areas (to 0.1 mm², in returned order)
   2713.7, 81.9, 835.1.
4. **`resolveImagePolygons()` on `logo`, `colorCount:3`.** Three regions in label order:
   `siam` 2 contours (287 vertices; 1278.5, 118.6 mm²), `citrine` 1 contour (99 vertices;
   118.6 mm²), `sapphire` 2 contours (516 vertices; 2713.7, 2198.7 mm²). The 31 citrine fragments
   below 6.158 mm² are gone. With `colorMap: { citrine: 'sapphire' }` the second region's `colorId`
   is `'sapphire'` and nothing else changes.
5. **The floor on `photo`.** `colorCount:1`: 3 contours kept of 448 raw (the raw count is measured
   by calling `combineShapeSources()` directly on the same source), areas 541.8, 7.8, 14.0 mm².
   `colorCount:3`: regions kept per label are 2, 7, 7 of raw 182, 405, 559.
6. **Fidelity.** IoU of each kept region set against its own mask, sampled on a 2 px grid, equals
   0.988 (`logo`, 1), 0.991 / 0.959 / 0.971 (`logo`, 3, label order), 0.825 (`photo`, 1) to three
   decimals — the test reimplements the IoU probe independently of `PathBoolean.js`'s own interior
   test only through `isPointInsidePolygons()`, which is the exporter's consumers' notion of
   "inside".
7. **Document structure with `options.regions`.** For `logo` `colorCount:3`, `mode:'fill'` stones
   plus the item-4 regions: exactly one `<g id="regions">` preceding exactly one `<g id="stones">`;
   3 region `<path>` elements, each with `fill-rule="evenodd"`, the `siam` path's `d` containing
   exactly two `Z`; `<circle>` count still 166; every circle inside a `<g data-layer="img1"
   data-color="…" data-size="2.800">`; stone groups ordered `citrine`, `sapphire`, `siam`
   (ascending); circle `cx`/`cy`/`r` strings identical to the legacy document's, in the same relative
   order within each group. `options.regions = []` still yields both `<g>` containers and grouped
   circles. Passing `options` without `regions` yields the legacy document.
8. **Colour-rule factoring is a pure move.** `generateImageLayout()` on `logo` `colorCount:3`
   `mode:'fill'` yields 166 stones: `siam` 109, `sapphire` 46, `citrine` 11 — measured on pristine
   `develop@49b3b26`.
9. **App-path source-text guard.** `app.js` contains `function resolveImageExportRegions(` and
   its body includes each of `threshold:`, `invert:`, `blurRadiusPx:`, `maxWidthPx:`,
   `maxHeightPx:`, `transparent:resolveImageTransparentMode(`, `colorCount:`,
   `palette:imageColorPalette()`, `colorMap:`, `edgeWidthMm:resolveImageEdgeWidth(`,
   `stoneSizeMm:`, `gapMm:`, `permanentEngine.resolveImagePolygons(`, and `imageBufferCache.get(`;
   `resolveImageExportRegions` is declared with `function`, not `async function`; the `exportSVG`
   handler still matches `test-production-export-validation.mjs:216`'s regex and its body contains
   `resolveImageExportRegions(project)` and passes `{regions` to `stoneLayoutToSvg(`.
10. **Purity guard still holds.** Re-runs `test-render-export-pipeline.mjs` test 8's three regexes
    against `SvgExporter.js` (duplicated here so this file fails on its own, not one run later).

Pre-existing tests that pin literal source shapes near what this milestone changes, grepped
against `develop@49b3b26` so the implementation commit keeps them green rather than discovering
them one per run: `test-production-export-validation.mjs:216` (handler opening regex, above);
`test-object-template-integration.mjs:303` (`el('exportSVG').onclick=`); `test-render-export-pipeline.mjs`
test 7 (legacy document: two circles, `cx`/`r` strings — unaffected because no third argument is
passed) and test 8 (purity regexes); `test-image-trace-regression.mjs` test 2 and
`test-mono-006b-stale-authored-scale-initial-load-recovery.mjs:342` (`generate()`'s image dispatch
line — untouched); the three `extractFunctionBody()` guards on `generateImageStonesLive()` (decision
4 — untouched). `test-documentation-consistency.mjs` does not check `ARCHITECTURE.md` line content
(`:115` excludes it from path checks), so the `:938` label edit is safe.

## Anchor verification note

Every line number and function name cited above was re-grepped against `develop@49b3b26`
immediately before writing this document: `SvgExporter.js` `stoneCircleSvg()` (`:37`) and
`stoneLayoutToSvg()` (`:47`-`:61`); `DxfExporter.js` `dxfLayerNameForColor()` (`:29`);
`ProductionSheetExporter.js` `computeSizeBreakdown()` (`:115`-`:133`); `PathBoolean.js`
`computeAdaptiveCellSizeMm()` (`:115`), `sourceBoundingBox()` (`:146`), `sampleSource()`
(`:168`-`:180`), `combineShapeSources()` (`:206`), `traceCombinedMask()` (`:270`),
`simplifyContour()` (`:426`), `contourAreaAbs()` (`:461`); `ContourRingSampler.js`
`computeInwardRingPolygons()` (`:716`); `StoneSampler.js` `sampleContourFieldFillPoints()`
(`:1965`, `startOffsetMm` at `:1975`); `GeometryEngine.js` `resolveShapePolygons()` (`:842`),
`resolveSvgPolygons()` (`:1058`), `generateImageLayout()` (`:1181`, `prepareImageField()` call
`:1189`-`:1200`, `colorAt()` `:1242`-`:1248`), `normalizeImageParams()` (`:2328`); `app.js`
`generate()` (`:957`), `generateImageStonesLive()` (`:1018`), `imageColorPalette()` (`:720`),
`resolveLayerShapeSource()` (`:3173`-`:3219`), `exportDXF`/`exportSVG` handlers
(`:5289`-`:5290`); `index.html` (`:1248`, `:1253`); `tools/test-render-export-pipeline.mjs`
tests 7-8 (`:108`-`:132`); `tools/test-groups.mjs` (`:64`, `:187`); `docs/BACKLOG.md` rows
(`:49`, `:54`, `:55`); `IMG-000-ImageToStrassAudit.md` (`:118`-`:122`);
`IMG-001-ImageToStrass.md` (`:55`-`:56`); `docs/ARCHITECTURE.md` (`:938`).
