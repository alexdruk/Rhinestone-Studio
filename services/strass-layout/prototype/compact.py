import sys, json, os
import numpy as np, cv2
from PIL import Image
from scipy.spatial import cKDTree
from skimage.color import rgb2lab
import rs_fix as R

W = R.W
G0 = 0.12


def neighbour_pairs(P, r=4.6):
    return cKDTree(P).query_pairs(r, output_type='ndarray')


def relax(P, D, A, inside_fn, k_anchor, iters=300, k_att=0.3, att_range=1.3, step_max=0.05):
    P = P.copy()
    pairs = neighbour_pairs(P)
    for it in range(iters):
        if it % 15 == 0:
            pairs = neighbour_pairs(P)
        i, j = pairs[:, 0], pairs[:, 1]
        dv = P[j] - P[i]
        dist = np.linalg.norm(dv, axis=1) + 1e-9
        u = dv / dist[:, None]
        g = dist - (D[i] + D[j]) / 2
        f = np.zeros(len(g))
        att = (g > G0) & (g < att_range)
        f[att] = k_att * (g[att] - G0)
        rep = g < R.GAP + 0.01
        f[rep] = 1.0 * (g[rep] - (R.GAP + 0.01))
        F = np.zeros_like(P); cnt = np.zeros(len(P))
        np.add.at(F, i, u * f[:, None]); np.add.at(F, j, -u * f[:, None])
        np.add.at(cnt, i, 1); np.add.at(cnt, j, 1)
        mv = F / np.maximum(cnt, 1)[:, None] * 2.0 + k_anchor[:, None] * (A - P)
        n = np.linalg.norm(mv, axis=1)
        big = n > step_max
        mv[big] *= (step_max / n[big])[:, None]
        Pn = P + mv
        ok = inside_fn(Pn)
        P[ok] = Pn[ok]
    return P


def upgrade(P, D):
    t = cKDTree(P)
    up = 0
    for k in np.nonzero(D == R.SS4)[0]:
        nb = [j for j in t.query_ball_point(P[k], R.SS6 + R.GAP + 0.05) if j != k]
        if all(np.linalg.norm(P[j] - P[k]) - (R.SS6 + D[j]) / 2 >= R.GAP + 0.005 for j in nb):
            D[k] = R.SS6; up += 1
    return up


