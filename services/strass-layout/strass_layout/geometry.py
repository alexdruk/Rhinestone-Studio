"""Stone geometry on one frame: legalising, gap violations, hole filling, coverage.

Ported from rs_fix.py. The module state the prototype kept in globals (_ALPHA,
_DETTREE, _DETNN, _DEPTH, TARGET_PITCH) lives in a FrameState that every function
that needs it receives.
"""
import cv2
import numpy as np
from scipy import ndimage as ndi
from scipy.spatial import cKDTree

SS6, SS4 = 2.0, 1.5
SIZES = [4.0, 2.8, 2.0, 1.5]
GAP = 0.1
EPS = 0.02


class FrameState:
    """Per-image state: target pitch, closed alpha, its depth map and the detection tree."""

    def __init__(self, a, fused, pitch_mm):
        self.pitch = pitch_mm
        am = (a > 0.5).astype(np.uint8)
        nn = cKDTree(fused[:, :2]).query(fused[:, :2], 2)[0][:, 1]
        k = int(0.8 * np.median(nn)) | 1
        big = fused[fused[:, 2] >= 0.7 * np.median(fused[:, 2])]
        self.det_tree = cKDTree(big[:, [1, 0]])
        self.det_nn = float(np.median(nn))
        self.alpha = cv2.morphologyEx(am, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))).astype(np.float32)
        self.depth = ndi.distance_transform_edt(self.alpha > 0.5)


def smaller(d):
    for x in SIZES:
        if x < d - 1e-9:
            return x
    return SS4


def depth_mm(state, P, s):
    if len(P) == 0:
        return np.full(len(P), 99.0)
    h, w = state.depth.shape
    return state.depth[np.clip((P[:, 1] / s).astype(int), 0, h - 1), np.clip((P[:, 0] / s).astype(int), 0, w - 1)] * s


def openai_room(state, P, s, edge_mm=3.0, frac=0.72):
    if len(P) == 0:
        return np.ones(len(P), bool)
    d, _ = state.det_tree.query(np.asarray(P) / s)
    deep = depth_mm(state, np.asarray(P), s) >= edge_mm
    return deep | (d >= frac * state.det_nn)


def cover_frac(state, P, d, s, thr=0.5):
    if len(P) == 0:
        return np.ones(len(P))
    a = state.alpha
    h, w = a.shape
    out = np.zeros(len(P))
    for k, ((x, y), dd) in enumerate(zip(P, np.broadcast_to(d, (len(P),)))):
        r = dd / 2 / s
        cx, cy = x / s, y / s
        y0, y1 = int(max(0, cy - r)), int(min(h, cy + r + 1))
        x0, x1 = int(max(0, cx - r)), int(min(w, cx + r + 1))
        if y1 <= y0 or x1 <= x0:
            continue
        yy, xx = np.mgrid[y0:y1, x0:x1]
        m = np.hypot(yy - cy, xx - cx) <= r
        out[k] = (a[y0:y1, x0:x1][m] > thr).mean() if m.any() else 0
    return out


def fill_small_holes(m, max_area):
    filled = ndi.binary_fill_holes(m)
    holes_ = filled & ~m
    lab_, n = ndi.label(holes_)
    if n == 0:
        return m
    area = ndi.sum(holes_, lab_, range(1, n + 1))
    small = np.isin(lab_, 1 + np.nonzero(area <= max_area)[0])
    return m | small


def subject_mask(a, det, pitch_px):
    m = a > 0.5
    disc = np.zeros_like(m)
    for y, x, r in det[:, :3]:
        cv2.circle(disc.view(np.uint8), (int(round(x)), int(round(y))), int(round(r)), 1, -1)
    m = m | disc
    k = int(round(0.35 * pitch_px)) | 1
    m = cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))).astype(bool)
    m = fill_small_holes(m, 1.5 * pitch_px ** 2)
    lab, n = ndi.label(m)
    if n > 1:
        sz = ndi.sum(m, lab, range(1, n + 1))
        m = np.isin(lab, 1 + np.nonzero(sz >= 0.5 * pitch_px ** 2)[0])
    return m


def strict_mask(a, mask):
    m = ndi.gaussian_filter(a, 2) > 0.25
    m = ndi.binary_closing(m, iterations=2)
    m = fill_small_holes(m, 400)
    return m & mask


def legalise(P, D, A, iters=400, pull=0.004, maxmove=1.1):
    P = P.copy()
    n = len(P)
    reach = float(D.max()) + GAP + 0.05 + 0.4
    pairs = None
    for it in range(iters):
        if it % 6 == 0:
            pairs = cKDTree(P).query_pairs(reach, output_type="ndarray")
            if len(pairs) == 0:
                break
        i, j = pairs[:, 0], pairs[:, 1]
        dv = P[j] - P[i]
        dist = np.sqrt((dv * dv).sum(1)) + 1e-9
        v = (D[i] + D[j]) / 2 + GAP + EPS - dist
        bad = v > 0
        if not bad.any():
            break
        i, j, dv, dist, v = i[bad], j[bad], dv[bad], dist[bad], v[bad]
        u = dv / dist[:, None]
        wi = wj = np.full(len(i), 0.5)
        sx = np.bincount(i, -u[:, 0] * v * wi, n) + np.bincount(j, u[:, 0] * v * wj, n)
        sy = np.bincount(i, -u[:, 1] * v * wi, n) + np.bincount(j, u[:, 1] * v * wj, n)
        cnt = np.bincount(i, wi > 0, n) + np.bincount(j, wj > 0, n)
        mv = np.stack([sx, sy], 1) / np.maximum(cnt, 1)[:, None]
        P += mv + pull * (A - P)
        off = P - A
        on = np.sqrt((off * off).sum(1))
        k = on > maxmove
        P[k] = A[k] + off[k] / on[k, None] * maxmove
    return P


