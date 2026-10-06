# Strass layout service (IMG-026)

Turns an OpenAI rhinestone image (a PNG with a transparent background) into a finished,
gap-checked stone list: every stone with its position, size and colour. The spec is
`docs/specifications/IMG-026-StrassLayoutService.md`. This is build A: the package, the HTTP
service, the Mac scripts, the Dockerfile and the tests. The Node side comes in later builds.

Python lives only in this folder. Nothing in `src/`, `app.js` or `server/` imports it; the app
reaches it over HTTP.

## Layout

```
strass_layout/   the package: pipeline modules, catalogue.json, layout() and layout_frame()
app.py           FastAPI app: POST /layout and GET /health
models/          StarDist model (committed); the dlib model is downloaded by setup_mac.sh
scripts/         setup_mac.sh and start_layout.sh
tests/           unittest tests
prototype/       the research code as delivered, kept for the equivalence test; do not edit
Dockerfile       the same package and requirements.txt on python:3.12-slim
requirements.txt exact == pins of every direct dependency
```

## Setup (Mac)

```
brew install python@3.12
services/strass-layout/scripts/setup_mac.sh
```

The script needs `python3.12` on the PATH. It creates `.venv`, installs `requirements.txt`, and
downloads the dlib 68-landmark model from PyPI (`face_recognition_models==0.3.0`) into
`models/shape_predictor_68_face_landmarks.dat`, checking its SHA-256
(`fbdc2cb80eb9aa7a758672cbfdda32ba6300efe9b6e6c7a299ff7e736b11b92f`). A model file that already
has that hash is not downloaded again. If `dlib-bin` has no wheel for the Mac, the script installs
`cmake` and builds `dlib` from source.

The environment is about 3 GB on disk. A layout needs about 3 GB of RAM.

## Start

```
services/strass-layout/scripts/start_layout.sh
```

This runs `uvicorn app:app --host 127.0.0.1 --port 8000 --workers 1`. The service is bound to
127.0.0.1 only and has no authentication. Models load at startup, so `GET /health` answers ok
within about a minute.

A layout takes one to two minutes and the Mac must not sleep during it. Start the service under
`caffeinate`:

```
caffeinate -i services/strass-layout/scripts/start_layout.sh
```

The script prints this advice; it does not run `caffeinate` itself.

## Endpoints

`POST /layout` takes multipart form data: `image` (a PNG, at most 20 MB) and `options` (JSON,
`{"colorIds": [...], "targetPitchMm": 2.1}`). `colorIds` are the colour ids the app knows. It
answers 200 with the layout:

```
{ "version": 1, "widthMm": 103.0, "heightMm": 130.8,
  "stones": [[x, y, "ss6", "jet"], ...],
  "report": { "stones", "bySize", "colours", "minGapMm", "violations", "coverage",
              "largestEmptyCircleMm", "face", "pupilsMm", "frameMm", "offsetMm", "mmPerPx",
              "stagesMs": { "detect", "layout", "eyes", "colour", "check" }, "ms" } }
```

Stone coordinates are centres in mm from the top-left corner of the stones' bounding box (S1).
Size ids are `ss4 ss6 ss10 ss16 ss20 ss30` (1.5, 2.0, 2.8, 4.0, 4.7, 6.4 mm).

Errors are `{ "error": code, "message": text }`:

| Status | Code | When |
| --- | --- | --- |
| 400 | `bad-image` | the upload is not a decodable PNG |
| 400 | `no-alpha` | fewer than 1 % of the pixels have alpha at or below 0.5 |
| 400 | `bad-request` | the `image` field is missing or `options` is not valid |
| 413 | `too-large` | the image is larger than 20 MB |
| 422 | `catalogue-mismatch` | the service's catalogue has a colour id that `colorIds` lacks |
| 422 | `no-stones` | fewer than 50 stones were detected |
| 500 | `layout-failed` | any other failure; the message is the exception text |

`GET /health` answers `{ "ok": true, "modelsLoaded": true, "version": "...", "busy": false }`.
`busy` is true while a layout runs. One layout runs at a time; a second request waits.

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
separation; `check` is the last overlap removal plus the crop, report and gap check.

## Tests

From `services/strass-layout`, with the virtual environment active:

```
python -m unittest -v
```

- `test_equivalence` runs `prototype/run_one.sh` in a temporary copy of `prototype/` and compares
  its stone list, order included, with `layout_frame()` for each of the 12 images. Set
  `STRASS_SKIP_EQUIVALENCE=1` to skip it.
- `test_golden` checks, per image, 0 violations, a minimum gap of at least 0.100 mm, a stone count
  within 1 % of `prototype/expected/` and coverage within 3 % of it.
- `test_contract` checks the response shape and every error code through the HTTP app.
- `test_report` recomputes the report from the returned stones.

The full run lays out each of the 12 images once for the package and once for the prototype, about
one to two minutes each. Run long jobs under `caffeinate -i`.

## Docker

`docker build -t strass-layout services/strass-layout` builds the same package on
`python:3.12-slim`, fetches and hash-checks the dlib model at build time, and serves on
0.0.0.0:8000 inside the container. Only `LAYOUT_SERVICE_URL` changes in the app.
