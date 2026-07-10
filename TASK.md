# Rhinestone Studio — Current Task

Version: 1.0

---

# Task Integrity Check

Before writing any code verify that this document contains:

- Task ID
- Objective
- Allowed Files
- Forbidden Files
- Acceptance Criteria
- Commit Message
- Deliverables

If any section is missing or ambiguous:

STOP.

Do not modify the repository.

Report the problem.

---

# Task ID

RS-0003.5A

---

# Title

Vector Text Geometry Engine

---

# Status

READY

---

# Branch

feature/m2-vector-text

---

# Objective

Create the permanent vector-based text Geometry Engine.

This task creates a reusable library under `src/geometry`.

It does **NOT** connect the new engine to the live browser application.

The purpose of this task is to build the production-quality text geometry
pipeline that future UI code will use.

There must be **no visible application changes** after this task.

---

# Background

The current browser application still uses an inline GeometryEngine defined
inside `index.html`.

That implementation is intentionally **NOT** modified in this task.

The new Geometry Engine will coexist until a later integration milestone.

This task builds the new engine only.

---

# Architecture Requirements

The implementation must follow `docs/ARCHITECTURE.md`.

The processing pipeline is

Text Parameters

↓

FontProviderRegistry

↓

OpenTypeProvider

↓

VectorPath

↓

GeometryEngine

↓

StoneLayout

The Geometry Engine is the only component that generates stone positions.

The renderer, exporter and validation code must never generate geometry.

---

# Functional Requirements

The Geometry Engine shall support:

- text
- font selection
- text height in millimeters
- stone size
- gap
- letter spacing
- fill mode
- outline mode

The output shall be deterministic.

The output shall be independent of rendering.

---

# Stone Output

Each generated stone shall contain at least:

- xMm
- yMm
- sizeMm
- layerId

Additional metadata is permitted.

The engine shall expose or allow calculation of:

- total stone count
- bounding box
- layout width
- layout height

All dimensions are millimeters.

---

# Expected Visible Change

NONE

The browser application should behave exactly as before.

This task produces a reusable engine and automated tests only.

---

# Allowed Files

- src/geometry/**
- src/text/**
- src/core/**
- tools/**
- package.json
- package-lock.json
- docs/specifications/**
- TASK_RESULT.md

---

# Forbidden Files

Do NOT modify:

- index.html
- app.js
- style.css
- src/renderer/**
- src/export/**
- assets/fonts/**
- README.md

Do not redesign the UI.

Do not redesign the project architecture.

---

# Out of Scope

Do NOT implement:

- browser integration
- renderer changes
- export changes
- product plugins
- DXF export
- SVG improvements
- cup preview
- mouse editing
- undo/redo
- auto-fit
- AI features

These belong to later milestones.

---

# Required Tests

Add automated tests covering at least:

1. Geometry generation succeeds for Courier Prime.

2. Geometry generation succeeds for Great Vibes.

3. Different fonts produce different layouts.

4. Font size changes bounding box.

5. Letter spacing changes layout width.

6. Stone size changes geometry.

7. Gap changes geometry.

8. Outline mode is deterministic.

9. Fill mode is deterministic.

10. Generated coordinates are finite.

11. Generated coordinates use millimeters.

12. GeometryEngine has no dependency on:

- DOM
- Canvas
- WebGL
- Renderer
- Exporter

13. Existing tests continue to pass.

---

# Required Commands

Run:

```bash
npm test
git status
```

Application startup is NOT required.

---

# Acceptance Criteria

## Architecture

- [ ] GeometryEngine exists under src/geometry.
- [ ] GeometryEngine consumes FontProviderRegistry.
- [ ] GeometryEngine consumes VectorPath.
- [ ] GeometryEngine emits deterministic StoneLayout.
- [ ] GeometryEngine has no renderer dependency.

## Functional

- [ ] Outline mode works.
- [ ] Fill mode works.
- [ ] Font selection changes geometry.
- [ ] Font size changes geometry.
- [ ] Letter spacing changes geometry.
- [ ] Stone size changes geometry.
- [ ] Gap changes geometry.

## Regression

- [ ] Existing tests pass.
- [ ] Forbidden files remain unchanged.
- [ ] No visible browser behaviour changes.

---

# Commit Message

```
feat(geometry): add vector text geometry engine
```

---

# Deliverables

The implementation engineer shall:

1. Implement the Geometry Engine.

2. Add automated tests.

3. Update documentation if public APIs change.

4. Complete TASK_RESULT.md.

5. Run all required tests.

6. Create exactly one logical Git commit.

7. Push the current feature branch.

8. Return only the completed implementation report.

Do NOT amend the commit merely to insert its own commit hash into
TASK_RESULT.md.