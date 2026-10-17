"""IMG-023 reference prototype: turn an AI rhinestone picture into a real SS6 stone template.

This file is the reference the JavaScript build is checked against. It is not app code.

Steps
1. Find every stone the AI drew from its white highlight dot (top-hat on L*, low saturation,
   L* > 150, blob of 1-60 px). Merge dots closer than 0.55 x pitch. Pitch = median nearest-
   neighbour distance, ignoring distances below 0.6 x the median of the 2nd-6th neighbours.
   Each dot sits up-left of its stone's centre: centre = dot + (0.30, 0.35) x pitch / 2.
   Stones without a visible dot are added from peaks of the distance transform of the non-gap
   area (gap = black-hat on L* in the top 25%), when no dot-stone is within 0.7 x pitch.
2. Each AI stone's colour = median CIE Lab of the pixels in a disc of radius 0.33 x pitch around
   its centre, keeping only pixels between the 15th and 60th percentile of L* (drops the
   highlight and the dark gaps).
3. Palette: up to 8 catalogue colours chosen greedily to minimise the summed colour error over
   all AI stones (not by frequency), so small distinct areas such as red lips survive.
   Colour distance is weighted Lab: L* x 0.5, a*, b* x 1.
4. Scale: one AI stone pitch = one real pitch (stone size + gap, 2.3 mm for SS6 / 0.3 mm), times
   an optional shrink (0.8 = 80 %).
5. Real stones on the staggered hex grid. Each real stone takes the inverse-distance-weighted
   mean Lab of its 3 nearest AI stones (weights 1 / (d + 0.3 mm)) and is matched to the palette,
   except: if the weighted share of Jet-like AI stones (L* < 30 and chroma < 15) is >= 0.4, the
   stone is Jet. A grid point is kept when it lies on the subject (alpha > 128) and its nearest
   AI stone is closer than 0.8 x pitch.

Usage: python3 ai_stone_transfer_reference.py image.png [shrink] [out.json]
Needs numpy, opencv-python, scipy, scikit-image, pillow.
"""
import json, sys
import numpy as np, cv2
from PIL import Image
from scipy.spatial import cKDTree
from skimage.feature import peak_local_max

CATALOGUE = [
    ('crystal-clear', '#f5f5f5'), ('crystal', '#e9f7ff'), ('jet', '#141414'), ('siam', '#9b1c1c'),
    ('light-siam', '#d9534f'), ('rose', '#ef8fb0'), ('fuchsia', '#c2185b'), ('amethyst', '#7e3f98'),
    ('sapphire', '#2269d3'), ('light-sapphire', '#6fa8dc'), ('aquamarine', '#3fc1b0'), ('emerald', '#2aa66a'),
    ('peridot', '#b5cc18'), ('topaz', '#e08e26'), ('citrine', '#f2c94c'), ('gold', '#f3bd32'),
    ('silver', '#d8dde4'), ('hematite', '#3e3f44'), ('black-diamond', '#6b6b72'), ('grey', '#9a9ca2'),
    ('smoked-topaz', '#6e4a2e'), ('light-colorado', '#b98a5c'), ('light-peach', '#eec6a4'),
]
JET = [c[0] for c in CATALOGUE].index('jet')
LW = np.array([0.5, 1.0, 1.0])

def rgb2lab(rgb):
    a = np.asarray(rgb, np.float64) / 255.0
    a = np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)
    M = np.array([[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.0721750], [0.0193339, 0.1191920, 0.9503041]])
    xyz = a @ M.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)

CAT_LAB = rgb2lab(np.array([[int(h[i:i + 2], 16) for i in (1, 3, 5)] for _, h in CATALOGUE]))

def highlights(rgba):
    rgb = rgba[..., :3]
    L = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB)[..., 0].astype(np.float32)
    th = cv2.morphologyEx(L, cv2.MORPH_TOPHAT, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    spot = (th > 40) & (hsv[..., 1] < 110) & (L > 150) & (rgba[..., 3] > 128)
    n, lab, st, cen = cv2.connectedComponentsWithStats(spot.astype(np.uint8), connectivity=8)
    return np.array([(cen[i][0], cen[i][1], st[i, cv2.CC_STAT_AREA]) for i in range(1, n) if 1 <= st[i, cv2.CC_STAT_AREA] <= 60])

def detect(rgba):
    H = highlights(rgba)
    P = H[:, :2]
    d, _ = cKDTree(P).query(P, k=7)
    rough = float(np.median(d[:, 2:7]))
    pitch = float(np.median(d[:, 1][d[:, 1] > 0.6 * rough]))
    t0 = cKDTree(P); taken = np.zeros(len(P), bool); merged = []
    for i in np.argsort(-H[:, 2]):
        if taken[i]: continue
        grp = [j for j in t0.query_ball_point(P[i], r=0.55 * pitch) if not taken[j]]
        taken[grp] = True; w = H[grp, 2]
        merged.append((P[grp] * w[:, None]).sum(0) / w.sum())
    P = np.array(merged) + np.array([0.30, 0.35]) * pitch / 2
    L = cv2.cvtColor(rgba[..., :3], cv2.COLOR_RGB2LAB)[..., 0].astype(np.float32)
    kk = max(5, int(pitch * 0.6) | 1)
    bth = cv2.GaussianBlur(cv2.morphologyEx(L, cv2.MORPH_BLACKHAT, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kk, kk))), (3, 3), 0.7)
    msk = rgba[..., 3] > 128
    body = (bth <= np.percentile(bth[msk], 75)) & msk
    dt = cv2.distanceTransform(body.astype(np.uint8), cv2.DIST_L2, 5)
    pk = peak_local_max(cv2.GaussianBlur(dt, (0, 0), 1.0), min_distance=max(3, int(pitch * 0.45)), threshold_abs=pitch * 0.2, labels=msk.astype(int), exclude_border=False)
    V = pk[:, ::-1].astype(float)
    dv, _ = cKDTree(P).query(V)
    return np.vstack([P, V[dv > 0.7 * pitch]]), pitch

