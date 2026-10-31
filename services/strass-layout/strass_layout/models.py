"""The models holder: StarDist and the face landmarker.

Both are loaded once by load_models() and reused by every layout. The default
folder is services/strass-layout/models/, next to the package.

IMG-026L (ported from IS-07a): the face landmarks come from MediaPipe Face Landmarker (library and
model Apache 2.0) instead of dlib's 68-point predictor, whose iBUG 300-W training data excludes
commercial use. The service never imports dlib or loads its model; the equivalence test against the
prototype gives its Models dlib eye contours itself (tests/dlib_faces.py). eye_contours() keeps the
search landmarks() had (three blurs, the face with the largest box, wider than FACE_MIN_SHARE of the
image; the box being the mesh's bounding box, as dlib's was its detection box) and returns the six
points dlib numbers 36-41 and 42-47, from the MediaPipe mesh points in MP_EYES. dlib's 2x upsampling
has no MediaPipe equivalent and is dropped. Two additions keep MediaPipe's answers close to dlib's:
faces need MIN_CONFIDENCE (detection and presence) instead of MediaPipe's 0.5, which fitted a face
to the dog test image at the 6 px blur; and a mesh whose iris centres are closer than MIN_EYE_SHARE
of its width (a face seen from the side or a false find, which dlib's frontal detector does not
report) is not a face.
"""
import os
import threading

os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"

import cv2
import mediapipe as mp
import numpy as np
from csbdeep.utils import normalize
from mediapipe.tasks.python import BaseOptions
from mediapipe.tasks.python.vision import FaceLandmarker, FaceLandmarkerOptions
from stardist.models import StarDist2D

DEFAULT_MODELS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models")
STARDIST_NAME = "2D_versatile_fluo"
LANDMARKER_FILE = os.path.join("mediapipe", "face_landmarker.task")
FACE_MIN_SHARE = 0.12
MAX_FACES = 4
MIN_CONFIDENCE = 0.6
MIN_EYE_SHARE = 0.25
# Face Mesh points in dlib's order: the image-left eye's outer corner, two upper-lid points, inner
# corner, two lower-lid points (dlib 36-41), then the image-right eye's inner corner, two upper,
# outer corner, two lower (dlib 42-47).
MP_EYES = ((33, 160, 158, 133, 153, 144), (362, 385, 387, 263, 373, 380))
# The face's widest points, at the ears (MIN_EYE_SHARE's width); the iris centres.
MP_SIDES = (234, 454)
MP_IRISES = (468, 473)


def _span(p, pair):
    return float(np.hypot(*(p[pair[0]] - p[pair[1]])))


_cache = {}
_cache_lock = threading.Lock()


class Models:
    def __init__(self, models_dir):
        self.models_dir = os.path.abspath(models_dir)
        self.stardist = StarDist2D(None, name=STARDIST_NAME, basedir=os.path.join(self.models_dir, "stardist"))
        landmarker = os.path.join(self.models_dir, LANDMARKER_FILE)
        if not os.path.isfile(landmarker):
            raise FileNotFoundError(landmarker + " is missing (it is committed with the service).")
        self.landmarker = FaceLandmarker.create_from_options(
            FaceLandmarkerOptions(base_options=BaseOptions(model_asset_path=landmarker), num_faces=MAX_FACES,
                                  min_face_detection_confidence=MIN_CONFIDENCE, min_face_presence_confidence=MIN_CONFIDENCE))

    def predict_instances(self, x):
        """StarDist on one 2-D float image, tiled 4 x 4 as in the prototype."""
        return self.stardist.predict_instances(normalize(x, 1, 99.8), n_tiles=(4, 4))

    def eye_contours(self, img_rgb):
        """The largest face's two eye contours, image-left first, each six (x, y) points in dlib's
        order, or None when no face is found."""
        h, w = img_rgb.shape[:2]
        for prep in (
            lambda x: cv2.medianBlur(x, 5),
            lambda x: cv2.GaussianBlur(x, (0, 0), 3),
            lambda x: cv2.GaussianBlur(x, (0, 0), 6),
        ):
            w2 = np.ascontiguousarray(prep(img_rgb))
            found = self.landmarker.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=w2)).face_landmarks
            faces = [np.array([[q.x * w, q.y * h] for q in face]) for face in found]
            faces = [p for p in faces if _span(p, MP_IRISES) >= MIN_EYE_SHARE * _span(p, MP_SIDES)]
            faces.sort(key=lambda p: -np.ptp(p[:, 0]) * np.ptp(p[:, 1]))
            if faces and np.ptp(faces[0][:, 0]) > w * FACE_MIN_SHARE:
                return [faces[0][list(i)] for i in MP_EYES]
        return None


def load_models(models_dir=None):
    """Return the Models for models_dir, loading them on first use only."""
    key = os.path.abspath(models_dir or DEFAULT_MODELS_DIR)
    with _cache_lock:
        if key not in _cache:
            _cache[key] = Models(key)
        return _cache[key]
