from pathcfg import W as _W
import sys, json
import numpy as np, cv2
from PIL import Image
from scipy import ndimage as ndi
from scipy.spatial import cKDTree
from skimage.color import rgb2lab, deltaE_ciede2000

from pathcfg import W
SS6, SS4 = 2.0, 1.5
SIZES = [4.0, 2.8, 2.0, 1.5]


def smaller(d):
    for x in SIZES:
        if x < d - 1e-9:
            return x
    return SS4
GAP = 0.1
EPS = 0.02

import os
TARGET_PITCH = float(os.environ.get('TARGET_PITCH', '2.2'))
CAT = json.load(open(W + os.environ.get('CATALOGUE', 'catalogue.json')))
LOOKS = json.load(open(W + 'looks.json'))
CAT_IDS = list(CAT)
CAT_LAB = rgb2lab(np.array([[int(CAT[k]['fill'][i:i + 2], 16) / 255 for i in (1, 3, 5)] for k in CAT_IDS])[None])[0]
KL = float(os.environ.get('KL', '1.0'))
KH = 1.0
CATCH_LAB = np.array([99.0, 0.0, 0.0])


_ALPHA = None
_DETP = None
_DETTREE = None
_DETNN = None


def openai_room(P, s, edge_mm=3.0, frac=0.72):
    if _DETTREE is None or len(P) == 0:
        return np.ones(len(P), bool)
    d, _ = _DETTREE.query(np.asarray(P) / s)
    deep = depth_mm(np.asarray(P), s) >= edge_mm
    return deep | (d >= frac * _DETNN)
_DEPTH = None


def depth_mm(P, s):
    if _DEPTH is None or len(P) == 0:
        return np.full(len(P), 99.0)
    h, w = _DEPTH.shape
    return _DEPTH[np.clip((P[:, 1] / s).astype(int), 0, h - 1), np.clip((P[:, 0] / s).astype(int), 0, w - 1)] * s
VIVID = float(os.environ.get('VIVID', '1.0'))
CHROMA_W = float(os.environ.get('CHROMA_W', '0.5'))
SKIN_NATURAL = os.environ.get('SKIN_NATURAL', '1') == '1'


def cover_frac(P, d, s, thr=0.5):
    if _ALPHA is None or len(P) == 0:
        return np.ones(len(P))
    a = _ALPHA; h, w = a.shape
    out = np.zeros(len(P))
    for k, ((x, y), dd) in enumerate(zip(P, np.broadcast_to(d, (len(P),)))):
        r = dd / 2 / s; cx, cy = x / s, y / s
        y0, y1 = int(max(0, cy - r)), int(min(h, cy + r + 1)); x0, x1 = int(max(0, cx - r)), int(min(w, cx + r + 1))
        if y1 <= y0 or x1 <= x0:
            continue
        yy, xx = np.mgrid[y0:y1, x0:x1]; m = np.hypot(yy - cy, xx - cx) <= r
        out[k] = (a[y0:y1, x0:x1][m] > thr).mean() if m.any() else 0
    return out


def load(name):
    global _ALPHA
    im = np.array(Image.open(f'{_W}img/{name}.png').convert('RGBA')).astype(np.float32) / 255
    am = (im[..., 3] > 0.5).astype(np.uint8)
    k = 9
    try:
        dd = np.load(f'{W}{name}_fused.npy')
        from scipy.spatial import cKDTree as _T
        nn = _T(dd[:, :2]).query(dd[:, :2], 2)[0][:, 1]
        k = int(0.8 * np.median(nn)) | 1
        global _DETP, _DETTREE, _DETNN
        big = dd[dd[:, 2] >= 0.7 * np.median(dd[:, 2])]
        _DETP = big[:, [1, 0]]; _DETTREE = _T(_DETP); _DETNN = float(np.median(nn))
    except Exception:
        pass
    k = int(os.environ.get('CLOSE_PX', k)) | 1
    _ALPHA = cv2.morphologyEx(am, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))).astype(np.float32)
    global _DEPTH
    _DEPTH = ndi.distance_transform_edt(_ALPHA > 0.5)
    return im[..., :3], im[..., 3]


