# Backlog

This file predates the current per-milestone specification process
(`docs/specifications/`) and is not actively maintained per-commit. For current implementation
status, see `docs/ARCHITECTURE.md` (authoritative, updated per milestone) rather than this table.

Every item below was part of the Version 1.0 scope; Version 1.0 is now formally released (`RC-008`,
closed after the `RC-002`–`RC-007` stabilization series and `ARCH-REVIEW-001`'s architecture
review found no open release-blocking defect).

|Priority|Feature|Status|
|---|---|---|
|P0|Curved text|Done (RS-1003)|
|P0|SVG import|Done (RS-1001)|
|P0|Multi-object support|Done (RS-1004)|
|P1|Undo/Redo|Done (RS-1002)|

## Known data defects (not release-blocking, deferred)

|Item|Found by|Notes|
|---|---|---|
|`assets/fonts/Montserrat-Regular.ttf` is Montserrat **Thin**, not Regular|READ-003|The bundled file reports `usWeightClass = 100` (Anton and Great Vibes both report 400). It ships under the `montserrat-regular` id and a "Regular" style label, so anyone picking Montserrat in the font library silently gets a hairline weight — its measured `stemWidthRatio` (0.0145) is the lowest in the library by a wide margin. Independent of readability. The fix is to replace the font file with the true Regular weight, which is a **render-changing migration** for any existing project that uses Montserrat, so it is deferred to its own milestone rather than slipped into an unrelated change.|

## Deferred technical follow-ups

|Item|Found by|Notes|
|---|---|---|
|`sampleRadialFillPoints()` per-component anchors do not extend to `sampleRadialFieldFillPoints()`|READ-002|The vector radial sampler now rays out from one anchor per connected component (`groupPolygonsIntoComponents()`), fixing the "bullseye in the middle, straight rows at the edges" defect for multi-part text/SVG. `sampleRadialFieldFillPoints()` (image/raster layers, `GeometryEngine.generateImageLayout()`) still uses a single whole-placement anchor and has the same defect, but a raster density field has no polygon contours to group — it needs raster connected-component (blob) labelling of the density mask, a different technique. Left untouched by READ-002.|
|`groupPolygonsIntoComponents()` is O(n²) in contour count|READ-002|Pairwise containment test with a bounding-box prefilter, then one `isPointInsidePolygons()` per surviving pair. Measured wall time: Cinzel "Vitalina" (45 contours) 0.14 ms; Cinzel "Vitalina Katarina" (93 contours) 0.33 ms. Untested above ~90 contours; revisit with a spatial index or interval tree if a large SVG import makes radial fill noticeably slow.|
|Letter spacing is unexposed — `letterSpacingMm` exists in `GeometryEngine` but appears zero times in `app.js`|READ-005A|The only validated quality improvement from the calibration work (McNemar p = 0.0078, 8 fixes / 0 harms), costing median +26% width; needs its own milestone for the `autoFit` interaction.|
|Staggered and radial sell at 9% and 10% at every ratio tested|READ-005A|No ratio floor rescues them; the open question is whether the interior samplers have a geometry defect or the modes should stop being offered for text. See `docs/specifications/READ-005A-CalibrationFindings.md`.|
|The READ-010 warn-only readability floor does not apply to `providerId: 'rhinestone'` fonts|READ-011C|`textHeightBelowReadableMinimum()` (`app.js`) gates on `layer.height ÷ layer.stoneSize`, but `RhinestoneFontProvider` (`src/text/rhinestoneFont/RhinestoneFontProvider.js`) does not scale authored stone positions by `heightMm` — the READ-011C audit measured a constant 21.40 mm ink height and constant stone count for `rs-block` / `rs-modern` across every specified height. So the below-floor warning can fire when the rendering is actually fine and stay silent when it is not, and `#heightFixToFloorBtn` "fixes" it by writing a new `layer.height` that clears the warning while leaving the stone output byte-identical. This affects `rs-block`, the default Production Font. The authored-pitch floor rule for these fonts (READ-011A §5) is the real fix and its own milestone.|
|`rsBlock.js` / `rsModern.js` hardcode `PITCH_MM = 3.1` with no stone-size awareness|READ-011C|`src/text/rhinestoneFont/families/rsBlock.js` and `src/text/rhinestoneFont/families/rsModern.js` place every authored stone at `col * PITCH_MM` with `PITCH_MM = 3.1` (SS10's 2.8 mm stone + 0.3 mm gap). `GeometryEngine` then stamps each stone with the layer's selected `stoneSizeMm`, so pairing a Production Font with SS16 (4.0 mm) or SS20 (4.7 mm) places overlapping stones — verified: `rs-block` "Vitalina" holds a 3.100 mm nearest-neighbour at every size, giving 64 overlapping pairs at SS16 and 87 at SS20. Nothing in the pitch is stone-size-derived. READ-011C investigated (no code change) whether the UI prevents that pairing: there is **no `providerId: 'rhinestone'`-specific stone-size constraint**. `updateStoneSizePrintableCapabilityUI()` gates only on printable height and the manifest `unsupportedStoneSizes` list (empty for both authored fonts). The general overlap sweep `updateStoneSizeOptionAvailabilityUI()` *does* generate each candidate layout and would disable the SS16 / SS20 `<option>`s for an active `rs-block` text layer — but it never disables the *currently selected* size (only flags it with `#stoneSizeOverlapWarning`), and it is PERF-gated to re-run only on selection change or `#stoneSize` focus, not on a font switch. So reaching `rs-block` + SS16/SS20 by switching font on an existing SS16 layer, or by loading / importing a project, leaves overlapping stones with only a warning banner; the fix is a separate milestone.|
