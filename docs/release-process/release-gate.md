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
not a separate check). `RC-009` (file-structure cleanup) and `RC-010` (`review/` regeneration
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
Whether stones visually read as distinct faceted gems under the current lighting rig, on current
`develop`'s tip (post-step-7 texture-path removal), was last verified live in a browser during
`RS-2013` steps 3b/6/6b/6c, on intermediate commits rather than the current tip. **Flagged, not
performed as part of this audit:** a fresh live-browser screenshot pass (mug/tumbler/bottle/plate,
default camera) against current `develop` before finalizing a release decision — this milestone was
docs/tests-only and did not launch a browser.

Known issues documented for this release, carried forward or newly surfaced:

- Carried forward from `RC-008`/`RC-007`, still true, still non-blocking: missing `S-110`/`S-110A`
  spec file; a stale suite-count sentence in `docs/ARCHITECTURE.md`'s Testing Philosophy section
  ("twenty-seven suites" — actual count is now 100 `tools/test-*.mjs` files); missing narrative
  implementation-status paragraphs for `SEC-001`–`RC-006`; Gallery (RS-2001) and Design Library
  (RS-1015) remain intentionally UI-disabled (`S-103`, `RC-006`), not defects.
- New from `RS-2013`, both investigated and both left as documented visual limitations rather than
  fixed (neither is scoped as a defect requiring a fix before release):
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

**Recommendation:** the audited findings above are all non-blocking (moot, resolved, or documented
visual limitations, not functional defects), and the automated suite is green at 99/99. The one gap
this audit could not close itself is Category 4's live-browser verification against the current
tip — recommend capturing that screenshot pass (mug/tumbler/bottle/plate, default camera, current
`develop`) as a quick confirming step before making the version-bump/tag/main-merge decision, given
how much of `RS-2013`'s own validation evidence predates the step-7 texture-path removal. With that
one check done, nothing else found here should block the decision.
