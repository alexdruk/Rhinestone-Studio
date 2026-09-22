# IMG-012 — Automatic Best-Fit Colour Count

**SPEC ONLY.** No changes to `app.js`, `index.html`, `src/**`, or `tools/**` in this milestone.
Every file:line citation below is against `develop` @ `5a69e50` (this branch's fork point).

## Objective

`#imgColorCount` (IMG-002) currently forces an operator to guess how many catalog colours an
imported image needs. IMG-012 adds an **Auto (best fit)** option that picks a colour count `k` in
`[2, 8]` by minimising the mean CIE76 colour error introduced by quantizing the image's subject
pixels down to `k` clusters and matching each cluster to the nearest catalog colour. Choosing a
number manually is unchanged.

## Product decisions (given, not open for redesign)

1. `#imgColorCount` gains a first option "Auto (best fit)", default for new imports, replacing
   IMG-011's `colorCount:6` factory literal. Manual numeric choice is unchanged.
2. Auto sweeps `k = 2..8`. For each `k`, quantize the subject pixels with the existing
   `quantizeColors()` (which already calls `assignNearestIds()` internally) and compute the mean
   CIE76 ΔE between every subject pixel's *original* colour and the catalog colour its cluster
   resolved to. Choose the `k` with the lowest mean; when two `k` are within 1% of each other,
   prefer the larger. Subject pixels are whichever set the layer's current `maskMode` keeps.
3. The Studio shows the chosen count next to the control (e.g. "Auto: 5 colours").
4. Saved projects are byte-identical: a stored numeric `colorCount` keeps meaning exactly that
   number; only new imports default to Auto. Every read site that sees an absent or numeric
   `colorCount` behaves as today.
5. Auto recomputes once per change of image, mask parameters, or working resolution, and is
   cached; it must not re-run on seed/spread/stone-size/gap/fill-mode/colour-pick edits.

No decision above conflicts with the code as it stands today — no **Open Conflicts** section is
needed.

---

## A. Touchpoint inventory

Every read/write of `colorCount`, at this tip:

### Write sites (where a layer's `colorCount` is set)

| Site | What it does |
|---|---|
| `app.js:5319` — `importImageFile()`'s new-layer literal | Sets `colorCount:6` (IMG-011's default) on every freshly imported image layer. **This is the literal decision 1 replaces.** |
| `app.js:2661` — `writeSelectedControlsToLayer()` | `l.colorCount=Math.max(1,Math.min(8,parseIntOr(el('imgColorCount').value,1)))`. Reads the `<select>` and clamps/parses to an integer 1-8. **Breaks today if the select's value is `'auto'`**: `parseIntOr('auto',1)` parses to `NaN` and falls back to `1` — choosing "Auto" in the dropdown would silently store `colorCount:1`, the opposite of what was asked. |
| `app.js:5342` — `#imgColorReset` handler | `l.colorMap={}` only; never touches `colorCount`. Unaffected. |

### Read sites (where a layer's `colorCount` value is consumed)

