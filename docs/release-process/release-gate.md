# Release Gate

A milestone is not ready until it passes these gates.

## 1. Functional tests

- Text change updates layout
- Font change updates layout
- Stone size change updates layout
- Gap change updates layout
- Color change updates layout
- 2D, 3D, and export use the same StoneLayout

## 2. Geometry tests

- Coordinates are in millimeters
- No duplicate stones
- Minimum gap is respected where applicable
- Long text auto-fits
- Stones remain inside printable area

## 3. Export tests

- Project JSON exports
- Layout JSON exports
- SVG exports in millimeters
- PNG exports render the same visible design

## 4. Visual QA

- Text is readable
- Cup is centered
- Handle is attached
- Stones are visible
- No obvious desynchronization

## 5. Known issues

Every known issue must be documented before release.

---

## Release Record

### Version 1.0 — released 2026-07-31 (`RC-008`)

`RC-008` closed Version 1.0 after an audit-first review: `npm run test:full` passed 100% (98/98),
no item in the `RC-002`–`RC-007` stabilization series was found deferred/unaddressed, and
`ARCH-REVIEW-001`'s three still-open findings were checked directly against the code and found
non-blocking:

- `Math.min(...array)`/`Math.max(...array)` stack-overflow risk — no such spread pattern exists
  over any per-stone-scale array in `src/geometry/**` or `src/export/**`; every existing spread use
  (stone-size catalogs, layer counts, shape/box counts) operates on small, bounded arrays, not
  per-stone arrays. Not present in the current codebase.
- 3D preview stone-texture seam artifact / `wrapS`/`wrapT` mode — `Preview3DRenderer.js` sets
  `ClampToEdgeWrapping` deliberately, not `RepeatWrapping`, because `applyAzimuthUv()` maps the
  texture's U axis 0→1 across the object's single physical seam with no tiling; there is nothing to
  double-sample. Investigated and confirmed already correct in `RS-2011`, regression-guarded by
  `tools/test-object-geometry-builder.mjs` tests 7/8/8b/8c. Not open.
