# IMG-026 — Strass layout service (Image → Strass v2)

Status: spec. No app or service code in this commit.

Reference: the prototype in `services/strass-layout/prototype/` (copied in from the 6 Oct 2026
handoff bundle before build A, and committed by it), its 12 test images and `expected/` results. The research log and the
integration plan are the Vitalina project doc `claude/openai-to-rs-correction.md` (sections 1–12)
and the Docs artifact "Image→Strass v2: integration plan". Where this spec and the plan disagree,
this spec wins; the differences are listed in "Corrections to the plan".

## Context

Today a redraw works like this. The browser posts the image to `/api/redraw` and waits up to
300 s for OpenAI. It then runs `detectAiStones()` (`src/image/AiStoneDetect.js`) on the returned
PNG, and `placeAiStones()` (`src/geometry/AiStoneSampler.js`) lays a new honeycomb over the box and
colours it from the detected stones. That honeycomb has one stone size and at most 8 colours, and
it discards OpenAI's own stone positions, eyes and outlines. This is where the quality is lost.

v2 replaces that last step with a layout service. The service takes the OpenAI image and returns
a finished, gap-checked stone list: every stone with its position, size and colour. The browser
only places and draws that list. The service is Python (StarDist, dlib, TensorFlow), so it runs as
a separate process next to the Node dev server.

