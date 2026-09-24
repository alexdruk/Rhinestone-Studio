# RS-3039 — Large layouts and per-layer failure

**Status:** spec. Branch `feature/rs-3039-large-layout` off `develop` at `4b4e384`.

**Authorises:** two fixes to the generation path, both surfaced by one browser failure. (1) Every
call that spreads a stone-sized array into an argument list is replaced by a loop that gives the
same result. (2) `app.js`'s `generate()` isolates each layer, so one failing layer no longer blanks
the whole canvas, and the status line names the layer that failed. No geometry changes for any
layout below the limit.

All line numbers below were re-checked against `4b4e384`.

---

## 1. Problem

Observed in Chrome (console):

```
RangeError: Maximum call stack size exceeded
    at selectNonOverlappingSizedStones (MixedSizeGenerator.js:184)
    at generateGapFillStones (GapFill.js:168)
    at GeometryEngine.generateImageLayout
```

**Cause.** `MixedSizeGenerator.js:184` spreads `baseStones.map(...)` into `Math.max(...)`. Every
spread element becomes one call argument, and V8 throws a `RangeError` once the argument count
passes its stack limit. Measured in Node 22.15.0 (`Math.max(...new Array(n).fill(1))`): 125,000
passes and 130,000 throws. An image layer with Fill Empty Slots (IMG-013) on a large placement
passes its whole primary-stone array to `selectNonOverlappingSizedStones()` as `baseStones`, so a
large enough layer reaches the limit.

**Why one layer blanked everything.** `app.js` `generate()` (`app.js:1080`) runs every visible
layer's Live call inside one loop with no `try`/`catch` per layer. The first throw ends the loop,
so `updateAll()` (`app.js:2972`) gets no layout at all. A saved project holding one oversized
layer then showed zero stones for **every** layer. `updateAll()`'s catch block also wrote
`Text generation failed: <message>` to `#status` whatever the layer type was. Here the failing
layer was an image.

The codebase already avoids this spread in two places, with a comment explaining why:
`src/geometry/StoneSampler.js:1603` (`sampleContourFillPoints()`) and
`src/geometry/GeometryEngine.js:996` (`generateSvgLayout()`). Both read: "Appended one-by-one (not
`points.push(...bigArray)`): spreading a very large sample array as call arguments overflows the JS
call stack". This milestone applies the same rule to the sites that still spread.

## 2. D1: replace stone-sized spreads with loops

Each site below spreads an array whose length grows with stone count or candidate count. Each one
becomes a loop that returns the same result.

**The loop form for `Math.max`.** Each `Math.max(...xs)` becomes
`let m = -Infinity; for (const x of xs) m = Math.max(m, x);`, a pairwise fold that still calls
`Math.max`. It does not become `if (x > m) m = x`. The fold matches the spread form for every
input, including the edge cases a comparison would change: any `NaN` element still gives `NaN`, and
`+0`/`-0` resolve as `Math.max` resolves them. `Math.max` gives the same result in any argument
order except for which zero it returns, and the fold visits the elements in the same order the
spread passed them.

**The loop form for `push`.** Each `a.push(...b)` becomes `for (const x of b) a.push(x);`. It
appends the same elements in the same order. The `StoneSampler.js:1603` precedent does the same.

