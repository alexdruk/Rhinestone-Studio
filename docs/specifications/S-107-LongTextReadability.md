# S-107 — Front View Frame & Long Text Workflow

(Originally scoped as "Long Text Readability"; retitled for Part 3 below, which replaces Part 2's
warning-only workflow with the Front View Frame. Parts 1 and 2 are kept verbatim as historical
record — Part 1 is still in effect unmodified; Part 2 is explicitly superseded, see Part 3.)

## Task ID

S-107

## Type

Part 1/2: readability/quality fix. Part 3: a real UI feature (a new, movable, bidirectionally-synced
2D canvas overlay) plus a corrected long-text validation rule — still no second layout pipeline, no
GeometryEngine/StoneLayout/project-schema/exporter changes, no multi-row text, no production
geometry change (3D preview body-radius sizing is a preview-only visual, not a stone position).

## Status

IMPLEMENTED (Parts 1–3)

## Branch

feature/s-107-long-text-readability

## Objective

Improve the readability of long text projected onto cylindrical objects (Object Preview), without
regressing short/medium text, without a second layout pipeline, and without changing production
geometry, exporters, or the project schema.

## Audit (pipeline stages, verified against the live repository before implementation)

Walked the full text pipeline the specification asks for — measurement, scaling, spacing, wrap
angle, projection:

1. **Measurement.** `GeometryEngine._buildPositionedContours()` (`src/geometry/GeometryEngine.js`)
   resolves each character to a glyph `VectorPath` via `FontProviderRegistry.getTextPath()` at the
   requested `heightMm`, advancing a pen position by each glyph's `advanceWidthMm` plus
   `letterSpacingMm` (app.js never passes a non-zero `letterSpacingMm` for live text layers, so this
   is always 0 today). Pure, correct, and shared by every consumer.
2. **Scaling.** `app.js`'s `GeometryEngine.generateTextStonesLive()` (the live orchestration class
   that calls the permanent engine — not to be confused with the permanent
   `src/geometry/GeometryEngine.js`) implements auto-fit: when `layer.autoFit` is on and the
   generated text's `widthMm` exceeds `project.canvas.width-10`, it regenerates the layout once at
   `scaledHeight = layer.height * (maxWidth/widthMm)` — a uniform, non-distorting shrink of the whole
   glyph run. **This is the stage that breaks down for long text**: the shrink factor has no floor,
   so sufficiently long text gets scaled arbitrarily small.
