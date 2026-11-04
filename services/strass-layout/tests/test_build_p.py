"""IMG-026P: Black & white read from the AI image, ported from PatternNifty (IS) at e9e7014.

See docs/specifications/IMG-026-StrassLayoutService.md, "Black & white (build P)", and
docs/IS-PORT-PLAN.md section 3.6. The synthetic cases follow IS's rule (spec 7.6, src/pipeline/bw.js
mapBlackAndWhiteFromImage and holes.js lightnessOnWhite); the image case runs the woman (14 filled
stones) through layout() in mode "bw".
"""
import copy
import unittest
from unittest import mock

import numpy as np
from fastapi.testclient import TestClient

import app as service
from strass_layout import DEFAULT, CatalogueMismatch, layout
from strass_layout.bw import BW_IDS, DEFAULT_BW_THRESHOLD, lightness_on_white, map_black_and_white, stone_lightness
from strass_layout.pipeline import finish_layout, layout_frame
from strass_layout.post import SIZE_KEYS
from tests import support

S = 0.1  # mm per px


def stone(x, y, d=2.0, colour="gold"):
    return {"x": x, "y": y, "size": SIZE_KEYS[d], "d": d, "color": colour}


def flat(size, rgb, alpha=255):
    rgba = np.zeros((size, size, 4), np.uint8)
    rgba[..., :3] = rgb
    rgba[..., 3] = alpha
    return rgba


def grey_with_lightness(target):
    """The 8-bit grey whose L* is nearest to target, and that L*."""
    greys = np.arange(256, dtype=np.uint8)
    L = lightness_on_white(np.stack([greys, greys, greys, np.full(256, 255, np.uint8)], 1)[None])[0]
    g = int(np.argmin(np.abs(L - target)))
    return g, float(L[g])


class Reading(unittest.TestCase):
    def test_lightness_is_composited_on_white(self):
        # Transparent black reads as white paper; half-transparent black as mid grey.
        self.assertAlmostEqual(float(lightness_on_white(flat(4, (0, 0, 0), 0))[0, 0]), 100.0, 4)
        self.assertAlmostEqual(float(lightness_on_white(flat(4, (255, 255, 255), 255))[0, 0]), 100.0, 4)
        half = float(lightness_on_white(flat(4, (0, 0, 0), 128))[0, 0])
        grey = float(lightness_on_white(flat(4, (127, 127, 127), 255))[0, 0])
        self.assertAlmostEqual(half, grey, 0)
        self.assertLess(float(lightness_on_white(flat(4, (0, 0, 0), 255))[0, 0]), 1e-6)

    def test_the_threshold_is_55_by_default_and_below_it_is_jet(self):
        self.assertEqual(DEFAULT_BW_THRESHOLD, 55)
        self.assertEqual(BW_IDS, ("jet", "crystal-clear"))
        dark, l_dark = grey_with_lightness(54.5)
        light, l_light = grey_with_lightness(55.5)
        self.assertLess(l_dark, 55)
        self.assertGreaterEqual(l_light, 55)
        for g, want in ((dark, "jet"), (light, "crystal-clear")):
            out = map_black_and_white([stone(5, 5)], flat(100, (g, g, g)), S)
            self.assertEqual(out[0]["color"], want, g)
        # Another threshold moves the break.
        self.assertEqual(map_black_and_white([stone(5, 5)], flat(100, (dark, dark, dark)), S, threshold=50)[0]["color"], "crystal-clear")

    def test_only_the_inner_60_percent_of_the_radius_is_read(self):
        # SS6 at the centre (50, 50 px): radius 10 px, inner 60 % = 6 px.
        yy, xx = np.mgrid[0:100, 0:100]
        r = np.hypot(yy - 50, xx - 50)
        ring_dark = flat(100, (255, 255, 255))
        ring_dark[(r > 6.5) & (r <= 10)] = (0, 0, 0, 255)
        core_dark = flat(100, (255, 255, 255))
        core_dark[r <= 6] = (0, 0, 0, 255)
        self.assertEqual(map_black_and_white([stone(5, 5)], ring_dark, S)[0]["color"], "crystal-clear")
        self.assertEqual(map_black_and_white([stone(5, 5)], core_dark, S)[0]["color"], "jet")
        L = lightness_on_white(core_dark)
        self.assertAlmostEqual(stone_lightness(L, 50, 50, 2.0, S), float(L[r <= 6].mean()))

    def test_a_small_stone_reads_at_least_2_px(self):
        # SS4 at 0.5 mm/px: 60 % of its radius is 0.9 px, so the 2 px minimum decides. Only the centre
        # pixel is white; the pixels within 2 px around it are black.
        rgba = flat(20, (0, 0, 0))
        rgba[10, 10] = (255, 255, 255, 255)
        self.assertEqual(map_black_and_white([stone(5, 5, 1.5)], rgba, 0.5)[0]["color"], "jet")
        L = lightness_on_white(rgba)
        yy, xx = np.mgrid[0:20, 0:20]
        self.assertAlmostEqual(stone_lightness(L, 10, 10, 1.5, 0.5), float(L[np.hypot(yy - 10, xx - 10) <= 2].mean()))

    def test_a_stone_past_the_image_edge_reads_the_nearest_pixel(self):
        rgba = flat(10, (255, 255, 255))
        rgba[9, 9] = (0, 0, 0, 255)
        L = lightness_on_white(rgba)
        self.assertAlmostEqual(stone_lightness(L, 30, 30, 2.0, S), float(L[9, 9]))