- Dead `style.css` (2 lines, unreferenced by `index.html`/`app.js`) — confirmed still dead. Cosmetic
  repository-cleanliness item only; no effect on production correctness. Left in place (out of this
  milestone's scope to remove application files).

Known, explicitly non-blocking limitations carried forward from `RC-007`'s documentation audit
(missing `S-110`/`S-110A` spec file, a stale suite-count sentence in `docs/ARCHITECTURE.md`'s
Testing Philosophy section that already self-discloses as stale, and missing narrative
implementation-status paragraphs for `SEC-001`–`RC-006`) remain undone — documentation-completeness
gaps, not functional defects. Gallery (RS-2001) and Design Library (RS-1015) remain intentionally
UI-disabled (`S-103`, `RC-006`), not defects.

No version bump or git tag was made as part of `RC-008` — that remains a separate, explicit human
decision.

### RC-011 — release gate re-audit, 2026-08-03

Two substantial milestones landed on `develop` after `RC-008`'s gate-pass and were never audited
against it: `RS-2013` (replaced the entire texture-based 3D stone rendering path with instanced
faceted rendering — the largest architectural change since `RC-008`) and `TXT-104` (text height
accuracy). `RC-011` re-ran the gate against current `develop` (`6a84811`) to determine whether the
still-outstanding version-bump/tag/main-merge decision is now safe to make. `node
tools/run-tests.mjs --all` passed 100% (99/99, up from `RC-008`'s 98/98 — net +1 from two files
added since (`tools/test-font-height-ratios.mjs`, `TXT-104` step 1; `tools/test-preview3d-instanced-stones.mjs`,
`RS-2013` step 4) minus one file removed, *tools/test-stone-layout-texture.mjs* (deleted by `RS-2013`
step 7 along with the texture path it tested); `--all` discovers every `tools/test-*.mjs` file,
including `test-documentation-consistency.mjs`, so doc-consistency is covered by this run and is
not a separate check). `RC-009` (file-structure cleanup) and `RC-010` (review/ regeneration
audit — concluded "gate not satisfied, no action taken") are confirmed non-blocking/cosmetic: both
made zero `src/**`/`app.js`/`index.html` changes.

`ARCH-REVIEW-001`'s three findings were re-checked directly against current code, including the
new `RS-2013` instanced-rendering code, rather than assumed unchanged:

- `Math.min(...array)`/`Math.max(...array)` stack-overflow risk — still not present over any
  per-stone-scale array, now also checked against `src/preview3d/**` (`RS-2013`'s new code has no
  such spread at all). The existing spreads (`MixedSizeGenerator.js`'s catalog-size bounds,
  `PathBoolean.js`'s ≤2-box diagonal/bounding-box math, `MonogramGenerator.js`'s fill-scale
  candidates) remain small, bounded arrays, not per-stone arrays. Not open.
- 3D preview stone-texture seam artifact / `wrapS`/`wrapT` mode — **moot**, not merely re-confirmed:
  `RS-2013` step 7 deleted `StoneLayoutTexture.js` and the entire texture-based stone rendering path
  outright; `ClampToEdgeWrapping` no longer appears anywhere in the codebase in connection with
  stone rendering. The instanced replacement was checked for an analogous concern rather than
  assumed clean by association, and one was found, already investigated (not newly discovered by
  this audit): **grazing-angle instanced-stone clustering** (`RS-2013` step 6b) — a genuine
  screen-space property of discrete instanced geometry on a curved surface near the camera's
  silhouette edge, confirmed camera-relative (not stone-relative) by live rotation and confirmed to
  not be a placement bug by world-space nearest-neighbor distance analysis (ratio 1.0000
  everywhere). No fix made or proposed; carried into Known Issues below.
- Dead `style.css` — **resolved**, not merely re-confirmed dead: `RC-009` deleted the file outright
  (confirmed unreferenced, part of that milestone's ~112 MB cleanup). No longer present in the
  repository; nothing left to track.
- **New finding, not part of the original three:** `ObjectGeometryBuilder.js`'s
  `applyBodyHeightUv()`/`applyAzimuthUv()` still compute per-vertex UVs for the mug/tumbler/bottle
  body mesh, and `applyBodyHeightUv()`'s comment still references "`ClampToEdgeWrapping` (set on
  the texture in `Preview3DRenderer.js`)", but `Preview3DRenderer.js` now always sets
  `bodyMesh.material.map = null` (solid `cupColor` only) — the only consumer of that UV data was
  the texture path `RS-2013` step 7 deleted. Same severity class as the dead `style.css` item above:
  cosmetic dead code plus a stale comment, no effect on production correctness, not fixed here per
  this milestone's audit-only scope.

Category 1's "2D, 3D, and export use the same `StoneLayout`" invariant — the exact invariant
`RS-2013` had the most opportunity to violate — was verified directly against current `app.js`
rather than taken on `RS-2013`'s own step-commit claims: `updateAll()` calls
`engine.generate(project)` exactly once per edit and assigns the result to the single module-level
`layout`; `drawLayout()` (2D canvas), `drawCup()` → `preview3D.update(layout, …)` (3D), and every
export handler (`#exportSVG`, etc.) all read that same reference. Neither `Preview3DRenderer.js`
nor `ObjectGeometryBuilder.js` imports `GeometryEngine`. Backed by passing
`test-architecture-module-boundaries.mjs` and `test-render-export-pipeline.mjs`, both of which
cover `src/preview3d/**`.

Category 4 (Visual QA) has strong headless coverage for stone presence/placement correctness —
`test-preview3d-instanced-stones.mjs` verifies instance count matches stone count, per-instance
azimuth/radius/height/orientation for both mug and plate, and throttle-window correctness under
rapid edits — but headless Node tests exercise Three.js math only, not actual WebGL pixel output.
A live-browser screenshot pass (mug/tumbler/bottle/plate, default camera, current `develop` tip)
was performed as part of this audit, closing the gap left by `RS-2013` steps 3b/6/6b/6c's
verification having predated the step-7 texture-path removal. At default camera, all four products
show correctly faceted, non-mirrored stones. The plate specifically does not hold up under further
interaction: a small, unremarkable downward drag — well within the existing `OrbitControls`
`minPolarAngle`/`maxPolarAngle` constraints, not an edge case — mirrors the entire stone layout once
the camera's polar angle crosses ~90° (the horizon). Reproduced precisely via scripted
`OrbitControls`-formula mouse drags rather than trial-and-error: polar 89° still renders correctly,
90° is the first mirrored frame, and the mirroring persists through the full swept range up to 175°
(reproduced via a scripted camera sweep, a scratch investigation script deleted after use per this
repo's convention of not committing ad hoc QA/investigation tooling — not a citable permanent
artifact). Root cause, found by reading
`_updateInstancedStones()`'s plate branch in `Preview3DRenderer.js`: every plate stone is placed at
a fixed world height (`this._plateTopY`) with a hardcoded upward-facing normal (`normal.set(0, 1,
0)`, `Preview3DRenderer.js:462-467`) and no check of the stone-plane orientation relative to the
camera — so past ~90° polar the camera is looking at the underside of that fixed-orientation
geometry with an unobstructed view, well before the plate's own top-surface mesh would correctly
cull the stones from view. This is distinct from, though in the same code region as, the
already-documented plate rim/well relief simplification below — that item is about vertical
position only; this one is about orientation, and it is user-visible as backwards-reading stone
placement. `StoneLayout`/production mm data is unaffected; this is a preview-only rendering defect.

**DEFECT — plate stones render mirrored past ~90° camera polar angle.** Found by this audit's
live-browser Visual QA pass (see Category 4 above); not a documented visual limitation like the
three items below, and should not be read as one — it is trivially reachable through ordinary
camera interaction (a small downward drag well within the existing `OrbitControls` constraints, not
an edge case) and visually alarming (the entire stone design reads backwards). Root cause:
`_updateInstancedStones()`'s plate branch (`Preview3DRenderer.js:462-467`) places every stone at a
fixed world height and fixed upward-facing orientation with no check of camera-vs-stone-plane
relationship, so once the camera crosses the horizon relative to the plate it has an unobstructed
view of the stones' undersides. `StoneLayout`/production mm data is unaffected — this is a
preview-only rendering gap, not a production-correctness defect — but it is a real Category 4
functional failure, not a cosmetic or documented-limitation item, and is treated as blocking below.

Known issues documented for this release, carried forward or newly surfaced:

- Carried forward from `RC-008`/`RC-007`, still true, still non-blocking: missing `S-110`/`S-110A`
  spec file; a stale suite-count sentence in `docs/ARCHITECTURE.md`'s Testing Philosophy section
  ("twenty-seven suites" — actual count is now 100 `tools/test-*.mjs` files); missing narrative
  implementation-status paragraphs for `SEC-001`–`RC-006`; Gallery (RS-2001) and Design Library
  (RS-1015) remain intentionally UI-disabled (`S-103`, `RC-006`), not defects.
- New from `RS-2013`, all three investigated and left as accepted visual simplifications a user is
  unlikely to stumble into during ordinary use — unlike the plate-mirroring defect above, none of
  these is scoped as a defect requiring a fix before release:
  - **Plate rim/well relief flattening.** The plate's real printable top surface has ~12-15mm of
    genuine vertical relief (a concave well + sloped rim) — `RS-2013` step 2 found the design doc's
    original flat-plane assumption was wrong and corrected the *reference* plane (`plateTopY` is now
    read from the real built mesh at the well/rim transition, not a duplicated constant), but every
    stone is still rendered at that one fixed Y regardless of its own radial position — center-well
    and outer-rim stones sit on a single flat plane in the 3D preview rather than following the true
    concave/sloped profile. This is a 3D-preview visual simplification only; the production
    `StoneLayout` mm coordinates it's derived from are exact and unaffected.
  - **Grazing-angle instanced-stone clustering** (see `ARCH-REVIEW-001` bullet above) — appears on
    any curved-surface product (mug/tumbler/bottle) when a design's outline content sweeps far
    enough in azimuth to approach the camera's current grazing/silhouette edge.
  - **Extended lighting-rig ceiling.** `RS-2013` step 3's 4-light rig (now the only rig, since step 7
    removed the original 2-light texture-path rig) is a real, measured change (~3.4% RMSE) but does
    not read as a clearly better "faceted gem" than the original — a pixel-diff shows a uniform
    brightness/tone shift rather than a new facet-highlight pattern, a ceiling from the low-facet
    octahedron primitive and diffuse-dominant material response, not from this rig's specific
    angles. No further lighting work is proposed.

