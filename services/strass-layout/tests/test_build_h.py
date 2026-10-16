"""IMG-026H: the DEFAULT rules (eight more catalogue colours) against BUILD_G.

See docs/specifications/IMG-026-StrassLayoutService.md, "More catalogue colours (build H)" and the
Build H acceptance figures.
"""
import unittest

import numpy as np

from strass_layout import BUILD_G, DEFAULT, distinct
from strass_layout.colour import ALL_EXTRA_IDS, CAT, CAT_IDS, EXTRA_H_IDS, FULL_REAL, PLUS_REAL, palette, snap_colours
from tests import support

IMAGES = support.IMAGES + ["sunburst_flower"]
H = ["silk", "light-topaz", "rose-peach", "indian-siam", "greige", "graphite", "citrus-green", "capri-blue"]
MIN_GAP_MM = 0.1 - 1e-6


class Palettes(unittest.TestCase):
    def test_the_eight_colours(self):
        self.assertEqual(EXTRA_H_IDS, H)
        self.assertEqual(CAT_IDS[-8:], H)
        for k in H:
            self.assertTrue(CAT[k]["aiOnly"])
            self.assertEqual(CAT[k]["aiSet"], "H")
        self.assertEqual(PLUS_REAL.ids, CAT_IDS)
        self.assertEqual(FULL_REAL.ids, CAT_IDS[:-8])
        self.assertIs(palette(BUILD_G), FULL_REAL)
        self.assertIs(palette(DEFAULT), PLUS_REAL)
        self.assertTrue(set(H) <= set(ALL_EXTRA_IDS))
        self.assertIs(distinct.ALL_EXTRA_IDS, ALL_EXTRA_IDS)

    def test_each_new_fill_snaps_to_itself(self):
        from skimage.color import rgb2lab
        lab = np.array([rgb2lab(np.array([[[int(CAT[k]["fill"][i:i + 2], 16) / 255 for i in (1, 3, 5)]]]))[0, 0] for k in H])
        ids, _ = snap_colours(lab, PLUS_REAL)
        self.assertGreaterEqual(sum(a == b for a, b in zip(ids, H)), 8)
        old, _ = snap_colours(lab, FULL_REAL)
        self.assertFalse(set(old) & set(H))


class DefaultAgainstBuildG(unittest.TestCase):
    def test_images(self):
        uses = 0
        for name in IMAGES:
            with self.subTest(image=name):
                g = support.layout_result(name, BUILD_G)["report"]
                h = support.layout_result(name, DEFAULT)["report"]
                self.assertEqual(h["violations"], 0)
                self.assertGreaterEqual(h["minGapMm"], MIN_GAP_MM)
                self.assertLessEqual(abs(h["stones"] - g["stones"]), 0.01 * g["stones"])
                self.assertLessEqual(abs(h["coverage"] - g["coverage"]), 0.01)
                self.assertEqual(h["pupilsMm"], g["pupilsMm"])
                self.assertEqual(h["face"], g["face"])
                self.assertTrue(set(h["colours"]) <= set(CAT_IDS))
                self.assertFalse(set(g["colours"]) & set(H))
            uses += bool(set(h["colours"]) & set(H))
            print("ROW %s stones %d->%d new %s" % (name, g["stones"], h["stones"], sorted(set(h["colours"]) & set(H))))
        self.assertGreaterEqual(uses, 8)


if __name__ == "__main__":
    unittest.main()
