"""The stone catalogue and colour snapping.

The catalogue is catalogue.json in this package (the 23 app colours, the four
IMG-026 D2 colours and the twelve IMG-026F colours marked "aiOnly"). Its colour
rules name specific ids, so it is owned here and never taken from the caller. It
is read once, at import.

BASE is the palette without the aiOnly colours (the prototype's 27); FULL has all
of them. Rules.extra_colours picks FULL.

IMG-026G re-measured some fills from the supplier catalogue; such an entry keeps the
old value as "prototypeFill". BASE and FULL match against the old values, so the
prototype and builds E and F are unchanged; BASE_REAL and FULL_REAL use "fill".
Rules.real_colours picks the REAL palettes.

IMG-026H added eight more aiOnly colours, marked "aiSet": "H" (EXTRA_H_IDS). Only
PLUS_REAL, which Rules.more_colours picks, has them.

IMG-026I: PLUS_REAL_SKIN is PLUS_REAL with Indian Siam blocked for warm skin and fur tones of
hue 30 degrees or more (its own fill is at 27); build H gave Einstein's brown skin hundreds of
dark red stones. Rules.skin_no_wine picks it.

Ported from rs_fix.py (stone_colours, snap_colours and the colour constants).
"""
import json
import os

import numpy as np
from skimage.color import deltaE_ciede2000, rgb2lab

with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "catalogue.json")) as _f:
    CAT = json.load(_f)
CAT_IDS = list(CAT)
EXTRA_IDS = [k for k in CAT_IDS if CAT[k].get("aiOnly") and CAT[k].get("aiSet") != "H"]
EXTRA_H_IDS = [k for k in CAT_IDS if CAT[k].get("aiSet") == "H"]
ALL_EXTRA_IDS = EXTRA_IDS + EXTRA_H_IDS


class Palette:
    """Catalogue ids and their Lab colours, in catalogue order."""

    def __init__(self, ids, real=False, warm_block=()):
        self.ids = list(ids)
        self.warm_block = tuple(warm_block)
        self.fills = [CAT[k]["fill"] if real else CAT[k].get("prototypeFill", CAT[k]["fill"]) for k in self.ids]
        self.lab = rgb2lab(np.array([[int(f[i:i + 2], 16) / 255 for i in (1, 3, 5)] for f in self.fills])[None])[0]
        self.real = real


BASE = Palette([k for k in CAT_IDS if k not in ALL_EXTRA_IDS])
FULL = Palette([k for k in CAT_IDS if k not in EXTRA_H_IDS])
BASE_REAL = Palette(BASE.ids, real=True)
FULL_REAL = Palette(FULL.ids, real=True)
PLUS_REAL = Palette(CAT_IDS, real=True)
PLUS_REAL_SKIN = Palette(CAT_IDS, real=True, warm_block=("indian-siam",))
CAT_LAB = BASE.lab


def palette(rules):
    if rules.more_colours:
        return PLUS_REAL_SKIN if rules.skin_no_wine else PLUS_REAL
    if rules.real_colours:
        return FULL_REAL if rules.extra_colours else BASE_REAL
    return FULL if rules.extra_colours else BASE


KL = 1.0
KH = 1.0
CHROMA_W = 0.5


def stone_colours(rgb, a, det, mean=False):
    """Lab colour under each detection [y, x, r, ...] (pixels): the median of the darker 85 % of
    the core, or with mean (Rules.mean_colour) the mean of the whole disc of radius r."""
    lab = rgb2lab(rgb)
    h, w = a.shape
    out = np.zeros((len(det), 3))
    for i, (y, x, r) in enumerate(det[:, :3]):
        R = max(2.0, 0.65 * r)
        RW = max(R, r) if mean else R
        y0, y1 = int(max(0, y - RW)), int(min(h, y + RW + 1))
        x0, x1 = int(max(0, x - RW)), int(min(w, x + RW + 1))
        yy, xx = np.mgrid[y0:y1, x0:x1]
        if mean:
            m2 = (np.hypot(yy - y, xx - x) <= max(2.0, r)) & (a[y0:y1, x0:x1] > 0.5)
            if m2.sum() >= 3:
                out[i] = lab[y0:y1, x0:x1][m2].mean(0)
                continue
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


def snap_colours(lab, pal=BASE):
    """Nearest catalogue id for each Lab colour, with the prototype's skin and chroma rules."""
    ids, cat = pal.ids, pal.lab
    lab = np.array(lab, float)
    d = np.stack([deltaE_ciede2000(lab, np.repeat(c[None], len(lab), 0), kL=KL, kH=KH) for c in cat], 1)
    chroma = np.hypot(lab[:, 1], lab[:, 2])
    cat_ch = np.hypot(cat[:, 1], cat[:, 2])
    d[np.ix_(chroma >= 18, cat_ch < 8)] += 1000
    hue = np.degrees(np.arctan2(lab[:, 2], lab[:, 1])) % 360
    warm = (hue >= 25) & (hue <= 78) & (chroma < 65) & (chroma > 8)
    pen = CHROMA_W * np.maximum(0, 0.9 * chroma[:, None] - cat_ch[None, :])
    pen[warm] = 0
    d += pen
    if pal.real:
        d[np.ix_(warm, cat_ch < 8)] += 1000
    for k_ in ("gold", "citrine", "peridot"):
        if k_ in ids:
            d[(hue < 80) & (chroma > 8), ids.index(k_)] += 1000
    if "topaz" in ids:
        d[warm & (chroma < 50), ids.index("topaz")] += 1000
    for k_ in pal.warm_block:
        d[warm & (hue >= 30), ids.index(k_)] += 1000
    if "hyacinth" in ids:
        d[chroma < 60, ids.index("hyacinth")] += 1000
    k = d.argmin(1)
    return [ids[i] for i in k], d[np.arange(len(lab)), k]
