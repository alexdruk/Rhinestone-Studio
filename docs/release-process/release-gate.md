# Release Gate

A milestone is not ready until it passes these gates.

## 1. Functional tests

- Text change updates layout
- Font change updates layout
- Stone size change updates layout
- Gap change updates layout
- Color change updates layout
- 2D, 3D, and export use the same StoneLayout

## 2. Geometry tests

- Coordinates are in millimeters
- No duplicate stones
- Minimum gap is respected where applicable
- Long text auto-fits
- Stones remain inside printable area

## 3. Export tests

- Project JSON exports
- Layout JSON exports
- SVG exports in millimeters
- PNG exports render the same visible design

## 4. Visual QA

- Text is readable
- Cup is centered
- Handle is attached
- Stones are visible
- No obvious desynchronization

## 5. Known issues

Every known issue must be documented before release.