def stone_lab(rgb, alpha, x, y, r):
    h, w = alpha.shape; rr = max(2, int(round(r)))
    x0, x1 = max(0, int(x) - rr), min(w, int(x) + rr + 1); y0, y1 = max(0, int(y) - rr), min(h, int(y) + rr + 1)
    yy, xx = np.mgrid[y0:y1, x0:x1]
    disc = ((xx - x) ** 2 + (yy - y) ** 2 <= rr * rr) & (alpha[y0:y1, x0:x1] > 128)
    p = rgb[y0:y1, x0:x1][disc].astype(np.float64)
    if len(p) < 3: return np.zeros(3)
    lab = rgb2lab(p)
    lo, hi = np.percentile(lab[:, 0], [15, 60])
    sel = (lab[:, 0] >= lo) & (lab[:, 0] <= hi)
    return np.median(lab[sel] if sel.sum() >= 3 else lab, 0)

def palette(labs, cap=8):
    D = np.linalg.norm((labs[:, None] - CAT_LAB[None]) * LW, axis=-1)
    keep = []; cur = np.full(len(labs), 1e9)
    for _ in range(cap):
        gain = (cur[:, None] - np.minimum(cur[:, None], D)).sum(0)
        gain[keep] = -1
        k = int(gain.argmax())
        if gain[k] <= 0: break
        keep.append(k); cur = np.minimum(cur, D[:, k])
    return np.array(sorted(keep))

def hexgrid(Wm, Hm, pitch_mm):
    rowh = pitch_mm * np.sqrt(3) / 2
    pts = []; j = 0; y = 0.0
    while y < Hm:
        x = pitch_mm / 2 if j % 2 else 0.0
        while x < Wm:
            pts.append((x, y)); x += pitch_mm
        y += rowh; j += 1
    return np.array(pts)

def transfer(path, shrink=1.0, stone_mm=2.0, gap_mm=0.3):
    rgba = np.array(Image.open(path).convert('RGBA'))
    rgb, alpha = rgba[..., :3], rgba[..., 3]
    Hpx, Wpx = alpha.shape
    C, pitch = detect(rgba)
    labs = np.array([stone_lab(rgb, alpha, x, y, pitch * 0.33) for x, y in C])
    keep = palette(labs)
    isjet = (labs[:, 0] < 30) & (np.hypot(labs[:, 1], labs[:, 2]) < 15)
    pitch_mm = stone_mm + gap_mm
    s = pitch_mm / (pitch / shrink)
    P = hexgrid(Wpx * s, Hpx * s, pitch_mm)
    d, nn = cKDTree(C * s).query(P, k=3)
    on = alpha[np.clip((P[:, 1] / s).astype(int), 0, Hpx - 1), np.clip((P[:, 0] / s).astype(int), 0, Wpx - 1)] > 128
    inside = on & (d[:, 0] < 0.8 * pitch_mm)
    P, d, nn = P[inside], d[inside], nn[inside]
    w = 1 / (d + 0.3)
    target = (labs[nn] * w[..., None]).sum(1) / w.sum(1)[:, None]
    jetv = (isjet[nn] * w).sum(1) / w.sum(1) >= 0.4
    cols = keep[np.linalg.norm((target[:, None] - CAT_LAB[keep][None]) * LW, axis=-1).argmin(1)]
    cols[jetv] = JET
    ys, xs = np.nonzero(alpha > 128)
    counts = {}
    for c in cols: counts[CATALOGUE[c][0]] = counts.get(CATALOGUE[c][0], 0) + 1
    return dict(ai_stones=int(len(C)), ai_pitch_px=round(pitch, 3), mm_per_px=round(s, 5),
                width_mm=round((xs.max() - xs.min()) * s, 1), height_mm=round((ys.max() - ys.min()) * s, 1),
                palette=[CATALOGUE[k][0] for k in keep], total=int(len(P)),
                colours=dict(sorted(counts.items(), key=lambda kv: -kv[1])),
                stones=[[round(float(x), 3), round(float(y), 3), CATALOGUE[c][0]] for (x, y), c in zip(P, cols)])

if __name__ == '__main__':
    out = transfer(sys.argv[1], float(sys.argv[2]) if len(sys.argv) > 2 else 1.0)
    if len(sys.argv) > 3:
        json.dump(out, open(sys.argv[3], 'w'))
    print(json.dumps({k: v for k, v in out.items() if k != 'stones'}))
