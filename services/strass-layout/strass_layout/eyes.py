"""Pupil detection and eye stones.

find_pupils is pupils2.find: dark, round, highlighted blobs that look like pupils.
build_eye_copy is the prototype's EYE_MODE=copy eye: one pupil stone, one SS4
crystal catch-light beside it and, for animals, two SS4 iris rings.
"""
import cv2
import numpy as np
from scipy import ndimage as ndi

from .geometry import GAP, SS4

GAPX = GAP + 0.035
PUPIL_SIZES = (6.4, 4.7, 4.0, 2.8, 2.0)


def find_pupils(px, s, main_px):
    out = []
    for thr in (25, 16, 10):
        for c in _find_thr(px, s, main_px, thr):
            if all(np.hypot(c["x"] - o["x"], c["y"] - o["y"]) > main_px * 2 for o in out):
                out.append(c)
    return out


def _find_thr(px, s, main_px, thr):
    rgb, a = px.rgb, px.a
    w = np.clip(rgb * a[..., None] + (1 - a[..., None]), 0, 1)
    LAB = cv2.cvtColor((w * 255).astype(np.uint8), cv2.COLOR_RGB2LAB).astype(float)
    L = LAB[..., 0] / 2.55
    CH = np.hypot(LAB[..., 1] - 128, LAB[..., 2] - 128)
    dark = ndi.binary_opening((L < thr) & (a > 0.5), iterations=2)
    lab, n = ndi.label(dark)
    out = []
    for i, sl in enumerate(ndi.find_objects(lab), 1):
        if sl is None:
            continue
        m = lab[sl] == i
        A = m.sum()
        if 2 * np.sqrt(A / np.pi) < 1.2 * main_px:
            continue
        pad = int(main_px)
        y0, x0 = max(0, sl[0].start - pad), max(0, sl[1].start - pad)
        y1, x1 = min(L.shape[0], sl[0].stop + pad), min(L.shape[1], sl[1].stop + pad)
        mm = (lab[y0:y1, x0:x1] == i).astype(np.uint8)
        cnts, _ = cv2.findContours(mm, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        hull = cv2.convexHull(np.vstack(cnts))
        hm = np.zeros_like(mm)
        cv2.fillPoly(hm, [hull], 1)
        Ah = hm.sum()
        (cx, cy), rad = cv2.minEnclosingCircle(hull)
        De = 2 * np.sqrt(Ah / np.pi)
        if De < 1.7 * main_px or De > 7 * main_px:
            continue
        roundness = Ah / (np.pi * rad * rad)
        if roundness < 0.72:
            continue
        hl = (L[y0:y1, x0:x1] > 85) & (CH[y0:y1, x0:x1] < 18) & ndi.binary_dilation(hm.astype(bool), iterations=2)
        if hl.sum() < 0.01 * Ah:
            continue
        hy, hx = np.nonzero(hl)
        if np.hypot(hx.mean() - cx, hy.mean() - cy) > 0.5 * De:
            continue
        rr = []
        for a_ in np.linspace(0, 2 * np.pi, 48, endpoint=False):
            for t_ in range(1, int(4 * De)):
                xx_ = int(cx + x0 + t_ * np.cos(a_))
                yy_ = int(cy + y0 + t_ * np.sin(a_))
                if not (0 <= xx_ < L.shape[1] and 0 <= yy_ < L.shape[0]):
                    break
                if L[yy_, xx_] > 45 and np.hypot(xx_ - hx.mean() - x0, yy_ - hy.mean() - y0) > 0.25 * De:
                    rr.append(t_)
                    break
        Dr = 2 * np.median(rr) if rr else De
        out.append(dict(x=float(cx + x0), y=float(cy + y0), diam_mm=float(max(De, Dr) * s), roundness=float(roundness),
                        hx=float(hx.mean() + x0), hy=float(hy.mean() + y0)))
    return out


def _ok(x, y, d, skip):
    return all(np.hypot(x - sx, y - sy) >= (d + sd) / 2 + GAPX - 1e-6 for sx, sy, sd in skip)


def _ring(cx, cy, r, d, skip, phase=0.0):
    n = max(3, int(np.floor(2 * np.pi * r / (d + GAPX))))
    out = []
    for k in range(n):
        a = 2 * np.pi * (k + phase) / n
        x, y = cx + r * np.cos(a), cy + r * np.sin(a)
        if _ok(x, y, d, skip):
            out.append((x, y, d))
            skip.append((x, y, d))
    return out


def build_eye_copy(c, s, iris=False, n_rings=2):
    """Stones of one eye: tuples (x, y, d, colour or None, colour-sample point or None), and the eye zone (ox, oy, radius)."""
    Dp = c["diam_mm"]
    R0 = Dp / 2
    ox, oy = c["x"] * s, c["y"] * s
    ang = np.arctan2(c["hy"] * s - oy, c["hx"] * s - ox)
    dp = next((z for z in PUPIL_SIZES if z <= Dp + 0.3), SS4)
    stones = [(ox, oy, dp, "jet", None)]
    rr = dp / 2 + GAPX + SS4 / 2
    hx, hy = ox + rr * np.cos(ang), oy + rr * np.sin(ang)
    stones.append((hx, hy, SS4, "crystal-clear", None))
    if iris:
        skip = [(x, y, d) for x, y, d, _, _ in stones]
        r = dp / 2 + GAPX + SS4 / 2
        for k in range(n_rings):
            for x, y, d in _ring(ox, oy, r, SS4, skip, phase=0.5 * (k % 2)):
                a_ = np.arctan2(y - oy, x - ox)
                rs = max(R0, dp / 2) + 0.35 + 0.9 * k
                stones.append((x, y, d, None, (ox + rs * np.cos(a_), oy + rs * np.sin(a_))))
            r += SS4 + GAPX
    radius = max(np.hypot(x - ox, y - oy) + d / 2 for x, y, d, _, _ in stones)
    return stones, (ox, oy, radius)
