# Strass layout service (IMG-026)

Turns an OpenAI rhinestone image (a PNG with a transparent background) into a finished,
gap-checked stone list: every stone with its position, size and colour. The spec is
`docs/specifications/IMG-026-StrassLayoutService.md`. This is build A: the package, the HTTP
service, the Mac scripts, the Dockerfile and the tests. The Node side comes in later builds.

Python lives only in this folder. Nothing in `src/`, `app.js` or `server/` imports it; the app
reaches it over HTTP.

**IMG-026L: no dlib in production.** The service finds faces with MediaPipe Face Landmarker
(library and model Apache 2.0, `models/mediapipe/face_landmarker.task`, committed), not dlib. The
dlib 68-point model (`shape_predictor_68_face_landmarks.dat`) was trained on iBUG 300-W, whose
licence excludes commercial use: **it must never be shipped or used in production.** It is a
test-only dependency of the equivalence tests, installed only by `setup_mac.sh --with-dlib-tests`;
without it those tests are skipped. Licences: `THIRD_PARTY_LICENCES.md`.

## Layout

```
strass_layout/   the package: pipeline modules, catalogue.json, layout() and layout_frame()
app.py           FastAPI app: POST /layout and GET /health
models/          StarDist and MediaPipe face landmarker models (committed)
scripts/         setup_mac.sh and start_layout.sh
tests/           unittest tests
prototype/       the research code as delivered, kept for the equivalence test; do not edit
Dockerfile       the same package and requirements.txt on python:3.12-slim
requirements.txt exact == pins of every direct dependency
requirements-nodeps.txt      MediaPipe, installed with pip --no-deps (IMG-026L)
requirements-dlib-tests.txt  dlib, test only (IMG-026L)
THIRD_PARTY_LICENCES.md      every model and dependency the service ships, and its licence
```

## Setup (Mac)

```
brew install python@3.12
services/strass-layout/scripts/setup_mac.sh
```

The script needs `python3.12` on the PATH. It creates `.venv`, installs `requirements.txt`, then
`requirements-nodeps.txt` (MediaPipe 0.10.15) with `--no-deps`, and checks the committed
MediaPipe model's SHA-256 (`64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`).
MediaPipe's declared dependencies jax and jaxlib need ml-dtypes >= 0.4, which tensorflow 2.16.2
refuses; the Face Landmarker does not use them, and everything it does import is already
installed. 0.10.15 is the last MediaPipe whose Intel Mac binaries run on macOS 13.

Only with `--with-dlib-tests` (test machines, never production) does it install `dlib-bin` and
download the dlib 68-landmark model from PyPI (`face_recognition_models==0.3.0`) into
`models/shape_predictor_68_face_landmarks.dat`, checking its SHA-256
(`fbdc2cb80eb9aa7a758672cbfdda32ba6300efe9b6e6c7a299ff7e736b11b92f`). A model file that already
has that hash is not downloaded again. If `dlib-bin` has no wheel for the Mac, the script installs
`cmake` and builds `dlib` from source.

The environment is about 3 GB on disk. A layout needs about 3 GB of RAM.

## Start

From the repository root, start the service and the app together:

```
npm run studio
```

`tools/studio.mjs` (RS-3043) runs `scripts/start_layout.sh` under `caffeinate -i`, waits until
`GET /health` answers ok (at most three minutes), checks that the answer is this service (its
`service` and `version`), then starts the dev server with `LAYOUT_SERVICE_URL` pointing at it,
whatever `.env` says. If this service is already running on the port, it is reused and left
running when the studio stops; if another service answers there, the studio stops and names the
port. Ctrl+C stops both; if either stops on its own, the studio stops the other and says why.

The manual way:

```
caffeinate -i services/strass-layout/scripts/start_layout.sh
```

This runs `uvicorn app:app --host 127.0.0.1 --port 8001 --workers 1`. The port is the setting
`LAYOUT_PORT` (environment only, default 8001). It is not 8000: on the iMac, PatternNifty's own
strass service uses 8000. The service is bound to 127.0.0.1 only and has no authentication.
Models load at startup, so `GET /health` answers ok within about a minute.

A layout takes one to two minutes and the Mac must not sleep during it, hence `caffeinate -i`.
The script prints this advice; it does not run `caffeinate` itself (`npm run studio` does).

## Endpoints

`POST /layout` takes multipart form data: `image` (a PNG, at most 20 MB) and `options` (JSON,
`{"colorIds": [...], "targetPitchMm": 2.1, "mode": "colour"}`). `colorIds` are the colour ids the app
knows. `mode` (IMG-026P) is `"colour"` (the default, also for a request without it) or `"bw"`
(Black & white). It answers 200 with the layout:

```
{ "version": 1, "widthMm": 103.0, "heightMm": 130.8,
  "stones": [[x, y, "ss6", "jet"], ...],
  "report": { "stones", "bySize", "colours", "minGapMm", "violations", "coverage",
              "largestEmptyCircleMm", "capped", "removed", "removedShare", "filled", "cleanupCoverage",
              "face", "pupilsMm", "pupilsAtMm", "frameMm", "offsetMm", "mmPerPx",
              "stagesMs": { "detect", "layout", "eyes", "colour", "cleanup", "check" }, "ms" } }
```

Stone coordinates are centres in mm from the top-left corner of the stones' bounding box (S1).
Size ids are `ss4 ss6 ss10 ss16 ss20 ss30` (1.5, 2.0, 2.8, 4.0, 4.7, 6.4 mm).

`face` is `"human"` (a person's face was found), `"animal"` (no person's face; the logo and flowers
say this too) or, since IMG-026M, `null`: the design's pupils are not one plausible pair, so no eye
stones were placed. `pupilsMm` holds the pupil diameters; `pupilsAtMm` (IMG-026M) holds each pupil
stone's centre `[x, y]`, in stone coordinates and the same order.

Since IMG-026O the service runs PatternNifty's clean-up after its own layout: every stone above
SS16 becomes SS16 (the pupils of one plausible pair SS20), of every pair closer than 0.1 mm one
stone is removed, and every spot of the subject where an SS6 or SS4 stone fits is filled, in its
neighbours' colour. `capped`, `removed` (and `removedShare`, removed over the stones before the
cleanup) and `filled` count what these steps did; `cleanupCoverage` is the coverage after them as
PatternNifty measures it (`coverage` of the stones before the steps times the area under the stones
after them over the area under the stones before them). `violations`, `minGapMm`, `coverage` and
`largestEmptyCircleMm` are measured on the returned stones, so after every step. Nothing re-runs a
layout automatically.

Since RS-3044, on a person's face (`face` is `"human"`), a stone the AI painted in its pale cream
lit-skin colour becomes skin. The AI paints lit skin in one cream (about L\* 93–96) that is not in
the palette, and the colour step split it into Silk, Crystal, Metallic Sunshine and Citrine. An SS4
or SS6 stone outside 1.5 eye-zone radii is changed when two things hold. Its colour, read from the
inner 60 % of its radius, is pale warm cream: L\* above 85, chroma 8 to 40, hue 25 to 100 degrees.
And it has at least four neighbours, at least half of them in skin colours. It then takes the skin
colour nearest its read colour (ΔE2000). This repeats until nothing changes, at most 5 rounds, so
pairs and triples change too. Positions and sizes never change. Teeth the AI paints in its Crystal,
eye whites and catch-lights stay. The rule is `Rules.pale_skin` (`faces.pale_skin`).

