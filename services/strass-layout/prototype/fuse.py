from pathcfg import W as _W
import sys
import numpy as np, cv2
from PIL import Image
from scipy import ndimage as ndi
from scipy.spatial import cKDTree


def grads(name, sigma=1.0):
    im = np.array(Image.open(f'{_W}img/{name}.png').convert('RGBA')).astype(np.float32) / 255
    rgb, a = im[..., :3], im[..., 3]
    w = rgb * a[..., None] + (1 - a[..., None])
    lab = cv2.cvtColor(w, cv2.COLOR_RGB2LAB)
    chans = [lab[..., 0] / 100, lab[..., 1] / 100, lab[..., 2] / 100, a]
    G = []
    for c in chans:
        c = ndi.gaussian_filter(c, sigma)
        G.append((ndi.sobel(c, 1) / 8, ndi.sobel(c, 0) / 8))
    return G, a


def circle_score(G, ys, xs, rs, n=36):
    th = np.linspace(0, 2 * np.pi, n, endpoint=False)
    ct, st = np.cos(th), np.sin(th)
    h, w = G[0][0].shape
    px = xs[:, None] + rs[:, None] * ct[None]
    py = ys[:, None] + rs[:, None] * st[None]
    pxi = np.clip(np.round(px).astype(int), 0, w - 1)
    pyi = np.clip(np.round(py).astype(int), 0, h - 1)
    e2 = 0
    for gx, gy in G:
        proj = gx[pyi, pxi] * ct[None] + gy[pyi, pxi] * st[None]
        e2 = e2 + proj ** 2
    e = np.sqrt(e2)
    med = np.median(e, 1)
    mean = e.mean(1)
    cover = (e > 0.02).mean(1)
    return 0.5 * (med + mean) * cover, med, cover


def refine(G, c, steps=(0.8, 0.9, 1.0, 1.1, 1.2), shifts=(-1, 0, 1)):
    best = None
    for f in steps:
        for dy in shifts:
            for dx in shifts:
                s, _, _ = circle_score(G, c[:, 0] + dy, c[:, 1] + dx, c[:, 2] * f)
                if best is None:
                    best = (s, c[:, 0] + dy, c[:, 1] + dx, c[:, 2] * f)
                else:
                    k = s > best[0]
                    best = (np.where(k, s, best[0]), np.where(k, c[:, 0] + dy, best[1]), np.where(k, c[:, 1] + dx, best[2]), np.where(k, c[:, 2] * f, best[3]))
    return np.stack([best[1], best[2], best[3], best[0]], 1)


def fuse(G, a, cands, rmin, rmax, smin, mind=0.8):
    c = cands[(cands[:, 2] >= rmin) & (cands[:, 2] <= rmax)]
    c = c[a[np.clip(c[:, 0].astype(int), 0, a.shape[0] - 1), np.clip(c[:, 1].astype(int), 0, a.shape[1] - 1)] > 0.25]
    c = refine(G, c)
    c = c[c[:, 3] >= smin]
    order = np.argsort(-c[:, 3])
    c = c[order]
    t = cKDTree(c[:, :2])
    alive = np.ones(len(c), bool)
    rmx = c[:, 2].max()
    for i in range(len(c)):
        if not alive[i]:
            continue
        for j in t.query_ball_point(c[i, :2], mind * (c[i, 2] + rmx)):
            if j > i and alive[j] and np.hypot(*(c[i, :2] - c[j, :2])) < mind * (c[i, 2] + c[j, 2]):
                alive[j] = False
    return c[alive]


def drop_small(c, frac=0.62, k=7):
    t = cKDTree(c[:, :2])
    d, idx = t.query(c[:, :2], k + 1)
    locr = np.median(c[idx[:, 1:], 2], 1)
    return c[c[:, 2] >= frac * locr]
