"""IMG-026G: the DEFAULT rules (inscribed pupils, re-measured stone colours) against BUILD_F.

See docs/specifications/IMG-026-StrassLayoutService.md, "Pupils and stone colours (build G)" and
the Build G acceptance figures.
"""
import io
import unittest

import numpy as np
from PIL import Image, ImageDraw

from strass_layout import BUILD_E, BUILD_F, DEFAULT, PROTOTYPE
from strass_layout.colour import BASE, BASE_REAL, CAT, CAT_IDS, FULL, FULL_REAL, palette, snap_colours
from strass_layout.eyes import find_pupils
from strass_layout.imageio import decode_png
from strass_layout.post import _has_partner
from tests import support

IMAGES = support.IMAGES + ["sunburst_flower"]
REMEASURED = ["siam", "light-siam", "rose", "fuchsia", "amethyst", "sapphire", "light-sapphire", "aquamarine",
              "emerald", "peridot", "topaz", "black-diamond", "smoked-topaz", "light-colorado", "light-peach",
              "light-smoked-topaz", "scarlet"]
MIN_GAP_MM = 0.1 - 1e-6


def hex_lab(h):
    from skimage.color import rgb2lab
    return rgb2lab(np.array([[[int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]]]))[0, 0]


class Palettes(unittest.TestCase):
    def test_remeasured_entries_keep_the_old_fill(self):
        self.assertEqual([k for k in CAT_IDS if "prototypeFill" in CAT[k]], REMEASURED)
        for k in REMEASURED:
            self.assertNotEqual(CAT[k]["fill"], CAT[k]["prototypeFill"])
        for pal, real in ((BASE, False), (FULL, False), (BASE_REAL, True), (FULL_REAL, True)):
            for k, fill in zip(pal.ids, pal.fills):
                self.assertEqual(fill, CAT[k]["fill"] if real else CAT[k].get("prototypeFill", CAT[k]["fill"]))
        self.assertEqual(BASE_REAL.ids, BASE.ids)
        self.assertEqual(FULL_REAL.ids, FULL.ids)

    def test_rules_pick_the_palette(self):
        self.assertIs(palette(PROTOTYPE), BASE)
        self.assertIs(palette(BUILD_E), BASE)
        self.assertIs(palette(BUILD_F), FULL)
        self.assertIs(palette(DEFAULT), FULL_REAL)

    def test_each_remeasured_fill_snaps_to_itself(self):
        lab = np.array([hex_lab(CAT[k]["fill"]) for k in REMEASURED])
        ids, _ = snap_colours(lab, FULL_REAL)
        self.assertGreaterEqual(sum(a == b for a, b in zip(ids, REMEASURED)), 15)


def synthetic_lashed_eye():
    """A black pupil (radius 16 px) with a white highlight inside it, fused with a black lash band
    across its top, on a light face disc on transparency."""
    size = 200
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    c = size // 2
    draw.ellipse([c - 90, c - 90, c + 90, c + 90], fill=(230, 190, 160, 255))
    draw.rectangle([c - 60, c - 22, c + 60, c - 12], fill=(8, 8, 8, 255))
    draw.ellipse([c - 16, c - 16, c + 16, c + 16], fill=(8, 8, 8, 255))
    draw.ellipse([c - 2, c - 10, c + 8, c], fill=(255, 255, 255, 255))
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return decode_png(buf.getvalue()), c


class InscribedPupil(unittest.TestCase):
    def test_a_pupil_fused_with_lashes_is_found(self):
        px, c = synthetic_lashed_eye()
        main_px = 12.0
        plain = find_pupils(px, 1.0, main_px, core_only=True)
        self.assertEqual(plain, [], "the fused pupil must defeat the round-blob detector")
        found = find_pupils(px, 1.0, main_px, core_only=True, inscribed=True)
        self.assertEqual(len(found), 1)
        p = found[0]
        self.assertTrue(p["inscribed"])
        self.assertLess(np.hypot(p["x"] - c, p["y"] - c), 4)
        self.assertGreaterEqual(p["diam_mm"], 24)
        self.assertLessEqual(p["diam_mm"], 2.4 * main_px + 1e-9)
        self.assertLess(np.hypot(p["hx"] - (c + 3), p["hy"] - (c - 5)), 4)

    def test_an_animal_pupil_needs_a_partner(self):
        a = dict(x=100.0, y=100.0, diam_mm=4.0, inscribed=True)
        b = dict(x=200.0, y=110.0, diam_mm=4.4)
        self.assertTrue(_has_partner(a, [a, b]))
        self.assertFalse(_has_partner(a, [a]))
        self.assertFalse(_has_partner(a, [a, dict(x=130.0, y=160.0, diam_mm=4.0)]))
        self.assertFalse(_has_partner(a, [a, dict(x=200.0, y=100.0, diam_mm=7.0)]))


class DefaultAgainstBuildF(unittest.TestCase):
    def test_images(self):
        for name in IMAGES:
            with self.subTest(image=name):
                f = support.layout_result(name, BUILD_F)["report"]
                g = support.layout_result(name, DEFAULT)["report"]
                self.assertEqual(g["violations"], 0)
                self.assertGreaterEqual(g["minGapMm"], MIN_GAP_MM)
                self.assertLessEqual(abs(g["stones"] - f["stones"]), 0.01 * f["stones"])
                self.assertLessEqual(abs(g["coverage"] - f["coverage"]), 0.01)
                self.assertEqual(g["pupilsMm"], f["pupilsMm"])
                self.assertEqual(g["face"], f["face"])
                self.assertTrue(set(g["colours"]) <= set(CAT_IDS))
                print("ROW %s stones %d->%d colours %d->%d" % (name, f["stones"], g["stones"], len(f["colours"]), len(g["colours"])))


if __name__ == "__main__":
    unittest.main()
