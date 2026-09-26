# IMG-025 — Stone clean-up for image layers

Status: spec. No app code in this commit.

Reference: `docs/prototypes/stone_cleanup_reference.py` (the algorithm) and `tools/fixtures/img-025/`
(6 grid fixtures and `expected.json`).

## Context

Image layers show three faults, with or without AI:

- **Holes.** Small empty spots inside the design, where one to a few stones are missing.
- **Speckle.** Single stones of an odd colour scattered through otherwise even areas.
- **Crumbs.** Stray groups of 1–3 stones sitting outside the design.

A clean-up pass on the finished stones fixes all three. It fills small enclosed holes with the
surrounding colour, gives an odd stone the colour around it, and removes tiny detached groups. An
optional one-stone Jet outline also helps light subjects stand out from a light product.

The pass was measured on 6 real layouts: a tiger and a portrait, each as a photo, an AI Stone
picture and an AI Flat artwork. The figures are in "Reference figures" below.

The docstring of the reference script is the algorithm. This spec restates it and does not change
it. Where the two ever disagree, the script wins.

## Decisions (settled)

### D1. Module

New pure file `src/geometry/StoneCleanup.js`, imported only by `GeometryEngine.js`. It has the same
relationship to the engine as `GapFill.js`.

It exports:

```js
cleanupLatticeStones({ stones, pitchMm, palette, placement, layerId, stoneSizeMm, outline })
// -> { stones, stats: { filled, recoloured, removed, outlined } }
// -> { stones /* the input, unchanged */, stats: { skipped: 'not-lattice' } }   (D3)
```

