"""IMG-026M: eyes, colour reading and skin rules, ported from PatternNifty (IS) at e9e7014.

See docs/specifications/IMG-026-StrassLayoutService.md, "Eyes, colour reading and skin rules
(build M)", and docs/IS-PORT-PLAN.md section 3.2. Each class names the IS test it was ported from
(IS tests/test_is05b.py, test_is05c.py, test_is05d.py, test_pn04h.py, test_exp_holes.py). IS
compared DEFAULT with BUILD_I; here every rule is checked by switching it off in DEFAULT.
"""
import dataclasses
import unittest

import numpy as np

from strass_layout import BUILD_E, BUILD_F, BUILD_G, BUILD_H, BUILD_I, BUILD_J, DEFAULT, PROTOTYPE
from strass_layout.colour import PLUS_REAL_SKIN, stone_colours
from strass_layout.distinct import SKIN
from strass_layout.eyes import find_pupils
from strass_layout.faces import COLORADO, SMOKED, WHITE, lone_white_skin, skin_nearest
from strass_layout.imageio import Pixels
from strass_layout.ordered import CATCH_LAB, _delivered_colours, delivered_lab
from strass_layout.post import _plausible_pupils
from tests import support
from tests.test_build_f import iris_stones

BUILDS = (PROTOTYPE, BUILD_E, BUILD_F, BUILD_G, BUILD_H, BUILD_I, BUILD_J)
PAL = PLUS_REAL_SKIN
SAME_KEYS = ("face", "pupilsMm", "pupilsAtMm", "bySize", "violations", "coverage")


def off(**change):
    return dataclasses.replace(DEFAULT, **change)


def hex_grid(rows, cols, pitch=2.1):
    return np.array([[c * pitch + (r % 2) * pitch / 2, r * pitch * 0.87] for r in range(rows) for c in range(cols)])


def colour_diff(a, b):
    """Stones of b against a: positions and sizes must be equal; the (from, to) colour changes."""
    return [(x[3], y[3]) for x, y in zip(a["stones"], b["stones"]) if x[3] != y[3]]


class Defaults(unittest.TestCase):
    def test_only_default_has_the_build_m_rules(self):
        for rules in BUILDS:
            for flag in ("plausible_eyes", "sample_delivered", "skin_nearest_inner", "warm_shadow", "lone_white_skin"):
                self.assertFalse(getattr(rules, flag), flag)
        for flag in ("plausible_eyes", "sample_delivered", "skin_nearest_inner", "warm_shadow", "lone_white_skin"):
            self.assertTrue(getattr(DEFAULT, flag), flag)
        self.assertEqual(DEFAULT.warm_shadow_de, 3.0)

    def test_default_has_no_human_iris_and_no_soft_outlines(self):
        self.assertFalse(DEFAULT.human_iris)
        self.assertFalse(DEFAULT.soft_outlines)
        self.assertTrue(BUILD_J.human_iris)
        self.assertTrue(BUILD_J.soft_outlines)

    def test_build_j_is_build_l_default(self):
        self.assertEqual(off(human_iris=True, soft_outlines=True, plausible_eyes=False, sample_delivered=False,
                             skin_nearest_inner=False, warm_shadow=False, warm_shadow_de=1.5, lone_white_skin=False), BUILD_J)


class DarkDiscAtTheEdge(unittest.TestCase):
    """S11, an RS bug (IS tests/test_exp_holes.py): a dark region cut by the image's border, with a
    highlight, has its distance peak near the edge, and _find_inscribed's window around it reached
    past the last row (IndexError)."""

    def test_find_pupils_with_a_dark_disc_cut_by_the_bottom_edge(self):
        h, w = 60, 80
        rgba = np.zeros((h, w, 4), np.uint8)
        rgba[..., 3] = 255
        rgba[..., :3] = 200  # light grey
        yy, xx = np.mgrid[0:h, 0:w]
        rgba[np.hypot(yy - (h - 1), xx - 40) <= 22, :3] = 10  # a dark disc centred on the last row
        rgba[np.hypot(yy - (h - 9), xx - 42) <= 2.5, :3] = 250  # its highlight
        cands = find_pupils(Pixels(rgba), 0.15, 12.0, core_only=True, inscribed=True)
        self.assertIsInstance(cands, list)


