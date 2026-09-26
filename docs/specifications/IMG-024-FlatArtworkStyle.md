# IMG-024 — Flat artwork redraw style

**Status: spec.** File:line citations are against `develop` @ `f59bdaf` (the IMG-023 merge). Every
anchor below was re-grepped on that tip. No implementation code exists yet.

## Objective

IMG-023 made "Redraw with AI" produce a picture of rhinestones. The app reads the stones the AI drew
and places real stones from them. IMG-024 adds a second redraw style next to it, so the operator can
choose between them and compare them on duplicated layers:

- **Stone picture** (`'stones'`, the default). This is IMG-023's behaviour, unchanged.
- **Flat artwork** (`'flat'`). The AI draws flat colour regions with no stones. The ordinary image
  pipeline then places stones on its own staggered grid, with a new colour rule.

Claude's scratch runs on six subjects gave this evidence:

- Flat artwork gives cleaner faces (portrait skin, eyes, lips).
- Stone picture keeps thin lines better (butterfly veins, tiger stripes).
- Flat artwork has no stone grid, so it can be laid out at any size. That includes fixed-size
  objects such as mugs.

`GeometryEngine.generateImageLayout()` stays the only producer of image-layer stones. The pipeline
does not change shape. A flat redraw is an ordinary `'staggered'` image layer with one new optional
field, `paletteRule`.

## Decisions (settled)

These decisions are recorded as given. They are not reopened here. Items under "Findings for
decision" at the end are about how to build them, not whether to.

### D1. Style choice

- The Studio gets a select, **Redraw style**, next to the Redraw with AI button. It has two options:
  "Stone picture" (`stones`, the default, IMG-023 behaviour) and "Flat artwork" (`flat`).
- The choice is remembered in `localStorage`, wrapped in try/catch like the access code.
- The wire body gains `style: 'stones' | 'flat'`.
- The server rejects any other value with 400 `provider-failed`. A body with no `style` key reads as
  `'stones'`, so older clients keep working.

### D2. Prompts

`server/redraw/prompt.mjs` keeps one prompt per style, and each has its own version:

- `'stones'` stays at `PROMPT_VERSION` 2, with its text unchanged.
- `'flat'` is version 1. Its text is below, verbatim. The palette line is generated from
  `STONE_COLORS` by `buildPaletteLine()`, as the stones prompt's is today.

The flat prompt is exactly these three lines, joined with `'\n'`. Line 1 is one line, with no line
breaks inside it:

```
Create a production-oriented flat-color artwork specifically designed to be converted into a rhinestone placement pattern. Do NOT draw rhinestones. Do NOT simulate stones. Use only the palette below. Use large, clean, contiguous color regions with strong boundaries and simplified detail. Avoid gradients, photographic texture, shadows, highlights, hair-level texture, tiny isolated regions and fine lines thinner than approximately one rhinestone diameter (1/70 of the image width). Transparent background. No frame. Preserve the recognizable silhouette and major facial features. The resulting artwork will be converted separately into precisely measured rhinestone geometry.
Palette (name and hex):
<buildPaletteLine(colors)>
```

The redraw record stores `style` and that style's `promptVersion`.

### D3. Layer after a flat redraw

`applyRedraw()` with style `'flat'` behaves as IMG-022 did:

- The longest side is 160 mm, clamped to the canvas.
- `vividness` is 1.0.
- `fillMode` is `'staggered'`. The previous value is recorded in the redraw record, so Use original
  restores it.

It also sets a new optional layer field, `paletteRule: 'error'`.

Redrawing a layer again, with either style, starts from `redraw.originalImageSrc`, as it does today.

### D4. Palette rule `'error'`

This rule applies when `layer.paletteRule === 'error'`.

1. **Choose the colours.** The image colour pipeline chooses up to 8 catalogue colours. It uses the
   same greedy rule as `chooseAiStonePalette()`: minimum summed weighted-Lab error, with weights
   L\* 0.5, a\* 1, b\* 1.
2. **Which pixels.** The choice is computed over the subject pixels. It uses a deterministic sample
   of at most 40,000 subject pixels, taken by a fixed stride, never at random.
3. **Map the pixels.** Each pixel is mapped to the nearest chosen colour, with the same weights.
4. **Reuse.** `chooseAiStonePalette()` is reused, not duplicated.
5. **The Studio.** The Colours rows and the colour-count select show the chosen colours. A manual
   colour count still overrides the cap.
6. **Without `paletteRule`.** Every layer behaves exactly as today, and saved projects are
   byte-identical.

### D5. Stone picture is unchanged

IMG-023's AI stones mode, its sizing and its photo gate all stay as they are.

### D6. Non-goals

- Automatic style choice.
- A side-by-side view inside one layer.
- A product-aware stone count.

## Reference figures (not test literals)

These come from Claude's scratch prototype, not from the app. Settings: gpt-image-2, SS6
(`stoneSize` 2 mm), gap 0.3 mm, error palette, staggered grid. The images are not committed.

The figures are reference points for the browser check. They are not test literals, and no test may
pin them.

| Subject | At the IMG-023 size | Stones | At 130 mm | Stones |
|---|---|---|---|---|
| tiger | 205 mm | 7,854 | 130 mm | 3,169 |
| Einstein | 248 mm | 10,015 | 130 mm | 2,795 |
| portrait | 221 mm | 8,320 (palette includes siam for the lips) | 130 mm | 2,898 |
| butterfly | 208 mm | 5,154 | 130 mm | 2,008 |

