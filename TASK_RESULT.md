# Rhinestone Studio — Task Result

This document is completed by the implementation engineer after finishing the current task.

---

# Task ID

S-101 — UX & Workflow Polish

---

# Status

IMPLEMENTED

---

# Branch

feature/s-101-ux-workflow-polish

---

# Commit

Do not write the current commit hash into this file — this file is part of the same commit it
describes. Obtain it from Git history with:

```bash
git log -1 --oneline
```

---

# Audit Findings

Full detail in `docs/specifications/S-101-UXWorkflowPolish.md`. Summary: this milestone implements
`RS-2004` from `docs/specifications/RS-2000A-PostMVPAudit.md` (Proposals C/D/E) plus two small
polish items found during this pass's own re-verification. All four issues below were re-confirmed
live against the current `develop` tip before any code was touched — none were assumed from the
prior audit doc:

* **Boolean Ops dialog-ordering bug** — the Shapes lightbox's own hint text tells the user to select
  layers via the canvas/Layers list, but every lightbox is a full-viewport `position:fixed;inset:0`
  overlay that captures pointer events everywhere, including the sidebar. Confirmed live via
  `document.elementFromPoint()`.
* **Curved-text default is a closed circle** — `curveSweepAngleDeg` defaulted to `360` in three
  places; enabling Curved Text for the first time produced a closed wreath, not an arc.
* **Unnecessarily technical/inconsistent shape-field wording** — shared position/size fields exposed
  raw SVG jargon ("X / CX", "Y / CY", "Width / Radius") regardless of the selected shape type, and a
  circle's inapplicable Height field showed a static label next to a permanently empty input.
* **Layer names truncate with no way to see the full name** — no `title` tooltip on `.layer .name`.

---

# Issues Resolved

1. **Boolean Ops / non-modal Shapes lightbox.** Added a `.lightbox-overlay.non-modal` CSS modifier
   (transparent background, `pointer-events:none` on the backdrop, `pointer-events:auto` restored on
   the dialog card) applied only to `#lightboxShapes` (`aria-modal="false"`). Every other lightbox is
   untouched. Verified end-to-end live: added two shapes, Shift-selected both through the (now
   click-through) backdrop without closing the dialog, ran Union successfully — the exact workflow the
   dialog's own hint text always promised.
