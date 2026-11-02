"""IMG-026P: Black & white, read from the AI image.

Ported from PatternNifty (IS, commit e9e7014): src/pipeline/bw.js (mapBlackAndWhiteFromImage) and
holes.js (lightnessOnWhite); the rule is IS spec docs/IS-001-Spec.md 7.6 and docs/exp-holes.md
section 6. In RS it runs inside the service when the request's mode is "bw", after the size cap, the
overlap cleanup and the hole fill (cleanup.clean_up), so the service stays the one colour producer.

Every stone is read from the AI image at its delivered position: the mean CIE L* of the pixels
composited on white within the inner SAMPLE_SHARE (60 %) of its radius, at least 2 px. L* below the
threshold (default 55) is Jet, otherwise Crystal (id crystal-clear). The filled stones are not read:
they take Jet or Crystal from their neighbours by the hole fill's vote (cleanup.neighbour_vote), the
neighbours read as above. Positions and sizes never change. The colour stage's colours are not used.
"""
import numpy as np
from skimage.color import rgb2lab

from .cleanup import neighbour_vote
from .ordered import SAMPLE_SHARE

DEFAULT_BW_THRESHOLD = 55.0
BW_DARK = "jet"
BW_LIGHT = "crystal-clear"
BW_IDS = (BW_DARK, BW_LIGHT)
MIN_RADIUS_PX = 2


def lightness_on_white(rgba):
    """CIE L* (D65, as skimage's rgb2lab) of every pixel composited on white, unrounded."""
    im = rgba.astype(float) / 255
    return rgb2lab(im[..., :3] * im[..., 3:] + (1 - im[..., 3:]))[..., 0]


def stone_lightness(L, cx, cy, d_mm, s):
    """The mean of L over the pixels (pixel-index coordinates) within the inner SAMPLE_SHARE of a stone
    of diameter d_mm centred on AI pixel (cx, cy), at least MIN_RADIUS_PX of radius; a stone with no
    pixel there (beyond the image's edge) reads the nearest one."""
    h, w = L.shape
    radius = max(MIN_RADIUS_PX, SAMPLE_SHARE * 0.5 * d_mm / s)
    y0, y1 = max(0, int(np.floor(cy - radius))), min(h - 1, int(np.ceil(cy + radius)))
    x0, x1 = max(0, int(np.floor(cx - radius))), min(w - 1, int(np.ceil(cx + radius)))
    if y1 >= y0 and x1 >= x0:
        yy, xx = np.mgrid[y0:y1 + 1, x0:x1 + 1]
        inside = np.hypot(yy - cy, xx - cx) <= radius
        if inside.any():
            return float(L[y0:y1 + 1, x0:x1 + 1][inside].mean())
    x = int(round(min(max(cx, 0), w - 1)))
    y = int(round(min(max(cy, 0), h - 1)))
    return float(L[y, x])


def map_black_and_white(stones, rgba, s, voted=(), threshold=DEFAULT_BW_THRESHOLD):
    """The pipeline's stones {x, y, size, d, color} in frame mm (AI pixel = mm / s), each Jet or Crystal.
    voted: the indices of the filled stones, which take their neighbours' Jet or Crystal by the vote
    instead of being read. Returns new dicts; x, y, size and d are unchanged."""
    if not stones:
        return []
    L = lightness_on_white(rgba)
    targets = set(voted)
    read = [None if i in targets else (BW_DARK if stone_lightness(L, q["x"] / s, q["y"] / s, q["d"], s) < threshold else BW_LIGHT)
            for i, q in enumerate(stones)]
    if targets:
        P = np.array([[q["x"], q["y"]] for q in stones])
        D = np.array([q["d"] for q in stones])
        for i, c in neighbour_vote(P, D, read, sorted(targets)).items():
            read[i] = c
        # Only when no stone at all was read (every stone filled) is a filled stone read itself.
        read = [c if c is not None else (BW_DARK if stone_lightness(L, q["x"] / s, q["y"] / s, q["d"], s) < threshold else BW_LIGHT)
                for q, c in zip(stones, read)]
    return [dict(q, color=c) for q, c in zip(stones, read)]