3. **Spacing.** `spacingMm = stoneSizeMm + gapMm` (`GeometryEngine.generateTextLayout()`) is the
   fixed physical pitch outline/fill sampling walks the glyph contours at. Auto-fit's scaling stage
   (#2) shrinks `heightMm` but **never touches `stoneSizeMm`/`gapMm`** — they stay exactly as
   configured. This is the root cause: as auto-fit's shrink factor grows (longer text), the ratio of
   glyph size to stone pitch falls, and once a glyph's stroke width approaches the stone's own
   diameter, outline sampling can no longer place enough stones to trace the letterform — the result
   reads as a blurred row of dots, not text. Confirmed empirically (see below): at
   `heightMm/spacingMm ≈ 3`, text is illegible; at `≈ 6`, it reads clearly.
4. **Wrap angle.** `ObjectDimensions.WRAP_ANGLE_DEG` (`src/preview3d/ObjectDimensions.js`) maps each
   wrap mode (`front`/`wide`/`half`/`full`) to a fixed angular window the shared texture is mapped
   onto (`ObjectGeometryBuilder.applyAzimuthUv()`). This window is **independent of text length or
   content** — the same fixed compression applies to a one-character layer and a
   whole-sentence layer alike. Not a length-dependent contributor to this bug (ruled out: a fix here
   would change short/medium text's appearance too, violating the "must remain visually unchanged"
   requirement).
5. **Projection.** `ArcProjection.projectPolygonToArc()` only runs for `curveEnabled` text (off by
   default) and is a uniform angle-proportional remap — not implicated for straight text, which is
   what every reported case uses.

### Root cause

**Scaling/Spacing decoupling in auto-fit** (`app.js`, live `GeometryEngine.generateTextStonesLive()`
and its polygon-only twin in `resolveLayerShapeSource()`): auto-fit shrinks `heightMm` without limit
to force long text to fit `project.canvas.width`, but the stone pitch (`stoneSizeMm`+`gapMm`) never
shrinks with it. Past a certain text length the fixed-size stones structurally cannot trace the
now-tiny glyph outlines, and the *same underlying `StoneLayout`* — consumed identically by the 2D
canvas, the Object Preview, and every exporter (per `docs/ARCHITECTURE.md`'s single-source-of-truth
principle) — renders as illegible dot-soup everywhere it is drawn.

Verified directly in a real browser (Playwright/Chromium, `python3 -m http.server 5173`, no mocks):
a 67-character phrase on the default mug project reproduced the reported symptom in **both** the 2D
Canvas (viewed at full single-panel zoom, not just the small dual-workspace panel) and the Object
Preview — ruling out a 3D-only rendering artifact (texture filtering, mip/aliasing, wrap-angle
compression) as the primary cause. The Object Preview's curved-surface projection and per-stone
lighting/shading do further reduce contrast on an already-marginal pattern (consistent with the
problem statement's framing that the Object Preview is where this is most noticeable), but the
pattern itself — the thing that must be fixed — is generated once, upstream, in the shared pipeline.

This is also why the fix belongs in that one shared pipeline rather than a 3D-only presentation
trick: per requirement 4/5 ("do not introduce a second layout pipeline", "keep one GeometryEngine
and one StoneLayout pipeline"), the correct fix is the one that keeps 2D, 3D, and every exporter
showing the exact same, now more-legible, stone pattern — not a preview-only reflow that would make
the Object Preview lie about what gets produced.

### Why stone size itself cannot shrink

`stoneSizeMm` is a real, catalog rhinestone diameter (`src/renderer/StoneSizes.js`: SS6/SS10/SS16/
SS20/SS30 — 2.0/2.8/4.0/4.7/6.4mm, no smaller option than 2.0mm). Silently rescaling it during
auto-fit would produce a non-orderable size and misrepresent what will actually be manufactured —
the opposite of "preserving production accuracy". The fix therefore never touches `stoneSizeMm` or
`gapMm`; only the existing `heightMm` scaling gets a floor.

## Decision: clamp auto-fit's shrink to a legibility floor, do not shrink stone size

`computeAutoFitScale(layer, project, measuredWidthMm)` (new, `app.js`) is the one place both
`generateTextStonesLive()` and `resolveLayerShapeSource()`'s text branch now compute the auto-fit
scale (previously each duplicated the same inline `maxWidth`/`scale` arithmetic independently):

* If auto-fit is off, or the text already fits, the scale is `1` — byte-identical to before.
* If it needs to shrink, the scale is `max(fitScale, minScale)` clamped to at most `1`, where
  `fitScale = maxWidth/measuredWidthMm` (the pre-existing behavior) and
  `minScale = (spacingMm * MIN_AUTOFIT_HEIGHT_TO_SPACING_RATIO) / layer.height` — a floor that keeps
  `heightMm` at least `6×` the stone pitch.
* Whenever `fitScale >= minScale` (mild overflow), the result is **exactly** the old scale — no
  behavior change for any text that doesn't need the floor.
* Only text long enough that `fitScale` would have dropped below the floor gets a **larger** (less
  aggressive) scale than before — the text now overflows `maxWidth` instead of collapsing into
  illegible stone soup, surfacing the pre-existing "This text is outside the printable area" /
  "Center Text" warning (`S-104`) rather than silently producing an unreadable product.

`MIN_AUTOFIT_HEIGHT_TO_SPACING_RATIO = 6` was chosen empirically: disabling auto-fit and manually
sweeping `heightMm` for representative phrases showed `heightMm/spacingMm ≈ 3` (the original,
unmodified bug) reads as a blurred dot row; `≈ 4` is marginal; `≈ 6` reads clearly and consistently
across mug/tumbler/bottle. This is a presentation/legibility choice, not a physical or manufacturing
constraint — the exact constant can be revisited independently of the pipeline fix it lives in.

## Implementation Summary

* **`app.js`** — new `MIN_AUTOFIT_HEIGHT_TO_SPACING_RATIO` constant and `computeAutoFitScale()`
  helper (next to the existing `computeTextPlacementOffset()`, which the doc comment already notes
  keeps two call sites in sync "by construction instead of by duplicated arithmetic" — the same
  pattern this fix now applies to auto-fit's scale decision). `generateTextStonesLive()` and
  `resolveLayerShapeSource()`'s text branch both call it in place of their previous, separately
  duplicated inline `maxWidth`/`scale` computation.
* No change to `src/geometry/GeometryEngine.js`, `src/geometry/StoneLayout.js`, any exporter
  (`src/export/**`), the project/layer schema, any renderer, or `src/preview3d/**`. Existing project
  files remain fully compatible — `layer.autoFit`/`layer.height`/`layer.stoneSize`/`layer.gap` are
  read exactly as before, nothing new is stored.
* No multi-row text: the fix only changes how far a single line is allowed to shrink before it is
  allowed to overflow instead; wrapping to additional lines is out of scope for this milestone.

## Out of Scope

* Multi-row/wrapped text layout — explicitly excluded by the milestone's own requirement 8.
* Changing `WRAP_ANGLE_DEG`, texture resolution (`TEXTURE_PX_PER_MM`), or camera framing in
  `src/preview3d/**` — audited and ruled out as the primary cause (see "Wrap angle" above); changing
  them would also alter short/medium text's appearance, which must stay visually unchanged.
* Tuning/exposing `MIN_AUTOFIT_HEIGHT_TO_SPACING_RATIO` as a user-facing setting — it is an internal
  legibility floor, not a new project field.

## Testing

`tools/test-s107-long-text-readability.mjs` — structural checks against the live `app.js` source
(this repository's established "check the live source" convention, since `app.js` is a browser entry
point and not `import()`-able directly under plain Node) confirming both auto-fit call sites use the
one shared `computeAutoFitScale()` helper and the old duplicated inline arithmetic is gone, plus a
forbidden-file guard (`src/geometry/**`, `src/export/**` untouched). Behavioral checks extract and
execute the real `computeAutoFitScale()` function from that source (mirroring
`tools/test-alignment-snapping-integration.mjs`'s `extractFunction()`/`new Function()` precedent)
and verify: auto-fit off never rescales; text that already fits is never rescaled; mild overflow
gets the exact pre-existing fit-to-width scale; severe overflow clamps to the 6× floor instead of
the old, more-aggressive shrink; the floor never scales height *up* past 1.

## Browser Verification

Real, unmocked browser (Playwright/Chromium), `python3 -m http.server 5173`, default project
(mug, 210×90mm, SS6/2.0mm stones, 0.3mm gap, Courier Prime, wrap `front`) plus Straight Tumbler
(230×100mm) and Bottle (180×90mm):

* **Short text ("Hi")** — 69 stones, 29.2×18.6mm, unchanged before/after on all three object types;
  auto-fit never engages (text far under `maxWidth`).
* **Medium text ("Vitalina Serbin", the project default)** — 375 stones, 199.4×17.0mm on the mug,
  identical before/after (`fitScale` never drops below the floor at this length); confirmed clearly
  readable in both 2D and 3D, before and after.
* **Very long text ("Special thanks to my love for all the help she gives to everyone", 67
  characters)** — before the fix: auto-fit shrinks to `heightMm≈6.4`, `heightMm/spacingMm≈2.8`,
  renders as an illegible row of dots in **both** the 2D Canvas and the Object Preview, on all three
  object types. After the fix: shrinks only to the 6× floor (`heightMm≈13.8`), individual words are
  legible ("...love for all the help sh...") in the 2D Canvas and on the mug, tumbler, and bottle's
  Object Preview alike; the text now exceeds `maxWidth`, correctly surfacing the pre-existing
  "This text is outside the printable area" / "Center Text" affordance rather than silently
  shipping unreadable output.
* No distortion introduced: the fix only changes a uniform `heightMm` scale factor (the same
  operation auto-fit already performed) — glyph proportions are never non-uniformly stretched or
  squashed.
* Zero console/page errors introduced by this change (one pre-existing, unrelated WebGL
  `glTexSubImage2DRobustANGLE` driver warning was confirmed present on `develop` before this branch's
  changes too, via `git stash`, when switching to the Straight Tumbler object type in this headless
  test harness).

Full before/after screenshots (short/medium/very-long × mug/tumbler/bottle) captured during
implementation; representative samples included in `TASK_RESULT.md`'s Browser Verification section.

## Recommendation (Part 1)

Approve. The fix is the smallest change that addresses the actual, verified root cause (scaling and
spacing decoupling in auto-fit) inside the one existing shared pipeline, leaves short/medium text
byte-identical, never touches `GeometryEngine`/`StoneLayout`/exporters/schema, introduces no second
pipeline and no multi-row layout, and never adjusts a real catalog stone size — preserving
production accuracy for every text length.

---

## Part 2 (follow-up): a clear failure state instead of a silent overflow

### Audit of the real user-facing outcome

Part 1's floor stops illegible over-shrinking, but for text long enough that the floor wins,
`generateTextStonesLive()` still lets the result overflow `maxWidth`. Browser-verified with the
exact reported phrase ("Special thanks to my love for all the help she gives to everyone", 67
characters) on the default mug: the generated text is 529.6mm wide against a 200mm `maxWidth` — more
than 2.6× over. Centering it (`computeTextPlacementOffset()` already centers by default) only makes
the overflow symmetric; a large, unavoidable fraction of the design still falls outside the
project's canvas bounds. The *only* warning that fired for this was the pre-existing, purely
*positional* `isTextOutsidePrintableArea()` — its "↺ Center Text" recovery button visibly did
nothing (confirmed: clicking it, the warning and the clipped Object Preview render were unchanged),
because centering was never the problem. This is the real gap: the operator was told "reposition
it" when the true, structural fact is "this cannot fit here no matter where it sits."

### What actually governs "fits"

Re-examined every candidate lever against the live architecture before choosing a fix:

* **Canvas width (`project.canvas.width`, via `maxWidth = canvas.width-10`)** is the one hard bound.
  `StoneLayoutTexture.js`'s `drawStoneLayoutTexture()` rasterizes into a buffer sized exactly to
  `canvasWidthMm`×`canvasHeightMm` — content outside those mm bounds is never drawn, in 2D or 3D.
* **Wrap mode does *not* affect this bound.** Confirmed against `src/products/ObjectTemplate.js`
  (`getSafeAreaRectMm()` takes no wrap argument — only `canvasWidthMm`/`canvasHeightMm` and the
  template's own fixed margins) and against the existing architecture comment already in `app.js`
  above `isTextOutsidePrintableArea()`: "anything within the flat canvas's mm bounds is always...
  visible... regardless of wrap mode." Verified empirically too: the same 67-character phrase was
  checked on the mug across all four wrap modes (`front`/`wide`/`half`/`full`) and the "too long"
  condition never changed. A naive "usable wrap width = arc length for this wrap mode" definition
  was considered and rejected: at `front` (70°) that arc is only ~82mm on the default mug, which
  would have wrongly flagged the *medium* "Vitalina Serbin" example (199.4mm) that must stay
  unchanged — proof this definition is wrong for this codebase.
* **Object type (mug/tumbler/bottle)** does change canvas width (210/230/180mm) — a genuine, already
  general "choose a wider object" remedy.
* **Stone size** changes the floor's own required `heightMm` (`spacingMm × 6`), so a smaller stone
  size directly shrinks the resulting width for the same text — verified empirically: "Happy
  Birthday Sarah" is flagged too-long at SS16 (4.0mm) stones but fits cleanly at SS6 (2.0mm).

### Decision

1. **Detection** (`isTextTooLongForObject(l)`, `app.js`) reuses Part 1's own floor decision rather
   than inventing a second, independent threshold: `computeAutoFitScale()` now also returns
   `floorApplied` — true exactly when the legibility floor (unchanged) is what won over the pure
   fit-to-width shrink, which by construction means the result no longer fits `maxWidth`.
   `generateTextStonesLive()` records this per layer id in a new, transient, in-memory-only
   `autoFitFloorAppliedByLayerId` map (cleared at the top of every `generate()` call; never read by
   `validateProject()`, save/load, or any exporter — not part of the project/layer schema).
   `isTextTooLongForObject()` just reads that map, so it can never disagree with what was actually
   generated, and needs no new geometry or arbitrary safe-area threshold.
2. **A new, distinct, persistent warning** — "This text is too long to fit legibly on this object."
   — replaces the misleading positional warning whenever `isTextTooLongForObject()` is true
   (`updateTextOutsidePrintableWarning()` now computes both and shows the structural one with
   priority; the two are mutually exclusive by construction). It appears in both the always-visible
   right Inspector panel (`#workspaceTextTooLongWarning`, no Lightbox needed — requirement 6) and the
   Text Lightbox (`#textTooLongWarning`, for consistency with the existing dual-surface pattern),
   reusing the existing `.validation-message`/`.hint` styling verbatim (no new CSS).
3. **Next actions** (`textTooLongActionMessage()`): "Try: shortening the text, reducing the stone
   size, or choosing a wider object." — the three remedies verified to actually work. No "Center
   Text" button on this warning: centering never fixes a structural too-long failure, and offering it
   here would repeat the exact misleading affordance this follow-up exists to remove.
4. **Wrap-mode recommendation** (`recommendedWrapModeForFit(l)`): implemented as a real, evaluated
   check per requirement 7 ("if a wider valid wrap mode can fit the text, recommend it") rather than
   assumed away. Given the audit above (fit is wrap-independent for every ObjectTemplate shipped
   today), it always returns `null` — so no wrap-mode tip is ever shown, and `project.wrap` is never
   written by this code. If a future ObjectTemplate ever made safe-area size wrap-dependent, this
   function is where that would start being picked up, with no other code change needed.
5. Not implemented: hiding or suppressing the rendered (clipped) stones themselves. Requirement 3
   says not to *silently* render an unreadable/clipped result — the fix for "silent" is the loud,
   unmissable warning now shown, not removing the operator's actual, already-drawn work from view.
   Seeing the real (clipped) design alongside a clear explanation is more transparent than hiding it
   behind a placeholder, and needed no changes to how stones themselves render.

### Testing

`tools/test-s107-long-text-readability.mjs` (extended): structural checks that
`generateTextStonesLive()` records `floorApplied` into `autoFitFloorAppliedByLayerId`, that the map
is cleared at the top of `generate()`, that it is never referenced by
`validateProject()`/`JSON.stringify`/either exporter, and that the new warning markup exists with the
exact required wording in both the Inspector and the Lightbox. Behavioral checks extract and execute
the real `isTextTooLongForObject()`/`recommendedWrapModeForFit()`/`textTooLongActionMessage()`
functions (injecting a fake `autoFitFloorAppliedByLayerId` map, the same technique used for
`computeAutoFitScale()`) and verify: true only for the exact layer id whose last generation had
`floorApplied:true`; false for non-text layers and never-generated ids;
`recommendedWrapModeForFit()` is null whenever not too-long, and always null when too-long (matching
the audited wrap-independence); the action message always lists all three real remedies; and
`updateTextOutsidePrintableWarning()`'s priority/mutual-exclusivity logic is wired correctly.
`tools/test-s104-text-position-recovery-drag-tuning.mjs` check 12 was updated (not weakened) to match
`updateTextOutsidePrintableWarning()`'s new, still-`isTextOutsidePrintableArea()`-driven but
now-floor-gated logic.

### Browser Verification

Real, unmocked browser (Playwright/Chromium), `python3 -m http.server 5173`:

* **The exact reported phrase, mug, `front` wrap** — now shows "This text is too long to fit legibly
  on this object." with the three-remedy message, in both the Inspector and the Lightbox; the old
  "outside the printable area" / "Center Text" warning is suppressed (not shown alongside it).
* **Short ("Hi") and medium ("Vitalina Serbin") text, mug** — no warning at all, either before or
  after this follow-up; identical `layoutStats` (69 stones/29.2×18.6mm and 375 stones/199.4×17.0mm)
  to Part 1's own verification.
* **Mug, tumbler, bottle** — the exact reported phrase triggers the same warning on all three
  (738 stones, 529.6×13.9mm on every object — canvas width does not change the floor-clamped text
  itself, only the safe-area/canvas numbers shown alongside it).
* **All four wrap modes (`front`/`wide`/`half`/`full`)** on the mug with the same phrase — the
  warning state is identical across every mode, confirming the audited wrap-independence directly
  rather than by inspection alone.
* **Several stone sizes** — "Happy Birthday Sarah" is fine (no warning, 200.5mm) at SS6 (2.0mm),
  too-long at SS10 (2.8mm, 223.6mm) and SS16 (4.0mm, 301.3mm) — confirming "reduce the stone size" is
  a real, working remedy, not just suggested text; a shortened version of the reported phrase
  ("Special thanks, love you") also clears the warning entirely (201.1mm, fits).
* **No misleading "successful" preview without feedback**: every case that cannot fit now shows the
  warning; every case that does fit shows no warning at all — confirmed there is no state where a
  clipped/illegible result renders with zero indication anything is wrong.
* **2D and 3D stay consistent**: the warning is driven by the one shared `layout`/bbox, not by
  either canvas independently, so both panels always agree with the Inspector's warning state.
* `npm test`: 892 checks, 0 failures (69 test files, `tools/test-s107-long-text-readability.mjs` now
  21/21).

## Recommendation (Part 2)

Approve. Detection is derived from Part 1's own unmodified floor decision (no second threshold, no
new geometry), the new warning is persistent and Lightbox-free per requirement 6, its copy lists only
verified-working remedies and never offers the one action (Center Text) proven not to help, the
wrap-mode recommendation is a real evaluated check that is honestly `null` today rather than a faked
positive, and nothing in `GeometryEngine`/`StoneLayout`/any exporter/the project schema changed.

---

## Part 3 — Front View Frame & Long Text Workflow (supersedes Part 2's warning-only workflow)

### Why Part 2 was not acceptable

Part 2's "This text is too long to fit legibly on this object." warning fired whenever a text
layer's generated width exceeded `project.canvas.width-10` (`maxWidth`) — the width of a single,
already-narrow viewing window. But `maxWidth` was never a real manufacturing limit: it is the
*flat design canvas's* own width, not the *object's circumference*. A cylindrical object can carry a
design considerably wider than one flat "page" of canvas, because the design wraps around the
object's curved surface. Part 2 warned the operator the moment their text got wider than that one
window — even when the object could easily carry it once wrapped — and offered no way to inspect
the part of a long design not currently in that window. This milestone removes that workflow and
replaces it with a **Front View Frame**: a movable overlay on the 2D Canvas showing exactly which
portion of the design is facing the viewer in the Object Preview, synchronized bidirectionally with
the Object Preview's rotation.

### Audit (walked before any code changed, against the live repository)

**1. Relationship between production canvas width and printable circumference.**
`src/preview3d/ObjectDimensions.js`'s `computeBodyRadiusMm(canvasWidthMm)` is the one place a
canvas's mm width is turned into a real body radius for the 3D preview. Before this milestone it
anchored a **180-degree** arc to `canvasWidthMm` (`radius = canvasWidthMm / PI`) — a preview-sizing
choice, not a claim about where the design actually sits on the object. Given that anchor, the
*canvas's own left and right edges land on opposite sides of the object* (90 degrees to either side
of dead-center front, joined by an undesigned 180-degree gap around the back) — which makes it
structurally impossible for the canvas to "wrap continuously across its own left/right edges"
(requirement 3): those two edges are not adjacent points on the object at all under a 180-degree
reference.

**Decision:** re-anchor the reference to a full **360-degree** revolution
(`radius = canvasWidthMm / (2*PI)`), so the production canvas *is* the object's complete unwrapped
surface — canvas x=0 and x=canvasWidthMm are the *same physical point* (the seam directly opposite
the front), and the whole canvas wraps exactly once around the object with no gap. This is a
preview-body-sizing change only (never a stone position — `GeometryEngine`/`StoneLayout` are
untouched); it also happens to produce a more realistic previewed object size (e.g. a 210mm-canvas
mug now previews at ~66.9mm diameter instead of ~133.7mm — closer to a real 11oz mug's ~80mm). Under
this reference, `circumferenceMm(canvasWidthMm)` is, by construction, exactly `canvasWidthMm` — the
new `printableCircumferenceMm()` in `app.js` reuses this via `ObjectDimensions.js`'s
`circumferenceMm()`, not a new/duplicated computation.

**2. Relationship between printable circumference and wrap modes.**
Before this milestone, `WRAP_ANGLE_DEG`/`applyAzimuthUv()` (`ObjectGeometryBuilder.js`) compressed
or stretched the *entire* canvas into whichever angular window the selected wrap mode specified
(70/115/180/300 degrees) — a fixed, content-independent, non-mm-accurate "zoom" of the whole design
onto the mesh, with everything outside that window clamped to plain background (clipped/hidden).
This is exactly the behavior requirement 4 ("never clip, crop or hide the production layout") rules
out, and it is also what made "does text fit" wrap-*dependent* in the old Part 2 logic even though
Part 2's own audit had already found (and this milestone re-confirms) that no shipped
`ObjectTemplate` actually makes fit wrap-dependent. **Decision:** decouple wrap mode from the object
mesh's texture entirely — `applyAzimuthUv()` now maps the canvas mm-accurately and continuously
around the full circumference regardless of wrap mode (see `canvasXMmForAzimuthRad()` below); wrap
mode's only remaining job is sizing the **Front View Frame's width**
(`frontViewFrameWidthMm(wrapMode, canvasWidthMm) = wrapAngleRad(wrapMode) * bodyRadiusMm`, an arc
length) — a 2D-canvas viewing-window highlight, never a clip. Printable circumference itself is
therefore wrap-mode independent, confirmed by `tools/test-object-dimensions.mjs` check 11 (object
size, and by extension circumference, is wrap-invariant) and reflected in the new too-long check
below.

**3. Relationship between Object Preview rotation and production coordinates.**
`Preview3DRenderer.js`'s camera azimuth (`_azimuthDeg`, degrees, front = 0) already uses the same
`atan2(x,z)`-based spherical convention the mesh's own UV azimuth uses (`applyAzimuthUv()`) — so the
mesh point currently facing the camera is, by construction, the point whose azimuth equals the
camera's azimuth. Combined with the new mm-accurate `canvasXMmForAzimuthRad(azimuthRad,
canvasWidthMm)` mapping (`ObjectDimensions.js`), this gives an exact, invertible relationship between
`rotation` (the existing `-180..180` slider/state variable) and a canvas-x mm position — no new 3D
math was needed, only two small pure functions (`canvasXMmForRotationDeg()`/
`rotationDegForCanvasXMm()`) built on the existing radius/azimuth primitives.

**4. Whether the existing rotation logic already exposes everything required.**
Mostly, but not entirely. `Preview3DRenderer.setAzimuthDeg()`/`syncView()` already let external code
*push* a rotation value into the camera — sufficient for "dragging the frame rotates the preview."
But nothing previously let external code *read back* the camera's azimuth after a free mouse/touch
orbit (`syncView()` only ever compared against its own last-pushed value) — necessary for "rotating
the Object Preview moves the frame." This is the one genuinely new piece of 3D-side logic this
milestone adds: `Preview3DRenderer._currentAzimuthDeg()` (reads azimuth back from the camera's actual
position, via the same `THREE.Spherical` conversion `_repositionCamera()` already uses in the write
direction) plus an `OrbitControls` `'change'` listener (`_onControlsChange()`) that fires an
`onAzimuthChange` callback only when the azimuth actually changed due to user interaction (comparing
against `_azimuthDeg`, which our own writes always update *before* touching the camera — so our own
writes never re-trigger the callback; no feedback loop).

**5. Whether existing safe-area guides can be reused.**
The safe-area guide (`drawSafeAreaGuide()`, `getSafeAreaRectMm()`) is an orthogonal concept — a fixed
rectangle marking vertical/general print-safety margins on the flat canvas — and is left completely
unchanged, still driving the pre-existing S-104 positional "outside the printable area" warning. The
Front View Frame is a new, additional, visually distinct overlay (solid amber band vs. the safe
area's dashed blue outline); it does not reuse or replace the safe-area guide, and both can be shown
at once without conflict.

### Architectural decisions

* **One new geometry module addition, zero duplication:** all new mm<->azimuth/circumference/frame-
  width math lives in `src/preview3d/ObjectDimensions.js` (already "pure millimeter-scale geometry
  math," per its own header) as small, named, individually-tested pure functions
  (`circumferenceMm`, `azimuthRadForCanvasXMm`, `canvasXMmForAzimuthRad`, `canvasXMmForRotationDeg`,
  `rotationDegForCanvasXMm`, `frontViewFrameWidthMm`). Both `ObjectGeometryBuilder.js`'s mesh UV
  mapping and `app.js`'s Front View Frame drawing/drag/hit-test import and reuse these exact
  functions — the 2D canvas and the Object Preview cannot disagree about "which part of the design
  faces the viewer" because they compute it with the same code, not parallel implementations.
* **The Front View Frame overlay lives in `app.js`, not `CanvasRenderer2D.js`:** matching this
  codebase's existing convention that layer-aware/editor-only overlays (`drawSelection()`,
  `drawGuides()`, `drawSafeAreaGuide()`) are app.js-local, never added to the permanent renderer
  (`CanvasRenderer2D.js`'s own header: "Layer-aware editor affordances... are not part of this
  module — they belong to the application"). `src/renderer/**` is therefore untouched by this
  milestone.
* **`wrap` project field is preserved, its meaning narrows:** previously it changed how much of the
  canvas the 3D mesh's texture showed (a clip/compression window); now it only sizes the Front View
  Frame's highlighted width on the 2D canvas. The field, its four values, and its UI control are all
  unchanged — only what it visually controls changed, and only because the old behavior (clipping
  the production layout per wrap mode) is exactly what requirement 4 prohibits.
* **Long-text detection reuses `getLayerBBox()`, no new per-layer bookkeeping map:** Part 2's
  `autoFitFloorAppliedByLayerId` transient map is deleted outright. The new `isTextTooLongForObject()`
  compares `getLayerBBox(l).width` (already the single source of truth for a layer's rendered mm
  extent, driving selection bounds, alignment/snap, and the existing S-104 positional warning) against
  `printableCircumferenceMm()`. This can never disagree with what was actually generated, because it
  reads the same `StoneLayout` every other consumer reads — no second bookkeeping channel.
* **Part 1 (the legibility floor, `computeAutoFitScale()`/`MIN_AUTOFIT_HEIGHT_TO_SPACING_RATIO`) is
  untouched.** It still prevents illegible over-shrinking; only Part 2's *consequence* of the floor
  (a `maxWidth`-based failure warning) is replaced. `computeAutoFitScale()`'s now-unused
  `floorApplied` return field is removed (nothing reads it anymore) — the shrink-clamping arithmetic
  itself is byte-identical.
* **Frame-drag and live-orbit sync never call `engine.generate()`/`updateAll()`:** rotation changes
  never alter the generated `StoneLayout`, so both live-sync paths (dragging the frame; free-orbiting
  the Object Preview) only reposition the camera (`preview3D.syncView()`/`setAzimuthDeg()`), redraw
  the already-computed 2D canvas (`drawLayout()`), and refresh the lightweight stats/view-button DOM
  (`updateStats()`/`updateViewButtons()`) — kept deliberately cheap so sync stays immediate and smooth
  even on every pointermove/animation-frame tick, per requirement 2's "immediate and smooth."

### Implementation Summary

* **`src/preview3d/ObjectDimensions.js`** — `REFERENCE_WRAP_ANGLE_DEG` changed from 180 to 360 (see
  audit finding 1); new exports `circumferenceMm()`, `azimuthRadForCanvasXMm()`,
  `canvasXMmForAzimuthRad()`, `canvasXMmForRotationDeg()`, `rotationDegForCanvasXMm()`,
  `frontViewFrameWidthMm()`.
* **`src/preview3d/ObjectGeometryBuilder.js`** — `applyAzimuthUv()` rewritten to use
  `canvasXMmForAzimuthRad()`/`canvasWidthMm` (mm-accurate, wrap-mode independent) instead of the old
  per-wrap-mode angular window; called once at mesh-build time inside `buildObjectMesh()` instead of
  being re-invoked on every wrap-mode change. `applyWrapUv()` (the old per-wrap-mode entry point) is
  removed — nothing calls it anymore.
* **`src/preview3d/Preview3DRenderer.js`** — `update()` no longer accepts/uses a `wrap` option (texture
  UV no longer depends on it); new `onAzimuthChange` callback property, `_currentAzimuthDeg()`, and an
  `OrbitControls` `'change'` listener (`_onControlsChange()`) that fires it only for genuine
  user-driven orbits (see audit finding 4).
* **`src/preview3d/index.js`** — the `createPreview3D()` facade forwards `onAzimuthChange` assignment
  to the real renderer once mounted (queuing it, same pattern as `pendingUpdate`/`pendingView`, if set
  before the async mount completes).
* **`app.js`** — new import of the `ObjectDimensions.js` geometry helpers (direct import, not through
  `src/preview3d/index.js`'s Three.js-lazy-loading barrel, since these are pure DOM/Project-free
  functions); `printableCircumferenceMm()`, `isTextTooLongForObject()` (redefined),
  `textTooLongDetailMessage()` (replaces `textTooLongActionMessage()`/`recommendedWrapModeForFit()`,
  both deleted); `frontViewFrameGeometry()`/`drawFrontViewFrame()`/`isPointerOnFrontViewFrame()` (new,
  mirroring the existing `drawSafeAreaGuide()` pattern); a new `drag.kind==='frontFrame'` branch in the
  existing `pointerdown`/`pointermove` handlers; `preview3D.onAzimuthChange` wiring; `updateStats()`
  extended to show Front View width, printable circumference, and viewing position (requirement 6).
  `autoFitFloorAppliedByLayerId` deleted.
* **`index.html`** — the too-long warning's headline copy (Inspector panel and Text Lightbox) changed
  from "This text is too long to fit legibly on this object." to "This text exceeds the object's
  printable circumference." (accurately describing the new, real manufacturing-limit check); one added
  hint sentence pointing at the Front View Frame/rotation as the way to inspect long text. No new
  markup, no new CSS — same elements, same `.validation-message`/`.hint` styling.

No change to `src/geometry/GeometryEngine.js`, `src/geometry/StoneLayout.js`, any exporter
(`src/export/**`), `src/renderer/**`, the project/layer schema, or `src/products/**`. No second layout
pipeline. No multi-row text. `GeometryEngine`/`StoneLayout` remain the one source of truth every
consumer (2D canvas, Object Preview, exporters) reads — this milestone adds a new *viewing* concept on
top of that single `StoneLayout`, never a second one.

### Files Changed

**New (0):** none — this milestone extends existing modules rather than adding new ones (the Front
View Frame's drawing/interaction code lives inside the already-existing `app.js`, per the
"editor overlays are app.js-local" convention above).

**Modified:**
```
src/preview3d/ObjectDimensions.js       — 360-degree reference; circumferenceMm/azimuth<->canvasX/
                                           frontViewFrameWidthMm
src/preview3d/ObjectGeometryBuilder.js  — mm-accurate, wrap-independent applyAzimuthUv();
                                           applyWrapUv() removed
src/preview3d/Preview3DRenderer.js      — onAzimuthChange, _currentAzimuthDeg(), OrbitControls
                                           'change' listener; update() no longer takes `wrap`
src/preview3d/index.js                  — forwards onAzimuthChange to the real renderer
app.js                                  — Front View Frame draw/drag/hit-test/live-sync; new
                                           circumference-based isTextTooLongForObject(); removed
                                           autoFitFloorAppliedByLayerId/recommendedWrapModeForFit()/
                                           textTooLongActionMessage()
index.html                              — too-long warning copy updated (both surfaces); one hint
                                           sentence added
docs/specifications/S-107-LongTextReadability.md — this Part 3
TASK.md                                 — retitled/updated for this milestone
tools/test-object-dimensions.mjs        — 360-degree reference; new exports covered
tools/test-object-geometry-builder.mjs  — wrap-independent UV mapping covered
tools/test-s107-long-text-readability.mjs — rewritten for the Front View Frame workflow
tools/test-app-module-migration.mjs     — allowlists app.js's new ObjectDimensions.js import
tools/test-shape-geometry-integration.mjs — same allowlist addition (independent milestone guard)
```

**Test-suite scoping fix (17 files):** `tools/test-s104-*.mjs`, `tools/test-s105-*.mjs`,
`tools/test-s106-*.mjs`, and 14 other prior-milestone test files each carried a `git status
--porcelain`-based "forbidden files" guard whose list included `src/preview3d/` (and, separately,
`src/renderer/`) as permanently off-limits — a one-time "did this milestone stay in its own lane"
snapshot check from when each was written, not a standing architectural rule. Since this milestone has
an explicit, audited, legitimate reason to touch `src/preview3d/**` (bidirectional rotation sync is
only possible there), the stale `'src/preview3d/'` entry was removed from each list (mechanical,
one-line-per-file). `src/renderer/**` remains untouched by this milestone and so still appears,
correctly, in every one of those forbidden lists.

### Test Results

```bash
$ npm test
```

All 71 test files in the `test` script pass, **904 checks total, 0 failures** (up from 892 in the
prior commit — this milestone rewrote `tools/test-s107-long-text-readability.mjs` and extended
`tools/test-object-dimensions.mjs`/`tools/test-object-geometry-builder.mjs`; no test file count
change beyond that, since this milestone adds no new module files).

`tools/test-s107-long-text-readability.mjs` (26/26): structural checks that the old Part-2 workflow
(`autoFitFloorAppliedByLayerId`/`floorApplied`/`recommendedWrapModeForFit`/`textTooLongActionMessage`)
is fully removed; `isTextTooLongForObject()` is driven by `getLayerBBox()` vs.
`printableCircumferenceMm()`; the too-long message describes a real manufacturing limitation and never
blames wrap mode; the frame is wired into `drawLayout()`, reuses the shared `ObjectDimensions.js`
mapping, wraps continuously via canvas-x modulo, is visually distinct from the safe-area guide, and
shows its width in mm; frame-drag and live-orbit sync never call `updateAll()`; `Preview3DRenderer.js`
exposes live azimuth via an `OrbitControls` `'change'` listener and no longer takes `wrap`;
`ObjectGeometryBuilder.js`'s UV mapping is wrap-independent. Behavioral checks (Part 1's
`computeAutoFitScale()`, unchanged; the actual circumference/frame/rotation math via
`ObjectDimensions.js`) confirm: a mug's 210mm circumference genuinely cannot fit the reported
67-character phrase (529.6mm at the legibility floor) — a real limit, not a viewing-window artifact;
the same phrase fits a hypothetically wide-enough object; medium text never triggers the warning on
any real object; the frame's own angular hit-test is self-consistent for every wrap mode; frame-drag
and Object-Preview-rotation are exact mathematical inverses of each other (drift-free bidirectional
sync).

`tools/test-object-dimensions.mjs` (18/18, was 11): the 360-degree radius reference; `circumferenceMm`
equals `canvasWidthMm` exactly; `canvasXMmForAzimuthRad`/`azimuthRadForCanvasXMm` are exact inverses;
canvas x=0 and x=canvasWidthMm map to the same +-PI seam (the requirement-3 seamless-wrap property,
tested directly); `canvasXMmForRotationDeg`/`rotationDegForCanvasXMm` round-trip; `frontViewFrameWidthMm`
orders correctly by wrap mode and scales linearly with canvas width.

`tools/test-object-geometry-builder.mjs` (12/12, was 12): front azimuth still maps to u=0.5 (now
wrap-mode independent, single check instead of a four-mode loop); new check 8 verifies the *entire*
mesh's UV, vertex by vertex, matches `canvasXMmForAzimuthRad(azimuth, canvasWidthMm)/canvasWidthMm`
exactly — mm-accurate, not merely "looks reasonable."

Two additional test files needed a small allowlist update (`tools/test-app-module-migration.mjs`,
`tools/test-shape-geometry-integration.mjs` — each independently enumerates app.js's allowed import
list) to permit the new `./src/preview3d/ObjectDimensions.js` import; and the 17-file forbidden-path
scoping fix described in "Files Changed" above.

### Browser Verification

Headless Chromium (Playwright, this repo's local `node_modules`), `python3 -m http.server 5173`
serving the actual app (no mocks), 1600×1000 viewport. 22/22 automated checks passed; representative
screenshots captured for all combinations.

1. **Short ("Hi"), medium ("Vitalina Serbin"), and long (67-character phrase) text × Mug, Straight
   Tumbler, and Bottle (9 combinations)** — every combination renders with zero console errors; the
   too-long warning fires only for the long phrase (on all three objects — 529.6mm exceeds even the
   widest real canvas here, 230mm on the tumbler); short/medium never warn. Front View width and
   printable circumference are shown per object (mug: 40.8mm frame / 210.0mm circumference; tumbler:
   115.0mm / 230.0mm; bottle: 57.5mm / 180.0mm — matching each object's own `wrap.default` and canvas
   size).
2. **Dragging the Front View Frame rotates the Object Preview** — verified on the tumbler with the
   long phrase: a 150px rightward drag on an empty part of the 2D canvas inside the frame band moved
   `rotation` from 0° to -65°, with the Object Preview's displayed text and the frame's on-canvas
   position updating together, live, every pointermove tick (no full layout regeneration).
3. **Rotating the Object Preview moves the Front View Frame** — a mouse-orbit drag directly on the
   `#cup` canvas (OrbitControls) moved `rotation` from 0° to -103°/-104° across two independent runs,
   with the 2D canvas's frame and "viewing position" stat following live.
4. **Frame wraps correctly across the canvas edges** — at `wrap=full` (175mm frame on a 210mm mug
   canvas) and `rotation=175°`, the frame visibly splits into two on-canvas segments (left and right
   edges of the canvas), reading "Vitalina" on one segment and "Serbin" on the other with no gap
   between them — and the Object Preview, at the same rotation, shows the mug's own texture seam
   split at exactly the same point (the design's left/right ends meeting at the back). Confirms the 2D
   canvas and Object Preview are showing the literal same wrapped view, not just numerically agreeing.
5. **Frame width is displayed in millimeters** — "Front View · N mm" label on the frame itself, plus
   "Front View width: N mm" / "printable circumference: N mm" / "viewing position: N°" in the
   workspace status bar (requirement 6), live-updated during both drag and free-orbit sync (fixed
   during verification: the first pass found the stats bar going stale mid-drag because the two new
   cheap-sync code paths omitted `updateStats()`; both now call it).
6. **Long text can be inspected by moving the Front View Frame or rotating the Object Preview** —
   demonstrated directly by (2)/(3)/(4) above: the 67-character phrase, which does not fit inside any
   single wrap mode's frame width, remains fully generated and visible in the 2D canvas at all times
   (never clipped), and every portion of it becomes the Object Preview's front-facing view as the
   frame/rotation moves.
7. **Warning appears only when the printable circumference is genuinely exceeded** — the long phrase
   on the mug: "This design is 529.6mm wide -- 319.6mm more than the mug's 210.0mm printable
   circumference, so it would overlap itself once wrapped fully around the object. Try: shortening the
   text, reducing the stone size, or choosing a wider object." — states actual numbers, never mentions
   wrap mode or viewing angle as the cause (verified both by an automated string check and by reading
   the rendered copy directly).
8. **2D Canvas and Object Preview always remain synchronized** — cycling the Left/Right/Back/Front
   view buttons produced no errors and the frame followed each button's rotation.
9. **Zero console errors** across every scenario above (9 object/text combinations, frame-drag,
   free-orbit, wrap-mode/rotation edge cases, view-button cycling).

### Recommendation (Part 3)

Approve. The Front View Frame replaces a warning that measured the wrong thing (a single viewing
window's width) with a workflow that treats the object as what it physically is — a wrapped
cylindrical surface — and a warning that measures the right thing (the object's real printable
circumference, reusing the exact same geometry the 3D preview's own texture mapping uses, so the two
views can never disagree). No second `GeometryEngine`/`StoneLayout`/rendering pipeline was introduced;
the one required 3D-preview-sizing change (180-degree to 360-degree radius reference) is preview-only
and does not touch any stone position; and the Front View Frame's drag/live-orbit sync paths are
deliberately cheap (no layout regeneration) so requirement 2's "immediate and smooth" holds under
real, verified mouse interaction in both directions.

---

## Part 4 — manual visual review: wrap-mode regression and dark texture bands

Manual visual review of Part 3 found three issues: (1) the wrap mode controls (Front/Wide/Half/Full)
no longer visibly did anything to the Object Preview -- a regression; (2) dark vertical bands
appeared on the Object Preview between words, which were not shadows; (3) the Front View Frame
concept itself was confirmed as the right direction and kept, but needed to genuinely represent the
selected wrap mode rather than a wrap-independent model.

### Audit

**Issue 1 (wrap mode controls).** `#wrap` (the wrap-mode `<select>`, in the Shapes lightbox's Object
Templates tab) was never removed from `index.html` -- confirmed unchanged at that exact location
since before Part 3 (`git show <pre-S-107 commit>:index.html`). The regression was behavioral, not
markup: Part 3's `ObjectGeometryBuilder.js`/`Preview3DRenderer.js` changes made the object mesh's
texture UV mapping wrap-mode *independent* (the complete canvas always wrapped the same way around
the full 360-degree circumference, regardless of `wrap`), so changing the control produced no visible
change on the Object Preview at all -- confirmed empirically: four wrap-mode screenshots taken with
the Shapes lightbox open were pixel-for-pixel identical on the visible sliver of the Object Preview
in each.

**Issue 2 (dark vertical bands).** Root-caused with a pure Node.js script (no browser needed) that
walks every triangle of the built mesh and flags any triangle whose three vertices' U coordinates
span more than a small, expected per-segment step. Found two independent, real defects in
`ObjectGeometryBuilder.js`'s `applyAzimuthUv()`, both stemming from deriving each vertex's azimuth
from `Math.atan2(x, z)` on its own position:

1. **`atan2`'s branch cut.** `atan2` only ever returns a value in `(-PI, PI]`. `LatheGeometry`
   connects every column to its neighbor with a real face all the way around (48 faces from 49
   columns for `LATHE_SEGMENTS=48`) -- one of those columns necessarily sits right at that `+-PI`
   branch cut, so its face's three vertices got azimuths like `+PI` and `-PI+epsilon`: a ~2*PI swing
   within one real, connected triangle. That triangle's texture sample was stretched across nearly
   the whole canvas width, reading as a smeared dark band (the texture is mostly dark background
   between the sparse gold stones, so a heavily-compressed sample of it reads as a dark streak, not a
   shadow). Confirmed visually: at `rotation=180` (the "Back" view), a clear dark vertical seam split
   the design in two.
2. **The base/cap apex's signed-zero quirk.** At `r=0` (the mug/tumbler base and the bottle's own
   apex points), `x=z=0` for every column. IEEE 754 distinguishes `+0`/`-0`, and
   `Math.atan2(+-0, +-0)` is defined per-quadrant by that sign -- which flips essentially arbitrarily
   from column to column (driven by the sign of `Math.sin`/`Math.cos` at each column's angle, not by
   anything physically meaningful at a truly degenerate point). Neighboring apex vertices at the
   *identical* physical position got wildly different azimuths, corrupting the base disk's UVs. Less
   visually prominent than #1 (the base is rarely a focal point of the camera) but a real, confirmed
   defect in the same function.

Both were confirmed with a script that builds the actual mesh via `buildObjectMesh()`/`applyWrapUv()`
and reports the exact vertex indices, positions, and U values of every offending triangle -- not
inferred from screenshots alone.

**Issue 3 (Front View Frame).** Confirmed the frame-drawing/drag/live-orbit-sync code
(`app.js`'s `frontViewFrameGeometry()`/`drawFrontViewFrame()`/`isPointerOnFrontViewFrame()`,
`Preview3DRenderer.js`'s `onAzimuthChange`) is independent of *how* the object mesh's texture is
mapped and did not need to change in kind -- only the mesh's own wrap-mode handling did (see below).

### Decision

**Restore wrap-mode-dependent windowing** (`applyWrapUv(bodyMesh, wrapMode)`, exported again from
`ObjectGeometryBuilder.js`, called from `Preview3DRenderer.update()` whenever `wrap` changes) --
compressing the complete production canvas into `wrapAngleRad(wrapMode)`'s angular window centered on
the front, exactly as before Part 3's wrap-independent experiment. This directly restores "changing
wrap mode changes the Object Preview" and makes the wrap-mode `<select>` meaningful again. The Front
View Frame is **not** a replacement for this -- it is drawn on the 2D canvas alongside it, using
`frontViewFrameWidthMm(wrap, canvasWidthMm)` (unchanged) to size itself to the same window, and
`canvasXMmForRotationDeg(rotation, canvasWidthMm)` (unchanged) to track the same `rotation` state the
Object Preview's camera uses -- so turning the wrap-mode dial changes both the frame's width and the
Object Preview's visible window together, and dragging the frame / free-orbiting the Object Preview
still adjust the same shared `rotation`, in both directions, exactly as Part 3 built.

One explicit, documented trade-off: the Front View Frame's own position/width math
(`ObjectDimensions.js`'s circumference-based, continuous 360-degree model) and the object mesh's
*compressed* wrap-window texture are two different mm-to-angle models, matching this codebase's
original (pre-S-107) architecture where wrap mode was always a preview-only "how much of the canvas
is squeezed into view" stylization, not a physically 1:1 mapping. The frame still correctly tracks
`rotation` and still correctly reflects wrap mode's *width*; it does not claim byte-exact parity with
every pixel the compressed decal shows, the same way it never did before Part 3. This was a deliberate
choice over a much larger change (recomputing the mesh's UV on every rotation tick, coupling rotation
sync to per-frame geometry updates) that was not needed to satisfy any stated requirement.

**Fix the root cause of the dark bands** by no longer deriving azimuth from `Math.atan2(position)` at
all. `applyAzimuthUv()` now computes each vertex's azimuth directly from its known Lathe column index
(`Math.floor(vertexIndex / rowCount)`) and the exact parametric angle `LatheGeometry` itself used to
place that column (`phiStart + column/LATHE_SEGMENTS * phiLength`) -- this is defined and continuous
for *every* vertex, including the `r=0` apex (sidestepping the signed-zero quirk entirely, since it
never reads `x`/`z`), and it is continuous across every real, connected face by construction (it is
literally the same linear function of column index that `LatheGeometry` used to place the columns in
the first place).

This still leaves exactly one unavoidable discontinuity (a full revolution cannot be mapped to a
bounded interval without one cut somewhere) -- but it can be *placed* deliberately. `LatheGeometry`
already has exactly one column pair (first/last) that is never joined by a face, at whatever direction
its own `phiStart` reference points. `buildTaperedBodyGeometry()`/`buildBottleGeometry()` now build
with `phiStart=-PI` (previously the THREE.js default, `0`) so that unconnected seam sits at the *back*
(azimuth `+-PI`) -- directly opposite the front the Object Preview's default camera and the Front View
Frame both center on, and exactly where the column-index azimuth formula's own wrap (column 0 to
column `LATHE_SEGMENTS`) falls. The one discontinuity and the one gap in mesh connectivity now
coincide, so no real face ever spans it, for any wrap mode or camera rotation -- verified analytically
(see Testing) and visually (rotated all the way around, all four wrap modes, including the previously
broken "Back" view).

### Testing

`tools/test-object-geometry-builder.mjs`:
* Checks 7/8 restored to their pre-Part-3 form (`applyWrapUv` exported and wrap-mode dependent, front
  azimuth maps to `u=0.5` for every wrap mode, a fixed side azimuth maps further from center under a
  narrower window).
* New check 8b: builds every object template at every wrap mode and asserts *every triangle* in the
  mesh has a small U span (`<0.3`) -- the actual regression guard for the dark-band defect, not an
  implementation-detail check.
* New check 8c: asserts every duplicate apex vertex (same `x=y=z=0` position) gets a U value close to
  its neighbors, never an implausible jump -- the regression guard for the signed-zero defect
  specifically.

`tools/test-s107-long-text-readability.mjs` checks 14/15 updated to assert the restored
`wrap`-dependent `Preview3DRenderer.update()`/`applyWrapUv()` behavior (inverting Part 3's
wrap-independence assertions); new checks 15b/15c assert `applyAzimuthUv()` no longer uses
`Math.atan2` and that both Lathe geometries build with `phiStart=-PI`.

`npm test`: 908/908 checks, 0 failures (up from 904; four new checks added, no checks removed).

### Browser Verification

Headless Chromium (Playwright), `python3 -m http.server 5173`, real app, no mocks:

* **Wrap select restored and reachable**: all 4 modes present in the Shapes lightbox's Object
  Templates tab.
* **Changing wrap mode changes the Front View Frame's width**: 40.8mm (front) / 67.1mm (wide) /
  105.0mm (half) / 175.0mm (full) on the default mug -- four distinct values.
* **Changing wrap mode changes the Object Preview**: screenshots of the `#cup` canvas differ (byte
  length alone already differs across all four modes; visually confirmed by direct inspection --
  "front" shows the whole "Vitalina Serbin" compressed into a narrow frontal band, "full" spreads it
  most of the way around the mug).
* **Dragging the Front View Frame still rotates the Object Preview**, and **rotating the Object
  Preview still moves the Front View Frame**, re-verified at `front`, `half`, and `full` wrap modes
  independently (rotation changed on every drag/orbit tried).
* **No dark bands, no duplicated texture, no seam artifacts**: visually inspected screenshots across
  a full rotation sweep (`0`, `90`, `180`, `-90` degrees) at `front`, `half`, and `full` wrap modes,
  including the previously-broken worst case (`full` wrap, rotation `180`, directly facing the old
  seam location) -- clean in every case. One unrelated, pre-existing, very subtle lighting
  highlight (not a texture defect -- present even where the texture shows pure background, and
  brighter, not darker) remains at the geometric seam from the duplicated Lathe vertex column; this
  is a normal/lighting artifact of the mesh, not a UV/texture bug, was not part of the reported
  symptom (which was specifically about texture pixels rendering where no stones exist), and was left
  unchanged.
* **Zero console errors** across every scenario above (wrap-mode cycling, orbit drags, frame drags,
  full rotation sweeps).

### Recommendation (Part 4)

Approve. Wrap mode's original, visible effect on the Object Preview is restored without discarding
the Front View Frame (both now coexist, each driven by the same `rotation`/`wrap` state). The dark
band defect is fixed at its actual root cause -- two independent, confirmed bugs in how per-vertex
azimuth was derived, not a workaround that merely repositions or shrinks the symptom -- verified both
analytically (a triangle-by-triangle UV continuity check, now a permanent regression test) and
visually (the previously-worst-case view, `full` wrap at the back, is now clean).

---

## Part 5 — wrap mode control was undiscoverable

A user reported being unable to find the Wrap Mode control anywhere in the UI. Audit: `#wrap` was
never removed -- it lived (unchanged since before this milestone) inside the Shapes lightbox's
"Object Templates" tab, two clicks behind a menu item ("Shapes") with no apparent connection to wrap
mode, the Object Preview, or the Front View Frame. A genuine discoverability defect, not a
regression this milestone introduced, but squarely this milestone's responsibility given how tightly
the Front View Frame now couples to wrap mode.

**Decision:** moved `#wrap` (same element/id/options/wiring, no behavior change) into the Object
Preview toolbar (`#toolbar3D`), directly beside the view buttons and Rotation slider -- visible
immediately in Dual Workspace or Object Preview view, no lightbox required. `tools/test-ui001-
lightboxes.mjs` check 4 updated (no longer expects `#wrap` inside Object Templates); new
`tools/test-s107-long-text-readability.mjs` check 1b locks in the control's presence inside
`#toolbar3D` and that it exists exactly once in the document, as a permanent regression guard.
`npm test`: 909/909. Browser-verified: `#wrap` visible on load with no interaction, selecting a mode
changes the Front View width and Object Preview live, no longer present anywhere in the Shapes
lightbox, zero console errors.
