# Task

**Task ID:** S-112
**Task Type:** Real Product Template — Round Dinner Plate
**Specification:** `docs/specifications/S-112-RoundDinnerPlate.md`
**Status:** IMPLEMENTED
**Branch:** feature/s-112-round-dinner-plate

## Goal

Add a realistic, parameterized Round Dinner Plate product template — the first non-cylindrical
product — with three design targets (Center Well, Rim Band, Full Top Surface), driven end to end by
the approved product-definition input `plate-round-dinner.json`.

## Required Outcome

See `docs/specifications/S-112-RoundDinnerPlate.md` in full. Summary:

* Audit-first: walked `src/products/ObjectTemplate.js`, `src/preview3d/**`, `app.js`'s object-type
  wiring, `src/export/ProductionSheetExporter.js`, and the project schema (`defaultProject()`/
  `validateProject()`) before writing any code. Confirmed the cylindrical templates' entire mm model
  (`computeBodyRadiusMm()`'s canvas-width-as-circumference anchor, `applyAzimuthUv()`/
  `applyBodyHeightUv()`'s azimuth/height UV mapping, the Front View Frame's wrap-around highlight)
  does not apply to a flat plate, and that no existing circular/annular guide exists anywhere in the
  codebase.
* `plate-round-dinner.json` is checked in verbatim
  (`src/products/definitions/plate-round-dinner.json`) as the single source of truth for ranges,
  defaults, color options, and design-target metadata, loaded via the new
  `src/products/PlateProductDefinition.js` (`getPlateDefaults()`, `getPlateColorOptions()`,
  `computeRimWidthMm()`, `normalizePlateParams()`, ...).
* `src/products/ObjectTemplate.js`: `preview.kind` gains `'plate'`; `createObjectTemplate()`
  relaxes its cylindrical `topWidthFactor`/`bottomWidthFactor`/`bodyHeightFactor` requirement for
  that kind (they do not apply to a flat radial disc — the plate's real dimensions come from
  `project.plate` at runtime, not fixed template ratios). A new `plate` template entry:
  `productionWidthMm`/`productionHeightMm` = the live outer diameter (a square canvas bounding the
  disc — the plate's own "unwrapped surface" equivalent), zero rectangular safe-area inset (the real
  boundary is circular, drawn separately).
* `src/preview3d/ObjectDimensions.js`: `computeObjectDimensionsMm()` gains a `plate` branch that
  takes a normalized `plateParams` argument (outer/inner radius, rim width, overall height, center
  depth, foot-ring dims, design target) instead of deriving anything from `canvasWidthMm`
  circumference.
* `src/preview3d/ObjectGeometryBuilder.js`: `buildPlateProfilePoints()`/`buildPlateObjectMesh()`
  build a single revolved `LatheGeometry` cross-section (concave well → sloped rim → rounded outer
  edge → underside → foot ring → center), split at the outer-edge apex into a printable top-surface
  mesh and a non-printable underside mesh. `applyPlateTopSurfaceUv()` is a new, direct planar
  `(worldX, worldZ) → canvas mm → (u,v)` projection — not the cylindrical azimuth/height mapping —
  inherently continuous across the well/rim transition, with no seam/branch-cut concern.
* `src/preview3d/Preview3DRenderer.js`: `update()` gains an optional `plateParams` option (passed
  straight through to `buildObjectMesh()`); the underside mesh's color tracks `cupColor` like the
  mug handle's already does; camera framing uses a closer-to-top-down default polar angle for the
  plate kind.
* `src/products/PlateGuides.js` (new, plate-specific, outside `GeometryEngine`):
  `getPlateDesignTargetGuide()` — pure circle/annulus geometry for the selected design target.
* `app.js`: new `project.plate` field (optional, normalized permissively, present on every project
  via `defaultProject()`/`validateProject()`); new UI controls (Outer/Inner Diameter, Overall
  Height, Center Depth, Design Target, Plate color); `drawPlateDesignTargetGuide()` replaces the
  Front View Frame for the plate; `isPointerOnFrontViewFrame()`/`isTextTooLongForObject()` opt the
  plate out of cylindrical wrap-around concepts; Production Sheet options gain plate-only fields.
* `src/export/ProductionSheetExporter.js`: header height becomes dynamic (was a fixed 7-body-line
  constant) to accommodate the plate's six extra header lines without overflow; a new `A3` page size
  (the plate's ~270-300mm square does not fit A4/Letter at any margin — a real physical constraint,
  not a defect — this exporter's pre-existing "no scaling" policy correctly throws a clear
  `RangeError` for that case).

## Rules

* Follow `docs/AI_ENGINEER.md`, `docs/CLAUDE_GUIDE.md`, `docs/ARCHITECTURE.md`,
  `docs/MILESTONE_WORKFLOW.md`.
* Repository is the source of truth; audit before implementing; do not guess.
* Do not create a second GeometryEngine/StoneLayout pipeline. Do not hardcode plate dimensions
  outside `plate-round-dinner.json`/`PlateProductDefinition.js`.
* Do not modify `GeometryEngine.js`, `StoneLayout.js`, `src/renderer/**`, `src/svg/**`,
  `src/image/**`, `src/editing/**`, `src/history/**`, `src/text/**`, `src/fonts/**`.
* Mug/Tumbler/Bottle behavior and every pre-existing project file must remain unchanged.

## Deliverables

* `src/products/definitions/plate-round-dinner.json`, `src/products/PlateProductDefinition.js`,
  `src/products/PlateGuides.js`, `src/products/ObjectTemplate.js`, `src/products/index.js`.
* `src/preview3d/ObjectDimensions.js`, `src/preview3d/ObjectGeometryBuilder.js`,
  `src/preview3d/Preview3DRenderer.js`.
* `src/export/ProductionSheetExporter.js`.
* `app.js`, `index.html`.
* `tools/test-s112-round-dinner-plate.mjs` (new, 23 checks) plus updates to
  `tools/test-object-template.mjs`, `tools/test-object-geometry-builder.mjs`,
  `tools/test-object-template-integration.mjs`, `tools/test-production-sheet-exporter.mjs`, and five
  other pre-existing suites that extract `validateProject()`/`defaultProject()` from `app.js` into a
  sandboxed `Function` (needed `normalizePlateParams`/`getPlateDefaults` injected).
* `docs/specifications/S-112-RoundDinnerPlate.md` — full audit findings, architecture, and
  implementation record.
* `npm test` passing in full (823/823 checks, 0 failures).
* Real-browser verification and `TASK_RESULT.md` completed.
* Feature branch pushed (not merged).
