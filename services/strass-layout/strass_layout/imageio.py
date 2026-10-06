"""PNG decoding. The only place pixels enter the package.

Both float views the prototype used are derived from one decoded RGBA array:
the float32 view of rs_fix.load (R.load) and the float64 composite on white of
landmarks.load_onwhite.
"""
import io

import numpy as np
from PIL import Image

from .errors import BadImage, NoAlpha

MIN_TRANSPARENT_SHARE = 0.01


class Pixels:
    """Decoded image: rgba (uint8), rgb and a (float32 in 0..1), onwhite (uint8)."""

    def __init__(self, rgba):
        self.rgba = rgba
        im = rgba.astype(np.float32) / 255
        self.rgb = im[..., :3]
        self.a = im[..., 3]
        self.height, self.width = self.a.shape
        im64 = rgba.astype(float) / 255
        self.onwhite = (np.clip(im64[..., :3] * im64[..., 3:] + (1 - im64[..., 3:]), 0, 1) * 255).astype(np.uint8)


def decode_png(png_bytes):
    try:
        img = Image.open(io.BytesIO(png_bytes))
        if img.format != "PNG":
            raise BadImage("The image is not a PNG.")
        rgba = np.array(img.convert("RGBA"))
    except BadImage:
        raise
    except Exception as exc:
        raise BadImage("The image could not be decoded as a PNG: " + str(exc)) from exc
    px = Pixels(rgba)
    if float((px.a <= 0.5).mean()) < MIN_TRANSPARENT_SHARE:
        raise NoAlpha("Fewer than 1 % of the pixels are transparent; the image needs a transparent background.")
    return px