class StoneBeyondTheEdge(unittest.TestCase):
    """S10 (IS tests/test_exp_holes.py): a delivered stone past the image's last row, as the fill and
    legalise place it when the subject touches the border, has no pixel within its sampling radius
    (colour.py: IndexError on an empty quantile). Reachable only with sample_delivered."""

    def test_delivered_colour_of_a_stone_past_the_last_row(self):
        h, w, s = 20, 30, 0.2
        rgb = np.zeros((h, w, 3), np.float32)
        rgb[..., 0] = 1.0  # red
        a = np.ones((h, w), np.float32)
        # An SS4 stone 2.1 px below the last row's centre: its mean disc (2.25 px) holds fewer than
        # 3 pixels and its core (R = 2 px) none, so the median rule had nothing to take a quantile of.
        P = np.array([[10 * s, (h - 1 + 2.1) * s]])
        lab = delivered_lab(rgb, a, s, P, np.array([1.5]), True)
        self.assertAlmostEqual(lab[0][0], 53.2, delta=0.5)  # L* of pure red
        self.assertGreater(lab[0][1], 70)
        # The median rule too, with the whole disc far outside the image.
        out = stone_colours(rgb, a, np.array([[h + 50.0, -40.0, 1.0, 0.0]]))
        self.assertAlmostEqual(out[0][0], 53.2, delta=0.5)


class PlausiblePupils(unittest.TestCase):
    """S1 (IS tests/test_is05b.py)."""
    # Subject mask 400 px wide: a pair may be at most 180 px apart.
    MASK = np.zeros((300, 500), bool)
    MASK[50:250, 50:450] = True

    @staticmethod
    def pupil(x, y, d=1.0):
        return {"x": float(x), "y": float(y), "diam_mm": d}

    def kept(self, cands):
        return _plausible_pupils(cands, self.MASK)

    def plausible(self, cands):
        return self.kept(cands) is not None

    def test_none_or_one_pupil_is_plausible(self):
        self.assertEqual(self.kept([]), [])
        one = [self.pupil(100, 100)]
        self.assertEqual(self.kept(one), one)

    def test_a_level_pair_of_equal_pupils_is_plausible(self):
        pair = [self.pupil(150, 100), self.pupil(250, 110)]
        self.assertEqual(self.kept(pair), pair)

    def test_very_different_sizes(self):
        p = self.pupil
        self.assertTrue(self.plausible([p(150, 100, 1.0), p(250, 100, 1.55)]))
        self.assertFalse(self.plausible([p(150, 100, 1.0), p(250, 100, 1.6)]))

    def test_far_from_horizontal(self):
        p = self.pupil
        self.assertTrue(self.plausible([p(150, 100), p(250, 150)]))
        self.assertFalse(self.plausible([p(150, 100), p(250, 151)]))
        self.assertFalse(self.plausible([p(150, 100), p(150, 160)]))

    def test_too_far_apart_for_the_subject(self):
        p = self.pupil
        self.assertTrue(self.plausible([p(100, 100), p(280, 100)]))
        self.assertFalse(self.plausible([p(100, 100), p(281, 100)]))

    def test_of_more_than_two_the_one_plausible_pair_is_kept(self):
        # IS's giraffe: a large false pupil on an ossicone above, one on the neck below, and the two
        # eyes (sizes 1.18 apart, level).
        p = self.pupil
        ossicone, neck = p(201, 78, 5.56), p(175, 316, 3.96)
        left, right = p(203, 216, 3.95), p(96, 211, 3.34)
        self.assertEqual(self.kept([ossicone, neck, left, right]), [left, right])

    def test_several_plausible_pairs_are_not_a_face(self):
        # Three level pupils: two pairs pass (the outer one is too far apart).
        p = self.pupil
        self.assertIsNone(self.kept([p(100, 100), p(200, 100), p(300, 100)]))

    def test_more_than_two_with_no_plausible_pair_are_not_a_face(self):
        p = self.pupil
        self.assertIsNone(self.kept([p(100, 50), p(100, 150), p(100, 250)]))