| # | Site | What is spread | Today, for an empty array | After |
|---|------|----------------|---------------------------|-------|
| 1 | `src/geometry/MixedSizeGenerator.js:184` `selectNonOverlappingSizedStones()` `maxDiameterMm` | `baseStones.map(s => s.sizeMm)`, one per primary stone (a whole image layer under IMG-013 gap fill) | Empty `candidatePoints` or `eligibleSizesMm` returns `[]` at `:180-182` before the spread. Empty `baseStones` is reachable: it gives `Math.max(eligibleSizesMm[0], 0)`. | Start at `Math.max(eligibleSizesMm[0], 0)`, then fold each `s.sizeMm` in. Empty `baseStones` gives the same value as today. |
| 2 | `src/geometry/StoneLayout.js:175` `hasAnyOverlappingStonePair()` `cellSizeMm` | `stones.map(stone => stone.sizeMm)` | `stones.length < 2` returns `false` at `:173`, so the spread never sees an empty array (it would give `-Infinity`). | Fold from `-Infinity`. The early return is unchanged, so the result is still `false`. |
| 3 | `src/geometry/StoneLayout.js:240` `measureStoneCrowding()` `cellSizeMm` | `stones.map(stone => stone.sizeMm)` | `count < 2` returns `{count, minRimGapMm: null, medianRimGapMm: null, fractionBelowHalfGap: 0}` at `:236-238`, before the spread. | Fold from `-Infinity`. The early return is unchanged. |
| 4 | `src/geometry/StoneSampler.js:520` `dedupeStonesByRadius()` `cellSizeMm` | `stones.map(s => s.d)`, every project stone (called by `app.js` `generate()`) | Empty input returns the input array itself at `:516-518`, before the spread. | Fold from `-Infinity`. The early return is unchanged: it returns the same reference. |
| 5 | `src/geometry/StoneSampler.js:588` `dropOverlappingSizedStones()` `cellSizeMm` | `assigned.map(s => s.sizeMm)` | Empty input returns `assigned` itself at `:584-586`, before the spread. | Fold from `-Infinity`. The early return is unchanged. |
| 6 | `src/geometry/StoneSampler.js:651` `findCrossGroupCollisions()` `cellSizeMm` | `stones.map(s => s.d)` | Empty input returns a fresh `[]` at `:647-649`, before the spread. | Fold from `-Infinity`. The early return is unchanged. |
| 7 | `src/geometry/GapFill.js:175` `generateGapFillStones()` | `acceptedPoints.push(...roundAccepted)`: one round's accepted fillers, which can be tens of thousands on a large layer | An empty round `break`s at `:169` before the push, and a push of zero elements does nothing anyway. | Per-element push. Same elements, same order. |
| 8 | `app.js:1080` `generate()`, the five `raw.push(...await this.generate{Text,Shape,Svg,Image,Path}StonesLive(...))` calls | One layer's whole Live stone array | A Live call that returns `[]` adds nothing. | Per-element push inside each branch (see §3 for the surrounding `try`). A layer with `[]` still adds nothing. A Live call that returned something non-iterable throws a `TypeError` both before and after the change, and after it that error is caught per layer (§3). |
| 9 | `src/gallery/RhsFixtureBridge.js:553`, `:555`, `:557`, `:562`, `:564` `generateProjectStoneLayout()`, five `raw.push(...generate*StonesForLayer(...))` calls | One layer's whole stone array. This is the Node-side mirror of `app.js` `generate()`, used by `tools/generate-example-baselines.mjs` and the example/overlap regression tests | Same as #8. | Per-element push, same as #8. The per-layer `try` (§3) is **not** added here. The bridge feeds baselines and tests, where a throw has to fail loudly. |

Row 9 was **found by the extra grep** the brief asked for. It is not in the brief's own list. The
grep searched `src/` and `app.js` for `Math.max(...`, `Math.min(...`, `push(...`, `concat(...`,
`unshift(...`, `fromCharCode(...`, `.apply(`, and the same calls split over several lines.

Rows 2–6 cannot throw today on an empty array, because each function returns before the spread.
They are listed because a large array passes the same guard and reaches the spread. Row 4 is on the
path of every `app.js` `generate()` call: once §3 lets a 200,000-stone layer through, the spread in
`dedupeStonesByRadius()` would throw next.

### Out of scope: small by construction

These spread an array whose size does not grow with stone or candidate count, so they cannot
approach ~120,000 arguments. They are left as they are.

