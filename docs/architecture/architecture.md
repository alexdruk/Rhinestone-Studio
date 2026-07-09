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

A mug, bottle, tumbler, or phone case supplies a printable area and a surface mapping. The editor should not contain product-specific hacks.

### 5. Project files store intent

Project files store editable layers and parameters, not generated stones. Stone layouts are regenerated from the project model.
