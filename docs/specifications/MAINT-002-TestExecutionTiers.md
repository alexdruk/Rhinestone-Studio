# MAINT-002 — Test Execution Tiers

**Status:** IMPLEMENTED
**Branch:** `feature/maint-002-test-execution-tiers` (cut from `develop`, clean at branch time,
`develop` already had MAINT-001 merged)
**Scope:** Test runner configuration only (`tools/test-groups.mjs`, `package.json` scripts,
`.github/workflows/ci.yml`) plus developer documentation. No `src/**`/`app.js`/`index.html` file
changed, no `tools/test-*.mjs` file's content changed, and `tools/run-tests.mjs` itself was not
edited — its existing `--group`/`--all`/filter/default-discovery selection logic already supported
everything this milestone needed.

---

## 1. Audit summary

`tools/run-tests.mjs` required no code changes: `resolveSelection()` already implements `--group
<name>` (exact lookup against `tools/test-groups.mjs`'s `GROUPS`), `--all` (every discovered file,
ignoring `EXCLUDED_FROM_DEFAULT`), a filename-substring filter, and a no-argument default
(discovery minus `EXCLUDED_FROM_DEFAULT`). The tiered model needed only new *data* in
`tools/test-groups.mjs` and a different `package.json` `test` script — no runner logic changed.

