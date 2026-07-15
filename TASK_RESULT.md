# Rhinestone Studio — Task Result

This document is completed by the implementation engineer after finishing the current task.

---

# Task ID

S-112 — Real Product Template: Round Dinner Plate

---

# Status

IMPLEMENTED

---

# Branch

feature/s-112-round-dinner-plate (cut from `develop`, per this milestone's "do not merge"
instruction).

---

# Commit

Do not write the current commit hash into this file — this file is part of the same commit it
describes. Obtain it from Git history with:

```bash
git log -1 --oneline
```

---

# Audit Findings

Full detail is in `docs/specifications/S-112-RoundDinnerPlate.md`. Summary:

1. **`src/products/ObjectTemplate.js`** was the only template model — a validated registry of
   `mug`/`tumbler`/`bottle`, each described entirely by revolved-cylinder-wall ratios
   (`preview.topWidthFactor`/`bottomWidthFactor`/etc.). No existing notion of "design target,"
   multiple printable regions, or a circular/annular safe area anywhere in the codebase.
2. **`src/preview3d/ObjectDimensions.js`**'s `computeBodyRadiusMm()` anchors every revolved-vessel
   kind's radius to `canvasWidthMm` on the premise that the production canvas *is* the object's
   unwrapped 360° cylindrical surface. A plate's outer diameter is a direct physical spec, not a
   wrap-around-canvas artifact — confirmed this assumption does not extend to a flat product.
3. **`src/preview3d/ObjectGeometryBuilder.js`** builds every revolved-vessel kind as one
   `THREE.LatheGeometry` with two UV passes tied to the vertical axis
   (`applyBodyHeightUv()`/`applyAzimuthUv()`) — both azimuth/height-around-a-vertical-axis mappings,
   correct for a tall wall, meaningless for a plate's flat top-down face.
4. **`app.js`**'s Front View Frame (`drawFrontViewFrame()`/`frontViewFrameGeometry()`/
   `isPointerOnFrontViewFrame()`) and the printable-circumference/"too long" checks
   (`printableCircumferenceMm()`/`isTextTooLongForObject()`) are cylinder-only wrap-around concepts
   with no rectangular/circular equivalent anywhere.
5. **`src/export/ProductionSheetExporter.js`**'s `computeProductionSheetLayout()` reads only plain,
   optional caller-supplied options and never branches on template id — confirmed extensible without
   touching its core geometry/fit logic. Its header height was a *fixed* constant (7 body lines),
   which the plate's extra metadata lines required making dynamic (see Implementation Summary).
6. **Project schema** (`defaultProject()`/`validateProject()`) had no generic "extra params" bag —
   `project.product`/`canvas`/`wrap`/`cupColor`/`name` were the only top-level fields besides
   `layers`. A new, optional `project.plate` field was the natural, minimal extension, following the
   exact same "always present, permissive-default, never throws for old data" pattern already used
   for `product`/`cupColor`/`wrap`.
7. Confirmed `GeometryEngine`/`StoneLayout`/`CanvasRenderer2D.js` are **entirely product-shape
   agnostic already** — a plate's production canvas is just `project.canvas` (kept square, sized to
   the live outer diameter), the exact same mm space every layer type's `generate*Layout()` already
   writes into. No geometry-generation change was needed anywhere.

---

# Architectural Decision

Followed the milestone brief's required pipeline exactly:

```
plate-round-dinner.json (checked in verbatim)
  → src/products/PlateProductDefinition.js (ranges/defaults/colors/design-target metadata)
  → src/preview3d/ObjectDimensions.js (plate branch: live mm dims, no canvas-circumference anchor)
  → src/preview3d/ObjectGeometryBuilder.js (radial LatheGeometry profile + direct planar UV)
  → existing render/export pipeline (StoneLayoutTexture, CanvasRenderer2D, ProductionSheetExporter — unmodified)
```