| Site | Current code | Effect if given raw `'auto'` unresolved |
|---|---|---|
| `app.js:278` — `updateStoneColorSwatch()` | `(sel.colorCount\|\|1)>1` → `multiColorImage` flag, disables `#stoneColor` | **Silently wrong, no throw.** `'auto'` is truthy so `\|\|1` doesn't fire, but `'auto'>1` is a `NaN` comparison → `false`. A freshly-imported Auto image (which will almost always resolve to `k>1`) would leave `#stoneColor` wrongly enabled, contradicting decision 2/IMG-002's "colour comes from `colorMap` once multi-colour" rule. |
| `app.js:747` — `computeImageColorField()` guard | `if(!layer\|\|layer.type!=='image'\|\|(layer.colorCount\|\|1)<=1)return null;` | Same `NaN`-comparison hazard as above: `'auto'<=1` is `false`, so the "no quantization" early-return is skipped and the function falls through to the throwing site below instead of returning `null`. |
| `app.js:751` — same function, cache key | `[...,layer.colorCount].join('|')` | Cache key would contain the literal string `'auto'` — harmless as a key component, but only reached after the guard above already mis-fires. |
| `app.js:754` — same function, `prepareImageField()` call | `colorCount:layer.colorCount` | **Throws.** Forwards straight into `ImageFieldPipeline.js`'s validation (below), which throws `RangeError` for a non-integer. |
| `app.js:1023` — `generateImageStonesLive()` | `colorCount:layer.colorCount??1` | `'auto'` is not nullish, passes through literally into `generateImageLayout()`. **Throws** (via `GeometryEngine.normalizeImageParams()` → `prepareImageField()`, below). This is the **production stone-generation path** — every live render and export image-layer regeneration goes through this one function (per IMG-003/IMG-004's own BACKLOG note, `app.js`'s `generateImageStonesLive()` is the *only* caller of `generateImageLayout()`). |
| `app.js:3268` — `resolveImageExportRegions()` | `colorCount:layer.colorCount??1` | Same as above, but into `resolveImagePolygons()` (SVG export region tracing). **Throws**, same root cause. |
| `app.js:3246` — `resolveLayerShapeSource()`'s image branch | `prepareImageField(buffer,{...})` — **does not forward `colorCount` at all** | Not a `colorCount` read site today. Boolean-ops candidate resolution for an image layer always treats it as one silhouette, regardless of colour count. Unaffected by IMG-012 either way. |
| `src/image/ImageFieldPipeline.js:82-92` — `normalizeParams()` | `const colorCount = params.colorCount ?? 1; if (!Number.isInteger(colorCount) \|\| colorCount < 1 \|\| colorCount > 8) throw new RangeError(...)` | **The actual throw site** every path above eventually reaches. `Number.isInteger('auto')` is `false` → `RangeError('colorCount must be an integer in [1, 8].')`. |
| `src/geometry/GeometryEngine.js:2479` — `normalizeImageParams()` | `colorCount: params.colorCount ?? 1` | Pure passthrough, no validation (by design — IMG-002 precedent: validation lives in `ImageFieldPipeline.js` only). Forwards whatever it's given, including an unresolved `'auto'`, on to the two call sites below. |
| `src/geometry/GeometryEngine.js:1206` — `generateImageLayout()`'s own `prepareImageField()` call | `colorCount: options.colorCount` | Reaches the `ImageFieldPipeline.js` throw. |
| `src/geometry/GeometryEngine.js:1250` — `generateImageLayout()`, `labeled` flag | `options.colorCount > 1 && field.labels !== null` | Moot in practice — the throw above fires first on the same call. Latent `NaN`-comparison hazard if that guard were ever bypassed. |
| `src/geometry/GeometryEngine.js:1354` — `resolveImagePolygons()`'s own `prepareImageField()` call | `colorCount: options.colorCount` | Reaches the `ImageFieldPipeline.js` throw. |
| `src/geometry/GeometryEngine.js:1369` — `resolveImagePolygons()`, region-per-label branch | `options.colorCount > 1 && field.labels !== null` | Same latent hazard as line 1250, same reason it's moot. |

### UI markup

`index.html:1192` — `<select id="imgColorCount"><option value="1" selected>1 (single colour)</option>...<option value="8">8</option></select>`. No `Auto` option exists today.

### colorMap key stability

`colorMap` is **keyed by catalog colour id (`nearestId`), not by cluster index**:
- Write: `app.js:2680` — `colorMap[colorField.colorGroups[i].nearestId]=pickEl.value` (inside `writeSelectedControlsToLayer()`).
- Read (production): `src/geometry/GeometryEngine.js:2401` — `imageRegionColorId()`: `options.colorMap[group.nearestId] ?? group.nearestId`.
- Read (Studio UI): `app.js:6349`, `app.js:6359` — `(l.colorMap&&l.colorMap[group.nearestId])||group.nearestId`.
- Reset: `app.js:5342` — `l.colorMap={}`.

