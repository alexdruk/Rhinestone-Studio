"""Shared helpers for the layout service tests.

Images and reference results are read from prototype/img and prototype/expected.
Pipeline runs are memoised per image, so a full test run lays out each image once.
"""
import copy
import json
import os

from strass_layout import layout_frame, load_models
from strass_layout.pipeline import finish_layout

SERVICE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROTOTYPE_DIR = os.path.join(SERVICE_DIR, "prototype")
IMG_DIR = os.path.join(PROTOTYPE_DIR, "img")
EXPECTED_DIR = os.path.join(PROTOTYPE_DIR, "expected")
MODELS_DIR = os.path.join(SERVICE_DIR, "models")
IMAGES = ["cat", "dog", "einstein", "jesus", "lake", "leopard", "logo", "parrot", "portrait", "rose", "tulips", "woman"]

_frames = {}


def png_bytes(name):
    with open(os.path.join(IMG_DIR, "N2_%s.png" % name), "rb") as f:
        return f.read()


def expected(name):
    with open(os.path.join(EXPECTED_DIR, "N2_%s_final_rs.json" % name)) as f:
        return json.load(f)


def frame_result(name):
    """layout_frame() on the image, run once per process."""
    if name not in _frames:
        _frames[name] = layout_frame(png_bytes(name), 2.1, load_models())
    return _frames[name]


def layout_result(name):
    """The layout() answer for the image, built from the memoised frame result."""
    return finish_layout(copy.deepcopy(frame_result(name)))
