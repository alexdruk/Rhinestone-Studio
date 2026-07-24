# TXT-103A — Text Sizing Architecture Audit

Status: audit/specification only. No production code was changed for this milestone.

## 0. Method

This is a repository audit, not a design proposal from first principles. Every claim below is
tied to a specific file/line in the codebase as it exists on `develop`. Where the audit found an
existing, already-shipped mechanism that answers a question, that is called out explicitly rather
than re-derived — this codebase already contains most of the pattern this milestone needs.

Files read in full or in relevant part: `src/geometry/GeometryEngine.js`, `src/text/OpenTypeProvider.js`,
`src/text/rhinestoneFont/RhinestoneFontProvider.js`, `src/geometry/StoneSampler.js`,
`src/geometry/ShapeFit.js`, `src/export/SvgExporter.js`, `src/export/ProductionSheetExporter.js`,
`app.js` (text/shape sizing, resize-handle, auto-fit, and Fit-Text-to-Shape code paths).

---

## 1. Production invariants (restated, confirmed against code)

A text-sizing operation must never geometrically scale an already-generated `StoneLayout`/`Stone[]`.
Confirmed as the codebase's existing behavior, not just a policy: every stone-producing path in
`GeometryEngine` (`generateTextLayout`, `generateShapeLayout`, `generateSvgLayout`, `generatePathLayout`)
takes `stoneSizeMm`/`gapMm` as inputs and writes them onto every `Stone` unchanged
(`GeometryEngine.js:139-159`, `:359-366`, etc.) — there is no code path anywhere in `src/geometry/**`
that multiplies an already-computed `xMm/yMm` stone position or `sizeMm` by a scale factor. The only
per-point transform applied after sampling is `rotateTextPoints()` (`GeometryEngine.js:789-816`), which
is rigid (rotation only, pivoting on the point set's own bbox center) and therefore distance-preserving
by construction — see §4.

---

## 2. OpenType text — findings

**Parameter**: `heightMm`, passed through unchanged from a text layer's `layer.height` field
(`app.js:490`, `:1143`) into `GeometryEngine.generateTextLayout({heightMm, ...})`.

**Does changing heightMm regenerate contours and resample at the fixed stone diameter/gap?** Yes,
unconditionally, on every call:

- `OpenTypeProvider.getTextPath()` computes `unitsToMm = heightMm / font.unitsPerEm` fresh every call
  (`OpenTypeProvider.js:183`) and calls `glyph.getPath(advanceWidthMm, 0, heightMm)`
  (`OpenTypeProvider.js:202`) — the glyph outline is rebuilt at the requested size every time; only the
  parsed font object is cached (`_parsedFontsById`, keyed by `fontId` only, never by size).
- `GeometryEngine._textPolygons()` flattens those contours (`flattenContourToPolygon`) and
  `generateTextLayout()` then calls `sampleShapeFillPoints(mode, polygons, boundingBox, spacingMm, stoneSizeMm)`
  where `spacingMm = options.stoneSizeMm + options.gapMm` (`GeometryEngine.js:149-150`) — the sampling
  pitch is a pure function of `stoneSizeMm`/`gapMm`, never of `heightMm`. Stone diameter and gap are
  therefore invariant under any `heightMm` change; only the outline being sampled changes shape/size.

This means **OpenType resizing via `heightMm` is already the safe, regeneration-based mechanism** the
audit was asked to evaluate — it is not a hypothetical, it is the parameter the engine has used since
before this milestone.

**At smaller sizes**: no legibility floor exists inside `GeometryEngine` itself. If `heightMm` is set
low enough that a glyph's outline perimeter is shorter than one `spacingMm` pitch, `sampleOutlinePoints`
(`StoneSampler.js:24`) simply returns very few or zero points for that glyph — there is no error, no
warning, just silently fewer/no stones for that character. The only legibility guard in the whole
system is in the UI layer, not the engine: `MIN_AUTOFIT_HEIGHT_TO_SPACING_RATIO = 6`
(`app.js:378`, used by `computeAutoFitScale()` at `app.js:384-392` and `computeShapeFitScale()` in
`ShapeFit.js:135-160`) — and it is only consulted by the two *automatic* shrink features (`layer.autoFit`
and "Fit Text to Shape"). A user who manually types a small `height` value (autoFit off) gets no floor
at all and can silently produce unreadable or empty geometry.

**Collisions**: handled generically, not text-specifically, by `dedupeStonePoints()`/
`dedupeStonesByRadius()` (`StoneSampler.js:160-260`), which drop a candidate stone if it falls within
`minSeparationMm` (outline sampling) or physical stone-radius overlap (cross-layer, in `app.js`'s
`GeometryEngine.generate()` wrapper) of an already-kept one. This is unrelated to text height directly
— it is a consequence of a small glyph producing closely-spaced samples along a short perimeter.

**At larger sizes**: the engine adds stones, it does not "stretch" existing ones. Because sampling
always walks the (now larger) outline at the fixed `spacingMm` pitch, a taller glyph's longer perimeter
/ larger fill area yields proportionally more sample points at the same density — confirmed by reading
`sampleOutlinePoints`/`sampleShapeFillPoints`, which have no notion of "requested point count," only
"walk this geometry at this fixed pitch."

**Can a target width/height be solved by iterating heightMm?** Yes, and the codebase already does this
— **not by iteration, but by one closed-form scale computation**, because OpenType glyph geometry is
linear in `heightMm` (`unitsToMm` is a single scalar multiplying every coordinate):
- `computeAutoFitScale()` (`app.js:384-392`): `fitScale = maxWidth / measuredWidthMm`, one division.
- `computeShapeFitScale()` (`ShapeFit.js:135-160`, used by "Fit Text to Shape", `app.js:1737-1780`):
  `scale = min(targetWidthMm/measuredWidthMm, targetHeightMm/measuredHeightMm)`, also closed-form, with
  a documented fallback to the legibility floor and a note that this is "the same approximation
  `computeAutoFitScale()` already makes" (assumes linear scaling, does not re-verify by re-measuring
  after applying — callers re-run the real engine at the chosen height, so any small mismatch from an
  extreme case like kerning-table nonlinearity would only ever make the fit slightly conservative, not
  incorrect, since the final rendered geometry always comes from a real regeneration at the applied
  `heightMm`, not from the estimated scale itself).