### Existing quantization caches

Three caches exist, all in `app.js` (nothing is cached inside `src/image/**` or `src/geometry/**` —
both stay deliberately pure/uncached per their own header comments):

1. `imageBufferCache` (`app.js:230`) — decoded `{widthPx,heightPx,data}` buffer, keyed by the
   layer's `imageSrc` data URL. Unrelated to colour count.
2. `imageColorPaletteCache` (`app.js:724-725`) — module-level singleton `[{id,hex}]` built once
   from `STONE_COLORS`. Unrelated to colour count, never invalidated (the catalog is static).
3. `imageColorFieldCache` (`app.js:745-757`) — the one that matters here. Caches the quantized
   `field` (`{labels, colorGroups, ...}`) returned by `computeImageColorField()`, keyed by
   `[layer.imageSrc, layer.threshold, layer.invert, layer.blurRadiusPx, layer.maxWidthPx,
   layer.maxHeightPx, transparent, layer.colorCount].join('|')`, LRU-capped at 2 entries (line
   756). **This key omits `maskMode`** — `computeImageColorField()`'s own `prepareImageField()`
   call at line 754 never forwards `maskMode` at all, so it always quantizes against the
   *threshold* mask even when the layer's `maskMode` is `'subject'`. This is a pre-existing gap in
   the Studio-only preview/colorMap-key path (not the production path — `generateImageStonesLive()`
   line 1023 and `resolveImageExportRegions()` line 3268 both correctly forward
   `maskMode:resolveImageMaskMode(layer.maskMode)`). IMG-012's own Auto sweep must not copy this
   gap: decision 2 explicitly requires mask-aware subject pixels, so Auto's field preparation must
   be modelled on the production call sites (which pass `maskMode`), not on
   `computeImageColorField()`.

---

## B. Representation

**Store Auto as the string sentinel `layer.colorCount === 'auto'`.** No new layer field. This keeps
every existing numeric/absent read site's fallback (`??1`, `||1`) exactly as today (decision 4) and
follows the same "no `validateProject()` change, read-site permissive default" precedent IMG-002/
IMG-003 already established for `colorCount`/`seed`/`spread` (`colorCount` is not referenced
anywhere in `validateProject()` — confirmed by grep — so no schema change is needed either way).

**Where Auto is resolved to a number:** a single new app.js-side resolver, e.g.
`resolveImageColorCount(layer)`, is the *only* place `'auto'` is ever turned into a concrete
integer 1-8. It must be called — instead of the raw `layer.colorCount` — at every numeric read
site listed in Task A's second table:

- `app.js:278` (`multiColorImage` flag)
- `app.js:747` (`computeImageColorField()`'s guard)
- `app.js:751` (its cache key — pass the *resolved* number, not `'auto'`, so
  `imageColorFieldCache` keys stay numeric and hit reliably)
- `app.js:754` (its `prepareImageField()` call)
- `app.js:1023` (`generateImageStonesLive()`)
- `app.js:3268` (`resolveImageExportRegions()`)

It must **not** be called at:
- `app.js:2661` (the write site — stores `'auto'` verbatim when the select reads `'auto'`; must
  special-case this *before* the existing `parseIntOr(...)` clamp, which cannot round-trip a
  non-numeric string)
- `app.js:2498` (the UI-readback site, `el('imgColorCount').value=l.colorCount??1` — just mirrors
  the sentinel into the `<select>`; a matching `<option value="auto">` makes this work unchanged)

`resolveImageColorCount(layer)`'s own behaviour:
- `layer.type!=='image'` or `colorCount` absent/`1` → return `1` (byte-identical fast path, no
  image decode).
- `colorCount` a number in `[1,8]` → return it directly, clamped (byte-identical passthrough).
- `colorCount==='auto'` → look up (or compute and cache — see Task D/E below) the swept `k` for
  this layer's current `(imageSrc, threshold, invert, blurRadiusPx, maxWidthPx, maxHeightPx,
  transparent, maskMode)`; if the source buffer isn't decoded yet (mirrors
  `computeImageColorField()`'s own `if(!buffer)return null` guard) or the mask keeps zero subject
  pixels (`quantizeColors()` already returns `colorGroups:[]` for that case), fall back to `1`.

**Sites that would break if they ever received `'auto'` unresolved:** exactly the "Read sites"
table in Task A — the six `app.js` sites above plus the two `GeometryEngine.js` `prepareImageField()`
forwards (lines 1206/1354, which throw via `ImageFieldPipeline.js:83`) and the two `labeled`-flag
comparisons (lines 1250/1369, latent but moot since the throw fires first).

---

## C. colorMap interaction

Nothing new needs to be built here — Auto's `k` changing has **exactly the same effect on
`colorMap` that a manual `colorCount` edit already has today**, because `colorMap` doesn't know or
care whether `k` changed by operator choice or by Auto recomputing.

Grounded in the key scheme above (`colorMap[nearestId] = operatorOverrideId`, `nearestId` a
*catalog colour id*, not a cluster index): when `k` changes, `quantizeColors()` reruns median-cut +
k-means from scratch, so cluster boundaries — and therefore each cluster's average colour and its
`assignNearestIds()` greedy claim — can differ entirely from the previous `k`. Concretely:

- Any existing `colorMap[oldNearestId]` whose `oldNearestId` is not among the *new* `k`'s
  `nearestId` set becomes inert: `imageRegionColorId()` (`GeometryEngine.js:2399-2402`) only ever
  looks up `colorMap[group.nearestId]` for `nearestId`s the *current* `colorGroups` actually
  produced, so a stale entry is simply never read. It is never deleted either — `colorMap` is only
  ever additively merged (`app.js:2664`, `const colorMap={...l.colorMap}`) — so it persists as dead
  weight in the saved project.
- Any new cluster whose `nearestId` was never a `colorMap` key falls back to `?? group.nearestId`
  (its own auto-detected colour) — identical to the "never touched this layer's Colours group"
  case today.
- A stale entry can silently "reactivate" if a *later* `k` happens to reproduce the same
  `nearestId` again, applying whatever override the operator picked for a completely different
  cluster shape. This is a pre-existing characteristic of the IMG-002 `colorMap` design, not a new
  failure mode Auto introduces — an operator manually cycling `colorCount` from 4 → 6 → 4 today hits
  the identical behaviour.

No crash, no corruption, no new code path. IMG-012 needs no `colorMap`-side change.

---

## D. Performance (measured)

Measured directly against the real, unmodified `quantizeColors()` (`src/image/ColorQuantize.js`)
and `rgbToLab()`/`cie76Distance()` (`src/image/ColorSpace.js`) under Node, using the palette
`Object.values(STONE_COLORS).map(c=>({id:c.id,hex:c.previewColor}))` (17 catalog entries, the same
shape `imageColorPalette()` builds) and a synthetic photographic-like fixture: a smooth 2D gradient
(R ramps left→right, G ramps top→bottom, B a sine wave — simulating continuous-tone photo content)
with four flat ~6.25%-area colour patches overlaid in the corners (simulating logo/graphic
elements), every pixel "on" (`data=255`, i.e. the whole frame counted as subject). Generator code:

```js
function buildPhotographicFixture(widthPx, heightPx) {
  const n = widthPx * heightPx;
  const r = new Uint8ClampedArray(n), g = new Uint8ClampedArray(n), b = new Uint8ClampedArray(n);
  const data = new Uint8ClampedArray(n).fill(255);
  for (let y = 0; y < heightPx; y++) for (let x = 0; x < widthPx; x++) {
    const i = y * widthPx + x;
    r[i] = Math.round(255 * (x / (widthPx - 1)));
    g[i] = Math.round(255 * (y / (heightPx - 1)));
    b[i] = Math.round(255 * (0.5 + 0.5 * Math.sin((x + y) / 40)));
  }
  const patches = [
    { hex: '#9b1c1c', x0: 0.05, y0: 0.05, x1: 0.30, y1: 0.30 },
    { hex: '#2269d3', x0: 0.65, y0: 0.05, x1: 0.90, y1: 0.30 },
    { hex: '#2aa66a', x0: 0.05, y0: 0.65, x1: 0.30, y1: 0.90 },
    { hex: '#f3bd32', x0: 0.65, y0: 0.65, x1: 0.90, y1: 0.90 }
  ];
  for (const p of patches) {
    const [pr, pg, pb] = parseHex(p.hex); // parseHex: '#rrggbb' -> [r,g,b]
    const x0 = Math.round(p.x0 * widthPx), x1 = Math.round(p.x1 * widthPx);
    const y0 = Math.round(p.y0 * heightPx), y1 = Math.round(p.y1 * heightPx);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = y * widthPx + x; r[i] = pr; g[i] = pg; b[i] = pb;
    }
  }
  return { r, g, b, data, widthPx, heightPx };
}
```

Literal timing output (Node, `process.hrtime.bigint()`, this machine):

```
=== Task D: timing (photographic-like fixture) ===
--- default working resolution (400x400), 160000 px ---
single quantizeColors(k=6): 64.7ms
full Auto sweep (k=2..8, 7 calls): 155.3ms
full Auto sweep + per-pixel ΔE scoring (k=2..8): 238.6ms
--- 1000x1000, 1000000 px ---
single quantizeColors(k=6): 89.9ms
full Auto sweep (k=2..8, 7 calls): 413.4ms
full Auto sweep + per-pixel ΔE scoring (k=2..8): 1107.6ms

