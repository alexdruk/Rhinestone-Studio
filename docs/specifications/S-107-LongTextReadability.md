# S-107 — Long Text Readability

## Task ID

S-107

## Type

Readability/quality fix. No new production features, no second layout pipeline, no
GeometryEngine/StoneLayout/project-schema/exporter changes, no multi-row text.

## Status

IMPLEMENTED

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