def scale_from(det):
    rb = np.median(det[det[:, 2] >= np.median(det[:, 2]), 2])
    m = det[det[:, 2] >= 0.75 * rb]
    d, _ = cKDTree(m[:, :2]).query(m[:, :2], 2)
    return TARGET_PITCH / np.median(d[:, 1])


def stone_colours(rgb, a, det):
    lab = rgb2lab(rgb)
    h, w = a.shape
    out = np.zeros((len(det), 3))
    for i, (y, x, r) in enumerate(det[:, :3]):
        R = max(2.0, 0.65 * r)
        y0, y1 = int(max(0, y - R)), int(min(h, y + R + 1))
        x0, x1 = int(max(0, x - R)), int(min(w, x + R + 1))
        yy, xx = np.mgrid[y0:y1, x0:x1]
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


def fill_small_holes(m, max_area):
    filled = ndi.binary_fill_holes(m)
    holes = filled & ~m
    lab_, n = ndi.label(holes)
    if n == 0:
        return m
    area = ndi.sum(holes, lab_, range(1, n + 1))
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


def legalise(P, D, A, iters=400, pull=0.004, maxmove=1.1, active=None, region=3.0):
    P = P.copy()
    if active is not None:
        act = np.zeros(len(P), bool); act[active] = True
        if not act.any():
            return P
        near = cKDTree(P).query_ball_point(P[act], region)
        sub = np.unique(np.concatenate([np.asarray(x, int) for x in near] + [np.nonzero(act)[0]]))
        move = act[sub]
        Q = _legalise_core(P[sub], D[sub], A[sub], iters, pull, maxmove, move)
        P[sub] = Q
        return P
    return _legalise_core(P, D, A, iters, pull, maxmove, None)


def _legalise_core(P, D, A, iters, pull, maxmove, move):
    P = P.copy(); n = len(P)
    reach = float(D.max()) + GAP + 0.05 + 0.4
    pairs = None
    for it in range(iters):
        if it % 6 == 0:
            pairs = cKDTree(P).query_pairs(reach, output_type='ndarray')
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
        if move is not None:
            mi, mj = move[i].astype(float), move[j].astype(float)
            wi = np.where(mj > 0, 0.5, 1.0) * mi; wj = np.where(mi > 0, 0.5, 1.0) * mj
        else:
            wi = wj = np.full(len(i), 0.5)
        sx = np.bincount(i, -u[:, 0] * v * wi, n) + np.bincount(j, u[:, 0] * v * wj, n)
        sy = np.bincount(i, -u[:, 1] * v * wi, n) + np.bincount(j, u[:, 1] * v * wj, n)
        cnt = np.bincount(i, wi > 0, n) + np.bincount(j, wj > 0, n)
        mv = np.stack([sx, sy], 1) / np.maximum(cnt, 1)[:, None]
        if move is not None:
            mv[~move] = 0
            P += mv
            P[move] += pull * (A[move] - P[move])
        else:
            P += mv + pull * (A - P)
        off = P - A
        on = np.sqrt((off * off).sum(1))
        k = on > maxmove
        P[k] = A[k] + off[k] / on[k, None] * maxmove
    return P


def violations(P, D):
    t = cKDTree(P)
    pairs = t.query_pairs(float(D.max()) + GAP + 0.05, output_type='ndarray')
    if len(pairs) == 0:
        return np.zeros(len(P), int), 0.0
    i, j = pairs[:, 0], pairs[:, 1]
    gap = np.linalg.norm(P[j] - P[i], axis=1) - (D[i] + D[j]) / 2
    bad = gap < GAP - 1e-6
    cnt = np.zeros(len(P), int)
    np.add.at(cnt, i[bad], 1); np.add.at(cnt, j[bad], 1)
    return cnt, gap.min()


def resolve(P, D, A, score, minor=None):
    if minor is None:
        minor = np.zeros(len(P), bool)
    for rnd in range(12):
        P = legalise(P, D, A)
        cnt, gmin = violations(P, D)
        if cnt.sum() == 0:
            return P, D, A, score
        idx = np.nonzero(cnt)[0]
        order = idx[np.lexsort((score[idx], -cnt[idx], ~minor[idx]))]
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
        keep = np.ones(len(P), bool); keep[dele] = False
        P, D, A, score, minor = P[keep], D[keep], A[keep], score[keep], minor[keep]
    return P, D, A, score