class PupilPositions(unittest.TestCase):
    """report.pupilsAtMm (IS tests/test_is05b.py)."""

    def test_each_reported_pupil_is_a_stone_centre(self):
        for name in ("cat", "woman"):
            with self.subTest(image=name):
                result = support.layout_result(name, DEFAULT)
                report = result["report"]
                self.assertEqual(len(report["pupilsAtMm"]), len(report["pupilsMm"]))
                self.assertEqual(len(report["pupilsAtMm"]), 2)
                self.assertIsNotNone(report["face"])
                centres = {(s[0], s[1]): s[2] for s in result["stones"]}
                for (x, y) in report["pupilsAtMm"]:
                    self.assertIn((x, y), centres)
                    self.assertIn(centres[(x, y)], ("ss20", "ss30"))


class SampleDelivered(unittest.TestCase):
    """S3 (IS tests/test_is05b.py)."""

    def test_each_stone_reads_its_own_position_and_the_catch_light_is_kept(self):
        # 0.1 mm per px: left half red, right half blue, all opaque.
        rgb = np.zeros((100, 200, 3))
        rgb[:, :100, 0] = 1.0
        rgb[:, 100:, 2] = 1.0
        a = np.ones((100, 200))
        P = np.array([[5.0, 5.0], [15.0, 5.0], [15.0, 5.0]])
        D = np.array([2.0, 2.0, 2.0])
        detected = np.array([[50.0, 0.0, 0.0], [50.0, 0.0, 0.0], CATCH_LAB])
        for mean in (False, True):
            lab = _delivered_colours(rgb, a, 0.1, P, D, detected, mean)
            self.assertGreater(lab[0, 1], 60)   # red: a* high
            self.assertLess(lab[1, 2], -60)     # blue: b* low
            np.testing.assert_array_equal(lab[2], CATCH_LAB)

    def test_only_colours_change(self):
        for name in ("cat", "woman"):
            with self.subTest(image=name):
                on = support.layout_result(name, DEFAULT)
                no = support.layout_result(name, off(sample_delivered=False))
                self.assertEqual([s[:3] for s in on["stones"]], [s[:3] for s in no["stones"]])
                for key in SAME_KEYS:
                    self.assertEqual(on["report"][key], no["report"][key], key)
                self.assertGreater(len(colour_diff(no, on)), 0)


class HumanIris(unittest.TestCase):
    """S4 (IS tests/test_is05c.py)."""

    def test_people_lose_the_iris_rings(self):
        for name in ("woman", "portrait"):
            with self.subTest(image=name):
                rings = iris_stones(support.frame_result(name, off(human_iris=True)))
                none = iris_stones(support.frame_result(name, DEFAULT))
                print("IRIS %s %d->%d" % (name, rings, none))
                self.assertLess(none, rings)

    def test_animals_are_unchanged(self):
        for name in ("cat", "dog"):
            with self.subTest(image=name):
                rings = support.layout_result(name, off(human_iris=True))
                none = support.layout_result(name, DEFAULT)
                self.assertEqual(rings["report"]["face"], "animal")
                self.assertEqual(rings["stones"], none["stones"])


