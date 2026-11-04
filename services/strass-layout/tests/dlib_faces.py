"""IMG-026L (test only): the dlib face landmarks the service used before IMG-026L, for the
equivalence tests (against the prototype, which still uses dlib in prototype/landmarks.py, and
against the service's MediaPipe eye contours).

The dlib 68-point model was trained on iBUG 300-W, whose licence excludes commercial use: it must
never be shipped or used in production. The service uses MediaPipe (strass_layout/models.py) and
never imports this file. scripts/setup_mac.sh downloads the model only with --with-dlib-tests;
without dlib or the model, available() is False and the tests that need it are skipped.
"""
import os

import cv2
import numpy as np

from strass_layout import load_models

DLIB_FILE = "shape_predictor_68_face_landmarks.dat"


def model_path():
    return os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models", DLIB_FILE)


def available():
    try:
        import dlib  # noqa: F401
    except ImportError:
        return False
    return os.path.isfile(model_path())


class DlibModels:
    """The service's Models with the old dlib eye contours instead of MediaPipe's."""

    def __init__(self, base):
        import dlib
        self.base = base
        self.detector = dlib.get_frontal_face_detector()
        self.predictor = dlib.shape_predictor(model_path())

    def predict_instances(self, x):
        return self.base.predict_instances(x)

    def landmarks(self, img_rgb):
        """Models.landmarks before IMG-026L: 68 face landmarks of the largest face, or None."""
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

    def eye_contours(self, img_rgb):
        p = self.landmarks(img_rgb)
        return None if p is None else [p[36:42], p[42:48]]


_models = None


def dlib_models():
    global _models
    if _models is None:
        _models = DlibModels(load_models())
    return _models
