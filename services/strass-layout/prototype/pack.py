import sys, json, os
import numpy as np, cv2
from PIL import Image
from scipy import ndimage as ndi
from scipy.spatial import cKDTree
from skimage.color import rgb2lab
import rs_fix as R
import compact as K
from flow import orientation_field, Field, streamlines

W = R.W
TARGET = R.GAP + 0.005


def staggered_stones(lines, pitch_fn, placed_tree_pts, dmin_fn, n_off=10):
    pts_all = list(placed_tree_pts)
    tree = cKDTree(np.array(pts_all)) if pts_all else None
    out = []
    since = 0
    for ln in lines:
        seg = np.linalg.norm(np.diff(ln, axis=0), axis=1)
        s = np.r_[0, np.cumsum(seg)]
        L = s[-1]
        if L < 0.3:
            continue
        mid = ln[len(ln) // 2]
        pitch = pitch_fn(mid)
        best, best_sc = None, -1e9
        for k in range(n_off):
            off = (k / n_off) * pitch
            ts = np.arange(off, L + 1e-6, pitch)
            if len(ts) == 0:
                continue
            P = np.stack([np.interp(ts, s, ln[:, 0]), np.interp(ts, s, ln[:, 1])], 1)
            if tree is not None:
                d, _ = tree.query(P)
                sc = np.minimum(d, pitch).sum() - 0.0 * len(P)
                sc += 0.4 * pitch * len(P)
            else:
                sc = len(P)
            if sc > best_sc:
                best_sc, best = sc, P
        if best is None:
            continue
        out.extend(best.tolist()); pts_all.extend(best.tolist())
        since += 1
        if since >= 5:
            tree = cKDTree(np.array(pts_all)); since = 0
        else:
            tree = cKDTree(np.array(pts_all))
    return np.array(out).reshape(-1, 2)


def spring(P, D, inside_fn, iters=400, k=0.5, reach=0.7, step_max=0.04, fixed=None, anchor=None, k_anchor=0.0):
    P = P.copy()
    pairs = None
    for it in range(iters):
        if it % 10 == 0:
            pairs = cKDTree(P).query_pairs(D.max() + reach, output_type='ndarray')
        i, j = pairs[:, 0], pairs[:, 1]
        dv = P[j] - P[i]
        dist = np.linalg.norm(dv, axis=1) + 1e-9
        u = dv / dist[:, None]
        g = dist - (D[i] + D[j]) / 2
        act = g < reach
        f = np.where(act, g - TARGET, 0.0)
        f = np.where(f < 0, 2.0 * f, k * f)
        F = np.zeros_like(P); c = np.zeros(len(P))
        np.add.at(F, i, u * f[:, None]); np.add.at(F, j, -u * f[:, None])
        np.add.at(c, i, act); np.add.at(c, j, act)
        mv = F / np.maximum(c, 1)[:, None]
        if anchor is not None:
            mv += k_anchor * (anchor - P)
        n = np.linalg.norm(mv, axis=1)
        b = n > step_max
        mv[b] *= (step_max / n[b])[:, None]
        if fixed is not None:
            mv[fixed] = 0
        Pn = P + mv
        ok = inside_fn(Pn)
        P[ok] = Pn[ok]
    return P


def setup(name):
    rgb, a = R.load(name)
    det = np.load(f'{W}{name}_fused.npy')
    s = R.scale_from(det)
    mask = K.strict_mask(a, R.subject_mask(a, det, R.TARGET_PITCH / s))
    return rgb, a, det, s, mask


def build(name, field_img_lab, colour_lab, size_map, out, detail_ss4=None, log=print, cycles=3, pre=None):
    rgb, a, det, s, mask = setup(name)
    full_mask = mask.copy()
    if pre:
        mask = mask.copy()
        for (px, py, pd, pc) in pre:
            cv2.circle(mask.view(np.uint8), (int(round(px / s)), int(round(py / s))), int(np.ceil((pd / 2 + R.GAP + 0.03) / s)), 0, -1)
    h, w = mask.shape
    ix = lambda P: (np.clip((P[:, 1] / s).astype(int), 0, h - 1), np.clip((P[:, 0] / s).astype(int), 0, w - 1))
    inside_fn = lambda P: mask[ix(P)]
    pitch_px = R.TARGET_PITCH / s
    ang, coh = orientation_field(field_img_lab, mask, pitch_px)
    f = Field(ang, s)
    H, Wd = h * s, w * s
    sizes = sorted(set(np.unique(size_map[mask]).tolist()), reverse=True)
    P_all = np.zeros((0, 2)); D_all = np.zeros(0)
    for d in sizes:
        zone = (size_map == d) & mask
        if zone.sum() < (d / s) ** 2:
            continue
        zone_e = zone

        def inside_z(p, zone_e=zone_e, d=d):
            x, y = p[0] / s, p[1] / s
            if not (0 <= x < w and 0 <= y < h) or not zone_e[int(y), int(x)]:
                return False
            if len(P_all):
                dd, ii = treeA.query(p)
                if dd < (d + D_all[ii]) / 2 + R.GAP:
                    return False
            return True
        treeA = cKDTree(P_all) if len(P_all) else None
        pitch = d + R.GAP + 0.01
        dsep = pitch * np.sqrt(3) / 2
        lines = streamlines(f, inside_z, Wd, H, dsep, step=0.25)
        Pz = staggered_stones(lines, lambda p: pitch, [], None)
        if len(Pz):
            ok = np.array([inside_z(p) for p in Pz])
            Pz = Pz[ok]
        P_all = np.concatenate([P_all, Pz]); D_all = np.concatenate([D_all, np.full(len(Pz), d)])
        log(f'size {d}: {len(Pz)} stones on {len(lines)} rows')
    n0 = len(P_all)
    hm, cov0 = R.holes(P_all, D_all, mask, s)
    log(f'rows only: {n0} stones, coverage {cov0:.3f}')
    for cyc in range(cycles):
        P_all = spring(P_all, D_all, inside_fn)
        P_all = R.legalise(P_all, D_all, P_all.copy(), iters=400, pull=0.0, maxmove=0.6)
        P_all, D_all, _, kk = R.resolve_idx(P_all, D_all.copy(), P_all.copy(), np.ones(len(P_all)), np.zeros(len(P_all), bool))
        P_all, D_all, _ = K.densify(P_all, D_all, P_all.copy(), mask, s, inside_fn, need_mm=[0.62, 0.52, 0.45][min(cyc, 2)])[:3]
        hm, cov = R.holes(P_all, D_all, mask, s)
        log(f'cycle {cyc + 1}: {len(P_all)} stones, coverage {cov:.3f}')
    fP, fD = R.fill(P_all, D_all, mask, s)
    P_all = np.concatenate([P_all, fP]); D_all = np.concatenate([D_all, fD])
    P_all, D_all, _, _ = R.resolve_idx(P_all, D_all.copy(), P_all.copy(), np.ones(len(P_all)), np.zeros(len(P_all), bool))
    from flowrun import sample
    lab = sample(colour_lab, P_all, D_all, s)
    ids, de = R.snap_colours(lab)
    if pre:
        prP = np.array([[p[0], p[1]] for p in pre]); prD = np.array([p[2] for p in pre])
        prC = []
        for p in pre:
            if p[3] is None:
                i_, _ = R.snap_colours(sample(colour_lab, np.array([[p[0], p[1]]]), np.array([p[2]]), s))
                prC.append(i_[0])
            else:
                prC.append(p[3])
        P_all = np.concatenate([P_all, prP]); D_all = np.concatenate([D_all, prD]); ids = list(ids) + prC
        de = np.r_[de, np.zeros(len(pre))]
        mask = full_mask
        npre = len(pre); isp = np.r_[np.zeros(len(P_all) - npre, bool), np.ones(npre, bool)]
        t_ = cKDTree(P_all)
        drop = np.zeros(len(P_all), bool)
        for k in np.nonzero(isp)[0]:
            for j in t_.query_ball_point(P_all[k], (D_all[k] + D_all.max()) / 2 + R.GAP + 0.01):
                if not isp[j] and np.linalg.norm(P_all[j] - P_all[k]) < (D_all[j] + D_all[k]) / 2 + R.GAP:
                    drop[j] = True
        P_all, D_all, ids, de = P_all[~drop], D_all[~drop], [c for c, d_ in zip(ids, drop) if not d_], de[~drop]
        fP, fD = R.fill(P_all, D_all, mask, s)
        if len(fP):
            fi, fde = R.snap_colours(sample(colour_lab, fP, fD, s))
            P_all = np.concatenate([P_all, fP]); D_all = np.concatenate([D_all, fD]); ids = list(ids) + list(fi); de = np.r_[de, fde]
        log(f'pre-placed {npre}, dropped {int(drop.sum())} conflicting, refilled {len(fP)}')
        for _ in range(5):
            t_ = cKDTree(P_all); pr = t_.query_pairs(D_all.max() + R.GAP + 0.05, output_type='ndarray')
            if len(pr) == 0:
                break
            g_ = np.linalg.norm(P_all[pr[:, 0]] - P_all[pr[:, 1]], axis=1) - (D_all[pr[:, 0]] + D_all[pr[:, 1]]) / 2
            bad = pr[g_ < R.GAP - 1e-6]
            if len(bad) == 0:
                break
            kill = set(int(i if D_all[i] <= D_all[j] else j) for i, j in bad)
            keep_ = np.array([k not in kill for k in range(len(P_all))])
            P_all, D_all, ids, de = P_all[keep_], D_all[keep_], [c for c, k_ in zip(ids, keep_) if k_], de[keep_]
        fP, fD = R.fill(P_all, D_all, mask, s)
        if len(fP):
            fi, fde = R.snap_colours(sample(colour_lab, fP, fD, s))
            P_all = np.concatenate([P_all, fP]); D_all = np.concatenate([D_all, fD]); ids = list(ids) + list(fi); de = np.r_[de, fde]
        for _ in range(5):
            t_ = cKDTree(P_all); pr = t_.query_pairs(D_all.max() + R.GAP + 0.05, output_type='ndarray')
            if len(pr) == 0:
                break
            g_ = np.linalg.norm(P_all[pr[:, 0]] - P_all[pr[:, 1]], axis=1) - (D_all[pr[:, 0]] + D_all[pr[:, 1]]) / 2
            bad = pr[g_ < R.GAP - 1e-6]
            if len(bad) == 0:
                break
            kill = set(int(i if D_all[i] <= D_all[j] else j) for i, j in bad)
            keep_ = np.array([k not in kill for k in range(len(P_all))])
            P_all, D_all, ids, de = P_all[keep_], D_all[keep_], [c for c, k_ in zip(ids, keep_) if k_], de[keep_]
    cnt, g = R.violations(P_all, D_all); hm, cov = R.holes(P_all, D_all, mask, s)
    sz = {2.0: 'ss6', 1.5: 'ss4', 2.8: 'ss10', 4.0: 'ss16'}
    rep = {'name': name, 'mm_per_px': s, 'width_mm': Wd, 'height_mm': H, 'stones': int(len(P_all)),
           'by_size': {sz[k]: int((D_all == k).sum()) for k in sz if (D_all == k).any()},
           'min_gap_mm': float(g), 'gap_violations': int(cnt.sum() // 2), 'largest_empty_circle_mm': float(hm),
           'coverage': float(cov), 'colours_used': len(set(ids)), 'colour_snap_dE_median': float(np.median(de))}
    stj = [{'x': round(float(x), 3), 'y': round(float(y), 3), 'size': sz[float(d)], 'd': float(d), 'color': c}
           for (x, y), d, c in zip(P_all, D_all, ids)]
    json.dump({'report': rep, 'stones': stj}, open(out, 'w'))
    log(json.dumps(rep))
    return rep


def openai_sources(name):
    rgb, a = R.load(name)
    on_white = np.clip(rgb * a[..., None] + (1 - a[..., None]), 0, 1)
    lab = rgb2lab(on_white)
    rgbm = cv2.medianBlur((on_white * 255).astype(np.uint8), 5)
    return lab, rgb2lab(rgbm / 255.0)


def detail_map(lab, mask, s, pct=7):
    pitch_px = R.TARGET_PITCH / s
    Lmed = cv2.medianBlur(np.clip(lab[..., 0] * 2.55, 0, 255).astype(np.uint8), 5).astype(float) / 2.55
    e = ndi.gaussian_filter(np.abs(ndi.gaussian_filter(Lmed, 0.5 * pitch_px) - ndi.gaussian_filter(Lmed, 1.2 * pitch_px)), 0.7 * pitch_px)
    return e


if __name__ == '__main__':
    name, tag = sys.argv[1], sys.argv[2]
    rgb, a, det, s, mask = setup(name)
    flab, clab = openai_sources(name)
    e = detail_map(flab, mask, s)
    core = ndi.binary_erosion(mask, iterations=int(R.TARGET_PITCH / s))
    Z = ndi.binary_opening((e > np.percentile(e[mask], 93)) & core, iterations=2)
    size_map = np.where(Z, R.SS4, R.SS6)
    build(name, flab, clab, size_map, f'{W}{name}_{tag}_rs.json')
