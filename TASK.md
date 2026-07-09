# Rhinestone Studio — Current Task

---

## Task ID

RS-0003.5

## Title

OpenType Integration

## Status

READY

## Branch

feature/m2-vector-text

---

# Objective

Replace the existing canvas-based text sampling with the new OpenTypeProvider.

The Geometry Engine remains the single source of truth.

The renderer must only render the generated StoneLayout.

---

# Expected Visible Change

YES

Text quality should improve.

The following controls should begin working correctly:

- Font
- Font Size
- Letter Spacing
- Horizontal Alignment
- Fill
- Outline

The Production Layout and Cup Preview must always display the same StoneLayout.

---

# Allowed Files

src/text/**

src/geometry/**

src/**

tools/**

package.json

app.js (ONLY if required for integration)

---

# Forbidden Files

index.html

style.css

Do not redesign the UI.

Do not redesign repository structure.

Do not redesign architecture.

---

# Required Commands

npm test

If available

npm run build

Run the application.

---

# Acceptance Criteria

- [ ] Application starts.
- [ ] No JavaScript console errors.
- [ ] Existing automated tests pass.
- [ ] Font selection changes text.
- [ ] Font size changes layout.
- [ ] Letter spacing changes layout.
- [ ] Production Layout equals Cup Preview.
- [ ] Geometry Engine generates the layout.

---

# Commit Message

feat(text): integrate OpenType provider into text engine

---

# Deliverable

Update TASK_RESULT.md.

Return the standard implementation report.