def run(name, jf, mode, out, cycles=4):
    js = json.load(open(jf)); st = js['stones']; rep0 = js['report']; s = rep0['mm_per_px']
    rgb, a = R.load(name)
    det = np.load(f'{W}{name}_fused.npy')
    mask = R.subject_mask(a, det, R.TARGET_PITCH / s)
    h, w = mask.shape
    from scipy import ndimage as ndi
    edge_dist = ndi.distance_transform_edt(mask) * s

    def inside_fn(P):
        x = np.clip((P[:, 0] / s).astype(int), 0, w - 1); y = np.clip((P[:, 1] / s).astype(int), 0, h - 1)
        return mask[y, x]

    P = np.array([[q['x'], q['y']] for q in st]); D = np.array([q['d'] for q in st]); C = [q['color'] for q in st]
    src = [q['src'] for q in st]
    A = P.copy()
    ed = edge_dist[np.clip((A[:, 1] / s).astype(int), 0, h - 1), np.clip((A[:, 0] / s).astype(int), 0, w - 1)]
    base = 0.02 if mode == 'det' else 0.005
    if mode == 'det':
        col = R.stone_colours(rgb, a, det)
        keepd = 2 * det[:, 2] * s >= 1.6
        vor = cKDTree(det[keepd][:, [1, 0]] * s); vcol = col[keepd]
        sampler = lambda Q: vcol[vor.query(Q)[1]]
    else:
        from flowrun import sample
        rgbm = cv2.medianBlur((np.clip(rgb * a[..., None] + (1 - a[..., None]), 0, 1) * 255).astype(np.uint8), 5)
        LMd = rgb2lab(rgbm / 255.0)
        sampler = None
    log = []
    for cyc in range(cycles):
        ka = np.where(ed < 1.5, 0.15, base)[:len(P)] if len(ed) == len(P) else np.full(len(P), base)
        P = relax(P, D, A, inside_fn, ka)
        P, D, A2, keep = R.resolve_idx(P, D.copy(), P.copy(), np.ones(len(P)), np.zeros(len(P), bool))
        A = A[keep]; ed = ed[keep]; C = [C[k] for k in keep]; src = [src[k] for k in keep]
        up = upgrade(P, D)
        fP, fD = R.fill(P, D, mask, s)
        if len(fP):
            if mode == 'det':
                lab = sampler(fP)
            else:
                lab = sample(LMd, fP, fD, s)
            ids, _ = R.snap_colours(lab)
            P = np.concatenate([P, fP]); D = np.concatenate([D, fD]); A = np.concatenate([A, fP]); C += ids; src += ['fill'] * len(fP)
            fed = edge_dist[np.clip((fP[:, 1] / s).astype(int), 0, h - 1), np.clip((fP[:, 0] / s).astype(int), 0, w - 1)]
            ed = np.concatenate([ed, fed])
        P, D, A2, keep = R.resolve_idx(P, D.copy(), P.copy(), np.ones(len(P)), np.zeros(len(P), bool))
        A = A[keep]; ed = ed[keep]; C = [C[k] for k in keep]; src = [src[k] for k in keep]
        hmax, cover = R.holes(P, D, mask, s)
        log.append({'cycle': cyc + 1, 'stones': int(len(P)), 'added': int(len(fP)), 'ss4_to_ss6': up, 'coverage': round(cover, 3)})
        print(log[-1], flush=True)
    cnt, gmin = R.violations(P, D)
    hmax, cover = R.holes(P, D, mask, s)
    rep = dict(rep0)
    rep.update({'compaction': log, 'stones': int(len(P)), 'ss6': int((D == R.SS6).sum()), 'ss4': int((D == R.SS4).sum()),
                'min_gap_mm': float(gmin), 'gap_violations': int(cnt.sum() // 2), 'largest_empty_circle_mm': float(hmax),
                'coverage': float(cover), 'colours_used': int(len(set(C)))})
    stones = [{'x': round(float(x), 3), 'y': round(float(y), 3), 'size': 'ss6' if d == R.SS6 else 'ss4', 'd': float(d), 'color': c, 'src': o}
              for (x, y), d, c, o in zip(P, D, C, src)]
    json.dump({'report': rep, 'stones': stones}, open(out, 'w'))
    return rep


if __name__ == '__main__':
    r = run(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4])
    print({k: r[k] for k in ['stones', 'ss6', 'ss4', 'min_gap_mm', 'gap_violations', 'largest_empty_circle_mm', 'coverage']})


def candidates(P, D, mask, s, need_mm, ppmm=20, size=2.0):
    h, w = mask.shape
    Wp, Hp = int(np.ceil(w * s * ppmm)), int(np.ceil(h * s * ppmm))
    M = cv2.resize(mask.astype(np.uint8), (Wp, Hp), interpolation=cv2.INTER_NEAREST).astype(bool)
    occ = np.zeros((Hp, Wp), np.uint8)
    for (x, y), d in zip(P, D):
        cv2.circle(occ, (int(round(x * ppmm)), int(round(y * ppmm))), int(round((d / 2 + R.GAP) * ppmm)), 1, -1)
    from scipy import ndimage as ndi
    DT = ndi.distance_transform_edt(M & (occ == 0)) / ppmm
    mx = ndi.maximum_filter(DT, size=int(1.6 * ppmm))
    ys, xs = np.nonzero((DT == mx) & (DT >= need_mm))
    v = DT[ys, xs]; o = np.argsort(-v)
    pts = np.stack([xs[o], ys[o]], 1) / ppmm
    keep = []
    for p in pts:
        if all(np.hypot(*(p - q)) >= 1.3 * size for q in keep):
            keep.append(p)
    keep = np.array(keep).reshape(-1, 2)
    if len(keep):
        keep = keep[(R.cover_frac(keep, size, s) >= COVER) & R.openai_room(keep, s)]
        if size < R.SS6 and len(keep):
            keep = keep[R.depth_mm(keep, s) >= 3.3]
    return keep


