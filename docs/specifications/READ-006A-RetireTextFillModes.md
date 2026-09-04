# READ-006A — Retire Staggered / Radial / Contour as text fill styles

Status: **implemented.** Branch `feature/read-006a-retire-text-fill-modes`, off `develop` at
`1264506`. UI-only change: the `#textMode` picker now offers **Outline** and **Grid Fill** only.
No geometry, no mode mapping, and no other layer type is touched.

This is a product decision, taken by the product owner from the READ-005 calibration
(`docs/specifications/READ-005A-CalibrationFindings.md` §7 item 3, and `docs/BACKLOG.md` "Staggered
and radial sell at 9% and 10% at every ratio tested"). It does **not** claim the three samplers are
broken — only that, for text, they do not earn a slot in the picker.

---

## 1. The decision

Remove the `staggered`, `radial` and `contour` `<option>` lines from the `#textMode` `<select>` in
`index.html`. Leave the identical options in `#svgMode`, `#shapeFillMode` and `#imageFillMode`
untouched — shapes, SVG and images were never rated and this decision does not extend to them.

Everything downstream of the picker is unchanged:

- `TEXT_MODE_TO_ENGINE_MODE` (app.js) keeps all five entries.
- `resolveTextFillMode()`, `VECTOR_FILL_MODES`, `IMAGE_FILL_MODES` and everything in
  `src/geometry/` are byte-for-byte unchanged.
- A project saved with `textMode` `'staggered'`, `'radial'` or `'contour'` renders **identically**
  to `develop` (verified — §4).

Two small pieces of new UI keep an already-saved retired-mode design coherent:

- **`ensureTextModeOptionForLayer(textMode)`** (app.js) — mirrors `ensureFontOptionForLayer()`
  exactly, including its `data-…-option` stale-removal pattern. If the selected text layer's
  `textMode` is one of the three retired values, it injects a `"<Name> Fill (retired)"` option
  tagged `data-retired-option='1'` into `#textMode` (removing any previously injected one first),
  so the native `<select>` can display the layer's real mode instead of silently falling back to
  `value=''`. Called from `syncSelectedControlsFromLayer()` immediately before
  `el('textMode').value=…` is set.
- **`#retiredTextModeHint`** (`p.hint`, hidden by default, same markup as `#autoFitOnHint`) — shown
  by `updateTextFontCapabilityUI()` when, and only when, the selected text layer's `textMode` is
  retired. It says the style is no longer offered for new designs, that this design still renders
  exactly as saved, and that switching to another style is one-way. Nothing is auto-switched.

## 2. The per-mode ratings this rests on

Every figure below is a field copied verbatim from `docs/data/read-005/derived-tables.json`
(`session1.modeRatio` and `session1.inaccurateByMode`), frozen by
`tools/test-read-005-derived-tables.mjs`. Nothing here is recomputed from `ratings.csv`; where a
cell is written as `a / b`, both `a` and `b` are separate frozen fields, not a ratio. Session 1 was
135 blind renders, one rater, one session. "Sellable" is the rater's yes/no on "would you sell
this". Rater sell-axis self-consistency was 13 of 15 hidden repeats
(`session1.raterSelfConsistency.sellable` / `.n`); READ-005A §2 frames that as an ~87% ceiling on
any signal.

`renders` = `modeRatio[*].n`; `sellable` = `modeRatio[*].sellable`; `sellable %` =
`modeRatio[*].sellablePct` (verbatim); `sell=no rows` = `inaccurateByMode[*].sellNo`;
`"inaccurate" tag` = `inaccurateByMode[*].inaccurate`.

| mode | renders | sellable | sellable % | sell=no rows | "inaccurate" tag / sell=no rows |
|---|---:|---:|---:|---:|---:|
| **outline** | 53 | 32 | 60.4 | 21 | 4 / 21 |
| **fill** (Grid Fill) | 20 | 7 | 35 | 13 | 8 / 13 |
| contour | 19 | 3 | 15.8 | 16 | 5 / 16 |
| radial | 20 | 2 | 10 | 18 | 8 / 18 |
| staggered | 23 | 2 | 8.7 | 21 | 19 / 21 |

By ratio band (`session1.modeRatio[*].bands`, height ÷ stone-pitch), each cell written
`sellable / n` from `bands.<band>.sellable` and `bands.<band>.n` verbatim — the three retired modes
never recover:

| mode | <20 | 20–25 | 25–30 | 30+ |
|---|---:|---:|---:|---:|
| outline | 0/4 | 9/15 | 12/21 | 11/13 |
| fill | 0/5 | 3/5 | 3/7 | 1/3 |
| contour | 0/4 | 0/6 | 2/5 | 1/4 |
| radial | 0/2 | 1/8 | 1/6 | 0/4 |
| staggered | 0/4 | 0/7 | 1/9 | 1/3 |

READ-005A §4.3: "Staggered and radial never clear ~15% at any ratio." §4.6: the dominant rejection
cause is **inaccurate letterforms**, its share of rejections *rises* with ratio (no height floor
reaches it), and it is overwhelmingly concentrated in staggered — 19 of 23 staggered renders and 19
of 21 staggered rejections carry the tag, against 4 of 53 for outline.

The other population-wide rejection tags over the 89 `sell=no` rows (multi-label, not broken out per
mode in the frozen file): "letters too close" 25, "too many stones" 12, "ugly" 9, "extra stones" 4.

### Rejection-cause reading, per retired mode

- **Staggered** — a fidelity failure. 19 of its 21 rejections are tagged "inaccurate letterforms";
  the hexagonal row offset that makes it pack more densely than Grid Fill is exactly what smears the
  letterform. No ratio rescues it.
- **Radial** — mixed. Its "inaccurate" tag count is 8 of 18 rejections, the rest crowding/evenness;
  the mode's own "bullseye at the centre, straight rows at the edges" character (the defect READ-002
  fixed for the *anchor* but not the underlying suitability) reads as neither a fill nor an outline.