What the prototype delivers on the 12 test images (re-derived from `expected/`, see "Reference
figures"): 0 gap violations, minimum gap ≥ 0.100 mm, coverage 0.627–0.796, 831–4,077 stones,
SS4 share 0.8–15.9 %.

The work ships as four milestones, one Claude Code build each:

| Build | Scope | Phases (plan) |
| --- | --- | --- |
| IMG-026A | Layout service package, golden tests, Mac scripts, Dockerfile | 1–2 |
| IMG-026B | Node job API, layout call, prompt v3, the 4 D2 colours with the S13 legacy pin and the S4 cross-check | 3–4, part of 5 |
| IMG-026C1 | SS4, `layer.aiLayout`, engine branch, gap flag, redraw writes the layout, sunburst default | 5, 8 (engine tests) |
| IMG-026C2 | Lightbox rework | 6, 8 (UI tests) |
| IMG-026D | Editing ai-layout stones in Design | 7, 8 (editing tests) |
| IMG-026E | Layout quality: outline chains, pupil core, prompt v4 | QA follow-up (7 Oct 2026) |

## Decisions accepted by Sasha (6 Oct 2026)

**D1. SS4.** Add SS4 (1.5 mm) to `src/renderer/StoneSizes.js`. How it is added is S12.

**D2. Four colours.** Add four catalogue colours. Shading follows the rule the IMG-016 entries
already use: stroke = round(0.56·v), shine = round(v + 0.83·(255 − v)), accent = round(0.77·v),
per channel. Every colour selector must list them.

| id | name | group | fill | stroke | shine | accent |
| --- | --- | --- | --- | --- | --- | --- |
| `colorado-topaz` | Colorado Topaz | Brown & Peach | `#a0602c` | `#5a3619` | `#efe4db` | `#7b4a22` |
| `light-smoked-topaz` | Light Smoked Topaz | Brown & Peach | `#8a6a4a` | `#4d3b29` | `#ebe6e0` | `#6a5239` |
| `scarlet` | Scarlet | Red & Pink | `#d0101e` | `#740911` | `#f7d6d9` | `#a00c17` |
| `hyacinth` | Hyacinth | Yellow & Amber | `#e0581c` | `#7d3110` | `#fae3d8` | `#ac4416` |

The shading values were computed with the rule and match `prototype/catalogue_v4.json` exactly.
The rule reproduces all six IMG-016 entries (hematite, black-diamond, grey, smoked-topaz,
light-colorado, light-peach) exactly, and none of the 17 older entries.

**D3. Flat artwork.** Remove the "Flat artwork" redraw style from the UI. Keep `FLAT_PROMPT_LINES`,
`REDRAW_STYLES` and the server's `'flat'` branch dormant and tested, so layers saved with
`redraw.style: 'flat'` still validate.

**D4. Old layers.** Layers saved before v2 keep their engine path and their controls. The
controls are shown only when such a layer is selected (S16).

**D5. Where the service runs.** For now, natively on Sasha's Mac next to the Node server, bound to
127.0.0.1:8000. Later, the same package in Docker on a rented server. Only `LAYOUT_SERVICE_URL`
changes.

Added on 6 Oct: "Redraw with AI" runs on every upload and its button is hidden; an Image→Strass
layer is editable stone by stone in Design, and both views read `layer.aiLayout.stones`.

## Spec decisions

**S1. Box = the stones, not OpenAI's frame.** The prototype measures stones in OpenAI's whole
square image, margins included. On the cat that frame is 133.3 mm, but the stones span only
103.0 × 130.8 mm. The service crops to the outer edges of the stones. `widthMm`/`heightMm` are
that bounding box, and stone coordinates are centres in mm from its top-left corner. The offsets
are offsetX = min(x − d/2) and offsetY = min(y − d/2) over the prototype's rounded stones, each
rounded to 0.001 mm first. Each coordinate is then round(x − offset, 3), so every centre distance stays exactly as the
prototype wrote it. The report also keeps `frameMm` and `offsetMm` so the crop can be undone in
tests.

**S2. The report is recomputed from the final list.** Several prototype report keys are written
before later stages change the stones. For example, on the cat the report says `colours_used` 18
and `ss6` 1823, while the final list has 17 colours and 1802 SS6 stones. The service builds its
report from the list it returns, after rounding.

**S3. Gap check on the returned numbers.** Coordinates are rounded to 0.001 mm (as the prototype
writes them). Violations are counted on the rounded list: a pair is a violation when centre
distance − (d₁ + d₂)/2 < 0.1 − 1e-6 mm. On `expected/` the rounded lists already pass (min
0.1000 mm, 0 pairs below 0.1 mm), so rounding does not need a fix-up step; the check is the guard.

**S4. Catalogue ownership.** The service owns `strass_layout/catalogue.json` (the
`prototype/catalogue_v4.json` content: 23 current entries plus the four D2 entries, in that order).
Its colour rules name specific ids (skin, brown family, Jet, Crystal), so the colour list cannot
come from the caller. The request carries `colorIds`, the ids the app knows; the service answers
422 `catalogue-mismatch` when its catalogue has an id the app does not. A Node test (build B)
asserts that every `catalogue.json` entry equals the `CrystalColors.js` entry with that id on
name and on all four colour fields (fill, stroke, shine, accent).

**S5. Determinism and the two golden checks.** The same PNG bytes and package versions give the
same stones. Two checks follow:

1. **Equivalence (same machine).** The packaged pipeline and the original prototype scripts
   (`run_one.sh`), run on the same machine, give identical stone lists for all 12 images. This is
   the check that catches refactoring mistakes, so it must be able to fail.
2. **Cross-machine (against `expected/`).** TensorFlow on macOS may detect a few stones
   differently. Each image must have 0 violations, min gap ≥ 0.100 mm, a stone count within 1 %
   of `expected/`, and coverage within 3 % (relative) of `expected/`.

On Linux (Python 3.13, TensorFlow 2.21.0, StarDist 0.9.2, dlib-bin 20.0.1.post1), `run_one.sh`
reproduced `expected/` exactly for all 12 images on 6 Oct 2026; see "Reference figures".

**S6. Human or animal.** Face landmarks run on the OpenAI image, as in the prototype. The plan
also proposed a first guess on the original photo during the OpenAI wait. That is dropped,
because it would not change any output. Keeping the models loaded is the time saving that
remains.

**S7. One layout at a time.** The service holds a process-wide lock, and the Node job queue also
runs one layout at a time. A job needs about 3 GB of RAM.

**S8. Models and test images in git.** There is one models folder, `services/strass-layout/models/`.
The prototype reaches it through its own `STRASS_MODELS` switch, so `prototype/models/` is not
copied. The StarDist model (`2D_versatile_fluo`, 5.6 MB) is committed under
`services/strass-layout/models/stardist/`. The dlib 68-landmark model (99.7 MB; GitHub warns
above 50 MB and refuses files above 100 MiB) is not committed. `setup_mac.sh` downloads it from PyPI
(`face_recognition_models==0.3.0`) and checks SHA-256
`fbdc2cb80eb9aa7a758672cbfdda32ba6300efe9b6e6c7a299ff7e736b11b92f`. The 12 test PNGs (26 MB) and
`expected/` JSONs (2.4 MB) are committed once, as `prototype/img/` and `prototype/expected/`, and
the package tests read them from there. The repo `.gitignore` already
ignores `__pycache__/`, `*.pyc` and `*.zip`. Build A adds `services/strass-layout/.venv/`,
`services/strass-layout/models/shape_predictor_68_face_landmarks.dat` and the prototype's
intermediate outputs (`services/strass-layout/prototype/N2_*` at the prototype root, not under
`img/` or `expected/`).

**S9. Python is confined.** CLAUDE.md says "JavaScript only". D5 makes an exception for this one
service: Python lives only in `services/strass-layout/`. Nothing in `src/`, `app.js` or `server/`
imports it, and the app reaches it only over HTTP. Build A adds a short "Layout service (IMG-026)"
section to CLAUDE.md saying exactly this.

**S10. Prompt numbering.** The research "prompt v2" (Vitalina doc `claude/openai-prompt-v2.md`) is
not the repo's `PROMPT_VERSION = 2`, which is the IMG-023 "designer" prompt. Appendix A becomes
`PROMPT_VERSION = 3`. BACKLOG row 77 currently reserves "PROMPT_VERSION 3" for a product-aware
stone count; build B renames it to "PROMPT_VERSION 4" and leaves it open.

**S11. The palette line stays generated.** `buildPaletteLine()` (`server/redraw/prompt.mjs`) makes
the colour list from the catalogue, so once build B adds the D2 colours the list has 27 entries
with no prompt edit. Appendix A therefore has no colour count in its wording, and the palette
line sits inside rule 4 instead of at the end. Display names come from the catalogue
("Light Colorado Topaz", not the research doc's "Light Colorado").

**S12. SS4 is an image-only size.** `listStoneSizes()` feeds the stone-size picker, monogram
frame sizing (`src/monogram/FrameHierarchy.js:30`), monogram remedies
(`src/monogram/MonogramGenerator.js:291`), the text height rules and about ten test files. Adding
SS4 there would change existing monograms and text layouts. Instead:

- `ss4` is defined with `diameterMm: 1.5`, `supportedHeightRangeMm: null` and `imageOnly: true`.
- The exported `STONE_SIZES` and `listStoneSizes()` stay exactly the five sizes they are today
  (`tools/test-stone-size-library.mjs` pins `STONE_SIZES.length` to 5).
- A new `listAllStoneSizes()` returns all six in ascending diameter, SS4 first. It feeds the Design
  size picker for ai-layout stones (SS4–SS30) and the Production Sheet size legend.
- `getStoneSize`, `isValidStoneSizeId` and `findStoneSizeByDiameterMm` cover all six, so
  1.5 mm stones get the "SS4" label everywhere.
- `tools/test-stone-size-library.mjs` skips its font-config cross-check for `imageOnly` entries.
  There is no `tools/font-generator/config/SS4.json`.

**S13. Old image layers keep the 23-colour palette.** `imageColorPalette()` (`app.js:749`) builds
the quantizer palette for every legacy fill mode from all of `STONE_COLORS`. If the D2 colours
reached it, saved image layers would re-quantize differently and D4 would break. Build B pins the
legacy palette to the 23 pre-v2 ids with a literal array, filtered inside the function body. This
region of app.js is `new Function()`-evaluated by several test harnesses, so no import may be
read at load time. Manual pickers, Design and the ai-layout path get all 27 colours. The 23 ids are
also exported as `LEGACY_IMAGE_COLOR_IDS` from `src/renderer/CrystalColors.js` for tests; a test
asserts the app.js literal equals it.

**S14. Size: enlarge only, aspect locked.** For an ai-layout layer, k = `layer.w / aiLayout.widthMm`.
The engine places each stone at (k·x, k·y) and keeps its diameter. With k ≥ 1 every gap stays
≥ 0.1 mm. `layer.h` is always `layer.w · heightMm / widthMm`. The engine clamps k below 1 to 1, and
the lightbox stops the user going below 1.

**S15. Products.** v2 targets the Flat Sheet. On a vessel, a 100–170 mm design often exceeds the
printable area. The existing RS-3038 outside-area warning shows, and nothing is shrunk. The
product-aware prompt stays in BACKLOG (S10).

**S16. Legacy controls.** Every control in "Hidden" below moves into one wrapper,
`#legacyImageControls`. `renderImageStudio()` shows it only when the selected image layer's
`fillMode` is not `'ai-layout'`. The shared Position/Stone/Mixed fields (index.html 1513–1616) are
moved into the lightbox slots by `app.js:5868`–`:5874` and also serve text and shape layers.
They are hidden only through their lightbox container, never by id, and never removed (restated in
the C2 "Controls" section). No engine code is deleted.

**S17. Colour swaps.** `layer.colorSwaps` is `{ fromId: toId }`. The engine applies it after
building the stones and after manual edits. The "Colours used" counts are taken after the swaps.

## Layout service (build A)

### Package

```
services/strass-layout/
  strass_layout/            package: pipeline modules, catalogue.json, __init__.py exporting layout()
  app.py                    FastAPI app: POST /layout, GET /health
  models/stardist/2D_versatile_fluo/   committed (S8)
  models/shape_predictor_68_face_landmarks.dat   downloaded by setup_mac.sh, gitignored
  tests/                    unittest tests; images and references read from prototype/img, prototype/expected
  scripts/setup_mac.sh, scripts/start_layout.sh
  requirements.txt          exact pins (== only)
  Dockerfile
  README.md
  prototype/                the research code as delivered (no models/), kept for the equivalence check
```

### Entry point

```
layout(png_bytes: bytes, color_ids: list[str] | None = None, target_pitch_mm: float = 2.1) -> dict
```

`layout_frame(png_bytes, target_pitch_mm=2.1)` returns the pipeline's final stones in the
prototype's format, coordinates and order (`{x, y, size, d, color}` in OpenAI-frame mm, as in
`expected/`) and the frame data. `layout()` is `layout_frame()` followed by the S1 crop, the S2
report, the S3 check and the S4 id check.

Returns:

```json
{
  "version": 1,
  "widthMm": 103.0, "heightMm": 130.8,
  "stones": [[19.030, 47.563, "ss6", "jet"]],
  "report": {
    "stones": 2146,
    "bySize": {"ss4": 342, "ss6": 1802, "ss30": 2},
    "colours": {"jet": 412},
    "minGapMm": 0.1001, "violations": 0,
    "coverage": 0.649, "largestEmptyCircleMm": 1.844,
    "face": "animal", "pupilsMm": [6.1, 6.1],
    "frameMm": 133.252, "offsetMm": [17.49, 1.66], "mmPerPx": 0.106,
    "stagesMs": {"detect": 0, "layout": 0, "eyes": 0, "colour": 0, "check": 0},
    "ms": 0
  }
}
```

The numbers above are illustrative except where "Reference figures" pins them. `sizeKey` is one
of `ss4 ss6 ss10 ss16 ss20 ss30`, with diameters 1.5, 2.0, 2.8, 4.0, 4.7 and 6.4 mm. `coverage` is
the prototype's `holes()` definition: the share of subject-mask pixels covered by a stone. The
subject mask is `compact.strict_mask(alpha, subject_mask(...))`, unchanged.

### Fixed settings (every `os.environ` read in the prototype)

| Prototype switch | Where | v2 value |
| --- | --- | --- |
| `TARGET_PITCH` | rs_fix.py:23 (default 2.2) | 2.1 (argument `target_pitch_mm`) |
| `CATALOGUE` | rs_fix.py:24, render.py:9 (default `catalogue.json`) | the package's `catalogue.json` (= `catalogue_v4.json`) |
| `KL` | rs_fix.py:28 | 1.0 |
| `VIVID` | rs_fix.py:53 | 1.0 |
| `CHROMA_W` | rs_fix.py:54 | 0.5 |
| `SKIN_NATURAL` | rs_fix.py:55 | on |
| `CLOSE_PX` | rs_fix.py:88 | the computed default |
| `SD_VIEWS` | sdens.py:32 | `Lw` then `alpha`, only. The prototype loops over its views dict in definition order, so `Lw` runs first even though `run_one.sh` writes `alpha,Lw`. The other 9 views are not computed. |
| `SD_IN`, `SD_OUT`, `FUSED_OUT` | sdens.py, runfuse.py | removed (in memory) |
| `EYE_MODE` | post.py:69 | `copy` (`build_eye_copy`) |
| `LASHES` | post.py:102 | on (applies only when landmarks are found) |
| `CL_INSIDE` | eyes4.py:80, :93 | off |
| `STRASS_W`, `STRASS_MODELS` | pathcfg.py | removed; models path is an argument with the package default |
| runfuse arguments | run_one.sh | `smin` 0.03, `mind` 0.8 |

Module state is passed explicitly: `rs_fix._ALPHA`, `_DETP`, `_DETTREE`, `_DETNN`, `_DEPTH`
(read by `compact.py:226` as `R._ALPHA`) and `landmarks._det`/`_sp` (these become the loaded-model
holder). Nothing on the v6 path reads or writes files except model loading. The original files,
read by name from `img/` and the working folder, become arrays passed between stages.

On the v6 path (as run by `run_one.sh`): `detect.py`, `detect2.py`, `sdens.py`, `runfuse.py`,
`fuse.py`, `wshed.py`, `rs_fix.py`, `post.py`, `compact.py` (only the functions `post.py` calls),
`pupils2.py`, `landmarks.py`, `eyes4.py`, `darkdots.py`, `colsmooth.py`, `distinct.py`,
`pathcfg.py`. Not on it: `pack.py`, `flow.py`, `upsize.py`, `ordp.sh`, `newpipe.sh`, `render.py`,
`drawStone.js`, `catalogue.json`, `looks.json`, and `compact.py`'s branches that import the
missing `flowrun` module (lines 79 and 244). `eyes4.build_eye` (the non-copy branch) is not on it.

### HTTP

- `POST /layout`: multipart with `image` (PNG, at most 20 MB, the same as
  `REDRAW_MAX_BODY_BYTES`) and `options` (JSON `{ "colorIds": [...], "targetPitchMm": 2.1 }`). The
  answer is 200 with the `layout()` result. Errors: 400 `bad-image` (not a decodable PNG), 400
  `no-alpha` (fewer than 1 % of pixels have alpha ≤ 0.5; the prototype has no magenta keying, and
  the OpenAI call already asks for a transparent background), 413 `too-large`, 422 `catalogue-mismatch` (S4), 422 `no-stones` (fewer than
  50 stones detected), 500 `layout-failed` (the exception message, no traceback). Each error body
  is `{ "error": code, "message": text }`.
- `GET /health`: 200 `{ "ok": true, "modelsLoaded": true, "version": "<package version>",
  "busy": <bool> }` once both models are loaded.
- Bound to 127.0.0.1 only. There is no auth: the port is not reachable from outside the Mac, and
  `/api/redraw` keeps its access code.

### Mac setup

`scripts/setup_mac.sh` uses `python3.12` (it stops with a clear message if that is missing, and
names `brew install python@3.12`), creates `services/strass-layout/.venv`, installs
`requirements.txt`, and downloads and verifies the dlib model (S8). If `dlib-bin` has no wheel for
the Mac, it says so and installs `cmake` then `dlib` from source. `scripts/start_layout.sh`
activates the venv and runs `uvicorn app:app --host 127.0.0.1 --port 8000 --workers 1`. Neither
script uses `#` comments. A `caffeinate -i` wrapper is printed as advice by `start_layout.sh`, not
run by it.

## Node jobs, prompt and colours (build B)

Amended 6 Oct 2026, after build A: the D2 colours, the S13 pin and the S4 cross-check move here
from build C. Without them every layout call would answer 422 `catalogue-mismatch` (S4), and build
B could not be checked end to end against the real service.

### Job API

- `POST /api/redraw` keeps the access-code check, the rate limit, the body limit and the style
  check exactly as today, then starts a job and answers 202 `{ jobId }` at once. `jobId` is
  `crypto.randomUUID()`. Fake mode also answers 202 with a job.
- `GET /api/redraw/:jobId` and `DELETE /api/redraw/:jobId` need the same
  `X-Redraw-Access-Code` header (401 without it) and answer 404 `{ code: 'not-found' }` for an
  unknown or expired job. They do not count against the rate limit.
- `GET` answers 200 `{ stage, result?, error? }`:
  - `stage` is `'drawing'` (OpenAI), `'placing'` (waiting for or running the layout), `'done'`
    or `'failed'`;
  - `result` is `{ dataUrl, model, promptVersion, layout }` when done, and
    `{ dataUrl, model, promptVersion }` when OpenAI succeeded but the layout failed;
  - `error` is `{ code, message }` when failed.
- `DELETE` answers 204, aborts the OpenAI or layout request in flight and drops the job.
- **Orphans.** A job that nobody has polled for 180 s is cancelled as if deleted. The browser
  polls every 3 s, so this only catches closed tabs, and it replaces today's "abort when the
  browser disconnects". 180 s, not 30 s, because Chrome wakes timers in a tab hidden for about 5
  minutes only about once a minute, and a background tab must not lose a paid job.
- **Lifetime.** A finished or failed job is kept for 30 min after it ends, then dropped. At most
  20 jobs are kept; when a 21st is created, the oldest finished job is dropped first, and if none
  is finished the request gets 429 `rate-limited`.

### Inside a job

1. **OpenAI**, exactly as today: same request, same 300 s timeout, same retry and safety-retry
   rules, same error mapping. The codes become the job's `error.code`: `provider-failed`,
   `rate-limited`, `declined`, `invalid-output`.
2. **Layout.** The job posts the PNG bytes to `LAYOUT_SERVICE_URL/layout` as multipart, with
   `image` (`image/png`) and `options`
   `{ "colorIds": Object.keys(STONE_COLORS), "targetPitchMm": 2.1 }`.
   - Layouts run one at a time, in job order (S7).
   - The timeout is 180 s (`LAYOUT_TIMEOUT_SECONDS`), with no retry.
   - Failure codes:
     - `layout-unavailable`: no URL set, or the connection is refused;
     - `layout-timeout`;
     - `layout-failed`: any non-200 answer, with the service's own error code and message in
       `message`.
   - On any layout failure, `result` still carries the OpenAI image (see the GET shape above).
3. Settings: `LAYOUT_SERVICE_URL` (default empty, meaning not set) and `LAYOUT_TIMEOUT_SECONDS`
   (default 180), both read in `server/redraw/env.mjs`. In `.env.example` they are added as two
   plain `KEY=value` lines with no comment lines (Sasha's no-`#` rule). They are explained in
   `services/strass-layout/README.md` under "Connecting the app". A missing URL does not turn the
   redraw routes off.
4. `REDRAW_FAKE=1` makes no OpenAI call and no layout call. The job goes through all three stages
   (`drawing` → `placing` → `done`) on the first three polls, then returns
   `FAKE_REDRAW_DATA_URL` and `server/redraw/fixtures/fake-layout.json`. That fixture is a valid
   layout of about 200 stones, in the build A response shape, with 0 violations.

### Client

- `src/redraw/OpenAiProxyProvider.js` posts, then polls `GET` every 3 s and reports each new
  stage through an optional `onStage(stage)` callback. On abort it sends `DELETE` and rethrows
  the abort.
- It resolves `{ dataUrl, model, promptVersion, layout, layoutError }`:
  - with `layout` and `layoutError: null` when the job is done;
  - with `layout: null` and `layoutError: { code, message }` when OpenAI succeeded but the layout
    failed.
- It throws the job's `error.code` only when there is no OpenAI image.
- `redrawImage()` (`src/redraw/index.js`) passes `layout` and `layoutError` through and forwards
  `onStage`. The new codes join `REDRAW_ERROR_CODES` and the provider's known-code set. Until
  build C1 the app keeps using only `dataUrl`, so the existing AI-stones path works unchanged.
- Polls are not retried. A failed poll (network error) counts as `network` only after 3 failures
  in a row.

### Prompt v3

`PROMPT_VERSION` becomes 3 with Appendix A (S10, S11). `FLAT_PROMPT_LINES` and
`FLAT_PROMPT_VERSION = 1` stay. BACKLOG row 77 is renamed to PROMPT_VERSION 4.

### Colours (D2, S13, S4)

- Append the four D2 entries to `CRYSTAL_COLOR_LIST`, after `light-peach`, with the D2 table's
  values exactly.
- Pin `imageColorPalette()` (`app.js:749`) to the 23 pre-v2 ids (S13).
- Add the S4 cross-check.

### Build B anchors (grepped at `271c853`)

| Anchor | Location |
| --- | --- |
| `createRedrawHandler()` / `callOpenAi()` / `handleRedraw()` / fake branch / return | `server/redraw/handler.mjs:69` / `:117` / `:169` / `:188` / `:196` |
| env `fake` setting | `server/redraw/env.mjs:43` |
| `PROMPT_LINES` / `PROMPT_VERSION` / `buildRedrawPrompt()` | `server/redraw/prompt.mjs:17` / `:10` / `:41` |
| redraw routes | `tools/dev-server.mjs:77`–`:78` |
| `REDRAW_ERROR_CODES` / `redrawImage()` | `src/redraw/index.js:25` / `:145` |
| `KNOWN_FAILURE_CODES` / `createOpenAiProxyProvider()` | `src/redraw/OpenAiProxyProvider.js:14` / `:23` |
| `imageColorPalette()` | `app.js:749` |
| `startImageRedraw()` / its `redrawImage` call (unchanged in B) | `app.js:5676` / `:5692` |
| last catalogue entry | `src/renderer/CrystalColors.js:155` |
| tests pinning 23 colours / prompt version 2 | `tools/test-crystal-color-catalog.mjs:91`, `tools/test-img-022-redraw-provider.mjs:171`, `tools/test-img-024-flat-artwork-style.mjs:124` |
| BACKLOG product-aware prompt row | `docs/BACKLOG.md:77` |
| `integration` test group | `tools/test-groups.mjs:94` |

## App, part 1: data and engine (build C1)

### Layer data

```json
"fillMode": "ai-layout",
"aiLayout": {
  "version": 1,
  "widthMm": 103.0, "heightMm": 130.8,
  "stones": [[19.030, 47.563, "ss6", "jet"]],
  "report": { "minGapMm": 0.1001, "violations": 0, "coverage": 0.649, "ms": 61000 },
  "editCount": 0
},
"colorSwaps": {}
```

- `aiLayout` is the build A response, minus `report` keys other than `minGapMm`, `violations`,
  `coverage`, `face` and `ms`, plus `editCount: 0`. Stones keep the service's order.
- `validateProject()` (`app.js:1270`; image checks at `:1296`–`:1300`) rejects an `aiLayout` with
  any of the following:
  - `version !== 1`;
  - a `widthMm` or `heightMm` that is not finite and > 0;
  - `stones` that is not an array, or has more than 20,000 entries;
  - a stone that is not `[finite x, finite y, valid size id, known colour id]`;
  - a non-integer `editCount` below 0;
  - a `colorSwaps` that is not a plain object, or has an unknown id on either side.
- Size ids are validated with `isValidStoneSizeId()` (all six, S12). Colour ids are validated
  against `STONE_COLORS` (all 27).
- Out-of-box coordinates are allowed (Design moves can push a stone past the edge).
- ai-layout image layers still carry `threshold`, `blurRadiusPx`, `maxWidthPx`, `maxHeightPx`,
  `stoneSize` and `gap`, because the existing checks and shared controls need them; `applyRedraw`
  keeps the values the layer already has.
- A layer keeps `aiLayout` when the user switches it to a legacy fill style, so switching back
  restores the same stones. A redraw that does not produce a layout removes aiLayout and colorSwaps, because they belong to the previous AI image.

### Engine

- `'ai-layout'` joins `IMAGE_FILL_MODES` (`app.js:678`) and `IMAGE_SAMPLE_MODES`
  (`src/geometry/GeometryEngine.js:79`).
- **Early branch.** `generateImageLayout()` (`:1212`) hands mode `'ai-layout'` to a new private
  method of the same engine, `generateAiLayoutStones(params)`, as its very first step, before
  `normalizeImageParams()`. That method validates its own small parameter set:
  - `layerId`, `xMm`, `yMm`, `widthMm`, `rotationDeg`, `aiLayout`, `colorSwaps`;
  - no `imageBuffer` and no field.

  This keeps the ai-layout path out of the whitelisted image normaliser (the IMG-009 six-site
  trap) and still produces every stone inside GeometryEngine.
- **What the method does:**
  1. Computes k = max(1, `widthMm` / `aiLayout.widthMm`) (S14).
  2. Builds one `Stone` per entry in list order:
     - position (`xMm` + k·x, `yMm` + k·y);
     - `sizeMm` from the size id;
     - colour `colorSwaps[c] ?? c`;
     - `metadata.aiIndex` = the entry's index in `aiLayout.stones`, which build D's edits use.
  3. Sets `metadata.gapViolation = true` on both stones of every pair whose gap is below
     0.1 − 1e-6 mm, checked before rotation with a spatial grid (not O(n²)).
  4. Applies the IMG-021 rotation exactly as the other modes do. `metadata` must survive it.
  5. Returns a `StoneLayout` with `sourceMode: 'ai-layout'` and
     `aiLayoutStats: { stones, violations, minGapMm, k }`.
- It is deterministic: the same layer gives the same stones in the same order. It needs no
  decoded image, so a project whose image fails to decode still shows its ai-layout stones.
- **app.js:**
  - `generateImageStonesLive()` (`app.js:1161`) takes the ai-layout branch before it decodes any
    buffer, passing `aiLayout`, `colorSwaps`, the box and `rotationDeg`.
  - `resolveImageExportRegions()` (`app.js:3483`) skips ai-layout layers, so the SVG export has
    no traced regions for them and their stones export as circles.

### Redraw writes the layout

- **Result with a layout.** In `startImageRedraw()` (`app.js:5676`), a `redrawImage()` result with
  `layout` takes the v2 path:
  - `applyRedraw(current, result, {…, layout})` sets `fillMode: 'ai-layout'`, stores `aiLayout`,
    sets `colorSwaps: {}`, records `previousFillMode` as the AI-stones path does, and sizes the box
    to exactly `widthMm × heightMm`, centred where the layer was;
  - on a Flat Sheet the sheet first grows to fit the box plus 20 mm, as IMG-023 does, up to
    `SHEET_MAX_MM`;
  - on other products the box is centred and not shrunk (S15).
- **Result without a layout** (`layoutError` set). The IMG-023 AI-stones path runs unchanged. The
  status line says: "Placed with the old method: <layoutError.message>".
- **Stage text.** `startImageRedraw()` passes `onStage` to `redrawImage()`. The status line reads
  "OpenAI is drawing… (up to five minutes)" for `drawing` and "Placing stones…" for `placing`.
- **Undo.** `restoreOriginal()` (`src/redraw/RedrawLayerTransform.js:147`) also undoes an
  ai-layout redraw: it removes `aiLayout` and `colorSwaps` and restores `previousFillMode`. Use
  original stays visible until C2.
- **Fill style select.** `imageFillMode` gets an option `ai-layout`, labelled "AI layout - stones
  placed from the AI redraw". It is enabled only when the selected layer has `aiLayout`, so
  `syncSelectedControlsFromLayer()` can show it and `writeSelectedControlsToLayer()` never turns an
  ai-layout layer back into Grid Fill.

### Default model

`REDRAW_ENV_DEFAULTS.OPENAI_IMAGE_MODEL` (`server/redraw/env.mjs:6`) and `.env.example:10` become
`gpt-image-2.5-sunburst`. `OPENAI_IMAGE_QUALITY` stays `high`.

### Size SS4 (D1, S12)

`src/renderer/StoneSizes.js` as S12 says. Production Sheet, DXF, PNG, SVG and 3D read `sizeMm` and
need no change. Build C1 must prove that with a 1.5 mm stone in each exporter's existing test
harness, rather than assume it.

### Build C1 anchors (grepped at `e42bbe5`)

| Anchor | Location |
| --- | --- |
| `IMAGE_FILL_MODES` / `generateImageStonesLive()` / `validateProject()` | `app.js:678` / `:1161` / `:1270` |
| `syncSelectedControlsFromLayer()` / `writeSelectedControlsToLayer()` / its `fillMode` write | `app.js:2625` / `:2789` / `:2857` |
| `resolveImageExportRegions()` | `app.js:3483` |
| `startImageRedraw()` / `grownCanvas` / `applyRedraw` call / success status | `app.js:5676` / `:5700` / `:5703` / `:5708` |
| `SHEET_MAX_MM` | `app.js:101` |
| `#imageFillMode` | `index.html:1200` |
| `IMAGE_SAMPLE_MODES` / `generateImageLayout()` / its IMG-021 rotation | `src/geometry/GeometryEngine.js:79` / `:1212` / `:1427` |
| `Stone` constructor (`metadata`) | `src/geometry/Stone.js:31` |
| `applyRedraw()` / `restoreOriginal()` | `src/redraw/RedrawLayerTransform.js:67` / `:147` |
| `STONE_SIZE_LIST` / `STONE_SIZES` / `getStoneSize` / `isValidStoneSizeId` / `findStoneSizeByDiameterMm` | `src/renderer/StoneSizes.js:37` / `:45` / `:53` / `:57` / `:77` |
| size-count test | `tools/test-stone-size-library.mjs:58` |
| default model | `server/redraw/env.mjs:6`, `.env.example:10`; tests that read it: `tools/test-img-022-redraw-provider.mjs`, `tools/test-img-024-flat-artwork-style.mjs`, `tools/test-img-026-redraw-jobs.mjs` |

## Lightbox (build C2)

For an ai-layout layer, the lightbox shows only four things: the source, the position and size,
the colours used, and the stats. Everything else is legacy, and it stays for layers that are not
ai-layout (D4). Line numbers are those of the anchors table at the end of this section.

### Flow

1. **Upload.** The `#importImageFile` handler creates the layer as it does today: staggered, with
   the legacy fields. If a redraw provider is available, the handler then calls
   `startImageRedraw()` at once. If availability is not known yet, it first awaits
   `getRedrawAvailability()`. Consent is asked at the first upload, as today. This is the only path
   that starts a redraw on its own. The audit must report any other path that creates an image
   layer.
2. **Waiting.** The canvas view switches to Source. The status line shows C1's stage texts, Cancel
   is visible, and the legacy controls are hidden.
3. **Layout arrives.** The layer is ai-layout, and the view switches to Template. The status line
   reads "Placed N stones. Gap check: V violations."
4. **No layout** (`layoutError`). The IMG-023 AI stones path runs, as in C1, with C1's "Placed
   with the old method: …" text. "Try again" shows.
5. **Failure, decline, cancel or refused consent.** The layer stays as uploaded, and the status
   texts are today's. "Try again" shows.
6. **No provider.** The status line reads "Redraw with AI is not available on this server, so the
   image was placed with the classic method." The legacy controls show.

`startImageRedraw()` always sends style `'stones'`. `#imageRedrawStyleField` is never shown. The
flat style stays dormant and tested (D3).

### Who sees what

A pure function, `imageStudioState(layer, { available, runningLayerId, failed })`, lives in the new
module `src/ui/ImageStudioState.js`. `renderImageStudio()` and `syncImageRedrawControls()` apply
its result, and do not repeat its rules. Its inputs:

- `runningLayerId` is the layer id of the running redraw, or `null`. app.js keeps it next to
  `redrawRun`.
- `failed` is true when this layer's last run in this session failed, was declined, was
  cancelled, or fell back to the old method. app.js keeps these layer ids in a `Set`. A run that
  produces a layout removes its layer id from the set.

| Key | Rule |
| --- | --- |
| `legacy` (`#legacyImageControls` shown) | there is a layer, its `fillMode` is not `'ai-layout'`, and `runningLayerId` is not this layer |
| `aiColours`, `aiStats` | `fillMode === 'ai-layout'` |
| `redrawButton` | `null` when there is no layer, `!available`, or any run is going. Otherwise, for ai-layout: `'Try again'` when `aiLayout.report.coverage < 0.5`, else `null`. For any other layer: `'Try again'` when `failed`, else `'Redraw with AI'` |
| `useOriginal` | `layer.redraw` exists, `fillMode` is not `'ai-layout'`, and no run is going |
| `views` | `{ mask, colours }` are false for ai-layout and true otherwise. `ai` is `!!layer.redraw`, as today |

The `'Redraw with AI'` label for other layers lets a layer saved before v2 be upgraded. It is a
spec decision made with C2.

`#imageRedraw` keeps its id and title; only its text changes. When `redrawButton` is
`'Try again'` and `aiLayout.editCount > 0`, a click first asks "This discards N manual edits."
Use the app's existing confirm dialog if one exists; the audit names it. Otherwise use
`window.confirm`, and report that.

### Controls (index.html)

The new order of the groups:

1. Source
2. Position & size
3. `<div id="legacyImageControls">`, holding in their current order: Trace, Stones, Colours,
   Organic, Edges, Check & fix, Brightness
4. A new `<details class="advanced-section" id="imageStudioGroupAiColours" open>` with the summary
   "Colours used", `<div id="aiLayoutColourRows"></div>`, and
   `<button id="aiLayoutColourReset" class="btn sm">Reset colours</button>`

Group ids do not change. For old layers, the only visible change is that Position & size moves
up.

The Stones group holds the slots that receive the shared stone and Mixed fields. Because that group
sits inside the wrapper, those fields are hidden only while they are in the lightbox. They are never
hidden or removed by id, and in the inspector they behave as today. This replaces S16's "hidden
per field". The inspector shows the same fields for an ai-layout layer as today; changing that is
a later build.

### Size (S14)

A pure helper, `aiLayoutBoxSize(aiLayout, request)`, lives in `src/redraw/RedrawLayerTransform.js`.
`request` is `{ widthMm }` or `{ heightMm }`. It returns `{ w, h }`:

- w = max(`aiLayout.widthMm`, the requested width, or the requested height × widthMm / heightMm);
- h = w × heightMm / widthMm.

It is applied in three places:

- **W and H fields.** In the image branch of `writeSelectedControlsToLayer()`, for an ai-layout
  layer, the field whose value differs from `l.w` (or `l.h`) is the one the user edited. The box
  keeps `x` and `y`. The fields are then synced back, so a value below the minimum snaps back.
  While an ai-layout layer is selected, `shapeW.min` and `shapeH.min` are the layout size. They are
  removed for any other layer.
- **Canvas handles.** Both resize branches at `app.js:4753` change for an ai-layout layer:
  - e, w and corner handles set the width; n and s handles set the height. The result then goes
    through the helper.
  - A corner handle keeps the opposite corner fixed. An edge handle keeps the midpoint of the
    opposite edge fixed.
  - The rotated branch keeps its `anchorAbs` and `handleOffset` formula and uses the locked w and
    h.
- **Design** (`src/drawing/DrawingCanvasTool.js`). If Design can resize an image layer, report it
  and do not change it (build D).

### Colours used (S17)

A pure helper, `aiLayoutColourRows(aiLayout, colorSwaps)`, lives in `src/ui/ImageStudioState.js`.
It returns one `{ fromId, toId, count }` per colour id that appears in `aiLayout.stones`:

- `count` is the number of stones with that original id;
- `toId` is `colorSwaps[fromId] ?? fromId`;
- rows are sorted by count, highest first; ties follow `STONE_COLORS` key order.

Each row shows:

- a swatch in `toId`'s `previewColor`;
- the name of `fromId`;
- the count;
- a select of all 27 colours, filled by `populateStoneColorOptions()`, with `toId` as its value.

A change runs `commitHistory()`, sets `colorSwaps[fromId] = toId` (or deletes the key when they are
equal), then runs `updateAll(true)`. Reset runs `commitHistory()`, sets `colorSwaps = {}`, then
runs `updateAll(true)`. Neither control joins `HISTORY_TRACKED_CONTROL_IDS`, and
`writeSelectedControlsToLayer()` reads neither. `renderImageStudio()` rebuilds the rows. Two
colours swapped to the same target stay two rows.

### Stats

For an ai-layout layer, four rows follow Bounding box. Their `dt` and `dd` are hidden for any other
layer.

| Row (dd id) | Value |
| --- | --- |
| Min gap (`imageStudioStatMinGap`) | `aiLayoutStats.minGapMm`, through `formatLengthDisplay` with 3 decimals |
| Gap violations (`imageStudioStatViolations`) | `aiLayoutStats.violations`, with class `validation-message` when above 0 |
| Coverage (`imageStudioStatCoverage`) | `aiLayout.report.coverage` as a whole percent, or "—" when absent |
| Enlarged (`imageStudioStatScale`) | k as "×1.00" |

`aiLayoutStats` comes from the `generateImageStonesLive(l, { includeStats: true })` call that
`renderImageStudio()` already makes, so no new call is added. The SS4 count is already in the Sizes
row, because `formatStoneSizeLabel(1.5)` is "SS4 (1.5 mm)".

### Views

- For an ai-layout layer, the Mask and Colours labels are hidden. If one of them is checked, the
  view switches to Template.
- **AI image and Overlay line up with the stones.**
  - `AI_LAYOUT_REPORT_KEYS` (`RedrawLayerTransform.js:66`) adds `offsetMm` and `mmPerPx`.
  - A pure helper, `aiLayoutImageBox(layer)`, in the same module returns the AI image's box
    `{ x, y, w, h }`, with k = max(1, `l.w / aiLayout.widthMm`):
    - x = `l.x` − k·offX, y = `l.y` − k·offY;
    - w = k·mmPerPx·`naturalWidthPx`, h = k·mmPerPx·`naturalHeightPx`.
  - The helper returns `null` when either key is missing (layers made with C1), and those keep
    today's drawing.
  - Under rotation the image turns about the layer box's centre, as `drawInBox` does.
  - `validateProject()` accepts the two keys when present: `offsetMm` must be two finite numbers,
    and `mmPerPx` a finite number > 0.
- Source is unchanged.

### Remove and Cancel

- Remove image cancels a running redraw for that layer before it deletes the layer.
- Cancel is unchanged, and marks the layer `failed`.

### Build C2 anchors (grepped at `0a306e8`)

| Anchor | Location |
| --- | --- |
| Lightbox `#lightboxImageTrace` | `index.html:1156`–`:1284` |
| Source group / redraw row / Trace group / Fill style | `index.html:1161` / `:1170`–`:1175` / `:1185` / `:1200` |
| Position / Stones (slots) / Colours / Organic / Edges / Check & fix / Brightness | `index.html:1209` / `:1213` / `:1218` / `:1232` / `:1239` / `:1245` / `:1249` |
| View toggle / stats | `index.html:1257` / `:1269`–`:1278` |
| Shared position, stone and Mixed fields | `index.html:1511`ff. |
| `IMAGE_FILL_MODES` / ai-layout branch in `generateImageStonesLive()` / aiLayout checks in `validateProject()` | `app.js:678` / `:1164` / `:1308` |
| `syncSelectedControlsFromLayer()` / ai-layout option / `writeSelectedControlsToLayer()` / image branch | `app.js:2644` / `:2688` / `:2809` / `:2877` |
| Canvas resize branches | `app.js:4753`–`:4773` |
| `HISTORY_TRACKED_CONTROL_IDS` | `app.js:5157` |
| Upload handler / Remove image | `app.js:5615` / `:5633` |
| `syncImageRedrawControls()` / `startImageRedraw()` / style read / Use original / `imgColorReset` | `app.js:5667` / `:5697` / `:5708` / `:5745` / `:5768` |
| `relocateFieldGroups()` / `lightboxes.imagetrace` | `app.js:5901` / `:5925` |
| `IMAGE_STUDIO_LIVE_GROUP_IDS` / `renderImageStudio()` / view switch / stats / `includeStats` call | `app.js:6700` / `:6713` / `:6842` / `:6866` / `:6878` |
| `fitAiLayoutCanvas()` / `AI_LAYOUT_REPORT_KEYS` / `applyRedraw()` / `restoreOriginal()` | `src/redraw/RedrawLayerTransform.js:57` / `:66` / `:100` / `:194` |
| `formatStoneSizeLabel()` | `src/renderer/StoneSizes.js:156` |

### Inventory (written before C2)

The lightbox is `index.html:1156`–`:1284`. Of its 35 controls, 8 are kept, 4 reworked and 23
hidden.

**Kept**

| Control (id) | v2 behaviour |
| --- | --- |
| Choose image file… (`importImage`) | Also starts the redraw job (after consent) |
| Remove image (`imageStudioRemove`) | Also cancels a running job |
| Cancel (`imageRedrawCancel`) | Shown for the whole wait; cancels the server job |
| Switch to Flat Sheet (`imageStudioSwitchToSheet`) | Unchanged |
| X / Y / Rotation (`shapeX`, `shapeY`, `shapeRotationDeg`) | Unchanged |
| Canvas view: Source, AI image, Template, Overlay (`imageStudioView`) | Template becomes the view after the layout lands |
| Stats (`#imageStudioStats`, `index.html:1269`) | Adds min gap, violations, coverage, SS4 count |
| Consent (`redrawAccessCode`, `redrawConsentContinue`) | Shown at the first upload |

**Reworked**

| Control (id) | v2 behaviour |
| --- | --- |
| Redraw with AI (`imageRedraw`) | Runs on every upload. Hidden for an ai-layout layer, except as "Try again" when coverage < 0.5. "Try again" also shows after a failure, decline, cancel or old-method fallback. A layer that is not ai-layout and has no failure keeps "Redraw with AI", so old layers can be upgraded. It asks first when `editCount > 0`: "This discards N manual edits." |
| Width / Height (`shapeW`, `shapeH`) | Aspect locked, enlarge only (S14) |
| Colour 1…8 + Reset (`imgColorPick0`–`7`, `imgColorReset`) | Replaced, for ai-layout layers, by "Colours used": one row per colour (swatch, name, count, replacement select listing all 27), plus Reset; writes `layer.colorSwaps` |
| Use original (`imageRedrawUseOriginal`) | Hidden for ai-layout layers; the original stays in the Source view |

**Hidden** (inside `#legacyImageControls`, S16 as restated in "Controls" above)

Redraw style (`imageRedrawStyle`, D3) · Mask (`imgMaskMode`) · Threshold (`imgThreshold`) ·
Invert (`imgInvert`) · Transparency (`imgTransparent`) · Blur radius (`imgBlurRadius`) · Maximum
width/height (`imgMaxWidth`, `imgMaxHeight`) · Fill style (`imageFillMode`) · AI stone size
(`imgAiStoneShrink`) · Clean up stones (`imgCleanup`, with `imgCleanupHint`) · Jet outline
(`imgJetOutline`) · Stone size (`stoneSize`) · Gap (`gap`) · Stone color (`stoneColor`) ·
Generation mode (`sizeMode`) · Allowed/min/max size and conservative detail (`mixed*`) · Number of
colours (`imgColorCount`) · Colour vividness (`imgVividness`) · Seed, Shuffle (`imgSeed`,
`imgShuffle`) · Spread (`imgSpread`) · Edge band, Thinning (`imgEdgeWidth`, `imgEdgeThinning`) ·
Brightness steps, Thinning (`imgBrightnessSteps`, `imgBrightnessThinning`) · Canvas views Mask and
Colours. The Check & fix group (`imageStudioGroupCheckFix`) and `imageStudioStatCleanup` hide with
them.

For layers saved before v2 nothing changes, including the known Mask-view defect:
`drawMask()` (`app.js:6772`) calls `prepareImageField` at `:6776` without `maskMode`. That defect
is not fixed here.

## Editing in Design (build D)

ai-layout image layers become editable stone by stone in Design. `layer.aiLayout.stones` stays the
only stone list: Design, the Image→Strass lightbox and every exporter read it through the engine,
so an edit in one shows in all. Other image layers stay `'ineligible'` as RS-3015 defines them.
Line numbers are those of the anchors table at the end of this section.

### Stone identity reaches Design

Today `aiIndex` and `gapViolation` are set by the engine and then dropped twice before Design sees
a stone:

- the ai-layout branch of `generateImageStonesLive()` maps stones to `{x, y, d, color, layerId}`;
- `engine.generate()` rebuilds every stone as `new Stone({...})` without metadata.

Both keep `metadata` from now on. `layoutStonesForLayer()` adds `aiIndex` and `gapViolation` to
each stone it hands to Design. Stones of every other layer keep `metadata: {}`, so their layouts and
JSON exports stay byte-identical. Design always names a stone by `aiIndex`, never by its position
in a list: a cross-layer dedupe can drop a stone and shift every later one.

### Stone editing mode

- **Enter:** double-click an ai-layout image layer with the Select tool. Its stones become
  selectable, and the rest of the canvas is dimmed.
- **Leave:** press Escape (when no pen path is open), click outside the layer, switch to another
  layer, or leave Design.
- **Other image layers:** a double-click does nothing new.

Inside the mode, with the Select tool:

| Gesture | Effect |
| --- | --- |
| Click a stone | Select it alone. Hit test: the nearest stone centre within its radius plus 4 screen px |
| Shift-click a stone | Add it to the selection, or remove it |
| Drag from a selected stone | Move the whole selection; one edit on release |
| Drag from an unselected stone | Select it alone, then move it |
| Drag from a gap | Rectangle select: stones whose centre is inside. Shift adds |
| Lasso | Stones whose centre is inside the lasso. Shift adds |
| Arrow keys | Move the selection 0.1 mm; with Shift 1 mm. One edit per key press |
| Delete / Backspace | Delete the selection |

- During a drag, the selected stones are drawn as outlines at their new place. The real stones
  move only on release.
- Selected stones get a blue ring.
- The selection lives in `DrawingCanvasTool.js` as its own state, `{ layerId, indices }`. It is
  separate from `activeSelection`, whose region and draft consumers do not change.
- A delete, an undo or a redo clears the selection. A move, recolour or resize keeps it, because
  `aiIndex` does not change.

### Selection panel

While stones are selected, the Design tool panel (`index.html:650`ff., toggled by
`updateDrawToolButtons()`) shows:

- `#aiStoneCount`: "N stones selected";
- `#aiStoneColor`: all 27 colours, filled by `populateStoneColorOptions()`. It shows the shared
  colour, or a blank "Mixed" entry when the selected stones differ;
- `#aiStoneSize`: sizes from `listAllStoneSizes()` (SS4–SS30), shared value or "Mixed";
- `#aiStoneDelete`: deletes the selection.

A change to colour or size is one edit for the whole selection.

### Stamp, Trace and Eraser

`tagMarkTarget()` makes an ai-layout image proxy mark-eligible, with `markStones` proximity
resolution as MONO-021 gives text (`markProxyContainsPoint()`). Any other image layer stays
ineligible.

| Tool | On an ai-layout layer |
| --- | --- |
| Stamp | Adds one stone at the click |
| Trace | Adds the spaced placements |
| Eraser, Stones mode | Deletes stones under the brush, by the same rule `eraseStonesWithinTest()` applies to a path layer |
| Eraser, Outline mode | Deletes stones whose centre is inside the swept corridor (nothing to cut, as for text) |
| Paint | Not supported: the layer is not a Paint candidate. Recolour through the selection panel instead |

While a layer is in stone editing, Stamp, Trace and Eraser act on that layer wherever you click,
so stones can be added outside the design, for example as a border. The data already allows stones
outside the box. Outside stone editing, the targets resolve as RS-3015 and MONO-021 say.

A Stamp or Trace size that is not a catalogue size snaps to the nearest of `listAllStoneSizes()`.
The status line names the size used, for example "Stamped SS10 (2.8 mm), the nearest size an AI
layout uses."

### One write path

`src/redraw/AiLayoutEdit.js` is a new pure module, exported through `src/redraw/index.js`. It holds:

- **`aiLayoutPointFromAbsolute(layer, { xMm, yMm })`.** It returns box coordinates, the inverse of
  the engine:
  - k = max(1, `layer.w / aiLayout.widthMm`);
  - undo the rotation about (`layer.x` + k·widthMm/2, `layer.y` + k·heightMm/2);
  - subtract `layer.x` and `layer.y`;
  - divide by k.
- **`aiLayoutDeltaFromAbsolute(layer, { dxMm, dyMm })`.** The same without the translation.
- **`applyAiLayoutEdits(layer, ops)`.** It returns `{ aiLayout, colorSwaps }` as new objects, and
  throws on bad input. The ops:

| op | Fields | Effect |
| --- | --- | --- |
| `delete` | `indices` | Removes those stones |
| `move` | `indices`, `dxMm`, `dyMm` (absolute) | Adds the box delta to each |
| `recolour` | `indices`, `colorId` | First bakes `colorSwaps` into every stone and empties it, then sets the colour |
| `resize` | `indices`, `sizeId` | Sets the size id |
| `add` | `stones: [{ xMm, yMm, sizeId, colorId }]` (absolute) | Appends, in order |

- Coordinates are rounded to 0.001 mm in box space, as the service writes them.
- `editCount` goes up by 1 per call.
- A call that would leave more than 20,000 stones throws, and changes nothing.
- Indices must be integers in range, sizes valid ids, colours known ids.

Recolour bakes the swaps so that what you see is what is stored. After a manual recolour, "Reset
colours" has nothing left to reset. This is a spec decision made with D.

**app.js** gets `editAiLayoutStones(layerId, ops, statusText)`. It is the only code that writes
`aiLayout` after a redraw. It:

1. finds the image layer and checks that it is ai-layout;
2. runs `commitHistory()`;
3. writes the result of `applyAiLayoutEdits()`;
4. runs `updateAll(true)`, and refreshes the Design stone group in the same order the path-layer
   hooks use;
5. sets the status text.

Every gesture above calls it. Each of `onStampPlace`, `onTracePlace` and `onEraseSweep` gets an
ai-layout branch before its path and text branches. `deleteCurrentSelection()` and the Design
keyboard block get a stone-selection branch first. An open Image→Strass lightbox redraws through
`updateAll()`, as today.

### Gap violations shown

Stones with `metadata.gapViolation` get a red ring:

- in Design, on an overlay drawn with the stone group (the cached sprites stay as they are);
- in the lightbox's Template and Overlay views, drawn after `renderStoneLayout()`.

`updateProdSheetReadabilityValidation()` adds a warning, never a block: "N stones in AI layouts
are closer than 0.1 mm to a neighbour. They have a red ring in Design." N counts layout stones
with `gapViolation`. Editing is never blocked.

### Size lock in Design (S14)

`onShapeResized()` gets an ai-layout branch:

- the edited dimension is the one that differs more from the layer's current value (ties go to
  width);
- it goes through `aiLayoutBoxSize()`;
- the box keeps the reported `left` and `top`.

This closes the gap the C2 report left open.

### Build D anchors (grepped at `1fe28c5`)

| Anchor | Location |
| --- | --- |
| `engine.generate()` stone rebuild | `app.js:1100` |
| ai-layout branch of `generateImageStonesLive()` | `app.js:1165` |
| `layoutStonesForLayer()` / `getImageLayerStones` wiring | `app.js:1688` / `:2478` |
| `onStampPlace` / `onTracePlace` / `onEraseSweep` | `app.js:1960` / `:2050` / `:2143` |
| `onShapeResized` | `app.js:2315` |
| `commitHistory()` | `app.js:2630` |
| `nudgeSelection()` | `app.js:3616` |
| `eraseStonesWithinTest()` | `app.js:4486` |
| Design keyboard block | `app.js:4873`–`:4942` |
| `updateProdSheetReadabilityValidation()` | `app.js:5856` |
| `drawTemplate` in `renderImageStudio()` | `app.js:6887` |
| `updateDrawToolButtons()` / `deleteCurrentSelection()` | `app.js:7145` / `:7515` |
| Design tool panel fields | `index.html:650`–`:680` |
| `NUDGE_STEP_MM` | `src/editing/EditingConstants.js:13` |
| Image proxy flag | `src/drawing/DrawingCanvasTool.js:814` |
| `activeSelection` / `markProxyContainsPoint()` / `resolveMarkTargetByBounds()` / `tagMarkTarget()` | `DrawingCanvasTool.js:1316` / `:1671` / `:1687` / `:1791` |
| `setActiveSelection()` / `rebuildImageStoneGroupForShape()` | `DrawingCanvasTool.js:1982` / `:2693` |
| Image branch of the reconcile, `tagMarkTarget` for images | `DrawingCanvasTool.js:5018`–`:5043`, `:5036` |
| `_generateAiLayoutStones()` / `flagAiLayoutGapViolations()` | `src/geometry/GeometryEngine.js:1223` (dispatch) / `:2752` |
| `Stone` metadata and `toJSON()` | `src/geometry/Stone.js:31`, `:52`, `:55` |

## Layout quality (build E)

The first live tests (7 Oct 2026) show that the layout service loses detail the AI drew:
- outlines turn into dashes;
- the eyes become one large black stone;
- skin and fur are blotchy.

A measurement on 18 AI images located each cause. The images are the 12 reference images, the
sunburst flower fixture, the second tulip, and four new uploads: the man, the bulldog, the
landscape and the woman.

- **Placement is faithful.** 96–99 % of the stones the detector finds keep their place within a
  quarter of a stone, and under 2 % of the output stones are invented fill.
- **Outlines.** The AI draws outlines as chains of small dark stones. The "shadow" rule
  (`ordered.py:49`–`:53`) and the "interstitial" rule (`:66`–`:76`) drop them as noise. Then
  `darkdots.clean()` (`post.py:166`) recolours the one- or two-stone fragments that are left.
- **Eyes.** `find_pupils()` measures the pupil out to the first pixel with lightness above 45
  (`eyes.py:71`–`:74`). A dark iris counts as pupil, so the pupil stone covers the whole iris and
  the iris rings sample black.
- **Colour.**
  - Our pick is the nearest catalogue colour for 80–93 % of stones. Neither neighbour smoothing nor
    other matching rules changed the result by more than 2 %.
  - The AI paints skin and fur in shades that lie between catalogue colours: about 8 ΔE2000 from
    the nearest one, against about 2 on blacks and whites.
  - So colour is fixed at the source, by prompt v4 (Appendix B), and not in the service.

### Rules

A new module, `strass_layout/rules.py`, holds a frozen dataclass:

```python
@dataclass(frozen=True)
class Rules:
    pupil_core_only: bool
    keep_chains: bool
    chain_dark_l: float = 30.0
    chain_min_len: int = 3
    chain_link: float = 1.35

PROTOTYPE = Rules(pupil_core_only=False, keep_chains=False)
DEFAULT = Rules(pupil_core_only=True, keep_chains=True)
```

- `layout_frame()` and `layout()` gain a keyword argument `rules=DEFAULT`, and pass it to
  `ordered_layout()`, `post_process()` and `find_pupils()`.
- The HTTP service always uses `DEFAULT`.
- No environment variable is read. The only one in the package stays `STRASS_SKIP_EQUIVALENCE`, in
  `test_equivalence` (S5.1).
- With `PROTOTYPE`, every function behaves exactly as today.

### Pupil core (`pupil_core_only`)

In `_find_thr()`, the pupil diameter is `De`, the equivalent diameter of the dark blob itself,
instead of `max(De, Dr)`. `Dr`, the ray march to lightness 45, is not computed. The rest of the eye
rule is unchanged:
- the pupil size is snapped to `PUPIL_SIZES`;
- the catch-light stays;
- the iris rings and the cleared zone follow from the smaller pupil.

So the iris the AI drew is sampled for the ring colours and is no longer painted black.

### Outline chains (`keep_chains`)

A new module, `strass_layout/chains.py`, holds `chain_mask(det, col, s, rules)`. It returns a
boolean mask over the detections. A detection is a chain member when all of these hold:
- its colour (Lab `col`, as `ordered_layout()` computes it) has L < `chain_dark_l`;
- its diameter is 1.1 mm ≤ d < 2.9 mm;
- it belongs to a connected group of at least `chain_min_len` such detections;
- in that group, two detections are linked when their centre distance is at most
  `chain_link` × (rᵢ + rⱼ).

How the mask is used:
- `ordered_layout()` computes it after the shadow and interstitial masks. Chain members are taken
  out of both (`shadow &= ~chain`, `inter &= ~chain`). The tiny and gap-colour rules are unchanged.
- `post_process()` computes the same mask. A placed stone within 0.5 mm of a chain member joins
  `genuine_dark` before `darkdots.clean()`, so that rule does not recolour outline fragments.

### Prompt v4

`PROMPT_VERSION` becomes 4. The stones prompt becomes Appendix B: Appendix A plus four colour rules
and two design rules. The flat prompt and `FLAT_PROMPT_VERSION = 1` do not change. The BACKLOG row
that reserved "PROMPT_VERSION 4" for the product-aware stone count (`docs/BACKLOG.md:77`) is
renamed to "PROMPT_VERSION 5".

### Measured on the experiment copy (7 Oct 2026, Linux)

Detection was cached, and the rest of the pipeline ran per variant. All 18 images:
- 0 gap violations, minimum gap ≥ 0.1000 mm;
- stone counts +0.0 % to +1.0 %, coverage within ±0.003.

| Image | Stones PROTOTYPE → DEFAULT | Pupils mm PROTOTYPE → DEFAULT | Dark-line coverage |
| --- | --- | --- | --- |
| cat | 2146 → 2150 | 6.16 → 5.91 | 0.910 → 0.946 |
| dog | 1670 → 1672 | 7.00 → 6.66 | 0.969 → 0.964 |
| einstein | 3574 → 3588 | 6.04 → 5.63 | 0.584 → 0.588 |
| jesus | 3268 → 3300 | 4.89 → 4.89 | 0.980 → 0.987 |
| leopard | 2425 → 2430 | 5.35 → 4.71 | 0.971 → 0.986 |
| woman | 2589 → 2606 | 6.32 → 6.32 | 0.929 → 0.953 |
| landscape (new) | 4633 → 4679 | — | 0.75 → 0.81 |
| bulldog (new) | 2421 → 2427 | 6.52 → 5.37 | 0.98 → 0.99 |

- **Dark-line coverage** is the share of the AI's dark pixels (L < 30 on white, alpha > 0.5)
  covered by a dark output stone (jet, hematite, black-diamond or smoked-topaz) grown by 0.15 of the
  pitch.
- **Over the 13 repository images** (the 12 reference images and the flower):
  - mean dark-line coverage goes from 0.7327 to 0.7385;
  - the mean share of detected stones dropped goes from 0.0491 to 0.0462.

### Build E anchors (grepped at `e18dbdc`)

| Anchor | Location |
| --- | --- |
| `find_pupils()` / `_find_thr()` / ray march / `Dr` | `services/strass-layout/strass_layout/eyes.py:17` / `:26` / `:71` / `:74` |
| `ordered_layout()` / shadow / interstitial / `use` | `strass_layout/ordered.py:27` / `:53` / `:76` / `:77` |
| `post_process()` / `find_pupils` call / `genuine_dark` / `darkdots.clean` | `strass_layout/post.py:37` / `:49` / `:161` / `:166` |
| `layout_frame()` / `layout()` | `strass_layout/pipeline.py:26` / `:120` |
| Test support calls `layout_frame()` | `services/strass-layout/tests/support.py:36` |
| `PROMPT_VERSION` / `V3_HEAD` / `V3_TAIL` | `server/redraw/prompt.mjs:11` / `:18` / `:45` |
| Prompt tests | `tools/test-img-022-redraw-provider.mjs:188`–`:191`, `tools/test-img-024-flat-artwork-style.mjs:139`–`:140` |
| BACKLOG row | `docs/BACKLOG.md:77` |

## Reference figures

Re-derived on 6 Oct 2026 from `prototype/expected/*.json` (the committed reference). Gaps are
computed on the rounded JSON values; bbox is the outer edge of the stones.

| Image | Stones | Min gap mm | Pairs < 0.1 mm | Frame mm | Bbox mm | Coverage | Colours | SS4 share | Large stones | D2 colours share |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| cat | 2146 | 0.1001 | 0 | 133.3 | 103.0 × 130.8 | 0.649 | 17 | 0.159 | 2 × ss30 | 0.056 |
| dog | 1669 | 0.1036 | 0 | 162.6 | 96.6 × 160.7 | 0.632 | 14 | 0.080 | 2 × ss30 | 0.011 |
| einstein | 3574 | 0.1001 | 0 | 156.2 | 150.5 × 143.5 | 0.668 | 14 | 0.084 | 2 × ss20 | 0.164 |
| jesus | 3269 | 0.1001 | 0 | 165.1 | 145.8 × 163.9 | 0.627 | 11 | 0.113 | 1 × ss20 | 0.019 |
| lake | 4077 | 0.1003 | 0 | 158.2 | 154.7 × 152.1 | 0.660 | 15 | 0.035 | — | 0.032 |
| leopard | 2426 | 0.1006 | 0 | 160.0 | 117.4 × 153.9 | 0.643 | 12 | 0.085 | 2 × ss20 | 0.006 |
| logo | 831 | 0.1024 | 0 | 154.9 | 144.9 × 79.1 | 0.796 | 3 | 0.008 | — | 0.000 |
| parrot | 2525 | 0.1000 | 0 | 177.1 | 168.3 × 151.6 | 0.641 | 19 | 0.084 | 1 × ss20 | 0.002 |
| portrait | 3978 | 0.1003 | 0 | 168.6 | 149.5 × 166.0 | 0.652 | 14 | 0.100 | 2 × ss20 | 0.027 |
| rose | 1846 | 0.1012 | 0 | 137.1 | 121.0 × 130.5 | 0.683 | 5 | 0.086 | — | 0.118 |
| tulips | 2670 | 0.1008 | 0 | 153.6 | 140.3 × 141.7 | 0.665 | 11 | 0.046 | — | 0.086 |
| woman | 2589 | 0.1013 | 0 | 153.2 | 143.8 × 146.7 | 0.672 | 6 | 0.066 | 2 × ss30 | 0.265 |

Coverage and frame come from each file's `report`. Everything else is computed from `stones` by
this generator (run with the prototype folder as the working directory):

```python
import json, glob, numpy as np
from collections import Counter
from scipy.spatial import cKDTree
NEW = {'colorado-topaz', 'light-smoked-topaz', 'scarlet', 'hyacinth'}
for f in sorted(glob.glob('expected/*.json')):
    d = json.load(open(f)); s = d['stones']; r = d['report']
    P = np.array([[t['x'], t['y']] for t in s]); D = np.array([t['d'] for t in s])
    pr = cKDTree(P).query_pairs(D.max() + 0.2, output_type='ndarray')
    g = np.linalg.norm(P[pr[:, 0]] - P[pr[:, 1]], axis=1) - (D[pr[:, 0]] + D[pr[:, 1]]) / 2
    x0, x1 = (P[:, 0] - D / 2).min(), (P[:, 0] + D / 2).max()
    y0, y1 = (P[:, 1] - D / 2).min(), (P[:, 1] + D / 2).max()
    c = Counter(t['color'] for t in s)
    print(f, len(s), round(g.min(), 4), int((g < 0.1).sum()), round(r['width_mm'], 1),
          round(x1 - x0, 1), round(y1 - y0, 1), round(r['coverage'], 3), len(c),
          round(float(np.mean(D == 1.5)), 3), Counter(t['size'] for t in s if t['d'] > 2.0),
          round(sum(c[k] for k in NEW) / len(s), 3))
```

### Prototype run, 6 Oct 2026

Linux, 2 cores, Python 3.13, the packages in S5. `run_one.sh <name>`, stones compared with
`expected/` by list equality:

| Image | Identical to expected | Detection s | Layout + eyes + colour s | Total s |
| --- | --- | --- | --- | --- |
| cat | yes (2146 / 2146) | 44 | 27 | 72 |
| dog | yes (1669 / 1669) | 42 | 27 | 69 |
| einstein | yes (3574 / 3574) | 51 | 25 | 76 |
| jesus | yes (3269 / 3269) | 50 | 30 | 81 |
| lake | yes (4077 / 4077) | 56 | 26 | 82 |
| leopard | yes (2426 / 2426) | 43 | 28 | 72 |
| logo | yes (831 / 831) | 34 | 19 | 52 |
| parrot | yes (2525 / 2525) | 46 | 31 | 77 |
| portrait | yes (3978 / 3978) | 60 | 34 | 94 |
| rose | yes (1846 / 1846) | 40 | 26 | 65 |
| tulips | yes (2670 / 2670) | 51 | 31 | 82 |
| woman | yes (2589 / 2589) | 47 | 27 | 74 |

All 12 are identical to `expected/`, so the prototype is a valid reference with these package
versions. Detection covers `detect.py` through `runfuse.py`; the rest is `rs_fix.py`, `post.py`
and `distinct.py`. Every step is a fresh Python process that imports its libraries and, for
StarDist and dlib, loads its model. The service keeps all of that loaded, so these totals are an
upper bound for it. The Python environment takes 2.8 GB on disk.

### Build A results, 6 Oct 2026

- **Linux** (the audit, newer libraries): `layout_frame()` equals `expected/` on all 12 images.
- **iMac** (Intel, macOS 13, TensorFlow 2.16.2, numpy 1.26.4): equivalence holds on all 12;
  results are within S5.2 of `expected/`.
- **M5 Pro laptop** (macOS 26.6, same pins): equivalence holds on all 12; within S5.2 (stones
  ±0.08 %, coverage ±0.15 %). The full suite (35 tests) took 795 s, against 2670 s on the iMac.

Live service on the laptop, models already loaded:

| Image | Stones | Total s | Detect s |
| --- | --- | --- | --- |
| cat | 2147 | 27.1 | 18.2 |
| einstein | 3571 | 31.9 | 23.5 |
| portrait | 3978 | 35.6 | 25.4 |

The laptop is the layout host for now (D5): both servers run there, and the app is opened from
other machines at `http://<laptop>.local:5173`.

**First live sunburst image (6 Oct 2026).** gpt-image-2.5-sunburst at quality high, with prompt v3,
returned 1024 × 1024 px with flat stones and transparent gaps. Its brightest spots all lie in the
gaps, so the watershed detector found no stone at all, and the empty result crashed
`detect_stones()` (the service answered 500). Fix: every detector returns a two-dimensional array
even when empty, and an empty or tiny candidate set skips fusion clean-up (then `no-stones`). The
image is kept as `tests/fixtures/sunburst_flower.png`; it lays out to 1011 stones, 92.9 × 115.3 mm,
0 violations, coverage 0.69. Visible weak spot: some dark separator lines between the lower petals
are lost.

**Second live crash (6 Oct 2026, tulip).** The service answered 500 "too many indices for array:
array is 1-dimensional, but 2 were indexed". It did not reproduce on the tulip image here (741
stones, 0 violations), so the cause is inferred: `frst_candidates()` with no peak returns a flat
empty array and raises exactly that message. Fix (`fix/img-026a-empty-paths`): `frst_candidates`,
`_nms`, `blob_candidates` and `_fuse` return two-dimensional arrays when empty, `ordered_layout()`
raises `NoStones` when no stone survives, and any unexpected error is logged with its traceback and
answered with the package file and line, `... (at detect.py:123)`, so a next failure names its
place. All 12 reference images stay identical to `expected/`.

