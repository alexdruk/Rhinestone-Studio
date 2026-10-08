"""IMG-026E: the DEFAULT rules (pupil core, outline chains) against PROTOTYPE.

See docs/specifications/IMG-026-StrassLayoutService.md, "Layout quality (build E)" and the
Build E acceptance figures. The dark-line coverage and the dropped share are computed here.
"""
import io
import unittest

import numpy as np
from PIL import Image, ImageDraw
from scipy.spatial import cKDTree
from skimage.color import rgb2lab

from strass_layout import DEFAULT, PROTOTYPE, Rules
from strass_layout.chains import chain_mask
from strass_layout.eyes import find_pupils
from strass_layout.imageio import decode_png
from tests import support

IMAGES = support.IMAGES + ["sunburst_flower"]
DARK_STONES = {"jet", "hematite", "black-diamond", "smoked-topaz"}
MIN_GAP_MM = 0.1 - 1e-6


def dark_line_coverage(name, frame):
    """Share of the AI image's dark pixels (L < 30 on white, alpha > 0.5) under a dark output
    stone grown by 0.15 of the pitch."""
    px = decode_png(support.png_bytes(name))
    s = frame["frame"]["mmPerPx"]
    pitch_px = 2.1 / s
    mask = Image.new("L", (px.width, px.height), 0)
    draw = ImageDraw.Draw(mask)
    for q in frame["stones"]:
        if q["color"] in DARK_STONES:
            x, y, r = q["x"] / s, q["y"] / s, q["d"] / s / 2 + 0.15 * pitch_px
            draw.ellipse([x - r, y - r, x + r, y + r], fill=255)
    lightness = rgb2lab(px.onwhite / 255.0)[..., 0]
    dark = (lightness < 30) & (px.a > 0.5)
    if not dark.any():
        return 1.0
    return float((np.asarray(mask)[dark] > 0).mean())


def dropped_share(name, frame):
    """Share of the detections of at least 1.1 mm with no output stone within half a pitch."""
    det = support.detections(name)
    s = frame["frame"]["mmPerPx"]
    big = det[:, 2] * 2 * s >= 1.1
    stones = np.array([[q["x"] / s, q["y"] / s] for q in frame["stones"]])
    dist, _ = cKDTree(stones).query(det[big][:, [1, 0]])
    return float((dist > 0.5 * 2.1 / s).mean())


class DefaultAgainstPrototype(unittest.TestCase):
    def test_images(self):
        cov_proto, cov_default, drop_proto, drop_default = [], [], [], []
        for name in IMAGES:
            with self.subTest(image=name):
                proto = support.layout_result(name, PROTOTYPE)["report"]
                result = support.layout_result(name, DEFAULT)
                report = result["report"]
                self.assertEqual(report["violations"], 0)
                self.assertGreaterEqual(report["minGapMm"], MIN_GAP_MM)
                self.assertGreaterEqual(report["stones"], proto["stones"])
                self.assertLessEqual(report["stones"], proto["stones"] * 1.02)
                self.assertLessEqual(abs(report["coverage"] - proto["coverage"]), 0.01)
                self.assertEqual(len(report["pupilsMm"]), len(proto["pupilsMm"]))
                for ours, theirs in zip(report["pupilsMm"], proto["pupilsMm"]):
                    self.assertLessEqual(ours, theirs)
            frame_proto = support.frame_result(name, PROTOTYPE)
            frame_default = support.frame_result(name, DEFAULT)
            cov_proto.append(dark_line_coverage(name, frame_proto))
            cov_default.append(dark_line_coverage(name, frame_default))
            drop_proto.append(dropped_share(name, frame_proto))
            drop_default.append(dropped_share(name, frame_default))
            print("ROW %s stones %d->%d darkCov %.4f->%.4f dropped %.4f->%.4f" % (
                name, support.layout_result(name, PROTOTYPE)["report"]["stones"], support.layout_result(name, DEFAULT)["report"]["stones"],
                cov_proto[-1], cov_default[-1], drop_proto[-1], drop_default[-1]))
        print("MEAN darkCov %.4f->%.4f dropped %.4f->%.4f" % (np.mean(cov_proto), np.mean(cov_default), np.mean(drop_proto), np.mean(drop_default)))
        self.assertGreater(np.mean(cov_default), np.mean(cov_proto))
        self.assertLess(np.mean(drop_default), np.mean(drop_proto))


def detections_in_a_line(n, colour_l, diameter_px=12.0, spacing=1.1):
    det = np.array([[100.0, 50.0 + k * diameter_px * spacing, diameter_px / 2, 1.0] for k in range(n)])
    col = np.tile([colour_l, 0.0, 0.0], (n, 1))
    return det, col


class ChainMask(unittest.TestCase):
    S = 1.5 / 12.0

    def test_five_dark_stones_are_a_chain(self):
        det, col = detections_in_a_line(5, 10.0)
        self.assertTrue(chain_mask(det, col, self.S, DEFAULT).all())

    def test_two_dark_stones_are_not(self):
        det, col = detections_in_a_line(2, 10.0)
        self.assertFalse(chain_mask(det, col, self.S, DEFAULT).any())

    def test_light_stones_are_not(self):
        det, col = detections_in_a_line(5, 70.0)
        self.assertFalse(chain_mask(det, col, self.S, DEFAULT).any())

    def test_prototype_rules_give_an_empty_mask(self):
        det, col = detections_in_a_line(5, 10.0)
        self.assertFalse(chain_mask(det, col, self.S, PROTOTYPE).any())

    def test_far_apart_stones_are_not(self):
        det, col = detections_in_a_line(5, 10.0, spacing=2.0)
        self.assertFalse(chain_mask(det, col, self.S, Rules(pupil_core_only=True, keep_chains=True)).any())


def synthetic_eye():
    """A light disc on transparency with a dark brown iris (lightness about 35), a black pupil and a highlight."""
    size = 200
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    c = size // 2
    draw.ellipse([c - 80, c - 80, c + 80, c + 80], fill=(235, 235, 235, 255))
    draw.ellipse([c - 16, c - 16, c + 16, c + 16], fill=(92, 72, 52, 255))
    draw.ellipse([c - 8, c - 8, c + 8, c + 8], fill=(5, 5, 5, 255))
    draw.ellipse([c + 1, c - 6, c + 5, c - 2], fill=(255, 255, 255, 255))
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return decode_png(buf.getvalue())


class PupilCore(unittest.TestCase):
    def test_core_only_measures_the_black_disc(self):
        px = synthetic_eye()
        s = 0.1
        main_px = 6.0
        core = find_pupils(px, s, main_px, core_only=True)
        full = find_pupils(px, s, main_px, core_only=False)
        self.assertTrue(core and full, "the synthetic eye must give a pupil candidate in both modes")
        self.assertLess(abs(core[0]["diam_mm"] / s - 16), 4)
        self.assertGreater(full[0]["diam_mm"] / s, 26)


if __name__ == "__main__":
    unittest.main()
