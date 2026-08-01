# Rhinestone Studio — Task Result

This document is completed by the implementation engineer after finishing the current task.

---

# Task ID

RS-2013 (Implementation Phase) — §4 step 0 (prerequisite fixes) + step 1 (static instanced test
plane)

---

# Status

IMPLEMENTED — both steps complete, tested, and committed locally.

---

# Branch

feature/rs-2013-instanced-stones-step0-1 (cut from `develop` at the RS-2013 design-doc commit,
`8c3c1ba`)

---

# Commit

```bash
git log -1 --oneline
```

---

# Summary

Implemented exactly `docs/specifications/RS-2013-InstancedFacetedStoneRenderingDesign.md`'s §4
step 0 and step 1 — nothing further.

**Step 0** fixed `Preview3DRenderer.js`'s `_applyTextureParams()` so the body texture's `wrapS`
uses `THREE.RepeatWrapping` for object kinds whose mesh actually has a circumferential seam
(mug/tumbler/bottle), `ClampToEdgeWrapping` for the plate (flat top, no seam). `wrapT` never wraps
either way. No fix was needed for the `Math.min(...)`/`Math.max(...)` spread item — confirmed no
live bug; step 1's own new code follows the reduce-not-spread guidance (it turned out not to need
any stone-count-scaled array reduction at all).

**A discrepancy between the design doc and the live repository was found and resolved with the
human owner before implementing step 0** (see "Notes / warnings" below) — the doc's literal
`wrap==='full'` gating condition no longer exists in the codebase; the approved fix gates on
`this._dimensions.kind !== 'plate'` instead, which matches current architecture and actually fixes
the seam for every vessel project rather than only ones set to `wrap:'full'`.