- **Contour** — the least-bad of the three (`sellablePct` 15.8 vs 8.7 and 10), and its rejections
  are more evenly spread ("inaccurate" tag 5 of 16). But its `sellable` count is 3 against outline's
  32, it is the slowest text generation in the app by 5–7×
  (`docs/specifications/RS-2000-MVPStabilizationValidation.md`), and READ-001's centreline work —
  which is what made it defensible for thin strokes at all — did not lift its `sellablePct` above
  15.8.

Grid Fill (`fill`) stays because its `sellablePct` is 35 — a genuine second option — with 3 of 5
sellable in the 20–25 band, and its failures are a recognisable band rather than a floor.

## 3. Why old projects still render

The picker is a *list of offered choices*, not a *validator*. `TEXT_MODE_TO_ENGINE_MODE` keeps all
five keys, so `resolveTextFillMode('staggered')` still returns `'staggered'` and the Geometry Engine
still runs its staggered sampler. Dropping the entry would make `resolveTextFillMode()` fall through
to its `|| 'outline'` tail and **silently convert every such saved design** on first load — the one
change in this milestone a user could not undo. That entry is therefore load-bearing and is pinned
by a new assertion in `tools/test-fill-algorithms-integration.mjs` (test 1b).

`ensureTextModeOptionForLayer()` closes the one UI gap this opens: without it, selecting a
retired-mode layer would leave the native `<select>` on `value=''` (no matching `<option>`), and the
next `writeSelectedControlsToLayer()` would write that `''` back over the layer's real
`textMode`. This is the identical failure mode `ensureFontOptionForLayer()` was built for, and the
fix is the identical shape.

Switching a retired-mode layer to Outline or Grid Fill is **one-way** — once written, the retired
value is gone and the injected option disappears on the next selection sync (again, exactly like the
legacy-font option). The hint says so. There is deliberately no "restore" affordance.

## 4. Rendering parity — verified

`tools/scratch/read-006a-render-parity.mjs` (gitignored) generates a text layer in each retired mode
through the real engine + font registry and prints stone count and bounding box. Run on `develop`
and on this branch:

| textMode | stones | bbox x, y, w, h (mm) |
|---|---:|---|
| staggered | 250 | 0.345312, −26.471094, 190.6, 27.89416 |
| radial | 116 | 1.184939, −29.204919, 81.565061, 33.015576 |
| contour | 221 | 0.674316, −20.86582, 142.788616, 22.059715 |

Identical on both branches (`diff` clean).

**Selection / undo-redo persistence — verified in-browser** (`tools/scratch/read-006a-persistence-verify.mjs`,
reading `window.__project.layers[*].textMode`):

- Two text layers, A = `staggered` / B = `contour`. Cycle click A → click B → click A: `A` stays
  `"staggered"` and `B` stays `"contour"` after every click, and after the import.
- One text layer, `radial`. A history-committing stone-colour edit (`gold` → `crystal-clear`), then
  undo, redo, undo: `textMode` reads `"radial"` at every step (colour tracks `gold` ⇄ `crystal-clear`
  correctly). The colour edit runs `writeSelectedControlsToLayer()` — `l.textMode=el('textMode').value`
  — so this confirms `ensureTextModeOptionForLayer()`'s injected option makes that read-back return
  `'radial'` rather than `''`.

**Bundled examples.** All **27** tracked `examples/*.rhs` were swept: no text layer uses a retired
mode (values seen are `centerline`, `fill`, and the pre-schema `mode` key — none are
`staggered`/`radial`/`contour`). `mixed-fill-styles-and-sizes.rhs` uses `staggered`/`radial`/`contour`
only on *shape* layers via `fillMode`, which is out of scope here. `tools/test-examples-regression.mjs`
is unaffected and still passes.

## 5. Why the restriction is text-only

`#svgMode`, `#shapeFillMode` and `#imageFillMode` keep all five / four options. The calibration
rated **text renders only**. A circle or an imported logo filled with concentric rings is a
different visual object with a different acceptance bar, and nobody has rated one. RS-1011 shipped
these modes for every vector layer type on purpose; READ-006A narrows only the surface the data
speaks to.