No second `GeometryEngine`/`StoneLayout` pipeline was created. No plate dimension is hardcoded
anywhere outside the JSON/`PlateProductDefinition.js`. The 2D printable-boundary guide
(`src/products/PlateGuides.js`) is plate-specific and lives at the product-projection level, not
inside `GeometryEngine`, per the brief's explicit instruction.

---

# JSON Integration Summary

`src/products/definitions/plate-round-dinner.json` is the approved input, checked in byte-identical.
`src/products/PlateProductDefinition.js` is the only module that reads it (via a native
`with { type: 'json' }` import, verified to work in both Node 22 and current Chromium — no `fetch`/
build step needed), exposing: `getPlateDefaults()`, `getPlateDimensionRange()`/
`clampPlateDimensionMm()` (the JSON's min/max/average ranges), `getPlateColorOptions()`/
`getPlateColor()` (White default, Creme alternative, exact JSON ids/hex), `getPlateDesignTargetMeta()`/
`isValidPlateDesignTarget()` (Center Well/Rim Band/Full Top Surface), `computeRimWidthMm()`/
`validatePlateDiameters()` (rim width is **always derived**, never independently stored), and
`normalizePlateParams()` (the one place a possibly-missing/malformed/legacy `project.plate` is
turned into a complete, physically-consistent record — clamped to the JSON's own ranges, with an
inconsistent inner/outer diameter pair falling back to the JSON's own default ratio rather than
throwing).

`src/products/ObjectTemplate.js`'s `plate` template consumes only `getPlateDefaults()`/
`PLATE_ROUND_DINNER_DEFINITION.name` — no plate number is duplicated as a separate literal anywhere
in `app.js`.

---

# 3D Profile Construction

`src/preview3d/ObjectGeometryBuilder.js`'s `buildPlateProfilePoints()` builds one shared 14-point
radial cross-section (well center → concave well curve → rim/well transition → sloped rim → rounded
outer edge apex → underside rim slope → foot ring outer wall → table contact → foot ring inner wall
→ underside center), all offsets expressed as fractions of the plate's own live dimensions (never a
fixed mm constant). `buildPlateObjectMesh()` splits this at the shared outer-edge apex into two
`THREE.LatheGeometry` meshes:

- **`bodyMesh`** (top printable surface, well through rim) — carries the live `StoneLayoutTexture`
  canvas texture, exactly like every other kind's `bodyMesh`.
- **`underMesh`** (rim underside + foot ring) — plain material colored to the live plate color, no
  design texture (a real manufactured plate has no rhinestones under the rim).

Both use `computeVertexNormals()` (forcing normals from actual triangle winding rather than
LatheGeometry's own per-point-tangent analytic calculation, which the well's non-monotonic/concave
profile made unreliable — see Known Limitations/debugging notes below) and are traversed in the
direction that produces upward-facing normals for the given profile shape (matching the bottle cap's
own r-decreasing-while-y-increasing convention for a concave-from-outside surface). Real-browser
verification confirms: rotationally symmetric, a true circle in plan view, real physical thickness
(top surface floats above the underside, never coincident), a visible foot ring that actually
touches the table plane, reaches the full outer diameter and `overallHeightMm` at the rim's outer
top edge, and stays well short of a bowl-like depth.

---

# Design-Target Mapping Explanation

