from pathcfg import W as _W
import sys, json
import numpy as np, cv2
from PIL import Image
from scipy import ndimage as ndi


def load(name):
    im = np.array(Image.open(f'{_W}img/{name}.png').convert('RGBA')).astype(np.float32) / 255
    rgb, a = im[..., :3], im[..., 3]
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB)
    return rgb, a, lab


def grad_field(lab, a, sigma=1.0):
    chans = [lab[..., 0] / 100, lab[..., 1] / 100, lab[..., 2] / 100, a]
    gx = np.zeros_like(a); gy = np.zeros_like(a); gx2 = np.zeros_like(a); gy2 = np.zeros_like(a); gxy = np.zeros_like(a)
    for c in chans:
        c = ndi.gaussian_filter(c, sigma)
        x = ndi.sobel(c, 1); y = ndi.sobel(c, 0)
        gx2 += x * x; gy2 += y * y; gxy += x * y
    tr = gx2 + gy2
    det = gx2 * gy2 - gxy * gxy
    lam = tr / 2 + np.sqrt(np.maximum(tr * tr / 4 - det, 0))
    ang = 0.5 * np.arctan2(2 * gxy, gx2 - gy2)
    mag = np.sqrt(lam)
    return mag, np.cos(ang), np.sin(ang)


def frst(mag, ux, uy, radii, thr_q=0.6, alpha=2.0):
    h, w = mag.shape
    thr = np.quantile(mag[mag > 0], thr_q)
    ys, xs = np.nonzero(mag > thr)
    m = mag[ys, xs]; dx = ux[ys, xs]; dy = uy[ys, xs]
    out = []
    for r in radii:
        O = np.zeros((h, w), np.float32); M = np.zeros((h, w), np.float32)
        for s in (1, -1):
            px = np.clip(np.round(xs + s * dx * r).astype(int), 0, w - 1)
            py = np.clip(np.round(ys + s * dy * r).astype(int), 0, h - 1)
            np.add.at(O, (py, px), 1)
            np.add.at(M, (py, px), m)
        k = 9.9 if r > 1 else 8
        Oc = np.minimum(O, k)
        F = (M / k) * (np.abs(Oc) / k) ** alpha
        S = ndi.gaussian_filter(F, 0.25 * r)
        out.append(S * r)
    return np.stack(out)


def detect(name, radii=None, mind=0.75):
    rgb, a, lab = load(name)
    mag, ux, uy = grad_field(lab, a)
    if radii is None:
        radii = list(range(4, 19))
    S = frst(mag, ux, uy, radii)
    best = S.max(0); arg = S.argmax(0)
    rr = np.array(radii)[arg]
    pk = (best == ndi.maximum_filter(best, size=7)) & (best > np.quantile(best, 0.80)) & (a > 0.3)
    ys, xs = np.nonzero(pk)
    order = np.argsort(-best[ys, xs])
    ys, xs = ys[order], xs[order]
    keep = []
    occ = np.zeros(a.shape, np.int32) - 1
    pts = []
    for y, x in zip(ys, xs):
        r = rr[y, x]
        ok = True
        for (yy, xx, r2) in pts[-0:]:
            pass
        pts.append((y, x, r))
    pts = np.array(pts, float)
    from scipy.spatial import cKDTree
    t = cKDTree(pts[:, :2])
    alive = np.ones(len(pts), bool)
    for i in range(len(pts)):
        if not alive[i]:
            continue
        for j in t.query_ball_point(pts[i, :2], mind * 2 * pts[i, 2]):
            if j > i and alive[j] and np.hypot(*(pts[i, :2] - pts[j, :2])) < mind * (pts[i, 2] + pts[j, 2]):
                alive[j] = False
    pts = pts[alive]
    return pts, best, rr


if __name__ == '__main__':
    name = sys.argv[1]
    pts, best, rr = detect(name)
    np.save(f'{name}_frst.npy', pts)
    print(name, len(pts), 'median r', np.median(pts[:, 2]))