The version-bump/tag/main-merge decision `RC-008` deferred remains outstanding — `RC-011` is a
re-audit, not that decision, and made no `src/**`/`app.js`/`index.html` changes itself.

**Recommendation:** every other item audited in `RC-011` is non-blocking (moot, resolved, or an
accepted documented visual limitation, not a functional defect), and the automated suite is green
at 99/99. However, the live-browser Visual QA pass this audit performed found one real Category 4
failure — plate stones render mirrored past ~90° camera polar angle, reachable via ordinary
interaction, not a documented limitation — and the version-bump/tag/main-merge decision should wait
until it is fixed and re-verified live in a browser. Nothing else found in this audit should block
that decision; this one item does.

### RC-012 — RC-011-FIX addendum, 2026-08-04

`RC-011` found one real defect: plate stones render mirrored once the camera's polar angle crosses
~90° (the horizon). Root cause was a hardcoded upward-facing normal (`normal.set(0, 1, 0)`) in
`_updateInstancedStones()`'s plate branch of `Preview3DRenderer.js`, applied with no check of the
stone-plane orientation relative to the camera.

**Fix (`RC-011-FIX`, `b149830`):** a new `PLATE_MAX_POLAR_RAD` constant caps
`controls.maxPolarAngle` at `Math.PI / 2 - 0.05` (~87.14°) for `dimensions.kind === 'plate'` only,
applied in `_rebuildMesh()`. Other product kinds are unaffected. This was chosen over two
alternatives: hiding/fading stones past the horizon (would read as a bug — stones vanishing rather
than the camera simply being restricted) and a full per-camera-relative re-orientation of the
stone normals (would require building a new per-frame update path this codebase doesn't have, for
a case — viewing a plate from underneath — with no legitimate production use). Capping the camera
is the smallest correct fix: a plate has no legitimate view-from-underneath use case, so the
constraint matches physical reality rather than working around it.

