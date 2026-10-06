"""Detection stages: radial symmetry (frst), Laplacian of Gaussian blobs (blobs),
StarDist candidates, watershed, and the fusion of all of them into one stone
list [y, x, r, score] in pixels.

Ported from prototype detect.py, detect2.py, sdens.py, wshed.py, fuse.py and
runfuse.py. Each stage takes arrays and returns arrays; nothing touches disk.
"""
import cv2
import numpy as np
from scipy import ndimage as ndi
from scipy.spatial import cKDTree
from skimage.measure import regionprops
from skimage.morphology import h_maxima
from skimage.segmentation import watershed

STARDIST_SCALE = 2.0
STARDIST_VIEW_INDEX = {"Lw": 0, "alpha": 3}
STARDIST_MIN_PROB = 0.3
FUSE_SMIN = 0.03
FUSE_MIND = 0.8


def _grad_field(lab, a, sigma=1.0):
    chans = [lab[..., 0] / 100, lab[..., 1] / 100, lab[..., 2] / 100, a]
    gx2 = np.zeros_like(a)
    gy2 = np.zeros_like(a)
    gxy = np.zeros_like(a)
    for c in chans:
        c = ndi.gaussian_filter(c, sigma)
        x = ndi.sobel(c, 1)
        y = ndi.sobel(c, 0)
        gx2 += x * x
        gy2 += y * y
        gxy += x * y
    tr = gx2 + gy2
    det = gx2 * gy2 - gxy * gxy
    lam = tr / 2 + np.sqrt(np.maximum(tr * tr / 4 - det, 0))
    ang = 0.5 * np.arctan2(2 * gxy, gx2 - gy2)
    mag = np.sqrt(lam)
    return mag, np.cos(ang), np.sin(ang)


def _frst(mag, ux, uy, radii, thr_q=0.6, alpha=2.0):
    h, w = mag.shape
    thr = np.quantile(mag[mag > 0], thr_q)
    ys, xs = np.nonzero(mag > thr)
    m = mag[ys, xs]
    dx = ux[ys, xs]
    dy = uy[ys, xs]
    out = []
    for r in radii:
        O = np.zeros((h, w), np.float32)
        M = np.zeros((h, w), np.float32)
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


def frst_candidates(px, mind=0.75):
    """Fast radial symmetry peaks: rows of [y, x, r]."""
    lab = cv2.cvtColor(px.rgb, cv2.COLOR_RGB2LAB)
    a = px.a
    mag, ux, uy = _grad_field(lab, a)
    radii = list(range(4, 19))
    S = _frst(mag, ux, uy, radii)
    best = S.max(0)
    arg = S.argmax(0)
    rr = np.array(radii)[arg]
    pk = (best == ndi.maximum_filter(best, size=7)) & (best > np.quantile(best, 0.80)) & (a > 0.3)
    ys, xs = np.nonzero(pk)
    order = np.argsort(-best[ys, xs])
    ys, xs = ys[order], xs[order]
    pts = np.array([(y, x, rr[y, x]) for y, x in zip(ys, xs)], float)
    t = cKDTree(pts[:, :2])
    alive = np.ones(len(pts), bool)
    for i in range(len(pts)):
        if not alive[i]:
            continue
        for j in t.query_ball_point(pts[i, :2], mind * 2 * pts[i, 2]):
            if j > i and alive[j] and np.hypot(*(pts[i, :2] - pts[j, :2])) < mind * (pts[i, 2] + pts[j, 2]):
                alive[j] = False
    return pts[alive]


def _blob_energy(chans, sigmas):
    E = []
    for s in sigmas:
        e = 0
        for c, wgt in chans:
            l = s * s * ndi.gaussian_laplace(c, s)
            e = e + wgt * l * l
        E.append(np.sqrt(e))
    return np.stack(E)


def _nms(pts, score, mind):
    order = np.argsort(-score)
    pts = pts[order]
    score = score[order]
    t = cKDTree(pts[:, :2])
    alive = np.ones(len(pts), bool)
    for i in range(len(pts)):
        if not alive[i]:
            continue
        for j in t.query_ball_point(pts[i, :2], mind * 2 * pts[:, 2].max()):
            if j > i and alive[j] and np.hypot(*(pts[i, :2] - pts[j, :2])) < mind * (pts[i, 2] + pts[j, 2]):
                alive[j] = False
    return pts[alive], score[alive]


def blob_candidates(px, rmin=4, rmax=14, mind=0.8, q=0.5):
    """Laplacian-of-Gaussian blob peaks: rows of [y, x, r]."""
    a = px.a
    lab = cv2.cvtColor(px.rgb, cv2.COLOR_RGB2LAB)
    L = lab[..., 0] / 100 * a + (1 - a) * 1.0
    A = lab[..., 1] / 100 * a
    B = lab[..., 2] / 100 * a
    chans = [(L, 1.0), (A, 1.0), (B, 1.0), (a, 1.0)]
    radii = np.arange(rmin, rmax + 0.01, 0.5)
    sig = radii / np.sqrt(2)
    E = _blob_energy(chans, sig)
    best = E.max(0)
    mx = ndi.maximum_filter(E, size=(3, 5, 5))
    pk = (E == mx) & (E > np.quantile(best[a > 0.3], q))
    s, ys, xs = np.nonzero(pk)
    ok = a[ys, xs] > 0.25
    s, ys, xs = s[ok], ys[ok], xs[ok]
    pts = np.stack([ys, xs, radii[s]], 1).astype(float)
    sc = E[s, ys, xs]
    pts, sc = _nms(pts, sc, mind)
    return pts


