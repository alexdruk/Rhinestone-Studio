# Rhinestone Studio — Task Result

This document is completed by the implementation engineer after finishing the current task.

---

# Task ID

S-107 — Long Text Readability (Part 1: legibility floor; Part 2 follow-up: failure-state detection)

---

# Status

IMPLEMENTED

---

# Branch

feature/s-107-long-text-readability

---

# Commit

Do not write the current commit hash into this file — this file is part of the same commit it
describes. Obtain it from Git history with:

```bash
git log -1 --oneline
```

---

# Audit Findings

Full detail in `docs/specifications/S-107-LongTextReadability.md`.

## Part 1 — why long text was illegible

Walked the complete text pipeline (measurement, scaling, spacing, wrap angle, projection):

* **Scaling** — `app.js`'s live auto-fit (`generateTextStonesLive()` /
  `resolveLayerShapeSource()`'s text branch) shrinks a too-wide text layer's `heightMm` with **no
  floor**, so the shrink factor grows without bound as text gets longer.
* **Spacing** — `spacingMm = stoneSizeMm + gapMm` is the fixed physical stone pitch. Auto-fit's
  scaling stage shrinks `heightMm` but **never touches `stoneSizeMm`/`gapMm`**. Root cause: as the
  shrink factor grows, glyph-to-stone-pitch ratio falls until stones can no longer trace the
  letterforms — the pattern reads as a blurred row of dots.
* **Wrap angle / projection** — fixed, content-independent; ruled out (would also change short/
  medium text, and curved-text projection is off by default).
* Verified in a real, unmocked browser: the same illegible pattern appears in **both** the 2D Canvas
  (at full zoom) and the Object Preview — the bug is in the one shared `StoneLayout`, not a 3D-only
  rendering defect.
* `stoneSizeMm` is a real catalog rhinestone diameter (`src/renderer/StoneSizes.js`, no smaller than
  2.0mm) — rescaling it would misrepresent what gets manufactured, so the fix never touches it.

## Part 2 (this follow-up) — why the Part 1 fix alone was not enough

Part 1's floor stops illegible over-shrinking, but very long text can still overflow `maxWidth`
once the floor wins. Browser-verified with the exact reported phrase on the default mug: the
generated text is 529.6mm wide against a 200mm `maxWidth`. The only warning that fired was the
pre-existing *positional* `isTextOutsidePrintableArea()` — its "Center Text" button visibly did
nothing, because no position (not even dead center) can fix a text that is structurally too wide.

Audited every candidate lever before choosing a fix:

* **Canvas width is the one hard bound** — `StoneLayoutTexture.js` rasterizes into a buffer sized
  exactly to `canvasWidthMm`; content outside those mm bounds is never drawn, in 2D or 3D.
* **Wrap mode does not affect this bound**, confirmed against `src/products/ObjectTemplate.js`
  (`getSafeAreaRectMm()` takes no wrap argument) and the existing `app.js` architecture comment
  ("anything within the flat canvas's mm bounds is always... visible... regardless of wrap mode"),
  and verified empirically across all four wrap modes on the reported phrase — the "too long"
  outcome never changed.
* **Object type** (mug/tumbler/bottle) does change canvas width (210/230/180mm) — a real "choose a
  wider object" remedy.
* **Stone size** changes the floor's own required `heightMm` — verified empirically ("Happy Birthday
  Sarah" is fine at SS6/2.0mm, too-long at SS10/2.8mm and SS16/4.0mm).

---

# Implementation Summary

## Part 1

* **`app.js`** — `MIN_AUTOFIT_HEIGHT_TO_SPACING_RATIO` (`=6`) and `computeAutoFitScale()`: clamps
  auto-fit's shrink to a floor (`heightMm` never below `6× spacingMm`). Text that never needed the
  floor is byte-identical to before.

## Part 2 (this follow-up)

