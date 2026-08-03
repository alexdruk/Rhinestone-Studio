# Rhinestone Studio — Task Result

This document is completed by the implementation engineer after finishing the current task.

---

# Task ID

RS-2013 (Implementation Phase) — §4 step 7: remove the old texture path

---

# Status

COMPLETE. Audit (§1-6 below) was written and reported before any deletion, per the repo's "report
before action" discipline for destructive changes. Two judgment calls were required; both are
resolved below (one by explicit user confirmation, since it was a real product decision, not a
technical one). All deletions/edits then applied exactly as scoped. Full default test suite
(`node tools/run-tests.mjs`, 96 files) passes. Live-browser-verified: mug and plate both render
faceted instanced stones correctly (solid-colored body, no texture, correct lighting/placement),
switching object type works, zero console errors.

---

# 1. Context

`instancedStones` now defaults to `true` (step 6c, commit `473487b`), and Sasha has visually
validated the new default (this task's brief). §3.6/§4 step 7 of
`docs/specifications/RS-2013-InstancedFacetedStoneRenderingDesign.md` calls for removing the old
canvas-texture stone-drawing path and the now-dead flag entirely, since there is no longer a second
behavior to gate.

This section is the full "what becomes dead code" audit, required before any deletion.

---

# 2. `StoneLayoutTexture.js` — is any of it still needed?

**Finding: no. The entire file is stone-drawing responsibility and can be deleted outright.**

The design doc's own open question (§4 step 7 note) asks whether the file's background-fill
responsibility might still be needed for non-stone-covered regions. Looking at the real code:

- `drawStoneLayoutTexture(ctx, stoneLayout, { widthMm, heightMm, backgroundColor })`
  (`StoneLayoutTexture.js:45`) does exactly two things in one function: `fillRect()` the whole
  canvas with `backgroundColor`, then draw every stone on top. There is no separate/standalone
  background-fill entry point — it's one function, not two responsibilities split across two
  call sites.
- The "background" it paints is `cupColor` (`Preview3DRenderer._updateTexture()` passes
  `backgroundColor: cupColor` at `Preview3DRenderer.js:626`), and that texture is assigned to
  `bodyMesh.material.map`.
- In the instanced path (`_updateInstancedStones()`, `Preview3DRenderer.js:544-548`), the body
  already gets **exactly the same visual outcome** without any texture at all: `bodyMesh.material.map`
  is cleared to `null` and `bodyMesh.material.color.set(cupColor)` is called directly. A plain
  `MeshStandardMaterial` with `.color = cupColor` and no map **is** the background-fill, just done
  as a flat material color instead of a baked canvas texture — there is no region of the body left
  uncovered by either mechanism.

Conclusion: the background-fill "responsibility" was never a separate thing to preserve — it was
always the same function that draws stones, and the instanced path already has its own equivalent
(plain material color) wired up and working today. Nothing in `StoneLayoutTexture.js` needs to
survive. `TEXTURE_PX_PER_MM`/`textureSizeForMm()` are also not needed by anything outside this file
and the (also-being-addressed) harness — see §5.

---

# 3. `Preview3DRenderer.js` — everything that exists only to support the texture path

Audited the full file (726 lines). Dead once the flag is gone permanently:

| Item | Location | Why dead |
|---|---|---|
| `import { drawStoneLayoutTexture, textureSizeForMm } from './StoneLayoutTexture.js'` | line 15 | file being deleted |
| `_textureCanvas`, `_textureCtx`, `_texture` fields | constructor, lines 117-119 | only read/written by `_updateTexture()`/`_applyTextureParams()`/`dispose()` |
| `this._texture?.dispose()` in `dispose()` | line 344 | texture no longer exists |
| `_updateTexture()` method (CanvasTexture construction/resize/redraw) | lines 599-643 | the whole texture-baking path |
| `_applyTextureParams()` method (wrap-mode/mipmap/anisotropy setup) | lines 574-597 | only called by `_updateTexture()`; step 0's wrap-mode fix (§2.1) becomes moot with no texture to wrap |
| `_teardownInstancedStones()` | lines 558-567 | only exists to undo the instanced path when falling back to texture; with texture gone there is nothing to fall back to, so the instanced mesh is simply always present |
| The `if (instancedStones) {...} else {...}` branch in `update()` | lines 287-292 | only one branch survives |
| `instancedStones` parameter itself | `update()` signature, line 275 | no second behavior to gate |
| `_applyLightRig(instancedStones)` and its `_lightRigExtended` toggle field | lines 134, 392-409 | only one rig is ever reachable once there's one path — folds into `init()`'s light setup directly |
| `DEFAULT_AMBIENT_INTENSITY` (0.75) | line 56 | the "default" rig's ambient value is dead once `_applyLightRig`'s false-branch is unreachable — only `INSTANCED_AMBIENT_INTENSITY` (0.4) survives, renamed to a single constant |
| The original 2-light rig set up in `init()` (ambient@0.75 + 2 directional lights) | lines 174-185 | superseded by the extended rig; `init()` should build the extended (4-light, ambient@0.4) rig directly, not toggle into it later |
| Comment references to "the flag was false"/"texture path"/PREVIEW-001's baked-texture framing | scattered (lines 49-61, 179-182, 266-273 doc comment) | describe removed behavior |

**Kept, unchanged** (confirmed still real, load-bearing behavior, not flag-related):
- `_updateInstancedStonesThrottled()` / `_clearPendingInstancedRebuild()` / the throttle constant
  `INSTANCED_STONES_REBUILD_THROTTLE_MS` — step 5b's perf finding is orthogonal to the flag and
  applies regardless of default. `update()` will call `_updateInstancedStonesThrottled()`
  unconditionally instead of behind an `if`.
- `_updateInstancedStones()` itself (placement/orientation/color math) — unchanged.
- `_applyCrystalMaterialResponse()`, `_frameCamera()`, `_repositionCamera()`, `_rebuildMesh()`,
  `_disposeGroup()`, camera/azimuth/render-scheduling code — untouched, no relation to the flag.

---

# 4. Every call site passing `instancedStones`

- **`app.js`**: `drawCup()` (line 1789 currently) passes
  `instancedStones:__devInstancedStonesState.on` explicitly. The dev-toggle machinery that sets
  that state (`__devInstancedStonesParam`/`__devInstancedStones`/`__devInstancedStonesState`/
  `window.__setInstancedStones`, lines 837-850) exists solely to let Sasha flip between the two
  paths via a URL param — **this is the one genuinely ambiguous product-not-technical call the
  brief flagged**. I asked explicitly rather than assuming; confirmed answer: **remove it
  entirely**, since deleting the flag from `update()` leaves nothing left to toggle to. All of
  this is removed; `drawCup()`'s call to `preview3D.update()` drops the `instancedStones` key
  entirely.
- **`tools/rs2013-instanced-stone-harness.html`**: uses `?lighting=extended` — its own independent
  lighting-rig toggle (harness-local `LIGHT_RIGS` object, not `Preview3DRenderer.js`'s flag), and
  separately imports `drawStoneLayoutTexture` directly for its own step-2 side-by-side reference
  render (see §5 — this is a different mechanism from the `instancedStones` parameter, but shares
  the same fate: the file it imports is going away).
- **`tools/measure-instanced-stone-performance.mjs`**: passes `instancedStones: true` in
  `MUG_OPTIONS`/`PLATE_OPTIONS` (lines 131, 141). Harmless to leave (an extra unread property once
  the parameter is dropped from the destructure), but removed for clarity since it now documents a
  flag that no longer exists.
- **Every test file** — see §6.

No other production call site (`src/`) references `instancedStones` or calls `Preview3DRenderer.update()` with it.

---

# 5. `tools/rs2013-instanced-stone-harness.html` — obsolete, or still useful?

**Decision: trim, don't delete.** Reasoning:

The harness has three independent view modes, gated by URL params:
1. `runStep1Grid()` (no `?product=`) — static flat-grid geometry/color check. No dependency on
   `StoneLayoutTexture.js` at all.
2. `runStep2Placement(productId)` (`?product=`) — renders the **same real StoneLayout twice**:
   left = the old texture reference (via `drawStoneLayoutTexture`/`textureSizeForMm`, duplicating
   what `Preview3DRenderer._updateTexture()`/`_applyTextureParams()` used to do), right = the
   instanced mesh. This is the one mode that hard-depends on the file being deleted.
3. `runSingleStoneCloseup(productId)` (`?view=singlestone`) — close-up single-instance view for
   facet/material/lighting comparison. No `StoneLayoutTexture.js` dependency.

The side-by-side comparison in mode 2 was purpose-built to validate the instanced path *against*
the texture path — that validation is done (Sasha's approval, this task's premise) and the
comparison target (`StoneLayoutTexture.js`) is being deleted, so that half of mode 2 is genuinely
obsolete, not merely unused. But modes 1 and 3, and the *instanced-only* right-hand render in mode
2, remain a real standalone tool for visually inspecting placement/lighting/facet/material
combinations against real product StoneLayouts outside the full app — the same role
`tools/rs2013-instanced-stone-harness.html`-style standalone Three.js harnesses already play
elsewhere in this repo (per prior milestones' pattern of keeping such tools around for future
tuning work, e.g. the font program's `FONT-CAL-*`/`FONT-GEN-*` visual-comparison tooling).

**Action taken**: removed the left-hand texture-reference render and its `drawStoneLayoutTexture`/
`textureSizeForMm` import from `runStep2Placement()`, kept the right-hand instanced render (now
simply "the" render, not "the new one"), and kept modes 1 and 3 unchanged. The info banner text
was updated to drop "left/right compare" language since there is now only one render.

---

# 6. Test files — audited and updated/removed

| File | Action | Why |
|---|---|---|
| `tools/test-stone-layout-texture.mjs` | **deleted** | tests only `StoneLayoutTexture.js`'s own exports, all of which are gone |
| `tools/test-preview3d-instanced-stones.mjs` | **updated** | tests 1, 2, 8, 13 tested the `false`/toggle-off path specifically — deleted (behavior no longer exists). Test 14 ("omitted === explicit true") is now vacuous once `instancedStones` isn't a parameter at all — deleted. Tests 3-7, 9-12 test real, still-existing behavior (mesh construction, placement math, lighting rig, throttling) — kept, with `instancedStones: true`/`instancedStones: false` removed from every options object (no longer a recognized option) and comments updated to drop "flag-gated" framing. |
| `tools/test-preview3d-render-scheduling.mjs` | **updated** | tests 7-9 test `_applyTextureParams()` directly — deleted (method removed). Tests 1-6 (render-scheduling, unrelated to the flag) kept unchanged. |
| `tools/test-object-geometry-builder.mjs` | **updated (comment only)** | test 17's assertion (`underMesh.material.map` stays `null`) is a real, still-true `ObjectGeometryBuilder.js` invariant unrelated to which rendering path is active — kept, but its comment referenced `Preview3DRenderer._updateTexture()` by name; reworded to not cite a method that no longer exists. |
| `tools/test-rs-block.mjs`, `tools/test-rs-modern.mjs` | **updated** | test 19 in each exercised `drawStoneLayoutTexture` directly purely as a cross-check that the shared crystal-drawing code renders consistently for that font — deleted (no second consumer left to cross-check against); the import of `drawStoneLayoutTexture`/`TEXTURE_PX_PER_MM` removed. All other tests in both files are unrelated (font/geometry/serialization) and kept. |
| `tools/test-crystal-color-integration.mjs` | **updated** | test 11 cross-checked 2D-canvas vs. 3D-texture color consistency — deleted (only one consumer left). |
| `tools/test-crystal-stone-renderer.mjs` | **updated** | test 12 checked that both `CanvasRenderer2D.js` and `StoneLayoutTexture.js` import the shared crystal modules — deleted (second file gone); its `stoneLayoutTextureSource` read removed. |
| `tools/test-fill-algorithms-integration.mjs` | **updated** | test 16's `rendererFiles` list included `'src/preview3d/StoneLayoutTexture.js'` — removed from the list (file gone; the test's actual point, "no renderer branches on sourceMode," still holds for the remaining files). |
| `tools/test-module-graph-exports.mjs` | **updated** | test 3 checked both `ObjectDimensions.js` and `StoneLayoutTexture.js` for purity — narrowed to `ObjectDimensions.js` only (still a real, useful invariant); `StoneLayoutTexture.js` read removed. |
| `tools/test-product-plate-round-dinner.mjs`, `tools/test-product-vessel-dimensions.mjs` | **updated** | both regex-match `drawCup()`'s literal call to `preview3D.update()`, including `instancedStones:__devInstancedStonesState.on` — updated to match the new call site with no `instancedStones` key at all. |
| `tools/measure-instanced-stone-performance.mjs` | **updated** | removed the now-meaningless `instancedStones: true` from both options objects (not a test file, not run by `npm test`, but kept accurate). |

Doc-comment-only references to `StoneLayoutTexture.js` as a "consumer" in `src/renderer/CrystalStoneRenderer.js`,
`src/renderer/StoneColors.js`, `src/renderer/CrystalColors.js`, `src/renderer/CrystalAppearance.js`,
and `src/preview3d/ObjectGeometryBuilder.js` (one line each, listing it alongside `CanvasRenderer2D.js`
as a place the shared color/appearance modules are consumed) were updated to drop the stale
reference — no behavior change, just accuracy.

---

# 7. Summary of what was removed

- `src/preview3d/StoneLayoutTexture.js` — deleted entirely.
- `Preview3DRenderer.js` — `_updateTexture()`, `_applyTextureParams()`, `_teardownInstancedStones()`,
  `_textureCanvas`/`_textureCtx`/`_texture` fields, the `instancedStones` parameter, the
  if/else branch in `update()`, `_applyLightRig()`/`_lightRigExtended`, `DEFAULT_AMBIENT_INTENSITY`.
  The extended 4-light rig is now simply *the* rig, built once in `init()`.
- `app.js` — `__devInstancedStonesParam`/`__devInstancedStones`/`__devInstancedStonesState`/
  `window.__setInstancedStones`, and `instancedStones:...` dropped from `drawCup()`'s call.
- `tools/test-stone-layout-texture.mjs` — deleted entirely.
- Texture-path-specific tests removed from 8 other test files (listed in §6); real-behavior tests
  in those same files preserved.
- `tools/rs2013-instanced-stone-harness.html` — left-hand texture-reference render removed from
  step-2 mode; step-1/single-stone-closeup modes and the instanced render kept.

Preserved exactly as before: placement/orientation math, lighting values (now the single rig),
throttling behavior, color/material handling, camera framing, render scheduling.
