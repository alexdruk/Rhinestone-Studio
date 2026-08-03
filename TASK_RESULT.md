# Rhinestone Studio — Task Result

This document is completed by the implementation engineer after finishing the current task.

---

# Task ID

RS-2013 (Implementation Phase) — §4 step 5: stone-count stress testing

---

# Status

COMPLETE. New benchmark script (`tools/measure-instanced-stone-performance.mjs`) built, run, and
its real numbers captured below. No application code was touched — this step is measurement only,
per its own scope.

---

# Branch

feature/rs-2013-instanced-stones-step5-stress-testing (already checked out at task start, cut from
the step-4 integration commit `5ad66a1`, verified as HEAD before any work began).

---

# Cleanup accounting

`du -sh tools/*.png` at task start: no PNG files matched (`tools/*.png` — zero files), consistent
with step 4's own report that steps 1-3b's screenshot scratch assets were already fully removed by
`14ea561`. Nothing to clean up before starting, and this step produced no screenshots of its own —
the benchmark is a pure Node/console-output measurement, no browser or image output at all.

---

# What was built

## `tools/measure-instanced-stone-performance.mjs` (new)

A standalone Node script — **not** a `tools/test-*.mjs` file, deliberately: it does not match
`run-tests.mjs`'s `^test-.*\.mjs$` discovery pattern, so it is automatically excluded from
`npm test`/`node tools/run-tests.mjs --all` without needing an entry in
`tools/test-groups.mjs`'s `EXCLUDED_FROM_DEFAULT` — the same "prints measured numbers for a human to
read, no pass/fail assertion" role `tools/measure-performance.mjs` and
`tools/measure-boolean-precision.mjs` already play, and the file naming convention that keeps them
out of the test suite automatically. Run with `node tools/measure-instanced-stone-performance.mjs`.

**Fixture generation**: a hex-packed grid generator (`generateHexGridStoneParams()`) that solves for
a pitch producing *exactly* the requested stone count on a given canvas (binary-shrink the pitch
until the grid overshoots the target, then trim to the exact count) — synthetic, not hand-authored,
per the task brief. Stones use SS6's real diameter (2.0mm, `src/renderer/StoneSizes.js`) and a
single color (`'gold'`); at the denser counts adjacent stones visually overlap, which is expected
and irrelevant here — this benchmark exercises a fixed per-stone CPU cost, not a rendered look.

**Renderer harness**: the exact same "mounted without a real `init()`" convention
`tools/test-preview3d-instanced-stones.mjs` already established (real `Preview3DRenderer`, real
`'three'`, real `ObjectGeometryBuilder.js`; `WebGLRenderer`/`OrbitControls`/`ResizeObserver` — real
browser/DOM dependencies `update()` never touches — are bypassed with the same plain fakes that file
uses). This means the benchmark runs the **actual, unmodified** `_updateInstancedStones()` code
path, not a re-description of it.

**What is measured, at N = 1,000 / 5,000 / 15,000 stones on a mug (the curved-surface path —
azimuth trig, `wallRadiusAt()`, outward-normal alignment, per-stone spin — the most expensive of the
three product kinds `_updateInstancedStones()` handles) plus a supplementary 300mm-plate run at
N = 15,000 (the flat-plane path, and the literal scenario §1.3's worked ceiling calculation uses)**:

1. **Initial build cost**: the first `instance.update(layout, {..., instancedStones: true})` call at
   a new stone count — allocates the `InstancedMesh` buffer at that capacity and runs the full
   per-stone loop once.
2. **Steady-state per-`update()` cost during a simulated drag**: 20 further `update()` calls in
   quick succession, each with every stone's `xMm`/`yMm` perturbed by a small sinusoidal offset and a
   fresh `StoneLayout` constructed each time — mirroring `app.js`'s real, un-throttled
   `pointermove` → `updateAll()` path (cited in the design doc's §3.2 and step 3's own findings) —
   with **no capacity change**, so this isolates the per-stone matrix/color rebuild loop's cost from
   the one-time buffer-allocation cost measured in (1). Reported as min/median/mean/max across the
   20 calls, not just an average.

---

# The numbers (two independent runs, same machine, to check for run-to-run noise)

## Run 1

| Config | N | Build (first `update()`) | Drag `update()` min | median | mean | max |
|---|---|---|---|---|---|---|
| mug | 1,000 | 23.5ms | 1.66ms | 2.22ms | 2.99ms | 8.38ms |
| mug | 5,000 | 17.9ms | 8.32ms | 9.61ms | 9.88ms | 14.36ms |
| mug | 15,000 | 31.4ms | 26.78ms | 27.89ms | 28.58ms | 38.11ms |
| plate | 15,000 | 18.5ms | 6.97ms | 7.22ms | 7.25ms | 7.83ms |

## Run 2 (repeat, confirming these are not one-off noise)

| Config | N | Build | Drag `update()` min | median | mean | max |
|---|---|---|---|---|---|---|
| mug | 1,000 | 19.6ms | 1.67ms | 2.13ms | 2.94ms | 8.10ms |
| mug | 5,000 | 17.6ms | 8.40ms | 8.90ms | 9.14ms | 13.43ms |
| mug | 15,000 | 39.2ms | 27.65ms | 29.30ms | 29.81ms | 34.21ms |
| plate | 15,000 | 18.1ms | 6.95ms | 7.28ms | 7.67ms | 10.76ms |

The two runs agree closely (medians within ~10% of each other at every config) — these are real,
repeatable measurements on this machine, not noise.

---

# What this does and does not measure (read before trusting these numbers for anything beyond this
machine)