=== Task D: subsampling effect on chosen k (photographic-like, 1000x1000) ===
full-pixel chosen k = 8 k2:54.611 k3:41.198 k4:34.594 k5:35.178 k6:32.759 k7:29.870 k8:29.173
Auto sweep on every-3rd-pixel subsample: 475.4ms
subsampled(every 3rd px) chosen k = 8 k2:54.606 k3:41.196 k4:34.597 k5:35.202 k6:34.054 k7:30.500 k8:29.164
```

**Reading the numbers:**
- A single `quantizeColors()` call is nearly resolution-insensitive (64.7ms → 89.9ms for 6.25×
  more pixels). It bins pixels into a ≤32,768-bin 5-bit-per-channel histogram first
  (`buildHistogram()`), and every later stage (median-cut, the 8 k-means passes) operates on bins,
  not raw pixels — for a gradient-heavy fixture the bin space saturates quickly, so extra pixels
  barely add work. Only the histogram-build pass and the final per-pixel label-assignment pass
  (`ColorQuantize.js:289-293`) are `O(pixels)`, and both are cheap relative to the k-means passes.
- The **7-call sweep** scales the same way (small resolution sensitivity: 155ms → 413ms), still
  dominated by bin-space work, not pixel count.
- The **per-pixel ΔE scoring** (Auto's own added step: `rgbToLab()` + `cie76Distance()` per subject
  pixel, per `k`) is genuinely `O(pixels × 7)` and is what makes 1000×1000 expensive: 1107.6ms
  total, of which quantization itself is only ~413ms — the scoring loop alone costs ~695ms at this
  resolution.
- **Subsampling every 3rd subject pixel for the scoring loop only** cuts that 1107.6ms to 475.4ms
  (roughly the expected ~1/3 reduction on the `O(n)` stage, quantization's own bin-bound cost
  barely moving) and **produces the identical chosen `k` (8 both ways)**, with near-identical mean
  ΔE values at every `k` (differences in the third decimal place). The same check against the
  Task E fixture 1 correctness fixture (below) also reproduces the identical chosen `k=4` both
  ways.

**Decision:** Auto's quantization step (`quantizeColors()` itself) runs on the full subject-pixel
set unchanged — it is already cheap and its output (`labels`/`colorGroups`) is exactly what
downstream `colorMap` keys and production geometry depend on, so it must not be approximated.
**The mean-ΔE scoring step subsamples every 3rd subject pixel** (matching the stride the handoff
measurements used) — it has no measurable effect on the chosen `k` for either fixture tested, and
removes the single largest cost at larger working resolutions. At the shipped default working
resolution (400px), even the unsampled full sweep+scoring (238.6ms) is within a tolerable
one-time UI-latency budget (comparable to the "+312ms at 1000×1000" single-quantize cost the
IMG-002 follow-up comment at `app.js:733-735` already accepted for the existing manual-colorCount
control), so subsampling is a safety margin for larger `maxWidthPx`/`maxHeightPx` settings and
future images, not a fix for an unusable default case.

---

## E. Fixtures

### Fixture 1 — known answer: Auto must choose k=4

Four flat quadrants in four clearly distinct catalog colours (siam, sapphire, emerald, gold) with
mild ±6-level RGB noise:

```js
function buildFourRegionFixture(widthPx, heightPx, { noise = 6, seed = 1 } = {}) {
  const n = widthPx * heightPx;
  const r = new Uint8ClampedArray(n), g = new Uint8ClampedArray(n), b = new Uint8ClampedArray(n);
  const data = new Uint8ClampedArray(n).fill(255);
  const colors = ['#9b1c1c', '#2269d3', '#2aa66a', '#f3bd32']; // siam, sapphire, emerald, gold
  let s = seed;
  const rand = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  for (let y = 0; y < heightPx; y++) for (let x = 0; x < widthPx; x++) {
    const i = y * widthPx + x;
    const quadrant = (x < widthPx / 2 ? 0 : 1) + (y < heightPx / 2 ? 0 : 2);
    const [cr, cg, cb] = parseHex(colors[quadrant]);
    r[i] = cr + Math.round((rand() - 0.5) * 2 * noise);
    g[i] = cg + Math.round((rand() - 0.5) * 2 * noise);
    b[i] = cb + Math.round((rand() - 0.5) * 2 * noise);
  }
  return { r, g, b, data, widthPx, heightPx };
}
```

Measured (200×200, `noise:6, seed:1`):

```
k2: meanDeltaE=46.2938 clusters=2
k3: meanDeltaE=20.0148 clusters=3
k4: meanDeltaE=2.7978  clusters=4
k5: meanDeltaE=6.3596  clusters=5
k6: meanDeltaE=8.1616  clusters=6
k7: meanDeltaE=9.5233  clusters=7
k8: meanDeltaE=10.0308 clusters=8
CHOSEN k = 4
```

`k=4` is the clear global minimum (roughly 2× lower than its nearest neighbours, well outside the
1% tie band), matching the spec's own example.

### Fixture 2 — known answer: the within-1% tie rule decides

Six equal-area flat regions in a 3×2 grid, **no noise**, using three "close pair" catalog colours
(siam/light-siam, sapphire/light-sapphire) plus two solo colours (emerald, gold):

```js
function buildSixRegionFixture(widthPx, heightPx) {
  const n = widthPx * heightPx;
  const r = new Uint8ClampedArray(n), g = new Uint8ClampedArray(n), b = new Uint8ClampedArray(n);
  const data = new Uint8ClampedArray(n).fill(255);
  const cols = 3, rows = 2;
  const colors = ['#9b1c1c', '#d9534f', '#2269d3', '#6fa8dc', '#2aa66a', '#f3bd32'];
  // siam, light-siam, sapphire, light-sapphire, emerald, gold
  for (let y = 0; y < heightPx; y++) for (let x = 0; x < widthPx; x++) {
    const i = y * widthPx + x;
    const cx = Math.min(cols - 1, Math.floor(x / widthPx * cols));
    const cy = Math.min(rows - 1, Math.floor(y / heightPx * rows));
    const [cr, cg, cb] = parseHex(colors[cy * cols + cx]);
    r[i] = cr; g[i] = cg; b[i] = cb;
  }
  return { r, g, b, data, widthPx, heightPx };
}
```

Measured (240×160):

```
k2: meanDeltaE=32.9866 clusters=2
k3: meanDeltaE=38.8614 clusters=3
k4: meanDeltaE=27.7474 clusters=4
k5: meanDeltaE=3.3695  clusters=5
k6: meanDeltaE=0.0000  clusters=6
k7: meanDeltaE=0.0000  clusters=6
k8: meanDeltaE=0.0000  clusters=6
CHOSEN k = 8
```

`k=6,7,8` all reach an exact 0.0000 mean ΔE — a perfect fit, since the image genuinely has 6 flat
colours and `quantizeColors()`'s non-empty-cluster compaction (`ColorQuantize.js:270-282`) drops
the two unused extra clusters at `k=7,8` for free (`clusters:6` reported at all three). These three
`k` values are exactly tied (well within 1% of each other), so decision 2's tie rule picks the
*largest*, `k=8`, over the intuitively-"correct" `k=6`.

**Design note (not a blocking conflict):** this is a faithful, literal consequence of decision 2
as written, not a bug — but it means Auto will report the maximum colour count (8) for any image
whose true colour count is ≤8 and perfectly (or near-perfectly) separable, rather than the number
of colours actually present. Worth the product owner's awareness before this ships; not redesigned
here per the "not open for redesign" instruction.

---

## F. Test plan — `tools/test-img-012-auto-colour-count.mjs`

Numbered items:

1. **Fixture 1 correctness.** `chooseAutoK(buildFourRegionFixture(200,200,{noise:6,seed:1}))`
   resolves to `k=4`, and the reported mean ΔE at `k=4` is the strict global minimum (not just
   within-1%-tied-and-largest) — asserts the "obvious" case picks the obviously-right answer, not
   an accidental tie.
2. **Fixture 2 tie-rule correctness.** `chooseAutoK(buildSixRegionFixture(240,160))` resolves to
   `k=8`, with `k=6`, `k=7`, `k=8` all reporting the same (0) mean ΔE — proves the "prefer larger
   when within 1%" branch actually fires, not just the "lower mean wins" branch.
3. **Tie-threshold boundary.** A constructed pair of mean-ΔE values exactly 1.0% apart and a pair
   just over 1.0% apart (synthetic numbers fed directly to the tie-break function, not through
   `quantizeColors()`) — confirms the boundary is `<=` (inclusive) not `<`, per decision 2's "within
   1%" wording.
4. **Subject-pixel/maskMode correctness.** Two layers with identical `imageSrc`/`threshold` but
   `maskMode:'threshold'` vs `maskMode:'subject'` (a fixture where the two masks keep different
   pixel sets, e.g. a background-colour region that only the subject mask excludes) resolve to
   different Auto `k` — proves the sweep is built on the mask-aware field (mirroring
   `generateImageStonesLive()`'s/`resolveImageExportRegions()`'s `maskMode` forwarding), not on
   `computeImageColorField()`'s mask-blind one (Task A's documented gap).
5. **Byte-identity for saved numeric `colorCount`.** Every read site enumerated in Task A's second
   table, called with `layer.colorCount` set to each of the 8 legal integers and also left absent,
   produces output identical to a `develop` @ `5a69e50` baseline (same stones/regions/labeled flag
   behaviour) — proves decision 4's "every read site that sees an absent or numeric `colorCount`
   behaves as today" by direct comparison, not by inspection.
6. **Engine-level behavioural test that the resolved number reaches `GeometryEngine`.** Not a
   source grep. Constructs a real image layer with `colorCount:'auto'`, runs it through the actual
   `resolveImageColorCount()` → `generateImageStonesLive()` path (or the equivalent real call
   chain once implemented), and asserts the returned stones carry more than one distinct `color`
   value when the fixture's Auto-resolved `k>1` — and, separately, that calling
   `GeometryEngine.generateImageLayout()` directly with the *unresolved* string `'auto'` still
   throws the `ImageFieldPipeline.js:83` `RangeError` (proving the engine itself was never taught
   to understand `'auto'`, and the resolution genuinely happens one layer up in `app.js`). The
   BACKLOG.md row filed under IMG-003 ("`layer.seed`/`layer.spread` never reached
   `GeometryEngine.generateImageLayout()`... invisible to any test that calls the engine itself with
   the right params by hand, resolved as part of the IMG-004 follow-up") is the precedent this item
   guards against — a defect purely in what `app.js` forwards is invisible to a test that only
   exercises the engine with hand-supplied correct params, or that only greps `app.js`'s source
   text for the right-looking property name.
7. **Cache correctness — recompute triggers.** Changing `layer.imageSrc`, `threshold`, `invert`,
   `blurRadiusPx`, `maxWidthPx`/`maxHeightPx` (working resolution), `transparent`, or `maskMode`
   each independently invalidates the Auto cache and re-runs the sweep (assert the sweep function
   is actually called again — e.g. via a call-count spy on `quantizeColors`, not just that the
   returned `k` changed, since a changed `k` alone wouldn't catch a stale cache that happens to
   still be correct).
8. **Cache correctness — no-recompute triggers.** Changing `seed`, `spread`, `stoneSize`, `gap`,
   `fillMode`, or a `colorMap` colour pick, with every Auto-affecting field held constant, does
   **not** call `quantizeColors()` again (same call-count-spy technique) — the direct behavioural
   test decision 5 requires, distinct from item 7's positive case.
9. **LRU bound.** Mirroring `imageColorFieldCache`'s existing 2-entry cap (`app.js:756`), confirm
   the new Auto cache has an equivalent bound so switching between several Auto images/layers in
   one session doesn't grow it unbounded.
10. **Write-site round-trip.** Selecting "Auto (best fit)" in `#imgColorCount` and calling
    `writeSelectedControlsToLayer()` stores `layer.colorCount === 'auto'` (not `1`, the current
    `parseIntOr` fallback) — the regression this milestone's Task A/B analysis found waiting to
    happen at `app.js:2661`.