**3D projection** (`applyPlateTopSurfaceUv()`): a direct planar projection of each top-surface
vertex's own world X/Z position onto the flat production canvas — `u = (canvasWidthMm/2 + worldX) /
canvasWidthMm`, `v = (canvasHeightMm/2 − worldZ) / canvasHeightMm`. This is the same projection
*regardless of the selected design target* — it needs no seam handling (unlike the cylindrical
azimuth mapping, which specifically has to dodge an `atan2` branch cut and an r=0 sign instability),
because a plate has no wrap-around edge: X/Z vary smoothly and continuously across the entire disc,
including across the well/rim transition (satisfying Full Top Surface's "projection must remain
continuous" requirement) and across the rim's actual slope (satisfying Rim Band's "design must
follow the sloped rim surface" requirement — confirmed visually: curved text on the Rim Band
genuinely follows the rim's 3D curvature, not a flat overlay).

**2D printable boundary** (`src/products/PlateGuides.js`'s `getPlateDesignTargetGuide()`): a pure
function returning a circle (Center Well: radius = inner well; Full Top Surface: radius = outer
diameter, plus a dashed inner transition guide) or a true annulus (Rim Band: outer + inner radius).
`app.js`'s `drawPlateDesignTargetGuide()` renders this in place of the cylindrical Front View Frame
for the plate template only. This boundary is advisory (like the pre-existing rectangular safe-area
guide for every other template) — it never clips the `StoneLayout`; the 2D production layout remains
the single source of truth for every layer type, exactly as required.

**Selection wiring**: `#plateDesignTarget` (Object Templates tab of the Shapes Lightbox), defaulting
to Center Well, writes `project.plate.designTarget`. Changing it visibly updates: the 2D guide shape,
the plate detail hint text (rim width/weight/target name), the Production Sheet's "Design target"
header line, and (since the mesh rebuild key includes the full `plateParams`, including
`designTarget`) triggers an Object Preview mesh rebuild — though the projection math itself is
target-invariant by design, so the *visible* 3D change comes entirely from whatever `StoneLayout`
content the operator has actually placed, not from the target selection re-clipping anything.

---

# Files Changed

```
src/products/definitions/plate-round-dinner.json    (new — approved input, checked in verbatim)
src/products/PlateProductDefinition.js               (new — JSON loader/validator/normalizer)
src/products/PlateGuides.js                           (new — 2D design-target guide geometry)
src/products/ObjectTemplate.js                        ('plate' preview.kind + template entry;
                                                         relaxed cylindrical-factor requirement for it)
src/products/index.js                                 (barrel: exports the 3 new modules' symbols)

src/preview3d/ObjectDimensions.js                      (plate dimension branch, no canvas-circumference
                                                         anchor)
src/preview3d/ObjectGeometryBuilder.js                 (buildPlateProfilePoints()/buildPlateObjectMesh()/
                                                         applyPlateTopSurfaceUv(); two-mesh plate silhouette)
src/preview3d/Preview3DRenderer.js                     (plateParams passthrough; plate-specific camera
                                                         polar angle; underMesh color tracking; texture
                                                         recreation-on-resize fix -- see Known Limitations)

src/export/ProductionSheetExporter.js                  (dynamic header height; 6 plate-only header lines;
                                                         'A3' page size added)

app.js                                                 (project.plate schema; plate UI field wiring;
                                                         drawPlateDesignTargetGuide(); cylindrical-concept
                                                         opt-outs; Production Sheet options)
index.html                                             (Round Dinner Plate template option; plate
                                                         dimension/design-target field group; plate color
                                                         swatch; A3 page-size option)
package.json                                           (registered the new test file in test/test:integration/
                                                         test:full)

tools/test-s112-round-dinner-plate.mjs                 (new — 23 checks: JSON/defaults/ranges/rim-width/
                                                         colors/design-targets/target-switching/
                                                         GeometryEngine-reuse/save-load/backward-compat/
                                                         Production-Sheet/UI-wiring)
tools/test-object-template.mjs                         (+2 checks: plate registered, relaxed-factor validation)
tools/test-object-geometry-builder.mjs                 (+6 checks: plate mesh structure/silhouette/UV/
                                                         underside/live-resize)
tools/test-object-template-integration.mjs             (products-barrel import assertion generalized;
                                                         normalizePlateParams/getPlateDefaults injected
                                                         into the validateProject()/defaultProject()
                                                         extraction sandbox)
tools/test-production-sheet-exporter.mjs               (test 16 rewritten: plate fits A3, correctly throws
                                                         on A4/Letter)
tools/test-svg-integration.mjs, tools/test-examples-regression.mjs,
tools/test-image-trace-regression.mjs, tools/test-path-boolean-integration.mjs,
tools/test-design-library-integration.mjs              (mechanical: normalizePlateParams injected into
                                                         each file's own validateProject() extraction
                                                         sandbox, matching the getObjectTemplate precedent
                                                         already there)
tools/test-crystal-color-integration.mjs                (no source change needed — its own regex-slice
                                                         assertion needed no update once updateStats() was
                                                         refactored into two named helper functions, see
                                                         below)

TASK.md, docs/specifications/S-112-RoundDinnerPlate.md  (this milestone)
TASK_RESULT.md                                          (this file)
```

