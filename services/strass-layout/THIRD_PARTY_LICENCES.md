# Third-party licences: strass layout service

What the service ships, its licence, and whether that licence allows commercial use. "Ships" means
what `scripts/setup_mac.sh` (without `--with-dlib-tests`) installs into `.venv` and what the
`Dockerfile` puts into the image. Written for IMG-026L (31 Oct 2026) from the installed package
metadata of a fresh `setup_mac.sh` environment (Python 3.12, Intel Mac, macOS 13.7) and of the Docker
image (`python:3.12-slim`, Linux x86_64). Update this file whenever a pin, a model or the base image
changes.

**Commercial use: allowed for everything shipped.** No shipped model or dependency has a
non-commercial licence. Notes on copyleft parts are under "Notes".

## Models

| Model | Where | Licence | Commercial use |
| --- | --- | --- | --- |
| MediaPipe Face Landmarker, `face_landmarker.task` (float16, version 1, 3.8 MB, SHA-256 `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`), from `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task` | `models/mediapipe/` (committed; in the image) | Apache 2.0 (Google's model card for the Face Landmarker, as recorded by PatternNifty IS-07a) | Yes |
| StarDist `2D_versatile_fluo` | `models/stardist/` (committed; in the image) | BSD-3-Clause (distributed with StarDist). Trained on a subset of the DSB 2018 nuclei data (BBBC038), published as CC0. | Yes |

### Never shipped: the dlib 68-point model

`shape_predictor_68_face_landmarks.dat` (from `face_recognition_models==0.3.0`, SHA-256
`fbdc2cb80eb9aa7a758672cbfdda32ba6300efe9b6e6c7a299ff7e736b11b92f`) was trained on iBUG 300-W, whose
licence excludes commercial use; dlib's author notes the trained model "can't be used in a
commercial product". **It is test-only and is never shipped or used in production.**

- The service does not import dlib or load the model (since IMG-026L).
- `scripts/setup_mac.sh` downloads it, and installs `dlib-bin` 19.24.6 (Boost Software License), only
  with `--with-dlib-tests`, for the equivalence tests (`tests/dlib_faces.py`, `tests/test_equivalence.py`,
  `tests/test_build_l.py`).
- The Dockerfile neither downloads nor copies it, and `.dockerignore` excludes it.
- `tests/test_build_l.py` fails if any Python file outside `tests/` and `prototype/` imports dlib, if
  loading the service imports it, or if the Dockerfile or the setup script (without the flag) fetches
  the model. `prototype/` is the research code kept for the equivalence test; only that test runs it,
  and it is not in the image.

## Python dependencies

Direct pins are in `requirements.txt` and `requirements-nodeps.txt`; the rest are installed with them.
Versions as installed on 31 Oct 2026.

| Package | Version | Licence | Commercial use |
| --- | --- | --- | --- |
| **Direct** | | | |
| attrs | 26.1.0 | MIT | Yes |
| csbdeep | 0.8.2 | BSD-3-Clause | Yes |
| fastapi | 0.142.2 | MIT | Yes |
| httpx | 0.28.1 | BSD-3-Clause | Yes |
| mediapipe | 0.10.15 | Apache 2.0 | Yes |
| numpy | 1.26.4 | BSD-3-Clause | Yes |
| opencv-python-headless | 4.11.0.86 | Apache 2.0 (OpenCV; bundled libraries: see Notes) | Yes |
| pillow | 12.3.0 | MIT-CMU (HPND) | Yes |
| python-multipart | 0.0.32 | Apache 2.0 | Yes |
| scikit-image | 0.26.0 | BSD-3-Clause | Yes |
| scikit-learn | 1.9.1 | BSD-3-Clause | Yes |
| scipy | 1.17.1 | BSD-3-Clause | Yes |
| stardist | 0.9.2 | BSD-3-Clause | Yes |
| tensorflow | 2.16.2 | Apache 2.0 | Yes |
| uvicorn | 0.54.0 | BSD-3-Clause | Yes |
| **Installed with them** | | | |
| absl-py, flatbuffers, google-pasta, grpcio, keras, libclang, ml-dtypes, namex, opentelemetry-api, optree, requests, tensorboard, tensorboard-data-server, tzdata | | Apache 2.0 | Yes |
| packaging | | Apache 2.0 or BSD-2-Clause | Yes |
| python-dateutil | | Apache 2.0 and BSD-3-Clause (dual) | Yes |
| astunparse, click, cloudpickle, contourpy, cycler, gast, h5py, httpcore, idna, joblib, kiwisolver, lazy-loader, llvmlite, markdown, markupsafe, networkx, numba, protobuf, starlette, threadpoolctl, tifffile, werkzeug | | BSD-3-Clause (llvmlite, numba: BSD-2-Clause) | Yes |
| imageio, pygments, wrapt | | BSD-2-Clause | Yes |
| annotated-doc, annotated-types, anyio, charset-normalizer, fonttools, h11, markdown-it-py, mdurl, narwhals, opt-einsum, pydantic, pydantic-core, pyparsing, rich, six, termcolor, typing-inspection, urllib3 | | MIT | Yes |
| matplotlib | 3.11.2 | Matplotlib licence (PSF-based, BSD-style) | Yes |
| typing-extensions | 4.16.0 | PSF-2.0 | Yes |
| certifi | 2026.10.23 | MPL-2.0 | Yes (unmodified) |
| tqdm | 4.70.1 | MPL-2.0 and MIT | Yes (unmodified) |
| pip, setuptools, wheel | | MIT | Yes |

MediaPipe is installed with `--no-deps`, so its declared jax, jaxlib, opencv-contrib-python and
sounddevice are **not** installed (see `requirements-nodeps.txt`).

## Base image (Docker only)

`python:3.12-slim`: CPython (PSF License) on Debian, plus `libglib2.0-0` (LGPL-2.1+) and `libgomp1`
(GPL-3.0 with the GCC Runtime Library Exception) from the Dockerfile. All allow commercial use.

## Notes

- **MPL-2.0 (certifi, tqdm):** file-level copyleft; using them unmodified carries no obligation beyond
  keeping their licence notices.
- **OpenCV's bundled FFmpeg (LGPL-2.1):** both wheels bundle FFmpeg as dynamic libraries
  (`cv2/.dylibs` on macOS, `opencv_python_headless.libs` on Linux). LGPL allows commercial use; keep
  the libraries unmodified and their licence file (`LICENSE-3RD-PARTY.txt` in the wheel's
  dist-info).
- **macOS wheel only: x264 and x265 (GPL-2.0-or-later).** The macOS `opencv-python-headless` wheel
  also bundles `libx264` and `libx265`, which its `libavcodec` links; the wheel's
  `LICENSE-3RD-PARTY.txt` does not list them. GPL allows commercial use; its obligations (offering
  the source) apply only when the software is distributed. The service runs on our own Mac and is
  reached over HTTP; it is not distributed, so nothing is owed. Do not hand out the Mac `.venv`. The
  Linux wheel in the Docker image has no x264 or x265 (checked on the built image).
  Found by IMG-026L; it predates IMG-026L and the service does not use video encoding.