A flat redraw lands at 160 mm (D3), and no figure exists for that size. To compare with the table,
the browser check resizes the layer to 130 mm on its longest side. The prototype is not the app: its
subject mask, working resolution and grid phase may differ. A count within roughly ±15% of the
130 mm column is plausible. A count that is off by a factor of two is a finding to report.

## Design

### Server: `server/redraw/prompt.mjs`

- `PROMPT_VERSION` (`:9`), `PROMPT_LINES` (`:11`), `buildPaletteLine()` (`:25`) and the no-argument
  result of `buildRedrawPrompt()` (`:29`) are unchanged.
- **New exports.**
  - `REDRAW_STYLES = Object.freeze(['stones', 'flat'])`.
  - `FLAT_PROMPT_VERSION = 1`.
  - `PROMPT_VERSIONS = Object.freeze({ stones: PROMPT_VERSION, flat: FLAT_PROMPT_VERSION })`.
- **New constant.** `FLAT_PROMPT_LINES` holds D2's line 1 and `'Palette (name and hex):'`.
- **Signature.** It becomes `buildRedrawPrompt(colors = STONE_COLORS, style = 'stones')`.
  - `'flat'` returns `[...FLAT_PROMPT_LINES, buildPaletteLine(colors)].join('\n')`.
  - Any other value returns today's stones prompt.
  - The handler only ever passes a validated style.
- **Header comment.** Its "Any change to the wording is a PROMPT_VERSION bump" rule now reads per
  style: a change to one style's wording bumps that style's version only.

### Server: `server/redraw/handler.mjs`

- **Body validation.** Today it is `:177`–`:180`, where the JSON is parsed and the image is checked.
  After the existing PNG check, add a style check:

  ```js
  const style = 'style' in parsed ? parsed.style : 'stones';
  if (!REDRAW_STYLES.includes(style)) return sendFailure(res, 400, 'provider-failed', 'Unknown redraw style.');
  ```

  - `parsed` is already known to be an object by then, because the `typeof parsed.image` check
    rejects primitives.
  - An explicit `null`, a number, `'Flat'` or `''` is "any other value", so each gets 400.
  - The check comes after the access-code and rate-limit checks, as the PNG check does. A rejected
    style still uses one rate-limit slot, which is today's behaviour for a rejected PNG.
- **Fake mode (`:181`).** It returns `promptVersion: PROMPT_VERSIONS[style]`.
- **Passing the style on.**
  - `callOpenAi(res, pngBuffer)` (`:117`) becomes `callOpenAi(res, pngBuffer, style)`.
  - `attemptOpenAi(pngBuffer, clientGone)` (`:87`) becomes `attemptOpenAi(pngBuffer, clientGone, style)`.
  - `:95` appends `buildRedrawPrompt(undefined, style)`.
- **Success response (`:157`).** It returns `promptVersion: PROMPT_VERSIONS[style]`. The response
  gains no other key, and `style` is not echoed.
- **Unchanged.** Model, quality, size, background, retries, the safety-system handling and every
  error code.

### Client: `src/redraw/OpenAiProxyProvider.js`

- `redraw({ pngDataUrl, accessCode = '', signal })` (`:27`) gains `style = 'stones'`.
- The body (`:33`) becomes `JSON.stringify({ image: pngDataUrl, style })`, so it always carries the
  style.
- The return shape is unchanged.

### Client: `src/redraw/index.js`

- **Contract comment.** The provider contract in the header comment becomes
  `redraw({ pngDataUrl, accessCode, signal, style })`. A provider that sends no prompt, such as the
  fake or a future Worker, ignores `style`.
- **Signature.** `redrawImage({ dataUrl, signal } = {})` (`:140`) becomes
  `redrawImage({ dataUrl, signal, style = 'stones' } = {})`.
- **Unknown style.** A style that is not in `REDRAW_STYLES` throws `RedrawError('provider-failed',
  'Unknown redraw style.')` before any request is made.
- **New export.** `REDRAW_STYLES` is re-exported from index.js. It is defined in index.js itself
  with the same frozen value, because `src/**` must not import `server/**`. A test asserts that the
  two arrays are deepEqual.
- **Passing the style on.** `provider.redraw(...)` (`:157`) passes `style`.
- **The resolved value is unchanged.** It stays `{ dataUrl, providerId, model, promptVersion }`, so
  `style` is not added to it. app.js already knows the style it asked for, and passes it to
  `applyRedraw()`.

`src/redraw/FakeRedrawProvider.js` is unchanged.

### Client: `src/redraw/RedrawLayerTransform.js`

**The new option.** `applyRedraw(layer, result, options)` (`:65`) gains `options.style`, which
defaults to `'stones'`. Any value other than `'flat'` is treated as `'stones'`.

**Style `'flat'`:**

- **Sizing.** `aiPitchPx` and `shrink` are ignored, and the IMG-022 sizing branch (`:102`–`:110`)
  runs. So `isAiStones` is false even if a pitch is passed.
- **The record's `previous*` keys.** The record carries `previousFillMode` forward if the previous
  record had it. Otherwise it records `layer.fillMode ?? null`. `previousPaletteRule` works the same
  way, from `layer.paletteRule ?? null`. The existing `:93` rule for `previousFillMode` is extended
  to both keys.
