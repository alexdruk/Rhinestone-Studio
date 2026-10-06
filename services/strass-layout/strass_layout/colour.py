"""The stone catalogue and colour snapping.

The catalogue is catalogue.json in this package (the 23 app colours plus the four
IMG-026 D2 colours). Its colour rules name specific ids, so it is owned here and
never taken from the caller. It is read once, at import.

Ported from rs_fix.py (stone_colours, snap_colours and the colour constants).
"""
import json
import os

import numpy as np
from skimage.color import deltaE_ciede2000, rgb2lab

with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "catalogue.json")) as _f:
    CAT = json.load(_f)
CAT_IDS = list(CAT)
CAT_LAB = rgb2lab(np.array([[int(CAT[k]["fill"][i:i + 2], 16) / 255 for i in (1, 3, 5)] for k in CAT_IDS])[None])[0]

KL = 1.0
KH = 1.0
CHROMA_W = 0.5


def stone_colours(rgb, a, det):
    """Median Lab colour under each detection [y, x, r, ...] (pixels)."""
    lab = rgb2lab(rgb)
    h, w = a.shape
    out = np.zeros((len(det), 3))
    for i, (y, x, r) in enumerate(det[:, :3]):
        R = max(2.0, 0.65 * r)
        y0, y1 = int(max(0, y - R)), int(min(h, y + R + 1))
        x0, x1 = int(max(0, x - R)), int(min(w, x + R + 1))
        yy, xx = np.mgrid[y0:y1, x0:x1]
        m = (np.hypot(yy - y, xx - x) <= R) & (a[y0:y1, x0:x1] > 0.5)
        px = lab[y0:y1, x0:x1][m]
        if len(px) < 3:
            m = np.hypot(yy - y, xx - x) <= R
            px = lab[y0:y1, x0:x1][m]
        L = px[:, 0]
        keep = L <= np.quantile(L, 0.85)
        px = px[keep] if keep.sum() >= 3 else px
        out[i] = np.median(px, 0)
    return out


def snap_colours(lab):
    """Nearest catalogue id for each Lab colour, with the prototype's skin and chroma rules."""
    lab = np.array(lab, float)
    d = np.stack([deltaE_ciede2000(lab, np.repeat(c[None], len(lab), 0), kL=KL, kH=KH) for c in CAT_LAB], 1)
    chroma = np.hypot(lab[:, 1], lab[:, 2])
    cat_ch = np.hypot(CAT_LAB[:, 1], CAT_LAB[:, 2])
    d[np.ix_(chroma >= 18, cat_ch < 8)] += 1000
    hue = np.degrees(np.arctan2(lab[:, 2], lab[:, 1])) % 360
    warm = (hue >= 25) & (hue <= 78) & (chroma < 65) & (chroma > 8)
    pen = CHROMA_W * np.maximum(0, 0.9 * chroma[:, None] - cat_ch[None, :])
    pen[warm] = 0
    d += pen
    for k_ in ("gold", "citrine", "peridot"):
        if k_ in CAT_IDS:
            d[(hue < 80) & (chroma > 8), CAT_IDS.index(k_)] += 1000
    if "topaz" in CAT_IDS:
        d[warm & (chroma < 50), CAT_IDS.index("topaz")] += 1000
    if "hyacinth" in CAT_IDS:
        d[chroma < 60, CAT_IDS.index("hyacinth")] += 1000
    k = d.argmin(1)
    return [CAT_IDS[i] for i in k], d[np.arange(len(lab)), k]
