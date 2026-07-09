# ADR-0001: Geometry Engine is the single source of truth

## Status

Accepted

## Context

Earlier prototypes allowed the 2D view, 3D preview, and export logic to generate or transform rhinestone positions independently. This caused regressions where the production layout and the cup preview did not match.

## Decision

Only the Geometry Engine may generate rhinestone positions.

The Geometry Engine outputs a `StoneLayout` in millimeters. Every downstream system consumes that layout:

- 2D production canvas
- 3D preview renderer
- SVG/PNG/JSON/DXF exporters
- manufacturing reports

## Consequences

### Positive

- 2D, 3D, and exports cannot disagree if they consume the same layout.
- Manufacturing output remains deterministic.
- Product plugins can be added without changing text or SVG generation.
- Testing becomes easier because one output can be validated.

### Negative

- Renderers cannot use visual shortcuts that alter stone placement.
- Geometry Engine changes must be tested carefully because they affect every output.
