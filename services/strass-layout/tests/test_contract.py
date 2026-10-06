"""The HTTP contract of POST /layout and GET /health, and the shape of the layout() answer."""
import io
import json
import unittest

from fastapi.testclient import TestClient
from PIL import Image

import app as service
from strass_layout import layout
from strass_layout.colour import CAT_IDS
from tests import support

SIZE_IDS = {"ss4", "ss6", "ss10", "ss16", "ss20", "ss30"}
REPORT_KEYS = {"stones", "bySize", "colours", "minGapMm", "violations", "coverage", "largestEmptyCircleMm", "face",
               "pupilsMm", "frameMm", "offsetMm", "mmPerPx", "stagesMs", "ms"}
STAGES = {"detect", "layout", "eyes", "colour", "check"}
EDGE_TOLERANCE_MM = 0.001


def post(client, data, colour_ids=None, filename="image.png", content_type="image/png"):
    options = {"colorIds": CAT_IDS if colour_ids is None else colour_ids, "targetPitchMm": 2.1}
    return client.post("/layout", files={"image": (filename, data, content_type)}, data={"options": json.dumps(options)})


def image_bytes(fmt, mode="RGBA", size=(64, 64), colour=(200, 30, 30, 255)):
    buf = io.BytesIO()
    Image.new(mode, size, colour).save(buf, fmt)
    return buf.getvalue()


class Contract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(service.app)
        cls.client.__enter__()

    @classmethod
    def tearDownClass(cls):
        cls.client.__exit__(None, None, None)

    def test_health(self):
        r = self.client.get("/health")
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(set(body), {"ok", "modelsLoaded", "version", "busy"})
        self.assertIs(body["ok"], True)
        self.assertIs(body["modelsLoaded"], True)
        self.assertIsInstance(body["version"], str)
        self.assertIs(body["busy"], False)

    def test_response_shape(self):
        r = post(self.client, support.png_bytes("logo"))
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(set(body), {"version", "widthMm", "heightMm", "stones", "report"})
        self.assertEqual(body["version"], 1)
        self.assertGreater(body["widthMm"], 0)
        self.assertGreater(body["heightMm"], 0)
        self.assertEqual(set(body["report"]), REPORT_KEYS)
        self.assertEqual(set(body["report"]["stagesMs"]), STAGES)
        self.assertEqual(body["report"]["stones"], len(body["stones"]))
        diameters = {"ss4": 1.5, "ss6": 2.0, "ss10": 2.8, "ss16": 4.0, "ss20": 4.7, "ss30": 6.4}
        for x, y, size, colour in body["stones"]:
            self.assertIn(size, SIZE_IDS)
            self.assertIn(colour, CAT_IDS)
            d = diameters[size]
            self.assertGreaterEqual(x - d / 2, -EDGE_TOLERANCE_MM)
            self.assertGreaterEqual(y - d / 2, -EDGE_TOLERANCE_MM)
            self.assertLessEqual(x + d / 2, body["widthMm"] + EDGE_TOLERANCE_MM)
            self.assertLessEqual(y + d / 2, body["heightMm"] + EDGE_TOLERANCE_MM)
        direct = support.layout_result("logo")
        self.assertEqual(body["stones"], direct["stones"])
        self.assertEqual((body["widthMm"], body["heightMm"]), (direct["widthMm"], direct["heightMm"]))

    def test_catalogue_mismatch(self):
        r = post(self.client, support.png_bytes("logo"), colour_ids=CAT_IDS[:-1])
        self.assertEqual(r.status_code, 422)
        self.assertEqual(r.json()["error"], "catalogue-mismatch")
        self.assertIn(CAT_IDS[-1], r.json()["message"])

    def test_jpeg_is_bad_image(self):
        r = post(self.client, image_bytes("JPEG", "RGB", colour=(200, 30, 30)), filename="image.jpg", content_type="image/jpeg")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(set(r.json()), {"error", "message"})
        self.assertEqual(r.json()["error"], "bad-image")

    def test_garbage_is_bad_image(self):
        r = post(self.client, b"not an image at all")
        self.assertEqual((r.status_code, r.json()["error"]), (400, "bad-image"))

    def test_opaque_png_has_no_alpha(self):
        r = post(self.client, image_bytes("PNG", "RGBA", (256, 256), (200, 30, 30, 255)))
        self.assertEqual((r.status_code, r.json()["error"]), (400, "no-alpha"))

    def test_too_large(self):
        r = post(self.client, b"\0" * (service.MAX_IMAGE_BYTES + 1))
        self.assertEqual((r.status_code, r.json()["error"]), (413, "too-large"))

    def test_missing_image(self):
        r = self.client.post("/layout", data={"options": "{}"})
        self.assertEqual((r.status_code, r.json()["error"]), (400, "bad-request"))

    def test_bad_options(self):
        r = self.client.post("/layout", files={"image": ("a.png", support.png_bytes("logo"), "image/png")},
                             data={"options": "{not json"})
        self.assertEqual((r.status_code, r.json()["error"]), (400, "bad-request"))

    def test_layout_function_checks_ids_before_running(self):
        from strass_layout import CatalogueMismatch
        with self.assertRaises(CatalogueMismatch):
            layout(support.png_bytes("logo"), CAT_IDS[1:])


if __name__ == "__main__":
    unittest.main()