def violations(P, D):
    t = cKDTree(P)
    pairs = t.query_pairs(float(D.max()) + GAP + 0.05, output_type="ndarray")
    if len(pairs) == 0:
        return np.zeros(len(P), int), 0.0
    i, j = pairs[:, 0], pairs[:, 1]
    gap = np.linalg.norm(P[j] - P[i], axis=1) - (D[i] + D[j]) / 2
    bad = gap < GAP - 1e-6
    cnt = np.zeros(len(P), int)
    np.add.at(cnt, i[bad], 1)
    np.add.at(cnt, j[bad], 1)
    return cnt, gap.min()


def resolve_idx(P, D, A, score, minor):
    idx = np.arange(len(P))
    for rnd in range(12):
        P = legalise(P, D, A)
        cnt, gmin = violations(P, D)
        if cnt.sum() == 0:
            break
        bad = np.nonzero(cnt)[0]
        order = bad[np.lexsort((score[bad], -cnt[bad], ~minor[bad]))]
        handled = set()
        dele = []
        t = cKDTree(P)
        for k in order:
            if k in handled:
                continue
            nb = [j for j in t.query_ball_point(P[k], (D[k] + float(D.max())) / 2 + GAP + 0.05) if j != k]
            handled.update(nb)
            if D[k] > SS4 and rnd < 6 and not minor[k]:
                D[k] = smaller(D[k])
            else:
                dele.append(k)
        keep = np.ones(len(P), bool)
        keep[dele] = False
        P, D, A, score, minor, idx = P[keep], D[keep], A[keep], score[keep], minor[keep], idx[keep]
    return P, D, A, idx


def fill(state, P, D, mask, s, ppmm=20, sizes=(SS6, SS4)):
    h, w = mask.shape
    Wm, Hm = w * s, h * s
    Wp, Hp = int(np.ceil(Wm * ppmm)), int(np.ceil(Hm * ppmm))
    M = cv2.resize(mask.astype(np.uint8), (Wp, Hp), interpolation=cv2.INTER_NEAREST).astype(bool)
    occ = np.zeros((Hp, Wp), np.uint8)
    for (x, y), d in zip(P, D):
        cv2.circle(occ, (int(round(x * ppmm)), int(round(y * ppmm))), int(round((d / 2 + GAP + 0.05) * ppmm)), 1, -1)
    free = M & (occ == 0)
    newP, newD = [], []
    for d in sizes:
        r = d / 2
        need = r * ppmm
        DT = ndi.distance_transform_edt(free)
        while True:
            yx = np.unravel_index(np.argmax(DT), DT.shape)
            if DT[yx] < need:
                break
            y, x = yx
            newP.append((x / ppmm, y / ppmm))
            newD.append(d)
            rr = int(np.ceil((r + GAP + 0.05) * ppmm))
            cv2.circle(occ, (x, y), rr, 1, -1)
            y0, y1 = max(0, y - 3 * rr), min(Hp, y + 3 * rr + 1)
            x0, x1 = max(0, x - 3 * rr), min(Wp, x + 3 * rr + 1)
            free = M & (occ == 0)
            pad = int(need) + 2
            Y0, Y1 = max(0, y0 - pad), min(Hp, y1 + pad)
            X0, X1 = max(0, x0 - pad), min(Wp, x1 + pad)
            sub = ndi.distance_transform_edt(np.pad(free[Y0:Y1, X0:X1], 1, constant_values=True))[1:-1, 1:-1]
            DT[y0:y1, x0:x1] = np.minimum(DT[y0:y1, x0:x1], sub[y0 - Y0:y1 - Y0, x0 - X0:x1 - X0])
            DT[y0:y1, x0:x1] = np.where(free[y0:y1, x0:x1], DT[y0:y1, x0:x1], 0)
    newP = np.array(newP).reshape(-1, 2)
    newD = np.array(newD)
    if len(newP):
        ok = (cover_frac(state, newP, newD, s) >= 0.7) & openai_room(state, newP, s)
        newP, newD = newP[ok], newD[ok]
    return newP, newD


def holes(P, D, mask, s, ppmm=10):
    """Largest empty circle diameter (mm) and coverage: the share of subject-mask pixels under a stone."""
    h, w = mask.shape
    Wp, Hp = int(np.ceil(w * s * ppmm)), int(np.ceil(h * s * ppmm))
    M = cv2.resize(mask.astype(np.uint8), (Wp, Hp), interpolation=cv2.INTER_NEAREST).astype(bool)
    M = cv2.erode(M.astype(np.uint8), np.ones((3, 3))).astype(bool)
    occ = np.zeros((Hp, Wp), np.uint8)
    for (x, y), d in zip(P, D):
        cv2.circle(occ, (int(round(x * ppmm)), int(round(y * ppmm))), int(round(d / 2 * ppmm)), 1, -1)
    free = M & (occ == 0)
    DT = ndi.distance_transform_edt(free) / ppmm
    cover = (M & (occ > 0)).sum() / M.sum()
    return 2 * DT.max(), cover