- **The layer.** It sets `fillMode: 'staggered'` and `paletteRule: 'error'`. `vividness` is
  `REDRAW_VIVIDNESS` (1.0), as today.

**Style `'stones'` keeps IMG-023 exactly, with one addition.** If the carried-forward record has
`previousPaletteRule`, the layer's `paletteRule` is restored from it. A `null` value deletes the
key. A stones redraw of a layer whose last redraw was flat therefore has the same `paletteRule` as a
stones redraw of the original. A stones redraw never writes `previousPaletteRule` itself.

**The record.** `redraw` gains `style` (`'stones'` or `'flat'`) next to `promptVersion`, and
`promptVersion` is still `result.promptVersion`. A record written before IMG-024 has no `style`. Any
reader treats a missing `style` as `'stones'`, and nothing else in the app reads it.

**`restoreOriginal()`** (`:135`). Next to the existing `previousFillMode` line (`:148`), add
`if ('previousPaletteRule' in r) setOrDelete(out, 'paletteRule', r.previousPaletteRule === null ?
undefined : r.previousPaletteRule);`. Use original on a flat layer then gives back the exact
original layer, with the same `JSON.stringify` and the same key order.

`validateProject()` is unchanged. It validates only `redraw.originalImageSrc`, and its `{...l}`
spread already keeps `paletteRule`. Adding a validation line would break the 17 `new Function()`
harnesses (IMG-022 note). `paletteRule` is resolved permissively at every read site instead: exactly
`'error'` means the error rule, and anything else means today's rule.

### Colour pipeline

