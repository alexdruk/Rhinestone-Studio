"""S1 to S3: the report recomputed from the returned stones equals the returned report."""
import unittest

import numpy as np
from scipy.spatial import cKDTree

from strass_layout.geometry import holes
from strass_layout.pipeline import RESULT_VERSION
from tests import support

DIAMETERS = {"ss4": 1.5, "ss6": 2.0, "ss10": 2.8, "ss16": 4.0, "ss20": 4.7, "ss30": 6.4}


def pair_gaps(P, D):
    pairs = cKDTree(P).query_pairs(float(D.max()) + 0.2, output_type="ndarray")
    return np.linalg.norm(P[pairs[:, 0]] - P[pairs[:, 1]], axis=1) - (D[pairs[:, 0]] + D[pairs[:, 1]]) / 2


class Report(unittest.TestCase):
    def check_image(self, name):
        raw = support.frame_result(name)
        frame = raw["frame"]
        result = support.layout_result(name)
        report = result["report"]
        stones = result["stones"]
        self.assertEqual(result["version"], RESULT_VERSION)

        D = np.array([DIAMETERS[s[2]] for s in stones])
        P = np.array([[s[0], s[1]] for s in stones])
        self.assertEqual(report["stones"], len(stones))
        self.assertEqual(report["stones"], len(raw["stones"]))

        by_size = {}
        by_colour = {}
        for _, _, size, colour in stones:
            by_size[size] = by_size.get(size, 0) + 1
            by_colour[colour] = by_colour.get(colour, 0) + 1
        self.assertEqual(report["bySize"], by_size)
        self.assertEqual(report["colours"], by_colour)

        gaps = pair_gaps(P, D)
        self.assertEqual(report["minGapMm"], round(float(gaps.min()), 4))
        self.assertEqual(report["violations"], int((gaps < 0.1 - 1e-6).sum()))

        off_x, off_y = report["offsetMm"]
        for (x, y, size, colour), q in zip(stones, raw["stones"]):
            self.assertEqual(round(x + off_x, 3), q["x"])
            self.assertEqual(round(y + off_y, 3), q["y"])
            self.assertEqual((size, colour), (q["size"], q["color"]))
        self.assertEqual(min(P[:, 0] - D / 2).round(3), 0.0)
        self.assertEqual(min(P[:, 1] - D / 2).round(3), 0.0)
        self.assertAlmostEqual(result["widthMm"], float((P[:, 0] + D / 2).max()), places=3)
        self.assertAlmostEqual(result["heightMm"], float((P[:, 1] + D / 2).max()), places=3)

        Pf = np.array([[q["x"], q["y"]] for q in raw["stones"]])
        hmax, cover = holes(Pf, D, frame["mask"], frame["mmPerPx"])
        self.assertEqual(report["coverage"], round(float(cover), 3))
        self.assertEqual(report["largestEmptyCircleMm"], round(float(hmax), 3))
        self.assertEqual(report["frameMm"], round(frame["widthMm"], 3))
        self.assertEqual(sum(report["stagesMs"].values()) <= report["ms"] + 5, True)


def _make(name):
    def test(self):
        self.check_image(name)
    return test


for _name in support.IMAGES:
    setattr(Report, "test_" + _name, _make(_name))


if __name__ == "__main__":
    unittest.main()