Both compute a scale once from a single measurement, then call `generateTextLayout()`/
`resolveTextPolygons()` again at the new `heightMm` to get the real, final geometry — they do not trust
the linear estimate as final output. This is the correct evidence-based pattern for OpenType: a solved
`heightMm` followed by one real regeneration, not a multi-iteration search, and not iteration converging
on width being needed (linear relationship makes one step sufficient; a second exact measurement after
applying is what these two features already do).

---

## 3. RS Block (authored stone-center fonts) — findings

**Are authored stone-center coordinates fixed at one physical pitch?** Yes. `RhinestoneFontProvider.js`
explicitly validates `heightMm` (required by the `IFontProvider` contract) but never uses it
(`RhinestoneFontProvider.js:26-31` doc comment, confirmed in `getTextPath()` body: `heightMm` does not
appear anywhere in the stone-center math at `:117-142`). Every family (`rsBlock.js`,
`rsBlockPrototypeSS10.js`) authors `stoneCenters` at one fixed pitch (`PITCH_MM = 3.1mm` for RS Block)
tied to that family's `descriptor.recommendedStoneSizeMm`/`recommendedGapMm`.

**Can RS Block be resized while preserving fixed stone diameter and gap?** Not by any mechanism that
exists today. `heightMm` is a no-op for this provider (confirmed above), so today "resizing" RS Block
text via the `height` field does literally nothing — the rendered geometry is identical at every
`heightMm` value. This is not a bug to fix under this milestone (out of scope — audit only), but it is
the direct answer: there is currently no sizing control of any kind for RS Block, safe or unsafe.

