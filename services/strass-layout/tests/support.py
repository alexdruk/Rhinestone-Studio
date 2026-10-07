"""Shared helpers for the layout service tests.

Images and reference results are read from prototype/img and prototype/expected.
Pipeline runs are memoised per image and rules, so a full test run lays out each image once per
rules set. The equivalence, golden and report tests use PROTOTYPE; build E's tests use DEFAULT.
"""
import copy
import json
import os

from strass_layout import PROTOTYPE, layout_frame, load_models
from strass_layout.detect import detect_stones
from strass_layout.imageio import decode_png
from strass_layout.pipeline import finish_layout

SERVICE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROTOTYPE_DIR = os.path.join(SERVICE_DIR, "prototype")
IMG_DIR = os.path.join(PROTOTYPE_DIR, "img")
EXPECTED_DIR = os.path.join(PROTOTYPE_DIR, "expected")
MODELS_DIR = os.path.join(SERVICE_DIR, "models")
IMAGES = ["cat", "dog", "einstein", "jesus", "lake", "leopard", "logo", "parrot", "portrait", "rose", "tulips", "woman"]

_frames = {}
_detections = {}


FIXTURES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")
FIXTURE_IMAGES = {"sunburst_flower": os.path.join(FIXTURES_DIR, "sunburst_flower.png")}


def png_bytes(name):
    path = FIXTURE_IMAGES.get(name) or os.path.join(IMG_DIR, "N2_%s.png" % name)
    with open(path, "rb") as f:
        return f.read()


def expected(name):
    with open(os.path.join(EXPECTED_DIR, "N2_%s_final_rs.json" % name)) as f:
        return json.load(f)


def frame_result(name, rules=PROTOTYPE):
    """layout_frame() on the image with the given rules, run once per process."""
    key = (name, rules)
    if key not in _frames:
        _frames[key] = layout_frame(png_bytes(name), 2.1, load_models(), rules)
    return _frames[key]


def layout_result(name, rules=PROTOTYPE):
    """The layout() answer for the image, built from the memoised frame result."""
    return finish_layout(copy.deepcopy(frame_result(name, rules)))


def detections(name):
    """detect_stones() on the image, run once per process."""
    if name not in _detections:
        _detections[name] = detect_stones(decode_png(png_bytes(name)), load_models())
    return _detections[name]