**Verification:** a live-browser camera sweep (polar 45°–175°) confirmed no visual mirroring at any
angle. A numeric readback of `controls.getPolarAngle()` after each requested angle confirmed the
clamp fires exactly at 87.1352° for every requested angle ≥87° and passes through unclamped below
that — ruling out a no-op sweep script as an alternative explanation for the screenshots looking
unchanged. `node tools/run-tests.mjs --all` was 99 selected/98 passed/1 failed prior to this fix
(`test-documentation-consistency.mjs`, flagging this doc's now-corrected stale reference to a
deleted investigation script, fixed above in this same `RC-012` entry) and is 99/99 after.

This closes the one real defect `RC-011` found. `docs/release-process/release-gate.md` is now
self-contained ahead of the version-bump/tag/main-merge decision `RC-008` deferred.

### RC-014 — release-gate re-audit: RC-013 rigorous re-verification + FONT-CLEANUP-001/CLEANUP-002 spot-check, 2026-08-04

Three milestones landed on `develop` after `RC-012`'s gate-pass: `RC-013` (a second, unrelated
plate rendering defect), `FONT-CLEANUP-001`, and `CLEANUP-002` (repository/tooling hygiene, no
`src/**` logic changes). `RC-014` re-audits all three, with `RC-013` re-verified by a stricter,
programmatic method than `RC-011` used — see below for why that distinction matters.