`GeometryEngine.js`, `StoneLayout.js`, `src/renderer/**`, `src/svg/**`, `src/image/**`,
`src/editing/**`, `src/history/**`, `src/text/**`, `src/fonts/**`, `src/export/SvgExporter.js`,
`src/export/PdfDocument.js` are untouched.

---

# Project-Schema Impact

One new, optional, top-level field: `project.plate = {outerDiameterMm, innerWellDiameterMm,
overallHeightMm, centerDepthMm, footRingOuterDiameterMm, footRingHeightMm, colorId, designTarget}`.

- `defaultProject()` (still `product:'mug'`) seeds it with `getPlateDefaults()` unconditionally, so
  every project — including Mug/Tumbler/Bottle — carries a valid `project.plate` bag even though
  it's only meaningful once `product==='plate'`. This avoids a null-check at every call site
  (`drawCup()`, Production Sheet options, the guide overlay).
- `validateProject()` runs any incoming `obj.plate` (present or not) through `normalizePlateParams()`,
  which supplies the JSON's own defaults for anything missing/malformed and re-derives a consistent
  diameter pair for anything inconsistent — **never throws**, matching this file's existing
  permissive style for `product`/`cupColor`/`wrap`.
- **Backward compatibility confirmed**: a pre-S-112 Project JSON (no `plate` field at all) imports
  cleanly, `product` stays `'mug'`, canvas/stats are byte-identical to before this milestone (verified
  both by `tools/test-s112-round-dinner-plate.mjs` test 15 and by a real-browser import of a
  hand-written legacy-shaped project file — zero console errors, correct stats).

---

# Test Results

| Command | Files | Assertions | Result |
|---|---:|---:|---|
| `npm test` | 57 | 823 | **PASS**, 0 failures |

`git diff --check` — clean, no whitespace errors.

New/updated coverage specific to this milestone: JSON validation and shape, default values matching
the JSON exactly, parameter-range clamping, derived rim-width consistency (including an
inconsistent-pair fallback), White default/Creme alternative colors, radial 3D profile generation
(silhouette shape, thickness, foot ring, rotational symmetry, live-resize scaling), the direct planar
UV projection formula (unit-tested against the actual live vertex buffer, not just in isolation),
all three design-target guides and target-switching, `GeometryEngine` reuse for text/circle/SVG
layers on the plate's canvas (proving no second stone-generation pipeline exists), save/load,
backward compatibility, Production Sheet plate metadata, and structural UI wiring (field visibility
toggling, history-tracking, the `#objectType`/`drawPlateDesignTargetGuide()`/`drawCup()` wiring).

---

# Browser Verification

Headless Chromium (Playwright 1.61.1, already present in `node_modules`/cache — no network
install needed), `python3 -m http.server 5173`, real app, no mocks, isolated browser instances only
(never the user's own Chrome). Every check below is zero console errors / zero page errors unless
noted.

**Real bugs found and fixed during this verification** (the app did not render a usable plate before
these fixes — documented in full so a reviewer can judge the fixes, not just trust the final
screenshots):

1. **Object Preview was a blank canvas for the plate.** `Preview3DRenderer._frameCamera()` destructured
   `bodyRadiusMm`/`topRadiusMm` — fields that only exist on the *revolved-vessel* dimensions object,
   not the plate's (`outerRadiusMm`/`innerWellRadiusMm`). `Math.max(undefined, undefined)` produced
   `NaN`, corrupting the camera distance/position (silently — `NaN` in a `Vector3` throws nothing).
   Fixed by falling through to `outerRadiusMm` when `bodyRadiusMm`/`topRadiusMm` are absent.
2. **The plate rendered but the design texture was invisible** (a flat grey silhouette, no stones).
   `THREE.LatheGeometry`'s own per-point-tangent analytic normal calculation, combined with the
   profile's traversal direction (well outward to rim, the same "r and y increasing together"
   direction the mug/tumbler *wall* uses), produced normals facing away from a top-down camera —
   correct for a convex wall seen from the side, wrong for a concave top surface seen from above.
   Fixed by reversing the top surface's point order (rim → well center, matching the bottle cap's own
   concave-from-outside convention) and forcing `computeVertexNormals()` on both plate meshes (the
   well's non-monotonic/concave curve made the analytic per-point normal unreliable even after
   reversal — confirmed empirically: an unlit `MeshBasicMaterial` test still showed a partially dark
   surface before this second fix).