def stardist_candidates(px, models, scale=STARDIST_SCALE):
    """StarDist discs on the Lw view and then the alpha view.

    Rows of [y, x, r, prob, solidity, eccentricity, view index]. The prototype
    loops over all 11 views in definition order; only Lw (index 0) and alpha
    (index 3) were ever selected, and Lw comes first.
    """
    rgb, a = px.rgb, px.a[..., None]
    over_w = rgb * a + 1.0 * (1 - a)
    lab = cv2.cvtColor(over_w, cv2.COLOR_RGB2LAB)
    views = {"Lw": lab[..., 0], "alpha": a[..., 0]}
    out = []
    for vn, v in views.items():
        x = cv2.resize(v, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
        labels, det = models.predict_instances(x)
        probs = det["prob"]
        for rp in regionprops(labels):
            cy, cx = rp.centroid
            r = np.sqrt(rp.area / np.pi)
            p = probs[rp.label - 1] if rp.label - 1 < len(probs) else 0.5
            out.append((cy / scale, cx / scale, r / scale, p, rp.solidity, rp.eccentricity, STARDIST_VIEW_INDEX[vn]))
    return np.array(out).reshape(-1, 7)


def watershed_candidates(px, sig=2.2, h=0.025, med=5, amin=0.35):
    """Watershed regions on the luminance view: rows of [y, x, r_eq, r_in, solidity, eccentricity, area]."""
    rgb, a = px.rgb, px.a
    w = rgb * a[..., None] + (1 - a[..., None])
    lab = cv2.cvtColor(w, cv2.COLOR_RGB2LAB)
    L = lab[..., 0] / 100
    Lm = cv2.medianBlur((L * 255).astype(np.uint8), med).astype(np.float32) / 255
    S = ndi.gaussian_filter(Lm, sig)
    bg = ndi.gaussian_filter(Lm, 8)
    D = S - bg
    mk = h_maxima(D, h)
    mk = ndi.label(mk)[0]
    mask = a > amin
    lab_ws = watershed(-D, mk, mask=mask, watershed_line=True)
    pts = []
    for rp in regionprops(lab_ws):
        if rp.area < 12:
            continue
        cy, cx = rp.centroid
        sub = rp.image
        dt = ndi.distance_transform_edt(np.pad(sub, 1))
        rin = dt.max()
        req = np.sqrt(rp.area / np.pi)
        pts.append((cy, cx, req, rin, rp.solidity, rp.eccentricity, rp.area))
    return np.array(pts).reshape(-1, 7)


def _grads(px, sigma=1.0):
    rgb, a = px.rgb, px.a
    w = rgb * a[..., None] + (1 - a[..., None])
    lab = cv2.cvtColor(w, cv2.COLOR_RGB2LAB)
    chans = [lab[..., 0] / 100, lab[..., 1] / 100, lab[..., 2] / 100, a]
    G = []
    for c in chans:
        c = ndi.gaussian_filter(c, sigma)
        G.append((ndi.sobel(c, 1) / 8, ndi.sobel(c, 0) / 8))
    return G, a


def _circle_score(G, ys, xs, rs, n=36):
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


def _refine(G, c, steps=(0.8, 0.9, 1.0, 1.1, 1.2), shifts=(-1, 0, 1)):
    best = None
    for f in steps:
        for dy in shifts:
            for dx in shifts:
                s, _, _ = _circle_score(G, c[:, 0] + dy, c[:, 1] + dx, c[:, 2] * f)
                if best is None:
                    best = (s, c[:, 0] + dy, c[:, 1] + dx, c[:, 2] * f)
                else:
                    k = s > best[0]
                    best = (np.where(k, s, best[0]), np.where(k, c[:, 0] + dy, best[1]), np.where(k, c[:, 1] + dx, best[2]), np.where(k, c[:, 2] * f, best[3]))
    return np.stack([best[1], best[2], best[3], best[0]], 1)


def _fuse(G, a, cands, rmin, rmax, smin, mind=0.8):
    c = cands[(cands[:, 2] >= rmin) & (cands[:, 2] <= rmax)]
    c = c[a[np.clip(c[:, 0].astype(int), 0, a.shape[0] - 1), np.clip(c[:, 1].astype(int), 0, a.shape[1] - 1)] > 0.25]
    c = _refine(G, c)
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


def _drop_small(c, frac=0.62, k=7):
    t = cKDTree(c[:, :2])
    d, idx = t.query(c[:, :2], k + 1)
    locr = np.median(c[idx[:, 1:], 2], 1)
    return c[c[:, 2] >= frac * locr]


def detect_stones(px, models):
    """Run every detector and fuse them: rows of [y, x, r, score] in pixels."""
    frst = frst_candidates(px)
    log = blob_candidates(px)
    sd = stardist_candidates(px, models)
    G, a = _grads(px)
    C = [sd[sd[:, 3] > STARDIST_MIN_PROB][:, :3]]
    C.append(frst[:, :3] + [0, 0, 1])
    C.append(log[:, :3])
    for sig, h in [(1.2, 0.005), (1.6, 0.01)]:
        p = watershed_candidates(px, sig, h)
        C.append(np.stack([p[:, 0], p[:, 1], p[:, 2] * 0.85], 1))
        C.append(np.stack([p[:, 0], p[:, 1], p[:, 3]], 1))
    cands = np.concatenate(C)
    if len(cands) == 0:
        return np.empty((0, 4))
    f = _fuse(G, a, cands, 3.5, 30, FUSE_SMIN, FUSE_MIND)
    for _ in range(2):
        if len(f) <= 8:
            break
        f = _drop_small(f)
    return f