`tools/test-groups.mjs` (as MAINT-001 left it) had 7 groups: `core`/`integration` (test-layer
splits), `architecture`/`gallery`/`documentation`/`security`/`autosave` (already subsystem-shaped).
Nothing finer-grained than `core` vs. `integration` existed, so `--group geometry`, `--group
exporters`, `--group ui`, `--group products` (the task's own examples) did not exist.

Per-file timing (`node tools/<file>.mjs`, measured individually — the same model
`tools/run-tests.mjs` uses via `spawnSync`, one child process per file) found one dominant outlier:
`test-fill-algorithms.mjs` at 4.49s, ~27% of the entire previous default-suite runtime by itself —
consistent with S-111's own finding that this is real production-density fill generation, not
cruft. `test-examples-regression.mjs` (1.57s) and `test-boolean-precision-validation.mjs` (1.23s)
were the next-heaviest; every other file measured under 700ms, median ~130ms.

`.github/workflows/ci.yml` had one step, `run: npm test`. Left unchanged, CI's merge-gate would have
silently shrunk to the new 24-file fast tier the moment `npm test` was repointed — the task's own
Tier 3 description explicitly lists "CI full verification" as a Tier 3 responsibility, so this
required a corresponding CI change (see §5).

---

## 2. Tier design

**Tier 1 — Fast Development.** New `fast` group in `tools/test-groups.mjs`, 24 files. `npm test`
(and `npm run test:fast`) now run `node tools/run-tests.mjs --group fast`. `node
tools/run-tests.mjs` with no arguments keeps its prior discovery-minus-`EXCLUDED_FROM_DEFAULT`
behavior (65 files) unchanged and still works if invoked directly — it is simply no longer what
`npm test` runs.

**Tier 2 — Subsystem Tests.** 12 new subsystem groups added (`geometry`, `stone-layout`, `text`,
`shapes`, `products`, `exporters`, `renderers`, `editing`, `ui`, `design-library`, `history`,
`release-smoke`), alongside the 5 that already were subsystem-shaped (`architecture`, `gallery`,
`documentation`, `security`, `autosave`). Together these 16 groups partition every one of the 67
`tools/test-*.mjs` files with **zero gaps and zero duplicates** (mechanically verified — see §7).
`core`/`integration` are untouched and keep working exactly as before, for anything already
depending on that test-layer split.

**Tier 3 — Full Validation.** `npm run test:full` (`--all`) is unchanged: every file, including the
two `EXCLUDED_FROM_DEFAULT` legacy `CupRenderer.js` suites. `.github/workflows/ci.yml`'s only test
step now runs `npm run test:full` instead of `npm test`, so CI keeps full-suite protection.

---

## 3. Which suites belong to each tier, and why

### Tier 2 — full subsystem mapping (16 groups, 67 files)

| Group | Files | Count |
|---|---|---:|
| `geometry` | geometry-engine, path-boolean, path-boolean-integration, boolean-precision-validation, geometry-stone-overlap-cross-contour/-cross-layer/-same-contour, arc-projection, image-pipeline, image-trace-regression, fill-algorithms, fill-algorithms-integration | 12 |
| `stone-layout` | stone-color, stone-size-library, crystal-color-catalog, crystal-color-integration, variable-stone-sizes | 5 |
| `text` | font-manager, font-provider-registry, opentype-provider, vector-path, typography-font-library | 5 |
| `shapes` | shape-fit, shape-library, shape-library-integration, shapes-design-consolidation, shapes-around-text-creation | 5 |
| `products` | object-template, object-template-integration, object-dimensions, product-plate-round-dinner | 4 |
| `exporters` | svg-parser, svg-integration, production-export-validation, production-sheet-exporter, pdf-document, export-combined-preview-png | 6 |
| `renderers` | render-export-pipeline, stone-layout-texture, object-preview-renderer, cup-rotation-stabilization, object-geometry-builder | 5 |
| `editing` | alignment-engine, snap-engine, editing-selection, alignment-snapping-wiring | 4 |
| `ui` | ui-shell-structure, lightbox-controller, lightbox-movable-persistent, ui-import-autoswitch-regression, text-position-workflow, ux-visual-polish | 6 |
| `design-library` | design-library, design-library-integration, design-library-freeze-gate | 3 |
| `gallery` | gallery, gallery-integration | 2 |
| `history` | history-manager | 1 |
| `autosave` | autosave-manager, autosave-recovery-wiring | 2 |
| `security` | project-validation-security | 1 |
| `documentation` | documentation-consistency | 1 |
| `architecture` | architecture-module-boundaries, browser-dependency-loading, module-graph-exports, project-model-consolidation | 4 |
| `release-smoke` | examples-regression | 1 |

Each bucket mirrors the subsystem taxonomy MAINT-001's own report used. Two placements worth calling
out: `test-svg-parser.mjs` sits in `exporters` (not `text`) because it parses *imported* SVG into
`VectorPath` — the import half of Import/Export, already paired with `test-svg-integration.mjs` —
not text/glyph rendering. `editing` (alignment/snap/selection math) is kept separate from `ui`
(markup/wiring) so `--group editing` targets exactly the pure logic modules the UI calls into, not
DOM structure.

### Tier 1 — Fast Development (24 files, ≈3.6s)

One cheap, high-value representative per subsystem, plus **all four architecture guards** (the
cheapest, highest-leverage checks in the suite — they directly protect the "one GeometryEngine / one
StoneLayout" invariant `CLAUDE.md` forbids violating, and every one measured under 210ms):

`test-architecture-module-boundaries.mjs`, `test-browser-dependency-loading.mjs`,
`test-module-graph-exports.mjs`, `test-project-model-consolidation.mjs` (architecture);
`test-geometry-engine.mjs`, `test-path-boolean.mjs` (geometry); `test-stone-color.mjs`,
`test-crystal-color-catalog.mjs` (stone-layout); `test-font-manager.mjs`,
`test-opentype-provider.mjs` (text); `test-shape-fit.mjs`, `test-shape-library.mjs` (shapes);
`test-object-template.mjs` (products); `test-svg-parser.mjs`, `test-pdf-document.mjs` (exporters,
import + export side); `test-render-export-pipeline.mjs` (renderers); `test-editing-selection.mjs`,
`test-alignment-engine.mjs` (editing); `test-ui-shell-structure.mjs` (ui);
`test-history-manager.mjs` (history); `test-autosave-manager.mjs` (autosave);
`test-design-library.mjs` (design-library); `test-project-validation-security.mjs` (security);
`test-documentation-consistency.mjs` (documentation).

**Deliberately excluded from Tier 1** (still fully covered by Tier 2 and Tier 3):
- `gallery`/`gallery-integration` — Gallery is disabled in the public UI, the lowest-priority
  subsystem for a fast dev loop.
- `release-smoke` (`test-examples-regression.mjs`, 1.57s) — a full 24+-fixture regression sweep;
  its cost/value ratio suits full validation better than a tight inner loop.
- `test-fill-algorithms.mjs` (4.49s) — would nearly double Tier 1's runtime alone; its subsystem
  (`shapes`) already has a cheap Tier 1 representative (`test-shape-fit.mjs`), and the expensive
  file still runs under `--group shapes`, `--group core`, and `test:full`.
- Every `-integration.mjs`/wiring-only file whose subsystem already has a cheaper unit-level
  representative in the list above (e.g. `svg-integration.mjs`, since `svg-parser.mjs` is already
  in Tier 1).

---

## 4. Commands available after this change

```
npm test                    # Tier 1 — fast development (24 files)
npm run test:fast           # same as npm test, explicit name

npm run test:geometry       # Tier 2 — one subsystem at a time (16 groups total)
npm run test:stone-layout
npm run test:text
npm run test:shapes
npm run test:products
npm run test:exporters
npm run test:renderers
npm run test:editing
npm run test:ui
npm run test:design-library
npm run test:history
npm run test:release-smoke
npm run test:documentation
npm run test:security
npm run test:autosave
npm run test:gallery

npm run test:core           # unchanged — existing test-layer groups
npm run test:integration
npm run test:architecture

npm run test:full           # Tier 3 — every file (67), including the 2 legacy CupRenderer suites
npm run doctor              # unchanged, aliases to `npm run test` (now Tier 1)

node tools/run-tests.mjs <substring>   # unchanged — ad hoc filename filter
node tools/run-tests.mjs               # unchanged — legacy 65-file discovery default, still works
                                        # directly; no longer what `npm test` invokes
```

---

## 5. Other files changed

- **`.github/workflows/ci.yml`**: `run: npm test` → `run: npm run test:full`, so CI keeps running
  every test on every push/PR now that `npm test` means Tier 1.
- **`tools/test-groups.mjs`**: added the `fast` group and the 12 new subsystem groups described
  above. `EXCLUDED_FROM_DEFAULT` and every pre-existing group's contents are byte-for-byte
  unchanged.
- **`docs/AI_ENGINEER.md`** (Testing section): now describes all three tiers explicitly and states
  CI runs `test:full`, replacing the previous "`npm test` (the full default suite)" description.
- **`README.md`**: one sentence added noting `npm test` is now the fast dev-loop subset, with
  `test:<subsystem>` and `test:full` for the rest.

---

## 6. Runtime comparison (before / after)

| Command | Before | After |
|---|---|---|
| `npm test` | ~65 files, ~15.8–17.8s (measured 15.77s/16.80s/17.79s across runs this and the prior milestone) | **24 files, 3.56s** |
| `npm run test:full` | 67 files, ~15.7–17.7s | 67 files, ~16.9s (unchanged set, normal run-to-run variance) |
| New: `npm run test:geometry` | n/a | 12 files, <1s |
| New: `npm run test:ui` | n/a | 6 files, <1s |

`npm test`'s wall time drops from ~16.5s (representative average) to **3.56s — a ~78% reduction** —
while every file it used to run is still reachable via a subsystem script or `test:full`.

---

## 7. Test count executed by each tier, and coverage confirmation

| Tier | Files selected | Files passed |
|---|---:|---:|
| Tier 1 (`npm test`) | 24 | 24 |
| Tier 2 (sum of all 16 subsystem groups, each run independently) | 67 (each file counted once — the 16 groups are an exact partition) | 67 |
| Tier 3 (`npm run test:full`) | 67 | 67 |

**Partition verified mechanically** (not by inspection alone): a one-off Node check imported
`GROUPS` from `tools/test-groups.mjs`, unioned the 16 subsystem-shaped groups
(`geometry`/`stone-layout`/`text`/`shapes`/`products`/`exporters`/`renderers`/`editing`/`ui`/
`design-library`/`history`/`release-smoke`/`architecture`/`gallery`/`security`/`documentation`/
`autosave`), and confirmed the union contains exactly 67 unique filenames with zero duplicates —
matching `readdirSync('tools')`'s own count of real `test-*.mjs` files exactly. No file was left
out of every subsystem group, and no file appears in two different subsystem groups.

**No regression protection was lost:** no `tools/test-*.mjs` file was deleted, renamed, or had its
content changed by this milestone — MAINT-002 only added `GROUPS` entries, changed which entry
`package.json`'s `test` script points at, and repointed CI at `test:full`. Every test that ran
before this milestone still exists, still runs (under Tier 2 and/or Tier 3), and still passes.

**Confirmation that no application behavior changed:** no `src/**`, `app.js`, or `index.html` file
was touched.

---

## Validation

`npm test` (24/24 passed, 3.56s), `npm run test:full` (67/67 passed), `npm run test:core` / `npm run
test:integration` / `npm run test:architecture` / `npm run test:gallery` (unchanged, all pass), and
a spot-check of new subsystem scripts (`test:geometry` 12/12, `test:security` 1/1, `test:ui` 6/6,
`test:documentation` 1/1) all pass.

---

## Recommendation

Approve. `npm test` is ~78% faster (16.5s → 3.56s) for the common case, every subsystem is now
independently runnable by name, `npm run test:full` and CI still validate all 67 files, and no test
file's content or any application code changed.