3. **After fix 2, the design texture rendered as a garbled, mirrored, dark-navy-tinted disc** (not the
   correct light color/orientation). Root-caused via direct GPU-state inspection (dumping the live
   `THREE.CanvasTexture`'s source canvas, the mesh's actual UV buffer, and the scene graph) to two
   independent problems: (a) a **stale GPU texture** — resizing the shared `HTMLCanvasElement` texture
   source via `.width=`/`.height=` (needed because the plate's 2160×2160px texture is far larger than
   any cylindrical template's) does not reliably force a full GPU texture reallocation in this
   environment, leaving the *previous* object template's rendered content (including its `cupColor`)
   bound after a large size jump; fixed by disposing and reconstructing the `THREE.CanvasTexture`
   whenever the pixel size actually changes, not just redrawing its source canvas. (b) a genuine
   **V-axis sign error**: the plate's UV, unlike every revolved-vessel kind's, ties its V coordinate to
   a *horizontal* world axis (Z, since the printable face lies in the X-Z plane) rather than the
   object's own vertical axis — combined with `CanvasTexture`'s default `flipY=true` and this
   preview's near-top-down camera (positioned at +Z, looking toward −Z), the object's own +Z needed to
   map to the *bottom* of the 2D design, not the top; fixed by negating the Z term
   (`canvasYMm = canvasHeightMm/2 − worldZ`, not `+worldZ`).

All three fixes are reflected in the shipped code (`Preview3DRenderer.js`/`ObjectGeometryBuilder.js`)
with inline comments explaining the reasoning, and the corresponding Node unit test
(`tools/test-object-geometry-builder.mjs` test 16) was updated to assert the corrected formula against
the real, live vertex buffer (not a hand-derived expectation), so a regression would be caught without
needing a browser.

**Post-fix verification** (all screenshots taken after the fixes above; a local scratch directory was
used, not committed to the repository, matching this repository's existing convention — see S-109's
own `TASK_RESULT.md`):

- **White default plate** (top view, side/profile view via the Right preset, ~35° perspective, and a
  full 0°→360° rotation sweep): correct concave well, sloped rim, rounded outer edge, visible foot
  ring; outer diameter genuinely includes the full rim (confirmed both visually and via the
  `outer diameter: 270.0 mm` stat, matching the JSON's default); no clipping at the well/rim
  transition at any rotation; zero console errors across the whole sweep.
- **Creme alternative plate**: color swap correctly re-renders both the top surface's texture
  background and the underside's solid color (this also exercises the texture-recreation fix, since
  switching plate color redraws the same-size texture — confirmed no regression there).
- **All three design targets** (2D + 3D each): Center Well (single circle at the inner well
  diameter), Rim Band (true annulus), Full Top Surface (outer circle + dashed inner transition guide)
  — each visibly distinct in both views, with the correct dimension/target-name text.
- **Representative designs**: a short name ("Ana") centered in the Center Well; circular curved text
  ("FINE DINING COLLECTION") on the Rim Band, visually following the rim's actual slope from multiple
  camera angles (not floating on a flat plane); a gold monogram ("AJ") plus a separate Crystal-AB-colored
  Heart shape layer in the Center Well (multi-color design, two layer types merged into one
  `StoneLayout`, mixed with the SS6 default stone size).
- **Exports**: Project JSON export/import round-trip (plate fields, canvas, cupColor all preserved
  exactly); Production Sheet SVG and PDF (A3 — see Known Limitations) both include all six plate-only
  header lines with correct values; a pre-S-112 (no `project.plate` field) Project JSON imports
  cleanly with zero console errors and correct mug canvas/stats, confirming backward compatibility in
  the real browser, not just in the Node test sandbox.
- No floating rhinestones, no stones embedded below the surface, no severe stretching, no texture
  seams, and (per the above) zero console errors were observed throughout every scenario above.

---

# Known Limitations

- **Production Sheet page size**: the plate's default 270mm (and up to 300mm at the JSON's max)
  square production rect, plus its six extra header lines, does not fit A4 or Letter at any margin in
  either orientation — a real physical constraint (this exporter's own pre-existing "no scaling, throw
  a clear error" policy, unchanged, correctly refuses to fit it rather than silently rescaling). `A3`
  was added as a genuine additional page-size option (real, commonly available print stock) so the
  plate's Production Sheet is actually usable; A4/Letter remain available and correctly throw a clear,
  actionable `RangeError` if selected for a plate that doesn't fit. The operator must manually select
  A3 for a plate; there is no automatic page-size suggestion.
- **No per-target overflow validation for the plate.** `isTextTooLongForObject()`'s cylindrical-only
  "would overlap itself when wrapped" warning has no plate equivalent (e.g., "this design extends past
  the selected Rim Band's outer edge"); the plate's printable-boundary guide is purely advisory, exactly
  like the pre-existing rectangular safe-area guide for every other template. Not fixed here — no
  requirement of this milestone asked for it, matching this repository's established scope-discipline
  precedent (S-109 documented an analogous gap for SVG/shape overflow as a known limitation, not a
  defect).
- **Approximate weight is a static read-only value** (`PLATE_ROUND_DINNER_DEFINITION.weightGrams.average`,
  800g) — it does not scale with live outer-diameter/height edits, since the JSON provides no
  derivation formula for weight (only `rimWidthMm` has one). Displayed labeled as "product information,
  read-only" to avoid implying it's derived from the live dimensions.
- **Foot-ring dimensions are not user-editable** in this milestone (kept in the JSON/default model),
  per the brief's own explicit allowance ("Keep foot-ring dimensions in the JSON/default model unless
  the audit shows they must be user-editable now" — the audit found no such requirement).
- **`computeVertexNormals()` recomputes normals from scratch on every mesh rebuild** (plate only) —
  a small, one-time cost per rebuild (not per frame), consistent with every other kind's own one-time
  `LatheGeometry` construction cost; not measured to be perceptible in this environment.

---

# Recommendation

**APPROVE**, with the browser-verification section read carefully — the plate did not render
correctly until three real, non-obvious bugs (a `NaN` camera framing crash, an inverted-normal
visibility failure specific to a concave-from-above profile, and a combined stale-GPU-texture +
UV-sign error) were found and fixed via direct GPU-state debugging, not just code review. All three
fixes are minimal, land at the correct architectural level (`ObjectGeometryBuilder.js`/
`Preview3DRenderer.js`, the same two files every prior 3D-preview milestone's fixes have lived in),
and are now covered by a real-vertex-buffer unit test, not just a visual check. The feature otherwise
matches the brief precisely: no second `GeometryEngine`/`StoneLayout` pipeline, no hardcoded plate
dimensions outside the JSON, zero behavior change to Mug/Tumbler/Bottle or any pre-existing project
file, and `npm test` passes in full (823/823).

Recommended next milestones (optional, not attempted here — out of this milestone's scope): a second
non-cylindrical product (to confirm `PlateGuides.js`'s pattern generalizes beyond one shape);
per-target overflow validation for the plate; and reconsidering whether Production Sheet should
support page tiling for large single-piece production sizes instead of requiring A3.
