# MONO-019 — Duplicate monogram layer ids

**Status:** implemented. Branch `feature/mono-019-monogram-layer-ids` off `develop` @ the MONO-018
merge. Local only.

**Authorises:** re-iding the layer objects `MonogramGenerator.generate()` returns at the point
`app.js` inserts them, so a second monogram with the same frame and layout no longer collides with
the first. No change to `MonogramGenerator.js`. No geometry change — no screenshots.

---

## 1. The defect

`MonogramGenerator.generate()` builds every layer id from `frameId` and `layoutId` alone:

- `` `monogram-${frameId}-${layoutId}-letter-${i}` `` for each letter layer,
- `` `monogram-${frameId}-${layoutId}-frame` `` for the frame layer,
- `` `monogram-${frameId}-${layoutId}-letter-0` `` for the MONO-013 connected-script layer.

Generating a second monogram with the same frame and layout into a project that already holds one
produces duplicate layer ids. `validateProject()` (`app.js`) rejects a project whose layer ids are
not unique — `` throw new Error(`Duplicate layer id: ${l.id}`) `` — so the collision does not
surface at generation time. It surfaces on the next import, autosave-recovery, or Save/Open round
trip, whichever first re-runs the project through `validateProject()`. Latent since MONO-005/006;
the ids have always been frame+layout deterministic.

The `-detect` id (`` `monogram-${frameId}-${layoutId}-detect` ``) is a transient probe `layerId`
used inside the generator and is never returned or inserted — it is not affected.

## 2. The decision — re-id at insertion, not in the generator

The generator stays byte-for-byte deterministic. `app.js` assigns unique ids when it inserts the
returned layers, in `generateMonogram()`, after `generate()` returns and before `commitHistory()`.

### Why not in the generator

`MonogramGenerator.generate()`'s determinism is load-bearing. A random or time-based suffix inside
`generate()` would change every emitted layer id, and stones carry `layerId`, so every stone record
would change too — forcing a re-baseline of:

- MONO-012's `RS Block / traditional-three is byte-identical to the pre-MONO-012 baseline`,
- MONO-013's script goldens (372 / 369 stones, 136.501458 / 131.901458 mm),
- MONO-015's D1/D2/D3 goldens (Step 1 = 85, Step 2 = 68 stones),
- MONO-016's test 1 byte-identical layers across all five layouts (202 / 361 / 300 / 374 / 372),
- MONO-018's test 7 develop-golden layer set,
- `test-geometry-engine`'s determinism cases,
- the three examples-regression fixtures (147 / 66 / 441 stones).

None of that geometry is wrong. The bug lives entirely at the insertion boundary, so the fix lives
there.

### Why insertion is sufficient

The layers `generate()` returns are ordinary text/path layer objects carrying parameters — not
baked stones. `test-mono-006-monogram-ui.mjs` test 8 pins that they match `app.js`'s own text/path
layer schema field-for-field, and test 10 that they survive a Save/Open round trip. `app.js` derives
stones through `generate*StonesLive()` using `layer.id`, so rewriting a returned layer object's
`id` before insertion leaves nothing downstream holding a stale id. Confirmed against the current
generator: neither the slot branch (`MonogramGenerator.js` "Build ordinary project layers") nor the
script branch emits a `stones` field on any returned layer.

## 3. The change

`app.js`, in the Monogram Lightbox section:

```js
let monogramGenerationCounter=0;
function assignInsertionLayerIds(layers){
  const suffix=`${Date.now().toString(36)}-${(monogramGenerationCounter++%46656).toString(36)}`;
  for(const layer of layers)layer.id=`${layer.id.replace(/^monogram-/,'mono-')}-${suffix}`;
  return layers;
}
```

Called from `generateMonogram()` as `assignInsertionLayerIds(result.layers)` immediately after the
`!result.ok` guard and before `commitHistory()`.

- **One suffix per generation**, shared by every layer of the set, so the set still reads as one
  monogram in the layer list.
- **Before the history snapshot.** `commitHistory()` snapshots the project *before* the push;
  `HistoryManager.undo(current)` captures the *post-push* state (with the re-id'd ids) for redo. The
  re-id therefore happens before both, so one undo removes the whole set and redo restores exactly
  the inserted ids.
- **MONO-013's script layer follows the same rule.** It is one of `result.layers`; the loop does
  not special-case it. It shares the SEC-001 id convention deliberately and must not become an
  exception.
- The `-detect` probe id is inside the generator and never reaches this code.

### Suffix format and the length constraint

`LAYER_ID_PATTERN` is `/^[A-Za-z0-9_-]{1,64}$/` (`app.js`, SEC-001). Overflowing it would turn a
latent collision into an immediate hard rejection at `validateProject()` — strictly worse than the
bug — so the format is sized against the true worst case.

The worst-case pre-re-id id, crossed from the real catalogs (`FrameLibrary.listFrames()` ×
`MONOGRAM_LAYOUTS`, at the highest letter index):

```
monogram-rounded-square-traditional-three-letter-2   → 50 chars
```

The re-id rewrites `monogram-` (9) to `mono-` (5), saving 4, then appends
`-<base36 Date.now()>-<base36 counter mod 36³>`:

| part | width | note |
|---|---|---|
| `mono-rounded-square-traditional-three-letter-2` | 46 | prefix shortened from `monogram-` |
| `-` | 1 | |
| base-36 `Date.now()` | 8 | 9 from ~2059 |
| `-` | 1 | |
| base-36 counter, `mod 36³` | ≤ 3 | ceiling `zzz` |

Worst case today: **59** (57 with the counter still a single base-36 digit). Upper bound through
~2059: **60**. Both inside 64, with headroom.
`test-mono-019-layer-ids.mjs` test 4 asserts this against `LAYER_ID_PATTERN` from the real
catalogs, running the actual helper — never a hardcoded string.

The counter is taken `mod 36³` so its width is bounded at 3 characters. A suffix collision would
require 46 656 monogram generations within a single millisecond, which is not reachable; across
sessions the base-36 `Date.now()` stamp advances monotonically.

## 4. Tests

New `tools/test-mono-019-layer-ids.mjs` — seven tests: the bug is fixed and the result validates
(plus a JSON round trip); a negative control proving the raw generator output *does* collide;
generator output byte-identical to develop for a fixed request; worst-case id length from the
catalogs; script layers re-id'd by the same rule; undo/redo restores the same ids as one history
step; two monograms keep distinct stone `layerId`s so RC-004's cross-layer dedupe separates them.

Re-run with no committed baseline moving: `test-mono-006`, `test-mono-012`, `test-mono-013`,
`test-mono-014`, `test-mono-015`, `test-mono-016`, `test-mono-018`, `test-s200-app-integration`,
`test-project-validation-security`, `test-autosave-recovery-wiring`, `test-examples-regression`,
`test-architecture-module-boundaries`, `test-documentation-consistency`.
