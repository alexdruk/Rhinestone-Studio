# RS-3001 — Drawing Board Integration Design

Status: decisions-and-scope document only. No implementation, pseudocode, or file-level diffs are
proposed here. This doc captures the design decisions and open questions surfaced by
`DRAWLEATHER-AUDIT-001` (appended in full below) so implementation work can be scoped in a later
milestone.

---

## 1. Problem & Goal

`src/library/**` (the RS-1015 Design Library) is being retired. In its place, Rhinestone Studio
will get a freeform drawing board — a new way to create custom shapes and paths directly in the
canvas — built from a vendored subset of
[drawleather](https://github.com/sergeychernyshev/drawleather), an existing open-source leather-
pattern drawing application.

The audit below was commissioned to answer whether drawleather's source is actually suitable for
this reuse, and if so, what shape the integration should take. The headline finding is that
drawleather is not a small, self-contained drawing module — it is a full commercial SaaS product
(69,216 LOC, five pricing tiers, an accounts/Worker/R2 backend, and a large set of leather-domain
features Rhinestone Studio has no use for). This changes the shape of the integration more than
anything else in the audit: the plan moves from "vendor the whole repo" to "extract a defined
subset," and several parts of that extraction are not yet decided. This document exists to record
what is decided, what is explicitly excluded, and what remains open.

---

## 2. Extraction Boundary

The audit confirms the reusable slice — freeform path drawing/editing producing path data — is
small, clean, and already mm-native, but it is a subset of the repository, not the whole thing.

**Include:**

- Canvas layer: `Viewport`, `Scene`, `PointerInput`.
- Drawing/shape/trace/select tools: `FreePathTool`, `ShapeTool`, `TraceTool`, `RegionTool`,
  `SelectTool`, and their snap logic.
- Relevant model geometry: construction lines, offsets, flips, rounding — explicitly excluding
  stitching, hardware, and stamp-related model code.
- The export pair `sceneToSvg.ts` / `svgExporter.ts`, which already emits geometry in native
  millimetres with no coordinate remapping.

**Exclude:**

- Stamps (`src/stamps/`).
- Stitching / chisel-hole placement.
- Hardware placement (rivets/snaps).
- Instructions generation (`src/instructions/`).
- Photo-tracing and its cloud image upload path (`src/tracing/`).
- DXF/PDF/Cricut-flavored export (`dxf-writer`, `jspdf`, `svg2pdf.js`).
- The accounts/Worker/R2 backend (`worker/`, `wrangler.jsonc`).
- The five-tier billing/feature-flag system (`docs/features/`,
  `scripts/generate-feature-availability.ts`).

**Open question:** the include/exclude split above is a deliberate inclusion list, not
"everything except the excluded items" — it has not been scoped at the file/line level. Exactly
which files under `src/model/**` and `src/tools/**` fall inside the boundary needs line-level
audit before implementation can be estimated or started.

---

## 3. Embedding Design (Open Questions, Not Decisions)

No mountable-component boundary exists in drawleather today — `startApp()` is a monolithic
bootstrap that owns the entire document, and `index.html` is a full page, not a container div
drawleather populates into. The following are open questions for this milestone, not decisions:

- **CSS isolation.** drawleather's `src/styles.css` defines page-global custom properties on
  `:root` (`--bg`, `--panel`, `--border`, `--text`, `--accent`, etc.) plus a page-wide
  `box-sizing` reset. These generic names plausibly collide with Rhinestone Studio's own CSS if
  loaded as-is. Two candidate approaches were identified — Shadow DOM isolation, or a systematic
  `--variable` rename pass — and no decision has been made. Flagged as an open question for Sasha
  (see §6).
- **"Path data out" hook.** drawleather has no `mount(container)` API and no change-callback
  (e.g. `onPathsChanged(callback)`) today. Its own save/export flow is a full user-initiated
  action (download SVG/PDF/DXF) through its own Project/History state, not a library API. A new
  hook that reads out live path data as the user draws, replacing drawleather's own save/export
  UI entry points, needs to be designed. This is follow-on design work, not specified here.
- **Units.** Confirmed — no conversion layer is needed. drawleather stores all geometry in
  project-mm already; its `ProjectSettings.units: "mm" | "in"` is a display-only formatting
  toggle and does not affect stored coordinates. This aligns directly with Rhinestone Studio's
  mm-only internal model.

---

## 4. Build & CI Integration

- A vendored subtree needs its own trimmed `vite.config.ts`, separate from drawleather's own
  MPA/Worker-aware config. drawleather's build wires in a Worker typecheck step, git-hash version
  injection, and a dev-only image-upload API middleware — none of which is applicable to a
  vendored subset.
- drawleather's Vitest unit suite (53 files, `jsdom` environment) is self-contained — no network,
  no Worker dependency — and is portable as-is into a vendored subdirectory. This can feed a
  single added CI step, matching the repo's existing precedent of `tools/font-generator/`'s
  separate Python pipeline getting its own CI step.
- drawleather's Playwright e2e suite (202 specs, three browsers) does **not** port. Those specs
  exercise the full standalone drawleather product UI (its own topbar, full toolbar, real
  `index.html`), not an embedded subset. New e2e coverage for the embedded drawing board would
  need to be written later, once the embedding shape (§3) is decided.

---

## 5. License Resolution (Blocking Gate)

No `LICENSE` file is present in the drawleather source as audited. Code from drawleather must not
ship in the commercial Rhinestone Studio product until Sasha and Sergey resolve licensing. This
blocks the *ship* step only — it does not block audit, spec, or prototype work, including this
document.

---

## 6. Open Questions for Sasha

1. **Shadow DOM isolation vs. CSS variable rename** — which approach does he prefer for avoiding
   `:root` custom-property collisions (§3)?
2. **One-time snapshot vendor vs. periodic re-sync** — is vendoring a one-time snapshot of
   drawleather acceptable, or does he want a periodic re-sync process against upstream, given that
   drawleather is under active, independent development with its own protected-branch workflow?
3. **Interaction with non-flat product surfaces** — the plate surface's ~12-15mm rim/well relief
   (flagged during RS-2013, not yet resolved) — does this interact with anything drawn via the new
   board on a plate, or is the drawing board purely a 2D flat-pattern tool feeding the existing
   product-surface mapping unchanged? I.e., does the board need any awareness of non-flat product
   surfaces at all?

---

## Appendix: DRAWLEATHER-AUDIT-001 (verbatim)

# DRAWLEATHER-AUDIT-001 — drawleather source audit

**Status:** audit complete, no implementation prompt written (per instructions)
**Input:** Archive.zip — full git checkout of sergeychernyshev/drawleather,
branch feature/generate-howto-docs, HEAD e58fce1
**Scope:** read source only; no changes made to Rhinestone Studio or
drawleather

---

## 0. Headline finding — read this before the rest

The brief describes drawleather as "a leather-pattern drawing app" and frames
this as reading a self-contained module. What's actually in the archive is a
**live, paid, actively-developed SaaS product** (drawleather.com):

- 69,216 lines of TypeScript in src/, 763 files total
- A five-tier pricing model (local / account / maker / studio / atelier)
  baked into a feature-flag/doc-generation system (docs/features/,
  scripts/generate-feature-availability.ts)
- A Cloudflare Worker + R2 backend behind a proxy called "Startup API" that
  resolves logged-in accounts (worker/index.ts, wrangler.jsonc)
- early-access.html / pledge-needed.html — gated-access pages built as
  separate MPA entry points, suggesting a funding-gated rollout
- GitHub Projects-driven workflow (AGENTS.md): every change is a
  branch -> PR -> required CI (vitest, typecheck+build, e2e-chromium) ->
  protected-branch merge; issue board status transitions are part of the
  agent workflow
- 202 Playwright e2e specs across three browsers, 53 Vitest unit test files
- Domain features with zero relevance to Rhinestone Studio: stamp tiling
  (src/stamps/), stitching/chisel-hole placement, hardware (rivets/snaps),
  step-by-step instruction generation (src/instructions/), photo-tracing
  with cloud image upload, DXF/PDF/Cricut-flavored SVG export

This doesn't kill the plan — the specific slice that's actually needed
(freeform path drawing/editing -> path data out) is small, clean, and in mm
already, confirmed below. But **"vendor the whole thing as a self-contained
subdirectory"** (scope decision #2) is the wrong integration shape for a
codebase this size, most of which is leather-domain-specific product surface
Rhinestone Studio doesn't want, will not maintain, and would otherwise have
to keep dragging through every git subtree/vendor update. This changes the
milestone's shape more than anything else in this audit — see section 5.

---

## 1. Data model — paths, points, units

**Coordinate system / units:** confirmed mm-native. Project.ts stores
essentially everything — hole positions, stitch line vertices, offset
distances, construction geometry — in what the codebase consistently
comments as "project mm" coordinates. ProjectSettings.units: "mm" | "in"
is a **display-only** toggle (src/preferences.ts -> getUnits(), consumed
by DimensionLabel.ts and CalibrationDialog.ts to format numbers for the
user); it does not change how anything is stored internally. This lines up
exactly with Rhinestone Studio's mm-only internal model — no unit-conversion
layer needed at the integration boundary.

**Path representation:** paths are stored as **SVG path-data strings**
(pathData: string fields throughout Project.ts — construction lines,
cutouts, fills, offsets, free paths all follow this pattern), not as
serialized Paper.js objects or raw point arrays. Paper.js is used
internally as the computation engine (boolean ops, offsets, flips,
rounding) and results are converted back to d-attribute strings on every
commit. This is precisely the format scope decision #1 assumed — "the same
path format SVG import already produces" — and it holds up: exportSvg()
in src/exporters/svgExporter.ts explicitly keeps "geometry in native
millimetres" with "no coordinate remapping needed," producing a standard
SVG document Rhinestone Studio's existing SVG importer should be able to
consume without a bespoke adapter (worth a smoke-test against the real
importer, but no structural obstacle visible from the source).

**Take:** decision #1 (Paper.js for UI, existing geometry pipeline for
stones) is fully supported by what's actually in the repo.