* **`app.js`** — `computeAutoFitScale()` now also returns `floorApplied` (true exactly when the
  floor, not the pure fit-to-width shrink, decided the result) alongside the unchanged `scale` value
  — same math, richer return shape. `generateTextStonesLive()` records `floorApplied` per layer id
  into a new, transient, in-memory-only `autoFitFloorAppliedByLayerId` map (cleared at the top of
  every `generate()` call; never read by `validateProject()`, save/load, or any exporter — not part
  of the project/layer schema).
* **`isTextTooLongForObject(l)`** (new) reads that map — true exactly when this text layer's last
  generation needed the floor, meaning it structurally cannot fit `maxWidth` at any position.
* **`recommendedWrapModeForFit(l)`** (new) — a real, evaluated check for requirement 7 ("if a wider
  valid wrap mode can fit the text, recommend it"). Given the audited wrap-independence, it always
  returns `null` today (no tip shown, `project.wrap` never written); written as a real function (not
  skipped) so a future wrap-dependent ObjectTemplate would be picked up with no other code change.
* **`textTooLongActionMessage(l)`** (new) — "Try: shortening the text, reducing the stone size, or
  choosing a wider object." plus an optional wrap-mode tip (never fires today).
* **`updateTextOutsidePrintableWarning()`** (updated) — computes both `isTextTooLongForObject()` and
  the existing `isTextOutsidePrintableArea()`; the two are mutually exclusive, with the structural
  "too long" warning taking priority (so "Center Text" is never offered when it would not help).
* **`index.html`** — new `#workspaceTextTooLongWarning` (always-visible right Inspector panel, no
  Lightbox needed — requirement 6) and `#textTooLongWarning` (Text Lightbox, for consistency with
  the existing dual-surface pattern), both reusing the existing `.validation-message`/`.hint`
  styling verbatim — no new CSS.
* Not implemented: hiding/suppressing the rendered (clipped) stones — the fix for "silent" per
  requirement 3 is the new, unmissable warning, not removing the operator's visible work.

No change to `src/geometry/GeometryEngine.js`, `src/geometry/StoneLayout.js`, any exporter, any
renderer, `src/preview3d/**`, or the project/layer schema, in either part. No second layout pipeline.
No multi-row text.

---

# Files Changed

**New (2):**
```
docs/specifications/S-107-LongTextReadability.md
tools/test-s107-long-text-readability.mjs
```

**Modified (4):**
```
app.js                                             — MIN_AUTOFIT_HEIGHT_TO_SPACING_RATIO,
                                                     computeAutoFitScale() (+floorApplied),
                                                     autoFitFloorAppliedByLayerId,
                                                     isTextTooLongForObject(),
                                                     recommendedWrapModeForFit(),
                                                     textTooLongActionMessage(),
                                                     updateTextOutsidePrintableWarning() (updated)
index.html                                         — #workspaceTextTooLongWarning,
                                                     #textTooLongWarning + detail elements
package.json                                       — new test wired into the `test` script
tools/test-s104-text-position-recovery-drag-tuning.mjs — check 12 updated to match
                                                     updateTextOutsidePrintableWarning()'s new,
                                                     floor-gated logic (still driven by the exact
                                                     same isTextOutsidePrintableArea() result)
TASK.md                                            — this milestone's task definition
```

No changes to `GeometryEngine`, `StoneLayout`, any renderer (`src/renderer/**`,
`src/preview3d/**`), any exporter (`src/export/**`), the project/layer schema, `src/library/**`,
`src/gallery/**`, `src/editing/**`, or `src/ui/**`.

---

# Test Results

```bash
$ npm test
```

All 69 test files in the `test` script pass, **892 checks total, 0 failures**.

`tools/test-s107-long-text-readability.mjs` (21/21 passing) covers both parts: structural checks
(single `MIN_AUTOFIT_HEIGHT_TO_SPACING_RATIO` declaration; both auto-fit call sites use the shared
helper; `generateTextStonesLive()` records `floorApplied`; `generate()` clears the map; the map is
never referenced by `validateProject()`/`JSON.stringify`/either exporter; the new warning markup
exists in both the Inspector and Lightbox with the exact required wording and no forbidden-file
change) and behavioral checks (extracting and executing the real `computeAutoFitScale()`,
`isTextTooLongForObject()`, `recommendedWrapModeForFit()`, and `textTooLongActionMessage()` from the
live source, injecting a fake `autoFitFloorAppliedByLayerId` map for the latter three): auto-fit-off/
already-fits/mild-overflow all unchanged from before this milestone; severe overflow reports
`floorApplied:true` and sits exactly at the 6× floor; `isTextTooLongForObject()` is true only for the
exact layer id whose last generation needed the floor; `recommendedWrapModeForFit()` is always `null`
(matching the audited wrap-independence) and never assigns `project.wrap`; the action message lists
all three real remedies; `updateTextOutsidePrintableWarning()`'s mutual-exclusivity/priority logic is
wired correctly.

One pre-existing test needed updating (same pattern as prior milestones hitting an already-tested
function whose logic legitimately evolved): `tools/test-s104-text-position-recovery-drag-tuning.mjs`
check 12 asserted `updateTextOutsidePrintableWarning()`'s exact body text; updated to match its new
(still `isTextOutsidePrintableArea()`-driven, now floor-gated) form.

---

# Browser Verification

Headless Chromium (Playwright, this repo's local `node_modules`), `python3 -m http.server 5173`
serving the actual app (no mocks), 1800×950 viewport.

## Part 1

1. Short text ("Hi") — 69 stones, 29.2×18.6mm, legible and unchanged on mug/tumbler/bottle.
2. Medium text ("Vitalina Serbin") — 375 stones, 199.4×17.0mm, unchanged, clearly readable.
3. Very long text (67-character phrase) — before: `heightMm≈6.4` (ratio ≈2.8), illegible dot row in
   both 2D and 3D on all three object types; after: floor-clamped to `heightMm≈13.9` (ratio 6.0),
   individual words legible.
4. No distortion (uniform scale only); no new console/page errors (one pre-existing, unrelated WebGL
   driver warning confirmed present on unmodified `develop` too).

## Part 2 (this follow-up)

1. **The exact reported phrase, mug, `front` wrap** — now shows "This text is too long to fit
   legibly on this object." with "Try: shortening the text, reducing the stone size, or choosing a
   wider object." in both the persistent Inspector panel and the Text Lightbox; the old "outside the
   printable area" / "Center Text" warning is suppressed, not shown alongside it.
2. **Short/medium text, mug** — no warning at all, `layoutStats` identical to Part 1's own
   verification (69 stones/29.2×18.6mm; 375 stones/199.4×17.0mm).
3. **Mug, tumbler, bottle** — the reported phrase triggers the identical warning on all three
   (738 stones, 529.6×13.9mm on every object).
4. **All four wrap modes** (`front`/`wide`/`half`/`full`) on the mug, same phrase — warning state
   identical across every mode, confirming the audited wrap-independence directly rather than by
   inspection alone.
5. **Several stone sizes** — "Happy Birthday Sarah": no warning at SS6 (2.0mm, 200.5mm wide);
   too-long at SS10 (2.8mm, 223.6mm) and SS16 (4.0mm, 301.3mm) — "reduce the stone size" is a
   verified-working remedy, not just suggested text. A shortened version of the reported phrase
   ("Special thanks, love you") also clears the warning (201.1mm, fits).
6. **No misleading "successful" preview without feedback** — every case that cannot fit shows the
   warning; every case that fits shows none.
7. **2D and 3D stay consistent** — both panels and the Inspector always agree, since all three are
   driven by the one shared `layout`/bbox.

**Sample before/after screenshots (Part 1):** published as an artifact —
https://claude.ai/code/artifact/ba39444f-8593-4c85-88da-675646ff9273

---

# Recommendation

Approve both parts. Part 1 fixes the actual root cause (scaling/spacing decoupling in auto-fit)
inside the one shared pipeline; Part 2 replaces a silent, misleadingly-recoverable overflow with a
clear, persistent, non-Lightbox warning whose suggested remedies are all verified to actually work,
built entirely from Part 1's own unmodified floor decision (no second threshold, no new geometry, no
GeometryEngine/StoneLayout/exporter/schema change, no second layout pipeline, no multi-row text).
