"""IMG-026L: the service finds faces with MediaPipe and never imports dlib or loads its model (the dlib
68-point model's iBUG 300-W training data excludes commercial use). Ported from IS-07a."""
import hashlib
import os
import re
import subprocess
import sys
import tempfile
import unittest

import numpy as np

from strass_layout import DEFAULT
from strass_layout.imageio import decode_png
from strass_layout.models import LANDMARKER_FILE, MP_EYES, load_models
from tests import dlib_faces, support

_REPO = os.path.dirname(os.path.dirname(support.SERVICE_DIR))
# The whole repository when the service sits in it (services/strass-layout next to app.js), else the
# service folder alone (a copy of it elsewhere).
REPO_DIR = _REPO if os.path.isfile(os.path.join(_REPO, "app.js")) else support.SERVICE_DIR
# The only places dlib may be imported: the service's tests, and the research prototype, which only
# the equivalence test runs (in a temporary copy) and which .dockerignore keeps out of the image.
ALLOWED = [os.path.join(support.SERVICE_DIR, "tests"), os.path.join(support.SERVICE_DIR, "prototype")]
SKIP_DIRS = {".git", ".venv", "venv", "node_modules", "__pycache__", ".dl"}
DLIB_IMPORT = re.compile(r"^\s*(import|from)\s+dlib\b|__import__\(\s*['\"]dlib['\"]|import_module\(\s*['\"]dlib['\"]", re.M)
MEDIAPIPE_SHA256 = "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff"
# Faces that the two models are known to see differently on the test images (docs/results/IMG-026L).
FACE_DIFFERS = {"lake": "dlib finds a face in the clouds, MediaPipe none; neither places pupils"}
# The eye boxes' centres differ between the models by up to 0.20 of the eye's width (10-18.5 px,
# 1.3-2.5 mm, on einstein, portrait and woman); the pupils found in them are the same.
MAX_BOX_SHIFT_SHARE = 0.3


def _python_files(root):
    """The .py files of the repository: in a git checkout, those git tracks plus new ones it does not
    ignore (so a git-ignored local scratch copy does not count); otherwise every file under root."""
    try:
        out = subprocess.run(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "*.py"],
                             cwd=root, capture_output=True, text=True, timeout=60)
        top = subprocess.run(["git", "rev-parse", "--show-toplevel"], cwd=root, capture_output=True, text=True, timeout=60)
    except OSError:
        out = None
    if out is not None and out.returncode == 0 and os.path.realpath(top.stdout.strip()) == os.path.realpath(root):
        return [os.path.join(root, f) for f in out.stdout.split("\0") if f and os.path.isfile(os.path.join(root, f))]
    files = []
    for d, dirs, names in os.walk(root):
        dirs[:] = [x for x in dirs if x not in SKIP_DIRS]
        files += [os.path.join(d, f) for f in names if f.endswith(".py")]
    return files


def dlib_offenders(root, allowed=ALLOWED):
    """Python files under root, outside the allowed folders, that import dlib or name its model."""
    found = []
    for path in _python_files(root):
        if any(os.path.commonpath([path, a]) == a for a in allowed) or SKIP_DIRS & set(path.split(os.sep)):
            continue
        with open(path, encoding="utf-8", errors="replace") as fh:
            text = fh.read()
        if DLIB_IMPORT.search(text) or "shape_predictor_68" in text:
            found.append(os.path.relpath(path, root))
    return sorted(found)


class NoDlibOutsideTheTests(unittest.TestCase):
    def test_no_python_file_outside_the_tests_imports_dlib(self):
        self.assertEqual(dlib_offenders(REPO_DIR), [])

    def test_the_scan_catches_a_new_untracked_file(self):
        if not os.path.isdir(os.path.join(REPO_DIR, ".git")):
            self.skipTest("not a git checkout")
        path = os.path.join(support.SERVICE_DIR, "strass_layout", "_img026l_probe.py")
        with open(path, "w") as f:
            f.write("import dlib\n")
        try:
            self.assertIn(os.path.relpath(path, REPO_DIR), dlib_offenders(REPO_DIR))
        finally:
            os.remove(path)

    def test_the_scan_catches_an_import(self):
        for line in ("import dlib", "from dlib import shape_predictor", "  import dlib as d", "m = __import__('dlib')",
                     "importlib.import_module(\"dlib\")", "p = 'shape_predictor_68_face_landmarks.dat'"):
            with self.subTest(line=line), tempfile.TemporaryDirectory() as root:
                os.makedirs(os.path.join(root, "strass_layout"))
                with open(os.path.join(root, "strass_layout", "x.py"), "w") as f:
                    f.write("import os\n" + line + "\n")
                with open(os.path.join(root, "strass_layout", "ok.py"), "w") as f:
                    f.write("import dlibs\n# dlib is test only\n")
                self.assertEqual(dlib_offenders(root, []), [os.path.join("strass_layout", "x.py")])
                self.assertEqual(dlib_offenders(root, [os.path.join(root, "strass_layout")]), [])

    def test_loading_the_service_does_not_import_dlib(self):
        code = ("import sys; sys.modules['dlib'] = None; import app; from strass_layout import load_models; "
                "load_models(); print('loaded')")
        out = subprocess.run([sys.executable, "-c", code], cwd=support.SERVICE_DIR, capture_output=True, text=True, timeout=600)
        self.assertEqual(out.returncode, 0, out.stderr[-2000:])
        self.assertEqual(out.stdout.strip().splitlines()[-1], "loaded")

    def test_requirements_have_no_dlib(self):
        for name in ("requirements.txt", "requirements-nodeps.txt"):
            with open(os.path.join(support.SERVICE_DIR, name)) as f:
                pins = [line for line in f if line.strip() and not line.startswith("#")]
            self.assertFalse(any("dlib" in p for p in pins), name)


