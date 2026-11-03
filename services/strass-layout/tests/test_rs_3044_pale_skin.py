"""RS-3044: pale skin (Rules.pale_skin, faces.pale_skin).

The AI paints lit skin in one pale cream (about L* 93-96) that is not in the palette; the snap splits
it into Silk, Crystal, Metallic Sunshine and Citrine, and lone_white_skin leaves such a stone when any
neighbour is not skin. See docs/specifications/IMG-026-StrassLayoutService.md, "Pale skin (RS-3044)".

The fixtures are SS6 stones on a hexagonal grid (pitch 2.2 mm, so six neighbours each). The image test
lays out tests/fixtures/pale_skin_portrait.png (the AI image of the white-stones diagnosis) with BUILD_O
and DEFAULT; the 13 RS test images are compared with BUILD_O the same way.
"""
import dataclasses
import unittest

import numpy as np
from skimage.color import deltaE_ciede2000

from strass_layout import BUILD_E, BUILD_F, BUILD_G, BUILD_H, BUILD_I, BUILD_J, BUILD_M, BUILD_O, DEFAULT, PROTOTYPE
from strass_layout.colour import palette
from strass_layout.distinct import SKIN
from strass_layout.faces import finish_faces, is_pale_cream, lone_white_skin, pale_skin
from tests import support

BUILDS = (PROTOTYPE, BUILD_E, BUILD_F, BUILD_G, BUILD_H, BUILD_I, BUILD_J, BUILD_M, BUILD_O)
PAL = palette(DEFAULT)
CREAM = (94.3, 2.2, 13.0)       # a lit-skin read of the diagnosis (stone #2): L* 94.3, chroma 13.2, hue 80
SKIN_LAB = (78.0, 14.0, 22.0)   # an ordinary skin read
TOOTH = (93.0, 1.0, 9.0)        # pale cream too, so only the neighbours keep a tooth
CRYSTAL_READ = (96.5, 0.0, 0.0)  # the AI's Crystal #f5f5f5
PITCH = 2.2


def grid(rows, cols):
    """Centres (mm) of a hexagonal grid, row by row."""
    return np.array([[(c + (r % 2) / 2) * PITCH, r * PITCH * np.sqrt(3) / 2] for r in range(rows) for c in range(cols)])


class Field:
    """A rows x cols field of SS6 skin stones (Silk, read SKIN_LAB); set() paints single stones."""

    def __init__(self, rows=9, cols=9):
        self.cols = cols
        self.P = grid(rows, cols)
        self.D = np.full(len(self.P), 2.0)
        self.C = ["silk"] * len(self.P)
        self.lab = np.tile(np.array(SKIN_LAB, float), (len(self.P), 1))

    def at(self, r, c):
        return r * self.cols + c

    def set(self, cells, colour, lab=CREAM):
        for r, c in cells:
            k = self.at(r, c)
            self.C[k] = colour
            self.lab[k] = lab
        return [self.at(r, c) for r, c in cells]

    def run(self, eyes=(), face="human", rules=DEFAULT):
        return finish_faces(self.P, self.D, list(self.C), PAL, face, list(eyes), dataclasses.replace(rules, skin_nearest=False), self.lab)


def nearest_skin(lab):
    ids = [k for k in PAL.ids if k in SKIN and k != "topaz"]
    cat = PAL.lab[[PAL.ids.index(k) for k in ids]]
    return ids[int(np.argmin(deltaE_ciede2000(np.repeat(np.array(lab, float)[None], len(ids), 0), cat)))]


class Defaults(unittest.TestCase):
    def test_only_default_has_pale_skin(self):
        for rules in BUILDS:
            self.assertFalse(rules.pale_skin)
        self.assertTrue(DEFAULT.pale_skin)

    def test_build_o_is_default_without_it(self):
        self.assertEqual(dataclasses.replace(DEFAULT, pale_skin=False), BUILD_O)


class Colour(unittest.TestCase):
    def test_pale_warm_cream(self):
        self.assertTrue(is_pale_cream(CREAM)[0])
        self.assertTrue(is_pale_cream([(96.0, 3.0, 9.0), (86.0, 20.0, 30.0)]).all())
        for lab in ((85.0, 2.0, 13.0),      # L* not above 85
                    (95.0, 0.5, 5.0),       # chroma below 8: a neutral white
                    (90.0, 10.0, 40.0),     # chroma above 40: a gold
                    (95.0, -6.0, 10.0),     # hue 121: greenish
                    (95.0, 10.0, -2.0)):    # hue 349: pink-violet
            self.assertFalse(is_pale_cream(lab)[0], lab)

    def test_nearest_skin_colour_of_the_lit_skin_read_is_silk(self):
        self.assertEqual(nearest_skin(CREAM), "silk")


