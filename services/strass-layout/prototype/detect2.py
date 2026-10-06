from pathcfg import W as _W
import sys
import numpy as np, cv2
from PIL import Image
from scipy import ndimage as ndi
from scipy.spatial import cKDTree


def load(name):
    im = np.array(Image.open(f'{_W}img/{name}.png').convert('RGBA')).astype(np.float32) / 255
    rgb, a = im[..., :3], im[..., 3]
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB)
    return rgb, a, lab


def blob_energy(chans, sigmas):
    E = []
    for s in sigmas:
        e = 0
        for c, wgt in chans:
            l = s * s * ndi.gaussian_laplace(c, s)
            e = e + wgt * l * l
        E.append(np.sqrt(e))
    return np.stack(E)


def nms(pts, score, mind):
    order = np.argsort(-score)
    pts = pts[order]; score = score[order]
    t = cKDTree(pts[:, :2])
    alive = np.ones(len(pts), bool)
    for i in range(len(pts)):
        if not alive[i]:
            continue
        for j in t.query_ball_point(pts[i, :2], mind * 2 * pts[:, 2].max()):
            if j > i and alive[j] and np.hypot(*(pts[i, :2] - pts[j, :2])) < mind * (pts[i, 2] + pts[j, 2]):
                alive[j] = False
    return pts[alive], score[alive]


def detect(name, rmin=4, rmax=14, mind=0.8, q=0.5):
    rgb, a, lab = load(name)
    L = lab[..., 0] / 100 * a + (1 - a) * 1.0
    A = lab[..., 1] / 100 * a
    B = lab[..., 2] / 100 * a
    chans = [(L, 1.0), (A, 1.0), (B, 1.0), (a, 1.0)]
    radii = np.arange(rmin, rmax + 0.01, 0.5)
    sig = radii / np.sqrt(2)
    E = blob_energy(chans, sig)
    best = E.max(0); arg = E.argmax(0)
    mx = ndi.maximum_filter(E, size=(3, 5, 5))
    pk = (E == mx) & (E > np.quantile(best[a > 0.3], q))
    s, ys, xs = np.nonzero(pk)
    ok = a[ys, xs] > 0.25
    s, ys, xs = s[ok], ys[ok], xs[ok]
    pts = np.stack([ys, xs, radii[s]], 1).astype(float)
    sc = E[s, ys, xs]
    pts, sc = nms(pts, sc, mind)
    return pts, sc


if __name__ == '__main__':
    name = sys.argv[1]
    pts, sc = detect(name)
    np.save(f'{name}_log.npy', pts)
    print(name, len(pts), 'median r', np.median(pts[:, 2]), np.percentile(pts[:, 2], [10, 90]))