class NoDlibModelShipped(unittest.TestCase):
    def read(self, *path):
        with open(os.path.join(support.SERVICE_DIR, *path)) as f:
            return f.read()

    def test_the_dockerfile_never_fetches_or_copies_the_dlib_model(self):
        steps = [line for line in self.read("Dockerfile").splitlines() if not line.lstrip().startswith("#")]
        text = "\n".join(steps)
        for word in ("dlib", "shape_predictor", "face_recognition_models", ".dat"):
            self.assertNotIn(word, text)
        self.assertIn("COPY models/mediapipe/ models/mediapipe/", text)
        self.assertNotIn("COPY models/ ", text)
        self.assertIn("models/shape_predictor_68_face_landmarks.dat", self.read(".dockerignore").splitlines())
        self.assertIn("prototype/", self.read(".dockerignore").splitlines())

    def test_setup_fetches_dlib_only_with_the_test_flag(self):
        lines = self.read("scripts", "setup_mac.sh").splitlines()
        start = lines.index('if [ "$WITH_DLIB_TESTS" = 1 ]; then')
        end = next(i for i in range(start + 1, len(lines)) if lines[i] == "fi")
        outside = [line for i, line in enumerate(lines) if not start <= i <= end and not line.lstrip().startswith("#")
                   and not line.startswith(("DLIB_SHA256=", "DLIB_FILE="))]
        for word in ("dlib", "shape_predictor", "face_recognition_models", "DLIB_FILE"):
            self.assertFalse([line for line in outside if word in line and "--with-dlib-tests" not in line], word)
        self.assertIn("pip install --no-deps -r requirements-nodeps.txt", lines)


class LandmarkerModel(unittest.TestCase):
    def test_the_committed_model_has_the_expected_sha(self):
        with open(os.path.join(support.MODELS_DIR, LANDMARKER_FILE), "rb") as f:
            self.assertEqual(hashlib.sha256(f.read()).hexdigest(), MEDIAPIPE_SHA256)

    def test_setup_checks_the_same_sha(self):
        with open(os.path.join(support.SERVICE_DIR, "scripts", "setup_mac.sh")) as f:
            self.assertIn('MEDIAPIPE_SHA256="%s"' % MEDIAPIPE_SHA256, f.read())


class EyeContours(unittest.TestCase):
    def contours(self, name):
        return load_models().eye_contours(decode_png(support.png_bytes(name)).onwhite)

    def test_a_person_has_two_eyes_in_dlib_order(self):
        eyes = self.contours("woman")
        self.assertIsNotNone(eyes)
        self.assertEqual([e.shape for e in eyes], [(6, 2), (6, 2)])
        left, right = eyes
        # Image-left eye first; points 0 and 3 are its corners (dlib 36 and 39, 42 and 45).
        self.assertLess(left[:, 0].mean(), right[:, 0].mean())
        self.assertEqual(int(np.argmin(left[:, 0])), 0)
        self.assertEqual(int(np.argmax(right[:, 0])), 3)
        self.assertEqual(len(MP_EYES), 2)

    def test_an_animal_has_no_face(self):
        self.assertIsNone(self.contours("cat"))


def _boxes(models, name):
    from strass_layout.post import _eye_boxes
    return _eye_boxes(decode_png(support.png_bytes(name)), models)


class FaceEquivalence(unittest.TestCase):
    """The MediaPipe face finding against the old dlib one on every test image (dlib test only)."""

    def setUp(self):
        if not dlib_faces.available():
            self.skipTest("dlib or its model is absent (test only: scripts/setup_mac.sh --with-dlib-tests)")

    def test_faces_and_eye_boxes(self):
        for name in support.IMAGES:
            with self.subTest(image=name):
                old, new = _boxes(dlib_faces.dlib_models(), name), _boxes(load_models(), name)
                if name in FACE_DIFFERS:
                    self.assertIsNotNone(old)
                    self.assertIsNone(new)
                    continue
                self.assertEqual(old is None, new is None)
                if old is not None:
                    shift = [float(np.hypot(a[0] - b[0], a[1] - b[1])) / a[2] for a, b in zip(old, new)]
                    print("EYEBOX %s shift / eye width %s" % (name, ", ".join("%.2f" % v for v in shift)))
                    self.assertLessEqual(max(shift), MAX_BOX_SHIFT_SHARE)

    def test_faces_and_pupils_of_the_layout(self):
        for name in support.IMAGES:
            with self.subTest(image=name):
                old = support.layout_result(name, DEFAULT, dlib=True)["report"]
                new = support.layout_result(name, DEFAULT)["report"]
                if name in FACE_DIFFERS:
                    self.assertEqual((old["face"], new["face"]), ("human", "animal"))
                else:
                    self.assertEqual(old["face"], new["face"])
                self.assertEqual(old["pupilsMm"], new["pupilsMm"])
                a = support.pupil_centres(name, DEFAULT, dlib=True)
                b = support.pupil_centres(name, DEFAULT)
                self.assertEqual(len(a), len(b))
                apart = [float(np.hypot(p[0] - q[0], p[1] - q[1])) for p, q in zip(a, b)]
                print("PUPILS %s apart mm %s" % (name, ", ".join("%.3f" % v for v in apart) or "-"))
                self.assertTrue(all(v < 0.01 for v in apart), apart)
                self.assertEqual(new["violations"], 0)


if __name__ == "__main__":
    unittest.main()
