# Rhinestone Studio — Task Result

This document is completed by the implementation engineer after finishing the current task.

---

# Task ID

S-107 — Long Text Readability

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

Full detail in `docs/specifications/S-107-LongTextReadability.md`. Walked the complete text
pipeline the specification asks for:

* **Measurement** (`GeometryEngine._buildPositionedContours()`) — correct, shared by every
  consumer, no issue.
* **Scaling** — `app.js`'s live auto-fit (`generateTextStonesLive()` /
  `resolveLayerShapeSource()`'s text branch) shrinks a too-wide text layer's `heightMm` with **no
  floor**, so the shrink factor grows without bound as text gets longer.
* **Spacing** — `spacingMm = stoneSizeMm + gapMm` is the fixed physical stone pitch. Auto-fit's
  scaling stage shrinks `heightMm` but **never touches `stoneSizeMm`/`gapMm`**. This is the root
  cause: as the shrink factor grows, the ratio of glyph size to stone pitch falls until stones can
  no longer trace the letterforms — the pattern reads as a blurred row of dots rather than text.
* **Wrap angle** (`ObjectDimensions.WRAP_ANGLE_DEG`) — a fixed angular window, independent of text
  length/content. Ruled out as the length-dependent cause (a fix here would also change short/
  medium text, which must stay unchanged).
* **Projection** (`ArcProjection`) — only active for curved text (off by default); not implicated.

