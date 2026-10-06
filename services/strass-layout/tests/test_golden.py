"""S5.2: every image meets the cross-machine tolerances against prototype/expected."""
import json
import unittest

from tests import support

COUNT_TOLERANCE = 0.01
COVERAGE_TOLERANCE = 0.03
MIN_GAP_MM = 0.1 - 1e-6


class Golden(unittest.TestCase):
    def test_images(self):
        for name in support.IMAGES:
            with self.subTest(image=name):
                result = support.layout_result(name)
                ref = support.expected(name)
                report = result["report"]
                n_exp = len(ref["stones"])
                cov_exp = ref["report"]["coverage"]
                n_diff = (report["stones"] - n_exp) / n_exp
                cov_diff = (report["coverage"] - cov_exp) / cov_exp
                print("ROW " + json.dumps({
                    "image": name, "stones": report["stones"], "expected": n_exp, "minGapMm": report["minGapMm"],
                    "violations": report["violations"], "coverage": report["coverage"], "expectedCoverage": round(cov_exp, 3),
                    "stonesDiffPct": round(100 * n_diff, 2), "coverageDiffPct": round(100 * cov_diff, 2),
                    "stagesMs": report["stagesMs"], "ms": report["ms"]}))
                self.assertEqual(report["violations"], 0)
                self.assertGreaterEqual(report["minGapMm"], MIN_GAP_MM)
                self.assertLessEqual(abs(n_diff), COUNT_TOLERANCE, "stone count %d vs expected %d" % (report["stones"], n_exp))
                self.assertLessEqual(abs(cov_diff), COVERAGE_TOLERANCE, "coverage %s vs expected %s" % (report["coverage"], cov_exp))


if __name__ == "__main__":
    unittest.main()