class Mapping(unittest.TestCase):
    def setUp(self):
        # A white image with one black disc around (50, 50) px; SS6 stones 2.2 mm apart in a row.
        yy, xx = np.mgrid[0:100, 0:300]
        self.rgba = np.zeros((100, 300, 4), np.uint8)
        self.rgba[...] = (255, 255, 255, 255)
        self.rgba[np.hypot(yy - 50, xx - 50) <= 12] = (0, 0, 0, 255)
        self.stones = [stone(5 + 2.2 * k, 5, 2.0, c) for k, c in enumerate(["gold", "jet", "scarlet", "crystal-clear", "grey"])]

    def test_positions_and_sizes_never_change_and_only_jet_and_crystal_come_out(self):
        before = copy.deepcopy(self.stones)
        out = map_black_and_white(self.stones, self.rgba, S)
        self.assertEqual(self.stones, before, "the input is not changed")
        self.assertEqual([(q["x"], q["y"], q["size"], q["d"]) for q in out], [(q["x"], q["y"], q["size"], q["d"]) for q in before])
        self.assertEqual([q["color"] for q in out], ["jet", "crystal-clear", "crystal-clear", "crystal-clear", "crystal-clear"])
        self.assertLessEqual({q["color"] for q in out}, set(BW_IDS))

    def test_the_service_colour_is_not_used(self):
        # The first stone is "gold" and the second "jet" in the colour stage; the AI image decides.
        out = map_black_and_white(self.stones, self.rgba, S)
        self.assertEqual((out[0]["color"], out[1]["color"]), ("jet", "crystal-clear"))

    def test_filled_stones_are_not_read_but_take_the_vote(self):
        # A filled SS4 sits on the black disc between white-read stones: read, it would be Jet; by the
        # vote of its neighbours it is Crystal. Stones 2.2 mm apart, the fill 1.0 mm from stone 1's edge.
        stones = [stone(3.0, 5.0), stone(7.0, 5.0), stone(5.0, 2.8), stone(5.0, 7.2), stone(5.0, 5.0, 1.5)]
        rgba = np.zeros((100, 100, 4), np.uint8)
        rgba[...] = (255, 255, 255, 255)
        yy, xx = np.mgrid[0:100, 0:100]
        rgba[np.hypot(yy - 50, xx - 50) <= 7] = (0, 0, 0, 255)
        read = map_black_and_white(stones, rgba, S)
        voted = map_black_and_white(stones, rgba, S, voted=[4])
        self.assertEqual(read[4]["color"], "jet")
        self.assertEqual(voted[4]["color"], "crystal-clear")
        self.assertEqual([q["color"] for q in voted[:4]], [q["color"] for q in read[:4]])

    def test_the_vote_counts_only_read_stones_weighted_by_gap(self):
        # Two Jet-read neighbours close to the fill outweigh one Crystal-read neighbour farther away.
        rgba = flat(200, (255, 255, 255))
        yy, xx = np.mgrid[0:200, 0:200]
        for cx in (30, 70):
            rgba[np.hypot(yy - 50, xx - cx) <= 9] = (0, 0, 0, 255)
        stones = [stone(3.0, 5.0), stone(7.0, 5.0), stone(5.0, 7.4), stone(5.0, 5.0, 1.5)]
        out = map_black_and_white(stones, rgba, S, voted=[3])
        self.assertEqual([q["color"] for q in out[:3]], ["jet", "jet", "crystal-clear"])
        self.assertEqual(out[3]["color"], "jet")

    def test_no_stones(self):
        self.assertEqual(map_black_and_white([], self.rgba, S), [])


