# Rhinestone Studio — Task Result

This document is completed by the implementation engineer after finishing the current task.

---

# Task ID

RS-2013 (Implementation Phase) — §4 step 6: visual validation evidence

---

# Status

COMPLETE. Added a dev-only toggle for `instancedStones` in the real running Studio, captured
texture-vs-instanced comparison screenshots for one real example per product kind (plate/mug/
tumbler/bottle), and wrote an honest per-example comparison plus a consolidated statement of steps
3b/5b's known limitations against this evidence. **`instancedStones` still defaults to `false`
everywhere. No recommendation is made — the comparison below is evidence for Sasha's own call, not
a verdict.**

---

# Branch

`feature/rs-2013-instanced-stones-step6-visual-validation` (already checked out at task start, cut
from the step-5b throttle-mitigation commit `cdccc33`, verified as HEAD before any work began;
working tree was clean).

---

# 1. Toggling `instancedStones` in the real running Studio

## What already worked (confirmed, unchanged)

`window.__preview3D` (`app.js:836`, added by RS-2011 for render-count instrumentation) is a real,
already-exposed console handle onto the live `Preview3DRenderer` instance. Calling
`window.__preview3D.update(layout, {...options, instancedStones: true})` directly still works
today — but it required reconstructing the full options object (`cupColor`/`objectTemplate`/
`canvasWidthMm`/`canvasHeightMm`/`plateParams`/`vesselParams`) by hand in the console, and there was
no exposed reference to the live `layout` object to pass as the first argument, making this
awkward for repeated toggling on a real project rather than a quick one-off check.

## What was added (dev-only, temporary, isolated to `app.js`)

Two small, clearly-commented additions right next to the existing `window.__preview3D` debug
handle (`app.js:836-843`), both reusing the exact same `drawCup()` call `app.js` already makes for
every ordinary edit — no new rendering path, no new options object to reconstruct by hand:

1. **`?instancedStones=1` URL query param** — read once at page load into a module-level flag.
   Loading the Studio at `index.html?instancedStones=1` renders every project with the instanced
   path from the start.
2. **`window.__setInstancedStones(true|false)`** — a console helper that flips the flag live and
   immediately redraws the current project via the existing `drawCup()` — no page reload, no
   options object to rebuild by hand, no need to re-import/re-open whatever project is already
   loaded. This is what this step's own screenshot capture used to take the "before"/"after" shot
   of each pair from the exact same loaded project and camera state.

**Sasha's instructions:**
- To start already in instanced mode: open the Studio at `http://localhost:5173/index.html?instancedStones=1` (or append `?instancedStones=1` to whatever URL you normally use), then load any project as usual.
- To toggle on an already-open project: open the browser console and run `window.__setInstancedStones(true)` (or `false` to go back to the texture path). The Object Preview updates immediately.

Both are dev-only: never wired to any UI control, never persisted, never part of `project`, and
explicitly commented in `app.js` as temporary (RS-2013 step 6), to be removed once this evidence-
gathering purpose is done.

---

# 2. Selecting real examples per product kind

## A real gap found before capturing anything: the Gallery UI is currently disabled

The intended way to open a real committed `examples/*.rhs` project inside the actual Studio is the
Gallery feature (Menu → Gallery → card → "Open Copy"). On attempting this, `#menuGallery` is a
`disabled` button today: *"Gallery is temporarily unavailable while product scope is reduced
(S-103)."* This is the S-103 scope freeze (see memory `rhinestone_studio_scope_freezes.md`) — the
Gallery's data and code are intact, only its top-menu entry point is frozen. This is stated here
because it changes how "real committed example" evidence had to be gathered for this step, not
because fixing it was in scope (it explicitly is not).

**Workaround used, kept as real as possible:** the Studio's *other* live, un-frozen way to load a
project is the "Import Project JSON" file input (`#importProjectFile`). Its schema differs from
`examples/*.rhs`'s own gallery-fixture schema (e.g. `cxMm`/`stoneSizeMm` vs. the live app's
`cx`/`stoneSize`), so each real example was converted through `toAppProjectShape()`/
`validateRhsProject()` — the *exact same* bridge functions the (currently frozen) Gallery feature
itself calls internally (`src/gallery/index.js`, `src/gallery/RhsFixtureBridge.js`) — then imported
through the real file input. No stone position, color, or layer data was altered; only the schema
shape was translated, using the repo's own real conversion path, not a reimplementation of it.

## Chosen examples

| Product | Example | Why |
|---|---|---|
| mug | `examples/short-name-block.rhs` | Simple, single-color (`gold`) text design — a clean baseline read. |
| tumbler | `examples/tumbler-wrap-design.rhs` | Real wrap design, two colors (`gold` text + `crystal` outline ring) — gives a light-color data point on a curved surface. |
| bottle | `examples/bottle-front-design.rhs` | Real front-label design, three colors including `crystal-clear` — the exact color step 3b found its worst-case washout on. |
| plate | *(no committed example exists)* | Audited: every one of the 27 `examples/*.rhs` fixtures is mug/tumbler/bottle; none is a plate design. This is the identical gap step 2's own test harness (`rs2013-instanced-stone-harness.html`) hit and solved the same way — a small inline two-ring project (outer `gold` ring + inner `crystal` ring, 270mm canvas matching the plate's own default `outerDiameterMm`), imported through the real Import Project JSON input, not a synthetic stress fixture. |