class SkinNearestInner(unittest.TestCase):
    """S5 (IS tests/test_is05c.py)."""

    def test_only_skin_colours_change(self):
        for name in ("woman", "dog"):
            with self.subTest(image=name):
                on = support.layout_result(name, DEFAULT)
                no = support.layout_result(name, off(skin_nearest_inner=False))
                self.assertEqual([s[:3] for s in on["stones"]], [s[:3] for s in no["stones"]])
                for key in SAME_KEYS:
                    self.assertEqual(on["report"][key], no["report"][key], key)
                diff = colour_diff(no, on)
                self.assertGreater(len(diff), 0)
                self.assertTrue(all(a in SKIN and b in SKIN for a, b in diff), diff)

    def test_the_woman_has_less_smoked_topaz(self):
        count = lambda r: sum(s[3] == SMOKED for s in r["stones"])
        on = count(support.layout_result("woman", DEFAULT))
        no = count(support.layout_result("woman", off(skin_nearest_inner=False)))
        print("SMOKED TOPAZ woman %d->%d" % (no, on))
        self.assertLess(on, no)


class WarmShadow(unittest.TestCase):
    """S6 (IS tests/test_is05d.py; mixed_shadow is not ported)."""

    def test_a_near_tie_takes_colorado_topaz(self):
        # The IS woman's mean shadow colour: Smoked Topaz 11.9, Colorado Topaz 12.9 ΔE away.
        lab = np.array([[33.4, 25.7, 34.1]])
        D, C = np.array([2.0]), [SMOKED]
        self.assertEqual(skin_nearest(D, C, lab, PAL)[0], [SMOKED])
        self.assertEqual(skin_nearest(D, C, lab, PAL, warm_de=3.0)[0], [COLORADO])
        # A clear Smoked Topaz stays.
        self.assertEqual(skin_nearest(D, C, PAL.lab[PAL.ids.index(SMOKED)][None], PAL, warm_de=3.0)[0], [SMOKED])

    def test_only_smoked_topaz_becomes_colorado_topaz(self):
        on = support.layout_result("woman", DEFAULT)
        no = support.layout_result("woman", off(warm_shadow=False))
        self.assertEqual([s[:3] for s in on["stones"]], [s[:3] for s in no["stones"]])
        self.assertEqual(set(colour_diff(no, on)), {(SMOKED, COLORADO)})


class LoneWhiteSkin(unittest.TestCase):
    """S8 (IS tests/test_pn04h.py)."""

    def setUp(self):
        self.P = hex_grid(5, 5)
        self.D = np.full(len(self.P), 2.0)
        self.mid = 12  # row 2, column 2: six neighbours

    def colours(self, centre, around="silk"):
        C = [around] * len(self.P)
        C[self.mid] = centre
        return C

    def test_a_white_stone_in_skin_takes_the_skin_colour(self):
        for white in sorted(WHITE):
            out, n = lone_white_skin(self.P, self.D, self.colours(white), PAL, [])
            self.assertEqual((out[self.mid], n), ("silk", 1), white)

    def test_the_most_common_neighbour_colour_and_on_a_tie_the_lighter(self):
        C = self.colours("crystal-clear")
        nb = [i for i in range(len(self.P)) if i != self.mid and np.hypot(*(self.P[i] - self.P[self.mid])) < 2.7]
        self.assertEqual(len(nb), 6)
        for k, i in enumerate(nb):
            C[i] = "rose-gold" if k < 4 else "light-peach"
        self.assertEqual(lone_white_skin(self.P, self.D, C, PAL, [])[0][self.mid], "rose-gold")
        for k, i in enumerate(nb):
            C[i] = "copper" if k < 3 else "light-peach"
        self.assertEqual(lone_white_skin(self.P, self.D, C, PAL, [])[0][self.mid], "light-peach")

    def test_kept_near_an_eye_next_to_anything_not_skin_and_when_not_white(self):
        x, y = self.P[self.mid]
        self.assertEqual(lone_white_skin(self.P, self.D, self.colours("crystal-clear"), PAL, [(x + 2, y, 3.0)])[1], 0)
        C = self.colours("crystal-clear")
        C[self.mid + 1] = "jet"
        self.assertEqual(lone_white_skin(self.P, self.D, C, PAL, [])[1], 0)
        self.assertEqual(lone_white_skin(self.P, self.D, self.colours("grey"), PAL, [])[1], 0)
        # Larger than SS6 (a pupil) is left alone.
        D = self.D.copy()
        D[self.mid] = 4.7
        self.assertEqual(lone_white_skin(self.P, D, self.colours("crystal-clear"), PAL, [])[1], 0)
        # Only skin around it counts: white among white stays.
        self.assertEqual(lone_white_skin(self.P, self.D, self.colours("crystal-clear", "crystal-clear"), PAL, [])[1], 0)

    def test_on_a_layout_only_white_stones_become_skin(self):
        on = support.layout_result("woman", DEFAULT)
        no = support.layout_result("woman", off(lone_white_skin=False))
        self.assertEqual([s[:3] for s in on["stones"]], [s[:3] for s in no["stones"]])
        for a, b in colour_diff(no, on):
            self.assertIn(a, WHITE)
            self.assertIn(b, SKIN)


