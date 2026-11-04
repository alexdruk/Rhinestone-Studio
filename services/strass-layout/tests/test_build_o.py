"""IMG-026O: size cap, overlap cleanup and hole fill, ported from PatternNifty (IS) at e9e7014.

See docs/specifications/IMG-026-StrassLayoutService.md, "Size cap, overlap cleanup and hole fill
(build O)", and docs/IS-PORT-PLAN.md sections 3.4 and 3.5. Each class names the IS test it was
ported from (IS tools/test-cleanup.mjs, test-holes.mjs, test-tiers.mjs). The IS cases that need
IS's own fixture layouts, its JavaScript colour copy, black & white or its settings are not ported.

The image tests take the BUILD_M frame (which every older test lays out anyway) and run
cleanup.clean_up on it with BUILD_O (build O's DEFAULT, frozen by RS-3044); Pipeline checks once that
this is what layout() returns.
"""
import copy
import dataclasses
import unittest

import numpy as np
from scipy.spatial import cKDTree

from strass_layout import BUILD_E, BUILD_F, BUILD_G, BUILD_H, BUILD_I, BUILD_J, BUILD_M, BUILD_O, DEFAULT, PROTOTYPE
from strass_layout.cleanup import (CLOSE_MM, MIN_GAP_MM, area_under, cap_sizes, clean_up, find_holes, neighbour_vote,
                                   pupil_centres, remove_close, squared_edt, subject_mask)
from strass_layout.geometry import holes
from strass_layout.imageio import decode_png
from strass_layout.pipeline import finish_layout
from strass_layout.post import SIZE_KEYS
from tests import support

FLAGS = ("size_cap", "overlap_cleanup", "hole_fill")
BUILDS = (PROTOTYPE, BUILD_E, BUILD_F, BUILD_G, BUILD_H, BUILD_I, BUILD_J, BUILD_M)
DIAMETERS = {v: k for k, v in SIZE_KEYS.items()}
IMAGES = support.IMAGES + ["sunburst_flower"]
NEW_KEYS = ("capped", "removed", "removedShare", "filled", "cleanupCoverage")


def stone(x, y, d, colour="jet"):
    return {"x": x, "y": y, "size": SIZE_KEYS[d], "d": d, "color": colour}


def arrays(stones):
    return np.array([[q["x"], q["y"]] for q in stones]).reshape(-1, 2), np.array([q["d"] for q in stones])


def min_gap(stones):
    P, D = arrays(stones)
    pairs = cKDTree(P).query_pairs(float(D.max()) + 5, output_type="ndarray")
    return float((np.linalg.norm(P[pairs[:, 0]] - P[pairs[:, 1]], axis=1) - (D[pairs[:, 0]] + D[pairs[:, 1]]) / 2).min())


# A synthetic AI image as IS test-holes.mjs: opaque inside a disc of radius R px around the centre,
# one flat colour, 0.1 mm per px; SS6 stones on a hexagonal grid of pitch 2.2 mm inside the disc.
S = 0.1
CATALOGUE = {"jet": (0, 0, 0), "amethyst": (0x99, 0x66, 0xcc), "fuchsia": (0xd1, 0x2e, 0x8a)}


def image(size, radius_px, rgb=(20, 20, 20), holes_px=()):
    yy, xx = np.mgrid[0:size, 0:size]
    on = np.hypot(xx - size / 2, yy - size / 2) <= radius_px
    for hx, hy, hr in holes_px:
        on &= np.hypot(xx - hx, yy - hy) > hr
    rgba = np.zeros((size, size, 4), np.uint8)
    rgba[on] = list(rgb) + [255]
    return rgba


def hex_stones(size, radius_px, skip=lambda x, y: False, colour="jet"):
    out = []
    pitch = 2.2
    c, R = size / 2 * S, radius_px * S
    for row in range(-40, 41):
        for col in range(-40, 41):
            x = c + (col + (row % 2) / 2) * pitch
            y = c + row * pitch * np.sqrt(3) / 2
            if np.hypot(x - c, y - c) > R - 1.2 or skip(x, y):
                continue
            out.append(stone(round(x, 3), round(y, 3), 2.0, colour))
    return out


