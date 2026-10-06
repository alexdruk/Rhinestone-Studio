#!/bin/bash
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DLIB_SHA256="fbdc2cb80eb9aa7a758672cbfdda32ba6300efe9b6e6c7a299ff7e736b11b92f"
DLIB_FILE="models/shape_predictor_68_face_landmarks.dat"

if ! command -v python3.12 >/dev/null 2>&1; then
  echo "python3.12 was not found. Install it with: brew install python@3.12" >&2
  exit 1
fi

python3.12 -m venv .venv
. .venv/bin/activate
python -m pip install --upgrade pip

if [ -f requirements.txt ]; then
  pip install -r requirements.txt
else
  pip install -r prototype/requirements.txt fastapi uvicorn python-multipart httpx
fi

if ! python -c "import dlib" >/dev/null 2>&1; then
  echo "dlib-bin has no wheel for this Mac; installing cmake and building dlib from source." >&2
  pip install cmake
  pip install dlib
fi

sha_of() {
  shasum -a 256 "$1" | cut -d' ' -f1
}

if [ -f "$DLIB_FILE" ] && [ "$(sha_of "$DLIB_FILE")" = "$DLIB_SHA256" ]; then
  echo "dlib model already present with the expected SHA-256; skipping download."
else
  rm -rf .dl
  mkdir -p .dl/x models
  pip download --no-deps -d .dl face_recognition_models==0.3.0
  tar -xzf .dl/face_recognition_models-0.3.0.tar.gz -C .dl/x
  cp .dl/x/face_recognition_models-0.3.0/face_recognition_models/models/shape_predictor_68_face_landmarks.dat "$DLIB_FILE"
  rm -rf .dl
  if [ "$(sha_of "$DLIB_FILE")" != "$DLIB_SHA256" ]; then
    echo "SHA-256 mismatch for $DLIB_FILE" >&2
    rm -f "$DLIB_FILE"
    exit 1
  fi
  echo "dlib model downloaded and verified."
fi

python -c "import tensorflow, stardist, dlib, cv2, skimage, sklearn, fastapi, uvicorn, multipart; print('environment OK')"
