"""RS-3044 and RS-3045: pale skin (Rules.pale_skin, faces.pale_skin).

The AI paints lit skin in one pale cream (about L* 93-96) that is not in the palette; the snap splits
it into Silk, Crystal, Metallic Sunshine and Citrine, and lone_white_skin leaves such a stone when any
neighbour is not skin. See docs/specifications/IMG-026-StrassLayoutService.md, "Pale skin (RS-3044)".

RS-3045 ports PatternNifty's version (IS PN-11, commit 6e097d5, tests/test_pn11.py): the rule acts on
groups of at most Rules.pale_skin_group candidates (4) in one pass instead of RS-3044's rounds, and only
light skin colours (catalogue L* at least Rules.pale_skin_min_l, 70) count among a group's outside
neighbours. So the round tests became group tests (they stay for BUILD_RS3044, which keeps the rounds
in faces.pale_skin_rounds), and a fur patch stays.

The fixtures are SS6 stones on a hexagonal grid (pitch 2.2 mm, so six neighbours each). The image test
lays out tests/fixtures/pale_skin_portrait.png (the AI image of the white-stones diagnosis) with BUILD_O
(no pale skin), BUILD_RS3044 and DEFAULT; the 13 RS test images are compared with BUILD_O the same way.
"""
import dataclasses
import unittest

import numpy as np
from skimage.color import deltaE_ciede2000