**`RC-013` — plate vertical-flip fix, root cause.** Sasha reported plate text rendering vertically
flipped (a "V" reading as "Λ") in the Object Preview — a *different* defect from `RC-011`'s
mirroring bug: present at every camera angle, not just past the horizon. Root cause:
`_updateInstancedStones()`'s plate branch in `Preview3DRenderer.js` negated the Z term
(`-(stone.yMm - canvasHeightMm / 2)`), inverting the Y-to-Z mapping. This was very likely copied
from `applyPlateTopSurfaceUv()` in `ObjectGeometryBuilder.js`, where the negation legitimately
compensates for `THREE.CanvasTexture`'s `flipY = true` default — but stone positions carry no
texture and are never sampled by a `CanvasTexture`, so that compensation does not apply to them.

**Fix (`RC-013`, `6c1564b`):** removed the sign flip at both call sites (the UV helper's negation
is dormant for visible output since `RS-2013` step 7 set `material.map = null`, but was fixed
anyway for consistency). `tools/test-object-geometry-builder.mjs` and
`tools/test-preview3d-instanced-stones.mjs` each had one test with the old backwards sign locked
in as the expected value; both were updated to assert the corrected sign.

**Why `RC-011`'s sweep would not have caught this:** `RC-011`'s Category 4 Visual QA pass was a
live-browser screenshot review at each product's default camera position — a human eyeballing
whether the rendered output "looked right." That method is exactly what let this defect ship
undetected: a vertically flipped glyph is easy to miss by eye, especially in a short, unfamiliar
test string, and nothing about the sweep's process would have flagged it short of someone noticing
a specific letterform looked wrong. `RC-013` itself was only found because Sasha pushed back on an
initial (incorrect) diagnosis with graduated-angle screenshots — a stricter process than the
original sweep, but still visual, still dependent on someone truly looking.