| Site | What is spread | Bound |
|------|----------------|-------|
| `src/geometry/GapFill.js:164` | `candidatesForPair(...)` | At most 2 points: the circle-circle intersections of one pair (`:64-68`). |
| `src/geometry/LineDesignSampler.js:840` | `densifyRingForWalk(ring, mmPerPx)` | One traced ring, densified at one image pixel. |
| `src/geometry/ContourRingSampler.js:811`, `:815` | `loops` | The iso-contour loops of one distance threshold. |
| `app.js:1731`, `:1761` | `newRegions` | Regions from one Paint action. |
| `app.js:2040` | `stamps` | Stones from one Trace/Stamp action. |
| `app.js:2142` | `newlyErased` | Grid positions from one Eraser stroke. |
| `app.js:4406` | `naturalPoints` | Erased positions from one edit. |
| `app.js:4593` | `copies` | Duplicated layers. |
| `app.js:6326` | `result.layers` | Monogram layers from one Generate. |
| `src/geometry/GeometryEngine.js:1746`, `:1765` | `regionStoneGroups.map(g => g.stones)` | One argument per **region**, not per stone. |
| `src/geometry/StoneSampler.js:1268` | `members.map(m => m.rawIndex)` | The corners in one proximity cluster. |
| `src/geometry/MixedSizeGenerator.js:122`, `:125` | `allowedSizesMmRaw` | The stone-size catalogue. |
| `src/geometry/PathBoolean.js:123`, `:227-230` | `diagonalsMm`, `boxes` | One per boolean source path. |
| `src/text/OpenTypeProvider.js:203` | `glyphPath.commands` | The path commands of one glyph. |
| `src/monogram/MonogramGenerator.js:824`, `:931`, `:1407` | shrink/fill-scale candidates | A handful per slot. |
| `src/drawing/DrawingBoard.js:195-198`, `:268-271`; `src/drawing/DrawingCanvasTool.js:499-502`; `app.js:2171-2174` | Points of one drawn path | Vertices of one user-drawn or cut contour, not stones. |
| `app.js:3182`, `:3493`, `:3660` | 4 rotated corners; selected layers; stone-size catalogue | Fixed or UI-sized. |

## 3. D2: per-layer isolation in `app.js` `generate()`

Each visible layer's Live call runs inside its own `try`/`catch`:

```js
async generate(project){await this.recoverStaleAuthoredScales(project);let raw=[];const failures=[];for(const l of project.layers){if(!l.visible)continue;try{if(l.type==='text')for(const s of await this.generateTextStonesLive(l,project))raw.push(s);if(SHAPE_LAYER_TYPES.has(l.type))for(const s of await this.generateShapeStonesLive(l))raw.push(s);/* svg, image, path the same */}catch(error){console.error(`Layer ${l.id} generation failed`,error);failures.push({layerId:l.id,layer:l,error})}}const stones=dedupeStonesByRadius(raw).map(s=>new Stone({xMm:s.x,yMm:s.y,sizeMm:s.d,color:s.color,layerId:s.layerId}));return{layout:new StoneLayout({layerId:'project',stones}),failures}}
```

- **A failing layer contributes no stones.** Every layer type matches exactly one branch
  (`SHAPE_LAYER_TYPES`, `app.js:950`, is `circle`/`rectangle`/`SHAPE_LIBRARY_KINDS`, which does not
  overlap `text`/`svg`/`image`/`path`). The Live call's `await` settles before its first `push`, so
  a layer that throws has pushed nothing. Every other layer generates as it does today, in the same
  order.
- **Logged with the layer id:** `console.error` with the id in the message and the error object as
  the second argument, so DevTools keeps the stack.
- **The opening text is unchanged.** The method still starts with
  `async generate(project){await this.recoverStaleAuthoredScales(project);`, because
  `tools/test-mono-006b-stale-authored-scale-initial-load-recovery.mjs:99` slices on that string.
- **`recoverStaleAuthoredScales()` stays outside the per-layer `try`.** Its own comment
  (`app.js:1067`) says a throw there is "deliberately not caught" so it reaches `updateAll()`'s
  catch. That behaviour, and the `dedupeStonesByRadius()`/`Stone`/`StoneLayout` tail, are what the
  whole-generate catch in §4 still covers.
- **No change to `generateLiveStonesForCandidateLayer()`** (`app.js:1090`). Its callers already
  handle their own failures.

### Return shape

Today `generate()` returns a `StoneLayout`. After this change it returns
`{ layout: StoneLayout, failures: { layerId: string, layer: object, error: Error }[] }`. `failures`
is `[]` when every layer generated, and it follows `project.layers` order. The failure entry holds
the layer object itself so §4 can pass it to the existing label helper without looking it up again.

### Callers of `engine.generate()` in `app.js`

`engine` (`app.js:1371`) is the only instance of `app.js`'s inline `GeometryEngine` class
(`app.js:1035`). Nothing inside the class calls `this.generate()`. A grep for `.generate(` in
`app.js` finds only two calls on `engine`. The others are `monogramGenerator.generate(...)` at
`:6159`/`:6180`, a different class.

