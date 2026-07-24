# Rhinestone Studio Architecture

## System pipeline

```text
Project model
    ↓
Geometry Engine
    ↓
StoneLayout in millimeters
    ├─ 2D renderer
    ├─ 3D renderer
    ├─ export engine
    └─ manufacturing reports
```

## Principles

### 1. Manufacturing first

The product is the production layout, not the preview image. All coordinates are in millimeters.

### 2. One source of truth

Only the Geometry Engine generates stones.

### 3. Renderer independence

The 2D and 3D renderers are consumers. They must not own design data.

### 4. Products are plugins

A mug, bottle, tumbler, plate, or phone case supplies a printable area and a surface mapping. The editor should not contain product-specific hacks.

Since RS-2010, a product's printable area is derived from its physical dimensions rather than
authored directly as a canvas size:

```text
Product Definition (Standard Mug/Tumbler/Bottle, Round Dinner Plate)
    ↓
Physical Dimensions (project.vessel / project.plate)
    ↓
Derived Printable Area (project.canvas)
    ↓
Geometry Engine
```

`project.canvas` remains the one flat mm rectangle the Geometry Engine consumes — nothing
downstream of it changed. What changed is how it gets its value: for a revolved vessel (mug,
tumbler, bottle), canvas width is the circumference implied by the vessel's body diameter and
canvas height is its derived printable height; for the plate, canvas is its outer diameter on both
axes. A legacy project (no `project.vessel`/saved before RS-2010) keeps its existing canvas
untouched on load — physical dimensions are reverse-derived from it for display only, never the
other way around. See `docs/specifications/RS-2010-PhysicalProductDimensions.md` for the full
migration/compatibility contract.

### 5. Project files store intent

Project files store editable layers and parameters, not generated stones. Stone layouts are regenerated from the project model.
