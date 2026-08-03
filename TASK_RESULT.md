# Rhinestone Studio — Task Result

This document is completed by the implementation engineer after finishing the current task.

---

# Task ID

RS-2013 (Implementation Phase) — §4 step 5b: curved-surface perf mitigation

---

# Status

COMPLETE. Chose and implemented mitigation option (a) — a leading-edge-plus-guaranteed-trailing
throttle on `_updateInstancedStones()` — in `Preview3DRenderer.js`. Re-ran the step 5 benchmark
(with one minimal, explained addition) and verified the mitigation's real effect with a realistic
inter-call cadence. **Honest verdict: the mitigation substantially reduces how often the expensive
rebuild fires during a sustained drag (duty cycle ~70% → ~9-12% at N=15,000 on the mug), but does
NOT bring any individual rebuild under the 16ms/60fps budget — each rebuild that does fire still
costs the same ~28-39ms it always did. The gap is only partially closed.**

---

# Branch

`feature/rs-2013-instanced-stones-step5b-perf-mitigation` (already checked out at task start, cut
from the step-5 stress-testing commit `9e98550`, verified as HEAD before any work began; working
tree was clean).

---

# Investigating both named options before choosing

## Option (b): incremental/partial instance updates

The brief asked whether `StoneLayout`/`GeometryEngine` currently expose any way to know *which*
stones changed between two calls. Read `src/geometry/StoneLayout.js` in full: it is a plain wrapper
around `stones: Stone[]` with no identity tracking, no dirty-flag concept, no previous-state
reference, and no diff/patch representation of any kind — `toJSON()`/`fromJSON()` round-trip the
whole array, nothing more. `app.js`'s real edit path (`updateAll()` → `engine.generate(project)`,
confirmed at `app.js:1120`) constructs a **brand-new** `StoneLayout` on every single call, including
every `pointermove`-driven frame of a drag (`app.js:1927-1930`, unthrottled, cited by the design
doc's §3.2). There is no per-stone identity that survives across two calls to compare against —
option (b) would require inventing new upstream plumbing (a diff/dirty-stone-index list threaded
through `GeometryEngine`) that does not exist today. Per the milestone's own explicit instruction,
this is reported as **out of reach for this scope** — a separate, bigger milestone — rather than
faked.

## Option (a): debounce/throttle

The brief asked specifically whether a debounce's visible lag is an acceptable tradeoff, or needs
visual validation first. Considered a **pure trailing debounce**, mirroring `app.js`'s
`AUTOSAVE_DEBOUNCE_MS` precedent (`app.js:872`, `flushAutosaveNow()`/`scheduleAutosave()`) exactly:
`clearTimeout`+reschedule on every call, fire only after the window elapses with no new calls.
Concluded this shape is **wrong for this specific case** without needing a browser trial: autosave
debounces a background `localStorage` write nobody watches happen in real time; a pure trailing
debounce on the instanced-stone rebuild would freeze the entire stone layer for the full duration of
every drag (however long the operator keeps moving the pointer, since every new call resets the
timer) and only snap into place once the pointer stops for the whole window — a materially different
and much worse UX than autosave's "invisible until it matters" property. This is knowable from the
mechanism itself, not something that required a visual A/B to rule out.

Chose a **leading-edge-plus-guaranteed-trailing throttle** instead — same broad "coalesce a
high-frequency signal" family as option (a), same `setTimeout`-based mechanism as the
`AUTOSAVE_DEBOUNCE_MS` precedent, but adapted from "delay until quiet" to "cap the rate, never
freeze":
- The first call after a quiet period (>= 100ms since the last real rebuild) always rebuilds
  **immediately** — a single discrete edit, or the first movement of a drag, is never delayed.
- Only calls arriving faster than the 100ms window get coalesced, always into exactly **one**
  trailing rebuild once the burst quiets (the latest call's data always wins — no staleness).
- A stone-**count** change (add/remove) is never throttled — it always rebuilds synchronously,
  since `InstancedMesh.count` must never lag an actual add/remove, and this is not the
  high-frequency-drag scenario step 5 measured (that was same-count position updates).

This directly answers the brief's question: **no, a pure debounce is not an acceptable tradeoff
here — a rate-limiting throttle with a guaranteed trailing update is the right shape**, and it did
not need a dedicated visual-lag validation pass to reach that conclusion, because the pure-debounce
failure mode (whole-drag freeze) is evident from the mechanism itself, not from ambiguity that only
a screenshot could resolve.

---

# What was implemented

`src/preview3d/Preview3DRenderer.js`:
- `INSTANCED_STONES_REBUILD_THROTTLE_MS = 100` — comfortably exceeds the worst single-rebuild cost
  step 5 measured at the ceiling (~34-38ms), so a fast burst always coalesces to at most ~10
  rebuilds/sec rather than the throttle being a no-op at the exact stone count that matters most;
  still short enough that the stone layer keeps visibly moving during a drag (not frozen the way
  `AUTOSAVE_DEBOUNCE_MS`'s 1200ms would read).
- `_updateInstancedStonesThrottled()` — the new gate `update()` now calls instead of
  `_updateInstancedStones()` directly when `instancedStones: true`. Computes the same
  `capacity`/`capacityChanged` check `_updateInstancedStones()` itself already does (cheap, no
  duplication of the actual rebuild logic) to decide whether to bypass the throttle. On the
  immediate path, calls the **exact same, unmodified** `_updateInstancedStones()` — this method's
  own per-stone loop was not touched at all, so its per-call cost is provably identical to what
  step 5 measured. On the throttled path, stores the latest args and schedules (or reschedules) one
  `setTimeout`.
- `_clearPendingInstancedRebuild()` — cancels any pending trailing timer; called from
  `_teardownInstancedStones()` (switching `instancedStones` off must not let a stale timer resurrect
  a torn-down mesh) and `dispose()`.
- No change to `_updateInstancedStones()`'s own body, to placement/orientation math, to the
  lighting rig (`_applyLightRig()`), or to material/color logic — all of step 4's shipped behavior
  is untouched; only *when* the existing rebuild function gets called changed.

---

# Re-running the step 5 benchmark

## Why one new parameter was needed (not optional polish)

The mitigation is a real-elapsed-wall-clock throttle. Step 5's `runDragSimulation()` calls
`update()` 20 times **back-to-back with zero delay** — against a throttle, that means 19 of the 20
calls resolve via the near-instant "coalesce, defer to a trailing rebuild" path, and the deferred
trailing rebuild (a real `setTimeout`) never gets a chance to fire *inside* the synchronous
20-call loop — Node's event loop can't run a timer callback until the calling function returns.
Reporting the raw before/after numbers from the unmodified loop as-is would show a median crashing
to ~0.01ms, which is real but **misleading on its own**: it looks like "the rebuild got cheap," when
actually most calls just got cheap *to issue*, with the identical, unmodified rebuild cost deferred
to a later, unmeasured moment.

Added exactly one optional parameter, `intervalMs` (default `0`), to `runDragSimulation()` — when
omitted (every one of step 5's original 4 call sites), behavior/output is byte-identical to the
unmodified script; when `>0`, the loop awaits a real `setTimeout`-based pause between calls,
simulating realistic pointer-event spacing so the throttle's actual coalescing/duty-cycle behavior
can be measured and reported honestly. One new section using this parameter was added
("Mitigation verification"); nothing else in the script changed.

## The four original blocks, re-run against the mitigated code (two independent runs)

These reuse step 5's exact zero-delay loop, unmodified — read per the caveat above: a near-zero
median here means "most calls now resolve almost instantly by coalescing," not "the rebuild itself
got faster."

### Run 1

| Config | N | Build | Drag `update()` min | median | mean | max |
|---|---|---|---|---|---|---|
| mug | 1,000 | 19.97ms | 0.001ms | 0.005ms | 0.014ms | 0.089ms |
| mug | 5,000 | 31.75ms | 0.002ms | 0.005ms | 0.006ms | 0.027ms |
| mug | 15,000 | 38.22ms | 0.003ms | 0.009ms | 1.775ms | 35.286ms |
| plate | 15,000 | 20.96ms | 0.006ms | 0.015ms | 0.403ms | 7.735ms |

### Run 2

| Config | N | Build | Drag `update()` min | median | mean | max |
|---|---|---|---|---|---|---|
| mug | 1,000 | 20.17ms | 0.001ms | 0.005ms | 0.019ms | 0.096ms |
| mug | 5,000 | 32.39ms | 0.002ms | 0.005ms | 0.008ms | 0.035ms |
| mug | 15,000 | 39.46ms | 0.003ms | 0.009ms | 1.752ms | 34.826ms |
| plate | 15,000 | 20.66ms | 0.006ms | 0.016ms | 0.393ms | 7.426ms |

Note the **max at N=15,000 mug is still ~35-39ms** in both runs — in this exact 20-call zero-delay
loop, real (unmeasured, via `makeLayout()`'s own 15,000-`Stone` construction cost, which happens
*outside* the timed `instance.update()` call) time accumulates across iterations until it exceeds
the 100ms window partway through the loop, at which point one call in the batch does trigger a real,
full-cost immediate rebuild — visible as the single ~35-39ms spike in the per-call arrays. This is
not a bug in the mitigation; it is exactly the same unmodified rebuild cost step 5 already measured,
firing once instead of 20 times.

## Mitigation verification: realistic-cadence drag simulation (the honest read)

`tools/measure-instanced-stone-performance.mjs` now includes a new section simulating 120
pointermove events at a genuine ~8ms real interval (a deliberately fast, ~120Hz-ish cadence — faster
than a 60Hz display can even render, to stress the coalescing behavior the way a high-poll-rate
input device would), at N=15,000 on the mug — the one configuration step 5 found exceeds budget.

**Before (mitigation reverted, same realistic ~8ms cadence, for a fair comparison):**

```
120 simulated pointermove events over 5088.797ms of real time (~8ms apart):
  120 of 120 calls actually rebuilt; 0 were coalesced.
  Total main-thread time spent in rebuilds: 3547.558ms of 5088.797ms real time (69.713% duty cycle).
  Per-rebuild cost: min=27.644ms median=29.383ms max=33.573ms.
```

**After (mitigation active, two runs):**

```
Run 1: 120 events over 2371.400ms.  9 of 120 rebuilt (111 coalesced).
       Total rebuild time: 282.716ms of 2371.400ms (11.922% duty cycle).
       Per-rebuild cost: min=28.513ms median=30.295ms max=38.845ms.
       After settling: mesh reflects the final stone position -- CONFIRMED.

Run 2: 120 events over 2229.953ms.  7 of 120 rebuilt (113 coalesced).
       Total rebuild time: 203.440ms of 2229.953ms (9.123% duty cycle).
       Per-rebuild cost: min=28.070ms median=29.186ms max=29.814ms.
       After settling: mesh reflects the final stone position -- CONFIRMED.
```

**What changed and what didn't:**
- **Duty cycle** (fraction of real drag time spent blocked in a stone rebuild) drops from **~70%**
  to **~9-12%** at the stone-count ceiling. Without the mitigation, the main thread would need to
  spend roughly 3.5 seconds rebuilding to process ~1 second of realistic-cadence pointer input —
  a guaranteed, continuous backlog/stutter for the whole drag. With it, only ~9-12% of the drag's
  real duration is spent blocked, leaving the rest genuinely free for rendering/input.
- **Per-rebuild cost when one does fire is unchanged**: ~28-39ms either way, since
  `_updateInstancedStones()`'s own body was never modified. This is the number option (b) could
  have reduced, and couldn't be reduced by option (a) at all — rate-limiting *how often* an
  operation runs cannot make one occurrence of it faster.
- **Correctness preserved**: in both mitigated runs, after the burst quiets the mesh always settles
  on the exact final requested stone position (verified against the analytically-expected azimuth/
  radius/height, not just eyeballed) — the trailing-guarantee mechanism works as designed, nothing
  is ever left permanently stale.

---

# Does this close the gap?

**No, not in the strict sense of every individual rebuild landing under 16ms — only partially.**
At N=15,000 on the mug/tumbler/bottle curved-surface path, any rebuild that actually fires still
costs ~28-39ms, unchanged from step 5, still roughly double-to-more-than-double the 60fps frame
budget. **What the mitigation achieves is frequency, not per-call cost**: it converts what would be
a continuous, unbroken stutter (every single `pointermove` event individually blocking the main
thread for ~28ms+, with the browser guaranteed to fall further and further behind real pointer
input) into **periodic, bounded hitches** — at the measured ~9-12% duty cycle, roughly one ~28-39ms
hitch every few hundred milliseconds of sustained fast dragging, with the main thread free the rest
of the time. That is a real, substantial, honestly-measurable improvement in aggregate
responsiveness and CPU load — but it is not "smooth," and it does not make the instanced path safe
to ship enabled by default for mug/tumbler/bottle at the ~15,000-stone ceiling on its own. Only
option (b) (reducing the per-rebuild cost itself via incremental/partial updates) could close the
gap in that stricter sense, and it is out of reach for this scope per the investigation above.

At N=5,000 and below (including today's real designs, ~1,161 stones at most), step 5 already found
the per-call cost comfortably within budget — the throttle is effectively a no-op there in practice
(ordinary edits are spaced far more than 100ms apart), so nothing changes for those cases, which is
the intended, unaffected behavior.

**For Sasha:** this mitigation is real and worth landing, but it is not free money — it trades
"continuous stutter" for "the stone layer visibly updates in coarser, throttled steps during a very
fast/sustained drag at extreme stone counts, with an occasional ~28-39ms hitch when a coalesced
rebuild does land," which is a genuinely better but still imperfect experience at the theoretical
ceiling. This is a resolvable-in-principle (via option (b)'s incremental updates, a separate,
larger milestone) but currently-unavoidable UX tradeoff at extreme stone counts — not a full fix.

---

# Required confirmations

1. **`instancedStones` still defaults to `false`, unaffected.** The throttle lives entirely inside
   the `instancedStones: true` branch of `update()` (`_updateInstancedStonesThrottled()`, only
   called when that flag is true) — nothing about the default/omitted path changed. Tests 1-3
   (regression safety) pass unchanged.
2. **No change to already-shipped placement/lighting/material behavior at low/moderate stone
   counts.** `_updateInstancedStones()`'s own body — the placement math, orientation, color mapping,
   lighting rig toggle — was not touched at all; only *when* it gets invoked changed. Tests 4-10
   (placement/orientation/color/lighting for mug and plate, toggling on/off, stone-count changes)
   all pass unchanged, and test 12 explicitly confirms ordinary, non-burst edits (calls spaced
   further apart than the throttle window) still rebuild immediately with no added lag.
3. **Capacity changes are never throttled** (test 13) — an added/removed stone always reflects
   immediately, even mid-burst, so the mesh's instance count never lags behind a structural edit.
4. **No stale-timer resurrection** (test 14) — switching `instancedStones` off while a trailing
   rebuild is pending cancels it; nothing can revive a torn-down mesh later.

---

# Testing

- `node tools/test-preview3d-instanced-stones.mjs` — 14/14 pass (10 pre-existing, unchanged; 4 new
  throttle-behavior tests: 11-14).
- `node tools/run-tests.mjs preview3d` — 2/2 files pass (both `Preview3DRenderer`-related test
  files).
- `node tools/measure-instanced-stone-performance.mjs` — numbers above; run twice for
  run-to-run-noise sanity, plus a before/after comparison of the new realistic-cadence section
  (mitigation reverted vs. active) using the same benchmark file.
- `npm run test:full`/`node tools/run-tests.mjs --all` **not** run, per `CLAUDE.md`'s testing
  policy — no shared architecture, project schema, or exporter code changed; this milestone touched
  only `Preview3DRenderer.js` and its two dedicated test/tool files.

---

# Scope discipline

- No change to `app.js`, `index.html`, or the live Studio UI.
- No change to placement/orientation/lighting/material logic already shipped in step 4 — confirmed
  by tests 4-10 passing unchanged.
- Option (b) was not implemented — confirmed out of reach for this scope (no `StoneLayout` diffing
  capability exists to build on; inventing one is a separate, bigger milestone).
- `instancedStones` default unchanged (`false`).
- Only the allowed files were touched: `src/preview3d/Preview3DRenderer.js`,
  `tools/measure-instanced-stone-performance.mjs` (one optional parameter + one new section),
  `tools/test-preview3d-instanced-stones.mjs` (4 new tests), `TASK.md`/`TASK_RESULT.md`.

---

# Deliverables

- `src/preview3d/Preview3DRenderer.js` — leading-edge-plus-guaranteed-trailing throttle on
  `_updateInstancedStones()`.
- `tools/measure-instanced-stone-performance.mjs` — `intervalMs` parameter on
  `runDragSimulation()` (default 0, existing call sites unaffected) + new "mitigation verification"
  section.
- `tools/test-preview3d-instanced-stones.mjs` — 4 new tests (11-14) covering throttle/coalesce,
  no-lag-when-spaced-out, capacity-changes-bypass-throttle, and teardown-cancels-pending-timer.
- `TASK.md`, `TASK_RESULT.md` (this file).