class Pipeline(unittest.TestCase):
    """layout() in mode "bw" on the woman: the DEFAULT layout with every colour read from the AI image."""

    @classmethod
    def setUpClass(cls):
        cls.colour = support.frame_result("woman", DEFAULT)
        cls.bw = layout_frame(support.png_bytes("woman"), 2.1, None, DEFAULT, "bw")

    def test_positions_and_sizes_equal_the_colour_layout(self):
        self.assertEqual([(q["x"], q["y"], q["size"], q["d"]) for q in self.bw["stones"]],
                         [(q["x"], q["y"], q["size"], q["d"]) for q in self.colour["stones"]])
        self.assertEqual(self.bw["frame"]["cleanup"], self.colour["frame"]["cleanup"])

    def test_only_jet_and_crystal_and_the_filled_stones_by_vote(self):
        filled = self.colour["frame"]["cleanup"]["filled"]
        self.assertGreater(filled, 0)
        stones = self.colour["stones"]
        from strass_layout.imageio import decode_png
        px = decode_png(support.png_bytes("woman"))
        s = self.colour["frame"]["mmPerPx"]
        want = map_black_and_white(stones, px.rgba, s, range(len(stones) - filled, len(stones)))
        self.assertEqual([q["color"] for q in self.bw["stones"]], [q["color"] for q in want])
        self.assertEqual({q["color"] for q in self.bw["stones"]}, set(BW_IDS))
        report = finish_layout(copy.deepcopy(self.bw))["report"]
        self.assertEqual(set(report["colours"]), set(BW_IDS))
        self.assertEqual(sum(report["colours"].values()), len(stones))
        self.assertEqual(report["violations"], 0)
        print("ROW woman bw: %d stones, %s, %d filled" % (len(stones), report["colours"], filled))

    def test_an_unknown_mode_is_refused(self):
        with self.assertRaises(ValueError):
            layout(support.png_bytes("logo"), None, 2.1, None, DEFAULT, "grey")

    def test_black_and_white_needs_only_jet_and_crystal(self):
        from strass_layout.pipeline import check_colour_ids
        check_colour_ids(["jet", "crystal-clear"], "bw")
        with self.assertRaises(CatalogueMismatch):
            check_colour_ids(["jet"], "bw")
        with self.assertRaises(CatalogueMismatch):
            check_colour_ids(["jet", "crystal-clear"], "colour")
        with self.assertRaises(CatalogueMismatch):
            layout(support.png_bytes("logo"), ["crystal-clear"], 2.1, None, DEFAULT, "bw")


class Http(unittest.TestCase):
    """POST /layout carries the mode; the threshold is the BW_THRESHOLD setting."""

    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(service.app)
        cls.client.__enter__()

    @classmethod
    def tearDownClass(cls):
        cls.client.__exit__(None, None, None)

    def post(self, options):
        import json
        return self.client.post("/layout", files={"image": ("a.png", support.png_bytes("logo"), "image/png")},
                                data={"options": json.dumps(options)})

    def test_the_mode_and_threshold_reach_layout(self):
        calls = []

        def fake(data, color_ids, pitch, **kw):
            calls.append((color_ids, pitch, kw))
            return {"version": 1, "widthMm": 1, "heightMm": 1, "stones": [], "report": {}}

        with mock.patch.object(service, "layout", fake):
            self.assertEqual(self.post({"colorIds": ["jet", "crystal-clear"], "targetPitchMm": 2.1, "mode": "bw"}).status_code, 200)
            self.assertEqual(self.post({"colorIds": ["jet"], "targetPitchMm": 2.1}).status_code, 200)
            with mock.patch.object(service, "BW_THRESHOLD", 50.0):
                self.post({"mode": "colour"})
        self.assertEqual(calls[0], (["jet", "crystal-clear"], 2.1, {"mode": "bw", "bw_threshold": 55.0}))
        self.assertEqual(calls[1][2]["mode"], "colour", "a request without a mode is colour")
        self.assertEqual(calls[2][2], {"mode": "colour", "bw_threshold": 50.0})

    def test_an_unknown_mode_is_a_400(self):
        for mode in ("grey", 1, None, ["bw"]):
            r = self.post({"mode": mode})
            self.assertEqual((r.status_code, r.json()["error"]), (400, "bad-request"), mode)

    def test_black_and_white_with_a_missing_colour_is_a_catalogue_mismatch(self):
        r = self.post({"colorIds": ["jet"], "targetPitchMm": 2.1, "mode": "bw"})
        self.assertEqual((r.status_code, r.json()["error"]), (422, "catalogue-mismatch"))
        self.assertIn("crystal-clear", r.json()["message"])

    def test_the_threshold_setting(self):
        self.assertEqual(service.bw_threshold_setting({}), 55)
        self.assertEqual(service.bw_threshold_setting({"BW_THRESHOLD": " "}), 55)
        self.assertEqual(service.bw_threshold_setting({"BW_THRESHOLD": "50"}), 50.0)
        for bad in ("0", "100", "nan", "dark"):
            with self.assertRaises(ValueError):
                service.bw_threshold_setting({"BW_THRESHOLD": bad})


if __name__ == "__main__":
    unittest.main()