def fill(stones, rgba):
    """clean_up with only the hole fill on, on the synthetic image."""
    only = dataclasses.replace(BUILD_M, hole_fill=True)
    return clean_up(copy.deepcopy(stones), rgba[..., 3], S, None, [], rgba[..., 3] >= 128, only)


class Defaults(unittest.TestCase):
    def test_only_default_has_the_build_o_rules(self):
        for rules in BUILDS:
            for flag in FLAGS:
                self.assertFalse(getattr(rules, flag), flag)
        for flag in FLAGS:
            self.assertTrue(getattr(DEFAULT, flag), flag)
            self.assertTrue(getattr(BUILD_O, flag), flag)

    def test_build_m_is_build_o_without_them(self):
        self.assertEqual(dataclasses.replace(BUILD_O, size_cap=False, overlap_cleanup=False, hole_fill=False), BUILD_M)


class SizeCap(unittest.TestCase):
    """IS tools/test-tiers.mjs (capStoneSizes, pupilCentres) and spec 7.5."""

    def setUp(self):
        self.stones = [stone(10, 10, 4.7), stone(30, 10, 6.4), stone(50, 10, 4.7), stone(70, 10, 6.4), stone(90, 10, 4.0),
                       stone(100, 10, 2.0)]

    def test_a_plausible_pair_keeps_ss20_and_an_ss30_pupil_becomes_ss20(self):
        pupils = pupil_centres("human", [[10, 10], [30, 10]])
        out, capped = cap_sizes(self.stones, pupils)
        self.assertEqual([q["size"] for q in out], ["ss20", "ss20", "ss16", "ss16", "ss16", "ss6"])
        self.assertEqual(capped, 3)
        self.assertEqual([(q["x"], q["y"]) for q in out], [(q["x"], q["y"]) for q in self.stones])
        self.assertEqual(pupil_centres("animal", [[10, 10], [30, 10]]), [(10, 10), (30, 10)])

    def test_without_one_plausible_pair_everything_above_ss16_becomes_ss16(self):
        for face, pupils in ((None, [[10, 10], [30, 10]]), ("human", [[10, 10]]), ("animal", [[10, 10], [30, 10], [50, 10]]),
                             ("human", []), ("human", None)):
            out, capped = cap_sizes(self.stones, pupil_centres(face, pupils))
            self.assertEqual([q["size"] for q in out], ["ss16", "ss16", "ss16", "ss16", "ss16", "ss6"], (face, pupils))
            self.assertEqual(capped, 4)

    def test_a_pupil_matches_only_within_two_microns(self):
        out, _ = cap_sizes(self.stones, [(10.0015, 10), (30.0025, 10)])
        self.assertEqual([q["size"] for q in out[:2]], ["ss20", "ss16"])

    def test_the_cap_only_widens_gaps(self):
        stones = [stone(0, 0, 6.4), stone(6.5, 0, 6.4)]
        out, _ = cap_sizes(stones)
        self.assertGreater(min_gap(out), min_gap(stones))