from strass_layout import BUILD_E, BUILD_F, BUILD_G, BUILD_H, BUILD_I, BUILD_J, BUILD_M, BUILD_O, BUILD_RS3044, DEFAULT, PROTOTYPE
from strass_layout.colour import palette
from strass_layout.distinct import SKIN
from strass_layout.faces import (_neighbours, finish_faces, is_pale_cream, light_skin, lone_white_skin, pale_groups, pale_skin,
                                 pale_skin_rounds)
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
    def test_only_default_and_build_rs3044_have_pale_skin(self):
        for rules in BUILDS:
            self.assertFalse(rules.pale_skin)
            self.assertFalse(rules.pale_skin_rounds)
        self.assertTrue(DEFAULT.pale_skin)
        self.assertFalse(DEFAULT.pale_skin_rounds)
        self.assertTrue(BUILD_RS3044.pale_skin and BUILD_RS3044.pale_skin_rounds)

    def test_build_o_is_default_without_it(self):
        self.assertEqual(dataclasses.replace(DEFAULT, pale_skin=False), BUILD_O)

    def test_build_rs3044_is_default_with_rounds(self):
        self.assertEqual(dataclasses.replace(DEFAULT, pale_skin_rounds=True), BUILD_RS3044)

    def test_group_limit_is_four(self):
        self.assertEqual(DEFAULT.pale_skin_group, 4)

    def test_light_skin_is_silk_and_light_peach(self):
        self.assertEqual(DEFAULT.pale_skin_min_l, 70.0)
        self.assertEqual(light_skin(PAL, DEFAULT.pale_skin_min_l), {"silk", "light-peach"})
        self.assertEqual(light_skin(PAL, 60), {"silk", "light-peach", "rose-peach", "vintage-rose", "golden-shadow",
                                               "rose-gold", "light-colorado"})
        self.assertEqual(light_skin(PAL, 80), set())


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

    def test_a_group_of_four_changes_and_of_five_stays(self):
        f = Field()
        four = f.set([(2, 2), (2, 3), (2, 4), (2, 5)], "crystal-clear")
        five = f.set([(6, 2), (6, 3), (6, 4), (6, 5), (6, 6)], "crystal-clear")
        self.assertEqual(sorted(map(len, pale_groups(f.P, f.D, f.C, f.lab, []))), [4, 5])
        out = f.run()
        self.assertEqual([out[k] for k in four], ["silk"] * 4)
        self.assertEqual([out[k] for k in five], ["crystal-clear"] * 5)

    def test_group_limit_setting(self):
        # A centre with its six neighbours: one group of seven, which stays at the default limit and
        # changes whole, in one pass, at a limit of 7.
        f = Field()
        ks = f.set([(4, 4), (4, 3), (4, 5), (3, 3), (3, 4), (5, 3), (5, 4)], "crystal-clear")
        self.assertEqual([len(g) for g in pale_groups(f.P, f.D, f.C, f.lab, [])], [7])
        self.assertEqual([f.run()[k] for k in ks], ["crystal-clear"] * 7)
        out = f.run(rules=dataclasses.replace(DEFAULT, pale_skin_group=7))
        self.assertEqual([out[k] for k in ks], ["silk"] * 7)
        self.assertEqual(pale_skin(f.P, f.D, f.C, f.lab, PAL, [], group=7)[1], 7)

    def test_a_fur_patch_touching_skin_stays(self):
        """A white animal next to a person: a patch of 12 cream stones (3 x 4) in skin, and a wide
        13 x 13 patch, stay whole."""
        f = Field(15, 15)
        fur = f.set([(r, c) for r in range(2, 5) for c in range(2, 6)], "crystal-clear")
        wide = f.set([(r, c) for r in range(1, 14) for c in range(7, 14)], "metallic-sunshine")
        out = f.run()
        self.assertEqual([out[k] for k in fur], ["crystal-clear"] * 12)
        self.assertEqual([out[k] for k in wide], ["metallic-sunshine"] * len(wide))

    def test_only_light_skin_neighbours_count(self):
        """Cream among tan fur or copper hair (skin-ramp colours under L* 70) stays; among Light Peach it
        changes; the setting moves the line."""
        for colour, changes in (("copper", False), ("light-colorado", False), ("golden-shadow", False), ("light-peach", True)):
            with self.subTest(colour=colour):
                f = Field()
                f.C = [colour] * len(f.C)
                pair = f.set([(4, 4), (4, 5)], "crystal-clear")
                out = f.run()
                self.assertEqual([out[k] != "crystal-clear" for k in pair], [changes] * 2)
        f = Field()
        f.C = ["light-colorado"] * len(f.C)
        pair = f.set([(4, 4), (4, 5)], "crystal-clear")
        out = f.run(rules=dataclasses.replace(DEFAULT, pale_skin_min_l=60))
        self.assertEqual([out[k] for k in pair], ["silk"] * 2)

    def test_half_light_skin(self):
        """A single stone with six neighbours: three Silk and three Copper is half light skin (changes);
        two Silk and four Copper is not."""
        for silk, changes in ((3, True), (2, False)):
            f = Field()
            k = f.set([(4, 4)], "crystal-clear")[0]
            nb = _neighbours(f.P, f.D)[k]
            for j in nb[silk:]:
                f.C[j] = "copper"
            # pale_skin alone: calm_skin in finish_faces would give lone Copper stones their neighbours' Silk.
            self.assertEqual(pale_skin(f.P, f.D, f.C, f.lab, PAL, [])[0][k] != "crystal-clear", changes, silk)

    def test_outside_neighbours_counted_once(self):
        """A pair has 8 outside neighbours; the two it shares are skin, five of the other six Jet. Once
        each, 3 of 8 are skin (under half), so the pair stays; counted per stone it would be 5 of 10."""
        f = Field()
        pair = f.set([(2, 2), (2, 3)], "crystal-clear")
        nb = _neighbours(f.P, f.D)
        outside = sorted(set(nb[pair[0]] + nb[pair[1]]) - set(pair))
        shared = sorted(set(nb[pair[0]]) & set(nb[pair[1]]))
        self.assertEqual((len(outside), len(shared)), (8, 2))
        others = [j for j in outside if j not in shared]
        for j in others[:5]:
            f.C[j] = "jet"
            f.lab[j] = (10.0, 0.0, 0.0)
        self.assertEqual([f.run()[k] for k in pair], ["crystal-clear"] * 2)
        f.C[others[4]], f.lab[others[4]] = "silk", SKIN_LAB  # 4 of 8: half, so it changes
        self.assertEqual([f.run()[k] for k in pair], ["silk"] * 2)

    def test_what_stays(self):
        cases = {
            "read not pale": dict(lab=(70.0, 2.0, 13.0)),
            "neutral white read": dict(lab=(95.0, 0.5, 4.0)),
            "ss10": dict(d=2.8),
            "near an eye": dict(eye=True),
            "under half skin": dict(others=[(4, 3), (4, 5), (3, 4), (5, 4)]),
            "only three outside neighbours": dict(alone=True),
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

    def test_build_rs3044_keeps_the_rounds(self):
        """BUILD_RS3044 runs RS-3044's rule (faces.pale_skin_rounds): a group of seven changes from its
        edge inward, which DEFAULT's group rule leaves."""
        f = Field()
        centre = f.at(4, 4)
        ring = f.set([(4, 3), (4, 5), (3, 3), (3, 4), (5, 3), (5, 4)], "crystal-clear")
        f.set([(4, 4)], "crystal-clear")
        once = pale_skin_rounds(f.P, f.D, f.C, f.lab, PAL, [], rounds=1)[0]
        self.assertEqual([once[k] for k in ring], ["silk"] * 6)
        self.assertEqual(once[centre], "crystal-clear")
        self.assertEqual(f.run(rules=BUILD_RS3044)[centre], "silk")
        self.assertEqual(f.run()[centre], "crystal-clear")

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
        in a skin colour (Vintage Rose). RS-3045: the ten teeth are one group, over the limit; with the
        limit at 10 they stay too, for their colour."""
        f, teeth, lips = self.mouth(CRYSTAL_READ, "vintage-rose")
        for rules in (DEFAULT, dataclasses.replace(DEFAULT, pale_skin_group=10)):
            out = f.run(rules=rules)
            self.assertEqual([out[k] for k in teeth], ["crystal-clear"] * 10)

    def test_cream_teeth_between_red_lips_stay(self):
        """Teeth read as pale cream stay when the lips are not skin colours: no tooth has half its
        neighbours in skin. RS-3045: with the limit at 10 too (their outside neighbours are the lips,
        under half of them skin)."""
        f, teeth, lips = self.mouth(TOOTH, "light-siam")
        for rules in (DEFAULT, dataclasses.replace(DEFAULT, pale_skin_group=10)):
            out = f.run(rules=rules)
            self.assertEqual([out[k] for k in teeth], ["crystal-clear"] * 10)
            self.assertEqual([out[k] for k in lips], ["light-siam"] * 18)

def pale_portrait():
    return support.layout_result("pale_skin_portrait", BUILD_O), support.layout_result("pale_skin_portrait", DEFAULT)


# The diagnosis' white stones (tools/scratch/white-stones, whites.json) in the portrait's stone mm:
# 10 of the 11 Crystal stones on skin (the 11th is DARK_EDGE), the eye white (#5) and the catch-light (#14).
SKIN_CRYSTAL = [(31.67, 118.7), (47.81, 106.26), (50.24, 124.22), (74.52, 100.76), (28.79, 54.74),
                (45.88, 123.89), (28.34, 56.85), (47.05, 122.02), (45.99, 54.88), (30.54, 55.51)]
EYE_WHITE = (24.12, 47.47)
CATCH_LIGHT = (49.32, 42.24)
# RS-3045: a Metallic Sunshine on the chest with three neighbours, which RS-3044 skipped; its pair has
# six outside neighbours, all skin, so it changes now.
EXTRA = (49.146, 126.438)
# RS-3045: the one of RS-3044's 22 that stays, on the forehead beside the gold head chain; its outside
# neighbours are Silk 2, Light Topaz 2 and Light Colorado 1 (2 of 5 light skin).
DARK_EDGE = (28.43, 31.98)


def changes(before, after):
    out = {}
    for a, b in zip(before["stones"], after["stones"]):
        if a[3] != b[3]:
            out[(a[3], b[3])] = out.get((a[3], b[3]), 0) + 1
    return out


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
        # RS-3045, as PatternNifty's 6e097d5: of RS-3044's 22 (Crystal 11, Metallic Sunshine 8, Citrine 3)
        # the Crystal at DARK_EDGE stays, and the Metallic Sunshine at EXTRA changes: 22.
        self.assertEqual(changes(before, after), {("crystal-clear", "silk"): 10, ("metallic-sunshine", "silk"): 9, ("citrine", "silk"): 3})
        self.assertEqual((colour_at(before, DARK_EDGE), colour_at(after, DARK_EDGE)), ("crystal-clear", "crystal-clear"))
        self.assertEqual((colour_at(before, EXTRA), colour_at(after, EXTRA)), ("metallic-sunshine", "silk"))
        print("ROW pale_skin_portrait %s" % changes(before, after))

    def test_build_rs3044_gives_the_rs_3044_changes(self):
        """BUILD_RS3044 (frozen, rounds) changes RS-3044's 22 stones, DARK_EDGE among them and not EXTRA."""
        before, _ = pale_portrait()
        rounds = support.layout_result("pale_skin_portrait", BUILD_RS3044)
        self.assertEqual(changes(before, rounds), {("crystal-clear", "silk"): 11, ("metallic-sunshine", "silk"): 8, ("citrine", "silk"): 3})
        self.assertEqual(colour_at(rounds, DARK_EDGE), "silk")
        self.assertEqual(colour_at(rounds, EXTRA), "metallic-sunshine")

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