| Caller | Today | After |
|--------|-------|-------|
| `updateAll()`, `app.js:2972` | `let generated;try{generated=await engine.generate(project)}`, then `layout=generated;` | `let generated,failures;try{({layout:generated,failures}=await engine.generate(project))}`. The destructure keeps the `layout=generated;` statement that follows unchanged (`tools/test-text-position-workflow.mjs:180` pins that exact text), and §4's status handling reads `failures`. |
| `generateProjectThumbnail()`, `app.js:7180` (Library/Gallery thumbnails) | `const stoneLayout=await engine.generate(tempProject)` | `const {layout:stoneLayout}=await engine.generate(tempProject)`. Failures are ignored: the thumbnail shows the layers that generated, and `generate()` has already logged each failure. The outer `try`/`catch` and its `Thumbnail generation failed` log stay for anything outside a layer. |

## 4. D3: status message

In `updateAll()`:

- **At least one layer failed:** right after `layout=generated;`, `#status` is set to
  `` Layer "${layerLabel(first.layer)}" could not be generated: ${first.error.message} ``. With
  more than one failure it adds ` (and N more)`, where N = `failures.length - 1`. The layout from
  the other layers still renders: the rest of `updateAll()` runs as it does after a success.
  `layerLabel()` (`app.js:3025`) is the existing helper that `renderLayerUI()` (`app.js:3016`) uses
  for every row of `#layersList` and every `#selectedLayer` option, and several Paint/Stamp/Trace
  status messages already use it (e.g. `app.js:1715`, `:1956`). No new naming rule is added.
- **No layer failed:** the existing MONO-006A clear at `app.js:2976` resets a stale failure message
  to `Ready`. It now matches both of this feature's messages instead of the old one, using
  `/^(Layout generation failed|Layer ".*" could not be generated: )/`. The regex needs the
  `could not be generated: ` suffix because `Layer "` alone already begins other messages (the
  `validateProject()` errors at `app.js:1264`/`:1307`/`:1308`). Only the `Ready` reset is gated. The
  success-path order is unchanged.
- **Failure outside any layer** (the whole-generate catch at `app.js:2972`): message reworded from
  `` `Text generation failed: ${error.message}` `` to `` `Layout generation failed: ${error.message}` ``.
  The `console.error('Layout generation failed',error)` call is unchanged, and so is the rest of that
  path (it returns before any draw, stats, history or autosave call).
- **Precedence is unchanged.** The existing
  `if(permanentEngineError)el('status').textContent='Font manifest failed to load (...)...'` at the
  end of `updateAll()` still runs after all of this and still takes priority.

`Text generation failed` no longer appears anywhere in `app.js`. `#status` is not saved to disk, so
no older text needs to be matched.

## 5. D4: no behaviour change below the limit

For every layout under the argument limit, the D1 loops return the same values as the spreads did
(§2), and when no layer fails `generate()`'s `layout` is identical to the `StoneLayout` it returns
today: same `raw` order, same `dedupeStonesByRadius()`, same wrapping. Every existing test passes
unchanged except the following, each forced by D2's return-shape change or D3's rewording and each
changed on the test side only:

- `tools/test-mono-006b-stale-authored-scale-initial-load-recovery.mjs`: tests 15 and 16 read
  `layout.stones` from `generate()` and now read `.layout.stones`. The four `.replace(...)` calls
  (around `:340-343`) strip the shape/svg/image/path `raw.push(...await ...)` branches out of the
  sliced method before running it. They are rewritten to match the new branch text. Today they
  would silently match nothing, and the leftover branches would only survive because the fixture
  is text-only.
- `tools/test-move-drag-fast-path-wiring.mjs:122`: its pinned regex ends with
  `return new StoneLayout\(\{layerId:'project',stones\}\)`. It is updated to the new
  `return{layout:new StoneLayout({layerId:'project',stones}),failures}` tail. The dedupe-then-wrap
  part it guards is unchanged.
- `tools/test-autosave-recovery-wiring.mjs`: its `buildGenerate` stubs return `{}`/`{count:3}` as
  the layout. They now return `{layout:{...},failures:[]}`, because the destructure needs
  `failures` to be an array. The thrown-error test (`:253`) now
  expects `Layout generation failed: boom`. The stale-status test (`:300-303`) seeds
  `Layout generation failed: boom`.
- `tools/test-mono-006a-authored-scale-regression.mjs:228`: its source regex pins the
  `startsWith('Text generation failed')` clear. It is updated to the §4 regex form.
