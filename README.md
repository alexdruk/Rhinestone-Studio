# Rhinestone Studio

Rhinestone Studio is a manufacturing-first design tool for rhinestone decoration on physical products such as mugs, bottles, tumblers, candles, and phone cases.

## Current status

Repository foundation. The first production milestone is **M2.2 — Vector Text Engine**.

## Core principle

One source of truth:

```text
Project JSON / Project model
        ↓
Geometry Engine
        ↓
StoneLayout in millimeters
        ├─ 2D production view
        ├─ 3D preview
        └─ exports
```

Renderers and exporters must never generate stones themselves.

## Repository structure

```text
src/                  application code
assets/               fonts, models, textures, HDR assets
examples/             golden project files
docs/                 architecture, ADRs, specifications, QA process
tools/                developer scripts
.github/workflows/    CI automation
```

## Development

This repository is intentionally being built in small, reviewable commits.

Initial local setup:

```bash
git clone https://github.com/alexdruk/Rhinestone-Studio.git
cd Rhinestone-Studio
```

No npm dependency is required for this repository-foundation commit.
