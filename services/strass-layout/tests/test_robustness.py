"""Images unlike the 12 research images must not crash the pipeline.

sunburst_flower.png is a real gpt-image-2.5-sunburst answer to prompt v3 (6 Oct 2026).
Its stones are flat and its gaps transparent, so the watershed detector finds no
stone at all; before the fix that empty result crashed detect_stones() with an
IndexError and the service answered 500.
"""
import io
import os
import unittest

import numpy as np
from PIL import Image

from strass_layout import layout, load_models
from strass_layout.errors import NoStones
from strass_layout.detect import watershed_candidates
from strass_layout.imageio import decode_png

FIXTURES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")
FLOWER = os.path.join(FIXTURES, "sunburst_flower.png")
FLOWER_STONES = 1011
COUNT_TOLERANCE = 0.01
MIN_GAP_MM = 0.1 - 1e-6


def png_of(rgba):
    buf = io.BytesIO()
    Image.fromarray(rgba, "RGBA").save(buf, "PNG")
    return buf.getvalue()


class Robustness(unittest.TestCase):
    def test_flower_watershed_is_empty_but_two_dimensional(self):
        with open(FLOWER, "rb") as f:
            px = decode_png(f.read())
        for sig, h in [(1.2, 0.005), (1.6, 0.01)]:
            p = watershed_candidates(px, sig, h)
            self.assertEqual(p.shape, (0, 7))

    def test_flower_lays_out(self):
        with open(FLOWER, "rb") as f:
            result = layout(f.read(), None, 2.1, load_models())
        report = result["report"]
        print("FLOWER stones=%d violations=%d minGapMm=%s coverage=%s size=%sx%s" % (
            report["stones"], report["violations"], report["minGapMm"], report["coverage"],
            result["widthMm"], result["heightMm"]))
        self.assertEqual(report["violations"], 0)
        self.assertGreaterEqual(report["minGapMm"], MIN_GAP_MM)
        self.assertLessEqual(abs(report["stones"] - FLOWER_STONES) / FLOWER_STONES, COUNT_TOLERANCE)

    def test_empty_picture_is_no_stones_not_a_crash(self):
        rgba = np.zeros((512, 512, 4), np.uint8)
        rgba[200:312, 200:312] = (200, 40, 40, 255)
        with self.assertRaises(NoStones):
            layout(png_of(rgba), None, 2.1, load_models())


if __name__ == "__main__":
    unittest.main()
