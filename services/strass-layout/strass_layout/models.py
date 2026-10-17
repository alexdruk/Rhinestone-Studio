"""The models holder: StarDist and the dlib face detector and landmark predictor.

Both are loaded once by load_models() and reused by every layout. The default
folder is services/strass-layout/models/, next to the package.
"""
import os
import threading

os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"

import cv2
import dlib
import numpy as np
from csbdeep.utils import normalize
from stardist.models import StarDist2D

DEFAULT_MODELS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models")
STARDIST_NAME = "2D_versatile_fluo"
LANDMARKS_FILE = "shape_predictor_68_face_landmarks.dat"

_cache = {}
_cache_lock = threading.Lock()


class Models:
    def __init__(self, models_dir):
        self.models_dir = os.path.abspath(models_dir)
        self.stardist = StarDist2D(None, name=STARDIST_NAME, basedir=os.path.join(self.models_dir, "stardist"))
        predictor = os.path.join(self.models_dir, LANDMARKS_FILE)
        if not os.path.isfile(predictor):
            raise FileNotFoundError(
                predictor + " is missing. Run scripts/setup_mac.sh, which downloads and verifies it."
            )
        self.detector = dlib.get_frontal_face_detector()
        self.predictor = dlib.shape_predictor(predictor)

    def predict_instances(self, x):
        """StarDist on one 2-D float image, tiled 4 x 4 as in the prototype."""
        return self.stardist.predict_instances(normalize(x, 1, 99.8), n_tiles=(4, 4))

    def landmarks(self, img_rgb):
        """68 face landmarks of the largest face, or None when no face is found."""
        for prep in (
            lambda x: cv2.medianBlur(x, 5),
            lambda x: cv2.GaussianBlur(x, (0, 0), 3),
            lambda x: cv2.GaussianBlur(x, (0, 0), 6),
        ):
            w2 = prep(img_rgb)
            for up in (1, 2):
                faces = sorted(self.detector(w2, up), key=lambda f: -f.area())
                if faces and faces[0].width() > img_rgb.shape[1] * 0.12:
                    sh = self.predictor(w2, faces[0])
                    return np.array([[sh.part(i).x, sh.part(i).y] for i in range(68)])
        return None


def load_models(models_dir=None):
    """Return the Models for models_dir, loading them on first use only."""
    key = os.path.abspath(models_dir or DEFAULT_MODELS_DIR)
    with _cache_lock:
        if key not in _cache:
            _cache[key] = Models(key)
        return _cache[key]