**Model.** Production uses `OPENAI_IMAGE_MODEL=gpt-image-2.5-sunburst` with
`OPENAI_IMAGE_QUALITY=high`. gpt-image-2 rejected the transparent background on 6 Oct 2026.
Build C1 makes sunburst the default in `server/redraw/env.mjs`.

**Open QA item (phase 9).** The face test, unchanged from the prototype, finds a face in `lake`
and none in `jesus`, so `lake` gets the human eye rule and `jesus` the animal rule.

**Open QA item (phase 9).** The 12 test images are 1254 × 1254 px, but the app asks OpenAI for
`1024x1024`. Detection on 1024 px images must be checked with fresh images.

## Acceptance figures

**Build A.**

- Equivalence (S5.1) holds on all 12 images.
- The cross-machine check (S5.2) holds on all 12.
- `GET /health` is ok within 60 s of start.
- A `POST /layout` with `N2_cat.png` answers 200, and its stones equal the `layout()` call on the
  same bytes.
- Per-stage times are reported for all 12 images.

**Build B.**

- With `REDRAW_FAKE=1`, a job goes `drawing` → `placing` → `done` and returns the fixture layout.
- With a fake OpenAI and a fake layout service (both injected), every timeout, cancel, orphan,
  expiry and failure path gives the stage and error code listed in the build B section.