COVER = 0.7


def _around(P, idx, r):
    if len(idx) == 0:
        return idx
    near = cKDTree(P).query_ball_point(P[idx], r)
    return np.unique(np.concatenate([np.asarray(x, int) for x in near] + [np.asarray(idx, int)]))


def densify(P, D, A, mask, s, inside_fn, need_mm=0.62, rounds=8, max_move=0.6, size=None):
    size = R.SS6 if size is None else size
    P, D, A = P.copy(), D.copy(), A.copy()
    tag = np.zeros(len(P), bool)
    hist = []
    for rd in range(rounds):
        cand = candidates(P, D, mask, s, need_mm, size=size)
        if len(cand) == 0:
            break
        n0 = len(P)
        P1 = np.concatenate([P, cand]); D1 = np.concatenate([D, np.full(len(cand), size)]); A1 = np.concatenate([A, cand])
        P1 = R.legalise(P1, D1, A1, iters=500, pull=0.002, maxmove=max_move + 0.3, active=_around(P1, np.arange(n0, len(P1)), 4.5))
        out = ~inside_fn(P1)
        P1[out] = np.concatenate([P, cand])[out]
        Pprev = np.concatenate([P, cand])
        for _ in range(6):
            cnt, _ = R.violations(P1, D1)
            if cnt.sum() == 0:
                break
            bad = np.nonzero(cnt > 0)[0]
            newb = bad[bad >= n0]; oldb = bad[bad < n0]
            if len(newb):
                keepm = np.ones(len(P1), bool); keepm[newb] = False
                P1, D1, A1, Pprev = P1[keepm], D1[keepm], A1[keepm], Pprev[keepm]
            else:
                P1 = R.legalise(P1, D1, A1, iters=300, pull=0.0, maxmove=max_move + 0.3, active=_around(P1, np.nonzero(R.violations(P1, D1)[0] > 0)[0], 4.5))
        cnt, _ = R.violations(P1, D1)
        if cnt.sum():
            mn = np.r_[np.zeros(n0, bool), np.ones(len(P1) - n0, bool)]
            P1, D1, A1x, kk = R.resolve_idx(P1, D1.copy(), A1, np.ones(len(P1)), mn)
            A1 = A1[kk]
            n_new = int((kk >= n0).sum())
        else:
            n_new = len(P1) - n0
        P, D, A = P1, D1, A1
        hist.append((len(cand), n_new))
        print('round', rd + 1, 'candidates', len(cand), 'inserted', n_new, 'stones', len(P), flush=True)
        if n_new < 3:
            break
    return P, D, A, hist


def tighten(P, D, A, mask, s, inside_fn, edge_fn, base_anchor, needs=(0.62, 0.55, 0.5, 0.45), log=print):
    P, D, A = P.copy(), D.copy(), A.copy()
    for need in needs:
        ka = np.where(edge_fn(A) < 1.5, 0.15, base_anchor)
        P = relax(P, D, A, inside_fn, ka, iters=200)
        P, D, A1, kk = R.resolve_idx(P, D.copy(), A, np.ones(len(P)), np.zeros(len(P), bool)); A = A[kk]
        up = upgrade(P, D)
        P, D, A, hist = densify(P, D, A, mask, s, inside_fn, need_mm=need)
        hm, cov = R.holes(P, D, mask, s)
        log(f'need {need}: stones {len(P)}, ss4->ss6 {up}, coverage {cov:.3f}')
    return P, D, A