**Root cause:** scaling/spacing decoupling in auto-fit (`app.js`), not a 3D-only rendering defect.
Verified directly in a real, unmocked browser: a 67-character phrase reproduced the reported
symptom in **both** the 2D Canvas (at full single-panel zoom, not just the small dual-workspace
panel) and the Object Preview — because both draw the exact same `StoneLayout`
(`docs/ARCHITECTURE.md`'s single-source-of-truth principle). The Object Preview's curved-surface
projection and per-stone lighting do further reduce contrast on an already-marginal pattern
(consistent with the reported symptom being most noticeable there), but the pattern itself is
generated once, upstream, in the one shared pipeline — which is where the fix belongs, per
requirement 4/5 ("no second layout pipeline", "keep one GeometryEngine and one StoneLayout
pipeline").

**Why stone size itself cannot shrink:** `stoneSizeMm` is a real catalog rhinestone diameter
(`src/renderer/StoneSizes.js`: SS6/SS10/SS16/SS20/SS30, no smaller than 2.0mm). Silently rescaling
it during auto-fit would produce a non-orderable size — the opposite of "preserving production
accuracy." The fix never touches it.

---

# Implementation Summary

* **`app.js`** — new `MIN_AUTOFIT_HEIGHT_TO_SPACING_RATIO` constant (`= 6`, chosen empirically —
  see below) and `computeAutoFitScale(layer, project, measuredWidthMm)` helper, placed beside the
  existing `computeTextPlacementOffset()` (which already keeps two call sites in sync "by
  construction instead of by duplicated arithmetic" — the same pattern this fix now applies to the
  auto-fit scale decision). Both `generateTextStonesLive()` and `resolveLayerShapeSource()`'s text
  branch now call this one helper instead of separately duplicating the same inline
  `maxWidth`/`scale` arithmetic.
* The scale returned is `min(1, max(fitScale, minScale))`, where `fitScale` is the pre-existing
  fit-to-width scale and `minScale` keeps `heightMm` at least `6×` the stone pitch. Whenever
  `fitScale >= minScale` (every case that doesn't need the floor), the result is **exactly** the old
  scale — byte-identical behavior. Only text long enough to need more shrinking than the floor
  allows now gets a larger (less aggressive) scale, overflowing `maxWidth` and surfacing the
  pre-existing "outside the printable area" / "Center Text" warning (S-104) instead of collapsing
  into illegible stone soup.
* `MIN_AUTOFIT_HEIGHT_TO_SPACING_RATIO = 6` was chosen empirically: with auto-fit disabled and
  `heightMm` swept manually for representative phrases, `heightMm/spacingMm ≈ 3` (the original,
  unmodified bug) read as a blurred dot row, `≈4` was marginal, `≈6` read clearly and consistently
  across mug/tumbler/bottle.
* No change to `src/geometry/GeometryEngine.js`, `src/geometry/StoneLayout.js`, any exporter
  (`src/export/**`), any renderer, `src/preview3d/**`, or the project/layer schema. Existing project
  files remain fully compatible. No multi-row text.

---

# Files Changed

**New (2):**
```
docs/specifications/S-107-LongTextReadability.md
tools/test-s107-long-text-readability.mjs
```

**Modified (3):**
```
app.js       — new MIN_AUTOFIT_HEIGHT_TO_SPACING_RATIO + computeAutoFitScale(), wired into both
               existing auto-fit call sites (generateTextStonesLive(), resolveLayerShapeSource())
package.json — new test wired into the `test` script
TASK.md      — this milestone's task definition
```

No changes to `GeometryEngine`, `StoneLayout`, any renderer (`src/renderer/**`,
`src/preview3d/**`), any exporter (`src/export/**`), the project/layer schema, `src/library/**`,
`src/gallery/**`, `src/editing/**`, or `src/ui/**`.

---

# Test Results

```bash
$ npm test
```

All 69 test files in the `test` script pass, **881 checks total, 0 failures**.

New `tools/test-s107-long-text-readability.mjs` (10/10 passing) covers:

* Structural: exactly one `MIN_AUTOFIT_HEIGHT_TO_SPACING_RATIO` declaration; both
  `generateTextStonesLive()` and `resolveLayerShapeSource()`'s text branch call the shared
  `computeAutoFitScale()` helper and no longer contain the old duplicated inline `maxWidth`
  computation; no forbidden file changed (`src/geometry/**`, `src/export/**`); the new suite is
  registered in `package.json`.
* Behavioral (extracts and executes the real `computeAutoFitScale()` from the live `app.js`
  source, mirroring `tools/test-alignment-snapping-integration.mjs`'s `extractFunction()`/
  `new Function()` precedent): auto-fit off never rescales; text that already fits is never
  rescaled; mild overflow gets the exact pre-existing fit-to-width scale (unchanged behavior);
  severe overflow clamps to the 6× floor instead of the old, more-aggressive shrink; the floor
  never scales height up past the original nominal height.

---

# Browser Verification

Headless Chromium (Playwright, this repo's local `node_modules`), `python3 -m http.server 5173`
serving the actual app (no mocks), 1800×950 viewport.

1. **Short text ("Hi"), mug/tumbler/bottle.** 69 stones, 29.2×18.6mm. Clearly legible before and
   after on every object type — auto-fit never engages (text far under `maxWidth`). Pixel-identical
   stone data before/after (confirmed via the same `computeAutoFitScale` returning `1` in both
   cases).
2. **Medium text ("Vitalina Serbin", the project default), mug.** 375 stones, 199.4×17.0mm,
   identical before/after (`fitScale` at this length, ~0.85 on a narrower bottle canvas, never
   drops below the ~0.55 floor) — clearly readable in 2D and 3D, before and after.
3. **Very long text (67-character phrase), mug/tumbler/bottle.** Before: auto-fit shrinks to
   `heightMm≈6.4` (ratio ≈2.8) — renders as an illegible row of dots in **both** the 2D Canvas
   (confirmed at full single-panel zoom, not just the small dual-workspace panel) and the Object
   Preview, on all three object types. After: shrinks only to the floor (`heightMm≈13.9`, ratio
   6.0) — individual words are legible ("...love for all the help sh...") in the 2D Canvas and on
   the mug, tumbler, and bottle's Object Preview alike. The text now exceeds `maxWidth`, correctly
   surfacing the pre-existing "This text is outside the printable area" / "Center Text" warning
   rather than silently shipping unreadable output.
4. **No distortion.** The fix only changes a uniform `heightMm` scale factor (the same operation
   auto-fit already performed) — glyph proportions are never non-uniformly stretched or squashed.
5. **No new console/page errors.** One pre-existing, unrelated WebGL
   `glTexSubImage2DRobustANGLE: Offset overflows texture dimensions` driver warning appears when
   switching to the Straight Tumbler object type in this headless test harness — confirmed present
   on unmodified `develop` too (via `git stash`), unrelated to this change.
6. **Root-cause confirmation ruled out a 3D-only fix.** Before concluding the fix belonged in the
   shared pipeline, the Object Preview's texture filtering (`generateMipmaps`/`minFilter`/
   anisotropy in `src/preview3d/Preview3DRenderer.js`) was inspected as a candidate 3D-only cause;
   it was not touched, because the same illegible pattern was independently confirmed in the plain
   2D Canvas at full zoom — a 3D-only texture fix would not have addressed the actual defect and
   was correctly not applied, per requirement 4/5 (no second layout pipeline).

**Sample before/after screenshots:** published as an artifact —
https://claude.ai/code/artifact/ba39444f-8593-4c85-88da-675646ff9273 (short/medium/very-long text
across mug/tumbler/bottle, side by side with stone-count/dimension metadata).

---

# Recommendation

Approve. The fix addresses the actual, verified root cause (scaling and spacing decoupling in
auto-fit) inside the one existing shared pipeline — `generateTextStonesLive()` and
`resolveLayerShapeSource()` both now go through a single `computeAutoFitScale()` helper, so 2D, 3D,
and every exporter continue to show and produce the exact same stone pattern. Short and medium text
are byte-identical to `develop` (the floor only changes the result when the old scale would have
dropped below it). No changes to `GeometryEngine`, `StoneLayout`, any exporter, any renderer, or the
project schema. No second layout pipeline, no multi-row text, and no rescaling of a real catalog
stone size — production accuracy is preserved for every text length.
