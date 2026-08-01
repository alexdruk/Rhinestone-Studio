# Task

**Task ID:** RS-2013 (Phase A — Design & Audit)
**Task Type:** Design/Audit only — no implementation
**Status:** IMPLEMENTED (design document produced; no application code changed)
**Branch:** design/instanced-stone-rendering-audit

## Goal

`ARCH-REVIEW-001` re-confirmed that the 3D preview's vessel *body* geometry is real and
dimension-driven (`RS-1006`/`RS-1006A`/`RS-2010`/`RS-2011`), but the *stones* themselves are still
2D gradient-disc canvas draws (`drawCrystalStone()`) baked into a flat `CanvasTexture`
(`src/preview3d/StoneLayoutTexture.js`) applied onto that body mesh — and ranked replacing that with
real instanced, faceted 3D geometry lit by environment lighting as the #2 next milestone (Part 4,
item 2 of that report). This phase (Phase A) produces the design document for that replacement. A
later, separate implementation phase (or several — see the design doc's §4 sequencing) will carry
out the actual work.

**This phase is design and audit only.** No implementation code, test file, or 3D geometry was
written, modified, or generated. The only deliverable is a written spec document.

## Required Outcome

1. **Current-state audit** — read `src/preview3d/StoneLayoutTexture.js`,
   `ObjectGeometryBuilder.js`, `Preview3DRenderer.js` in full; document exactly how the texture-
   baking pipeline works and every point where 3D-specific stone-appearance logic lives. Read
   `src/renderer/CrystalStoneRenderer.js`/`CrystalAppearance.js`/`CrystalColors.js` and identify
   what a 3D instanced approach can directly reuse vs. must not duplicate. Establish a realistic
   stone-count ceiling from `examples/baselines.json` and product/stone-size catalog bounds.
2. **Two smaller correctness items, audit only** — confirm the texture's `wrapS`/`wrapT` mode
   (`ClampToEdgeWrapping` vs. `RepeatWrapping`) with exact file/line, and grep
   `src/geometry/**`/`src/preview3d/**`/`src/export/**` for the `Math.min(...array)`/
   `Math.max(...array)` spread-on-large-array pattern, reporting every occurrence and the real
   engine limit that would trigger it. Neither fixed in this phase.
3. **Design proposal** — geometry shape/polygon budget, instancing mechanism
   (confirming the actual pinned Three.js version first), placement/orientation on the curved
   vessel surface, lighting approach, color/appearance mapping, a coexistence/migration path with
   the existing texture approach, and why this approach won't repeat any previously-rejected
   approach (researched, not assumed).
4. **Scope and sequencing** — an ordered, independently-testable list of implementation steps for
   a future milestone.
5. Determine the correct next milestone ID from the `docs/specifications/` naming convention.

## Allowed files

- `docs/specifications/RS-2013-InstancedFacetedStoneRenderingDesign.md` (new)
- `TASK.md`
- `TASK_RESULT.md`

## Forbidden files

- Everything under `src/**`
- `app.js`, `index.html`
- Any test file (`tools/test-*.mjs`)
- Any other file not listed under "Allowed files"

## Rules

- No changes to any file under `src/**`, `app.js`, `index.html`, or any test file.
- Do not implement any part of the design, even a small proof-of-concept, in this phase.
- Leave changes staged/unstaged — do not commit.

## Deliverables

- `docs/specifications/RS-2013-InstancedFacetedStoneRenderingDesign.md` — the design document,
  containing all required-outcome items above.
- `TASK.md` (this file).
- `TASK_RESULT.md` — summary of audit findings and a pointer to the design doc.