IMAGES = support.IMAGES + ["sunburst_flower"]
PEOPLE = ("einstein", "portrait", "woman")
EYE_MM = 8.0  # S4 moves stones only this close to a pupil (7.4 mm at most on the 13 images)


def places(r):
    return {tuple(s[:3]) for s in r["stones"]}


class ImagesAgainstBuildJ(unittest.TestCase):
    """The new DEFAULT on every RS test image: positions and sizes as BUILD_J, except an eye stage
    S1 drops (face null) and S4's iris rings near people's pupils; otherwise only colours change."""

    def test_images(self):
        for name in IMAGES:
            with self.subTest(image=name):
                j = support.layout_result(name, BUILD_J)
                m = support.layout_result(name, DEFAULT)
                rj, rm = j["report"], m["report"]
                self.assertEqual(rm["violations"], 0)
                self.assertEqual(len(rm["pupilsAtMm"]), len(rm["pupilsMm"]))
                if rm["face"] is None:
                    print("ROW %s eye stage dropped" % name)
                    continue
                self.assertEqual(rm["face"], rj["face"])
                self.assertEqual(rm["pupilsMm"], rj["pupilsMm"])
                if rm["face"] == "human":
                    iris = support.layout_result(name, off(human_iris=True))
                    self.assertEqual(places(iris), places(j))
                    moved = places(j) ^ places(m)
                    far = [p for p in moved if min(np.hypot(p[0] - x, p[1] - y) for x, y in rm["pupilsAtMm"]) > EYE_MM]
                    self.assertEqual(far, [])
                    print("ROW %s stones %d->%d, %d moved near the eyes" % (name, rj["stones"], rm["stones"], len(moved)))
                else:
                    self.assertEqual([s[:3] for s in m["stones"]], [s[:3] for s in j["stones"]])
                    self.assertEqual(rm["bySize"], rj["bySize"])
                    print("ROW %s colours changed %d" % (name, len(colour_diff(j, m))))


class SoftOutlinesOff(unittest.TestCase):
    """soft_outlines off: only outline stones on human faces go from Smoked Topaz back to Jet."""

    def test_images(self):
        for name in PEOPLE + ("jesus", "cat", "dog"):
            with self.subTest(image=name):
                soft = support.layout_result(name, off(soft_outlines=True))
                m = support.layout_result(name, DEFAULT)
                self.assertEqual([s[:3] for s in m["stones"]], [s[:3] for s in soft["stones"]])
                diff = colour_diff(soft, m)
                if m["report"]["face"] == "human":
                    self.assertGreater(len(diff), 0)
                    self.assertEqual(set(diff), {(SMOKED, "jet")})
                else:
                    self.assertEqual(diff, [])


if __name__ == "__main__":
    unittest.main()