def strict_mask(a, mask):
    from scipy import ndimage as ndi
    m = ndi.gaussian_filter(a, 2) > 0.25
    m = ndi.binary_closing(m, iterations=2)
    m = R.fill_small_holes(m, 400)
    return m & mask


def tighten_file(name, jf, mode, out, needs=(0.62, 0.55, 0.5)):
    from scipy import ndimage as ndi
    js = json.load(open(jf)); st = js['stones']; rep = js['report']; s = rep['mm_per_px']
    rgb, a = R.load(name); det = np.load(f'{W}{name}_fused.npy')
    mask = strict_mask(a, R.subject_mask(a, det, R.TARGET_PITCH / s)); h, w = mask.shape
    ix = lambda P: (np.clip((P[:, 1] / s).astype(int), 0, h - 1), np.clip((P[:, 0] / s).astype(int), 0, w - 1))
    tight = ndi.binary_dilation(R._ALPHA > 0.5, iterations=2) & mask
    inside = lambda P: tight[ix(P)]
    ed = ndi.distance_transform_edt(mask) * s; edge = lambda P: ed[ix(P)]
    Po = np.array([[q['x'], q['y']] for q in st]); Do = np.array([q['d'] for q in st]); Co = [q['color'] for q in st]
    P, D = Po.copy(), Do.copy()
    P, D, A = densify(P, D, P.copy(), mask, s, inside, need_mm=0.65)[:3]
    P, D, A = tighten(P, D, A, mask, s, inside, edge, 0.02 if mode == 'det' else 0.005, needs=needs)
    for need4 in (0.55, 0.45, 0.4):
        P, D, A = densify(P, D, A, mask, s, inside, need_mm=need4, size=R.SS4)[:3]
    fP, fD = R.fill(P, D, mask, s)
    P = np.concatenate([P, fP]); D = np.concatenate([D, fD])
    P, D, _, _ = R.resolve_idx(P, D.copy(), P.copy(), np.ones(len(P)), np.zeros(len(P), bool))
    upgrade(P, D)
    t = cKDTree(Po); dd, ii = t.query(P)
    if mode == 'det':
        col = R.stone_colours(rgb, a, det); keepd = 2 * det[:, 2] * s >= 1.6
        lab = col[keepd][cKDTree(det[keepd][:, [1, 0]] * s).query(P)[1]]
    else:
        from flowrun import sample
        rgbm = cv2.medianBlur((np.clip(rgb * a[..., None] + (1 - a[..., None]), 0, 1) * 255).astype(np.uint8), 5)
        lab = sample(rgb2lab(rgbm / 255.0), P, D, s)
    ids, _ = R.snap_colours(lab)
    C = [Co[ii[k]] if dd[k] < 0.5 else ids[k] for k in range(len(P))]
    cnt, g = R.violations(P, D); hm, cov = R.holes(P, D, mask, s)
    rep2 = dict(rep); rep2.update({'stones': int(len(P)), 'ss6': int((D == R.SS6).sum()), 'ss4': int((D == R.SS4).sum()),
                                   'min_gap_mm': float(g), 'gap_violations': int(cnt.sum() // 2), 'largest_empty_circle_mm': float(hm),
                                   'coverage': float(cov), 'colours_used': len(set(C)), 'stones_before_tightening': int(len(Po))})
    stj = [{'x': round(float(x), 3), 'y': round(float(y), 3), 'size': 'ss6' if d_ == R.SS6 else 'ss4', 'd': float(d_), 'color': c,
            'src': 'kept' if dd[k] < 0.5 else 'added'} for k, ((x, y), d_, c) in enumerate(zip(P, D, C))]
    json.dump({'report': rep2, 'stones': stj}, open(out, 'w'))
    print({k: rep2[k] for k in ['stones', 'ss6', 'ss4', 'min_gap_mm', 'gap_violations', 'coverage']})