11. **UI display text.** With a layer resolved to Auto `k=5`, the Studio's chosen-count label reads
    exactly `"Auto: 5 colours"` (decision 3's literal example) — and updates when a mask/image
    change causes a different `k` to resolve.
12. **`colorMap` survives a `k` change without crashing.** An Auto layer with one manual colour
    pick, whose image is edited so Auto's `k` changes, regenerates without throwing and produces a
    `StoneLayout` whose per-stone colours are all valid catalog ids — the "no corruption, no crash"
    claim from Task C, checked behaviourally rather than only by code inspection.
13. **Existing-suite awareness (not fixed here).** `tools/test-img-011-import-defaults.mjs` item 2
    (`assert.match(handler, /colorCount:6,/, ...)`) will need updating once the factory literal
    changes to `'auto'` — flagged so the implementing milestone doesn't discover it only via a red
    CI run.

---

## Summary of file:line changes this spec anticipates (informational — not implemented here)

- `app.js:5319` — `colorCount:6` → `colorCount:'auto'`.
- `app.js:2661` — special-case `el('imgColorCount').value==='auto'` before the existing
  `parseIntOr` clamp.
- `app.js:278,747,751,754,1023,3268` — read the new `resolveImageColorCount(layer)` resolver
  instead of raw `layer.colorCount`.
- New: an `autoColorCountCache` (or similar), app.js-side, keyed on
  `[imageSrc, threshold, invert, blurRadiusPx, maxWidthPx, maxHeightPx, transparent, maskMode]`
  (mirrors `imageColorFieldCache`'s key minus `colorCount`, plus `maskMode` — which
  `imageColorFieldCache` itself is missing, a pre-existing gap this spec does not fix).
- `index.html:1192` — add `<option value="auto">Auto (best fit)</option>` as the first option, and
  a `.hint`-styled span (matching the existing `imgColorShare*` convention) showing the resolved
  count.
- `tools/test-img-011-import-defaults.mjs` — item 2's regex needs updating (Task F item 13).