class Cleanup(unittest.TestCase):
    """IS tools/test-cleanup.mjs."""

    def test_of_a_close_pair_the_smaller_stone_goes(self):
        # SS6 at 0 and SS4 1.8 mm away: rim gap 0.05 mm.
        kept, removed = remove_close([stone(0, 0, 2.0), stone(1.8, 0, 1.5), stone(10, 0, 2.0)])
        self.assertEqual(removed, [1])
        self.assertEqual([q["x"] for q in kept], [0, 10])
        # A gap of exactly 0.1 mm stays.
        self.assertEqual(remove_close([stone(0, 0, 2.0), stone(2.1, 0, 2.0)])[1], [])

    def test_on_equal_size_fewer_neighbours_go_then_the_later_one(self):
        # A (index 0) has a neighbour 0.3 mm away on its left; B (index 1) none. A and B overlap.
        self.assertEqual(remove_close([stone(10, 0, 2.0), stone(11.9, 0, 2.0), stone(7.7, 0, 2.0)])[1], [1])
        # Mirrored: now the later stone has the neighbour, so the earlier one goes.
        self.assertEqual(remove_close([stone(10, 0, 2.0), stone(11.9, 0, 2.0), stone(14.2, 0, 2.0)])[1], [0])
        # No neighbour on either side: the later one goes.
        self.assertEqual(remove_close([stone(10, 0, 2.0), stone(11.9, 0, 2.0)])[1], [1])

    def test_worst_gap_first_and_a_resolved_pair_is_skipped(self):
        # Three SS6 in a row 1.9 mm apart: pairs (0,1) and (1,2) both at -0.1 mm. Neighbours, counted
        # once before any removal: 0 and 2 have one each, 1 has two. So each pair removes its outer
        # stone and the middle one stays.
        kept, removed = remove_close([stone(0, 0, 2.0), stone(1.9, 0, 2.0), stone(3.8, 0, 2.0)])
        self.assertEqual(removed, [0, 2])
        self.assertEqual([q["x"] for q in kept], [1.9])
        # The worst pair decides first. A-B has a gap of 0.05 mm, B-C of -0.3 mm; neighbours A 1, B 2,
        # C 3 (D and E sit 0.3 mm from C). B-C goes first and removes B, so A-B is skipped and A
        # stays; taken the other way round, A-B would have removed A and then B-C B.
        kept, removed = remove_close([stone(0, 0, 2.0), stone(2.05, 0, 2.0), stone(3.75, 0, 2.0), stone(6.05, 0, 2.0),
                                      stone(3.75, 2.3, 2.0)])
        self.assertEqual(removed, [1])

    def test_a_dense_cloud_ends_with_no_pair_below_the_gap(self):
        rnd = np.random.default_rng(7)
        cloud = [stone(round(float(x), 3), round(float(y), 3), 1.5 if r < 0.3 else 2.0)
                 for x, y, r in zip(rnd.random(600) * 40, rnd.random(600) * 40, rnd.random(600))]
        kept, removed = remove_close(cloud)
        self.assertGreater(len(removed), 0)
        self.assertGreaterEqual(min_gap(kept), MIN_GAP_MM - 1e-9)

    def test_the_cleanup_runs_after_the_cap(self):
        # Two SS30 stones that only overlap before the cap both stay.
        rules = dataclasses.replace(BUILD_M, size_cap=True, overlap_cleanup=True)
        mask = np.ones((200, 200), bool)
        out, stats = clean_up([stone(5, 5, 6.4), stone(11, 5, 6.4)], np.full((200, 200), 255, np.uint8), S, None, [], mask, rules)
        self.assertEqual((stats["capped"], stats["removed"], len(out)), (2, 0, 2))
        # The cap shrinks the stones, so the coverage drops with their area: (4 / 6.4)^2 of it.
        P0, D0 = arrays([stone(5, 5, 6.4), stone(11, 5, 6.4)])
        cover = holes(P0, D0, mask, S)[1]
        self.assertAlmostEqual(stats["coverage"], cover * (4 / 6.4) ** 2, delta=0.01 * cover)

    def test_area_under_counts_pixel_centres_inside_a_stone(self):
        P, D = arrays([stone(5, 5, 2.0)])
        self.assertAlmostEqual(area_under(P, D, (0, 0, 10, 10)) / 100, np.pi, delta=0.05)