- With a fake OpenAI that returns `N2_cat.png` and the real layout service running, a job returns
  a layout equal to `POST /layout` on the same bytes.
- `imageColorPalette()` returns exactly the 23 pre-v2 entries, in catalogue order.

**Build C1.**

- Loading `N2_cat` `expected/` as an `aiLayout` (cropped as S1) gives 2146 stones, 0
  `gapViolation` flags, and every stone at k = 1 within 1e-9 mm of `xMm + x`, `yMm + y`.
- Its minimum gap is ≥ 0.100 mm at k = 1, 1.5 and 2, and under rotation 0°, 30° and 90°.
- k < 1 is clamped to 1.
- Moving one stone 0.05 mm from a neighbour flags exactly those two stones.
- A colour swap changes exactly the stones of that colour.
- `validateProject()` round-trips an ai-layout layer byte for byte and rejects each listed bad
  input.
- Every gallery project and every legacy image fixture gives identical stones.
- A 1.5 mm stone goes through the Production Sheet (labelled SS4), DXF, SVG and PNG exporters.

**Build C2.**

- `imageStudioState()` gives the table in "Who sees what" for each of these:
  - an ai-layout layer with coverage 0.65, and one with 0.4;
  - a staggered layer with and without `failed`;
  - an ai-stones layer with a `redraw` record;
  - the layer whose run is going, and another layer while it runs;
  - `available: false`;
  - no layer.