This set satisfies the brief's requirement of including at least one light-stone-color (`crystal`/
`crystal-clear`) example without cherry-picking only saturated colors — both the tumbler and the
plate substitute carry `crystal`, and the bottle carries `crystal-clear` directly from a real
committed fixture.

**Honest caveat on the plate substitution:** it is a real design (real product template, real
`GeometryEngine`/`StoneLayout` pipeline, real production layer schema, imported through the actual
Studio's actual Import feature) but it was authored for this step, not pulled from
`examples/`, because no plate example exists there to pull. It is not a synthetic stress fixture
(only 2 rings, realistic stone counts), but it is not "an example a real customer already made"
either — flagged plainly rather than presented as more representative than it is.

---

# 3. Per-example honest comparison

All screenshots: `tools/rs2013-step6-<product>-texture.png` (current default) and
`tools/rs2013-step6-<product>-instanced.png` (flag on), same loaded project, same camera angle, same
lighting rig call (`instancedStones` also gates the extended lighting rig — see
`Preview3DRenderer.js`'s `_applyLightRig()` — so the "instanced" shot uses the extended rig, exactly
as it would if the flag were flipped for real).

### mug — `short-name-block.rhs` (gold text, "Emma")

Instanced reads **clearly better** for this design. The texture version renders "Emma" as a row of
soft amber discs with a baked, fixed-looking gradient. The instanced version shows each stone as a
small, distinct faceted diamond with real specular glints that shift with the per-stone rotation —
it visibly reads as "individual cut stones," not "printed dots," at normal viewing distance. This
matches step 3b's own finding that gold holds up well without any color/material special-casing.

### tumbler — `tumbler-wrap-design.rhs` (gold script text "Wanderlust" + crystal outline ring)

**Mixed for this specific design** — clearly better for the gold script text (same faceted-vs-disc
improvement as the mug), and the crystal outline ring reads *fine*, not washed out, since it sits
against this design's dark navy cup color rather than a light background (see §4 below). But a new,
previously-unreported visual artifact showed up here, specific to this design's near-360° ring
layer on a curved surface: near the seam where the wrap closes (both left and right silhouette
edges of the same physical seam, visible on both sides of the front view), the instanced stones
visibly cluster/overlap in screen space, while the texture version shows the same region as a
single, cleanly blurred column. This is very likely an artifact of viewing discrete 3D geometry at
a steep grazing angle near the surface silhouette (many different azimuths compress toward the same
screen-space position) versus the texture path's mipmap-blurred 2D appearance smoothing the same
region — not a data or placement bug (the underlying stone positions are the same real
`StoneLayout` both paths consume). This is a genuinely new observation from this step's own
evidence, not one of steps 3b/5b's already-known items — reported here as-is, not investigated or
fixed, per this step's scope.

### bottle — `bottle-front-design.rhs` (gold ring bands + serif brand text mixing gold/topaz/crystal-clear)

Instanced reads **clearly better**. The gold bands read as individually faceted stones the same way
the mug's text does. The `crystal-clear` portion of the brand text — the exact color step 3b found
its most severe washout on — is **legible and not washed out** in both the texture and instanced
renders here, because this design's cup color is a dark maroon (`#7a1f2b`), not the harness's own
flat light page background (`#e9eef5`) step 3b measured against. This directly answers step 3b's
own open item 3 (the harness's washout may be specific to the harness's own light background) for
this one design: on a dark real product body, the washout does not reproduce.

### plate — inline two-ring substitute (gold outer ring, crystal inner ring)

**Comparable, leaning better** for the instanced path, though the plate's default camera framing is
distant enough (the whole plate is small in frame) that the per-facet difference is much less
pronounced than on the mug/bottle close-ups. Both rings are legible in both renders; the crystal
ring shows individual facet glints in the instanced version that the texture version's soft dot
pattern doesn't have, but the effect is subtle at this camera distance. No washout: this design's
cup color (`#1f3556`, dark blue) again is not the light-background scenario step 3b measured.

---

# 4. Consolidated known limitations (from steps 3b/5b, not re-investigated) — applied to this evidence

- **Light-colored stones may wash out against the actual live background (step 3b finding).** Step
  3b measured this specifically against its own standalone test harness's flat, light page
  background (`#e9eef5`), and explicitly flagged as an open question whether this reproduces
  against a real product body color in the actual `Preview3DRenderer` scene. **This step's evidence
  partially answers that**: none of today's 4 real examples pair a light stone color with a light
  cup/body color (tumbler and plate both use dark cup colors with their `crystal` stones; the
  bottle uses a dark maroon body with its `crystal-clear` stones) — the washout scenario is not
  reproduced in any of this evidence, but that is because no real example captured here happens to
  create the light-on-light pairing, not because the underlying material/lighting limitation was
  fixed (it wasn't touched). A design with a light cup color (e.g. `examples/front-wrap-light-cup.rhs`,
  `#ffffff`) *and* a light stone color together was not available among today's real examples to
  test directly.
- **Dark stone colors were never tested (step 3b gap, still open).** None of the 4 examples chosen
  for this step happen to use a genuinely dark/saturated color like `jet`/`sapphire`/`siam`/
  `emerald` either (though several other `examples/*.rhs` fixtures do — e.g. `image-trace-monogram.rhs`
  uses `jet`, `circle-only.rhs` uses `sapphire` — they simply weren't among the 4 picked here to keep
  one example per product kind). This gap remains open, unchanged by this step.
- **Curved-surface products (mug/tumbler/bottle) at very high stone counts (~15,000 theoretical
  ceiling) have a real, only-partially-mitigated performance cost** (single-rebuild cost ~28-39ms at
  that ceiling even after step 5b's throttle) — **not a concern at today's realistic stone counts.**
  All 4 examples captured here are far below that ceiling (`short-name-block.rhs` and
  `tumbler-wrap-design.rhs` are simple single-line-text/ring designs, `bottle-front-design.rhs` is a
  multi-band label, the plate substitute is 2 outline rings) — every one of them is well within the
  ~1,000-stone realistic range step 5 measured at ~2ms, not the stress-tested ceiling. The step 5b
  limitation is real for a hypothetical future large design, but is not visible or relevant in any
  of this step's own evidence.
- **The plate path has no known performance concern at any tested stone count** — unaffected by, and
  not re-tested in, this step.
- **New item found in this step, not previously known:** the tumbler's near-360° ring layer shows
  visible stone clustering/overlap near the wrap seam in the instanced render at a steep grazing
  camera angle, not present (or not as visible) in the texture render at the same angle — see §3
  above. Not investigated further or fixed here, per this step's scope; flagged for whoever looks at
  this evidence next.

---

# Cleanup check

`du -sh tools/*.png` before this step's own captures: no matches (empty) — steps 5/5b's own reports
already confirmed no leftover screenshot assets remained in `tools/`. Confirmed clean again at the
start of this step; only this step's own 8 PNGs exist in `tools/` now.

---

# Testing

- `node -c app.js` — syntax check on the only source file touched, passes.
- Manual Playwright verification (via a scratch-only script, not committed — the milestone's
  Allowed Files list does not include a new `tools/*.mjs` script) confirmed:
  - `window.__setInstancedStones(true)` on a live, already-loaded real project immediately redraws
    the Object Preview via the instanced path — confirmed both by the dramatic visual difference
    between each pair's two screenshots (same camera state, same project) and by zero console/page
    errors across all 4 product kinds.
  - `?instancedStones=1` on initial page load exposes the same `window.__setInstancedStones`
    helper and the same underlying flag path, confirmed present via a separate headless check.
- No shared architecture, project schema, or exporter code changed — per `CLAUDE.md`'s testing
  policy, `npm test`/`npm run test:full` was not run for this step.

---

# Scope discipline

- `instancedStones` default is unchanged (`false`) everywhere — confirmed by re-reading the final
  `app.js` diff: the only new code reads a URL param / exposes a console helper, both defaulting to
  `false` unless explicitly set.
- No user-facing UI control was added — both mechanisms are console/URL-only, clearly commented as
  dev-only and temporary in `app.js`.
- None of steps 3b/5b's known limitations were fixed, re-investigated, or re-measured — §4 above
  only restates and honestly cross-references them against this step's own real-design evidence.
- No change to placement/orientation/lighting/material/throttle logic already shipped.
- No recommendation on whether to flip the default was made — §3/§4 are evidence, not a verdict.

---

# Deliverables

- `app.js` — dev-only `?instancedStones=1` URL param (`app.js:843`) + `window.__setInstancedStones(bool)`
  console helper (`app.js:844-845`), threaded into `drawCup()`'s existing `preview3D.update()` call
  (`app.js:1784`).
- Screenshots (8 total, all in `tools/`):
  - `tools/rs2013-step6-plate-texture.png` / `tools/rs2013-step6-plate-instanced.png`
  - `tools/rs2013-step6-mug-texture.png` / `tools/rs2013-step6-mug-instanced.png`
  - `tools/rs2013-step6-tumbler-texture.png` / `tools/rs2013-step6-tumbler-instanced.png`
  - `tools/rs2013-step6-bottle-texture.png` / `tools/rs2013-step6-bottle-instanced.png`
- `TASK.md` (this milestone's brief), `TASK_RESULT.md` (this file).