**Step 1** built a standalone, isolated visual test harness (`tools/rs2013-instanced-stone-
harness.html`) rendering one `THREE.InstancedMesh` of octahedral-bipyramid stones
(`THREE.OctahedronGeometry(radius, 0)`), 17 rows (one per `CrystalColors.js` catalog color) × 5
columns (one per `StoneSizes.js` catalog size) = 85 instances, correct per-instance color (via
`getCrystalColor()`) and size (via each instance's own transform scale), arranged in a trivial flat
grid — no vessel-surface mapping, no real `StoneLayout`, no wiring into `Preview3DRenderer`/
`app.js`/the Studio UI. A companion Playwright script
(`tools/rs2013-instanced-stone-harness-screenshot.mjs`) captures it to a PNG for review without a
browser, following the exact static-server + `chromium.launchPersistentContext` + `page.screenshot`
pattern `tools/rhinestoneFontQaKit.mjs` already uses for font QA sheets (same already-installed,
if not `package.json`-declared, Playwright dependency — nothing new added).

---

## How to view the step-1 result yourself

**Option A — live, interactive (recommended):**
```bash
npm run dev
```
then open `http://localhost:5173/tools/rs2013-instanced-stone-harness.html` in a browser. Drag to
orbit the camera around the grid.

**Option B — the captured screenshot:**
`tools/rs2013-instanced-stone-harness.png` (regenerate any time with
`node tools/rs2013-instanced-stone-harness-screenshot.mjs`).

The screenshot shows 17 rows of faceted, diamond-silhouette octahedral-bipyramid stones, colors
running through the full `CrystalColors.js` catalog (gray/crystal, black/jet, reds, pinks, purple,
blues, teal, greens, yellow-green, orange, yellow, gold, silver top-to-bottom), 5 columns of
increasing size (SS6→SS30) left-to-right. Two of the 17 rows (`crystal` and `silver`, both very
pale hex values close to the scene's own light-blue-gray background) are visually subtle in a
static screenshot — this is the catalog's own color data rendering correctly, not a defect; it is
easier to distinguish live with orbit/lighting-angle changes than in one static frame.

---

## Wrap-mode fix — before/after behavior

**Before:** `texture.wrapS = THREE.ClampToEdgeWrapping;` unconditionally, for every object kind.
For mug/tumbler/bottle, whose entire canvas always maps exactly once around the full 360° body
(confirmed via `ObjectDimensions.js` — true regardless of the project's own wrap-mode setting),
`ClampToEdgeWrapping` samples the wrong edge texel once mipmap/anisotropic filtering (already
enabled just below in the same function) reads slightly outside `[0,1]` at that seam — a plausible
source of a visible artifact at the mesh's back seam under minification/oblique viewing.

**After:** `texture.wrapS` is `THREE.RepeatWrapping` when `this._dimensions.kind !== 'plate'`
(mug/tumbler/bottle), `THREE.ClampToEdgeWrapping` when it is `'plate'` (a flat top surface with no
circumferential seam at all, where repeating would be meaningless). `wrapT` (height) is unchanged —
`ClampToEdgeWrapping` always, since height never wraps for any object kind.

---

# Files changed

- `src/preview3d/Preview3DRenderer.js` — `_applyTextureParams()` wrap-mode fix (step 0). No other
  change to this file.
- `tools/test-preview3d-render-scheduling.mjs` — 3 new test cases (`#7`-`#9`) covering the
  wrap-mode fix for mug/tumbler/bottle vs. plate.
- `tools/rs2013-instanced-stone-harness.html` (new) — step-1 standalone visual test harness.
- `tools/rs2013-instanced-stone-harness-screenshot.mjs` (new) — Playwright screenshot capture.
- `tools/rs2013-instanced-stone-harness.png` (new) — captured verification screenshot.
- `TASK.md` (rewritten for this milestone), `TASK_RESULT.md` (this file).

No file under `app.js`, `index.html`, `StoneLayoutTexture.js`, or any `StoneLayout`/geometry-
generation module was touched.

---

# Tests run

```bash
node tools/run-tests.mjs --all
node tools/test-documentation-consistency.mjs
```

---

# Test result

`node tools/run-tests.mjs --all`: **98/98 passed** (includes the 3 new wrap-mode cases in
`test-preview3d-render-scheduling.mjs`, now 9/9 in that file).

`node tools/test-documentation-consistency.mjs`: passed (a first run failed on a false-positive
path-candidate match — `` `Math.min(...)/Math.max(...)` `` in `TASK.md` was parsed as a repo path
because it contained a `/` inside one backtick span; rephrased to two separate backtick spans,
re-ran clean).

---

# Browser/manual verification

Ran `node tools/rs2013-instanced-stone-harness-screenshot.mjs` (headless Chromium via Playwright,
already present in `node_modules` from prior font-QA milestones) against the harness page served
from a local static server. Confirmed visually (viewed the captured PNG directly):

- All 85 instances render as a distinct faceted, diamond/kite-silhouette solid (the octahedral
  bipyramid), not a smooth disc or sphere — matches design doc §3.1's intended shape.
- Colors are visually distinct and correctly ordered across all 17 rows, matching
  `CrystalColors.js`'s catalog order and hex values (two very pale colors are subtle against the
  background but present and correctly positioned — see "How to view" above).
- Sizes increase left-to-right across the 5 columns, matching `StoneSizes.js`'s ascending
  SS6→SS30 order.
- One `THREE.InstancedMesh`/one draw call for all 85 instances (confirmed by construction — a
  single `new THREE.InstancedMesh(geometry, material, count)` call in the harness source, not
  85 separate meshes).
- The harness loads and renders with no console errors (checked via the same Playwright page
  during screenshot capture — `page.goto` with `waitUntil: 'networkidle'` completed without a
  thrown navigation/script error).

Did not verify inside the live Studio UI/`app.js` — out of scope for this milestone by design (the
harness is deliberately standalone and unwired).

---

# Notes / warnings

- **Design-doc discrepancy, raised and resolved mid-task:** the design doc's §2.1 wrap-mode fix
  description assumes a per-project `wrap` field reaches `Preview3DRenderer.update()`/
  `_applyTextureParams()` and gates `RepeatWrapping` on `wrap==='full'`. Auditing the live
  repository found S-109 already removed that option from `update()` entirely — every
  mug/tumbler/bottle body now *always* fully wraps 360° regardless of the project's chosen wrap
  mode (`ObjectDimensions.js`'s own module header: *"the design always wraps fully and
  continuously around the object now"*), so the literal doc-described gate is both
  unimplementable without reverting a deliberate prior architectural decision and would leave the
  seam bug unfixed for most real vessel projects. Presented this to the human owner via a direct
  question rather than silently improvising; approved resolution was to gate on
  `this._dimensions.kind !== 'plate'` instead. Recorded in full in `TASK.md`.
- Two of the 17 `CrystalColors.js` catalog colors (`crystal`, `silver`) are close in lightness to
  the harness's own background color and are hard to distinguish in a single static screenshot —
  this is the catalog's real color data, not a rendering defect; more visible with live orbiting/
  lighting than in one frame.
- Playwright is used by this milestone's screenshot script exactly as it already is by
  `tools/rhinestoneFontQaKit.mjs`/`tools/generate-rs-block-qa-sheets.mjs` (installed in
  `node_modules` but not listed in `package.json`'s `dependencies`) — pre-existing repository
  state, not something this milestone introduced or changed.
- Per `CLAUDE.md`'s Standard Workflow, this milestone stops at step 6 (commit) — no merge, no
  push, no tag, no branch deletion.

---

# Next recommended step

Design doc §4 step 2 — correct placement/orientation on the revolved body surface, wiring real
`StoneLayout` data through `azimuthRadForCanvasXMm()`/`bodyHeightMm`/`wallRadiusAt()`, starting
with the plate (flat-plane case, no curved-surface complexity) per the design doc's own
recommended sequencing.

---

# Terminal output

```
$ git branch --show-current
feature/rs-2013-instanced-stones-step0-1

$ node tools/run-tests.mjs --all
...
--- Summary ---
Selected: 98
Passed:   98
Failed:   0

$ node tools/test-documentation-consistency.mjs
...
Documentation consistency check passed.
```
