# MAINT-003 — Materializer Contract Coverage

**Status:** IMPLEMENTED
**Branch:** `feature/maint-003-materializer-contract` (cut from `develop`; `develop`'s HEAD had
RS-3012 Step 5 merged, `464bf55` / merge `d3e1f37`)
**Scope:** Tests and documentation only. No `src/**` / `app.js` / `index.html` file changed — in
particular `src/drawing/DrawingCanvasTool.js` is untouched. One commit.

---

## 1. What was uncovered, and why it mattered

`src/drawing/DrawingCanvasTool.js` has six functions that turn one `project.layers` entry into one
Paper.js selection proxy — the layer-in / proxy-out half of Design's Select, dispatched by
`syncFromProjectLayers()`'s `materializeForLayer()`:

| Function | Layer category | Committed coverage before MAINT-003 |
|---|---|---|
| `materializeShapeFromLayer` | `path` | none |
| `materializeShapeLibraryItemFromLayer` | a `SHAPE_LIBRARY_KINDS` kind (star/heart/ring/…) | none |
| `materializeSvgImageItemFromLayer` | `svg`, `image` | none |
| `buildRectangleProxyItem` | `rectangle`, + the shared `svg`/`image` rectangle fallback | none |
| `materializeTextItemFromLayer` | `text` | none |
| `materializeCircleItemFromLayer` | `circle` | `test-rs3012-step4-circle-select.mjs` |

Four of RS-3012's five steps added a materializer; only circle (Step 4) and rectangle (Step 5, via
`test-rs3012-step5-rectangle-select.mjs`'s dispatch/proxy checks) had any test touching that layer.

Two specific gaps drove this milestone:

- **The no-double-rotation rule for `text` had zero tests.** `materializeTextItemFromLayer()` must
  *not* call `item.rotate()`: `GeometryEngine.generateTextLayout()` already bakes `rotationDeg`
  into the stone positions the proxy is built from (`docs/ARCHITECTURE.md` "Selection beyond shapes
  (RS-3012)" Step 3). A future refactor "harmonising" `text` with the other five types by adding an
  `item.rotate()` call would silently double every rotated text layer's on-canvas angle — nothing
  in the suite would notice.
- **The Step 5 refactor of the shared `svg`/`image` fallback was verified only by reading.**
  `buildRectangleProxyItem()` was extracted from inside `materializeSvgImageItemFromLayer()` during
  Step 5; correctness was established by diffing old and new source side by side. That is not a
  control.

## 2. What MAINT-003 adds

`tools/test-maint-003-materializer-contract.mjs`, registered in the `editing` group beside the
step-4 / step-5 tests. It drives every proxy through the real `syncFromProjectLayers()` (real
`createDrawingTool`, real headless Paper.js) — never by calling a materializer directly, since they
are module-private and the type→materializer dispatch is itself part of the contract — reusing the
`tools/test-rs3012-step4/step5` harness pattern (`loadPaperForNode()`, real
`syncFromProjectLayers`, the `resolveShapeLibraryPolygons` / `resolveSvgPolygons` spy technique).
Real `examples/*.rhs` fixtures supply every layer a fixture carries that type
(`boolean-union-badge` for `path`, `rectangle-only`, `circle-only`, `short-name-block` for `text`,
`svg-logo-import`, `image-trace-monogram`); only `star` uses a synthetic layer, because no
`.rhs` fixture carries a `SHAPE_LIBRARY_KINDS` type.

Coverage areas — see the test file for the assertions themselves, not restated here:

1. **Dispatch** — each category reaches its own materializer and no other, with explicit positive
   contrast for the three hook-driven types.
2. **Rotation** — the milestone's point. Three distinct rules asserted separately: `path` / `svg` /
   `image` / `rectangle` self-rotate via `item.rotate()`; `text` and `SHAPE_LIBRARY_KINDS` are
   never re-rotated (their geometry arrives already-rotated from upstream); `circle` ignores
   `rotationDeg` entirely. The text case asserts identical proxy bounds for `rotationDeg` 0 and a
   non-zero value against the *same* stones.
3. **Pivot / data stamps** — `rotationDeg` / `pivotXMm` / `pivotYMm` on every proxy, with the pivot
   each type actually uses asserted (box centre / stone-AABB centre / circle centre), not one rule
   assumed for all.
4. **Interaction-flag matrix** — one row per type: only `text` carries `noResizeHandles` /
   `isTextProxy`; only `circle` carries `noRotateHandle` / `isCircleProxy`; the rest carry none.
5. **Fallback** — `image`, and an `svg` whose outline can't be resolved, both produce the shared
   `buildRectangleProxyItem()` box — the same bounds an equivalent `rectangle` layer produces.
6. **`RESIZE_MIN_DIM_MM` clamping** in `buildRectangleProxyItem()` — a degenerate zero-width layer
   still yields a usable proxy.

Note: the work order's rotation section grouped `circle` and `SHAPE_LIBRARY_KINDS` with the
`item.rotate()` types. The code does not — `materializeCircleItemFromLayer()` and
`materializeShapeLibraryItemFromLayer()` never call `item.rotate()` — so the test asserts the
contract the code actually holds.

## 3. Scope boundary — stated as a decision

The materializer layer is contract-testable: these six functions are near-pure (one layer object
in, one proxy item out), and MAINT-003 now covers that contract.

The **interaction layer stays a deliberate non-goal.** No Pen, no Eraser, no mode-toggle, no grid
autoscale, no RS-3013 region gestures, no drag state machine. `docs/ARCHITECTURE.md`'s "Known
test-coverage gap: `DrawingCanvasTool.js` interaction layer" note frames backfilling that layer as
"speculative test insurance against nothing currently broken," the same way this codebase frames
`RS-2000` / `ARCH-REVIEW-001`'s accepted gaps. MAINT-003 does not reverse that reasoning: it closes
the part that was cheap and high-value to test (pure functions, one of them guarding a silent
rendering bug), and leaves the interaction-layer judgment exactly where RS-3012 left it.

## 4. What would justify revisiting the interaction layer

If someone changes one of the interaction tools named in that `ARCHITECTURE.md` note (Pen, Eraser,
the drag state machine, Design-side rotation/resize handles, grid autoscale) and judges the change
risky enough to want a regression net at that point — that is when the interaction layer earns its
coverage, on the change that motivates it.

---

## Validation

`node tools/test-maint-003-materializer-contract.mjs` (19/19), `node tools/run-tests.mjs --group
editing` (9/9), `--group documentation` (4/4), `--group architecture` (5/5). No application code
changed.

## Recommendation

Approve. Six materializers, two previously covered; the highest-value invariant in the file (no
double rotation for text) and the unguarded Step 5 fallback refactor now both have real,
execution-based tests. The interaction layer stays out of scope by the same reasoning
`ARCHITECTURE.md` already records.