**Does measure**: real wall-clock time of the actual, unmodified `_updateInstancedStones()` CPU-side
loop (azimuth/radius/normal trigonometry, `getCrystalAppearance()`/`getCrystalColor()` lookups per
stone, `Matrix4.compose()`, `InstancedMesh.setMatrixAt()`/`setColorAt()`), running in real Node
against the real `'three'` module and real `ObjectGeometryBuilder.js` geometry — not a mock, not a
re-implementation, not an estimate.

**Does NOT measure**: actual GPU frame time (the rasterization/shading cost of the resulting
`InstancedMesh` draw call). There is no real GPU in this environment. A headless-Chromium/Playwright
run (the mechanism step 3/step 4 used for their own screenshot verification) was considered and
deliberately not used for this specific measurement — headless Chromium without a real GPU falls
back to a software rasterizer (SwiftShader/ANGLE), which would produce a number, but not one
representative of the real desktop-class GPUs this preview actually ships to; it would not have been
a more honest measurement, just a different unrepresentative one. The Node-side timing harness above
is the more honest choice for *this specific* measurement in *this specific* environment, precisely
because it's explicit about measuring the one real, environment-independent cost (CPU-side JS
execution) rather than producing a plausible-looking but misleading GPU number.

In place of a direct GPU measurement, the design doc's own analytical argument (§1.3/§3.1/§3.2)
stands: 15,000 stones × 8 triangles/octahedron = 120,000 triangles in **one** `InstancedMesh` draw
call is trivial for any WebGL2-class GPU (contemporary hardware comfortably renders single-digit
*millions* of instanced triangles per frame) — there is no polygon-budget or draw-call-count concern
at this stone-count ceiling, on any real GPU. This benchmark's job, and the one the design doc
identified as the actual open question, is the CPU-side cost below — not GPU triangle throughput.

Also worth naming as a caveat on the "build" numbers specifically: the very first `update()` call in
a fresh process pays a JIT warm-up cost (V8 hasn't yet optimized `_updateInstancedStones()`'s hot
loop) on top of the real one-time `InstancedMesh` buffer allocation — the "build" column above is not
a pure measurement of buffer-allocation cost alone. This is why the steady-state drag numbers (20
already-warm calls) are the numbers that matter for the real question this step exists to answer, not
the build column.

---

# Answering step 3's central question directly

**Is the CPU-side rebuild cost at the ceiling stone count (~15,000) fast enough to feel responsive
during a live drag — comfortably under the ~16ms 60fps frame budget?**

**No, not for the mug/tumbler curved-surface path.** At N = 15,000 on a mug, every `update()` call
during a simulated drag took a **median ~28-29ms and a max ~34-38ms** — roughly double the 16ms
budget on the median case alone, in both independent runs. This is not a "just fast enough, some
noise" result: the *minimum* observed call (26.8ms) already exceeds the budget by ~68%. **A drag at
this stone count would visibly stutter** — every pointer-move-driven `update()` call would take
roughly two 60fps frame-times' worth of main-thread JS execution before a frame could even be
requested, on top of whatever the (currently unmeasured, and per the analysis above, expected-cheap)
GPU render itself costs.

**At N = 5,000, it is borderline but currently within budget**: median ~9-9.6ms, max ~13.4-14.4ms —
under 16ms in both runs, but with less than half the budget left as headroom on the median and only
~2-3ms of margin on the observed max. This is "acceptable today," not "comfortably fast" — a modestly
slower machine, a busier main thread (other `update()`-triggered work, autosave, etc. per §3.2's own
autosave-debounce citation), or a richer future facet geometry (§3.1 flags a 16-triangle candidate as
a possible follow-up) would plausibly push this over budget too.

**At N = 1,000 (today's actual largest real example, `mixed-fill-styles-and-sizes.rhs` at 1,161
stones per §1.3), it is comfortably fast**: median ~2.1-2.2ms, max ~8.1-8.4ms — 2-8x headroom under
budget in the worst case. **Today's real designs are not at risk.** This finding is scoped
specifically to the *theoretical ceiling* stone count, not current production usage.

**The flat-plane (plate) path is meaningfully cheaper than the curved-surface (mug/tumbler) path at
the same stone count**: 15,000 stones on the 300mm plate took a median ~7.2-7.3ms, well within
budget — roughly a quarter of the mug's cost at the identical stone count. This confirms the design
doc's own §3.3 observation that the plate's placement math (flat projection, no `wallRadiusAt()`
interpolation, no per-stone spin) is strictly cheaper than the mug/tumbler/bottle curved-surface
math — and means the *product kind*, not just stone count, materially affects whether this concern
is live for a given design. A 15,000-stone plate design would drag smoothly today; a 15,000-stone
mug/tumbler design would not.