- `aiLayoutBoxSize()` on N2_cat (cropped as S1, as in C1):
  - a request of half the width gives exactly the layout size;
  - a request of twice the width gives a height of twice `heightMm`, within 1e-9;
  - a height request gives the matching width.
- `aiLayoutColourRows()` on N2_cat: the counts sum to 2146. After a swap a→b, row a has `toId` b,
  and the engine's stones of colour b number count(a) + count(b).
- `aiLayoutImageBox()`: exact boxes at k = 1 and k = 2, and `null` without `offsetMm` or `mmPerPx`.
- `applyRedraw()` keeps `offsetMm` and `mmPerPx`. `validateProject()` accepts them and rejects a
  bad `offsetMm` and a non-positive `mmPerPx`.
- index.html:
  - `#legacyImageControls` holds exactly the seven legacy group ids, and none of Source,
    Position & size or `imageStudioGroupAiColours`;
  - Position & size comes before the wrapper;
  - `#imageRedrawStyleField` is hidden.
- app.js:
  - the upload handler starts the redraw;
  - Remove aborts a run on its layer;
  - `startImageRedraw()` sends `'stones'`;
  - `aiLayoutColourReset` and the colour rows are not in `HISTORY_TRACKED_CONTROL_IDS`;
  - both canvas resize branches call `aiLayoutBoxSize()`.