class Holes(unittest.TestCase):
    """IS tools/test-holes.mjs."""

    def test_squared_edt_is_the_exact_squared_distance(self):
        f = np.zeros((11, 17), bool)
        pts = [(0, 0), (16, 10), (8, 5), (3, 9)]
        for x, y in pts:
            f[y, x] = True
        d = squared_edt(f)
        yy, xx = np.mgrid[0:11, 0:17]
        want = np.min([(xx - a) ** 2 + (yy - b) ** 2 for a, b in pts], 0)
        np.testing.assert_array_equal(d, want)
        self.assertEqual(squared_edt(np.zeros((2, 2), bool))[0, 0], np.inf)

    def test_the_subject_closes_narrow_gaps_and_small_enclosed_holes_not_the_outside(self):
        # A 0.6 mm wide transparent slit through the middle and a 1 mm transparent dot are closed; a
        # 6 mm transparent disc (area above two SS6 stones) stays open, and so does the outside.
        size = 400
        rgba = image(size, 180, holes_px=[(100, 200, 5), (300, 200, 30)])
        rgba[:, 197:203, 3] = 0
        m = subject_mask(rgba[..., 3], S)
        self.assertEqual(CLOSE_MM, 1.0)
        self.assertTrue(m[200, 200], "slit closed")
        self.assertTrue(m[200, 100], "small dot filled")
        self.assertFalse(m[200, 300], "large enclosed hole kept open")
        self.assertFalse(m[5, 5], "outside")

    def test_removed_stones_become_ss6_holes_then_ss4_filled_with_the_gap_kept(self):
        size, R = 400, 180
        rgba = image(size, R)
        mask = subject_mask(rgba[..., 3], S)
        full = hex_stones(size, R)
        none = find_holes(*arrays(full), mask, S)
        self.assertEqual(sum(d == 2.0 for _, _, d in none), 0)
        # Remove the stones within 3 mm of (20, 20) mm: a hole of several SS6 stones.
        holed = hex_stones(size, R, lambda x, y: np.hypot(x - 20, y - 20) < 3)
        found = find_holes(*arrays(holed), mask, S)
        ss6 = [h for h in found if h[2] == 2.0]
        ss4 = [h for h in found if h[2] == 1.5]
        self.assertGreaterEqual(len(ss6), len(full) - len(holed) - 1)
        # SS6 holes only where stones were removed; the grid leaves SS4 spots at the disc's rim.
        self.assertTrue(all(np.hypot(x - 20, y - 20) < 5 for x, y, _ in ss6))
        self.assertGreater(len(ss4), 0)
        self.assertLessEqual(len(ss4) - len(none), 3)
        # SS6 first, then SS4.
        self.assertEqual([d for _, _, d in found], sorted((d for _, _, d in found), reverse=True))
        out, stats = fill(holed, rgba)
        self.assertEqual(stats["filled"], len(found))
        self.assertEqual(len(out), len(holed) + len(found))
        self.assertGreaterEqual(min_gap(out), MIN_GAP_MM - 1e-9)
        self.assertEqual(find_holes(*arrays(out), mask, S), [], "nothing left to fill")
        self.assertGreater(stats["coverage"], holes(*arrays(holed), mask, S)[1])

    def test_every_filled_stone_lies_inside_the_subject(self):
        size, R = 400, 180
        rgba = image(size, R)
        for x, y, d in find_holes(*arrays(hex_stones(size, R)), subject_mask(rgba[..., 3], S), S):
            self.assertLessEqual(np.hypot(x - 20, y - 20) + d / 2, R * S + 0.1, (x, y))
        # Nothing at all outside the subject: an empty design in a disc gets stones only inside it.
        for x, y, d in find_holes(np.zeros((0, 2)), np.zeros(0), subject_mask(image(200, 40)[..., 3], S), S):
            self.assertLessEqual(np.hypot(x - 10, y - 10) + d / 2, 4.0 + 0.1)

    def test_a_filled_stone_takes_its_neighbours_colour_not_the_pixels_under_it(self):
        size, R = 400, 180
        centre = lambda out: [q for q in out[1:] if np.hypot(q["x"] - 20, q["y"] - 20) < 1]
        # The AI painted Amethyst; the stones around the hole are Fuchsia.
        holed = hex_stones(size, R, lambda x, y: np.hypot(x - 20, y - 20) < 1, "fuchsia")
        out, stats = fill(holed, image(size, R, CATALOGUE["amethyst"]))
        self.assertEqual([q["color"] for q in centre(out)], ["fuchsia"])
        # The dark spot: dark gap paint under the hole, Crystal all around -> Crystal.
        light = hex_stones(size, R, lambda x, y: np.hypot(x - 20, y - 20) < 1, "crystal-clear")
        out, _ = fill(light, image(size, R, CATALOGUE["jet"]))
        self.assertEqual([q["color"] for q in centre(out)], ["crystal-clear"])

    def test_a_large_hole_is_coloured_in_rounds_from_its_edge(self):
        # Left of x = 20 the stones are Jet, right of it Fuchsia; a hole of 6 mm radius in the middle.
        size, R = 400, 180
        holed = [dict(q, color="jet" if q["x"] < 20 else "fuchsia")
                 for q in hex_stones(size, R, lambda x, y: np.hypot(x - 20, y - 20) < 6)]
        out, stats = fill(holed, image(size, R))
        new = out[len(holed):]
        inner = [q for q in new if np.hypot(q["x"] - 20, q["y"] - 20) < 3]
        self.assertGreater(len(inner), 0, "stones deeper than 1 mm from every old stone")
        self.assertEqual({q["color"] for q in new}, {"jet", "fuchsia"})
        far_left = [q for q in new if q["x"] < 16 and np.hypot(q["x"] - 20, q["y"] - 20) < 6]
        far_right = [q for q in new if q["x"] > 24 and np.hypot(q["x"] - 20, q["y"] - 20) < 6]
        self.assertTrue(far_left and all(q["color"] == "jet" for q in far_left))
        self.assertTrue(far_right and all(q["color"] == "fuchsia" for q in far_right))


