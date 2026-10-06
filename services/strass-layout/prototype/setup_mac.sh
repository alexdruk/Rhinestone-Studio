#!/bin/bash
set -e
cd "$(dirname "$0")"
PY=$(command -v python3.12 || command -v python3)
$PY -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt || { pip install cmake; pip install numpy scipy scikit-image scikit-learn opencv-python-headless pillow tensorflow csbdeep==0.8.2 stardist==0.9.2 dlib; }
if [ ! -f models/shape_predictor_68_face_landmarks.dat ]; then
  pip download --no-deps -d .dl face_recognition_models==0.3.0
  mkdir -p .dl/x
  tar -xzf .dl/face_recognition_models-0.3.0.tar.gz -C .dl/x
  cp .dl/x/face_recognition_models-0.3.0/face_recognition_models/models/shape_predictor_68_face_landmarks.dat models/
  rm -rf .dl
fi
python3 -c "import tensorflow, stardist, dlib, cv2, skimage, sklearn; print('environment OK')"