**Build D.**

- aiLayoutPointFromAbsolute() inverts the engine within 1e-9 mm before rounding, at k = 1, 1.5 and 2 and rotation 0°, 30° and 90°. A stone added with `add` comes back from the engine within k·0.0005·√2 mm of where it was placed, the bound of the 0.001 mm rounding.
- `applyAiLayoutEdits()` on N2_cat (cropped as S1):
  - each op changes exactly the stones it names;
  - `editCount` goes up by 1 per call;
  - recolour bakes and empties `colorSwaps`;
  - a call that would exceed 20,000 stones throws and leaves the layer unchanged;
  - each bad input throws.
- An edit made through `editAiLayoutStones()` changes the same stones in the layout that Design and
  the Image→Strass view read. Undo and redo restore `aiLayout` and `colorSwaps` exactly.
- Moving a stone into a 0.05 mm gap sets `gapViolation` on both stones. They carry it in
  `layoutStonesForLayer()`, and the Production Sheet warning counts them.
- Layout stones of an ai-layout layer carry `aiIndex` and `gapViolation`. Every gallery project and
  every legacy image mode gives byte-identical stones and JSON export.
- Design (jsdom with Paper.js, as `test-img-020` runs it):
  - a double-click enters stone mode only on an ai-layout layer;
  - click, Shift-click, rectangle and lasso select by `aiIndex`;
  - a drag commits one `move` edit on release;
  - Escape leaves the mode;
  - Stamp, Trace and Eraser on an ai-layout layer reach their hooks with its layer id;
  - any other image layer still rejects as `'ineligible'`.