class NeighbourVote(unittest.TestCase):
    """IS tools/test-holes.mjs: the vote weighs nearer stones more, breaks ties by the nearest, and
    chains."""

    def vote(self, stones, targets):
        P = np.array([[x, y] for x, y, _, _ in stones])
        D = np.array([d for _, _, d, _ in stones])
        return neighbour_vote(P, D, [c for _, _, _, c in stones], targets)

    def test_weights_ties_and_reach(self):
        ring = lambda gap, ang, c: ((2 + gap) * np.cos(ang), (2 + gap) * np.sin(ang), 2.0, c)
        # Target 0 (SS6 at the origin). Blue 0.2 mm away weighs 0.8; two reds 0.6 mm away 0.4 each:
        # a tie, which the nearest (blue) wins. A third red 0.9 mm away (0.1) tips it to red.
        base = [(0, 0, 2.0, None), ring(0.2, 0, "blue"), ring(0.6, 2, "red"), ring(0.6, 4, "red")]
        self.assertEqual(self.vote(base, [0])[0], "blue")
        self.assertEqual(self.vote(base + [ring(0.9, 3, "red")], [0])[0], "red")
        # Stones beyond 1 mm do not vote.
        self.assertEqual(self.vote([(0, 0, 2.0, None), ring(0.5, 0, "blue"), ring(1.2, 2, "red"), ring(1.2, 3, "red")], [0])[0], "blue")

    def test_rounds_and_the_nearest_decided_stone(self):
        # A target with no decided stone within reach takes its colour from a target decided first.
        voted = self.vote([(0, 0, 2.0, None), (2.2, 0, 2.0, None), (4.4, 0, 2.0, "green")], [0, 1])
        self.assertEqual((voted[1], voted[0]), ("green", "green"))
        # No decided stone within 1 mm of any target: the nearest decided stone anywhere.
        voted = self.vote([(0, 0, 2.0, None), (5, 0, 2.0, "red"), (9, 0, 2.0, "blue")], [0])
        self.assertEqual(voted[0], "red")


def build_m_and_default(name):
    """(BUILD_M answer, BUILD_O answer from the same frame through clean_up, the BUILD_O frame)."""
    m = support.frame_result(name, BUILD_M)
    f = m["frame"]
    px = decode_png(support.png_bytes(name))
    stones, stats = clean_up(copy.deepcopy(m["stones"]), px.rgba[..., 3], f["mmPerPx"], f["face"], f["pupilsAtMm"], f["mask"], BUILD_O)
    o = copy.deepcopy(m)
    o["stones"] = stones
    o["frame"]["cleanup"] = stats
    return finish_layout(copy.deepcopy(m)), finish_layout(copy.deepcopy(o)), o, px


class Pipeline(unittest.TestCase):
    """layout() with BUILD_O is the BUILD_M layout through clean_up; with the build O flags off the
    report's new figures are neutral."""

    def test_build_o_equals_build_m_through_clean_up(self):
        _, o, _, _ = build_m_and_default("woman")
        real = support.layout_result("woman", BUILD_O)
        self.assertEqual(real["stones"], o["stones"])
        self.assertEqual((real["widthMm"], real["heightMm"]), (o["widthMm"], o["heightMm"]))
        drop = lambda r: {k: v for k, v in r.items() if k not in ("stagesMs", "ms")}
        self.assertEqual(drop(real["report"]), drop(o["report"]))
        self.assertIn("cleanup", real["report"]["stagesMs"])

    def test_flags_off_give_neutral_figures(self):
        m = support.layout_result("logo", BUILD_M)
        self.assertIsNone(support.frame_result("logo", BUILD_M)["frame"]["cleanup"])
        r = m["report"]
        self.assertEqual([r[k] for k in NEW_KEYS[:4]], [0, 0, 0.0, 0])
        self.assertEqual(r["cleanupCoverage"], r["coverage"])


