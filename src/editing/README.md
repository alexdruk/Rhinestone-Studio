# Editing

`src/editing/**` — RS-1009. Pure, DOM-free layer-placement logic: multi-selection, alignment,
distribution, and snapping. No dependency on `src/geometry/**`, `src/renderer/**`,
`src/export/**`, `Project`, `Layer`, or `StoneLayout` — every function here takes and returns
plain millimeter numbers, ids, and `Set<string>`s. `app.js` is the only consumer, and only through
`index.js`'s barrel (matching every other permanent module's convention).

`app.js` owns the actual layer-type-aware bookkeeping (which field is a given layer's x position —
`cx`/`cy` for a circle, `x`/`y` for everything else) via its own `getLayerPosition()`/
`setLayerPosition()` helpers; this module never sees a layer's `type`.

## API

- `EditingConstants.js` — `SNAP_TOLERANCE_MM`, `NUDGE_STEP_MM`, `NUDGE_STEP_LARGE_MM`.
- `AlignmentEngine.js`
  - `alignLayers(items, direction)` — `items: {id, bbox:{xMm,yMm,widthMm,heightMm}}[]`,
    `direction: 'left'|'centerH'|'right'|'top'|'centerV'|'bottom'`. Requires 2+ items. Aligns
    every item to the union bounding box of the whole selection. Returns
    `Map<id,{dxMm,dyMm}>`.
  - `distributeLayers(items, axis)` — `axis: 'horizontal'|'vertical'`. Requires 3+ items. Equalizes
    center-to-center spacing along the axis, holding the two extreme items fixed. Returns
    `Map<id,{dxMm,dyMm}>`.
- `SnapEngine.js`
  - `buildSnapTargets({canvasWidthMm,canvasHeightMm,safeAreaRectMm,layerBBoxes})` — candidate
    snap lines: canvas center/edges, safe-area edges/center (if `safeAreaRectMm` given), and each
    entry in `layerBBoxes`'s edges/center.
  - `computeSnapOffset(dragBBoxMm, targets, toleranceMm)` — finds the closest matching target
    within tolerance independently on each axis (checking the dragged box's near edge, center,
    and far edge against every target line) and returns `{dxMm,dyMm,guides}`, where `guides` are
    the matched target line(s) for drawing a temporary visual guide.
- `Selection.js` — `selectOnly(id)`, `toggleSelection(selectedIds, id)`, `clearSelection()`: the
  one selection-mutation implementation; see the file's own doc comment.

See `docs/specifications/RS-1009-AlignmentSnapping.md` for the full design rationale.