---

# What's now known vs. still unknown about performance at scale

**Now known** (this step):
- The exact per-`update()` wall-clock cost, on this machine, at three realistic-to-ceiling stone
  counts, for both the expensive (curved-surface) and cheap (flat-plane) placement paths — real
  numbers, not an estimate.
- The CPU-side rebuild cost genuinely becomes a live, user-visible responsiveness problem for
  mug/tumbler/bottle designs at the ~15,000-stone ceiling, and is borderline (not comfortably safe)
  already at ~5,000 stones on those product kinds.
- The InstancedMesh itself builds successfully and reaches the correct instance count at every
  tested stone count, on every tested product kind — no crash, no silent truncation, no error at
  scale.

**Still unknown** (out of scope for this measurement-only step, flagged for whoever scopes next):
- Real GPU-side render/frame time on actual client hardware (desktop and, notably, any lower-end
  device this browser tool might run on) — this environment has no real GPU to measure against; see
  "what this does and does not measure" above. The analytical triangle-budget argument is a strong
  a-priori case that this is *not* the bottleneck, but it has not been directly measured on real
  hardware, in a real browser, at these stone counts.
- Whether tumbler/bottle (the other two curved-surface product kinds `_updateInstancedStones()`
  handles) show materially different costs from the mug numbers above — not separately measured in
  this step; `wallRadiusAt()`'s cost (mug/tumbler) vs. the bottle's simpler constant-radius branch
  are structurally different in the source (`_updateInstancedStones()`, per-stone `if
  (dimensions.kind === 'bottle')` branch) and could plausibly differ, untested here.
- How this cost composes with other real per-`update()` work in a live Studio session (autosave
  scheduling, other renderer updates, DOM/UI reactivity) — this benchmark measures
  `_updateInstancedStones()` in isolation via a mounted-but-not-live renderer, not inside a real
  running `npm run dev` session under real event-loop contention.

---

# Are the mitigation options step 3 named now a hard requirement, or still just options?

The design doc's §3.2 named two options for the CPU-side cost, "worth evaluating during
implementation, not decided [t]here": (a) debouncing/throttling the instance-buffer rebuild during a
continuous drag, or (b) incremental/partial instance updates instead of a full rebuild every call.

**This step's findings make (a) or (b) a clear prerequisite before the instanced path could
reasonably ship *enabled by default* for mug/tumbler/bottle products at realistic-to-ceiling stone
counts** — not merely a nice-to-have. A ~28ms median per-`update()` cost during a drag is a real,
user-visible stutter, not a theoretical concern; §4 step 6 (visual validation + default flip)
should not flip the default on without one of these mitigations landing first, at least for
mug/tumbler/bottle. The plate path, and any product kind at ≤~1,000 stones, does not currently need
either mitigation per these numbers — so a plausible narrower framing for whoever scopes the next
step is "required before default-on for curved-surface products at high stone counts," not
"required unconditionally for every configuration." This step does not implement either option, per
its own scope — that determination and implementation is explicitly left to a future milestone.

---

# Scope discipline

- No change to `src/preview3d/**`, `src/geometry/**`, `app.js`, `index.html`, or any other
  application code — confirmed by `git status` before committing.
- No change to the placement/lighting/material logic already shipped in step 4.
- Neither mitigation option (debouncing, incremental updates) was implemented — measurement only,
  per this step's own scope.
- No screenshots or browser verification were produced or needed — this is a pure Node/console
  measurement; `du -sh tools/*.png` before and after this step: zero files both times (nothing to
  report as before/after size change).

---

# Testing

- `node tools/measure-instanced-stone-performance.mjs` — the new benchmark itself; produces the
  numbers reported above. Not part of `npm test`/`run-tests.mjs --all` by design (see "What was
  built" above).
- `node tools/run-tests.mjs preview3d` (the two pre-existing `Preview3DRenderer`-related test files,
  untouched by this step): **2/2 files, all tests passed** — confirms this measurement-only work
  introduced no regression to the code it exercises.
- `npm run test:full`/`node tools/run-tests.mjs --all` was **not** run for this step, per
  `CLAUDE.md`'s testing policy ("run only tests directly related to the current task" — this step
  changes no shared architecture, schema, or exporter code).

---

# Deliverables

- `tools/measure-instanced-stone-performance.mjs` (new).
- `TASK.md` (this milestone's), `TASK_RESULT.md` (this file).

---

# How to re-run this benchmark yourself

```bash
node tools/measure-instanced-stone-performance.mjs
```

No build step, no browser, no flags — prints the build cost and drag-simulation
min/median/mean/max for N = 1,000/5,000/15,000 on a mug, plus the supplementary 300mm-plate
N = 15,000 run, followed by a summary table and an explicit within/exceeds-budget verdict per
configuration.
