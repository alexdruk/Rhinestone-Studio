# Rhinestone Studio Architecture

Version: 1.0

---

# Purpose

This document describes the architectural principles of Rhinestone Studio.

Every implementation must follow these principles.

If an implementation conflicts with this document, the implementation is wrong.

Architecture changes require explicit approval.

---

# Vision

Rhinestone Studio is not a rendering application.

It is a manufacturing application.

The goal is to produce accurate crystal placement for real-world products.

Everything else exists to support that goal.

---

# Core Principle

There is only ONE source of truth.

```
Project
        ↓
Geometry Engine
        ↓
StoneLayout
        ↓
+----------------------+----------------------+----------------------+
|                      |                      |                      |
2D Production      3D Preview            Exporters
Canvas             Cup/Bottle            SVG / PNG / JSON / DXF
```

Every consumer uses exactly the same StoneLayout.

No consumer generates geometry.

---

# Project Model

The project describes WHAT the user wants.

Examples:

- text
- circles
- rectangles
- colors
- layers
- fonts
- sizes

The project never contains pixels.

Everything is stored in millimeters.

---

# Geometry Engine

The Geometry Engine converts a Project into StoneLayout.

Responsibilities:

- text layout
- shape layout
- collision detection
- spacing
- stone placement
- normalization

The Geometry Engine never renders.

---

# StoneLayout

StoneLayout is the product.

Every stone contains manufacturing information.

Example

- xMm
- yMm
- sizeMm
- color
- layerId

Nothing else should invent stone positions.

---

# Renderer

The renderer visualizes StoneLayout.

Responsibilities

- draw stones
- lighting
- materials
- camera
- interaction

The renderer never computes geometry.

---

# Exporters

Exporters consume StoneLayout.

Examples

- SVG
- PNG
- JSON
- DXF
- Stone Reports

Exporters never generate geometry.

---

# Validation Engine

Validation checks correctness.

Examples

- duplicate layers
- invalid geometry
- overlapping stones
- missing fonts

Validation never changes data.

---

# Units

Internal unit:

millimeters

Rendering may convert to pixels.

Manufacturing always remains millimeters.

---

# Product Plugins

Products are plugins.

Examples

- Mug
- Tumbler
- Bottle
- Wine Glass

Every product supplies:

- printable area
- surface mapping
- preview geometry

Products never generate layouts.

---

# Text Engine

Fonts are providers.

Future providers may include

- OpenType
- SVG
- Variable Fonts
- Hershey Fonts

Every provider returns vector paths.

The Geometry Engine samples those paths.

---

# Layers

Every design element is a layer.

Examples

- Text
- Circle
- Rectangle
- Logo
- SVG

Layers never render themselves.

---

# User Interface

The UI edits the Project.

The UI never edits StoneLayout directly.

Whenever the Project changes:

Project

↓

Geometry Engine

↓

StoneLayout

↓

Renderer + Exporters

---

# Engineering Rules

Always

- one source of truth
- deterministic output
- millimeters internally
- renderer contains no business logic
- exporters contain no business logic

Never

- duplicate geometry
- generate stones inside renderer
- generate stones inside exporters
- use pixels internally

---

# Testing Philosophy

Every milestone must include automated tests.

Whenever possible:

change one parameter

↓

verify the resulting StoneLayout

↓

verify renderer

↓

verify exporter

Regression tests are more valuable than visual tests.

---

# Future Direction

Planned milestones include

- OpenType sampling
- Product plugin system
- Manufacturing reports
- DXF export
- Mouse editing
- Undo/Redo
- AI-assisted design

These features extend the architecture.

They do not replace it.

---

# Final Rule

If there is ever a choice between

- making the renderer simpler

or

- preserving the Geometry Engine as the single source of truth

the Geometry Engine always wins.