def resolve_idx(P, D, A, score, minor):
    idx = np.arange(len(P))
    for rnd in range(12):
        P = legalise(P, D, A)
        cnt, gmin = violations(P, D)
        if cnt.sum() == 0:
            break
        bad = np.nonzero(cnt)[0]
        order = bad[np.lexsort((score[bad], -cnt[bad], ~minor[bad]))]
        handled = set(); dele = []
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
        keep = np.ones(len(P), bool); keep[dele] = False
        P, D, A, score, minor, idx = P[keep], D[keep], A[keep], score[keep], minor[keep], idx[keep]
    return P, D, A, idx


def fill(P, D, mask, s, ppmm=20, sizes=(SS6, SS4)):
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
            newP.append((x / ppmm, y / ppmm)); newD.append(d)
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
    newP = np.array(newP).reshape(-1, 2); newD = np.array(newD)
    if len(newP) and _ALPHA is not None:
        ok = (cover_frac(newP, newD, s) >= 0.7) & openai_room(newP, s)
        newP, newD = newP[ok], newD[ok]
    return newP, newD


def holes(P, D, mask, s, ppmm=10):
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


def snap_colours(lab):
    lab = np.array(lab, float)
    if VIVID != 1.0:
        lab = lab.copy(); lab[:, 1:] *= VIVID
    d = np.stack([deltaE_ciede2000(lab, np.repeat(c[None], len(lab), 0), kL=KL, kH=KH) for c in CAT_LAB], 1)
    chroma = np.hypot(lab[:, 1], lab[:, 2])
    cat_ch = np.hypot(CAT_LAB[:, 1], CAT_LAB[:, 2])
    d[np.ix_(chroma >= 18, cat_ch < 8)] += 1000
    hue = np.degrees(np.arctan2(lab[:, 2], lab[:, 1])) % 360
    warm = (hue >= 25) & (hue <= 78) & (chroma < 65) & (chroma > 8)
    pen = CHROMA_W * np.maximum(0, 0.9 * chroma[:, None] - cat_ch[None, :])
    pen[warm] = 0
    d += pen
    if SKIN_NATURAL:
        for k_ in ('gold', 'citrine', 'peridot'):
            if k_ in CAT_IDS:
                d[(hue < 80) & (chroma > 8), CAT_IDS.index(k_)] += 1000
        if 'topaz' in CAT_IDS:
            d[warm & (chroma < 50), CAT_IDS.index('topaz')] += 1000
    if 'hyacinth' in CAT_IDS:
        d[chroma < 60, CAT_IDS.index('hyacinth')] += 1000
    k = d.argmin(1)
    return [CAT_IDS[i] for i in k], d[np.arange(len(lab)), k]


