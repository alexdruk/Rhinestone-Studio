# S-112 — Real Product Template: Round Dinner Plate

## Objective

Add the first real, non-cylindrical product template: a parameterized Round Dinner Plate, with
three design targets (Center Well, Rim Band, Full Top Surface), driven end to end by the approved
product-definition input `plate-round-dinner.json`. This is the first milestone to introduce a
product whose printable surface is a flat/radial disc rather than a revolved cylindrical wall
(Mug/Tumbler/Bottle) — it therefore also establishes the pattern a future non-cylindrical product
would follow.

## Current Repository State (audit findings)

- `src/products/ObjectTemplate.js` is the only template model: a small, validated registry
  (`mug`/`tumbler`/`bottle`), each record `{id, displayName, productionWidthMm, productionHeightMm,
  safeAreaInsetMm, wrap, preview}`. `preview.kind` was a closed 3-value set; `preview.*Factor` fields
  describe a revolved-cylinder-wall silhouette (top/bottom width ratio, body height ratio,
  neck/shoulder/cap for bottle). No existing notion of "design target," multiple printable regions,
  or a circular/annular safe area.
- `src/preview3d/ObjectDimensions.js`'s `computeBodyRadiusMm()` anchors every revolved-vessel kind's
  radius to `canvasWidthMm` on the assumption the production canvas *is* the object's unwrapped
  360° cylindrical surface. A plate's outer diameter is a direct physical spec, not a
  wrap-around-canvas artifact — this assumption does not hold for it.
- `src/preview3d/ObjectGeometryBuilder.js` builds mug/tumbler/bottle as a single
  `THREE.LatheGeometry` revolved profile, with two UV passes: `applyBodyHeightUv()` (V = vertical
  position / body height) and `applyAzimuthUv()` (U = azimuth around the vertical axis, computed
  from each vertex's known Lathe column index, deliberately not `atan2()`, to avoid two
  previously-fixed dark-band bugs — S-107/S-109). Both are azimuth/height-around-a-vertical-axis
  mappings, correct for a tall vessel wall, meaningless for a plate's flat top-down printable face.
- `app.js`'s `#objectType` control (`updateObjectTemplateDetail()`, the change handler at the
  `#objectType` listener) resets `project.canvas`/`project.wrap` to the new template's defaults. The
  Front View Frame (`drawFrontViewFrame()`/`frontViewFrameGeometry()`/`isPointerOnFrontViewFrame()`)
  and the printable-circumference/"too long" checks (`printableCircumferenceMm()`/
  `isTextTooLongForObject()`) are all cylinder-specific (wrap-around-a-circumference concepts) with
  no rectangular/circular equivalent.
- `src/export/ProductionSheetExporter.js`'s `computeProductionSheetLayout()` reads only plain,
  optional, caller-supplied options (`projectName`/`objectType`/`productionWidthMm`/
  `productionHeightMm`/`gapMm`/page options) and never branches on template id — designed to be
  extended with more optional fields.
- `app.js`'s project schema (`defaultProject()`/`validateProject()`) has no generic "extra params"
  bag; `project.product`/`project.canvas`/`project.wrap`/`project.cupColor`/`project.name` are the
  only top-level fields besides `layers`.

## Expected Visible Change

- `#objectType` gains a fourth option, "Round Dinner Plate."
- Selecting it reveals: a Plate dimensions field group (Outer Diameter, Inner Well Diameter,
  Overall Height, Center Depth, Design Target) in the Shapes Lightbox's Object Templates tab, and a
  Plate color swatch (White/Creme) in the workspace toolbar, in place of the generic cupColor swatch.
- The 2D Canvas draws a blue circular/annular printable-boundary guide (shape depends on the
  selected Design Target) instead of the amber Front View Frame.
- The Object Preview shows a real, rotationally-symmetric plate: slightly concave center well,
  smooth transition, sloped rim, rounded outer edge, visible foot ring, physically plausible
  thickness — with the live StoneLayout projected onto its top surface via a direct planar
  projection (continuous across the well/rim transition).
- Production Sheet exports include plate-specific header lines (design target, outer/inner
  diameter, rim width, overall height, weight, plate color) only for the plate template; a new "A3"
  page size option is available (required — see Known Limitations).

## Required Outcome / Architecture Requirements

Per the milestone brief:

- Product definition JSON → radial plate profile → design-target projection strategy → existing
  render/export pipeline. No second GeometryEngine/StoneLayout pipeline.
- The JSON (`src/products/definitions/plate-round-dinner.json`, checked in verbatim) is the single
  source of truth for ranges/defaults/color options/design-target metadata — consumed via the new
  `src/products/PlateProductDefinition.js`, never duplicated as scattered numbers in `app.js`.
- `outerDiameterMm = rimWidthMm*2 + innerWellDiameterMm` is never independently stored: rim width is
  always derived (`computeRimWidthMm()`), and an inconsistent stored/imported diameter pair is
  normalized back to a consistent one (`normalizePlateParams()`), never silently accepted.
- 3D profile: a single revolved `THREE.LatheGeometry` cross-section (well → rim → rounded edge →
  underside → foot ring → center), split into two meshes at the outer-edge apex — a printable top
  surface and a non-printable underside/rim-edge/foot-ring (no design texture there, matching a real
  manufactured plate). See `ObjectGeometryBuilder.js`'s `buildPlateProfilePoints()`/
  `buildPlateObjectMesh()`.