class Images(unittest.TestCase):
    """BUILD_O against BUILD_M on the 13 RS test images (the acceptance figures of IMG-026O)."""

    def test_images(self):
        for name in IMAGES:
            with self.subTest(image=name):
                m, o, frame, px = build_m_and_default(name)
                rm, ro = m["report"], o["report"]
                # 0 gap violations after every step, the cleanup under 3 %, the natural size not larger.
                self.assertEqual(ro["violations"], 0)
                self.assertGreaterEqual(ro["minGapMm"], MIN_GAP_MM - 1e-6)
                self.assertLess(ro["removedShare"], 0.03)
                self.assertLessEqual(o["widthMm"], m["widthMm"] + 1e-9)
                self.assertLessEqual(o["heightMm"], m["heightMm"] + 1e-9)
                # No stone above SS16 except the pupils of one plausible pair, at SS20.
                pupils = {tuple(p) for p in ro["pupilsAtMm"]} if ro["face"] is not None and len(ro["pupilsAtMm"]) == 2 else set()
                for x, y, size, _ in o["stones"]:
                    if size in ("ss20", "ss30"):
                        self.assertEqual(size, "ss20")
                        self.assertIn((x, y), pupils)
                big = sum(1 for s in m["stones"] if s[2] in ("ss20", "ss30"))
                kept_ss20 = sum(1 for s in m["stones"] if s[2] == "ss20" and tuple(s[:2]) in pupils)
                self.assertEqual(ro["capped"], big - kept_ss20)
                # Every stone of BUILD_O is a BUILD_M stone (same frame position, size capped) or a fill.
                old = {(q["x"], q["y"]) for q in support.frame_result(name, BUILD_M)["stones"]}
                stones = frame["stones"]
                n_kept = len(stones) - ro["filled"]
                self.assertTrue(all((q["x"], q["y"]) in old for q in stones[:n_kept]))
                self.assertEqual(n_kept, rm["stones"] - ro["removed"])
                # No hole left where an SS4 fits.
                P, D = arrays(stones)
                self.assertEqual(find_holes(P, D, subject_mask(px.rgba[..., 3], frame["frame"]["mmPerPx"]), frame["frame"]["mmPerPx"]), [])
                # No lone fill stone: each shares its colour with a stone within 1 mm of its edge.
                for k in range(n_kept, len(stones)):
                    g = np.hypot(P[:, 0] - P[k, 0], P[:, 1] - P[k, 1]) - (D + D[k]) / 2
                    near = [stones[j]["color"] for j in np.nonzero(g < 1.0)[0] if j != k]
                    self.assertIn(stones[k]["color"], near, (name, k))
                print("ROW %s stones %d->%d capped %d removed %d (%.2f %%) filled %d coverage %.3f->%.3f size %.1fx%.1f->%.1fx%.1f" % (
                    name, rm["stones"], ro["stones"], ro["capped"], ro["removed"], 100 * ro["removedShare"], ro["filled"],
                    rm["cleanupCoverage"], ro["cleanupCoverage"], m["widthMm"], m["heightMm"], o["widthMm"], o["heightMm"]))

    def test_the_report_is_recomputed_from_the_returned_stones(self):
        for name in ("woman", "portrait"):
            with self.subTest(image=name):
                _, o, _, _ = build_m_and_default(name)
                r = o["report"]
                self.assertEqual(r["stones"], len(o["stones"]))
                by_size = {}
                for s in o["stones"]:
                    by_size[s[2]] = by_size.get(s[2], 0) + 1
                self.assertEqual(r["bySize"], by_size)
                self.assertEqual(r["minGapMm"], round(min_gap([stone(s[0], s[1], DIAMETERS[s[2]]) for s in o["stones"]]), 4))
                self.assertEqual(set(NEW_KEYS) <= set(r), True)


if __name__ == "__main__":
    unittest.main()