class Rule(unittest.TestCase):
    def test_a_pair_and_a_triple_of_white_stones_on_skin(self):
        f = Field()
        pair = f.set([(2, 2), (2, 3)], "crystal-clear")
        triple = f.set([(5, 5), (5, 6), (6, 5)], "crystal-clear")
        # lone_white_skin leaves each of them: every one has a white neighbour.
        self.assertEqual(lone_white_skin(f.P, f.D, f.C, PAL, [])[1], 0)
        out = f.run()
        for k in pair + triple:
            self.assertEqual(out[k], nearest_skin(CREAM))
        self.assertEqual(sum(a != b for a, b in zip(f.C, out)), 5)

    def test_any_non_skin_colour_and_ss4(self):
        f = Field()
        ks = f.set([(2, 2)], "metallic-sunshine") + f.set([(2, 5)], "citrine") + f.set([(5, 2)], "silver") + f.set([(5, 5)], "light-topaz")
        f.D[f.at(5, 5)] = 1.5
        out = f.run()
        self.assertEqual([out[k] for k in ks], ["silk"] * 4)

    def test_a_cluster_changes_from_its_edge_inward(self):
        f = Field()
        # A centre with its six neighbours: the ring has half skin neighbours, the centre none at first.
        centre = f.at(4, 4)
        ring = f.set([(4, 3), (4, 5), (3, 3), (3, 4), (5, 3), (5, 4)], "crystal-clear")
        f.set([(4, 4)], "crystal-clear")
        once = pale_skin(f.P, f.D, f.C, f.lab, PAL, [], rounds=1)[0]
        self.assertEqual([once[k] for k in ring], ["silk"] * 6)
        self.assertEqual(once[centre], "crystal-clear")
        out, n = pale_skin(f.P, f.D, f.C, f.lab, PAL, [])
        self.assertEqual((out[centre], n), ("silk", 7))

    def test_at_most_five_rounds(self):
        # A wide white patch is taken from its corners inward over many rounds; the rule stops after 5.
        f = Field(15, 15)
        f.set([(r, c) for r in range(1, 14) for c in range(1, 14)], "crystal-clear")
        counts = [pale_skin(f.P, f.D, f.C, f.lab, PAL, [], rounds=k)[1] for k in (5, 6)]
        self.assertEqual(pale_skin(f.P, f.D, f.C, f.lab, PAL, [])[1], counts[0])
        self.assertLess(counts[0], counts[1])
        self.assertEqual(pale_skin(f.P, f.D, f.C, f.lab, PAL, [])[0][f.at(7, 7)], "crystal-clear")

    def test_what_stays(self):
        cases = {
            "read not pale": dict(lab=(70.0, 2.0, 13.0)),
            "neutral white read": dict(lab=(95.0, 0.5, 4.0)),
            "ss10": dict(d=2.8),
            "near an eye": dict(eye=True),
            "under half skin": dict(others=[(4, 3), (4, 5), (3, 4), (5, 4)]),
            "only three neighbours": dict(alone=True),
        }
        for name, case in cases.items():
            with self.subTest(case=name):
                f = Field()
                k = f.set([(4, 4)], "crystal-clear", case.get("lab", CREAM))[0]
                # a Metallic Sunshine neighbour, so lone_white_skin would leave the stone too
                f.set([(4, 3)], "metallic-sunshine", SKIN_LAB)
                for rc in case.get("others", []):
                    f.set([rc], "jet", (10.0, 0.0, 0.0))
                if "d" in case:
                    f.D[k] = case["d"]
                    f.P[k] += 0.4  # keeps the gaps: SS10 needs a little more room
                if case.get("alone"):
                    keep = [k, f.at(4, 3), f.at(4, 5), f.at(3, 4)]
                    f.P, f.D, f.lab = f.P[keep], f.D[keep], f.lab[keep]
                    f.C = [f.C[j] for j in keep]
                    k = 0
                eyes = [(f.P[k][0] + 3.0, f.P[k][1], 2.5)] if case.get("eye") else []
                self.assertEqual(f.run(eyes)[k], "crystal-clear")

    def test_skin_stones_keep_their_colour(self):
        f = Field()
        k = f.set([(4, 4)], "light-peach")[0]
        self.assertEqual(pale_skin(f.P, f.D, f.C, f.lab, PAL, [])[0][k], "light-peach")

    def test_only_on_a_persons_face(self):
        for face in ("animal", None):
            f = Field()
            k = f.set([(4, 4)], "crystal-clear")[0]
            f.set([(4, 3)], "metallic-sunshine", SKIN_LAB)
            self.assertEqual(f.run(face=face)[k], "crystal-clear", face)

    def test_off_in_build_o(self):
        f = Field()
        k = f.set([(4, 4), (4, 5)], "crystal-clear")
        self.assertEqual([f.run(rules=BUILD_O)[j] for j in k], ["crystal-clear"] * 2)

    def mouth(self, teeth_lab, upper_lip):
        """Two rows of five teeth (Crystal) in a ring of lips: the upper lip (row 3 and the corners of
        row 4) in upper_lip, the lower lip (row 6 and the corners of row 5) in Light Siam, all in skin.
        Returns (field, teeth, lips)."""
        f = Field(11, 11)
        upper = f.set([(3, c) for c in range(2, 9)] + [(4, 2), (4, 8)], upper_lip, (62.0, 25.0, 12.0))
        teeth = f.set([(4, c) for c in range(3, 8)] + [(5, c) for c in range(3, 8)], "crystal-clear", teeth_lab)
        lower = f.set([(6, c) for c in range(2, 9)] + [(5, 2), (5, 8)], "light-siam", (40.0, 50.0, 25.0))
        return f, teeth, upper + lower

    def test_teeth_in_crystal_stay(self):
        """Teeth the AI paints in its Crystal (#f5f5f5, chroma 0) are no pale cream, even between lips
        in a skin colour (Vintage Rose)."""
        f, teeth, lips = self.mouth(CRYSTAL_READ, "vintage-rose")
        out = f.run()
        self.assertEqual([out[k] for k in teeth], ["crystal-clear"] * 10)

    def test_cream_teeth_between_red_lips_stay(self):
        """Teeth read as pale cream stay when the lips are not skin colours: no tooth has half its
        neighbours in skin."""
        f, teeth, lips = self.mouth(TOOTH, "light-siam")
        out = f.run()
        self.assertEqual([out[k] for k in teeth], ["crystal-clear"] * 10)
        self.assertEqual([out[k] for k in lips], ["light-siam"] * 18)

