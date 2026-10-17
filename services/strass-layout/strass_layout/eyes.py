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


def find_pupils(px, s, main_px, core_only=False, inscribed=False):
    """Pupil candidates. With core_only (Rules.pupil_core_only) a pupil is the dark blob itself,
    not the dark blob plus a dark iris around it. With inscribed (Rules.pupil_inscribed) a pupil
    that touches other dark stones is also found, as the largest dark disc around a highlight;
    those candidates carry inscribed=True."""
    out = []
    for thr in (25, 16, 10):
        for c in _find_thr(px, s, main_px, thr, core_only):
            if all(np.hypot(c["x"] - o["x"], c["y"] - o["y"]) > main_px * 2 for o in out):
                out.append(c)
    if inscribed:
        out += _find_inscribed(px, s, main_px, out)
    return out


def _find_inscribed(px, s, main_px, existing):
    """Dark discs of radius at least 0.75 main_px, with small holes (a highlight and its rim)
    filled, that hold a highlight near their centre. The diameter is capped at 2.4 main_px."""
    rgb, a = px.rgb, px.a
    w = np.clip(rgb * a[..., None] + (1 - a[..., None]), 0, 1)
    LAB = cv2.cvtColor((w * 255).astype(np.uint8), cv2.COLOR_RGB2LAB).astype(float)
    L = LAB[..., 0] / 2.55
    CH = np.hypot(LAB[..., 1] - 128, LAB[..., 2] - 128)
    hl = (L > 85) & (CH < 18) & (a > 0.5)
    out = []
    for thr in (25, 16):
        dark = (L < thr) & (a > 0.5)
        holes = ndi.binary_fill_holes(dark) & ~dark
        hlab, nh = ndi.label(holes)
        small = np.zeros(nh + 1, bool)
        small[1:] = ndi.sum(holes, hlab, range(1, nh + 1)) < np.pi * (0.9 * main_px) ** 2
        filled = ndi.binary_opening(dark | small[hlab], iterations=1)
        dt = ndi.distance_transform_edt(filled)
        peak = (dt == ndi.maximum_filter(dt, size=max(3, int(main_px)))) & (dt >= 0.75 * main_px)
        ys, xs = np.nonzero(peak)
        for k in np.argsort(-dt[ys, xs]):
            y, x, r = int(ys[k]), int(xs[k]), float(dt[ys[k], xs[k]])
            if any(np.hypot(x - c["x"], y - c["y"]) < 2 * main_px for c in list(existing) + out):
                continue
            y0, x0 = max(0, y - int(r)), max(0, x - int(r))
            yy, xx = np.mgrid[y0:y + int(r) + 1, x0:x + int(r) + 1]
            inside = np.hypot(yy - y, xx - x) <= r
            h = hl[yy, xx] & inside
            n_in = inside.sum()
            if h.sum() < 0.02 * n_in or h.sum() > 0.35 * n_in:
                continue
            if ((L[yy, xx] < thr) & inside).sum() < 0.5 * n_in:
                continue
            hy, hx = np.nonzero(h)
            hx, hy = hx.mean() + x0, hy.mean() + y0
            if np.hypot(hx - x, hy - y) > 0.6 * r:
                continue
            out.append(dict(x=float(x), y=float(y), diam_mm=float(min(2 * r, 2.4 * main_px) * s), roundness=1.0,
                            hx=float(hx), hy=float(hy), inscribed=True))
    return out


def _find_thr(px, s, main_px, thr, core_only=False):
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
        for a_ in ([] if core_only else np.linspace(0, 2 * np.pi, 48, endpoint=False)):
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


UP_RIGHT = -np.pi / 4


def glint_angles(cands, Lab, a, human):
    """Set c["ang"], the direction of each pupil's catch-light. It points at the highlight pixels
    (L > 85, chroma < 18) inside 0.8 of the pupil radius, so the white of the eye around it is not
    counted; a pupil without one, or whose highlight points down, takes up and right. A person's
    two pupils share one direction, the mean of the ones measured. The direction is kept between
    30 and 150 degrees above the horizontal, where the AI draws the highlight."""
    L = Lab[..., 0].astype(float) / 2.55
    ch = np.hypot(Lab[..., 1].astype(float) - 128, Lab[..., 2].astype(float) - 128)
    hl = (L > 85) & (ch < 18) & (a > 0.5)
    h, w = hl.shape
    vec = []
    for c in cands:
        r = 0.8 * c["r_px"]
        x0, x1 = int(max(0, c["x"] - r)), int(min(w, c["x"] + r + 1))
        y0, y1 = int(max(0, c["y"] - r)), int(min(h, c["y"] + r + 1))
        if x1 <= x0 or y1 <= y0:
            vec.append(None)
            continue
        yy, xx = np.mgrid[y0:y1, x0:x1]
        m = hl[y0:y1, x0:x1] & (np.hypot(xx - c["x"], yy - c["y"]) <= r)
        if m.any():
            v = np.array([xx[m].mean() - c["x"], yy[m].mean() - c["y"]])
            n = np.hypot(*v)
            vec.append(v / n if n > 1e-6 and v[1] <= 0.25 * n else None)
        else:
            vec.append(None)
    if human and len(cands) == 2:
        got = [v for v in vec if v is not None]
        m = np.mean(got, 0) if got else None
        vec = [m, m]
    for c, v in zip(cands, vec):
        ang = float(np.arctan2(v[1], v[0])) if v is not None and np.hypot(*v) > 1e-6 else UP_RIGHT
        c["ang"] = float(np.clip(ang, -5 * np.pi / 6, -np.pi / 6))


def build_eye_copy(c, s, iris=False, n_rings=2):
    """Stones of one eye: tuples (x, y, d, colour or None, colour-sample point or None), and the eye zone (ox, oy, radius).
    The catch-light goes in the direction c["ang"] when glint_angles() set it."""
    Dp = c["diam_mm"]
    R0 = Dp / 2
    ox, oy = c["x"] * s, c["y"] * s
    ang = c["ang"] if "ang" in c else np.arctan2(c["hy"] * s - oy, c["hx"] * s - ox)
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