2. **Curved-text default arc.** `curveSweepAngleDeg` default changed `360`→`180` in all three sites
   (`index.html` input value, `app.js`'s `defaultProject()`, and the sync/write fallbacks), plus one
   new clarifying hint line. Backward compatible by construction: the fallbacks only apply when a
   field is genuinely absent — verified live by importing a hand-crafted old-style project with an
   explicit `curveSweepAngleDeg: 360`, which round-tripped unchanged.
3. **Shape-field terminology.** "X / CX (mm)"→"X (mm)", "Y / CY (mm)"→"Y (mm)"; the Width/Radius
   label and Height field now retitle/hide per shape type inside the existing
   `syncSelectedControlsFromLayer()` (circle → "Radius (mm)" + Height hidden; every other shape type →
   "Width (mm)" + Height visible).
4. **Layer-list name tooltip.** `.layer .name` now carries `title="<full name>"`.

---

# Test Results

```
npm test
```

All 61 test suites pass, 768 individual `✓` assertions, exit code 0 (up from 60 suites / 756
assertions — one new suite, `tools/test-s101-ux-workflow-polish.mjs`, 11 assertions; three existing
structural suites updated in place for the one deliberate `aria-modal="false"` exception).

---

# Browser Verification

Raw Chrome DevTools Protocol (Node built-ins only, no new dependency), isolated headless Chrome
instance (temp `--user-data-dir`, dedicated randomized debugging port, software WebGL via
`--use-gl=angle --use-angle=swiftshader` for a realistic 3D-preview signal). Never touched any
pre-existing Chrome window/process — verified via `ps aux` before and after.

* **Boolean Ops, end-to-end**: opened Shapes, added a Circle and Rectangle while the dialog stayed
  open, Shift-clicked both Layers-list rows through the non-modal backdrop, watched Union go from
  disabled→enabled and the selection summary update, clicked Union → "Union: combined 2 layers into
  one editable shape (1 contour)." Dialog never closed during the sequence.
* **Curved text**: default sweep confirmed `180`; visually confirmed as a legible arc (banner look) in
  both the 2D canvas and the 3D mug preview, versus the old closed-wreath default.
* **Shape terminology**: Circle → "Radius (mm)" + Height hidden; Rectangle → "Width (mm)" + Height
  visible; X/Y plain "(mm)" wording confirmed for both.
* **Layer tooltip**: `title` attribute confirmed present and correct, including for an imported layer.
* **Undo/redo**: 3× undo correctly unwound Union + two shape adds back to the original single layer.
* **Keyboard**: Escape still closes the (now non-modal) Shapes dialog.
* **Save/load round trip**: exported Project JSON confirmed `curveSweepAngleDeg: 180`; a hand-crafted
  old-style project with an explicit `curveSweepAngleDeg: 360` imported back with that value
  unchanged (not silently rewritten to the new default) — compatibility confirmed, not assumed.
* **Export / Production Sheet / Dual Workspace / Object Preview**: all opened/switched cleanly, no
  clipped controls at 1440×900, no regression of the RS-1006A duplicated-artwork fix.
* **Console**: zero errors or exceptions with software WebGL enabled. The first pass (no GPU flags)
  showed only `THREE.WebGLRenderer` context-creation errors, confirmed to be a headless-sandbox
  artifact unrelated to this milestone (disappeared entirely once software rendering was enabled).
  `favicon.ico` independently confirmed to 404 via `curl` — pre-existing, matches the task's own
  "known favicon 404" allowance.

---

# Known Limitations / Remaining Issues

* **Narrow-viewport (~1100–1300px) Layers-list name collapse** — found live during this pass: below
  the 1300px responsive breakpoint, the `.layer` grid row's name column collapses to ~2px rendered
  width (not just further ellipsis-truncation), making layer names effectively invisible. Confirmed
  pre-existing (`git diff develop -- index.html` shows no change to `.layer`'s grid or the responsive
  breakpoints) and out of scope for S-101's four audited items — recommend a small dedicated
  follow-up rather than folding an unrelated responsive-layout fix into this branch.
* Everything else already tracked in `docs/specifications/RS-2000A-PostMVPAudit.md` Part 11 (schema
  reconciliation, validation engine, font-library size, Design Library backup, autosave, Contour Fill
  performance, `app.js` decomposition) remains open, out of scope by design.

---

# Product Owner Review

**Did these changes noticeably improve the product for a first-time user?** Yes, on the two items most
likely to shape a first impression: Curved Text's very first toggle now produces a legible arc instead
of a surprising closed wreath (screenshotted before/after against the identical default text), and the
Shapes dialog's own advertised "select 2+ layers to combine" workflow now actually works without a
close-select-reopen workaround — verified as a real, reproducible, end-to-end fix (Union executed
successfully, dialog never closed), not a cosmetic change. The terminology/tooltip fixes are smaller
"no longer confusing" wins appropriate to their size.

**Would you change anything else before RS-2001?** The narrow-viewport Layers-list name collapse
found live during this pass is worth a follow-up before or alongside RS-2001 — it's real and
reproducible, and wasn't on record before this session. Everything else already on the RS-2000A
roadmap stands as previously triaged; this pass found no new evidence to reprioritize any of it.

---

# Recommendation

**APPROVED FOR REVIEW**

Do not merge per task instructions — `feature/s-101-ux-workflow-polish` is pushed for review.

---

# Next Recommended Step

A small follow-up polish item for the narrow-viewport Layers-list name collapse, then proceed with
RS-2001/RS-2002 as already sequenced in `docs/specifications/RS-2000A-PostMVPAudit.md`.
