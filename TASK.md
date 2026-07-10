# Rhinestone Studio — Current Task

## Task Integrity Check

Before writing code, verify that this document contains:

- Task ID
- Objective
- Allowed Files
- Forbidden Files
- Acceptance Criteria
- Commit Message
- Deliverables

If anything is missing or conflicts with `docs/ARCHITECTURE.md`, stop before
modifying files and report the problem.

---

## Task ID

RS-0003.5A1

## Title

Align Stone Metadata with Architecture

## Status

READY

## Branch

feature/m2-vector-text

---

## Objective

Update the permanent geometry model so every generated stone carries its color.

`docs/ARCHITECTURE.md` defines StoneLayout as manufacturing data and lists color
as part of each stone. The current `Stone` implementation omits this field.

This task resolves that mismatch before browser integration begins.

---

## Expected Visible Change

NONE

The live browser application is not connected to the new GeometryEngine yet.

---

## Functional Requirements

Every `Stone` shall contain at least:

- `xMm`
- `yMm`
- `sizeMm`
- `color`
- `layerId`

The color must:

- be deterministic,
- survive serialization,
- survive deserialization,
- be preserved by `StoneLayout`,
- default clearly when no color is supplied.

Use the project's existing default crystal color where one already exists.
Otherwise define one documented default constant in the geometry model.

---

## Architecture Requirements

- Everything remains measured in millimeters.
- Renderer and exporter code must not be modified.
- No browser, DOM, Canvas, or WebGL dependency may be introduced.
- GeometryEngine remains the only source of generated stone positions.
- Do not add UI behavior.
- Do not change the live application.

---

## Allowed Files

- src/geometry/**
- src/core/**
- tools/**
- package.json
- docs/ARCHITECTURE.md
- docs/specifications/**
- TASK_RESULT.md

---

## Forbidden Files

- index.html
- app.js
- style.css
- src/renderer/**
- src/export/**
- src/text/**
- assets/**

Do not redesign the architecture.

Do not implement browser integration.

---

## Out of Scope

Do not implement:

- browser module migration,
- OpenType browser loading,
- font-family UI,
- text auto-fit,
- circle or rectangle migration,
- renderer changes,
- exporter changes,
- cup changes.

---

## Required Tests

Add or update automated tests verifying:

1. A Stone stores `color`.
2. A default color is applied when color is omitted.
3. Explicit color survives serialization.
4. Explicit color survives deserialization.
5. StoneLayout preserves stone colors.
6. GeometryEngine-generated outline stones contain color.
7. GeometryEngine-generated fill stones contain color.
8. Repeated generation produces identical colors.
9. Existing tests continue to pass.
10. No forbidden files changed.

---

## Required Commands

```bash
npm test
git status