**Would scaling authored center coordinates change pitch/spacing?** Yes, unambiguously. If a future
change multiplied each `{xMm, yMm}` in `stoneCenters` by a scale factor (the naive approach), the
distance between adjacent authored dots would scale too — directly violating this milestone's central
invariant ("must not scale... minimum required gap"). The family's dot-matrix design assumes exactly
one pitch; scaling breaks the assumption the whole family was hand-authored against (this is exactly
what the stone-map-technique memory documents as "No scaling by heightMm — a known, deliberate
limitation").

**Would safe resizing require separately authored variants / discrete masters / reflow logic / a new
provider contract?** Yes — the audit finds no way to safely resize an authored-stone font's *visual*
size without changing physical stone size while preserving pitch and gap between adjacent stones, other
than one of:
1. A different family authored at a different pitch (a discrete "size variant" of the same font), or
2. A reflow algorithm that changes which dot-matrix cells are populated (adds/removes stones, not
   scale positions) to approximate a different physical size at the *same* stone pitch — this does not
   exist anywhere in the codebase today and would be new, non-trivial per-glyph logic.
There is no existing partial implementation of either in the repo (`rsBlock.js`/`rsBlockPrototypeSS10.js`
are static per-glyph literal stone lists with no size-parameterization).

**Should RS Block initially be non-resizable except through supported stone-size variants?** Given the
above, this is the only option that does not require new, unbuilt reflow logic. This matches Decision
Option A/B below.

---

## 4. Transform behavior — findings

**Rigid translation**: `setLayerPosition()`/drag-move (`app.js:1510-1513`) only ever writes `layer.x`/
`layer.y` (or shape `x`/`y`), which `computeTextPlacementOffset()` (`app.js:393-397`) adds to already-
generated stone positions as a pure offset (`+offsetX, +offsetY`, `app.js:498`). An offset preserves all
pairwise distances trivially. Confirmed distance-preserving.

**Rotation**: `rotateTextPoints()` (`GeometryEngine.js:789-816`) applies `cos`/`sin` about the point
set's own bounding-box center to every point identically. This is a rigid rotation (an isometry) —
preserves all pairwise distances by construction; verified by the TXT-102 test suite's own
"rotation regression/point-reflection/normalization" tests (`tools/test-geometry-engine.mjs`, tests
54-68, per prior session notes). Applied once, after sampling, to final stone positions — never to
`stoneSizeMm`.

**Geometric scaling does not preserve the invariants**: confirmed by design, not just definition — see
`_placeNaturalContours()` (`GeometryEngine.js:404-437`), which *does* scale contour geometry
independently in X/Y (`scaleX`/`scaleY`, used by Rectangle/SVG/Path/every S-110 shape kind's resize).
Critically, this scaling is applied to the **outline contour only, before stone sampling** — stones are
then sampled fresh from the scaled outline at the unchanged `spacingMm = stoneSizeMm + gapMm` pitch
(`GeometryEngine.js:355-357`). This is the "regenerate geometry, don't scale points" pattern already
proven safe elsewhere in this exact engine — it is what this milestone should generalize to text, not a
new pattern.

**Every code path where a future developer might accidentally scale final stone positions**, audited by
grepping every `Stone(`/`stones.map(`/`.xMm`/`.yMm` write site in `src/geometry/**` and the `app.js`
`GeometryEngine` wrapper class:
- `GeometryEngine.js` — every `generate*Layout()` method constructs `Stone` directly from sampler output
  or authored centers; none multiplies a coordinate by anything derived from a "resize" concept.
  `rotateTextPoints()` is the one existing post-sample transform, and it is safe (rotation only).
- `app.js`'s local `GeometryEngine` wrapper class (`app.js:478+`) only ever adds a translation offset
  (`computeTextPlacementOffset`) after calling the permanent engine — no scale multiply exists here
  either.
- **The one place a future implementer is most likely to reach for `Stone.xMm *= scale` by mistake**:
  a naive "Text Size" slider that, seeing `rotateTextPoints()` already exists as a "final point transform
  after sampling," copies that shape but multiplies distances-from-center instead of rotating them. This
  is the exact anti-pattern the RS-1012A precision-validation and ProductionSheetExporter's "never
  silently rescale" convention (`ProductionSheetExporter.js:140`) already guard against for other export
  paths — the same discipline needs to extend to any new text-size control. Flagging this explicitly as
  the highest-risk implementation mistake for the next milestone.
- **A currently-live, unrelated gap found during this audit** (not a scaling bug, but a mixed-font
  interaction gap worth noting under §deliverable "unsupported operations"): `fitTextToShape()`
  (`app.js:1737-1780`) calls `permanentEngine.resolveTextPolygons()` unconditionally
  (`app.js:1752`), which throws an explicit `Error` for any font that supplies authored stone centers
  (`GeometryEngine.js:191-196`, e.g. RS Block). Neither `fitTextToShape()` itself nor its three call
  sites (`app.js:1694`, `:1717`, `:1816`, including the `fitTextToShapeBtn` click handler at
  `app.js:1812-1827`) catch this — selecting an RS Block text layer plus a shape and clicking "Fit Text
  to Shape" throws an unhandled rejection instead of showing the button's own validation message. Not
  caused by and out of scope to fix under this audit-only milestone, but relevant context for §3/§5
  below and worth a one-line fix (a `curveEnabled`-style upfront rejection with a clear message) in
  whatever milestone implements TXT-103A's recommendation.

---

## 5. Project and export compatibility — findings

**Exporters apply no scaling that could mask a production mismatch.** Audited each:
- `SvgExporter.js:56`: `viewBox="0 0 ${widthMm} ${heightMm}"` with `width="${widthMm}mm"` — a strict
  1 SVG user-unit = 1 mm mapping; every `<circle>` is written at its stone's real `xMm`/`yMm`/`sizeMm`.
  No transform group, no scale attribute anywhere in the file.
- `ProductionSheetExporter.js`: explicitly documents "no scaling — a hard requirement", throws a
  `RangeError` rather than silently rescaling (`:140`) — the strongest existing evidence of this
  codebase's production-correctness culture applied to exports specifically.
- PNG export (`app.js:1949-1981`, `#exportPNG`/`#exportProdSheetPNG`) is a raster **capture** of an
  on-screen canvas already drawn at a uniform `s` (px/mm) factor via `fitTransform`/`layoutTransform`
  (`app.js:868`) — proportions between stones are preserved (uniform factor across the whole canvas),
  but this is a visual-reference raster, not a vector production record; it carries no separate risk of
  a *per-layer* scale mismatch since it is downstream of the same one `StoneLayout` every other consumer
  uses.
- JSON export (Project Export / "Export Project JSON") serializes `project` (layer intent), never the
  generated `StoneLayout` — confirmed by `docs/architecture/architecture.md`'s "Project files store
  intent" rule (also in memory, `rhinestone-studio-conventions`). This is actually the *safest* possible
  export with respect to this milestone: whatever new field TXT-103B adds to a text layer, JSON export
  round-trips it as data, never as baked/scaled geometry.

**Smallest backward-compatible project fields needed**: none are needed for OpenType, because the
existing `height` (heightMm) field already is the safe sizing parameter — a future "Text Size" UI can
read/write the existing field. For RS Block, if Decision Option B (discrete size variants) is adopted,
the only new field needed is a font/family *selection* change (i.e. picking a different `fontId`, e.g.
`rs-block-large` alongside `rs-block`), which requires zero project-schema changes — `layer.font` already
exists and already round-trips through `validateProject()`. No new numeric "scale" field should be added
to the schema under any option — see Unsupported Operations below.

---

## 6. Recommended user interaction

Do not expose "Scale %" anywhere in the UI — a percentage implies uniform geometric scaling of existing
output, which is exactly the forbidden operation. Recommended concepts, in order of what the audit
found the engine can already support safely:

- **"Text Size"** (a direct `heightMm`/`height` numeric field) — already exists for OpenType
  (`#height` control, `app.js` `height` in `HISTORY_TRACKED_CONTROL_IDS`). No new mechanism needed; this
  is regeneration, not scaling, per §2.
- **"Fit to Width" / "Fit to Area"** — already exists in two forms (`autoFit` toggle, and the explicit
  "Fit Text to Shape" button) and both are closed-form-scale-then-regenerate, matching §2's findings.
  These names should be kept/reused rather than inventing new UI language, since they already describe
  exactly this safe behavior to users.
- **"Target Width"/"Target Height" as a direct numeric input** (rather than only "does it currently
  overflow") is a natural, low-risk extension of the existing `computeShapeFitScale()` math — it already
  takes a `targetWidthMm`/`targetHeightMm` pair; a manual UI would just source that target from a
  typed value instead of a shape's inscribed rect.

For RS Block specifically, no resize *interaction* should be shown at all under Option A/B (see below) —
the UI should instead expose family/variant *selection* (a font picker choice), which is a fundamentally
different, already-safe interaction (`layer.font` is already user-selectable, `app.js` font picker).

---

## 7. Unsupported operations (explicit, must fail loudly)

- No "Scale %" / drag-corner-resize control for text, ever — for either provider type. (Shapes already
  have this via `_placeNaturalContours()`'s regenerate-from-natural-contour pattern; text's authored-
  stone-font case has no equivalent "natural contour" to rescale from, and OpenType's equivalent
  mechanism is `heightMm`, not a post-hoc point-scale.)
- No numeric "scale" project field for text layers, under any option.
- RS Block (and any future authored-stone-center family) resized via `heightMm`: already a no-op today;
  should remain either a no-op or (better, but a schema/UX decision for the next milestone) an explicit
  disabled/hidden control with a "fixed size" explanation, not silently ignored as it is now.
- "Fit Text to Shape" / any future "Fit to Area" against an authored-stone-center font: currently throws
  unhandled (§4's finding) — must be an explicit, caught rejection with a clear message
  ("RS Block is fixed-size and can't be auto-fit to a shape — try a smaller stone size or shorter text,
  or switch to an OpenType font") before any UI exposes target-width/height controls more broadly,
  mirroring the existing `curveEnabled` rejection pattern already in the same function.
- Curved multi-line text remains out of scope (pre-existing, unrelated limitation, confirmed still true
  by reading `normalizeTextParams()`, `GeometryEngine.js:723-725`).

---

## 8. Provider-specific behavior summary

| | OpenType | RS Block (authored) |
|---|---|---|
| `heightMm` effect | Regenerates glyph outline at new size, linear | No effect (validated, ignored) |
| Stone diameter/gap under resize | Always fixed (spacingMm-driven resample) | N/A — no resize exists |
| Safe target-width/height solve | Yes — closed-form scale + one regeneration (already shipped) | Not possible without new reflow/variant work |
| Recommended resize mechanism | Direct `heightMm` control / Fit-to-Width / Fit-to-Area (already exist) | None; expose size via font/variant selection only |

---

## 9. GeometryEngine responsibilities (unchanged, confirmed still correct)

- Remains the only place stones are constructed (confirmed: no `src/renderer/**`, `src/export/**`, or
  `src/products/**` file constructs a `Stone` — grepped for `new Stone(` outside `src/geometry/**` and
  found none).
- Any future "Text Size"/"Fit to Area" UI must continue to only ever call
  `generateTextLayout({heightMm, ...})` with a different `heightMm`, never post-process the returned
  `StoneLayout`'s stones.
- If Option B/C (RS Block variants or reflow) is pursued later, that logic belongs inside
  `RhinestoneFontProvider`/a family module (producing different `stoneCenters` for a different
  `fontId`/size), never as a `GeometryEngine`-external post-scale — consistent with how `stoneCenters`
  is already the documented, sole legitimate authored-position contract (see
  `rhinestone-studio-stone-map-technique` memory).

---

## 10. Collision and minimum-legibility rules (current state, and gap)

- **Collision**: fully handled today, generically, via `dedupeStonePoints()`/`dedupeStonesByRadius()`
  (`StoneSampler.js`) — no text-size-specific work needed; any regenerated geometry at a new `heightMm`
  goes through the same dedup path automatically.
- **Legibility floor**: exists only in the UI layer (`app.js`'s `MIN_AUTOFIT_HEIGHT_TO_SPACING_RATIO`),
  only consulted by `autoFit` and "Fit Text to Shape" — **a manually-typed small `height` value bypasses
  it entirely today**. Recommendation: any new manual "Text Size" control should apply the same floor
  (clamp or warn) rather than introduce a second legibility constant, reusing
  `MIN_AUTOFIT_HEIGHT_TO_SPACING_RATIO` from `app.js` (or promoting it to a shared constant if a future
  milestone wants it enforced inside `GeometryEngine` itself — worth considering, since right now the
  engine will silently produce zero stones for an absurdly small `heightMm`, which is arguably an engine-
  level correctness gap, not just a UI nicety).

---

## 11. Decision

**Options restated:**
- A. OpenType regeneration sizing; RS Block fixed-size only
- B. Discrete authored RS Block size variants
- C. New authored-font reflow algorithm that preserves fixed pitch
- D. No direct text resize; use explicit typography parameters only

**Recommendation: Option A now, with B left open as a follow-up, not C or D.**

Rationale, strictly from the evidence above:
- OpenType regeneration sizing is not a proposal — it is the mechanism the engine has already used
  since before this milestone (`heightMm` → fresh glyph outline → fixed-pitch resample), already proven
  safe by `SvgExporter`'s 1:1mm output and the TXT-102 rotation test suite's distance-preserving checks,
  and already has two working closed-form "fit" UIs built on top of it (`autoFit`, "Fit Text to Shape").
  Formalizing/exposing a direct "Text Size" control for OpenType is close to zero new engine risk.
- RS Block fixed-size-only is not a compromise, it is the only option consistent with today's code:
  `heightMm` is already a documented no-op for authored-stone fonts, and no reflow/variant mechanism
  exists to safely change it. Shipping anything else under this milestone would require inventing new,
  unaudited per-glyph logic.
- Option D (no direct resize, typography parameters only) under-uses the OpenType mechanism that
  already works safely and is already partially exposed (`height`, `autoFit`, Fit-to-Shape) — it would
  be a regression in capability relative to what's already shipped, not a safer alternative.
- Option C (reflow algorithm) is the only way to eventually give RS Block real resizability, but it is
  net-new, unbuilt, per-glyph design work (deciding which dot-matrix cells populate at each target size)
  with no existing scaffolding in `rsBlock.js` — too large and too risky to bundle into the same
  milestone as formalizing OpenType's already-working mechanism. It should be evaluated separately, after
  Option B (discrete variants, much lower risk — "author one more family at a second pitch") is tried
  and found insufficient.
- Option B (discrete size variants) is the pragmatic middle ground for RS Block if/when demand for a
  larger or smaller RS Block appears: it requires zero engine changes (a new `fontId` is already a fully
  supported concept) and zero new project-schema fields (§5) — just new family authoring work, isolated
  entirely inside `src/text/rhinestoneFont/families/`.

---

## 12. Focused test plan (for the implementation milestone, not run here)

- `tools/test-geometry-engine.mjs`: add cases asserting that two `generateTextLayout()` calls at
  different `heightMm` (same text/font/stoneSize/gap) produce stones whose `sizeMm` is identical across
  both results, and whose minimum inter-stone spacing is never below `stoneSizeMm` (existing dedup
  invariant, re-asserted at at least two different `heightMm` values to catch a future regression that
  ties spacing to height).
- A test that a "Fit to Width"/"Target Width" control (however it's eventually exposed) never produces a
  `StoneLayout` whose stones' `sizeMm` differs from the layer's configured `stoneSize` — i.e., a
  regression guard for the exact invariant this audit is about, tied to the concrete new UI once it
  exists.
- `tools/test-rs-block.mjs`: a regression test asserting `heightMm` continues to have zero effect on RS
  Block output (locks in current behavior explicitly, so a future accidental scale-multiply is caught
  immediately rather than silently shipped).
- A `fitTextToShape()` test with an RS-Block-fonted text layer, asserting it returns
  `{ok:false, reason:'...'}` with a clear message instead of throwing (closes the gap found in §4).

## 13. Browser-verification plan (for the implementation milestone, not run here)

- Manually set OpenType text to several `height` values (very small, typical, very large); confirm via
  the Production Sheet / SVG export that stone diameter reads identically at every size (e.g. compare
  exported `<circle r="...">` values across sizes).
- Confirm "Fit to Width"/"Fit to Area" (existing or newly exposed) never changes exported stone diameter,
  only stone count/positions.
- Confirm RS Block text shows no resize affordance (or a clearly disabled one, once implemented) and
  that attempting "Fit Text to Shape" against it shows the new rejection message rather than failing
  silently.
- Re-verify rotation still preserves stone spacing after any change (reuse TXT-102's own rotation
  verification approach — SVG bounding-box aspect ratio check under 45° rotation).

## 14. Recommended next implementation milestone

**TXT-103B**: expose OpenType "Text Size" as a first-class, always-visible numeric control (distinct
from the current implicit-only `height` field usage) plus a manual "Target Width"/"Target Height" input
that reuses `computeShapeFitScale()`'s existing math with a user-typed target instead of a shape's
inscribed rect; disable/hide any resize affordance for authored-stone-center fonts (RS Block) with a
clear "fixed size" explanation; fix the `fitTextToShape()` unhandled-throw gap for authored-stone fonts
found in §4. Defer RS Block Option B/C (size variants or reflow) to a separate, later milestone pending
demand.