- app.js:
  - arrow keys move a stone selection 0.1 mm (1 mm with Shift), one history step each;
  - Delete deletes it;
  - `onShapeResized()` keeps the S14 lock;
  - the Stamp size snaps to a catalogue size.

**Build E.**

- With `rules=PROTOTYPE`, `layout_frame()` equals today's output on all 12 images. The equivalence
  test (S5.1) and the golden test (S5.2) run with `PROTOTYPE` and keep their figures.
- With `rules=DEFAULT`, on the 12 images and `tests/fixtures/sunburst_flower.png`:
  - 0 violations, and minimum gap ≥ 0.100 mm;
  - each stone count is at least the `PROTOTYPE` count and at most 2 % above it;
  - each coverage is within ±0.01 of `PROTOTYPE`;
  - each pupil diameter in `report.pupilsMm` is at most the `PROTOTYPE` one;
  - the mean dark-line coverage over the 13 images is above the `PROTOTYPE` mean, and the mean
    share of dropped detections is below it. Both are as defined in "Layout quality (build E)" and
    computed by the test.
- `chain_mask()`:
  - a line of 5 touching dark 1.5 mm detections is all chain;
  - 2 such detections are not;
  - 5 light detections are not;
  - with `PROTOTYPE` the mask is empty.
- `find_pupils()` on a synthetic eye (a black disc of radius 8 px inside a dark brown iris of radius
  16 px, iris lightness 35, with a white highlight): with `pupil_core_only` the diameter is about
  that of the black disc; with `PROTOTYPE` it is about that of the iris.
- `POST /layout` uses `DEFAULT`, and `test_contract` compares the HTTP answer with
  `layout(..., rules=DEFAULT)`.
- `PROMPT_VERSION === 4`, and the stones prompt equals Appendix B with the generated palette line.

## Tests the builds must add

**A.**

