import numpy as np, cv2
from scipy import ndimage as ndi
import rs_fix as R

SIZES = [6.4, 4.7, 4.0, 2.8]


def find(name, s, main_px):
    out = []
    for thr in (25, 16, 10):
        for c in find_thr(name, s, main_px, thr):
            if all(np.hypot(c['x'] - o['x'], c['y'] - o['y']) > main_px * 2 for o in out):
                out.append(c)
    return out


def find_thr(name, s, main_px, thr):
    rgb, a = R.load(name)
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
        hm = np.zeros_like(mm); cv2.fillPoly(hm, [hull], 1)
        Ah = hm.sum(); (cx, cy), rad = cv2.minEnclosingCircle(hull)
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
                xx_ = int(cx + x0 + t_ * np.cos(a_)); yy_ = int(cy + y0 + t_ * np.sin(a_))
                if not (0 <= xx_ < L.shape[1] and 0 <= yy_ < L.shape[0]): break
                if L[yy_, xx_] > 45 and np.hypot(xx_ - hx.mean() - x0, yy_ - hy.mean() - y0) > 0.25 * De:
                    rr.append(t_); break
        Dr = 2 * np.median(rr) if rr else De
        out.append(dict(x=float(cx + x0), y=float(cy + y0), diam_mm=float(max(De, Dr) * s), roundness=float(roundness),
                        hx=float(hx.mean() + x0), hy=float(hy.mean() + y0)))
    return out


def stones(cands, s):
    pre = []
    for c in cands:
        D = c['diam_mm']
        d = next((z for z in SIZES if z <= D - 0.2), None)
        if d is None:
            continue
        cd = R.SS6 if d >= 4.0 else R.SS4
        cx, cy = c['x'] * s, c['y'] * s
        ang = np.arctan2(c['hy'] * s - cy, c['hx'] * s - cx)
        shift = max(0.0, (d + R.GAP + cd) / 2 - (D / 2 - cd / 2))
        shift = min(shift, (D - d) / 2 + 0.3)
        px, py = cx - shift * np.cos(ang), cy - shift * np.sin(ang)
        rr = d / 2 + R.GAP + 0.02 + cd / 2
        pre.append((px, py, d, 'jet'))
        pre.append((px + rr * np.cos(ang), py + rr * np.sin(ang), cd, 'crystal-clear'))
    return pre