It also exports the constants `CLEANUP_HOLE_MAX = 10`, `CLEANUP_CRUMB_MIN = 4`,
`CLEANUP_SPECKLE_ROUNDS = 2` and `CLEANUP_FRAME_PITCHES = 1.1` (the reference's `FRAME_PITCHES`).

### D2. Where it runs

It runs inside `generateImageLayout()`:

- after the primary stones, and after any colour mapping, so it sees the final colours;
- before the IMG-013 `fillGaps` pass;
- before the IMG-021 rotation.

It runs only when all of these hold:

- `options.cleanup === true`;
- mode is `'staggered'` or `'ai-stones'`;
- for `'staggered'` only, size mode is uniform. AI stones ignores size mode (its stones are always
  one size), so an AI stones layer runs whatever its stored `sizeMode` is.

`brightnessThinning` is not a condition: neither mode reads it (audit decision A1 below).

Otherwise nothing changes. `fillGaps` then runs as today, against the cleaned set.

### D3. Lattice

- Pitch is `stoneSizeMm + gapMm`, and row height is `pitch × √3 / 2`.
- The reference point is `stones[0]`, at `(x0, y0)`.
- Each stone's lattice position is:
  - `row = round((y − y0) / rowH)`;
  - `parity = ((row % 2) + 2) % 2`;
  - `col = round((x − x0 − parity × pitch / 2) / pitch)`.
- Odd rows, counted from the reference row, are shifted by +pitch/2.
- Skip the whole pass (D1's `skipped` result) if either of these is true:
  - any stone is more than `0.25 × pitch` from its lattice point;
  - two stones share one lattice point.
- Neighbour offsets are exactly as `nbrs()` in the reference.

### D4. Steps

The steps run in this order, exactly as in the reference:

1. **Holes.** Only enclosed holes of at most 10 points are filled. The fill order and the colour
   rule are the reference's.
2. **Speckle.** Two synchronous rounds. A stone changes only if it has at least 4 neighbours, and
   either:
   - its own colour is on 0 neighbours and the top colour is on at least 3; or
   - its own colour is on 1 neighbour and the top colour is on at least 4.
3. **Crumbs.** 6-connected groups of fewer than 4 stones are removed.
4. **Outline.** This runs only when `outline === true`:
   - A stone with at most 4 neighbours becomes catalogue id `'jet'`.
   - The exception is a stone whose centre is less than `CLEANUP_FRAME_PITCHES` (1.1) pitches from
     the edge of the unrotated placement box. A stone exactly one pitch in is therefore excluded.
   - Neighbour counts are taken before any recolouring.

All ties go to the colour that comes earlier in the `palette` passed in. That is the catalogue
order, from app.js `imageColorPalette()`.

`recoloured` counts the distinct stones whose colour after the speckle step differs from their
original colour.

### D5. Output order and fields

- Surviving original stones keep their order.
- Filled stones are appended in fill order. Each one has `sizeMm = stoneSizeMm`, the layer id, and
  an index that continues the numbering.
- The positions of original stones never change.

### D6. Layer fields

- There are two new fields, `cleanup` (boolean) and `jetOutline` (boolean).
- Read sites are permissive: only exactly `true` turns each one on. A missing value, or anything
  else, means off.
- There is no `validateProject()` change and no project version bump. A project saved before
  IMG-025 therefore regenerates byte-identical stones.
- New image imports get `cleanup: true`. This goes in the layer literal in app.js's import handler.
  `jetOutline` is not written there.
- A redraw does not touch either field.
- `normalizeImageParams()` reads `cleanup` and `jetOutline` in the same permissive way.

### D7. app.js

- Pass `cleanup` and `jetOutline` in the params object of `generateImageStonesLive()`.
- Add both to its cache key, and to every other image cache key that includes `fillMode`.
- `resolveImageExportRegions()` is not changed. Regions are traced colour areas, not stones.

(See "Audit notes" A2: at this base there are no such cache keys.)

### D8. UI

The controls go in Image → Strass, in the Trace section, right after Fill style / AI stone size:

- Checkbox **"Clean up stones"**, with the title "Fills small holes, fixes single odd-coloured
  stones and removes stray crumbs".
- Checkbox **"Jet outline"**, with the title "Turns the outer edge of the design into one row of
  Jet stones".

When any of D2's conditions other than `cleanup` fails:

- both checkboxes are disabled;
- a hint line shows "Clean-up works with Staggered Fill (one stone size) and AI stones".

Jet outline is also disabled while Clean up is off.

Each change commits history, like the other Trace controls.

### D9. Stats

- `generateImageLayout()` adds `cleanupStats` next to `outlineStats` and `checkFixStats`. It is
  `null` when clean-up did not run.
- When `cleanupStats` is not null, the studio stats panel shows one line: "Clean-up: +F filled, R
  recoloured, C removed". It adds ", O outlined" when O > 0.

### D10. IMG-024 leftovers, fixed in the same build

- (a) The `#imageRedraw` title becomes "Send this image to be redrawn by AI in the chosen style".
- (b) The Redraw style label sits inline with its select, so the select matches the button height.
- (c) The line numbers in the IMG-024 spec's test table are refreshed.
- (d) The IMG-024 stride test uses a fixture where sampling changes the picks, so a no-stride
  mutation fails. For example, a colour could be present only on pixels whose eligible index is
  not a multiple of the stride.

## Audit decisions (settled after review)

The spec report raised five points. They were answered as follows, and the text of this spec now
follows the answers.

- **A1. Thinning condition: dropped.** Staggered and AI stones never read `brightnessThinning`,
  and `#imgBrightnessThinning` is disabled outside Organic/Edge, so a stale nonzero value would
  have locked Clean up off with no way to clear it. D2, D8, the disabling logic and T5 are amended.
- **A2. Cache keys: agreed.** The build adds the two fields to the live params only. T7 keeps
  asserting that no existing key gained them.
- **A3. Frame rounding: margin widened to 1.1 pitches.** The reference now has
  `FRAME_PITCHES = 1.1`, so the frame test no longer compares two values that are equal by
  construction. The six `.grid.txt` fixtures are unchanged; `expected.json` gains the new outlined
  counts and hashes. The cleanup-only figures do not change.
- **A4. Confirmed as written:** the skipped stats text (audit note A7), unknown colours losing ties
  (A5), index numbering (A6), and the write-on-tick rule for the two fields (D7's write lines).
- **A5. No outline on full-frame AI stone pictures: accepted** (audit note A8).

## Audit notes

These record what the code at `1b9b7b7` says about the decisions. The report lists the ones that
needed an answer; "Audit decisions" above records the answers.

- **A1. Both modes emit an exact lattice.**
  - Staggered uses `sampleStaggeredFieldFillPoints()` (`src/geometry/StoneSampler.js:1921`). It
    starts rows at `spacing/2`, adds `spacing × √3/2` per row, and offsets odd rows by +`spacing/2`.
  - AI stones use `aiStoneGridPoints()` (`src/geometry/AiStoneSampler.js:35`), which is
    `sampleStaggeredFillPoints()` over the placement box and follows the same rule.
  - In both, spacing is `stoneSizeMm + gapMm`, the D3 pitch. The only error is the accumulated
    float from `+=` (around 1e-13 mm after a few hundred steps), many orders of magnitude inside
    0.25 × pitch.
  - D3's skip is therefore a guard. It is not reached in the two D2 modes.
- **A2. No cache key to extend (D7).**
  - `generateImageStonesLive()` (`app.js:1161`) has no cache on its non-Line-Design path. It calls
    `generateImageLayout()` on every call (`app.js:1184`).
  - The only stone cache, `lineDesignStoneCache` (key at `app.js:1166`), is used only for Line
    Design. Clean-up never runs there, and the key has no `fillMode`.
  - The only key that includes `fillMode` is `aiStoneSizingKey()` (`app.js:2767`). It decides when
    to resize an AI stones layer, and clean-up does not change that.
  - `autoColorCountKeyParts()` (`app.js:782`) and the `computeImageColorField()` key
    (`app.js:847`) leave `fillMode` out on purpose.
  - So the build adds the two fields to the live params only. T7 checks that, and also that none
    of the four keys above gained them.
- **A3. The frame test was on a knife edge for Staggered (D4 step 4). Resolved.**
  - Odd rows start exactly one pitch in from the left edge of the placement box. The first
    reference's `x − box.xMm < pitch` therefore compared two values that are equal by construction,
    and float rounding decided.
  - Shown on the first reference's `portrait_flat --outline`: if each stone's x was recomputed from
    a lattice anchored on an odd-row stone instead of the fixture origin, `outlined` became 152
    instead of 151.
  - The margin is now `1.1 × pitch` (audit decision A3), so a stone one pitch in is excluded by
    0.1 pitch, far beyond float error. The build still reads each stone's own `xMm`/`yMm`, never a
    position recomputed from lattice indices.
- **A4. The reference point does not change the result.**
  - D3 counts rows from `stones[0]`. The fixtures count them from their own origin. The two
    numberings differ by a row shift and a per-row column shift.
  - Every rule depends only on adjacency, on row-major order within and across rows, and on stone
    positions, so the results are the same.
  - Checked at spec time: all 12 fixture runs, with an odd-row stone placed first and outline
    positions taken from the stones, reproduce `expected.json` exactly. T1 repeats this.
- **A5. Colours outside the palette.**
  - The reference assumes every colour is in `palette`. The engine can produce one that is not:
    `Stone` falls back to `'Crystal AB'` (`src/geometry/Stone.js:18`) when `layer.color` is
    missing, and `colorAt()` returns `options.color` for an unlabelled pixel.
  - For ties, a colour not in `palette` ranks after every palette colour. Two such colours rank by
    JavaScript string order (`<`).
  - This does not change any fixture figure, because every fixture colour is in its palette.
- **A6. Indices.**
  - Filled stones take indices `n, n+1, …`, where `n` is the length of the input `stones`.
  - After crumbs are removed, the IMG-013 pass's `startIndex: stones.length`
    (`GeometryEngine.js:1402`) can repeat some of those indices.
  - Nothing downstream treats `index` as an identity. Its one reader,
    `crystalSeedForStone()` (`src/renderer/CrystalAppearance.js:47`), also hashes the position,
    so a repeat is harmless.
- **A7. Stats when skipped (D9).** D9's line has no wording for `{ skipped: 'not-lattice' }`. The
  panel shows "Clean-up: skipped (stones are not on one lattice)" in that case (see A1: not
  expected in practice).
- **A8. Full-frame AI stone pictures get no outline.** On `tiger_stones` the outline figure is 0,
  because the AI covered the whole frame and every edge stone is less than 1.1 pitches from it. That
  matches the reference and D4. It means Jet outline does nothing for an AI stones layer that
  fills its box. The AI already draws a Jet outline on Stone pictures.

## Design

### `src/geometry/StoneCleanup.js`

This is a pure module, with no DOM and no engine import. It imports only `Stone` from `./Stone.js`
and never mutates its input.

**Inputs**

- `stones`: `Stone[]`, all the same size (D2 guarantees uniform).
- `pitchMm`: the engine passes `options.stoneSizeMm + options.gapMm`.
- `palette`: the engine's `options.palette`, an `{ id, hex }[]` array in catalogue order. Only `id`
  and the order are read. `null` or a missing value means an empty order, so every colour ranks
  by A5.
- `placement`: `{ xMm, yMm, widthMm, heightMm }`, the unrotated box.
- `layerId` and `stoneSizeMm`: used for the filled stones.
- `outline`: exactly `true` turns step 4 on.

**Empty input.** `stones.length === 0` returns `{ stones: [], stats: { filled: 0, recoloured: 0,
removed: 0, outlined: 0 } }`.

**Lattice (D3)**

- `rowH = pitchMm * (Math.sqrt(3) / 2)`.
- Positions are indexed from `stones[0]`.
- Keys are the integer pair `(row, col)`. How they are stored is free, as long as the iteration
  orders below hold.
- The skip test runs before any step.

**Steps.** These are line-for-line ports of `fill_holes`, `despeckle`, `remove_crumbs` and
`outline` in the reference.

- **Neighbours.** Row parity comes from D3's `parity`. Even rows use
  `(r,c−1) (r,c+1) (r−1,c−1) (r−1,c) (r+1,c−1) (r+1,c)`. Odd rows use
  `(r,c−1) (r,c+1) (r−1,c) (r−1,c+1) (r+1,c) (r+1,c+1)`.
- **`top_colour`.** This is the highest count. A tie goes to the lower palette index, then to A5
  for colours not in the palette.
- **Holes.**
  1. Build the occupied bounding box and grow it by one row and one column on each side.
  2. Flood-fill "outside" from its `(R0, C0)` corner, staying inside the grown box.
  3. Scan empty non-outside points in row-major order. Each unvisited one starts a component.
  4. Skip components larger than `CLEANUP_HOLE_MAX`.
  5. Fill the rest one point at a time. Pick the point with the most occupied neighbours; ties go
     to the smaller row, then the smaller column. Its colour is `top_colour` of its occupied
     neighbours, and it counts as occupied at once.
- **Speckle.** Run `CLEANUP_SPECKLE_ROUNDS` rounds.
  - Each round reads the state at the start of the round and applies all changes together.
  - Stop early when a round changes nothing.
  - Then `recoloured` is the number of original stones whose colour differs from their original.
- **Crumbs.** Remove every 6-connected component with fewer than `CLEANUP_CRUMB_MIN` stones.
  `removed` is the number of stones removed.
- **Outline.**
  1. First compute, for every stone, whether it has at most 4 occupied neighbours.
  2. Then, for each such stone that is not already `'jet'`, skip it if any of these is below
     `CLEANUP_FRAME_PITCHES * pitchMm`: `x − xMm`, `y − yMm`, `xMm + widthMm − x` or
     `yMm + heightMm − y`. Here x and y are the stone's own `xMm`/`yMm` (A3), and the other four
     are placement values.
  3. Otherwise set it to `'jet'`.

  `outlined` counts the stones changed.

**Output (D5)**

- Original stones that survive keep their input order.
- A stone whose colour is unchanged is passed through as the same object.
- A stone whose colour changed becomes a new `Stone` with the same `xMm`, `yMm`, `sizeMm`,
  `layerId`, `index` and `metadata`, and the new colour.
- Filled stones follow, in fill order. Each is a `new Stone({ xMm: x0 + col × pitch + parity ×
  pitch/2, yMm: y0 + row × rowH, sizeMm: stoneSizeMm, color, layerId, index: n + k })`, with no
  metadata. They are enclosed, so they never have 4 or fewer neighbours, and step 4 never reads
  their recomputed position.

### `src/geometry/GeometryEngine.js`

- **Import.** Add `import { cleanupLatticeStones } from './StoneCleanup.js';` next to the GapFill
  import (`:51`).
- **`normalizeImageParams()`.** In the return object (`:2569`), after `fillGaps` (`:2625`), add
  `cleanup: params.cleanup === true` and `jetOutline: params.jetOutline === true`, each with a
  one-line IMG-025 comment in the style of the neighbouring lines.
- **`generateImageLayout()`.** Insert the pass after the S-200 block ends (`:1383`) and before the
  IMG-013 comment (`:1385`).

  For Staggered, uniform size means `options.mixedOptions` is null, so running after the S-200 block
  is the same as running straight after the primary stones. AI stones never runs the S-200 block
  (its stones are sized by the AI stone sampler), so the same holds.

  ```js
  let cleanupStats = null;
  if (options.cleanup && (isAiStones || (options.mode === 'staggered' && options.sizeMode === 'uniform'))) {
    const cleaned = cleanupLatticeStones({ stones, pitchMm: options.stoneSizeMm + options.gapMm, palette: options.palette, placement, layerId: options.layerId, stoneSizeMm: options.stoneSizeMm, outline: options.jetOutline });
    stones = cleaned.stones;
    cleanupStats = cleaned.stats;
  }
  ```

  The IMG-013 block (`:1393`) and the IMG-021 rotation (`:1409`) are unchanged, so they now see
  the cleaned set. The return (`:1413`) passes `cleanupStats` too.
- **Doc comment.** Add `@param {boolean} [params.cleanup]` and `[params.jetOutline]` to the
  `generateImageLayout()` doc comment (`:1148`–`:1204`).

### `src/geometry/StoneLayout.js`

Add a `cleanupStats = null` constructor field (`:44`), handled exactly like `checkFixStats`:

- `toJSON()` writes it only when it is non-null (`:105`);
- `fromJSON()` reads it with `?? null` (`:132`).

Layouts without clean-up serialise exactly as before.

### app.js

- **Import literal (`:5598`).** Append `,cleanup:true` after `fillGaps:true`. Do not add
  `jetOutline`.
- **Live params (`:1184`).** Insert `cleanup:layer.cleanup,jetOutline:layer.jetOutline,` right
  after `fillGaps:Boolean(layer.fillGaps),`.
  - These are raw layer reads. The engine resolves them (D6). Adding no helper keeps the
    fixed-dependency `new Function` harnesses (test-img-012/013/021) unchanged, as IMG-024 did
    for `paletteRule`.
  - The same line's `includeStats` return gains `cleanupStats:result.cleanupStats??null`.
  - The Line Design branch (`:1165`–`:1182`) is not changed.
- **Sync (`syncSelectedControlsFromLayer()`, image branch).** Next to the `imgAiStoneShrink` value
  set on `:2675`, add `el('imgCleanup').checked=l.cleanup===true;` and
  `el('imgJetOutline').checked=l.jetOutline===true;`.
- **Write (`writeSelectedControlsToLayer()`, image branch).** After the `aiStoneShrink` line
  (`:2873`), add:
  - `if(l.cleanup!==undefined||el('imgCleanup').checked)l.cleanup=el('imgCleanup').checked;`
  - the same for `jetOutline` and `imgJetOutline`.

  This follows IMG-023's rule for `aiStoneShrink`: an unrelated edit never adds a key to an older
  layer.
- **History.** Add `'imgCleanup','imgJetOutline'` to `HISTORY_TRACKED_CONTROL_IDS` (`:5132`). A
  checkbox fires `input` then `change`, so the existing session wiring commits one history step
  per click.
- **Disabling (`renderImageStudio()`).** After the AI stone shrink lines (`:6726`–`:6728`), add:

  ```js
  const cleanupEligible=mode==='ai-stones'||(mode==='staggered'&&resolveSizeMode(l.sizeMode)==='uniform');
  el('imgCleanup').disabled=!cleanupEligible;
  el('imgJetOutline').disabled=!cleanupEligible||l.cleanup!==true;
  el('imgCleanupHint').hidden=cleanupEligible;
  ```

  Here `mode` is the existing `resolveImageFillMode(l.fillMode)` on `:6714`. The helpers are the
  ones `mixedSizeParamsFor()` and the live params already use, so the UI rule matches the engine
  gate.
- **Stats line (`renderImageStudio()`).** Reuse the existing `includeStats` call (`:6845`). After
  the check-and-fix report (`:6853`):
  - set `#imageStudioStatCleanup`, hiding it when `cleanupStats` is null;
  - its text is `Clean-up: +${filled} filled, ${recoloured} recoloured, ${removed} removed`, plus
    `, ${outlined} outlined` when `outlined > 0`;
  - when `cleanupStats.skipped` is set, the text is the A7 sentence instead.
- **Not changed:**
  - `resolveImageExportRegions()` (`:3479`), per D7;
  - `validateProject()`, per D6;
  - every cache key, per A2;
  - `applyRedraw()`/`restoreOriginal()` (`src/redraw/RedrawLayerTransform.js:67`/`:147`). Both
    spread `...layer`, so the two fields survive a redraw untouched;
  - `duplicateLayer()` (`:4488`), which deep-copies the layer, fields included.

### index.html

- **Trace section.** After `#imgAiStoneShrinkField` (`:1200`) and before the section's
  `</details>` (`:1201`), add:

  ```html
  <!-- IMG-025: clean-up of the finished stones; enabled per D8 by app.js renderImageStudio(). -->
  <label class="checkbox-row" title="Fills small holes, fixes single odd-coloured stones and removes stray crumbs"><input type="checkbox" id="imgCleanup"> Clean up stones</label>
  <label class="checkbox-row" title="Turns the outer edge of the design into one row of Jet stones"><input type="checkbox" id="imgJetOutline"> Jet outline</label>
  <p class="hint" id="imgCleanupHint" hidden>Clean-up works with Staggered Fill (one stone size) and AI stones</p>
  ```

  `.checkbox-row` already exists (`:329`–`:330`).
- **Stats panel.** Inside `#imageStudioStats` (`:1262`), after the `</dl>` (`:1269`), add
  `<p class="hint" id="imageStudioStatCleanup" hidden></p>`.
- **D10(a).** `#imageRedraw` (`:1169`) gets the new title.
- **D10(b).** Change CSS only, next to `.image-redraw-row` (`:287`–`:289`):

  ```css
  .image-redraw-style{display:flex;align-items:center;gap:6px;margin:0}
  .image-redraw-style select{width:auto;height:var(--control-height-sm)}
  ```

  - The markup on `:1168` is unchanged, so test-img-024's regex at `:429` still holds.
  - `.image-redraw-row label[hidden]` (specificity 0,2,1) still beats the new rule (0,1,0), so a
    hidden label stays hidden.
  - The global `label{display:block}` (`:51`) and the 34 px select (`:52`–`:53`) are what put the
    select on its own line and taller than the 28 px `.btn.sm` (`:82`).

### D10(c): IMG-024 test table

The "Existing tests that grep the text this build changes" table
(`docs/specifications/IMG-024-FlatArtworkStyle.md:530`–`:556`) cites test-img-022 lines from
before the IMG-024 build and the redraw-timeout fix. The rows that point at test-img-017, 009, 012,
023, 011, 008, 021, 016, 001 and 002 were re-checked and still hold.

The test-img-022 lines, re-grepped at `1b9b7b7`:

| Old | Now | Content |
|---|---|---|
| `:170`–`:180` | `:170`–`:180` | T1, stones prompt and `PROMPT_VERSION` 2 (unchanged) |
| `:245` | `:251` | handler/fake success `{ dataUrl, model, promptVersion: 2 }` |
| `:259` | `:265` | `form.get('prompt') === buildRedrawPrompt()` |
| `:426`, `:499` | `:433`, `:506` | `redrawImage()` result deepEquals |
| `:445` | `:452` | wire body deepEqual |
| `:463`–`:467` | `:470`–`:476` | `REDRAW_ERROR_MESSAGES` slice run through `new Function` |
| `:562`–`:566` | `:569`–`:573` | `deepEqual(out.redraw, …)` |
| `:567`–`:569` | `:576` | changed-key set `['redraw']` |
| `:578`–`:581` | `:584`–`:588` | `deepEqual(second.redraw, …)` |
| `:705`–`:707` | `:712` | index.html ids present |
| `:708` | `:715` | `REDRAW_ACCESS_CODE_STORAGE_KEY` line |
| `:710` | `:717` | `startImageRedraw()` opening lines verbatim |

The build re-greps once more before editing, since IMG-025's own test additions do not touch
test-img-022.

### D10(d): IMG-024 stride test

Rewrite T6 of `tools/test-img-024-flat-artwork-style.mjs` (`:267`–`:287`) on a fixture where the
stride-3 sample and the full population give different greedy picks. For example, give one
catalogue colour only to eligible ordinals `k` with `k % 3 !== 0`.

The test asserts both of these:

- the picks equal `chooseAiStonePalette()` on ordinals 0, 3, 6, …;
- the picks differ from `chooseAiStonePalette()` on all ordinals.

The repeat-call and 100 × 100 checks stay.

## Reference figures

These come from `python3 docs/prototypes/stone_cleanup_reference.py tools/fixtures/img-025/<name>.grid.txt
[--outline]`, checked at spec time against `expected.json`. All 12 match.

| Fixture | Before | Filled | Recoloured | Removed | After | Outlined (`--outline`) |
|---|---|---|---|---|---|---|
| `tiger_photo` | 7,058 | 3 | 605 | 1 | 7,060 | 192 |
| `tiger_stones` | 8,209 | 129 | 761 | 0 | 8,338 | 0 |
| `tiger_flat` | 4,651 | 0 | 501 | 0 | 4,651 | 112 |
| `portrait_photo` | 6,192 | 5 | 157 | 6 | 6,191 | 103 |
| `portrait_stones` | 8,793 | 14 | 870 | 0 | 8,807 | 13 |
| `portrait_flat` | 4,162 | 15 | 310 | 22 | 4,155 | 150 |

Outline changes only colours, so Before/Filled/Recoloured/Removed/After are the same with and
without `--outline`. The sha256 values are in `expected.json`. The Outlined column is from the
reference with `FRAME_PITCHES = 1.1` (audit decision A3); the other columns are as first measured.

## Acceptance figures

- **Fixtures.** Build each fixture's stones from its grid.
  - Stone `(r, c)` sits at `x = x0Mm + c * pitchMm + (r mod 2) * pitchMm / 2` and
    `y = y0Mm + r * pitchMm * SQRT3_2`, with `SQRT3_2 = Math.sqrt(3) / 2`. That is equal to the
    script's `3 ** 0.5 / 2`, which was checked. Evaluate left to right, as the script does.
  - The colour is `palette[letter]`, `placement` is the header `box`, and `stoneSizeMm` is any
    positive value.

  For each of the 6 fixtures, `cleanupLatticeStones()` must then give exactly the counts in
  `expected.json`, both with and without outline. Re-encoded as a grid in the reference format, it
  must give the same sha256.
  - The re-encoding maps each output stone back to absolute `(r, c)` with the header's lattice.
  - The format is `"${R0} ${C0}\n"`, then one row per line with `'.'` for no stone and
    `'a' + paletteIndex` for a stone, then a final `"\n"`.
- **Byte identity.** A layer with `cleanup` absent gives byte-identical stones to today, for every
  fill mode.

## Tests the build must add

These go in a new `tools/test-img-025-stone-cleanup.mjs`, registered in `tools/test-groups.mjs` in
the `geometry` group after test-img-023 (`:224`). They follow the `test()` pattern of the other
IMG tests.

| # | Test | What it proves | Mutation it must catch |
|---|---|---|---|
| T1 | All 6 fixtures, with and without outline, built as in "Acceptance figures": `stats` equals `expected.json` minus `before`/`after`, `stones.length` equals `after`, and the re-encoded sha256 matches. Run twice: with stones in row-major order, and again with the first odd-row stone moved to the front (A4). | The port equals the reference on real layouts, and the D3 reference point does not matter | Speckle stops after 1 round, or updates in place (not synchronously); hole fill order row-major instead of most-neighbours-first; `nbrs()` parity swapped; lattice anchored on a fixed row parity instead of `stones[0]` (the reordered run) |
| T2a | A 3-point enclosed hole in a field of one colour with a second colour on 2 of its rim stones is filled with the majority colour. A 10-point enclosed hole is filled. An 11-point enclosed hole is kept. | Hole size limit and the fill-colour rule | Hole size limit off; limit `<` instead of `<=`; fill colour = first neighbour instead of top |
| T2b | A 1-point gap on the edge of a block, open to the outside, is kept. | Only enclosed holes are filled | "Outside" flood not run, or not grown by one |
| T2c | A single odd stone in an even field is recoloured (own 0, top 6). A pair of adjacent odd stones in an even field are both recoloured (own 1, top 5). A stone whose 4+ neighbours split 2–2 between two other colours is kept (own 0, top 2). A stone with 3 neighbours, all another colour, is kept. | Both speckle branches and both thresholds | Speckle without the `own == 1` branch; own-0 threshold 3 → 2; neighbour minimum 4 → 3 |
| T2d | A one-stone-wide Jet line through a field keeps every interior Jet stone (own 2). | The speckle rule leaves thin lines alone | Rule widened to `own <= 2` |
| T2e | A 3-stone detached group is removed. A 4-stone detached group is kept. `removed` counts stones. | Crumb threshold | `CRUMB_MIN` 4 → 3 or 5; `removed` counts groups |
| T2f | With `outline: true` on a block with the placement box offset from the origin: straight-edge stones (4 neighbours) and corner stones become `'jet'`, interior stones do not, and stones less than 1.1 pitches from any of the four box edges do not. On each side, an edge stone exactly 1 pitch in is excluded and one 1.2 pitches in is outlined. A block edge stone already `'jet'` is not counted. | Outline rule, frame exclusion on all four sides, 1.1-pitch margin, count | Outline without the frame exclusion; exclusion ignores `xMm`/`yMm` offset; margin 1.1 → 1 pitch; `<= 4` → `<= 3`; already-Jet stones counted |
| T2g | Output order: surviving originals in input order, then filled stones in fill order with `sizeMm === stoneSizeMm`, the layer id, `index` from `n`; unchanged stones are the same objects; the input array and its stones are unchanged after the call; `recoloured` excludes outlined stones. | D5 and purity | Filled stones prepended; filled `sizeMm` = pitch; input mutated |
| T3 | Ties: a hole whose neighbours split 3–3 between two colours takes the one earlier in `palette`, and swapping the palette order swaps the result. The same holds for a speckle tie. A colour not in the palette loses a tie to a palette colour. | Palette-order tie rule (D4, A5) | Tie to the later palette colour; ties by string order; unknown colour ranks first |
| T4 | Moving one stone by 0.3 × pitch returns the input array unchanged with `stats` `{ skipped: 'not-lattice' }`. Moving it by 0.2 × pitch does not skip. Two stones on one lattice point skip. Empty input gives zero stats. | D3 skip | Tolerance 0.25 → 0.5; duplicate-point check removed |
| T5 | Engine wiring, on a synthetic image with a planted hole, speckle and crumb: <br>• clean-up runs for Staggered and AI stones (AI stones through a stub `aiStoneDetection`) when `cleanup: true`; <br>• it does not run, and `cleanupStats` is null, for each failing condition: another mode (all 6 others), `sizeMode` `'brightness'` with 2 sizes, `sizeMode` `'mixed'` (both on Staggered), and `cleanup` missing, `false`, `'true'` or `1`; <br>• AI stones with `sizeMode` `'mixed'` still runs; <br>• with `fillGaps: true`, the result equals the IMG-013 pass run on the cleaned stones and `cleanupStats` is not skipped; <br>• at `rotationDeg` 30, the stones equal the 0° cleaned stones rotated by `rotatePointsAroundCenter` about the placement centre, with the same `cleanupStats`; <br>• `jetOutline: true` with `cleanup` off changes nothing. | D2 and D9 engine side | Gate on `cleanup` truthy; `'fill'` allowed; sizeMode check dropped; sizeMode check applied to AI stones too; clean-up moved after fillGaps (fillers break the lattice, so it skips); clean-up moved after rotation (skips) |
| T6 | Byte identity: for each of the 8 fill modes, `JSON.stringify(layout.toJSON())` with no `cleanup`/`jetOutline` equals a sha256 captured on the build's parent commit before `GeometryEngine.js` is edited, and equals the run with `cleanup: false`. A layout without clean-up has no `cleanupStats` key in `toJSON()`; one with it round-trips through `StoneLayout.fromJSON()`. A project with an image layer without the fields round-trips through the extracted `validateProject()` byte-identically. | D6 compatibility | `toJSON()` always writes `cleanupStats`; `normalizeImageParams()` defaults `cleanup` to true |
| T7 | app.js/index.html wiring: <br>• the import literal contains `fillGaps:true,cleanup:true` and no `jetOutline`; <br>• the live params contain `cleanup:layer.cleanup,jetOutline:layer.jetOutline,` and the includeStats return has `cleanupStats:result.cleanupStats??null`; <br>• the four A2 keys (`:1166`, `:2767`, `autoColorCountKeyParts`, the `computeImageColorField` key) do not mention `cleanup`; <br>• index.html has both checkboxes with the D8 titles and labels, in `#imageStudioGroupTrace` after `#imgAiStoneShrinkField`, plus the hint with the D8 text and `#imageStudioStatCleanup`; <br>• both ids are in `HISTORY_TRACKED_CONTROL_IDS`. <br>Run through `new Function` with DOM stubs: <br>• the disabling block: eligible Staggered with cleanup off gives Jet disabled, Clean up enabled, hint hidden; each failing condition gives both disabled and the hint shown; AI stones with `sizeMode` `'mixed'` is eligible; <br>• the write lines: an old layer with the box unticked gains no key, ticking writes `true`, unticking a layer that has the key writes `false`; <br>• the stats-line formatter: `+3 filled, 605 recoloured, 1 removed` without an outlined part at 0, with `, 192 outlined` at 192, the A7 text when skipped, and hidden when null. | D6–D9 wiring | Import literal without `cleanup:true`; params missing a field; Jet outline enabled while Clean up is off; hint never shown; write adds `cleanup:false` to old layers; ids not history-tracked; `outlined` shown at 0 |
| T8 | D10: `#imageRedraw` has the new title; index.html contains both `.image-redraw-style` rules; test-img-024's T6 fails under a no-stride mutation (checked by hand in the build, stated in the report). | D10(a), (b), (d) | Old title kept; select rule missing |

"Checked by hand" for T8 and for every mutation above means this. The build applies the mutation,
runs the file, sees the named test fail, and reverts. The report lists each mutation with the test
that caught it.

One mutation is **equivalent** and is not listed: "outline neighbour counts taken after
recolouring". Outline only changes colours, never occupancy, so the counts cannot differ. The
reference computes them first anyway, and the port keeps that order.

## Existing tests that grep the text this build changes

| Edit | Test and line | What it matches | Result |
|---|---|---|---|
| live params `app.js:1184` gains `cleanup:…,jetOutline:…,` after `fillGaps:Boolean(layer.fillGaps),` | `test-img-013:427` (substring `fillGaps:Boolean(layer.fillGaps)`), `test-img-023:412` (tail `aiStoneDetection:…,...mixedSizeParamsFor(layer)}`), `test-img-017:185`–`:186` (two `/const params=\{[^;]*\};/`), `test-img-011:143`, `test-img-013:366` / `test-img-021:146` / `test-img-012:158` (`new Function` harnesses with fixed dependency lists) | substring / regex / execution | Hold: the insert has no `;`, sits before the tail, and reads only `layer` |
| includeStats return on the same line | `test-img-005:336` (substring `checkFixStats:result.checkFixStats`) | substring | Hold |
| import literal `app.js:5598` | `test-img-013:494` (`/fillGaps:true/`) | regex | Hold |
| `HISTORY_TRACKED_CONTROL_IDS` `app.js:5132` | `test-img-009:300`, `test-img-006:314` (start marker) and substring checks in the files listed by `grep -l HISTORY_TRACKED_CONTROL_IDS tools/*.mjs` | marker / substring | Hold: ids are appended |
| index.html Trace section | `test-ui-shell-structure:218` (ids present), `test-img-016:115` (`<select>` ids matching `/colou?r/i`) | ids / regex | Hold: no new select |
| index.html redraw row | `test-img-024:429`–`:435` (label regex, `label[hidden]` rule, order) | regex / substring | Hold: markup unchanged, CSS added |
| `StoneLayout` gains `cleanupStats` | `test-img-005:255`–`:280` (`checkFixStats` null/present, absent from `toJSON()`), `test-img-021:192` | property | Hold |
| test-img-024 T6 | itself | — | **Rewritten** per D10(d) |

No existing literal moves. The build reruns the files named in this table and the new test, not
`npm test`.

## Anchors (grepped at `1b9b7b7`)

| Anchor | Location |
|---|---|
| GapFill import | `src/geometry/GeometryEngine.js:51` |
| `generateImageLayout()` / doc comment | `src/geometry/GeometryEngine.js:1205` / `:1148`–`:1204` |
| primary stones chain end / S-200 block | `src/geometry/GeometryEngine.js:1352` / `:1354`–`:1383` |
| **clean-up insert point** (before the IMG-013 comment) | `src/geometry/GeometryEngine.js:1384`–`:1385` |
| IMG-013 `fillGaps` block / `startIndex` | `src/geometry/GeometryEngine.js:1393` / `:1402` |
| IMG-021 rotation / return | `src/geometry/GeometryEngine.js:1409` / `:1413` |
| `normalizeImageParams()` / its return / `fillGaps` | `src/geometry/GeometryEngine.js:2513` / `:2569` / `:2625` |
| `StoneLayout` constructor / `toJSON` / `fromJSON` `checkFixStats` | `src/geometry/StoneLayout.js:44` / `:105` / `:132` |
| `sampleStaggeredFieldFillPoints()` | `src/geometry/StoneSampler.js:1921` |
| `sampleStaggeredFillPoints()` / `aiStoneGridPoints()` | `src/geometry/StoneSampler.js:1422` / `src/geometry/AiStoneSampler.js:35` |
| `imageColorPalette()` | `app.js:749` |
| `generateImageStonesLive()` / Line Design key / live params + includeStats return | `app.js:1161` / `:1166` / `:1184` |
| `syncSelectedControlsFromLayer()` / image control values | `app.js:2625` / `:2675` |
| `aiStoneSizingKey()` (unchanged) | `app.js:2767` |
| `writeSelectedControlsToLayer()` / image branch / `aiStoneShrink` write | `app.js:2789` / `:2857` / `:2873` |
| `resolveImageExportRegions()` (unchanged) | `app.js:3479` |
| `duplicateLayer()` (unchanged) | `app.js:4488` |
| `HISTORY_TRACKED_CONTROL_IDS` | `app.js:5132` |
| import handler layer literal | `app.js:5598` |
| `renderImageStudio()` / `mode` / AI shrink disabling | `app.js:6685` / `:6714` / `:6726`–`:6728` |
| stats includeStats call / check-and-fix report | `app.js:6845` / `:6847`–`:6853` |
| `applyRedraw()` / `restoreOriginal()` (unchanged) | `src/redraw/RedrawLayerTransform.js:67` / `:147` |
| `.image-redraw-row` CSS / `.checkbox-row` CSS | `index.html:287`–`:289` / `:329`–`:330` |
| redraw row / style label / `#imageRedraw` | `index.html:1167` / `:1168` / `:1169` |
| Trace section / Fill style / `#imgAiStoneShrinkField` / section end | `index.html:1182` / `:1197` / `:1200` / `:1201` |
| `#imageStudioStats` / `</dl>` | `index.html:1262` / `:1269` |
| test group registration | `tools/test-groups.mjs:224` |
| IMG-024 test table / stride test | `docs/specifications/IMG-024-FlatArtworkStyle.md:530`–`:556` / `tools/test-img-024-flat-artwork-style.mjs:267`–`:287` |

## Non-goals

- Grid, Radial, Contour, Organic, Edge and Line Design layers. Their stones are not on a hex
  lattice.
- Mixed and brightness stone sizes.
- `src/gallery/RhsFixtureBridge.js:484`, which forwards only the IMG-001 params and does not
  forward `fillGaps` either.
- SVG export regions (D7).
- Any change to the reference algorithm or its constants.

## Browser check

Use the Playwright dev-server pattern, with an isolated profile.

1. Import the tiger photo. The layer is Staggered with Clean up ticked. The stats line shows
   "Clean-up: …", and the canvas has no holes or crumbs where the unticked version has them.
2. Untick Clean up. The stones return to the uncleaned set. Undo restores the tick. Jet outline is
   disabled while Clean up is off.
3. Switch Fill style to Grid, Organic and Line Design. Both boxes are disabled and the hint shows.
   Set brightness steps on Staggered: the same.
4. A redraw (fake mode), in each style, keeps the `cleanup` value. With Jet outline on, the AI
   stone picture shows the A8 result (no outline on a full-frame picture), and the flat artwork
   shows a Jet edge.
5. Open a project saved before the build. Its stones and the saved file are byte-identical.
6. The Redraw style select sits inline, at the button's height.
