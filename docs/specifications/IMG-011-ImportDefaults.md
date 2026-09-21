# IMG-011 — New-Image Defaults

## Objective

A freshly imported image previously inherited the currently-selected layer's stone size, and
otherwise landed on a single-color, single-pixel-scaled placement that most operators immediately
had to redo by hand. IMG-011 changes five things about a newly imported image only — every
existing project, and every other read site for the same fields, is untouched.

1. **Image menu shows the 2D canvas only.** Opening the Image menu no longer reveals Dual
   Workspace (canvas + 3D Object Preview); it reveals the 2D canvas alone, via a new sibling
   function, `revealCanvasOnlyForLightbox()` (`app.js`, next to `revealDualWorkspaceForLightbox()`),
   wired to `#menuImageTrace`'s `onclick`. Every other design-content menu item (Text, Shapes,
   Import, Export, Production Sheet) is unchanged and still reveals Dual Workspace.
2. **Default image size is 200mm on the longer side.** `computeDefaultImagePlacement()` now scales
   a newly imported image so its longer side is 200mm — up or down, whichever the source image
   needs — preserving aspect ratio, before applying the existing clamp to the canvas (minus a 20mm
   margin on each axis) and centring. Previously it placed the image at a fixed 96 px/inch
   conversion with no target size, so a small image imported tiny and stayed tiny.
3. **Default stone size is SS6 (2mm)**, not inherited from the previously-selected layer.
4. **Default fill mode is Staggered**, not the implicit `'fill'` fallback a missing `fillMode`
   previously read as.
5. **Default color count is 6**, not 1.

## Why saved projects are unaffected

All five defaults apply only inside the `importImageFile` file-picker change handler's new-layer
object literal (`app.js`) — the one place a brand new image layer is constructed. Every read site
downstream is untouched:

- `resolveImageFillMode()` still falls back to `'fill'` for a layer with no `fillMode` (every image
  layer saved before this milestone).
- `generateImageStonesLive()` still reads `colorCount:layer.colorCount??1`.
- Every other `resolveImage*` helper, and the six Image → Strass trace params the Studio panel
  exposes, are unchanged.

A project saved before IMG-011 has no way to observe these new defaults; it regenerates
byte-identically. Only the moment of import changes.

## Placement table

Measured directly from `computeDefaultImagePlacement()` (see
`tools/test-img-011-import-defaults.mjs`, item 1):

| canvas (mm) | image (px) | x (mm) | y (mm) | w (mm) | h (mm) |
|---|---|---|---|---|---|
| 257.610597594363 × 85 | 800 × 747 | 93.999409 | 10 | 69.611780 | 65 |
| 300 × 300 | 800 × 747 | 50 | 56.625 | 200 | 186.75 |
| 300 × 300 | 300 × 600 | 100 | 50 | 100 | 200 |
| 300 × 300 | 40 × 40 | 50 | 50 | 200 | 200 |

The first row is not an arbitrary example — `257.610597594363 × 85` is the real default mug canvas
(`bodyDiameterMm: 82` → `width = π×82`; `bodyHeightMm: 95` minus a `printableMarginMm` of `10` →
`height = 85`, both from `src/products/definitions/vessel-standard-mug.js`).

## Default mug canvas clamp

On the default mug canvas (85mm tall, minus the 20mm margin → 65mm available), the 200mm target
never actually reaches 200mm: it is clamped down to whatever the shorter axis allows, 65mm tall in
this case (see the first placement-table row above). The full 200mm becomes reachable once a flat
canvas/template object type — wide and tall enough to hold it, e.g. a planned flat-template
product — exists; that product type is not part of this milestone.
