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