**Verification (this audit, stricter than `RC-013`'s own live-browser check):** a scratch
verification script under `tools/` (gitignored, not committed — this repo's standing convention
for ad hoc QA tooling, the same one `RC-011`'s own investigation script followed) replaced
eyeballing with a numeric assertion. It generates a real `StoneLayout` for the glyph "F" (RS Block,
authored/rhinestone provider) — chosen because its top row is solid and every row below is just a
left stem, so a vertical flip is structurally unmistakable, unlike a vertically symmetric letter
such as "O" or "H" — runs it
through the real `Preview3DRenderer.update()` → `_updateInstancedStones()` plate branch (the exact
code `RC-013` fixed), decomposes each stone's real instance matrix, and projects it through the
real `THREE.Camera` via `Vector3.project(camera)` at the renderer's actual default "home" framing.
It then asserts that top-of-glyph stones (small design `yMm`, the 2D-canvas Y-down ground truth)
project to a smaller screen-space Y than bottom-of-glyph stones, and that the ordering is
monotonic across every stone — the check a visual sweep has no equivalent of. Repeated at a second,
near-top-down camera angle (0.2 rad from +Y) to rule out an angle-dependent regression. Both passed
cleanly, with zero inverted adjacent pairs at either angle.

As a negative control proving the check itself has teeth, the same projection was re-run with the
old, pre-`RC-013` buggy sign substituted back in: it correctly failed (top-of-glyph screen Y
306.7 landed *below*, not above, bottom-of-glyph screen Y 295.3 — the inverted ordering the real
defect produced). This confirms the script would have caught `RC-013` had it existed before that
fix, unlike `RC-011`'s sweep. `tools/test-preview3d-instanced-stones.mjs` (8/8) and
`tools/test-object-geometry-builder.mjs` (21/21) were also re-run directly and pass in full.

**`FONT-CLEANUP-001`/`CLEANUP-002` — repository hygiene, no logic changes.** `FONT-CLEANUP-001`
migrated the three fonts still loaded from the old `fonts`/`sources` tree at runtime (Baloo 2,
Sacramento, Dancing Script) into `assets/fonts/` (the convention every other live font already
used) and deleted the old top-level `fonts`, `review`, and `generated-fonts` directories entirely
(~246MB of obsolete font-R&D/QA artifacts, confirmed via `git ls-tree -r -l` against the
pre-cleanup tree). `CLEANUP-002` removed stale `RS-2013` step-6
texture-vs-instanced comparison PNGs (a closed, merged milestone with no remaining references) and
the `font-cal-001` tooling directory under `tools/` (calibration tooling for the already-rejected
Sacramento procedural-font approach, unreferenced by any test file).

**Verification:** loaded the app in a real browser and rendered a short "Studio" text layer in each
of Baloo2, Sacramento, and Dancing Script — all three render cleanly on both the 2D canvas and 3D
preview with no missing glyphs or console errors (screenshots reviewed, not committed — ad hoc QA
per this repo's convention). `du -sh tools/` was 2.6M before this audit's screenshot generation and
3.2M after (the 632K screenshot folder itself is gitignored); no stale prior-session screenshot or
scratch assets remained to delete — `CLEANUP-002` had already removed them. A grep for the deleted
`fonts`/`sources`, `review`, `generated-fonts`, and `font-cal-001` paths across `src/`, `app.js`,
`index.html`, and `docs/` found zero hits in the first three; the only `docs/` hits are in
`docs/specifications/*.md` historical milestone reports (exempt, per `FONT-CLEANUP-001`'s own
commit message and this project's historical-vs-authoritative documentation convention) plus one
narrative (non-path) mention of `RC-010` in this file. No stale references requiring action.

`node tools/run-tests.mjs --all` is 99/99, unchanged from `RC-012`. No `src/**`/`app.js`/
`index.html` regressions from any of the three milestones this entry covers. The
version-bump/tag/main-merge decision `RC-008` deferred remains outstanding.

### Version 1.1.0 — released 2026-08-27 (`v1.1.0`)

Version 1.1.0 is the first tagged release since `v1.0.1` (`729480c`, 2026-08-04). It closes the
version-bump/tag/`main`-merge decision `RC-008` originally deferred and that every subsequent gate
re-audit — `RC-011`, `RC-012`, `RC-014` — recorded as still outstanding. That decision has been
exercised exactly once before, for `v1.0.1`; this is the second time. The bump is semver-minor,
not major: everything below is additive — new tools, new UI surfaces, and internal
rendering-path swaps invisible to saved project files. Nothing removes a user-facing capability
or breaks project-JSON backward compatibility, regardless of how large the underlying effort was.

**Design becomes the primary view (`RS-3010`, `RS-3011`, `RS-3012`).** `RS-3010` built the
drawing-mode shell: a dedicated Paper.js viewport with a tool rail, rectangle/ellipse/slot/regular-polygon
presets, freehand and Pen (Bézier) tools, a background grid with autoscale for large designs,
grid/vertex/Shift-angle snapping wired into every snap site, marquee select, single-shape resize
handles, and space-held panning; Step 0 retired `src/library/**` and brought in Paper.js and
`@tarikjabiri/dxf`. `RS-3011` promoted Design to the default, reload-persistent primary view:
shapes become real project layers the moment they are drawn (Commit Shape removed), the stone
fields are mirrored into Design's own options panel, live per-shape stone dots render on the
canvas, stone generation is button-gated, layers are named by shape type, SVG can be imported
directly into Design as multi-contour geometry, and the Stamp / Trace / Eraser tools plus the
Paint-region data model and tool landed here. `RS-3012` unified selection — svg/image, text, and
circle layers all join Design's Select tool for click/drag/resize/rotate, and Stamp/Trace now
respect the active selection boundary.

**Paint region editing (`RS-3013`, `RS-3014`).** `RS-3013` made Select and Lasso twin selection
tools and added region-level move, copy/duplicate, delete, and per-region stone-spec editing.
`RS-3014` split Stamp/Trace/Paint style settings so each carries its own state, gave the Eraser a
sweep-preview corridor and a dual mode (stone erase plus outline cut), and fixed a cluster of
region-leak and edge-hugging-drag target-resolution bugs.

**Universal shape rotation (`RS-3027`–`RS-3034`).** Rotation became a first-class property of
every shape layer: `RS-3028` added the data model and GeometryEngine support, `RS-3029` the
rotate handle, UI field, and interaction, `RS-3030` resize handles that rotate with the shape.
`RS-3031`/`RS-3032` fixed Shape Library shapes (including those created via the More Shapes
popover) being invisible or untracked inside Design; `RS-3033`/`RS-3034` brought rotation and
rotated resize handles into Design's own Select tool. `RS-3027` added Shape Library shortcuts to
the Design toolbar, and a follow-up corrected rotated-layer bounding boxes in hit-test, snap, and
align.

**Units and Design-canvas QA (`RS-3015`–`RS-3026`).** `RS-3018` introduced the units architecture
(plus an `src/units` barrel); `RS-3019`–`RS-3025` then rolled inch display through every
convertible surface — per-layer geometry fields, Gap/Stamp/Trace/Paint/Eraser/snap-distance
fields, the grid and scale bars, the status bar and on-canvas text, and the Production Sheet
PDF/SVG export — with `RS-3023` adding the Left-panel Units dropdown and a permanent `(mm)` marker
on Stone size, `RS-3024` making numeric step/gradation unit-aware, and a fix for unit-toggle
round-trip drift on bare-DOM length fields. Alongside: `RS-3015` shortcut-key badges on the
Design toolbar, `RS-3016` grid autoscale, `RS-3017` an on-canvas scale bar for `#panel2D`, and
`RS-3026` a scale bar for Design/drawing mode.

**Monogram maturity (`MONO-007`–`MONO-011`).** `MONO-007`/`MONO-008` added Octagon, Pentagon, and
Shield frames plus a per-generation frame stone-width outline option; `MONO-009` made the frame
default size product-aware (excluding Plate); `MONO-010` gave the frame independent stone size
and color from the letters; `MONO-011` added a UI-layer frame-stone auto-shrink retry loop.

**Full-codebase audit fixes (`M2`/`M3`/`M5`/`M6`/`M7`/`M9`/`M12`/`M13`/`M14`).** `M2` fixed an
outline-2 monogram frame stone-spacing collapse; `M3` fixed SVG subpath-after-closepath fusion
per spec §9.3.4; `M5` implemented `preserveAspectRatio` in SVG viewBox mapping; `M6` backfilled
`MONO-007`/`008`/`010` test coverage; `M7` deduped the monogram color-picker populate functions;
`M9` backfilled `docs/ARCHITECTURE.md` for Design mode, Monogram, and Units; `M12` fixed an
embedded NUL byte in `StoneSampler.js`'s pair-key join; `M13` added an SVG polygon content cache
to `generateSvgLayout()`; `M14` added a move-drag translation fast path.

**Rendering and geometry refinements.** Consistent tangent-frame stone orientation in the 3D
preview; consistent stone counts and positions on congruent contours; faceted crystal-sprite
stones in Design view; Outline-mode stone spacing normalized to the whole perimeter with
corner-anchored per-side spacing for Rect/Polygon/Star/Arrow/Cross; a Stone Size picker that
greys out sizes that would overlap for the current shape; bulk-delete-by-area; and top-menu
active-state highlighting that persists across its lightbox. `RS-3001` (CSS-isolation spike) was
retired with a build-vs-vendor decision recorded.

**Testing gate.** The `tools/test-*.mjs` suite stands at 117 files, up from 100 at `v1.0.1`. The
1.1.0 gate requires `node tools/run-tests.mjs --all` and `node tools/run-tests.mjs --group
documentation` both green before the `develop`→`main` merge; both were confirmed by Sasha
immediately prior to tagging. No `src/**`, `app.js`, or `index.html` changes are part of this
release milestone itself — it touches only `package.json`, this file, and the `main` branch.