def run(name, det_file):
    rgb, a = load(name)
    det = np.load(det_file)
    s = scale_from(det)
    pitch_px = TARGET_PITCH / s
    mask = subject_mask(a, det, pitch_px)
    col = stone_colours(rgb, a, det)
    d_mm = 2 * det[:, 2] * s
    rep = {'name': name, 'mm_per_px': s, 'width_mm': a.shape[1] * s, 'height_mm': a.shape[0] * s,
           'detected': int(len(det))}
    tiny = d_mm < 1.1
    big = d_mm > 2.9
    minor_det = (d_mm >= 1.1) & (d_mm < 1.6)
    inside_big = np.zeros(len(det), bool)
    if big.any():
        tb = cKDTree(det[:, :2])
        for i in np.nonzero(big)[0]:
            for j in tb.query_ball_point(det[i, :2], det[i, 2]):
                if j != i:
                    inside_big[j] = True
    shadow = np.zeros(len(det), bool)
    tdet = cKDTree(det[:, :2])
    mainm = d_mm >= 1.6
    for i in np.nonzero(minor_det & (col[:, 0] < 30))[0]:
        nb = [j for j in tdet.query_ball_point(det[i, :2], 2.2 * det[i, 2] + 6) if j != i and mainm[j]]
        if nb and np.mean(col[nb, 0] < 30) < 0.5:
            shadow[i] = True
    gapdrop = np.zeros(len(det), bool)
    disc = np.zeros(a.shape, np.uint8)
    for y_, x_, r_, *_ in det:
        cv2.circle(disc, (int(round(x_)), int(round(y_))), int(round(r_)), 1, -1)
    subj = cv2.morphologyEx((a > 0.5).astype(np.uint8), cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8)).astype(bool)
    gpx = subj & (disc == 0)
    rep['gap_alpha_mean'] = float(a[gpx].mean()) if gpx.any() else 0.0
    if rep['gap_alpha_mean'] > 0.5:
        glab = np.median(rgb2lab(rgb)[gpx & (a > 0.5)], 0)
        dg = deltaE_ciede2000(col, np.repeat(glab[None], len(col), 0))
        gapdrop = (d_mm < 1.6) & (dg < 12)
    mainm2 = d_mm >= 1.6
    inter = np.zeros(len(det), bool)
    if mainm2.sum() > 10:
        tm = cKDTree(det[mainm2][:, :2]); rmain = det[mainm2][:, 2]
        main_d = np.median(2 * rmain)
        kq = min(6, int(mainm2.sum()))
        for i in np.nonzero(~mainm2)[0]:
            dd_, jj = tm.query(det[i, :2], kq)
            free = np.min(dd_ - rmain[jj])
            if 2 * free < 0.6 * main_d:
                inter[i] = True
    use = ~tiny & ~inside_big & ~shadow & ~gapdrop & ~inter
    rep['interstitial_dots_removed'] = int((inter & ~tiny).sum())
    rep['painted_gap_dots_removed'] = int(gapdrop.sum())
    rep['shadow_dots_removed'] = int(shadow.sum())
    rep['dropped_tiny'] = int(tiny.sum()); rep['big_tiled'] = int(big.sum()); rep['inside_big_removed'] = int((inside_big & ~tiny).sum())
    P, Dl, C, S, Mn = [], [], [], [], []
    sq3 = np.sqrt(3)
    for i in np.nonzero(use)[0]:
        y, x = det[i, 0] * s, det[i, 1] * s
        if big[i]:
            R = d_mm[i] / 2
            if R - SS6 / 2 + 0.25 >= TARGET_PITCH:
                dd, pt = SS6, TARGET_PITCH
            else:
                dd, pt = SS4, SS4 + GAP + 0.04
            tile = []
            for q in range(-5, 6):
                for rr_ in range(-5, 6):
                    px = (q + rr_ / 2) * pt
                    py = rr_ * pt * sq3 / 2
                    if np.hypot(px, py) <= max(0.0, R - dd / 2 + 0.25):
                        tile.append((px, py))
            catch = None
            if col[i][0] < 35 and len(tile) >= 7:
                cand = [t_ for t_ in tile if 0 < np.hypot(*t_) <= pt * 1.01]
                catch = max(cand, key=lambda t_: t_[0] - t_[1])
            for px, py in tile:
                P.append((x + px, y + py)); Dl.append(dd); S.append(9.0); Mn.append(False)
                C.append(CATCH_LAB if (px, py) == catch else col[i])
        else:
            P.append((x, y)); Dl.append(SS4 if minor_det[i] else SS6); C.append(col[i]); S.append(det[i, 3]); Mn.append(bool(minor_det[i]))
    P, D, C, S, Mn = np.array(P), np.array(Dl), np.array(C), np.array(S), np.array(Mn)
    my = np.clip((P[:, 1] / s).astype(int), 0, a.shape[0] - 1); mx = np.clip((P[:, 0] / s).astype(int), 0, a.shape[1] - 1)
    inm = mask[my, mx]
    P, D, C, S, Mn = P[inm], D[inm], C[inm], S[inm], Mn[inm]
    order = np.lexsort((-S, Mn))
    P, D, C, S, Mn = P[order], D[order], C[order], S[order], Mn[order]
    t = cKDTree(P)
    dup = np.zeros(len(P), bool)
    for i in range(len(P)):
        if dup[i]:
            continue
        for j in t.query_ball_point(P[i], 0.5 * (D[i] + 0.0) + 0.3):
            if j > i:
                dup[j] = True
    P, D, C, S, Mn = P[~dup], D[~dup], C[~dup], S[~dup], Mn[~dup]
    rep['merged_duplicates'] = int(dup.sum())
    rep['openai_stones_in'] = int(len(P))
    A = P.copy()
    tag = np.arange(len(P)).astype(float)
    P2, D2, A2, T2 = resolve(P, D.copy(), A, S.copy(), Mn.copy()) if False else (None, None, None, None)
    P2, D2, A2, keep_idx = resolve_idx(P, D.copy(), A, S.copy(), Mn.copy())
    C2 = C[keep_idx]; Mn2 = Mn[keep_idx]
    rep['openai_stones_kept'] = int(len(P2)); rep['openai_ss6_downsized_to_ss4'] = int(((D2 == SS4) & ~Mn2).sum())
    rep['openai_minor_kept_as_ss4'] = int(Mn2.sum())
    fP, fD = fill(P2, D2, mask, s)
    keep_det = np.nonzero(use)[0]
    vor = cKDTree(det[keep_det][:, [1, 0]] * s)
    fC = col[keep_det][vor.query(fP)[1]] if len(fP) else np.zeros((0, 3))
    PP = np.concatenate([P2, fP]); DD = np.concatenate([D2, fD]); CC = np.concatenate([C2, fC])
    AA = PP.copy(); AA[:len(P2)] = A2
    SS_ = np.r_[np.full(len(P2), 2.0), np.ones(len(fP))]
    MN = np.r_[np.zeros(len(P2), bool), np.ones(len(fP), bool)]
    P3, D3, A3, k3 = resolve_idx(PP, DD.copy(), AA, SS_, MN)
    CC = CC[k3]
    origin = np.array(['openai'] * len(P2) + ['fill'] * len(fP))[k3]
    rep['filled_ss6'] = int(((origin == 'fill') & (D3 == SS6)).sum()); rep['filled_ss4'] = int(((origin == 'fill') & (D3 == SS4)).sum())
    oi = origin == 'openai'
    mv = np.linalg.norm(P3[oi] - A3[oi], axis=1)
    rep['openai_moved_mm_median'] = float(np.median(mv)); rep['openai_moved_mm_p95'] = float(np.quantile(mv, 0.95))
    rep['share_of_final_at_openai_position_0_3mm'] = float((mv <= 0.3).sum() / len(P3))
    ids, de = snap_colours(CC)
    cnt, gmin = violations(P3, D3)
    hmax, cover = holes(P3, D3, mask, s)
    rep.update({'stones': int(len(P3)), 'ss6': int((D3 == SS6).sum()), 'ss4': int((D3 == SS4).sum()),
                'min_gap_mm': float(gmin), 'gap_violations': int(cnt.sum() // 2),
                'largest_empty_circle_mm': float(hmax), 'coverage': float(cover),
                'colours_used': int(len(set(ids))), 'colour_snap_dE_median': float(np.median(de)),
                'colour_snap_dE_p90': float(np.quantile(de, 0.9))})
    stones = [{'x': round(float(x), 3), 'y': round(float(y), 3), 'size': 'ss6' if d == SS6 else 'ss4', 'd': float(d), 'color': c, 'src': str(o)}
              for (x, y), d, c, o in zip(P3, D3, ids, origin)]
    return rep, stones, mask, col, det, tiny


def derendered_map(a_shape, det, col, mask, tiny):
    h, w = a_shape
    keep = ~tiny
    t = cKDTree(det[keep][:, :2])
    yy, xx = np.mgrid[0:h, 0:w]
    _, idx = t.query(np.stack([yy[mask], xx[mask]], 1))
    from skimage.color import lab2rgb
    rgbc = lab2rgb(col[keep][None])[0]
    out = np.ones((h, w, 3))
    out[mask] = rgbc[idx]
    return (out * 255).astype(np.uint8)


if __name__ == '__main__':
    name = sys.argv[1]
    rep, stones, mask, col, det, tiny = run(name, f'{W}{name}_fused.npy')
    json.dump({'report': rep, 'stones': stones}, open(f'{W}{name}_rs.json', 'w'))
    Image.fromarray(derendered_map(mask.shape, det, col, mask, tiny)).save(f'{W}{name}_derendered.png')
    print(json.dumps(rep, indent=1))
