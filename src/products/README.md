# Products

Product plugins define printable areas and map normalized layout coordinates onto product surfaces.

## Object templates (RS-1004)

`ObjectTemplate.js` defines a small, validated registry of physical object templates (`mug`,
`tumbler`, `bottle`). Each template is a plain data record: display name, production width/height
in millimeters, a safe-area inset, supported/default wrap mode, and schematic preview-silhouette
parameters consumed by `src/renderer/CupRenderer.js`. A template never generates a `StoneLayout`
and never contains a stone position — it only describes the item the (unchanged) `StoneLayout` is
being previewed/produced against. `project.product` (the app's ad hoc project field) selects the
active template id; unknown/missing ids fall back to `'mug'`.
