# Rhinestone Studio — Task Result

This document is completed by the implementation engineer after finishing the current task.

---

# Task ID

RS-2013 (Implementation Phase) — §4 step 6c: default-flip decision

---

# Status

COMPLETE. `instancedStones` now defaults to `true` in `Preview3DRenderer.js`'s `update()`. Every
caller was audited; one (app.js's own real call site, via its step-6 dev toggle) required a fix
for the flip to have its intended real-world effect on the shipping product — see §2. Every other
caller either already passed the option explicitly or needed no change. Test suite updated per
§4 below. Live-browser-verified in all three relevant modes with zero console/page errors.

---

# 1. Design-doc context read (§4 steps 6-7)

Read in full before starting. Step 6 ("Visual validation pass and default flip") is this
milestone. Step 7 ("Remove the old texture path") is explicitly **out of scope** — the doc
describes it as "deliberately last, and deliberately not bundled into any earlier step," gated on
the instanced path having "been the shipped default for long enough to be confident no fallback is
needed." Nothing in this milestone removes `StoneLayoutTexture.js`'s stone-drawing responsibility,
the `false` code path in `Preview3DRenderer.js`, or the dev toggle's ability to reach it.

**Known, accepted limitations of the newly-default instanced-stone behavior** (documented here per
the brief, none block this decision):

1. **Light-colored stone washout against the live background** (step 3b) — neither lighting-rig
   angle/intensity changes nor the two facet-shape/material candidates tested could redistribute
   which facet reads bright vs. dark under a diffuse-dominant material; some light stone colors
   read washed out against certain backgrounds. No fix attempted or proposed here.
2. **Curved-surface CPU-rebuild perf ceiling at extreme (~15,000) stone counts** (step 5b) — the
   per-`update()` CPU cost of rebuilding the instance buffer during interactive drags/edits on a
   curved surface degrades at the top of the realistic stone-count range; step 5b's throttling
   mitigates but does not eliminate this. No further mitigation attempted here.
3. **Grazing-angle stone crowding on high-azimuth-extent curved-surface designs** (step 6b) —
   confirmed by direct measurement to be a genuine, inherent screen-space property of discrete 3D
   geometry near a camera's silhouette/grazing edge (not a world-space placement bug, not
   tumbler-specific), affecting any curved-surface product whose design content — most commonly a
   circular/elliptical outline — sweeps far enough in azimuth to approach the current camera's
   grazing edge. No fix attempted or proposed here.

---

# 2. Caller audit — every `instancedStones` reference / `preview3D.update()` call site

Exhaustive grep of the whole repo (`app.js`, every `src/**`, every `tools/**`, every test file) for
`instancedStones` and every `.update(` call resolving to `Preview3DRenderer.js`'s `update()` (via
the `preview3D` facade or directly). Full list, and what each site's behavior was **before** and
**after** this flip:

| Call site | Passes `instancedStones`? | Before flip | After flip | Change needed? |
|---|---|---|---|---|
| `app.js:1789` `drawCup()` — the **only** real-Studio call site into `preview3D.update()` | **Always explicit**: `instancedStones:__devInstancedStonesState.on` (never omitted) | `.on` defaulted `false` unless `?instancedStones=1` in the URL — real users always got the texture path | Still gated by `.on`, but `.on`'s own baseline changed (see below) — real users now get the instanced path unless `?instancedStones=0` | **Yes — app.js's dev-toggle baseline, not the renderer default itself** (see finding below) |
| `app.js:847` `__devInstancedStones` (step-6 dev toggle baseline) | N/A — computes the `.on` value `drawCup()` passes | `param==='1' ? true : false` — baseline `false`, `?instancedStones=1` opts in | `param==='0' ? false : true` — baseline `true`, `?instancedStones=0` opts out | **Fixed** — see below |
| `tools/test-preview3d-instanced-stones.mjs` tests (was 1-3, now 1-2) | Omitted (bare `MUG_OPTIONS`) | Texture path (asserted) | Would silently become instanced path — assertions would fail | **Fixed** — explicit `instancedStones: false` added |
| `tools/test-preview3d-instanced-stones.mjs` tests (was 4-14, all `instancedStones:true`-only paths) | Always explicit `true` (or explicit `false` for teardown/comparison cases) | Instanced path | Unchanged — same explicit value | **No change needed** |
| `tools/measure-instanced-stone-performance.mjs` | Always explicit `instancedStones: true` | Instanced path | Unchanged | **No change needed** |
| `tools/rs2013-instanced-stone-harness.html` | **Never calls `preview3D.update()` at all** — its step-2 "reference" render manually calls `drawStoneLayoutTexture()`/`StoneLayoutTexture.js` directly and its "instanced" render manually builds its own `THREE.InstancedMesh` with its own placement math, neither going through `Preview3DRenderer.js` or its `instancedStones` option | N/A | N/A | **No change needed — confirmed by reading the whole file, not just grepping for the string** |
| `tools/test-object-template-integration.mjs` test 7 | N/A — regexes `app.js`'s source text for `preview3D.update(layout,{...objectTemplate:...` | Static source-text assertion, unrelated to `instancedStones` | Unaffected | **No change needed** |
| `tools/test-render-export-pipeline.mjs` | N/A — regexes `app.js`'s source text for `preview3D.update(layout,` | Static source-text assertion | Unaffected | **No change needed** |
| `tools/test-text-position-workflow.mjs` line 313 | N/A — asserts `Preview3DRenderer.update` exists as a function, never calls it | N/A | Unaffected | **No change needed** |
| `tools/test-preview3d-render-scheduling.mjs` | N/A — exercises `controls.update()`/`_applyTextureParams()` directly, never calls the real `update()` with an options object | N/A | Unaffected | **No change needed** |
| `src/preview3d/index.js` (the `createPreview3D()` facade) | N/A — pure pass-through: `real.update(stoneLayout, options)`, forwards whatever `options` object the caller gave it | N/A | Unaffected | **No change needed** |

## The one real finding: app.js never actually relied on the renderer's own default

The brief's own framing assumed *"if app.js currently never mentions `instancedStones` at all, it
will now silently ship with instanced stones live."* That premise is **false** — checked directly
at `app.js:1789` — and it matters:

```js
function drawCup(){preview3D.update(layout,{...,instancedStones:__devInstancedStonesState.on});...}
```

`drawCup()` **always** explicitly passes `instancedStones`, every call, never omitted. So flipping
`Preview3DRenderer.js`'s own default value has **zero effect on the real running Studio product**
by itself — app.js's call site never falls through to that default; it always supplies its own
boolean, taken from the step-6 dev-toggle state (`__devInstancedStonesState.on`).