---

## 2. Public API surface / mounting pattern

**No mountable-component boundary exists.** startApp()
(src/app.ts, 3,928 lines) is a monolithic bootstrap that owns the entire
document: it builds the topbar (logo, project name, undo/redo, tool
toolbar), wires ~15 tools, and assumes it's the only thing on the page.
index.html is a full page — <div id="app"> with a header baked into the
markup, not a container div drawleather populates.

Two specific integration frictions found in source:

- **Global CSS collision risk.** src/styles.css (3,256 lines) defines
  page-global custom properties on :root — --bg, --panel, --border,
  --text, --accent, etc. — plus a bare * { box-sizing: border-box; }
  reset and html, body, #app { margin: 0; height: 100%; ... } full-page
  layout rules. These names are generic enough to very plausibly collide
  with Rhinestone Studio's own CSS if the stylesheet is loaded as-is
  alongside the host app rather than scoped/namespaced.
- **No "give me path data back" callback/event exists.** Everything drives
  through drawleather's own Project/History state and its own
  save/autosave/export UI (src/storage/autosave.ts,
  src/storage/projectFile.ts, src/exporters/*). There's no
  onPathsChanged(callback) or equivalent hook to read out live path
  data as the user draws — export is a full user-initiated action
  (download SVG/PDF/DXF), not a library API.

**What partially helps:** the storage layer is otherwise clean — local
localStorage autosave and a self-contained JSON ProjectFile format
(fileType: "leather-art", versioned with migrations) with no dependency
on the cloud/account system for the core draw-save-export loop. The
account/Worker/R2 system is scoped narrowly to one optional feature
(photo-tracing image upload — src/tracing/, worker/index.ts); it is not
load-bearing for drawing, saving, or exporting a pattern, and the dev-mode
plugin in vite.config.ts shows the app runs fully offline-capable without
the Worker at all if that feature is left disabled/unused.

**Take:** scope decision #2's "vendored self-contained module producing a
single built bundle the main app loads" is achievable, but "mount into a
container element, get path data out" is **not a boundary that exists
today** — it's new integration code, and specifically:
1. A new host-page mode/entry point (drawleather doesn't currently support
   being embedded in someone else's page — index.html is its whole world)
2. A CSS scoping pass (shadow DOM or a systematic variable-prefix rename)
3. A new "commit path data out" hook, since none of the current exit points
   (download dialogs) are appropriate for a live embedded editing surface

None of this is exotic, but it's real, uncosted work, not glue code around
an existing seam.

---

## 3. package.json / build / dependency reconciliation

Dependencies: dxf-writer, jspdf, paper, paperjs-offset, svg2pdf.js
Dev dependencies: @playwright/test, @types/node, jsdom, prettier,
typescript, vite, vitest, wrangler

- Confirms the brief's "no other 3D lib, no framework" assumption — nothing
  in dependencies conflicts with three@0.169.0 / opentype.js.
- jspdf, svg2pdf.js, dxf-writer are present exactly as expected per
  scope decisions #3 — droppable, not entangled with the paths needed.
- Build (npm run build) is tsc --noEmit (main) + tsc --noEmit (node
  config) + wrangler types + tsc --noEmit -p worker + vite build. The
  **worker typecheck step is wired into the standard build command** — a
  vendored subdirectory build step would need to either exclude
  typecheck:worker/wrangler types (since Rhinestone Studio won't run
  the Worker) or accept wrangler as an added devDependency purely to
  satisfy typecheck. Cheap to strip, but it's a deviation from "just point
  CI at the existing build script."
- vite.config.ts is an **MPA build** (appType: "mpa", three HTML entry
  points: main/early-access/pledge-needed) with several custom plugins tied
  to the product's own concerns (git-hash version injection, SVG-comment
  pre-rendering, HTML-comment stripping, a dev-only image-upload API
  middleware). None of this is reusable for an embedded-widget build target
  — a Rhinestone Studio-facing build would need its own trimmed-down Vite
  config, not the one that ships in the repo.
- postinstall.sh runs playwright install — fine for drawleather's own
  CI, irrelevant/skippable for a vendored subtree that won't run e2e.

**Take:** dependency set is clean and compatible as assumed. Build
configuration is not directly reusable — a Rhinestone Studio-facing build
of the vendored subset needs its own vite.config.ts, separate from
drawleather's own MPA/Worker-aware one.

---

## 4. Test setup

- Vitest: environment: jsdom, globals: false, includes
  src/**/*.test.ts and scripts/**/*.test.ts, custom vitest.setup.ts
  polyfilling localStorage (works around a Node 25 regression). 53 test
  files — mostly unit tests on src/model/** (geometry/constraint logic)
  and src/tools/** (snapping, drag logic). Self-contained, no network,
  no Worker dependency — this can run independently inside a vendored
  subdirectory exactly as scope decision #2 assumed, feeding the "one added
  CI step" plan.
- Playwright e2e: 202 specs, three browsers, required as a branch-protection
  CI check for drawleather's own repo. Not portable as-is — the specs
  exercise the full standalone app UI (topbar, full toolbar, real
  index.html), not whatever subset/embedding shape Rhinestone Studio ends
  up using. These should **not** be assumed to keep running; only the
  Vitest unit suite realistically ports over unmodified.

**Take:** decision #2's "drawleather's own tests can keep running
independently inside its vendored subdirectory" is true for Vitest, false
for Playwright e2e as currently written (those specs target the full
product, not a subset).

---

## 5. Impact on the three scope decisions

1. Paper.js for UI only, hand off to existing geometry pipeline — **Holds.**
   mm-native storage, SVG pathData strings throughout, clean exportSvg()
   boundary with no coordinate remapping.
2. Vendor as self-contained module, single built bundle via <script>/import,
   one added CI step — **Needs revision.** The repo is a 69K-LOC full
   product (accounts, billing tiers, stamping, stitching, hardware,
   instructions, Worker/R2 backend) with no existing mount-into-container
   boundary and global CSS that will collide on the same page. Vendoring it
   *whole* pulls in a large surface of dead weight and an actively-changing
   upstream (active PR/issue workflow, AGENTS.md, protected main) that
   Rhinestone Studio would be tracking for no benefit. The CI-step part of
   the decision (Vitest only) still holds; the "single bundle" part needs a
   real subset-extraction plan, not a vendor-as-is plan.
3. Drop jsPDF/svg2pdf.js, keep PdfDocument.js; DXF out of scope — **Holds**,
   cleanly — those three dependencies are isolated in src/exporters/ and
   not entangled with the drawing/model code that's actually wanted.

---

## 6. Risks & surprises worth flagging explicitly

1. **Scope mismatch vs. brief.** This is not a hobby side-project to lift
   code from; it's Sasha's son's commercial product with paying tiers and a
   protected-branch, PR-only workflow of its own. Any code reuse plan should
   assume drawleather keeps evolving independently and Rhinestone Studio is
   taking a **snapshot**, not a live dependency — reinforces that vendoring
   should extract a subset rather than track the whole tree.
2. **License is still unresolved** (per the brief, already flagged as
   needing resolution between Sasha and Sergey before shipping) — confirmed
   no LICENSE file present in the archive. Not a blocker to this audit,
   but worth restating since it's now clear how much product/business
   value (tiered pricing, an active SaaS) sits in the same repo as the code
   that would be reused — makes the licensing conversation more consequential
   than "attribution paperwork."
3. **CSS variable collision** is a concrete, checkable risk (section 2) —
   generic :root custom-property names (--accent, --text, --border, etc.)
   plus a page-wide box-sizing reset. Needs either Shadow DOM isolation or
   a rename pass before any embedding, not just "load the bundle."
4. **No existing embed boundary** means "mount into a container, get path
   data out" (as assumed in the original brief's audit-task framing) is
   *new code to design*, not glue around an existing API. This is probably
   the single biggest driver of actual milestone effort — bigger than the
   Paper.js/geometry-pipeline integration itself.
5. **Playwright e2e doesn't port.** If Rhinestone Studio wants automated
   coverage of the embedded drawing surface, new e2e specs will need to be
   written against whatever the embedded shape ends up being; the existing
   202 specs test the standalone product.
6. **What's actually reusable is a small slice.** Realistically:
   src/canvas/ (Viewport/Scene/PointerInput), the free-drawing/shape/trace
   tools in src/tools/ (FreePathTool, ShapeTool, TraceTool,
   RegionTool, SelectTool, snap logic), the Paper.js-backed path
   utilities in src/model/ (construction geometry, offsets, flips,
   rounding — minus stitching/hardware/stamps), and src/exporters/'s
   sceneToSvg.ts/svgExporter.ts pair. That's a meaningful fraction of
   69K LOC, but nowhere near all of it — worth sizing precisely before
   writing a design doc, since "extract subset X" vs. "vendor whole repo"
   are very different milestones in effort and in what CI has to track.
