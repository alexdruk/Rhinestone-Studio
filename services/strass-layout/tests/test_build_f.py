"""IMG-026F: the BUILD_F rules (extra colours, mean colour, human iris, eye stones kept) against BUILD_E.

See docs/specifications/IMG-026-StrassLayoutService.md, "Colour and eyes (build F)" and the
Build F acceptance figures. The look figure is computed here: the mean CIE76 distance between the
AI image and a render of the stones, both blurred by half a pitch, over the subject.
"""
import json
import os
import unittest

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi
from skimage.color import rgb2lab

from strass_layout import BUILD_E, BUILD_F, PROTOTYPE, distinct
from strass_layout.colour import BASE, CAT, CAT_IDS, EXTRA_IDS, FULL, palette, snap_colours, stone_colours
from strass_layout.imageio import decode_png
from tests import support

IMAGES = support.IMAGES + ["sunburst_flower"]
HUMAN_IMAGES = ["woman", "einstein", "portrait"]
EXTRA = ["golden-shadow", "copper", "rose-gold", "vintage-rose", "padparadscha", "chrysolite", "fern-green",
         "erinite", "olivine", "khaki", "metallic-sunshine", "jet-hematite"]
DARK = {"jet", "hematite", "black-diamond", "smoked-topaz", "jet-hematite"}
MIN_GAP_MM = 0.1 - 1e-6


def hex_rgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def look(name, frame):
    px = decode_png(support.png_bytes(name))
    s = frame["frame"]["mmPerPx"]
    pitch_px = 2.1 / s
    ref = px.onwhite / 255.0
    img = Image.new("RGB", (px.width, px.height), (255, 255, 255))
    draw = ImageDraw.Draw(img)
    for q in frame["stones"]:
        x, y, r = q["x"] / s, q["y"] / s, q["d"] / s / 2
        draw.ellipse([x - r, y - r, x + r, y + r], fill=hex_rgb(CAT[q["color"]].get("prototypeFill", CAT[q["color"]]["fill"])))
    out = np.asarray(img).astype(float) / 255.0
    sigma = 0.5 * pitch_px
    region = ndi.binary_dilation(px.a > 0.5, iterations=int(pitch_px))
    blur = lambda im: np.stack([ndi.gaussian_filter(im[..., k], sigma) for k in range(3)], -1)
    de = np.sqrt(((rgb2lab(blur(ref)) - rgb2lab(blur(out))) ** 2).sum(-1))
    return float(de[region].mean())


def iris_stones(frame):
    """SS4 stones that are neither dark nor Crystal, within the first two rings around a large jet pupil."""
    stones = frame["stones"]
    pupils = [(q["x"], q["y"], q["d"]) for q in stones if q["color"] == "jet" and q["d"] >= 2.8]
    count = 0
    for px_, py_, pd in pupils:
        for q in stones:
            d = np.hypot(q["x"] - px_, q["y"] - py_)
            if q["d"] == 1.5 and q["color"] not in DARK and q["color"] != "crystal-clear" and pd / 2 < d < pd / 2 + 3.4:
                count += 1
    return count


class Palettes(unittest.TestCase):
    def test_catalogue_split(self):
        self.assertEqual(EXTRA_IDS, EXTRA)
        self.assertEqual(len(CAT_IDS), 39)
        self.assertEqual(BASE.ids, [k for k in CAT_IDS if k not in EXTRA])
        self.assertEqual(FULL.ids, CAT_IDS)
        self.assertIs(palette(PROTOTYPE), BASE)
        self.assertIs(palette(BUILD_E), BASE)
        self.assertIs(palette(BUILD_F), FULL)

    def test_base_never_snaps_to_an_extra_colour(self):
        lab = FULL.lab[[FULL.ids.index(k) for k in EXTRA]]
        base_ids, _ = snap_colours(lab, BASE)
        self.assertFalse(set(base_ids) & set(EXTRA))
        full_ids, _ = snap_colours(lab, FULL)
        self.assertGreaterEqual(len(set(full_ids) & set(EXTRA)), 10)