With `"mode": "bw"` (IMG-026P, PatternNifty's Black & white) every stone is then Jet or Crystal
(`jet`, `crystal-clear`), read from the AI image itself: the mean CIE L\* of its pixels composited on
white within the inner 60 % of the stone's radius (at least 2 px), at its delivered position. Below
the threshold it is Jet, otherwise Crystal. The filled stones are not read; they take Jet or Crystal
from their neighbours by the same vote. Positions and sizes are those of `"colour"` exactly. In this
mode `colorIds` needs only `jet` and `crystal-clear`. The threshold is the setting `BW_THRESHOLD`
(environment, a number between 0 and 100; default 55); a bad value stops the service at start.

Errors are `{ "error": code, "message": text }`:

| Status | Code | When |
| --- | --- | --- |
| 400 | `bad-image` | the upload is not a decodable PNG |
| 400 | `no-alpha` | fewer than 1 % of the pixels have alpha at or below 0.5 |
| 400 | `bad-request` | the `image` field is missing or `options` is not valid (a `mode` other than `colour` or `bw` included) |
| 413 | `too-large` | the image is larger than 20 MB |
| 422 | `catalogue-mismatch` | the service's catalogue has a colour id that `colorIds` lacks (in `bw` mode: `jet` or `crystal-clear` is missing) |
| 422 | `no-stones` | fewer than 50 stones were detected |
| 500 | `layout-failed` | any other failure; the message is the exception text |

`GET /health` answers
`{ "ok": true, "service": "rhinestone-studio-layout", "modelsLoaded": true, "version": "...", "busy": false }`.
`service` (RS-3043) names this service, so `npm run studio` can tell it from another one on the same
port; `version` is `strass_layout.__version__`. `busy` is true while a layout runs. One layout runs at a time; a second request waits.

## Connecting the app

The Node dev server (`tools/dev-server.mjs`) calls this service from inside each redraw job,
after OpenAI has drawn the image. Two settings, read from the environment or the repo's `.env`
(see `.env.example`), connect it:

- `LAYOUT_SERVICE_URL`: the service's base URL, for example `http://127.0.0.1:8001` when both run
  on the same Mac (`npm run studio` sets it). The job posts to `<LAYOUT_SERVICE_URL>/layout`. When it is empty, or nothing
  answers at that address, the job ends with `layout-unavailable` and still returns the OpenAI
  image; the app then says the redraw was placed with the old method, and that the fix is to start
  the layout service or start Rhinestone Studio with `npm run studio`. The redraw routes stay on either way.
- `LAYOUT_TIMEOUT_SECONDS`: how long one layout may take before the job gives up with
  `layout-timeout` (default 180). A layout is not retried. On a slower Mac, raise it.

The Node server sends one layout at a time, in job order, and passes the app's colour ids as
`colorIds`. If this service's `catalogue.json` holds a colour the app does not know, every layout
answers 422 `catalogue-mismatch` and the job ends with `layout-failed`.

`npm run studio` does all of this. By hand: start this service before the dev server, and check
`GET /health` once:

```
curl http://127.0.0.1:8001/health
LAYOUT_SERVICE_URL=http://127.0.0.1:8001 npm run dev
```

With `REDRAW_FAKE=1` the dev server calls neither OpenAI nor this service, and every job returns a
fixed test layout.

## Calling the package

```
from strass_layout import layout, layout_frame
result = layout(open("cat.png", "rb").read(), color_ids=None, target_pitch_mm=2.1)
```

`layout_frame()` returns the pipeline's final stones in OpenAI-frame coordinates, in the
prototype's format and order, before the crop. `layout()` adds the S1 crop, the S2 report, the
S3 gap check and the S4 id check.

Stage times in `stagesMs`: `detect` is decoding, StarDist, radial symmetry, Laplacian blobs,
watershed and fusion; `layout` is the ordered layout; `eyes` is pupils, face landmarks and the eye
stones; `colour` is hole filling, colour assignment, dark-dot and family clean-up and tone
separation; `cleanup` (IMG-026O) is the size cap, the overlap cleanup and the hole fill; `check` is
the last overlap removal plus the crop, report and gap check.

## Tests

From `services/strass-layout`, with the virtual environment active:

```
python -m unittest -v
```

- `test_equivalence` runs `prototype/run_one.sh` in a temporary copy of `prototype/` and compares
  its stone list, order included, with `layout_frame()` for each of the 12 images. Set
  `STRASS_SKIP_EQUIVALENCE=1` to skip it. IMG-026L: the prototype finds faces with dlib, so the
  package runs here with the test-only dlib landmarks (`tests/dlib_faces.py`); the test is skipped
  when dlib or its model is absent.
- `test_build_l` (IMG-026L) fails if any Python file in the repository (tracked, or new and not
  git-ignored) outside this folder's `tests/` and `prototype/` imports dlib, if loading the service imports it, or if the Dockerfile or `setup_mac.sh` (without
  `--with-dlib-tests`) fetches its model; it checks the MediaPipe model's SHA-256. Its
  `FaceEquivalence` tests compare MediaPipe's faces, eye boxes and pupils with dlib's (skipped
  without dlib).
- `test_golden` checks, per image, 0 violations, a minimum gap of at least 0.100 mm, a stone count
  within 1 % of `prototype/expected/` and coverage within 3 % of it.
- `test_contract` checks the response shape and every error code through the HTTP app.
- `test_report` recomputes the report from the returned stones.
- `test_build_f` to `test_build_j` compare each build's frozen rules (`BUILD_F` … `BUILD_O` in
  `strass_layout/rules.py`) with the build before; `test_build_m` (IMG-026M) checks the rules
  ported from PatternNifty, each by switching it off in `BUILD_M`, and the two edge crashes;
  `test_build_o` (IMG-026O) checks the size cap, the overlap cleanup, the hole fill and its colour
  vote on small fixtures (ported from PatternNifty's tests) and `BUILD_O` against `BUILD_M` on the
  13 test images; `test_build_p` (IMG-026P) checks the Black & white reading (threshold, inner 60 %,
  composited on white, 2 px minimum, filled stones by vote) on small fixtures, `mode` and
  `BW_THRESHOLD` through the HTTP app, and the woman in `bw` against `colour`.
- `test_rs_3044_pale_skin` (RS-3044) checks the pale skin rule on small fixtures (a pair, a triple,
  a cluster over rounds, the 5-round limit, the stones it must leave, teeth), on
  `fixtures/pale_skin_portrait.png` (the AI image of the white-stones diagnosis) and `DEFAULT`
  against `BUILD_O` on the 13 test images. `test_build_o` compares `BUILD_O`, build O's frozen
  `DEFAULT`, with `BUILD_M`.

The full run lays out each of the 12 images once for the package and once for the prototype, about
one to two minutes each. Run long jobs under `caffeinate -i`.

## Docker

`docker build -t strass-layout services/strass-layout` builds the same package on
`python:3.12-slim` with the committed StarDist and MediaPipe models (never the dlib model), and serves on
0.0.0.0:8000 inside the container; publish it on another host port where 8000 is taken (for
example `-p 127.0.0.1:8001:8000`). Only `LAYOUT_SERVICE_URL` changes in the app.
