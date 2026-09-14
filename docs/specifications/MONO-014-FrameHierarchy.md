# MONO-014 — Frame hierarchy and "No frame"

**Status:** implemented. Branch `feature/mono-014-frame-hierarchy` off `develop` (local only).

**Authorises:** a real `frameId: 'none'` catalog entry; a new `src/monogram/FrameHierarchy.js`
sizing module; making the unchecked `#monogramFrameStoneToggle` mean "automatic hierarchy" instead
of "pre-MONO-010 default"; an unconditional equal-weight filter in
`generateMonogramWithFrameAutoShrink()`; `measurements.frame` / `measurements.frameHierarchy`; a
per-font default frame.

---

## 1. The two defects

**(a) A frame was mandatory.** `FrameLibrary.listFrames()` had eight entries and no "none", so every
monogram shipped with a ring — even when the letterform is itself the ornament (a thin script
capital, a single authored letter).

**(b) Frame and letters competed at equal visual weight.** With `#monogramFrameStoneToggle`
unchecked, `app.js`'s request builder left `frameOptions.stoneSizeMm` unset, and
`MonogramGenerator` fell back to the letters' own `stoneSizeMm`
(`src/monogram/MonogramGenerator.js`, the `frameStoneSizeMm` fallback). Ring and letters then
rendered at identical stone size — the reading is "two things", not "a monogram in a frame".

**The product rule:** a frame is clearly subordinate *or* clearly dominant, never equal.

---

## 2. `frameId: 'none'`

A real `FRAME_DEFINITIONS` entry (`src/geometry/FrameLibrary.js`), so the picker and every
`listFrames()` / `getFrameDefinition()` consumer need no special case:

```
id: 'none', label: 'No frame', category: 'geometric', source: 'none',
hollow: false, clearanceMm: 0, opticalCenterOffset: NO_OPTICAL_OFFSET,
scalingLimitsMm: COMMON_SCALING_LIMITS_MM,
generationNaturalContours: null, fittingNaturalContours: null
```

`source: 'none'` — not `'shapeLibrary'` / `'frameLibrary'` — because the entry reuses neither
module's geometry: it has none. `frame.source` has exactly one consumer (`tools/test-frame-library.mjs`
test 4, "never a third system"), which is widened to allow `'none'` for this single entry.

`scalingLimitsMm` is **required, not decorative**: `app.js`'s `updateMonogramFrameSizeBounds()` and
`computeMonogramDefaultSizeMm()` both read `frame.scalingLimitsMm` off the selected frame to bound
the Frame Size fields, even when no border will be drawn. An audit of every `app.js` consumer of a
frame object confirms `scalingLimitsMm` is the **only** geometry-shaped field any of them reads
(the others touch `frame.label` only) — so a null-contour entry is safe everywhere except those two
functions, which the required field covers.

`MonogramGenerator.generate()` branches on `frameId === 'none'` **before**
`resolveFrameForStoneWidth()`, `computeFrameInterior()` and `computeFrameFitRect()` — all three
would otherwise receive null contours. For "No frame": no frame-role layer is emitted, the
requested `frameRect` is used as the letter-layout region unchanged, the frame-vs-letters collision
check is skipped (there are no frame stones), and `measurements.frame` / `measurements.frameHierarchy`
are `null`. Letter fitting, the MONO-012 single-chain branch, and letter-vs-letter collision are
untouched.

---

## 3. Automatic hierarchy — `src/monogram/FrameHierarchy.js`

```
defaultFrameStoneSizeMm(letterStoneSizeMm) -> number
```