## 6. Consequences for the readability program

The three retired modes are now **text-moot** but remain live for shapes / SVG / images, so their
open items are not closed — only descoped from text:

- **READ-001** (Contour Fill centreline collapse, sub-cell ring placement, dedupe floor) and its
  residual open item — the inward ring can still translate by up to half a cell under an asymmetric
  `insideAt` classification (`READ-001` §Fix Part A.2) — no longer affect any text layer a user can
  create. Still relevant to Contour Fill on shapes and SVG.
- **READ-002**'s deferred `sampleRadialFieldFillPoints()` defect (image/raster radial fill still
  rays from a single whole-placement anchor; `docs/BACKLOG.md`) is likewise text-moot — text radial
  fill can no longer be selected — but still open for image layers, which are exactly the layer type
  that defect is about.
- **READ-005A §7 item 2** (the fidelity defect in the interior samplers, "probably a geometry
  problem") and item 3 (the product decision) — item 3 is now resolved *for text* by retirement
  rather than by fixing the geometry. Item 2 stays open for shapes/SVG/images.

### "Separate letters" (READ-006)

The one-shot letter-spacing solve keeps working for retired-mode layers (it is not gated on mode —
see §7 below), but its only *productive* mode for a newly created layer is now **outline**. From the
paired tracking experiment (`session2.paired.perModeEvaluable`), tracking converted:

| mode | control sellable | tracked sellable |
|---|---:|---:|
| outline | 2 / 12 | 8 / 12 |
| contour | 1 / 6 | 3 / 6 |
| fill | 0 / 3 | 0 / 3 |
| staggered | 0 / 1 | 0 / 1 |

So on the modes still offered for new text, "Separate letters" helps outline strongly and Grid Fill
not at all — its contour gains are now only reachable on a pre-existing retired-mode design.

## 7. `#separateLettersBtn` — copy audited, not changed

Point 5 of the milestone. The button is **not** gated on mode (a legacy retired-mode layer must
still be able to run it). Its three runtime hint paths were checked for any mention of "contour" or
another retired mode:

1. generation failure — *"Could not work out a letter spacing for this text."*
2. never-separated — *"These letters can't be separated at this text height and font. Try a taller
   text height, a different font, or a smaller stone size."*
3. auto-fit refusal — *"Separating the letters needs … Turn Auto Fit off and shorten the text, or
   drop a stone size."*

None name a fill mode. `#letterSpacingHint` / `#letterSpacingFixedHint` in `index.html` don't
either. **No copy change was needed.** The `index.html` comment above the button
("Contour mode takes ~2s — the busy state is expected") stays accurate: the solver still runs the
contour sampler for a legacy contour-mode layer, and the ~2s busy state is still real for it.

## 8. Caveat on the strength of this evidence

Session 1 is **19–23 renders per retired mode** (`modeRatio[*].n` = 19 / 20 / 23), **from one
rater, in one session**, scored on a subjective "would you sell this" axis against a 13-of-15
hidden-repeat self-consistency (`session1.raterSelfConsistency`). This is materially weaker than the
READ-005 *tracking* result (`READ-005A` §3), which was paired, blind, position-
separated, with three behaving controls and McNemar p = 0.0078
(`session2.paired.mcnemar.p`). The retirement decision is a
product-owner judgement call taking that weaker signal at face value, not a controlled finding. If
a future milestone fixes the interior-sampler fidelity defect (READ-005A §7 item 2), re-offering
these modes for text is a one-line `index.html` change plus removing `ensureTextModeOptionForLayer()`
— the geometry path was never removed.

## 9. Tests touched

| test | change | why |
|---|---|---|
| `tools/test-fill-algorithms-integration.mjs` test 1 | rewritten: `#textMode` now asserted to offer **only** `stroke` + `fill`, and asserted to **not** contain `staggered`/`radial`/`contour` | it asserted the old five-option list; that list is the thing this milestone changes. Tests 2–4 (`#svgMode`/`#shapeFillMode`/`#imageFillMode`) are untouched — those selects keep all their options. |
| `tools/test-fill-algorithms-integration.mjs` test 1b | **new** | pins all five keys in `TEXT_MODE_TO_ENGINE_MODE`, so a later edit can't drop a retired entry and silently convert saved designs (the §3 regression guard for the non-undoable change). |

No test that asserts **rendering** of a staggered/radial/contour text layer was relaxed.
`tools/test-fill-algorithms.mjs` test 15 (`generateTextLayout({… mode: 'contour'})`),
`tools/test-font-lib-004-height-readability.mjs` (`textMode: 'fill'`/`'radial'` at the
StrokeWidthGate level) and `tools/test-font-lib-003-crowding-hint.mjs`'s `INTERIOR_FILL_MODES` policy
pin all call the geometry / signal layer directly, are the regression guard for §3, and are left
exactly as they are.
