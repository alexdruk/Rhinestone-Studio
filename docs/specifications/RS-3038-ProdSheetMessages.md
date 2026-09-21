# RS-3038 — Production Sheet messages

**Status:** implemented. Branch `feature/rs-3038-prod-sheet-messages` off `develop`.

**Authorises:** two fixes to the Production Sheet lightbox's feedback surface, both surfaced by
browser testing of RS-3037 (Flat Sheet). Neither blocks export.

---

## 1. Defect A — export errors were invisible

The three export handlers (`#exportProdSheetSVG`/`#exportProdSheetPNG`/`#exportProdSheetPDF`,
`app.js`) already caught failures (e.g. the `RangeError` `ProductionSheetExporter.js`'s page-fit
check raises), but reported them only via `el('status').textContent`. `#status` is the sidebar
status line, and the Production Sheet Lightbox sits on top of it — an export failure looked like an
unresponsive button, not a reported error.

Each of the three catch blocks now also writes the same `Export failed: ${error.message}` text into
`#prodSheetValidation`, the validation panel already inside the lightbox (READ-010). `#status` is
left untouched, so every other export path's existing behavior is unaffected.

**Persistence.** Nothing clears `#prodSheetValidation` on its own — it is only ever written by
`updateProdSheetReadabilityValidation()` (the readability/outside-area sweep, §2) or by a catch
block (this fix). Since the sweep already runs first inside each handler's own `try` block (READ-010)
and now also on every page-size/margin/mirror/registration-marks change (§3), the error text
naturally survives until the operator retries the export or changes an option — no separate
"don't erase" flag was needed.

## 2. Defect B — stones outside the production area were silent

Repro: import an image on a 200×200 Flat Sheet, then resize the sheet to 150×150. Stones that fall
outside `project.canvas` still render on the Production Sheet, uncounted and unflagged — they will
not be on the physical template, and nothing said so.

`countStonesOutsideProductionArea(stoneLayout, widthMm, heightMm)` (new, pure,
`src/export/ProductionSheetExporter.js`) counts stones not wholly inside `[0,widthMm] x
[0,heightMm]`. A stone's extent is its center ± half its `sizeMm` (`Stone.xMm`/`yMm`/`sizeMm`,
`src/geometry/Stone.js`), matching the same "no scaling, hard fit" geometry the page-fit check
already uses for the page itself, just against the canvas instead of the page. A 1e-6mm tolerance
means a stone whose extent exactly touches an edge counts as inside, immune to float noise. No DOM,
no app.js import — same isolation the rest of the module already keeps.

`updateProdSheetReadabilityValidation()` (`app.js`) calls it against the live `layout` and
`project.canvas.width`/`height`, and appends (never replaces) a message when the count is above
zero: `"N stones lie partly or fully outside the W × H production area and will not be on the
template. Move or resize the design, or enlarge the sheet."`, singular for N=1 ("1 stone lies…").
`W`/`H`/the unit come from `formatLengthDisplay()`/`unitSuffix()` against `project.units`, the same
formatting the existing readability message already uses.

## 3. Wiring: kept fresh, not just at export time

`updateProdSheetReadabilityValidation()` already ran at two points (READ-010): the Production Sheet
Lightbox's `onOpen`, and as the first statement inside each export handler's `try` block. This
milestone adds a third: a `'change'` listener on `#prodSheetPageSize`/`#prodSheetMargin`/
`#prodSheetMirror`/`#prodSheetRegMarks`. None of the four had any listener before — they were read
only at generation time, via `currentProductionSheetOptions()` — so this is new wiring, not a reused
call site. It exists primarily to satisfy §1's persistence contract: an "Export failed" message left
in `#prodSheetValidation` by a catch block is cleared back to the normal readability/outside-area
state as soon as the operator changes an option, not just on their next export attempt.

## 4. Why warn, not block

Same reasoning as READ-010's own warn-only floor: both checks are advisory ("this will not print
correctly") rather than a hard constraint on the data (an out-of-area stone is still valid project
state — the operator may be about to move or resize it). Blocking export would trade one clear,
immediate cost (no export at all) against a signal that is easy to act on once seen. Every export
path stays open; the decision is the operator's.

## 5. Tests

`tools/test-rs-3038-prod-sheet-messages.mjs` (new, auto-discovered by `tools/run-tests.mjs`,
registered in the `integration` and `exporters` groups alongside
`tools/test-production-sheet-exporter.mjs`). Follows the `sliceBalanced()` real-source-execution
harness pattern `tools/test-read-010-warn-only-floor.mjs` established. Covers:

- `countStonesOutsideProductionArea()` against five inline literal fixtures on a 150×150 area,
  2mm stones — centered, edge-touching (inside), partly outside, and two fully outside — expecting a
  combined count of 3.
- The real `updateProdSheetReadabilityValidation()` appends the outside-area message (naming the
  count and the W × H area) when stones lie outside `project.canvas`, and adds nothing when none do.
- The real `#exportProdSheetSVG`/`#exportProdSheetPNG`/`#exportProdSheetPDF` catch blocks, each
  extracted and executed for real with their exporter call stubbed to throw, write
  `Export failed: does not fit A4` into `#prodSheetValidation`.

Two existing tests were updated on the test side only, both a direct consequence of adding
`countStonesOutsideProductionArea` as a new export and as a new free variable inside
`updateProdSheetReadabilityValidation()`:

- `tools/test-production-sheet-exporter.mjs` test 20's pinned import-statement regex now includes
  `countStonesOutsideProductionArea`.
- `tools/test-read-010-warn-only-floor.mjs`'s `runProdSheetValidation()` harness now injects `layout`
  (defaulting to `null`, which short-circuits the new branch entirely) and
  `countStonesOutsideProductionArea` alongside the free variables it already stubbed, so its
  pre-existing readability-only tests are unaffected by this milestone's addition.

No other hit from grepping `tools/` for `prodSheetValidation`, `updateProdSheetReadabilityValidation`,
`exportProdSheetSVG`, `exportProdSheetPNG`, or `exportProdSheetPDF` needed a change: the `catch(error)
{el('status').textContent=`Export failed:` count both `test-production-export-validation.mjs` (10)
and `test-production-sheet-exporter.mjs` (3) pin was unaffected, since the new
`#prodSheetValidation` write was appended after the existing `#status` write rather than replacing
it; `tools/test-ui-shell-structure.mjs` and `tools/test-lightbox-controller.mjs` only assert the
controls/element exist, not their wiring.