Returns the next larger diameter in `listStoneSizes()`, or the largest if the letters are already
at the top rung. Pure catalog arithmetic — no DOM, no generator, no geometry.
`src/renderer/StoneSizes.js:170` (`validateStoneSizeCatalog()`'s strictly-ascending assertion)
guarantees "next larger" is well defined without a defensive sort. This is a shared module
function, so `tools/test-mono-014-frame-hierarchy.mjs` imports it directly (the READ-009 situation,
not the MONO-011 slice-out-of-app.js one).

`app.js`'s request builder now branches:

- **toggle checked** — the visible `#monogramFrameStoneSize` / `#monogramFrameColor` fields drive
  the frame exactly as set. This is the *only* path that can produce an equal-weight frame, and
  only if the user deliberately matches the letters' size.
- **toggle unchecked** — `frameOptions.stoneSizeMm = defaultFrameStoneSizeMm(stoneSizeMm)`. Color is
  still left unset (the generator's `frameOptions.color ?? resolvedColor` fallback applies). The
  MONO-010 comment block that claimed "toggle off is byte-identical to pre-milestone behavior" is
  rewritten — unchecked now means automatic hierarchy.

---

## 4. Auto-shrink must not land on equal weight

`generateMonogramWithFrameAutoShrink()` (MONO-011) builds its retry candidates as every catalog
diameter strictly less than the requested frame size, descending. With §3 in place and SS6 letters,
the automatic default frame is 2.8 mm and the first retry candidate is 2.0 mm — exactly the
equal-weight state this milestone forbids, reached silently.

The fix: **unconditionally** filter the letters' own diameter out of the candidate list (both
toggle modes — auto-shrink is never an explicit user choice, so it should never produce equal
weight). Compared with a small epsilon rather than `!==` because both sides are catalog floats
(typed history, imported projects, catalog rounding) and exact equality is fragile against that
drift.

### The SS6 dead-end this creates (correct, not hidden)

With SS6 letters there is nothing in the catalog below 2.0 mm, so once 2.0 mm is filtered out the
candidate list for a 2.8 mm default frame is **empty**. A colliding dominant frame now *fails* where
MONO-011 would previously have retried into equal weight. That is the intended outcome — an
equal-weight monogram is not an acceptable auto-correction — but the failure must be actionable.
`monogramFailureMessage()`'s `FRAME_COLLISION` branch is extended to suggest a larger frame size, a
smaller stone size, **or** the new "No frame" option.

`tools/test-mono-014-frame-hierarchy.mjs` proves the filter has teeth: the same SS6-dead-end
scenario run against a locally reconstructed *unfiltered* candidate list retries into a 2.0 mm
(`frameHierarchy === 'equal'`) success, while the shipped wrapper fails with `FRAME_COLLISION`.

---

## 5. No hidden-field write-back

After an auto-shrink, `app.js` previously wrote the applied size into `#monogramFrameStoneSize` and
showed a status message. Under MONO-010 that was coherent because the value only ever came from that
visible field. §3 breaks it: with the toggle unchecked the field is hidden
(`updateMonogramFrameStoneControlsVisibility()`), so the write targets a control the user cannot
see. The `el('monogramFrameStoneSize').value = …` assignment is removed; the status message
("Frame stones reduced to … to fit") stays — the adjustment must still be surfaced, per MONO-011's
"never silent" scope.

---

## 6. Per-font default frame

In the `#monogramFont` change handler: selecting a font whose `providerId !== 'rhinestone'` sets
`#monogramFrame` to `none` (`applyMonogramDefaultFrameForFont()`), unless the user has already
changed the frame during this lightbox session — tracked by a module-scope
`monogramFrameUserChosen` boolean set in the `#monogramFrame` change handler and reset in
`onMonogramOpen()`. Authored (`rhinestone`) fonts default to `circle`. `#monogramFrame` is set
programmatically, so `updateMonogramFrameSizeBounds()` is called directly (a bare `.value`
assignment fires no `change` event).

---

## 7. Hierarchy measurement

`measurements.frame` is the applied frame spec (`{ id, label, stoneSizeMm, stoneCount, mode }`) or
`null` for "No frame". `measurements.frameHierarchy` is `'subordinate' | 'dominant' | 'equal' |
null`, derived from the frame stone size actually applied versus the letters' `stoneSizeMm`.
`'equal'` is reachable only when the toggle is checked and the user deliberately matched the sizes;
it is unreachable from the automatic path, including after auto-shrink.

---

## 8. Known follow-up (recorded in `docs/BACKLOG.md`)

Monogram layer ids (`monogram-${frameId}-${layoutId}-letter-N`) are frame+layout deterministic, so
generating the same frame+layout twice into one project produces colliding ids that
`validateProject()` rejects on the next autosave-recovery / import / save round-trip. Latent since
MONO-005/006; its own milestone.

---

## 9. Tests

`tools/test-mono-014-frame-hierarchy.mjs` — every `defaultFrameStoneSizeMm()` rung plus a
discriminating negative control; `frameId: 'none'` through the real `MonogramGenerator` + real
`GeometryEngine` on the **authored** path (no frame layer, no frame-role id, `measurements.frame` /
`frameHierarchy` null, and a strictly larger letter `requestedScale` than the same `circle` request —
the quantity that actually responds to the fitting region, since authored-font stone counts are
scale-invariant); `frameId: 'none'` on the **OpenType single-chain** path, where a larger fitting
region genuinely changes the output — Great Vibes SS10 letters in an 80 mm frame fail `CHAIN_TOO_THIN`
with `circle` but succeed with `none`, the chain fitting at its un-shrunk ideal height; the
`frameRect`-is-the-interior deep-equal; `frameHierarchy` classification (dominant / subordinate /
equal); the auto-shrink equal-weight filter with its unfiltered negative control; the request
builder's `frameOptions` toggle branch (sliced). `tools/test-frame-library.mjs` test 1 updated for
the nine-entry catalog and test 4 for the `source: 'none'` entry (asserting it is the only one, with
null contours); `tools/test-mono-011-frame-stone-autoshrink.mjs`'s second case retitled — MONO-014
made its "toggle off" premise unreachable from `app.js`, so it now guards the wrapper's own
no-finite-frame-stone-size contract; `tools/test-mono-006-monogram-ui.mjs`'s sandbox factory gains
`defaultFrameStoneSizeMm`.
