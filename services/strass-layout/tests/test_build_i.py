"""IMG-026I: the DEFAULT rules (eyes, Indian Siam off skin, soft outlines, calm skin) against BUILD_H.

See docs/specifications/IMG-026-StrassLayoutService.md, "Faces and eyes (build I)" and the
Build I acceptance figures.
"""
import unittest

import cv2
import numpy as np
from skimage.color import rgb2lab

from strass_layout import BUILD_H, DEFAULT
from strass_layout.colour import CAT_IDS, PLUS_REAL, PLUS_REAL_SKIN, palette, snap_colours
from strass_layout.eyes import UP_RIGHT, glint_angles
from strass_layout.faces import calm_skin, soften_outlines
from strass_layout.post import _best_disc
from tests import support

IMAGES = support.IMAGES + ["sunburst_flower"]
PUPIL_CHANGES = {"portrait"}
MIN_GAP_MM = 0.1 - 1e-6


def hex_lab(h):
    return rgb2lab(np.array([[[int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]]]))[0, 0]


class Palettes(unittest.TestCase):
    def test_rules_pick_the_palette(self):
        self.assertIs(palette(BUILD_H), PLUS_REAL)
        self.assertIs(palette(DEFAULT), PLUS_REAL_SKIN)
        self.assertEqual(PLUS_REAL_SKIN.ids, PLUS_REAL.ids)
        self.assertEqual(PLUS_REAL_SKIN.fills, PLUS_REAL.fills)

    def test_warm_brown_skin_never_takes_indian_siam(self):
        brown = np.array([hex_lab("#5c2a22")])
        self.assertEqual(snap_colours(brown, PLUS_REAL)[0], ["indian-siam"])
        self.assertNotEqual(snap_colours(brown, PLUS_REAL_SKIN)[0], ["indian-siam"])
        wine = np.array([hex_lab("#610b16")])
        self.assertEqual(snap_colours(wine, PLUS_REAL_SKIN)[0], ["indian-siam"])


def eye_image(highlight, extra_white=None, size=120):
    """A light face with a black pupil of radius 20 px at the centre, a white highlight disc of
    radius 5 px at offset highlight, and optionally a white patch (the white of the eye)."""
    rgb = np.full((size, size, 3), (225, 180, 150), np.uint8)
    c = size // 2
    cv2.circle(rgb, (c, c), 20, (8, 8, 8), -1)
    if highlight is not None:
        cv2.circle(rgb, (c + highlight[0], c + highlight[1]), 5, (255, 255, 255), -1)
    if extra_white is not None:
        cv2.circle(rgb, (c + extra_white[0], c + extra_white[1]), 12, (250, 250, 250), -1)
    return cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB), np.ones((size, size)), c


class GlintDirection(unittest.TestCase):
    def angle(self, highlight, extra_white=None, human=False):
        lab, a, c = eye_image(highlight, extra_white)
        cand = dict(x=float(c), y=float(c), r_px=20.0)
        glint_angles([cand], lab, a, human)
        return cand["ang"]

    def test_points_at_the_highlight_inside_the_pupil(self):
        ang = self.angle((-8, -8))
        self.assertAlmostEqual(ang, -3 * np.pi / 4, delta=0.15)

    def test_the_white_of_the_eye_outside_the_pupil_is_ignored(self):
        self.assertAlmostEqual(self.angle((-8, -8), extra_white=(0, 30)), self.angle((-8, -8)), delta=0.05)

    def test_a_low_highlight_takes_up_and_right(self):
        self.assertAlmostEqual(self.angle((0, 10)), UP_RIGHT)
        self.assertAlmostEqual(self.angle(None), UP_RIGHT)

    def test_a_level_highlight_is_raised_to_30_degrees(self):
        self.assertAlmostEqual(self.angle((11, 0)), -np.pi / 6, delta=1e-9)

    def test_a_persons_two_pupils_share_one_direction(self):
        lab, a, c = eye_image((8, -8))
        cands = [dict(x=float(c), y=float(c), r_px=20.0), dict(x=float(c), y=float(c) + 200, r_px=20.0)]
        glint_angles(cands, lab, a, True)
        self.assertEqual(cands[0]["ang"], cands[1]["ang"])
        self.assertAlmostEqual(cands[0]["ang"], -np.pi / 4, delta=0.15)