**Moving the greedy palette (finding F1).** `chooseAiStonePalette()` lives in
`src/geometry/AiStoneSampler.js:43`. `src/image/**` must never import `src/geometry/**`
(`docs/ARCHITECTURE.md:177`, restated in ColorQuantize.js's header). So the image pipeline cannot
import it where it is. The reuse is a pure move:

- A new file, `src/image/WeightedLabPalette.js`, takes these unchanged in text and arithmetic, with
  names and values kept:
  - `AI_STONE_PALETTE_CAP` (`:14`) and `AI_STONE_LAB_WEIGHTS` (`:15`).
  - `INITIAL_ERROR` (`:22`), not exported.
  - `weightedLabDistance()` (`:34`) and `chooseAiStonePalette()` (`:43`).

  It imports nothing.
- `AiStoneSampler.js` imports those four exports from `'../image/WeightedLabPalette.js'` and
  re-exports them under the same names. `tools/test-img-023-ai-stone-transfer.mjs:14` and the
  scratch `accept.mjs` then keep importing from `AiStoneSampler.js` unchanged.
- `catalogueLabs()` stays in `AiStoneSampler.js`.

**`src/image/ColorQuantize.js`:**

- New export `ERROR_PALETTE_MAX_SAMPLES = 40000`.
- New export `labelErrorPaletteColors({ r, g, b, eligible, palette, catalogLabs, maxColors =
  AI_STONE_PALETTE_CAP, chromaScale = 1 })`. It returns `{ labels, keptIds, pickCount, finalCounts,
  eligibleCount }`:
  1. **Lab values.** For each eligible pixel, in raster order, compute `rgbToLab(r, g, b)`. If
     `chromaScale !== 1`, multiply a\* and b\* by it, exactly as `labelCatalogColors()` does at
     `:83`–`:84`.
  2. **Sample.** Let `N` be the eligible count and `s = Math.max(1, Math.ceil(N / 40000))`. The
     sample is the eligible pixels whose eligible ordinal `k` (0-based, raster order) satisfies
     `k % s === 0`. That gives `Math.ceil(N / s)` ≤ 40,000 pixels.
  3. **Choose.** `picks = chooseAiStonePalette(sampleLabs, catalogLabs, maxColors)`. The picks are
     in ascending palette order, and `pickCount = picks.length`.
  4. **Map.** Every eligible pixel takes the pick with the smallest `weightedLabDistance`. It uses
     strict `<` while iterating the picks in ascending order, so ties go to the lower palette index.
  5. **Drop empty picks.** `keptIds` is the picks with at least one final pixel, in palette order. A
     pick can end with no pixels, because a later pick can take every pixel an earlier pick won. It
     is dropped so that no group has a zero count, which would make the `rgb` mean NaN.
  6. **No eligible pixels.** With `N === 0`, it returns `keptIds: []` and `pickCount: 0`, with all
     labels 255.
- `catalogLabs` defaults to the same `palette.map(... rgbToLab(...hexToRgb(hex)))` default that
  `labelCatalogColors()` uses. That equals `catalogueLabs()` in AiStoneSampler.js.
- `quantizeColors({ ..., paletteRule })` (`:150`). With `paletteRule === 'error'` it calls
  `labelErrorPaletteColors({ ..., maxColors: colorCount, chromaScale })` in place of
  `labelCatalogColors()`. Everything after it (groups, means, shares, `nearestId`) is shared. Any
  other `paletteRule` takes today's path, byte for byte.
- `labelCatalogColors()` and `MIN_CATALOG_COLOR_SHARE` (`:40`, IMG-015's 1.2% share floor) are
  unchanged.

**`src/image/AutoColourCount.js`.** `chooseAutoColorCount(field, palette, { chromaScale = 1,
paletteRule } = {})` (`:63`):

- With `paletteRule === 'error'`, `resolvedCount` is `max(2, pickCount)` from
  `labelErrorPaletteColors({ ..., maxColors: AUTO_MAX_K })`. With no subject pixels it is 1, as
  today.
- The count uses `pickCount`, not `keptIds.length`, so Auto and the pipeline agree. The greedy is
  prefix-stable: a cap of `n` gives exactly the first `n` picks of a cap of 8. So quantising at the
  resolved count reproduces the same picks and the same groups.
- Any other `paletteRule` takes today's path.

**`src/image/ImageFieldPipeline.js`:**

- `normalizeParams()` resolves `paletteRule: params.paletteRule === 'error' ? 'error' : null` and
  adds it to its return (`:196`).
- The `quantizeColors({ ... })` call (`:312`) passes `paletteRule: options.paletteRule`.
- The field's keys are unchanged, so `test-img-001:82` and `test-img-002:143` hold.

**`src/geometry/GeometryEngine.js`:**

- `normalizeImageParams()` (`:2511`) adds `paletteRule: params.paletteRule === 'error' ? 'error' :
  null` to its return (`:2567`).
- Both `prepareImageField()` calls, in `generateImageLayout()` (`:1217`) and
  `resolveImagePolygons()` (`:1438`), pass `paletteRule: options.paletteRule`. So the SVG export's
  regions come from the same labels as the stones.
- Line Design and AI stones do not read it.

**What the colour count means under the error rule.** The greedy adds any colour that lowers the
summed error at all (`bestGain > 0`). On an image with anti-aliased edges, that is likely to be all
8 on Auto (F4). This is intended: D4 replaces the share floor with the error objective. The browser check
records the Auto count for each subject.

### app.js

Only `layer.paletteRule` is read, never a new helper. The `new Function()` harnesses that run
`resolveImageColorCount()`, `computeImageColorField()` and `generateImageStonesLive()` with fixed
dependency lists then need no new dependency.

- **`autoColorCountKeyParts()`** (`:782`). Append `layer.paletteRule==='error'?'error':''` to
  `parts`, after the vividness entry.
- **`resolveImageColorCount()`** (`:793`, call at `:806`). It becomes
  `chooseAutoColorCount(field,imageColorPalette(),{chromaScale:resolveImageVividness(layer.vividness),paletteRule:layer.paletteRule})`.
- **`computeImageColorField()`** (`:833`).
  - The key gains `layer.paletteRule==='error'?'error':''` after `vividness`.
  - Its `prepareImageField(buffer,{...})` call gains `paletteRule:layer.paletteRule` after
    `vividness`.
- **`generateImageStonesLive()`** (`:1161`). The live params object (`:1184`) gains
  `paletteRule:layer.paletteRule,` directly after `palette:imageColorPalette(),`. The Line Design
  params object is unchanged.
- **`resolveImageExportRegions()`** (`:3479`). Its params (`:3485`) gain `paletteRule:layer.paletteRule`
  directly after `palette:imageColorPalette(),`.
- **Redraw style storage.** Directly after `saveRedrawAccessCode` (`:5615`), and before
  `const REDRAW_ERROR_MESSAGES={`, add:

  ```js
  const REDRAW_STYLE_STORAGE_KEY='rhinestoneStudio.redrawStyle';
  function loadRedrawStyle(){try{return localStorage.getItem(REDRAW_STYLE_STORAGE_KEY)==='flat'?'flat':'stones'}catch{return'stones'}}
  function saveRedrawStyle(style){try{localStorage.setItem(REDRAW_STYLE_STORAGE_KEY,style)}catch{}}
  ```

  They go before `REDRAW_ERROR_MESSAGES` so that test-img-022 T8c's slice from `REDRAW_ERROR_MESSAGES`
  to `syncImageRedrawControls` does not change.
- **`syncImageRedrawControls(l)`** (`:5639`). After the `el('imageRedraw').hidden=` line, add
  `el('imageRedrawStyleField').hidden=el('imageRedraw').hidden;el('imageRedrawStyle').disabled=busy;`.
- **`startImageRedraw()`** (`:5668`).
  - Its first three lines stay verbatim (pinned by test-img-022 T12).
  - After `const layerId=layer.id,source=...` add
    `const style=el('imageRedrawStyle').value==='flat'?'flat':'stones';`. This binds the style to
    the run, so changing the select during the run has no effect on it.
  - `:5683` becomes `redrawImage({dataUrl:source,signal:redrawRun.signal,style})`.
  - `:5689` becomes `const detection=style==='stones'?aiStoneDetectionFor(result.dataUrl,buffer):null;`.
  - `:5690`'s `detection.ok?` becomes `detection&&detection.ok?`.
  - So a flat redraw never computes a pitch, never grows a Flat Sheet (`grownCanvas` stays null),
    and gets IMG-022 sizing.
  - `:5694`'s options gain `style`.
  - The status texts are unchanged.
- **Wiring.** Next to `el('imageRedraw').onclick` (`:5709`), add
  `el('imageRedrawStyle').value=loadRedrawStyle();el('imageRedrawStyle').onchange=()=>saveRedrawStyle(el('imageRedrawStyle').value==='flat'?'flat':'stones');`.
  - The select is a per-browser preference, not project data. So it is not in
    `HISTORY_TRACKED_CONTROL_IDS`, it does not go through `writeSelectedControlsToLayer()`, and it
    creates no history step.
- **The consent dialog** (`askRedrawConsent()` `:5649`, `confirmRedrawConsent()` `:5658`,
  `#lightboxRedrawConsent` `index.html:1480`) is unchanged. Consent covers sending the image, and
  that is the same for both styles.
- **`duplicateLayer()`** (`:4488`) is unchanged. Its `JSON.parse(JSON.stringify(l))` copy already
  keeps `redraw` (with `originalImageSrc`) and `paletteRule`. So the D1 comparison workflow works
  with no change: duplicate the layer, then redraw the copy with the other style. That starts from
  the original, as D3 says.
- **The Colours rows and Auto hint** (`renderImageStudio()` `:6679`, hint at `:6776`) are unchanged.
  They already read `computeImageColorField()`'s `colorGroups`.

### index.html

Inside `.image-redraw-row` (`:1166`), before `#imageRedraw` (`:1167`), add:

```html
<label id="imageRedrawStyleField" class="image-redraw-style" hidden>Redraw style <select id="imageRedrawStyle"><option value="stones" selected>Stone picture</option><option value="flat">Flat artwork</option></select></label>
```

Next to the existing `.image-redraw-row button.btn[hidden]{display:none}` (`:288`), add
`.image-redraw-row label[hidden]{display:none}`, in case a label rule sets `display` (the IMG-022
and IMG-023 `[hidden]` traps). The id does not match `/colou?r/i`, so test-img-016 rule 3 does not
apply.

## Anchors (re-grepped at `f59bdaf`)

| Anchor | Location |
|---|---|
| `PROMPT_VERSION` | `server/redraw/prompt.mjs:9` |
| `PROMPT_LINES` | `server/redraw/prompt.mjs:11` |
| `buildPaletteLine()` | `server/redraw/prompt.mjs:25` |
| `buildRedrawPrompt()` | `server/redraw/prompt.mjs:29` |
| `attemptOpenAi()` / prompt append | `server/redraw/handler.mjs:87` / `:95` |
| `callOpenAi()` / success response | `server/redraw/handler.mjs:117` / `:157` |
| request body validation (parse, PNG check) | `server/redraw/handler.mjs:177`–`:180` |
| fake-mode response / `callOpenAi` call | `server/redraw/handler.mjs:181` / `:182` |
| `redraw()` / wire body | `src/redraw/OpenAiProxyProvider.js:27` / `:33` |
| `redrawImage()` / `provider.redraw` call | `src/redraw/index.js:140` / `:157` |
| `applyRedraw()` | `src/redraw/RedrawLayerTransform.js:65` |
| `previousFillMode` carry / set | `src/redraw/RedrawLayerTransform.js:93` / `:95` |
| IMG-022 sizing branch | `src/redraw/RedrawLayerTransform.js:102`–`:110` |
| `restoreOriginal()` / fillMode restore | `src/redraw/RedrawLayerTransform.js:135` / `:148` |
| `REDRAW_ACCESS_CODE_STORAGE_KEY` + load/save | `app.js:5613`–`:5615` |
| `syncImageRedrawControls()` | `app.js:5639` |
| consent: lightbox / `askRedrawConsent()` / `confirmRedrawConsent()` | `app.js:5648` / `:5649` / `:5658` |
| `startImageRedraw()` | `app.js:5668` |
| `redrawImage` call / detection / `applyRedraw` call | `app.js:5683` / `:5689` / `:5694` |
| `#imageRedraw` onclick | `app.js:5709` |
| `#lightboxRedrawConsent` | `index.html:1480` |
| `.image-redraw-row` / `#imageRedraw` | `index.html:1166` / `:1167` |
| `chooseAiStonePalette()` | `src/geometry/AiStoneSampler.js:43` |
| `AI_STONE_PALETTE_CAP` / `AI_STONE_LAB_WEIGHTS` / `weightedLabDistance()` | `src/geometry/AiStoneSampler.js:14` / `:15` / `:34` |
| `chooseAutoColorCount()` | `src/image/AutoColourCount.js:63` |
| `quantizeColors()` | `src/image/ColorQuantize.js:150` |
| IMG-015 share floor `MIN_CATALOG_COLOR_SHARE` | `src/image/ColorQuantize.js:40` |
| `labelCatalogColors()` | `src/image/ColorQuantize.js:71` |
| `normalizeParams()` return / `quantizeColors` call | `src/image/ImageFieldPipeline.js:196` / `:312` |
| `generateImageLayout` / `resolveImagePolygons` `prepareImageField()` calls | `src/geometry/GeometryEngine.js:1217` / `:1438` |
| `normalizeImageParams()` / its return | `src/geometry/GeometryEngine.js:2511` / `:2567` |
| `autoColorCountKeyParts()` / `resolveImageColorCount()` / Auto call | `app.js:782` / `:793` / `:806` |
| `computeImageColorField()` | `app.js:833` |
| `generateImageStonesLive()` / live params | `app.js:1161` / `:1184` |
| `resolveImageExportRegions()` / params | `app.js:3479` / `:3485` |
| `duplicateLayer()` | `app.js:4488` |
| `renderImageStudio()` / Auto hint | `app.js:6679` / `:6776` |
| `src/image` never imports `src/geometry` | `docs/ARCHITECTURE.md:177` |

## Tests the build must add

These go in a new `tools/test-img-024-flat-artwork-style.mjs`, registered in `tools/test-groups.mjs`
(integration, default), following test-img-022's `test()` pattern.

- **T1. Server style validation and default.**
  - No `style` key gives 200 with `promptVersion` 2, and the OpenAI form's prompt is the stones
    prompt.
  - `style: 'stones'` gives the same result.
  - `style: 'flat'` gives 200 with `promptVersion` 1, and the form's prompt equals
    `buildRedrawPrompt(undefined, 'flat')`.
  - `null`, `'Flat'`, `''`, `1` and `{}` each give 400 `{ code: 'provider-failed', message:
    'Unknown redraw style.' }`, with no upstream fetch.
  - Fake mode returns `promptVersion` 1 for `'flat'` and 2 otherwise.
- **T2. Flat prompt text and version.**
  - `FLAT_PROMPT_VERSION === 1` and `PROMPT_VERSION === 2`.
  - `PROMPT_VERSIONS` deepEquals `{ stones: 2, flat: 1 }`.
  - `buildRedrawPrompt(undefined, 'flat').split('\n')` is exactly `[D2 line 1, 'Palette (name and
    hex):', buildPaletteLine()]`, with line 1 pinned verbatim in the test.
  - `buildRedrawPrompt()` equals `buildRedrawPrompt(undefined, 'stones')` and is unchanged.
  - Line 1 contains no `'\n'`.
  - `REDRAW_STYLES` from prompt.mjs deepEquals the one from `src/redraw/index.js`.
- **T3. Client wire and record.**
  - The proxy provider posts `{ image, style: 'flat' }` when given `'flat'`, and
    `{ image, style: 'stones' }` by default.
  - `redrawImage({ ..., style: 'bogus' })` rejects with `provider-failed` and makes no request.
  - `applyRedraw(..., { style: 'flat' })` writes `redraw.style === 'flat'` and `promptVersion` from
    the result.
  - The default style writes `'stones'`.
- **T4. `applyRedraw()` for `'flat'`, and `restoreOriginal()`.**
  - On test-img-022's `baseLayer()` (`fillMode: 'staggered'`, `vividness: 1.4`) with
    `aiPitchPx: 11.467` passed:
    - `[x, y, w, h]` equals the no-pitch IMG-022 result (`[40, 25, 160, 160]` on its `CANVAS`), and
      `vividness` is 1.
    - `fillMode` is `'staggered'` and `paletteRule` is `'error'`.
    - The record has `previousFillMode: 'staggered'` and `previousPaletteRule: null`.
  - On a layer with `fillMode: 'edge'` and no `fillMode` respectively, the flat redraw sets
    `'staggered'`, and `restoreOriginal()` gives the exact original `JSON.stringify`.
  - A canvas of 100 × 100 clamps to 80 × 80.
  - **Chain flat → stones (pitch).** `fillMode` is `'ai-stones'` and `paletteRule` is absent. The
    record keeps the first `previousFillMode` and `previousPaletteRule`. `restoreOriginal()` gives
    the exact original.
  - **Chain stones → flat.** `previousFillMode` is the original's, not `'ai-stones'`, and
    `restoreOriginal()` gives the exact original.
  - **Chain flat → flat.** The `previous*` keys are unchanged.
- **T5. Palette rule `'error'` on a synthetic image.**
  - **Fixture.** A 100 × 100 field with every pixel eligible (`data` 255), exact catalogue colours
    and no anti-aliasing:
    - rows 0–39: Light Peach `#eec6a4`, except a 10 × 10 Siam `#9b1c1c` block at x 45–54,
      y 15–24;
    - rows 40–69: Jet `#141414`;
    - rows 70–99: Crystal `#f5f5f5`.

    Siam is 100 px, which is 1.00% of the subject pixels.
  - `quantizeColors({ ..., colorCount: 8, palette: catalogue })` with no `paletteRule` gives
    `nearestId`s `['crystal-clear', 'jet', 'light-peach']`. Siam is dropped by the 1.2% floor.
  - With `paletteRule: 'error'`, the `nearestId`s are `['crystal-clear', 'jet', 'siam',
    'light-peach']`, and Siam's `pixelShare` is exactly 0.01.
  - `chooseAutoColorCount(..., { paletteRule: 'error' })` resolves 4, and without it resolves 3.
  - No group has a NaN `rgb`.
- **T6. Stride sampling.**
  - On a 300 × 300 all-eligible field (90,000 pixels, stride 3), `labelErrorPaletteColors()`'s
    picks equal `chooseAiStonePalette()` run directly on the Lab values of eligible ordinals
    0, 3, 6, …, 89,997 (30,000 pixels).
  - Two calls deepEqual each other.
  - On a 100 × 100 field, the stride is 1 and every pixel is sampled.
- **T7. Mapping weights and ties.** For a hand-picked pixel Lab value, `labelErrorPaletteColors()`
  labels it with the pick that minimises `weightedLabDistance`, not CIE76. The test finds a pair of
  picks where the two metrics disagree. An exact tie goes to the lower palette index.
- **T8. Manual count overrides the cap.** On the T5 fixture with `paletteRule: 'error'`,
  `colorCount: 2` gives exactly the first two greedy picks' groups: `nearestId`s `['jet',
  'light-peach']`, with Siam and Crystal pixels mapped to their nearest of the two.
- The T5 and T8 literals were checked at spec time. The scratch run applied the current
  `chooseAiStonePalette()`, `quantizeColors()` and `chooseAutoColorCount()` to this fixture. Greedy
  picks at caps 1–8 were: `light-peach`; `jet, light-peach`; `crystal-clear, jet, light-peach`; then
  `crystal-clear, jet, siam, light-peach` for every cap from 4 to 8. After that, the gain is 0 and
  the greedy stops.
- **T9. Move, not copy.**
  - `AiStoneSampler.js`'s `chooseAiStonePalette`, `weightedLabDistance`, `AI_STONE_LAB_WEIGHTS`
    and `AI_STONE_PALETTE_CAP` are the same bindings (`===`) as `WeightedLabPalette.js`'s.
  - `AiStoneSampler.js`'s source contains no `function chooseAiStonePalette`.
  - No file under `src/image/` imports from `../geometry/`.
- **T10. Byte identity without `paletteRule`.**
  - A project with test-img-023's `IMAGE_LAYER` (no `paletteRule`) round-trips through
    `validateProject()` with identical `JSON.stringify`.
  - `GeometryEngine.generateImageLayout()` gives deepEqual stones with `paletteRule` absent,
    `undefined`, `null` or `'catalogue'`.
  - `prepareImageField()`'s `colorGroups` are likewise identical for each of those values.
  - A layer with `paletteRule: 'error'` survives the round trip.
- **T11. Engine wiring.**
  - A `paletteRule: 'error'` layer's `generateImageLayout()` stones use only the error-rule
    colours.
  - `resolveImagePolygons()` traces one region per error-rule group.
- **T12. app.js and index.html wiring.**
  - index.html has `#imageRedrawStyleField` and `#imageRedrawStyle`, whose options are exactly
    `[['stones', 'Stone picture'], ['flat', 'Flat artwork']]` with Stone picture selected, plus the
    `label[hidden]` override.
  - app.js contains `const REDRAW_STYLE_STORAGE_KEY='rhinestoneStudio.redrawStyle';`, and the
    load/save pair wrapped in try/catch.
  - `imageRedrawStyle` is not in `HISTORY_TRACKED_CONTROL_IDS`.
  - The `startImageRedraw()` body contains the `const style=` binding, `style})` on the
    `redrawImage` call, and `style==='stones'?aiStoneDetectionFor(`.
  - Each of the five colour-pipeline edits above is present.
  - Run `loadRedrawStyle()` through `new Function()` with a `localStorage` stub that throws. It
    returns `'stones'`. With stored `'flat'` it returns `'flat'`, and with `'x'` it returns
    `'stones'`.

## Existing tests that grep the text this build changes

Each edited line is listed below with the tests that grep it, including regex-escaped forms, and
what happens to each test.

| Edit | Test and line | What it matches | Result |
|---|---|---|---|
| `resolveImageColorCount()` `:806` gains `,paletteRule:layer.paletteRule` in the options object | `test-img-017-vividness.mjs:202` | regex `chooseAutoColorCount\(field,imageColorPalette\(\),\{chromaScale:<escaped RESOLVED>\}\)`, which requires `}` then `)` right after the vividness call | **Moves.** Update it to `\{chromaScale:<RESOLVED>,paletteRule:layer\.paletteRule\}\)` |
| same | `test-img-017:201`, `test-img-009:283` (`maskMode:resolveImageMaskMode(layer.maskMode)` in the resolver), `test-img-012:138`/`:139` (slice from `function autoColorCountKeyParts(layer){` to `function computeImageColorField(layer){`), `test-img-012` `buildResolveImageColorCount` `new Function` dependency list | extraction and needles | Hold: no new identifier and no marker text changed |
| `autoColorCountKeyParts()` `:782` gains a part | `test-img-017:175` (`includes(RESOLVED)`), `test-img-012:138` (start marker) | substring / marker | Hold |
| `computeImageColorField()` key and `prepareImageField` call | `test-img-017:178` (`/const key=\[[^\]]*\bvividness\b[^\]]*\]\.join/`), `:179` (`/prepareImageField\(buffer,\{[^}]*\bvividness\b[^}]*\}\)/`), `test-img-012:323` (marker `const imageColorFieldCache=new Map();\nfunction computeImageColorField(layer){`), `test-img-012:354` `new Function` list | regex / marker | Hold: the added text has no `]`, `}` or new identifier |
| live params `:1184` gains `paletteRule:layer.paletteRule,` after `palette:imageColorPalette(),` | `test-img-017:185` (exactly two `/const params=\{[^;]*\};/`), `:186` (`vividness:` + RESOLVED), `test-img-023:412` (the tail `aiStoneDetection:mode==='ai-stones'?…,...mixedSizeParamsFor(layer)}`), `test-img-011:143` (`/colorCount:resolveImageColorCount\(layer\)/`), `test-img-009:271` (`maskMode:` needle), `test-img-021:123` and the other `generateImageStonesLive` extractors (`test-img-004`, `-005`, `-006`, `-010`, `-012`, `-013`, `-018`, `test-fill-algorithms-integration`, `test-image-trace-regression`, `test-rs-3039-large-layout`, `test-mono-006b`) | count / substring / execution | Hold: no `;`, the tail is untouched, and there is no new dependency |
| export-regions params `:3485` gains the same key | `test-img-008:356`–`:363` (needle list), `test-img-017:189`–`:190`, `test-img-021:234`–`:235`, `test-img-009:279` | needles | Hold: needles are only checked for presence |
| Redraw style storage lines after `:5615` | `test-img-022:463`–`:467` (slice `const REDRAW_ERROR_MESSAGES={` … `function syncImageRedrawControls(l){`, run via `new Function`), `test-img-022:708` (`const REDRAW_ACCESS_CODE_STORAGE_KEY='rhinestoneStudio.redrawAccessCode';`) | slice / substring | Hold: the insert goes before the slice start |
| `syncImageRedrawControls()` body | `test-img-022:463` (end marker only) | marker | Hold |
| `startImageRedraw()` body | `test-img-022:710` (the first three lines verbatim, with `\n`) | substring | Hold: the insert is after `const layerId=` |
| `redrawImage` call `:5683`, detection `:5689`–`:5690`, `applyRedraw` call `:5694` | no test greps these (checked: `signal:redrawRun.signal`, `detection.ok?detection.pitchPx`, `aiPitchPx,shrink`, `const layerId=layer.id,source`) | — | — |
| index.html `.image-redraw-row` | `test-img-022:705`–`:707` (ids present), `test-img-016:115` (selects matching `/colou?r/i`) | ids / regex | Hold: the new id does not match |
| `src/redraw` wire body | `test-img-022:445` (`deepEqual(JSON.parse(posts[0].init.body), { image: … })`) | deepEqual | **Moves.** Add `style: 'stones'` |
| redraw record gains `style` | `test-img-022:562`–`:566` and `:578`–`:581` (`deepEqual(out.redraw, {...})` / `second.redraw`) | deepEqual | **Moves.** Add `style: 'stones'` to both expected records |
| same | `test-img-022:567`–`:569` (changed-key set; `['redraw']` is the only new key) | set | Hold: a stones redraw adds no layer key |
| `redrawImage()` result shape | `test-img-022:426`, `:499` (deepEqual results) | deepEqual | Hold: the result gains no key |
| handler success / fake response | `test-img-022:245` (`{ dataUrl, model, promptVersion: 2 }` for a body with no style) | deepEqual | Hold |
| prompt | `test-img-022:170`–`:180` (T1, stones text and `PROMPT_VERSION` 2), `:259` (`form.get('prompt') === buildRedrawPrompt()`) | text | Hold |
| AiStoneSampler move | `test-img-023:14` (imports from `AiStoneSampler.js`), `:188`–`:361` (calls) | import | Hold through the re-export |
| ImageFieldPipeline field keys | `test-img-001:82`, `test-img-002:143` (`Object.keys(field)` set) | key set | Hold: no field key is added |

That makes four existing literals that move, all in `test-img-017` and `test-img-022`. The build
must make exactly these edits and no others. It then reruns the files named in this table, but not
`npm test`.

## Browser check

The browser check uses the Playwright dev-server pattern, with `REDRAW_FAKE=1` for the wiring and a
real key for the subjects.

1. **The select.** It shows only when Redraw with AI shows. It remembers its value across a reload,
   and it is disabled while a redraw runs.
2. **A flat redraw of each of the four subjects.** For each one, record:
   - the 160 mm size;
   - `fillMode` Staggered;
   - the Auto colour count and the Colours rows;
   - the stone count at 160 mm, and after resizing to 130 mm. Compare the 130 mm count with the
     reference table.
   - For the portrait, whether Siam appears for the lips.
3. **Comparison workflow.** Duplicate a layer, then redraw one copy as Stone picture and the other as
   Flat artwork. Use original on each gives back the same original.
4. **Mug.** A flat redraw on a mug is laid out without growing or clamping anything beyond the IMG-022
   canvas clamp.
5. **Byte identity.** Save and reopen a project with an ordinary image layer. The file is
   byte-identical to one saved before the build.
6. **Timing.** Record the time of one error-rule `quantizeColors()` call at the default 400 px
   working size. No budget is set; it is recorded for the report.

## Findings for decision

- **F1. "Reuse `chooseAiStonePalette()`" needs a move.** `src/image/**` may not import
  `src/geometry/**` (`docs/ARCHITECTURE.md:177`). So the colour pipeline can reuse it only after a
  pure move into `src/image/WeightedLabPalette.js`, with AiStoneSampler.js re-exporting it. That is
  what this spec specifies. The alternative, running the error rule inside GeometryEngine, would
  leave app.js's Auto count and Colours rows, which call `src/image` directly, without it.
- **F2. The test fixture needs under 1.2%, not under 2%.** The brief's T5 wording is "a small
  distinct red area (under 2% of pixels)". The share floor drops a colour only under 1.2%
  (`MIN_CATALOG_COLOR_SHARE`). A 1.5% red area would clear the floor, so both rules would keep it
  unless more than 8 larger colours were present. The fixture is therefore 1.00%.
- **F3. `paletteRule` after a stones redraw.** D3 does not say what a Stone picture redraw does to a
  layer whose last redraw was flat. This spec restores the pre-redraw `paletteRule`, so a stones
  result is the same whichever style came before. That matters when detection fails and the layer
  keeps a colour-pipeline `fillMode`.
- **F4. Auto is likely to be 8 on real images under the error rule.** See "What the colour count
  means under the error rule" above. The greedy stops early only when no colour lowers the error at
  all, as on T5's exact-colour fixture, which stops at 4. Anti-aliased edges composited onto white
  will usually give some colour a positive gain. This is not a defect, but the Auto hint will
  probably read "8 colours" on most flat redraws. The browser check confirms or refutes it.
