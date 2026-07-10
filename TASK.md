# Rhinestone Studio — Current Task

## Task ID

RS-0003.5

## Title

Integrate OpenTypeProvider into Text Generation

## Status

READY

## Branch

feature/m2-vector-text

---

# Objective

Replace the existing canvas-based text sampling with the OpenTypeProvider.

The Geometry Engine must generate text geometry from vector glyph outlines instead of rasterized canvas pixels.

This task integrates the provider into the existing pipeline.

This task does NOT redesign the renderer.

---

# Expected Visible Change

YES

Compared to the previous version:

- text edges should become noticeably cleaner
- different fonts should produce visibly different layouts
- font size should affect layout correctly
- letter spacing should affect layout correctly

The following MUST remain unchanged:

- overall UI
- application workflow
- export functionality
- renderer architecture

---

# Architecture Requirements

The Geometry Engine remains the single source of truth.

The renderer consumes StoneLayout.

The renderer must never generate geometry.

The exporter must consume StoneLayout.

No duplicated geometry calculations.

---

# Allowed Files

src/text/**

src/geometry/**

src/**

tools/**

package.json

app.js (ONLY if required to connect the new pipeline)

TASK_RESULT.md

---

# Forbidden Files

index.html

style.css

renderer/**

export/**

Do not redesign the UI.

Do not redesign the project architecture.

Do not implement future milestones.

---

# Out of Scope

Do NOT implement:

- product plugins
- DXF export
- SVG improvements
- AI design
- undo/redo
- mouse editing
- cup improvements

Those belong to later milestones.

---

# Required Commands

npm test

git status

If the application can be started:

npm run dev

---

# Acceptance Criteria

## Automated

- [ ] Existing tests pass.
- [ ] New integration tests added where appropriate.

## Functional

- [ ] OpenTypeProvider is used by text generation.
- [ ] Canvas text sampling is no longer used for text generation.
- [ ] Font selection changes the generated layout.
- [ ] Font size changes the generated layout.
- [ ] Letter spacing changes the generated layout.

## Regression

- [ ] No renderer files modified.
- [ ] No UI files modified.
- [ ] Existing exports continue to work.

---

# Commit Message

feat(text): integrate OpenType provider into text engine

---

# Deliverables

1. Update TASK_RESULT.md.

2. Run required tests.

3. Create ONE logical commit.

4. Push the feature branch.

5. Return ONLY the completed implementation report.