- `services/strass-layout/tests/`, run with `python -m unittest -v` from `services/strass-layout`:
  - `test_equivalence` (S5.1). For each image it runs `run_one.sh` in a temporary copy of
    `prototype/`, with `STRASS_W` set to that copy and `STRASS_MODELS` to the models folder. It then
    compares the result, order included, with the package's uncropped stage output
    (`layout_frame()`, the same stones in the prototype's frame coordinates and order, before S1).
    It is skipped with a printed reason when `STRASS_SKIP_EQUIVALENCE=1`; that is the only
    environment variable read anywhere in the package, and only by this test.
  - `test_golden` (S5.2), one subtest per image.
  - `test_contract`: response shape, size ids, colour ids ⊂ `colorIds`, coordinates within the
    bbox, a 422 for an extra catalogue id, a 400 for a JPEG.
  - `test_report`: the report recomputed from the returned stones equals the returned report.

**B.**

- `tools/test-img-026-redraw-jobs.mjs` (group `integration`):
  - job stages and every error code;
  - cancel, orphan cancel, 30-min expiry and the 20-job cap, with an injected `now` and timers;
  - layout timeout, layout-unavailable and fake mode;
  - access code on all three routes, and the rate limit on job creation only;
  - the exact multipart request sent to the layout service;
  - one layout at a time;
  - the client provider's polling, `onStage`, DELETE on abort, the 3-failure network rule and
    the result shapes.
- Prompt: `PROMPT_VERSION === 3`; the text equals Appendix A with the generated palette line; the
  flat prompt and `FLAT_PROMPT_VERSION === 1` are unchanged.
- `tools/test-img-026-catalogue.mjs` (group `core`): the S4 cross-check, and the 4 D2 entries'
  values.
- Legacy palette pin (S13): `imageColorPalette()` returns exactly the 23 pre-v2 ids in order,
  through the same app.js extraction `tools/test-img-010-line-design.mjs` uses.

**C.**

- C1: `tools/test-img-026-ai-layout-engine.mjs` (group `core`, engine only) with the C1 engine
  figures. `tools/test-img-026-ai-layout-app.mjs` (group `integration`) covers `validateProject()`,
  the redraw paths (with layout, without layout, restore), the fill-style option and the exporter
  checks.
- C2: `tools/test-img-026-lightbox.mjs` (group `ui`): the Build C2 acceptance figures, for an
  ai-layout layer and for a legacy layer.

**E.**

- `services/strass-layout/tests/test_rules.py`: the Build E service figures.
- `tests/support.py` caches frames per (image, rules).
- `tools/test-img-022-redraw-provider.mjs` T1 reads Appendix B instead of Appendix A.

**D.**

- `tools/test-img-026-design-editing.mjs` (group `editing`): the build D acceptance figures,
  Stamp/Trace/Eraser on ai-layout layers, and the RS-3015 eligibility of other image layers
  unchanged.

## Existing tests that grep the text these builds change

- `tools/test-img-022-redraw-provider.mjs`, `tools/test-img-024-flat-artwork-style.mjs`: the
  prompt text and version, the `/api/redraw` response shape, the redraw button (builds B, C).
- `tools/test-crystal-color-catalog.mjs:90`–`:91`: asserts 23 colours (build B → 27); `:158` and
  `:160` pin the six IMG-016 entries as `slice(17)` and the full id list (build B).
- `tools/test-img-016-neutral-brown-stones.mjs:183`, `:185`–`:186`, `:219` and `:221`–`:229`: the colour
  count, the six IMG-016 entries as `slice(17)` and the selector groups (build B); `:35` builds the
  quantizer stand-in palette from all of `STONE_COLORS` (build B, S13).
- The quantizer stand-in palette (`const PALETTE = Object.values(STONE_COLORS)...`) in
  `tools/test-img-012-auto-colour-count.mjs`, `test-img-013-fill-empty-slots.mjs`,
  `test-img-015-direct-catalogue-colour.mjs`, `test-img-017-vividness.mjs`,
  `test-img-018-whole-image-mask.mjs`, `test-img-019-subject-mask-resized.mjs`,
  `test-img-021-rotated-image-stones.mjs`, `test-img-023-ai-stone-transfer.mjs`,
  `test-img-024-flat-artwork-style.mjs` and `test-img-025-stone-cleanup.mjs`: filtered to
  `LEGACY_IMAGE_COLOR_IDS` so it stays the palette `imageColorPalette()` returns (build B, S13).
- `tools/test-stone-size-library.mjs`: the five sizes and the font-config cross-check (build C1,
  S12).
- Every test that evaluates the app.js span from `const DEFAULT_TEXT_FONT_ID=` (`app.js:177`) to
  `validateProject()` (S13).
- Build C2 changes text these files grep:
  - `tools/test-img-022-redraw-provider.mjs:721` (redraw control ids);
  - `tools/test-img-024-flat-artwork-style.mjs:469` and `:480` (the style field and its sync line);
  - `tools/test-img-025-stone-cleanup.mjs:523`–`:531` (Trace group and stats markup), `:568`
    (the cleanup stats line) and `:573`–`:574` (`#imageRedraw` markup);
  - `tools/test-img-005-check-and-fix.mjs:340`–`:344`;
  - `tools/test-ui-shell-structure.mjs:218`;
  - `tools/test-img-026-ai-layout-app.mjs` (the report keys and the success status text).

  The build's audit must find any others.
- Build D changes text these files grep:
  - `tools/test-img-016-neutral-brown-stones.mjs:47` (the pinned stone-colour selects gain
    `aiStoneColor`);
  - `tools/test-rs3015-mark-target-eligibility.mjs` (ai-layout images become eligible);
  - `tools/test-img-020-image-stones-in-design.mjs` and `tools/test-mono-021-mark-hooks.mjs` (the
    hooks gain an ai-layout branch).

  The build's audit must find any others.

## Anchors (grepped at `7a9e482`)

| Anchor | Location |
| --- | --- |
| `IMAGE_FILL_MODES` | `app.js:678` |
| `imageColorPalette()` | `app.js:749` |
| `generateImageStonesLive()` | `app.js:1161` |
| `validateProject()` / image checks | `app.js:1270` / `:1296`–`:1300` |
| `commitHistory()` / `updateAll()` | `app.js:2607` / `:3043` |
| `syncSelectedControlsFromLayer()` / `aiStoneSizingKey()` / `resizeAiStoneLayer()` / `writeSelectedControlsToLayer()` | `app.js:2625` / `:2767` / `:2772` / `:2789` |
| `HISTORY_TRACKED_CONTROL_IDS` | `app.js:5136` |
| import handler | `app.js:5594` |
| `syncImageRedrawControls()` / `startImageRedraw()` / `applyRedraw` call / `restoreOriginal` call | `app.js:5646` / `:5676` / `:5703` / `:5724` |
| shared field slots | `app.js:5868`–`:5874` |
| `renderImageStudio()` / `drawMask` | `app.js:6689` / `:6772` |
| `populateStoneSizeOptions()` | `app.js:263` |
| `IMAGE_SAMPLE_MODES` | `src/geometry/GeometryEngine.js:79` |
| `generateImageLayout()` / `isAiStones` / cleanup gate | `src/geometry/GeometryEngine.js:1212` / `:1216` / `:1396` |
| `normalizeImageParams()` | `src/geometry/GeometryEngine.js:2530` |
| `applyRedraw()` / its `fillMode: 'ai-stones'` / `restoreOriginal()` | `src/redraw/RedrawLayerTransform.js:67` / `:121` / `:147` |
| client `REDRAW_STYLES` | `src/redraw/index.js:28` |
| `createOpenAiProxyProvider()` | `src/redraw/OpenAiProxyProvider.js:23` |
| `CRYSTAL_COLOR_LIST` / last entry `light-peach` | `src/renderer/CrystalColors.js:48` / `:155` |
| `STONE_SIZE_LIST` / `listStoneSizes()` / `findStoneSizeByDiameterMm()` | `src/renderer/StoneSizes.js:37` / `:62` / `:77` |
| monogram size consumers | `src/monogram/FrameHierarchy.js:30`, `src/monogram/MonogramGenerator.js:291` |
| RS-3015 image proxies | `src/drawing/DrawingCanvasTool.js:5036`, `:5110` |
| `PROMPT_VERSION` / `buildRedrawPrompt()` | `server/redraw/prompt.mjs:10` / `:41` |
| `createRedrawHandler()` / fake branch | `server/redraw/handler.mjs:69` / `:188` |
| `REDRAW_ENV_DEFAULTS` | `server/redraw/env.mjs:5` |
| redraw route / `listen` (all interfaces) | `tools/dev-server.mjs:78` / `:97` |
| lightbox / Source group / redraw row / Trace group / Colours group / stats | `index.html:1155` / `:1161` / `:1170` / `:1185` / `:1218` / `:1269` |
| shared Position/Stone/Mixed fields | `index.html:1513`–`:1616` |
| BACKLOG product-aware prompt row | `docs/BACKLOG.md:77` |
| `.gitignore` Python lines | `.gitignore:20`–`:21` |

## Non-goals

- Numba speed-up of the push-apart loop (about 30 s to about 10 s, later).
- The Docker deployment itself; build A only adds a Dockerfile that builds.
- Fixing the legacy Mask view (`app.js:6776`).
- Face guess on the original photo (S6).
- Product-aware stone count (BACKLOG row 77, S10).
- Any change to the prototype's algorithms, constants or results.

## Corrections to the plan

| Plan says | Repo / measurement says |
| --- | --- |
| Prompt A file list: rs_fix, compact, post, eyes4, pupils2, landmarks, sdens, fuse, runfuse, distinct, darkdots, colsmooth | Also `detect.py`, `detect2.py`, `wshed.py`, `pathcfg.py` (run by `run_one.sh` / `runfuse.py`) |
| Prompt A env defaults: pitch, EYE_MODE, LASHES, CL_INSIDE, SKIN_NATURAL | 16 environment variables in all, two with traps: `TARGET_PITCH` defaults to 2.2 and `CATALOGUE` to the 23-colour `catalogue.json` (table above) |
| "No limit; 12–27 colours used per image" | 3–19 colours on the 12 test images |
| Service needs "about 1.5 GB" | The Linux venv is 2.8 GB |
| Lightbox controls all in `index.html` 1156–1284 | Position, stone and mixed fields live at 1513–1616 and are moved in by app.js 5868–5874 (S16) |
| Add SS4 to StoneSizes | Image-only, or monograms and text change (S12) |
| Add the 4 colours to every palette | Not the legacy quantizer palette, or old layers change (S13) |
| Finished width 133–177 mm | That is OpenAI's frame; the stones span 96.6–168.3 mm wide (S1) |
| Prompt C: "Run npm run test:full before finishing" | Removed: Sasha runs the suites in the merge sequence |
| Prompt v3 = "PROMPT_VERSION 3" | Collides with BACKLOG row 77 (S10) |
| `drawMask()` bug at app.js 6776 | `drawMask` is at 6772; the `prepareImageField` call without `maskMode` is at 6776 |

## Appendix A — Redraw prompt v3 (`PROMPT_VERSION = 3`)

This is prompt v2 from the research (Vitalina doc `claude/openai-prompt-v2.md`, 5 Oct 2026) with
two changes. The colour count is gone from rule 4 and from the final check (S11), and the palette
line is generated by `buildPaletteLine()`, so it carries all four D2 colours once build B adds
them. Build B makes `buildRedrawPrompt(colors, 'stones')` return `V3_HEAD`, then the palette line,
then `V3_TAIL`, joined with `\n`. `V3_HEAD` and `V3_TAIL` are exactly the text below, split at the
`<palette line>` marker.

```
Turn the uploaded image into a rhinestone design drawn as a flat technical placement chart. Software will measure every stone in your image (position, size and colour) and rebuild it as a real rhinestone layout, so clean geometry matters more than a realistic look.

1. STONES
- Every stone is a perfect circle seen straight from above, filled with ONE flat colour.
- No highlights, facets, sparkle, glints, gradients, rims, shadows, reflections or white dots on the stones.
- Use one main stone size for the whole design. Make the stones large: about 60 stones across the full width of the image.
- Only two exceptions:
  a) a smaller stone, 3/4 of the main diameter, only for very fine details (eyes, eyelids, nostrils, thin lines);
  b) one large stone, twice the main diameter, for each pupil.
- No other sizes: no tiny filler dots, no half stones, no ovals.

2. GAPS
- Every stone is separated from its neighbours by a small, clearly visible gap of about 1/8 of the stone diameter.
- Stones never touch and never overlap.
- Keep the gaps even and small. Pack the stones tightly, with neighbouring rows shifted so that stones sit in the notches of the next row. Avoid wide empty spaces inside the subject.
- The gaps show the background only. Never draw anything in the gaps: no dark shading, no glow, no colour, no dots, no texture.

3. BACKGROUND AND EDGES
- Background fully transparent. If transparency is not available, use solid pure magenta #FF00FF with no variation, and never use magenta inside the subject.
- Every stone is fully opaque with a crisp edge. No soft or semi-transparent edges.
- No frame, border, text, watermark, drop shadow or decoration.

4. COLOURS
Use only the colours below, with exactly these hex values, as flat fills:
<palette line>
- Every stone gets exactly one of these colours. Do not invent, mix, tint or shade colours.
- Pick the closest of these colours for each area, and keep neighbouring areas clearly distinguishable so the design reads well from a distance.

5. DESIGN
- Lay the stones in rows that follow the shapes: along feathers, hair strands, fur direction, wrinkles, petals and outlines.
- Outline important shapes with one row of stones in a darker colour of the same colour family (plain black only where the area itself is black or very dark).
- Eyes: a dark outline ring, the iris in 1 or 2 rings of stones, one large dark pupil stone, and one Crystal #f5f5f5 stone touching the pupil at its upper right as the catch-light.
- Keep the subject, pose, proportions and recognisable features of the uploaded image. Simplify only where stones cannot show the detail.

6. COMPOSITION
- Square image at the highest resolution available.
- The whole subject fits inside the image with a margin of about 3 stones on every side; nothing is cut off at the edges.
- One scale for the whole image, no perspective.

Before finishing, check that: every stone is a separate flat circle; no two stones touch; nothing is drawn in the gaps; only the three allowed sizes are used; only the listed colours are used; the background is transparent or pure magenta.
```

With the D2 colours added (build B), the generated palette line is exactly:

```
Crystal #f5f5f5, Crystal AB #e9f7ff, Jet #141414, Siam #9b1c1c, Light Siam #d9534f, Rose #ef8fb0, Fuchsia #c2185b, Amethyst #7e3f98, Sapphire #2269d3, Light Sapphire #6fa8dc, Aquamarine #3fc1b0, Emerald #2aa66a, Peridot #b5cc18, Topaz #e08e26, Citrine #f2c94c, Gold #f3bd32, Silver #d8dde4, Hematite #3e3f44, Black Diamond #6b6b72, Grey #9a9ca2, Smoked Topaz #6e4a2e, Light Colorado Topaz #b98a5c, Light Peach #eec6a4, Colorado Topaz #a0602c, Light Smoked Topaz #8a6a4a, Scarlet #d0101e, Hyacinth #e0581c
```

This requires the D2 colours to be appended to the end of `CRYSTAL_COLOR_LIST` in this order, after
`light-peach`. Selectors group by `group`, so appending does not change where they appear in the
pickers.

The research doc's line differs from this one in order and in one name ("Light Colorado").

## Appendix B — Redraw prompt v4 (`PROMPT_VERSION = 4`)

Prompt v4 is Appendix A with two blocks added (build E):
- the four colour rules at the end of section 4;
- the outline and texture rules in section 5.

The final check is extended to match. Build E makes `buildRedrawPrompt(colors, 'stones')` return
`V4_HEAD`, then the palette line, then `V4_TAIL`, joined with `\n`. `V4_HEAD` and `V4_TAIL` are
exactly the text below, split at the `<palette line>` marker. The palette line is the one Appendix
A shows. `V4_HEAD` equals `V3_HEAD`.

```
Turn the uploaded image into a rhinestone design drawn as a flat technical placement chart. Software will measure every stone in your image (position, size and colour) and rebuild it as a real rhinestone layout, so clean geometry matters more than a realistic look.

1. STONES
- Every stone is a perfect circle seen straight from above, filled with ONE flat colour.
- No highlights, facets, sparkle, glints, gradients, rims, shadows, reflections or white dots on the stones.
- Use one main stone size for the whole design. Make the stones large: about 60 stones across the full width of the image.
- Only two exceptions:
  a) a smaller stone, 3/4 of the main diameter, only for very fine details (eyes, eyelids, nostrils, thin lines);
  b) one large stone, twice the main diameter, for each pupil.
- No other sizes: no tiny filler dots, no half stones, no ovals.

2. GAPS
- Every stone is separated from its neighbours by a small, clearly visible gap of about 1/8 of the stone diameter.
- Stones never touch and never overlap.
- Keep the gaps even and small. Pack the stones tightly, with neighbouring rows shifted so that stones sit in the notches of the next row. Avoid wide empty spaces inside the subject.
- The gaps show the background only. Never draw anything in the gaps: no dark shading, no glow, no colour, no dots, no texture.

3. BACKGROUND AND EDGES
- Background fully transparent. If transparency is not available, use solid pure magenta #FF00FF with no variation, and never use magenta inside the subject.
- Every stone is fully opaque with a crisp edge. No soft or semi-transparent edges.
- No frame, border, text, watermark, drop shadow or decoration.

4. COLOURS
Use only the colours below, with exactly these hex values, as flat fills:
<palette line>
- Every stone gets exactly one of these colours. Do not invent, mix, tint or shade colours.
- Pick the closest of these colours for each area, and keep neighbouring areas clearly distinguishable so the design reads well from a distance.
- Use these ramps, from light to dark, and stay inside the ramp of each kind of area:
  skin: Light Peach, Light Colorado Topaz, Colorado Topaz, Smoked Topaz, with Crystal only for the brightest highlights;
  tan or brown fur, wood, earth: Light Peach, Light Colorado Topaz, Light Smoked Topaz, Colorado Topaz, Smoked Topaz;
  white, grey and black hair, fur, metal, stone: Crystal, Silver, Grey, Black Diamond, Hematite, Jet;
  greens: Peridot, Emerald; blues: Light Sapphire, Aquamarine, Sapphire; reds and pinks: Rose, Light Siam, Scarlet, Siam, Fuchsia; yellows and oranges: Citrine, Gold, Topaz, Hyacinth.
- Never use Topaz or Hyacinth on skin.
- Inside one area use at most three neighbouring shades of its ramp, in clear patches; never alternate shades stone by stone.
- When a colour of the image lies between two listed colours, choose one of them for the whole patch; do not paint an in-between shade.

5. DESIGN
- Lay the stones in rows that follow the shapes: along feathers, hair strands, fur direction, wrinkles, petals and outlines.
- Outline important shapes with one row of stones in a darker colour of the same colour family (plain black only where the area itself is black or very dark).
- Outline stones are ordinary stones: the main size or the 3/4 size, on the same rows as their neighbours, with the same gap. Never squeeze extra stones between rows and never let outline stones touch.
- Busy textures (rocks, grass, foliage, fur, water) are simplified into patches of one or two shades. Every stone there is still a separate flat circle with a gap; never draw broken, angular or overlapping stones.
- Eyes: a dark outline ring, the iris in 1 or 2 rings of stones, one large dark pupil stone, and one Crystal #f5f5f5 stone touching the pupil at its upper right as the catch-light.
- Keep the subject, pose, proportions and recognisable features of the uploaded image. Simplify only where stones cannot show the detail.

6. COMPOSITION
- Square image at the highest resolution available.
- The whole subject fits inside the image with a margin of about 3 stones on every side; nothing is cut off at the edges.
- One scale for the whole image, no perspective.

Before finishing, check that: every stone is a separate flat circle; no two stones touch, outline stones included; nothing is drawn in the gaps; only the three allowed sizes are used; only the listed colours are used, skin and fur only from their ramps; the background is transparent or pure magenta.
```