def pale_portrait():
    return support.layout_result("pale_skin_portrait", BUILD_O), support.layout_result("pale_skin_portrait", DEFAULT)


# The diagnosis' white stones (tools/scratch/white-stones, whites.json) in the portrait's stone mm:
# the 11 Crystal stones on skin, the eye white (#5) and the catch-light (#14).
SKIN_CRYSTAL = [(31.67, 118.7), (28.43, 31.98), (47.81, 106.26), (50.24, 124.22), (74.52, 100.76), (28.79, 54.74),
                (45.88, 123.89), (28.34, 56.85), (47.05, 122.02), (45.99, 54.88), (30.54, 55.51)]
EYE_WHITE = (24.12, 47.47)
CATCH_LIGHT = (49.32, 42.24)


def colour_at(layout, xy):
    hits = [s[3] for s in layout["stones"] if abs(s[0] - xy[0]) < 0.006 and abs(s[1] - xy[1]) < 0.006]
    assert len(hits) == 1, (xy, hits)
    return hits[0]


class Portrait(unittest.TestCase):
    """The diagnosis' AI image: lit skin in white and gold stones before, skin colours after."""

    def test_white_and_gold_stones_on_lit_skin_become_skin(self):
        before, after = pale_portrait()
        for xy in SKIN_CRYSTAL:
            self.assertEqual(colour_at(before, xy), "crystal-clear", xy)
            self.assertIn(colour_at(after, xy), SKIN, xy)
        changes = {}
        for a, b in zip(before["stones"], after["stones"]):
            if a[3] != b[3]:
                changes[(a[3], b[3])] = changes.get((a[3], b[3]), 0) + 1
        self.assertEqual(changes, {("crystal-clear", "silk"): 11, ("metallic-sunshine", "silk"): 8, ("citrine", "silk"): 3})
        print("ROW pale_skin_portrait %s" % changes)

    def test_eye_white_and_catch_light_stay(self):
        before, after = pale_portrait()
        for xy in (EYE_WHITE, CATCH_LIGHT):
            self.assertEqual(colour_at(before, xy), "crystal-clear")
            self.assertEqual(colour_at(after, xy), "crystal-clear")

    def test_build_o_is_the_develop_layout(self):
        """BUILD_O here is what develop's DEFAULT gave for the diagnosis (its stones.json): pinned by
        the stone count and colour counts."""
        before, _ = pale_portrait()
        self.assertEqual(len(before["stones"]), 2826)
        self.assertEqual(before["report"]["colours"]["crystal-clear"], 18)


class Images(unittest.TestCase):
    """DEFAULT against BUILD_O on the 13 RS test images: only colours change, only to skin colours,
    and only on a person's face."""

    def test_images(self):
        for name in support.IMAGES + ["sunburst_flower"]:
            with self.subTest(image=name):
                before = support.layout_result(name, BUILD_O)
                after = support.layout_result(name, DEFAULT)
                self.assertEqual([s[:3] for s in after["stones"]], [s[:3] for s in before["stones"]])
                changes = [(a[3], b[3]) for a, b in zip(before["stones"], after["stones"]) if a[3] != b[3]]
                if after["report"]["face"] != "human":
                    self.assertEqual(changes, [])
                filled = after["report"]["filled"]
                n_kept = len(after["stones"]) - filled
                for k, (a, b) in enumerate(zip(before["stones"], after["stones"])):
                    if a[3] != b[3] and k < n_kept:
                        self.assertNotIn(a[3], SKIN, (name, k))
                        self.assertIn(b[3], SKIN, (name, k))
                drop = lambda r: {k: v for k, v in r.items() if k not in ("stagesMs", "ms", "colours")}
                self.assertEqual(drop(after["report"]), drop(before["report"]))
                print("ROW %s changed %d" % (name, len(changes)))


if __name__ == "__main__":
    unittest.main()
