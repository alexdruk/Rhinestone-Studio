# Rhinestone Studio — Current Task

## Pre-Implementation Check

Before writing code, verify:

- TASK.md is internally consistent.
- The requested work follows docs/ARCHITECTURE.md.
- Allowed and forbidden file lists are sufficient.
- Acceptance criteria are testable.

If any check fails, stop without modifying files and report the problem.

---

## Task ID

RS-0003.5A

## Title

Create the Vector Text Geometry Engine

## Status

READY

## Branch

feature/m2-vector-text

---

## Objective

Create the real Geometry Engine module under `src/geometry/`.

The new engine must consume the existing font-provider architecture and produce
a renderer-independent stone layout in millimeters.

This is a library and automated-test task.

Do not connect it to the live application yet.

Do not modify or duplicate the inline application engine in `index.html`.

---

## Expected Visible Change

NONE

The live application should behave exactly as before.

The purpose of this task is to create and test the permanent text-geometry
pipeline before integrating it into the browser application.

---

## Required Pipeline

```text
Text layer parameters
        ↓
FontProviderRegistry
        ↓
OpenTypeProvider
        ↓
VectorPath
        ↓
GeometryEngine
        ↓
StoneLayout in millimeters