- Design-target projection: the top surface's UV is a direct planar `(worldX, worldZ) → (canvasXMm,
  canvasYMm) → (u,v)` projection (`applyPlateTopSurfaceUv()`) — not the cylindrical azimuth/height
  mapping. This is inherently continuous (no seam, no `atan2` branch-cut/r=0 sign issues the
  cylindrical mapping had to specifically guard against) and follows the rim's actual 3D slope
  rather than a flat overlay plane.
- 2D printable boundary: `src/products/PlateGuides.js`'s `getPlateDesignTargetGuide()` — pure
  geometry, plate-specific, **not** inside `GeometryEngine`. `app.js`'s `drawPlateDesignTargetGuide()`
  renders it (a new, plate-specific overlay, replacing the cylindrical Front View Frame for this
  template only).
- Stone generation is completely untouched: the plate's production canvas is just
  `project.canvas` (a square, kept in sync with the live outer diameter) — the exact same mm-space
  every layer type's `generate*Layout()` already writes into. No new `GeometryEngine` method, no new
  `Stone`/`StoneLayout` field.
- Project schema: one new, optional, top-level field, `project.plate` (present/meaningful only when
  `product==='plate'`), validated permissively (`normalizePlateParams()`, matching this codebase's
  existing "never throw for missing/legacy data" convention for `product`/`cupColor`/`wrap`).
  `defaultProject()` (still `product:'mug'`) also carries a default-valued `project.plate` so no
  call site needs a null-check.

## Allowed Files

- New: `src/products/definitions/plate-round-dinner.json`, `src/products/PlateProductDefinition.js`,
  `src/products/PlateGuides.js`, `tools/test-s112-round-dinner-plate.mjs`,
  `docs/specifications/S-112-RoundDinnerPlate.md`.
- Modified: `src/products/ObjectTemplate.js`, `src/products/index.js`,
  `src/preview3d/ObjectDimensions.js`, `src/preview3d/ObjectGeometryBuilder.js`,
  `src/preview3d/Preview3DRenderer.js`, `src/export/ProductionSheetExporter.js`, `app.js`,
  `index.html`, `package.json` (test script list only),
  `tools/test-object-template.mjs`, `tools/test-object-geometry-builder.mjs`,
  `tools/test-object-template-integration.mjs`, `tools/test-production-sheet-exporter.mjs`,
  `tools/test-svg-integration.mjs`, `tools/test-examples-regression.mjs`,
  `tools/test-image-trace-regression.mjs`, `tools/test-path-boolean-integration.mjs`,
  `tools/test-design-library-integration.mjs`, `tools/test-crystal-color-integration.mjs`
  (the last eight: mechanical `normalizePlateParams`/`getPlateDefaults` injection into pre-existing
  `validateProject()`/`defaultProject()` extraction sandboxes, plus one regex-slice fix that no
  longer matched after `updateStats()` was restructured — see Test Results).

## Forbidden Files

`src/geometry/**`, `src/renderer/**` (2D/legacy cup renderer), `src/svg/**`, `src/image/**`,
`src/editing/**`, `src/history/**`, `src/text/**`, `src/fonts/**`, `src/export/SvgExporter.js`,
`src/export/PdfDocument.js` — none of these were touched; StoneLayout/Stone are untouched.

## Out of Scope

Salad/dessert/bread/pasta/charger/coupe/square/rectangular/divided/serving plates. Per-target 3D
projection masking (the printable-boundary guide is advisory, exactly like the pre-existing
rectangular safe-area guide already is for Mug/Tumbler/Bottle — see Known Limitations).
Foot-ring dimensions as user controls (kept in the JSON/default model, per the brief's own
allowance). DXF export.

## Automated Tests

`npm test` (updated to include the new suite) — see Test Results in `TASK_RESULT.md`.

## Browser/Manual Verification

See `TASK_RESULT.md`.

## Acceptance Criteria

- Default plate model matches the JSON exactly: 270/195mm diameters, 37.5mm derived rim width,
  25mm height, 12mm center depth, 165mm/5mm foot ring, ~800g, White default / Creme alternative.
- All three design targets selectable, each visibly changing the 2D guide, dimension labels, and
  Production Sheet metadata.
- Mug/Tumbler/Bottle behavior, StoneLayout generation, and every export unrelated to the plate are
  byte-identical to before this milestone.
- `npm test` passes in full.

## Implementation Constraints

Millimeters internally throughout; no pixel math outside rendering. No new dependency. No bundler.

## Required Commands

`npm test`, `git diff --check`, `git status`, `git log -1 --oneline`, `git push`.

## Commit Message

See the actual commit — one logical commit for this milestone.

## Deliverables

See `TASK_RESULT.md`.

## Next Milestone

Not attempted here (out of scope): a second non-cylindrical product (e.g. a square/rectangular
plate) to confirm `PlateGuides.js`'s pattern generalizes; per-target overflow validation for the
plate (mirroring `isTextTooLongForObject()`'s cylindrical-only warning); large-format Production
Sheet tiling instead of requiring A3 for the plate's default size.