- `tools/test-svg-integration.mjs:32`, `tools/test-image-trace-regression.mjs:52` and
  `tools/test-path-boolean-integration.mjs:146`: each matches its own type's branch as
  `if(l.type==='svg'|'image'|'path')raw.push(...await this.generate{Svg,Image,Path}StonesLive(l))`.
  Each is updated to the D1 loop form
  `for(const s of await this.generate{Svg,Image,Path}StonesLive(l))raw.push(s)`.
- `tools/test-shapes-design-consolidation.mjs:111`: it finds `generate()` with a regex that ends at
  the old last statement, `return new StoneLayout({layerId:'project',stones})}`. It now ends at the
  D2 statement, `return{layout:new StoneLayout({layerId:'project',stones}),failures}}`.

The first version of this list missed these four. The search for affected tests looked for
`generate()`'s opening line and for `engine.generate`, not for the text of each line D1 and D2
change.

These use `updateAll()`/`generateProjectThumbnail()` source but **do not** need a change:
`tools/test-text-position-workflow.mjs:180` (its regex starts at `layout=generated;[\s\S]*?`. That
statement is kept as it is by the destructure in §3, and the tail it pins is untouched. The status
lines §4 adds sit inside the `[\s\S]*?` gap before `renderLayerUI();`, the same gap that already
holds MONO-006A's clear),
`tools/test-ui-shell-structure.mjs:492` (checks `drawLayout()`/`drawCup()` only), and
`tools/test-gallery-integration.mjs:95` (checks that `generateProjectThumbnail()` exists and is
shared).

## 6. Tests

`tools/test-rs-3039-large-layout.mjs` (new, found automatically by `tools/run-tests.mjs`).

- **T1: D1 geometry at 200,000 stones.** The fixture is a grid of 200,000 stones at 2.5 mm pitch,
  500 columns × 400 rows, `sizeMm: 2`, starting at `(0, 0)`. None of them overlap. Each function
  below is called on it, must not throw, and has its result pinned:

  | Function | Call | Pinned result |
  |----------|------|---------------|
  | `hasAnyOverlappingStonePair` | grid | `false` |
  | `measureStoneCrowding` | grid, `{gapMm: 0.3}` | `{count: 200000, minRimGapMm: 0.5, medianRimGapMm: 0.5, fractionBelowHalfGap: 0}` |
  | `dedupeStonesByRadius` | grid as `{x,y,d,layerId}`, `layerId` alternating `'a'`/`'b'` | 200,000 kept |
  | `dropOverlappingSizedStones` | grid | 200,000 kept |
  | `findCrossGroupCollisions` | same records as `dedupeStonesByRadius` | `[]` |
  | `selectNonOverlappingSizedStones` | one candidate `{xMm: -10, yMm: -10}` (10 mm outside the grid's bounds on both axes), `baseStones` = grid, `[2]`, `gapMm: 0.3` | `[{xMm: -10, yMm: -10, sizeMm: 2}]` |

  `generateGapFillStones()` is not run at 200,000 stones: a full pass on that grid took about 10 s.
  Its two D1 exposures are covered separately. The spread it reaches through `GapFill.js:168` is
  row 1, tested directly above with a 200,000-stone `baseStones`. Row 7 (`GapFill.js:175`) is
  covered by a **source guard**. The test slices the `generateGapFillStones()` body out of
  `src/geometry/GapFill.js` and asserts that it contains no `push(...` whose argument is
  `roundAccepted`, matching `/push\(\s*\.\.\.\s*roundAccepted\b/`.

  These values come from a scratch prototype of the D1 loops, a copy of `src/geometry/` outside
  the repo, run on Node 22.15.0 while this spec was written. The implementation re-derives them by
  running its own loop version, as the brief asks. On the same 200,000-stone inputs the current
  spread code throws `RangeError: Maximum call stack size exceeded` at `StoneLayout.js:175`, and
  at `MixedSizeGenerator.js:184` for the `selectNonOverlappingSizedStones` call. The browser
  report shows the same stack trace, reached from `GapFill.js:168`. Each call takes about 0.2–0.5 s
  on the loop prototype.

  **The gap-fill fixture in the equivalence check below has to be bounded.** It needs a placement
  clipped to the grid (`{xMm: 0, yMm: 0, widthMm: 122.5, heightMm: 47.5}` for the 50 × 20 slice)
  and `gapMm: 0.3`, `fillerSizeMm: 0.5`. With a placement larger than the grid, fillers keep being
  placed outside it round after round, and the pass did not finish in 10 minutes. With `gapMm: 0`
  inside the bounds, it runs extra rounds (9,309 fillers against 931 at `gapMm: 0.3`).

  **Equivalence check.** On a 1,000-stone slice of the same pattern (50 × 20, so the
  square-centre candidates and the gap-fill rounds are two-dimensional), the loop version and the
  original spread version return deep-equal results for all seven functions of rows 1–7. Here
  `selectNonOverlappingSizedStones` takes the square-centre candidates (`+1.25, +1.25` from every
  stone not in the last column or row) with `[0.5]` and `gapMm: 0.3`, and `generateGapFillStones`
  uses the bounded fixture above. Each function's
  empty-array result (and `selectNonOverlappingSizedStones` with empty `baseStones`) is deep-equal
  as well. The test keeps a spread reference copy inline, as a local function per site, for this
  comparison. If the two ever differ, the implementation stops and reports, and does not pin a
  value. This comparison was run on the scratch prototype while this spec was written, and every
  result matched: the seven calls, the empty cases, an input with a `NaN` `sizeMm`, and an input
  with an overlapping pair. The slice gives 931 accepted candidates and 931 gap fillers.
- **T2: `generate()` isolation.** Runs the real `generate()` method from `app.js`, extracted with
  brace-balanced slicing and executed through `new Function()`. This is the pattern at
  `tools/test-img-013-fill-empty-slots.mjs:350` and
  `tools/test-mono-006b-stale-authored-scale-initial-load-recovery.mjs:99`. It runs against a stub
  `this` with three visible layers of different types, and the middle layer's Live call throws.
  Expected: `layout.stones` holds the first layer's stones followed by the third layer's stones, in
  that order. `failures` has exactly one entry, whose `layerId` is the middle layer's id and whose
  `error` is the thrown error. `console.error` was called once, with a message containing that id.
- **T3: `generate()` at 200,000 stones.** The same extraction, with one stub layer whose Live call
  returns 200,000 non-overlapping stone records. `generate()` returns a `layout` of 200,000 stones
  without throwing. This exercises D1 rows 4 and 8 together.
- **T4: `updateAll()` status text.** Runs the real `updateAll()` body, extracted with the
  `extractFunctionBody()` + `new Function()` harness already in
  `tools/test-autosave-recovery-wiring.mjs` (`runUpdateAll()`), with `layerLabel` injected as the
  real function sliced from `app.js`. The `#status` text is asserted for one failure, three
  failures (`(and 2 more)`), and a `generate()` that throws (`Layout generation failed: …`). This
  runs the source instead of pattern-matching it, because the thing under test is the string
  `updateAll()` builds at runtime from `failures` and `layerLabel()`. A regex over the source would
  still pass if the template were built wrong, for example with an off-by-one in N. The same
  harness also shows that a later success resets either message to `Ready`, and that
  `permanentEngineError` still overrides the layer message.

  In the one-failure case, `engine.generate` is the real extracted `generate()` from T2, bound
  to T2's three-layer stub with the middle layer throwing. After `updateAll()` resolves, T4 also
  asserts two things. First, the `layout` variable `updateAll()` assigned (the test's copy of the
  harness exposes it through a getter) holds the first and third layers' stones in that order.
  Second, the draw step ran: `drawLayout` is the harness's `record('drawLayout')` call-recorder
  stub, so `'drawLayout'` appears in the recorded calls. The rest of `SUCCESS_TAIL_ORDER` appears
  too, so the render, stats, history and autosave calls run after a layer failure, not only after
  a full success.

**Mutants.** Each change below must make the named test fail:

| Mutant | Must fail |
|--------|-----------|
| Put back the spread at `MixedSizeGenerator.js:184` | T1 (`RangeError`) |
| Put back the spread at `GapFill.js:175` | T1 source guard |
| Put back any one `raw.push(...await ...)` spread in `generate()` | T3 (`RangeError`) |
| Remove the per-layer `try`/`catch` in `generate()` | T2 |
| Put back `Text generation failed` in `updateAll()`'s catch | T4 |

## 7. Not in scope

- The out-of-scope spread sites in §2.
- Making `recoverStaleAuthoredScales()` fail per layer (see §3).
- Any per-layer failure marking in the Layers list or on the canvas. The status line is the only
  place a failure is reported.
- Changing how large a layer can get. This milestone makes large layers work and keeps one failing
  layer from blanking the others. It adds no size limit.