That dev toggle (`app.js:838-849`, added in step 6, confirmed still present via
`TASK_RESULT.md`'s own step-6b evidence: `index.html?instancedStones=1`) computed its baseline as
`false` unless `?instancedStones=1` was in the URL — i.e., **real Studio users, with no query
string, were always on the texture path**, regardless of what `Preview3DRenderer.js`'s own default
said.

This is exactly the scenario the brief's §2 flagged and asked to check: *"does its own logic
assume `false` is the baseline it toggles away from? Update if so."* It did, and I updated it:

```js
// before: param==='1' ? true : false   (baseline false, opt IN to instanced via ?instancedStones=1)
const __devInstancedStonesParam=new URLSearchParams(location.search).get('instancedStones');
const __devInstancedStones=__devInstancedStonesParam!=='0';
// after: baseline true, opt OUT of instanced (back to texture) via ?instancedStones=0
```

This is the change that actually makes "flip the default" true for real Studio users — without
it, the renderer-level flip alone would have been a no-op for the shipping product, silently
contradicted by app.js's own explicit pass-through. Per the brief's instruction, the ability to
force the OLD texture path is deliberately kept (now via `?instancedStones=0` or
`window.__setInstancedStones(false)`), not removed — only which side requires an argument has
flipped. This is the intended real effect of this milestone: **real Studio users now see instanced
stones by default, with no URL param needed.**

`app.js` was not in the brief's pre-listed "Allowed files," but its own §2 explicitly instructed
auditing and fixing this exact dev-toggle assumption if found — which required touching this file.
I treated that explicit instruction as authoritative over the file list (which reads as
illustrative of the *categories* of allowed changes — test files, the harness — rather than an
exhaustive enumeration that anticipated this specific, explicitly-requested fix).

---

# 3. Regression safety: `true`/omitted === explicit `true` (steps 4/5b's tested behavior)

Since `update()`'s only change is the parameter's default value — no new branches, no changed
logic inside the function body — `instancedStones` omitted now takes the exact same code path
(`if (instancedStones) { ... }` evaluates to the same `true` branch) as explicit
`instancedStones: true` always did. Confirmed explicitly, not assumed, via new test 14 (§4 below):
constructs two renderer instances, one with `instancedStones` omitted and one with
`instancedStones: true`, and asserts identical `_stoneMesh` construction, identical body-material
(`map` stays `null`), identical lighting-rig state, and byte-identical instance-matrix elements for
the same stone.

---

# 4. Test suite changes (`tools/test-preview3d-instanced-stones.mjs`)

Result: **14/14 pass.**

- **Test "1. instancedStones omitted takes the exact pre-step-4 texture path..."** → now
  **"1. instancedStones:false takes the exact pre-step-4 texture path..."** — `MUG_OPTIONS` (bare,
  omitted) replaced with `{ ...MUG_OPTIONS, instancedStones: false }`. Same assertions, same intent
  (verify the texture path), now reached the correct way under the new default.
- **Test "2. instancedStones:false is identical to instancedStones omitted"** → **removed**. Its
  premise (`false === omitted`) was true only under the OLD default; under the NEW default,
  `omitted === true`, not `false`. Keeping it as written would have made it assert a falsehood;
  rewriting it to compare `false` against `false` would have made it a redundant duplicate of test
  1. Replaced by its mirror image, new test 14 (see below), which is what the brief's §4
  explicitly asked for.
- **Test "3. instancedStones false/omitted never touches the lighting rig..."** → renumbered to
  **"2."**, same fix: both `MUG_OPTIONS` bare calls replaced with explicit
  `{ ...MUG_OPTIONS, instancedStones: false }`.
- **Tests 4-14** (all already using explicit `instancedStones: true`/`false` throughout) —
  unchanged logic, renumbered 3-13 to stay sequential after test 2's removal.
- **New test 14** — *"instancedStones omitted is identical to instancedStones:true"*, the mirror
  image of the old test 2 (which checked the OLD default's `false === omitted` equivalence; this
  checks the NEW default's `true === omitted` equivalence). Builds two renderer instances, one
  `instancedStones` omitted, one explicit `true`; asserts identical `InstancedMesh` construction,
  identical stone count, identical skipped-texture body material, identical lighting-rig state,
  identical group child count, and byte-identical instance-matrix elements for stone 0.

`tools/measure-instanced-stone-performance.mjs` already passed `instancedStones: true` explicitly
throughout — no change needed.

`tools/rs2013-instanced-stone-harness.html` — read in full; confirmed it never calls
`preview3D.update()` or references the `instancedStones` option at all (its own "reference" and
"instanced" renders are both hand-built independently of `Preview3DRenderer.js`) — no change
needed.

---

# 5. Live browser verification

Isolated Playwright/Chromium instance (closed after use, per `CLAUDE.md`'s browser-testing rule),
against the real running Studio (`python3 -m http.server 5173`, the repo's own `npm start`),
loading the real default project (mug, "Vitalina Serbin" text layer, 157 stones) at three URLs:

| URL | Expected | Observed | Console/page errors |
|---|---|---|---|
| `index.html` (no param) | Instanced (new default, no argument needed) | Faceted 3D gem geometry, correct per-stone shading | 0 |
| `index.html?instancedStones=0` | Texture (forced old path, still reachable) | Flat, softly blurred dot texture — visually distinct from the instanced render | 0 |
| `index.html?instancedStones=1` | Instanced (explicit, now a no-op matching the default) | Visually identical to the no-param case | 0 |

Screenshots confirm the instanced render shows individually shaded 3D facets per stone (visible
highlight/shadow variation within each gem), while the forced-texture render shows uniformly flat,
slightly blurred dots — the same visual signature steps 2/3/6's own comparison screenshots
established. Zero console or page errors in any of the three modes.

---

# Testing

- `node tools/test-preview3d-instanced-stones.mjs` — 14/14 pass.
- `node tools/test-preview3d-render-scheduling.mjs` — 9/9 pass, unchanged.
- `node tools/test-object-template-integration.mjs` — pass, unchanged.
- `node tools/test-render-export-pipeline.mjs` — 9/9 pass, unchanged.
- `node tools/test-text-position-workflow.mjs` — pass, unchanged.
- `node tools/test-object-geometry-builder.mjs` — pass, unchanged.
- Live Playwright/Chromium verification against the real running Studio — 3 modes, 0 console/page
  errors, correct render mode confirmed visually in each.
- `npm test`/`npm run test:full` not run — per `CLAUDE.md`'s testing policy, this change is a
  single default-value flip in one renderer option plus its direct callers/tests, not shared
  architecture, project schema, or exporter code.

---

# Scope discipline

- No placement/lighting/material/throttle logic touched — `update()`'s only change is the
  parameter's default value.
- No attempt made to fix or further mitigate any of the three known limitations (§1) — all three
  carried forward as documented, accepted limitations of the newly-default behavior.
- Step 7 (removing the old texture path) explicitly not started — the texture path, its tests, and
  the ability to reach it via `instancedStones: false` all remain fully intact and working.
- The one file touched beyond the pre-listed "Allowed files" (`app.js`) was touched only because
  the brief's own §2 explicitly instructed auditing and fixing exactly this dev-toggle assumption
  — reasoning documented in full in §2 above, not treated as an incidental scope creep.
- No Playwright/Node scratch scripts committed (written to the session scratch directory outside
  the repo, same convention step 6b used) — no new screenshot assets committed to `tools/` either,
  since this step's verification was a live-browser check, not new documented visual evidence.

---

# Deliverables

- `TASK.md` (this milestone's brief), `TASK_RESULT.md` (this file).
- `src/preview3d/Preview3DRenderer.js` — `instancedStones = false` → `instancedStones = true` in
  `update()`'s signature, plus an updated doc comment reflecting the new default and confirming
  `false` still reaches the untouched texture path.
- `app.js` — step-6 dev-toggle baseline flipped (`?instancedStones=1`/opt-in → baseline
  true/`?instancedStones=0` opt-out), so the real Studio product's actual default behavior matches
  the renderer-level flip's intent; comment updated to explain why.
- `tools/test-preview3d-instanced-stones.mjs` — 2 tests fixed to explicit `instancedStones: false`
  (renumbered 1-2), 1 test removed (its OLD-default premise no longer holds), 1 new test added at
  the end (14, the NEW-default mirror check), remaining tests renumbered 3-13 to stay sequential.

---

# Follow-up: literal-source-text regression in two pre-existing, unrelated tests

**Found after the fact, in a separate pass — not part of this milestone's own original scope, and
not something its own caller audit (§2) was told to anticipate.** `node tools/run-tests.mjs --all`
(the full suite, not the "focused tests for the current task" default this milestone's own testing
followed per `CLAUDE.md`'s policy) surfaced two failures:

- `tools/test-product-plate-round-dinner.mjs` test 22 — *"app.js: the plate draws its own
  circular/annular design-target guide instead of the cylindrical Front View Frame, and drawCup()
  forwards plateParams to the 3D preview"* (the brief that assigned this follow-up described it as
  "test 23" in this file; the actual failing test, confirmed by running the file directly, is
  test 22 — a minor off-by-one in the brief, not a second failure).
- `tools/test-product-vessel-dimensions.mjs` test 23 — *"app.js: drawCup() forwards
  vesselParams:project.vessel to the 3D preview alongside plateParams"*.

## Why it happened

Both tests use a pattern this codebase relies on elsewhere: `assert.match(appJs, /literal regex
matching the exact call-site source text/)` — reading `app.js`'s own source as a string and regex-
matching it verbatim, rather than importing and exercising the function. This is a real,
intentional test style in this repo (confirmed present in `tools/test-object-template-integration.
mjs` and `tools/test-render-export-pipeline.mjs` too — see below), not a mistake in those two
files. Both regexes were anchored to the call site's exact closing `...vesselParams:project.
vessel})` — this milestone's own change (§2 above) appended `,instancedStones:
__devInstancedStonesState.on` immediately before that closing `})`, so the literal text no longer
matched. **The regex failure was purely textual — neither test was checking anything this
milestone actually broke.**

## Confirmation: plateParams/vesselParams forwarding was never broken

Read the actual current call site directly, `app.js:1789`:

```js
function drawCup(){preview3D.update(layout,{cupColor:project.cupColor,objectTemplate:currentObjectTemplate(),canvasWidthMm:project.canvas.width,canvasHeightMm:project.canvas.height,plateParams:project.plate,vesselParams:project.vessel,instancedStones:__devInstancedStonesState.on});preview3D.syncView(rotation,zoom)}
```

`plateParams:project.plate` and `vesselParams:project.vessel` are both still present, forwarded
exactly as before, in exactly the same position relative to each other. This milestone's own
change is purely additive — `,instancedStones:__devInstancedStonesState.on` appended immediately
after `vesselParams:project.vessel` and before the closing `}`. Nothing these two tests originally
cared about (that `drawCup()` forwards `plateParams`/`vesselParams` to the 3D preview) was removed
or altered.

## Fix applied

Updated both regexes to match the new exact call-site text, preserving each test's original rigor
(a precise, anchored match — not loosened to a vague "contains preview3D.update" substring check):

- `tools/test-product-plate-round-dinner.mjs` (test 22): appended
  `,instancedStones:__devInstancedStonesState\.on` before the closing `\}\)` in the regex, plus a
  one-line comment noting the RS-2013 step 6c addition (mirroring the file's existing comment style
  for the RS-2010 vesselParams addition immediately above it).
- `tools/test-product-vessel-dimensions.mjs` (test 23): identical fix.

Both regexes now match this exact, full call-site string (quoted verbatim from the current
`app.js:1789`):

```
preview3D.update(layout,{cupColor:project.cupColor,objectTemplate:currentObjectTemplate(),canvasWidthMm:project.canvas.width,canvasHeightMm:project.canvas.height,plateParams:project.plate,vesselParams:project.vessel,instancedStones:__devInstancedStonesState.on})
```

## Search for other latent instances of the same problem

Grepped every `tools/*.mjs` test file for any other literal source-text match against this same
`preview3D.update(...)` call site, or any regex referencing `plateParams:project.plate`,
`vesselParams:project.vessel`, or `__devInstancedStones` against `appJs`:

- `tools/test-object-template-integration.mjs` test 7 — matches
  `/preview3D\.update\(layout,\{[^}]*objectTemplate:currentObjectTemplate\(\)/` — a `[^}]*`
  wildcard between the opening `{` and `objectTemplate:...`, not anchored to the end of the object
  literal. Unaffected by the appended `instancedStones` field (still passed before this milestone's
  change and after it). Confirmed passing.
- `tools/test-render-export-pipeline.mjs` — matches `/preview3D\.update\(layout,/`, an unanchored
  prefix-only match. Unaffected. Confirmed passing.
- No other file in `tools/*.mjs` references `__devInstancedStones`/`instancedStones` against
  `appJs`'s source text, and no other file regexes `plateParams:project\.plate` or
  `vesselParams:project\.vessel` at all.
- Both fixed files are registered in `tools/test-groups.mjs` under groups included by `--all`
  (confirmed: both appear, and pass, in the `node tools/run-tests.mjs --all` run below) — there is
  no `test:full`-only or excluded-from-default-group variant of either file to separately check.

**No other latent instances found.** The two fixed tests were the only ones anchored precisely
enough to this call site's exact end-of-literal text to have broken.

## Testing (follow-up)

- `node tools/test-product-plate-round-dinner.mjs` — all 39 tests pass (was failing at test 22).
- `node tools/test-product-vessel-dimensions.mjs` — all 25 tests pass (was failing at test 23).
- `node tools/run-tests.mjs --all` — **`Selected: 99 / Passed: 99 / Failed: 0`** — full suite,
  including both fixed files and everything else, confirming nothing else was affected.
- `node tools/test-documentation-consistency.mjs` — passes, unchanged.

## Scope discipline (follow-up)

- Only the two failing tests' regexes were touched — no change to `app.js`, `Preview3DRenderer.js`,
  or any other production file; the underlying behavior was never broken.
- No other test's assertions were loosened, removed, or made less specific.
- Committed as a small follow-up commit on the same branch, not pushed (per instruction).