class MeanColour(unittest.TestCase):
    def test_mean_reads_the_whole_stone(self):
        size = 60
        rgb = np.ones((size, size, 3), np.float32)
        a = np.zeros((size, size), np.float32)
        yy, xx = np.mgrid[0:size, 0:size]
        disc = np.hypot(yy - 30, xx - 30) <= 12
        a[disc] = 1.0
        rgb[disc] = (0.75, 0.5, 0.35)
        spot = np.hypot(yy - 26, xx - 26) <= 4
        rgb[spot & disc] = (1.0, 1.0, 1.0)
        det = np.array([[30.0, 30.0, 12.0, 0.0]])
        median_rule = stone_colours(rgb, a, det)[0]
        mean_rule = stone_colours(rgb, a, det, True)[0]
        lab = rgb2lab(rgb)
        expected = lab[(np.hypot(yy - 30, xx - 30) <= 12) & (a > 0.5)].mean(0)
        self.assertLess(np.abs(mean_rule - expected).max(), 1e-6)
        self.assertGreater(mean_rule[0], median_rule[0] + 2.0)


class DistinctAlternates(unittest.TestCase):
    def scene(self):
        jet = FULL.lab[FULL.ids.index("jet")]
        rng = np.random.default_rng(1)
        lab = np.r_[np.repeat(jet[None], 300, 0) + rng.normal(0, 0.5, (300, 3)),
                    np.repeat((jet + np.array([7.38, -15.56, -5.99]))[None], 200, 0) + rng.normal(0, 0.5, (200, 3))]
        ids, _ = snap_colours(lab, FULL)
        return ids, lab, np.zeros(len(lab), bool)

    def test_an_extra_colour_is_never_an_alternate(self):
        ids, lab, prot = self.scene()
        out, _ = distinct._distinct(ids, lab, prot, pal=FULL)
        self.assertNotIn("jet-hematite", out)
        saved = distinct.EXTRA_IDS
        distinct.EXTRA_IDS = []
        try:
            unguarded, _ = distinct._distinct(ids, lab, prot, pal=FULL)
        finally:
            distinct.EXTRA_IDS = saved
        self.assertIn("jet-hematite", unguarded, "without the guard the scene must pick jet-hematite as an alternate")


class DefaultAgainstBuildE(unittest.TestCase):
    def test_images(self):
        looks_e, looks_f, uses_extra = [], [], 0
        for name in IMAGES:
            with self.subTest(image=name):
                e = support.layout_result(name, BUILD_E)["report"]
                f = support.layout_result(name, BUILD_F)["report"]
                self.assertEqual(f["violations"], 0)
                self.assertGreaterEqual(f["minGapMm"], MIN_GAP_MM)
                self.assertLessEqual(abs(f["stones"] - e["stones"]), 0.01 * e["stones"])
                self.assertLessEqual(abs(f["coverage"] - e["coverage"]), 0.01)
                self.assertEqual(f["pupilsMm"], e["pupilsMm"])
                self.assertEqual(f["face"], e["face"])
                self.assertTrue(set(f["colours"]) <= set(CAT_IDS))
                self.assertFalse(set(e["colours"]) & set(EXTRA))
                self.assertFalse(set(support.layout_result(name, PROTOTYPE)["report"]["colours"]) & set(EXTRA))
            uses_extra += bool(set(f["colours"]) & set(EXTRA))
            frame_e = support.frame_result(name, BUILD_E)
            frame_f = support.frame_result(name, BUILD_F)
            looks_e.append(look(name, frame_e))
            looks_f.append(look(name, frame_f))
            print("ROW %s stones %d->%d look %.2f->%.2f extra %s" % (
                name, e["stones"], f["stones"], looks_e[-1], looks_f[-1],
                sorted(set(f["colours"]) & set(EXTRA))))
            self.assertLessEqual(looks_f[-1], looks_e[-1] + 1.6)
        print("MEAN look %.3f->%.3f images using extra colours %d" % (np.mean(looks_e), np.mean(looks_f), uses_extra))
        self.assertLess(np.mean(looks_f), np.mean(looks_e) - 0.25)
        self.assertGreaterEqual(uses_extra, 8)

    def test_human_iris(self):
        for name in HUMAN_IMAGES:
            with self.subTest(image=name):
                e = iris_stones(support.frame_result(name, BUILD_E))
                f = iris_stones(support.frame_result(name, BUILD_F))
                print("IRIS %s %d->%d" % (name, e, f))
                self.assertGreater(f, e)


if __name__ == "__main__":
    unittest.main()