class FallbackDisc(unittest.TestCase):
    def test_a_lit_disc_wins_over_a_larger_dark_one_in_the_same_region(self):
        dark = np.zeros((100, 200), bool)
        cv2.circle(dark.view(np.uint8), (40, 50), 30, 1, -1)
        cv2.circle(dark.view(np.uint8), (140, 50), 14, 1, -1)
        dark[45:55, 40:140] = True
        dt = cv2.distanceTransform(dark.astype(np.uint8), cv2.DIST_L2, 5)
        hl = np.zeros_like(dark)
        hl[44:47, 144:147] = True
        yy, xx = _best_disc(dt, hl, 40, 50, 8.0)
        self.assertLess(np.hypot(xx - 140, yy - 50), 3)
        yy, xx = _best_disc(dt, np.zeros_like(dark), 150, 50, 8.0)
        self.assertLess(np.hypot(xx - 140, yy - 50), 3)


def grid(colours):
    """Stones of 2 mm hex-packed at a 2.3 mm pitch from rows of colour ids (None is no stone)."""
    P, D, C = [], [], []
    for r, row in enumerate(colours):
        for k, c in enumerate(row):
            if c is not None:
                P.append((k * 2.3 + 1.15 * (r % 2), r * 2.3 * np.sqrt(3) / 2))
                D.append(2.0)
                C.append(c)
    return np.array(P), np.array(D), C


class FaceFinish(unittest.TestCase):
    def test_a_black_outline_on_skin_turns_smoked_topaz(self):
        sk, j = "light-peach", "jet"
        P, D, C = grid([[sk, sk, sk, sk, sk], [j, j, j, j, j], [None] * 5])
        out, n = soften_outlines(P, D, C, [])
        self.assertEqual(n, 5)
        self.assertEqual(out[5:10], ["smoked-topaz"] * 5)
        self.assertEqual(out[:5], C[:5])

    def test_near_an_eye_and_inside_black_areas_jet_stays(self):
        sk, j = "light-peach", "jet"
        P, D, C = grid([[sk, sk, sk, sk, sk], [j, j, j, j, j], [None] * 5])
        out, n = soften_outlines(P, D, C, [(4.6, 2.3, 3.0)])
        self.assertEqual(n, 0)
        P, D, C = grid([[sk, sk, sk], [j, j, j], [j, j, j], [j, j, j]])
        out, n = soften_outlines(P, D, C, [])
        self.assertEqual(out[6:], [j] * 6)

    def test_a_lone_skin_shade_takes_its_neighbours_shade(self):
        a, b = "light-colorado", "golden-shadow"
        P, D, C = grid([[a, a, a], [a, b, a], [a, a, a]])
        out, n = calm_skin(P, D, C, PLUS_REAL_SKIN, [])
        self.assertEqual((n, out[4]), (1, a))
        far = "smoked-topaz"
        P, D, C = grid([[a, a, a], [a, far, a], [a, a, a]])
        out, n = calm_skin(P, D, C, PLUS_REAL_SKIN, [])
        self.assertEqual(n, 0)


class DefaultAgainstBuildH(unittest.TestCase):
    def test_images(self):
        for name in IMAGES:
            with self.subTest(image=name):
                h = support.layout_result(name, BUILD_H)["report"]
                i = support.layout_result(name, DEFAULT)["report"]
                self.assertEqual(i["violations"], 0)
                self.assertGreaterEqual(i["minGapMm"], MIN_GAP_MM)
                self.assertLessEqual(abs(i["stones"] - h["stones"]), 0.01 * h["stones"])
                self.assertLessEqual(abs(i["coverage"] - h["coverage"]), 0.01)
                self.assertEqual(i["face"], h["face"])
                if name not in PUPIL_CHANGES:
                    self.assertEqual(i["pupilsMm"], h["pupilsMm"])
                self.assertTrue(set(i["colours"]) <= set(CAT_IDS))
                print("ROW %s face %s stones %d->%d pupils %s->%s" % (name, i["face"], h["stones"], i["stones"], h["pupilsMm"], i["pupilsMm"]))

    def test_the_portrait_pupil_is_in_the_eye(self):
        h = support.layout_result("portrait", BUILD_H)["report"]["pupilsMm"]
        i = support.layout_result("portrait", DEFAULT)["report"]["pupilsMm"]
        self.assertEqual(len(i), 2)
        self.assertEqual(i[0], i[1])
        self.assertLess(i[0], h[0])


if __name__ == "__main__":
    unittest.main()
