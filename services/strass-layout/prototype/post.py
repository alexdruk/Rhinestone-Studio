import sys, json, os
import numpy as np, cv2
from collections import Counter
from scipy.spatial import cKDTree
import rs_fix as R, compact as K, pupils2 as P2, darkdots as DD
from landmarks import landmarks, load_onwhite

W = R.W
SZ = {1.5: 'ss4', 2.0: 'ss6', 2.8: 'ss10', 4.0: 'ss16', 4.7: 'ss20', 6.4: 'ss30'}


def eye_boxes(N):
    p = landmarks(load_onwhite(f'{W}img/{N}.png'))
    if p is None:
        return None
    out = []
    for sl in (slice(36, 42), slice(42, 48)):
        e = p[sl]; c = e.mean(0); wd = np.ptp(e[:, 0])
        out.append((c[0], c[1], max(wd, 20)))
    return out


def run(N, src_json, out_json):
    rgb, a = R.load(N)
    det = np.load(f'{W}{N}_fused.npy')
    js = json.load(open(src_json)); st = js['stones']; rep = dict(js['report'])
    s = rep['mm_per_px']
    mask = K.strict_mask(a, R.subject_mask(a, det, R.TARGET_PITCH / s))
    main_px = 2 * np.median(det[det[:, 2] >= np.median(det[:, 2]), 2])
    P = np.array([[q['x'], q['y']] for q in st]); D = np.array([q['d'] for q in st]); C = [q['color'] for q in st]
    keep = D <= 2.0
    P, D, C = P[keep], D[keep], [c for c, k in zip(C, keep) if k]

    cands = P2.find(N, s, main_px)
    boxes = eye_boxes(N)
    if boxes is not None:
        cands = [c for c in cands if any(np.hypot(c['x'] - bx, c['y'] - by) < 0.6 * bw for bx, by, bw in boxes)]
    if boxes is not None:
        Lim = cv2.cvtColor(load_onwhite(f'{W}img/{N}.png'), cv2.COLOR_RGB2LAB)[..., 0].astype(float) / 2.55
        from scipy import ndimage as ndi
        for bx, by, bw in boxes:
            if any(np.hypot(c['x'] - bx, c['y'] - by) < 0.6 * bw for c in cands):
                continue
            r0 = int(0.7 * bw); y0, y1 = int(max(0, by - r0)), int(by + r0); x0, x1 = int(max(0, bx - r0)), int(bx + r0)
            sub = Lim[y0:y1, x0:x1]
            for thr in (20, 28, 36):
                dk = ndi.binary_opening(sub < thr, iterations=1)
                if not dk.any():
                    continue
                dt = ndi.distance_transform_edt(dk); yy, xx = np.unravel_index(np.argmax(dt), dt.shape)
                Di = 2 * dt.max()
                if Di >= 1.3 * main_px:
                    hl = sub > 85
                    if hl.any():
                        hy, hx = np.nonzero(hl); k = np.argmin(np.hypot(hy - yy, hx - xx)); hy, hx = hy[k], hx[k]
                    else:
                        hy, hx = yy - Di / 3, xx + Di / 3
                    cands.append(dict(x=float(xx + x0), y=float(yy + y0), diam_mm=float(Di * s * 1.15), roundness=1.0, hx=float(hx + x0), hy=float(hy + y0)))
                    break
    if len(cands) == 2:
        d0, d1 = cands[0]['diam_mm'], cands[1]['diam_mm']
        if max(d0, d1) / min(d0, d1) < 1.6:
            for c in cands:
                c['diam_mm'] = (d0 + d1) / 2
    import eyes4 as E3
    pre = []; zones = []
    zones_src = []
    for c in cands:
        if os.environ.get('EYE_MODE') == 'copy':
            st_, z = E3.build_eye_copy(c, s, iris=boxes is None)
        else:
            st_, z = E3.build_eye(c, s, n_rings=2, iris=boxes is None)
        pre += st_; zones.append(z); zones_src += [(c['x'] * s, c['y'] * s, z[2], c['diam_mm'])] * len(st_)
    if pre:
        need = [k for k, p in enumerate(pre) if p[3] is None]
        if need:
            pp = np.array([pre[k][4] for k in need]); pd = np.array([pre[k][2] for k in need])
            lab_ = R.stone_colours(rgb, a, np.stack([pp[:, 1] / s, pp[:, 0] / s, np.full(len(pp), 0.3 / s), np.zeros(len(pp))], 1))
            ids_, _ = R.snap_colours(lab_)
            for k, cc in zip(need, ids_):
                pre[k] = (pre[k][0], pre[k][1], pre[k][2], cc, None)
        pre = [p[:4] for p in pre]
    rep['eyes'] = [[round(z[0], 2), round(z[1], 2), round(z[2], 2)] for z in zones]
    rep['pupils'] = [round(c['diam_mm'], 2) for c in cands]

    col = R.stone_colours(rgb, a, det)
    dmm = 2 * det[:, 2] * s
    good = dmm >= 1.6
    tg = cKDTree(det[good][:, [1, 0]] * s)
    dd, ii = tg.query(P)
    genuine = dd < 0.5

    if pre:
        prP = np.array([[p[0], p[1]] for p in pre]); prD = np.array([p[2] for p in pre]); prC = [p[3] for p in pre]
        drop = np.zeros(len(P), bool)
        for (zx, zy, zr) in zones:
            drop |= np.hypot(P[:, 0] - zx, P[:, 1] - zy) < zr + D / 2 + R.GAP + 0.02
        drop &= ~np.zeros(len(P), bool)
        P, D, C, genuine = P[~drop], D[~drop], [c for c, k in zip(C, drop) if not k], genuine[~drop]
        P = np.concatenate([P, prP]); D = np.concatenate([D, prD]); C = C + prC
        genuine = np.r_[genuine, np.ones(len(pre), bool)]
    if os.environ.get('LASHES') == '1' and boxes is not None:
        Lim2 = cv2.cvtColor(load_onwhite(f'{W}img/{N}.png'), cv2.COLOR_RGB2LAB)[..., 0].astype(float) / 2.55
        dm = 2 * det[:, 2] * s
        nadd = 0
        for bx, by, bw in boxes:
            for k in np.argsort(-dm):
                y_, x_, r_ = det[k, 0], det[k, 1], det[k, 2]
                if abs(x_ - bx) > 1.0 * bw or abs(y_ - by) > 0.7 * bw or dm[k] < 0.7 or dm[k] > 1.75:
                    continue
                if Lim2[int(y_), int(x_)] > 35:
                    continue
                p_ = np.array([x_ * s, y_ * s])
                dd_ = np.hypot(P[:, 0] - p_[0], P[:, 1] - p_[1]) - (D + R.SS4) / 2
                if dd_.min() >= R.GAP + 0.01:
                    P = np.vstack([P, p_]); D = np.r_[D, R.SS4]; C = C + ['jet']; genuine = np.r_[genuine, True]; pre = pre + [(p_[0], p_[1], R.SS4, 'jet')]; nadd += 1
        rep['lash_stones_added'] = nadd
    fixed = np.r_[np.zeros(len(P) - len(pre), bool), np.ones(len(pre), bool)]

    for _ in range(3):
        fP, fD = R.fill(P, D, mask, s)
        if not len(fP):
            break
        P = np.concatenate([P, fP]); D = np.concatenate([D, fD]); C = C + [None] * len(fP)
        genuine = np.r_[genuine, np.zeros(len(fP), bool)]; fixed = np.r_[fixed, np.zeros(len(fP), bool)]

    labS = R.stone_colours(rgb, a, np.stack([P[:, 1] / s, P[:, 0] / s, 0.42 * D / s, np.zeros(len(P))], 1))
    t = cKDTree(P)
    dark_ids = DD.DARK
    for i in [k for k in range(len(P)) if C[k] is None]:
        nb = [j for j in t.query_ball_point(P[i], 2.6) if j != i and C[j] is not None and not fixed[j]]
        if nb:
            cs = [C[j] for j in nb]
            light = [c for c in cs if c not in dark_ids]
            C[i] = Counter(light if len(light) >= 0.5 * len(cs) else cs).most_common(1)[0][0]
        else:
            C[i] = R.snap_colours(labS[i:i + 1])[0][0]
    Lg = np.full(len(P), 100.0)
    Lg[genuine & ~fixed] = col[good][ii[: len(dd)][0:0].astype(int)].mean() if False else 100.0
    genuine_dark = np.zeros(len(P), bool)
    gi = np.nonzero(genuine & ~fixed)[0]
    if len(gi):
        dd2, ii2 = tg.query(P[gi])
        genuine_dark[gi] = (col[good][ii2][:, 0] < 35) & (dmm[good][ii2] >= 1.7)
    import colsmooth as CS
    nsm = 0
    rep['colour_smoothed'] = int(nsm)
    before = DD.stats(P, D, C)
    C, changed = DD.clean(P, D, C, fixed=fixed | genuine_dark)
    nfft = 0
    for _ in range(5):
        C, nff = CS.family_fix(P, D, C, labS, fixed & np.array([c in ('jet', 'crystal-clear') for c in C]))
        nfft += nff
    rep['red_in_skin_fixed'] = int(nfft)
    after = DD.stats(P, D, C)

    for _ in range(5):
        cnt, g = R.violations(P, D)
        if cnt.sum() == 0:
            break
        tq = cKDTree(P); pr = tq.query_pairs(D.max() + R.GAP + 0.05, output_type='ndarray')
        gg = np.linalg.norm(P[pr[:, 0]] - P[pr[:, 1]], axis=1) - (D[pr[:, 0]] + D[pr[:, 1]]) / 2
        kill = set()
        for (i, j) in pr[gg < R.GAP - 1e-6]:
            if fixed[i] and fixed[j]:
                continue
            kill.add(int(j if (fixed[i] or (not fixed[j] and D[j] <= D[i])) else i))
        km = np.array([k not in kill for k in range(len(P))])
        P, D, C, fixed = P[km], D[km], [c for c, k in zip(C, km) if k], fixed[km]
    cnt, g = R.violations(P, D); hm, cov = R.holes(P, D, mask, s)
    rep.update({'stones': int(len(P)), 'by_size': {SZ[k]: int((D == k).sum()) for k in SZ if (D == k).any()},
                'min_gap_mm': float(g), 'gap_violations': int(cnt.sum() // 2), 'largest_empty_circle_mm': float(hm),
                'coverage': float(cov), 'colours_used': len(set(C)), 'dark_dots_recoloured': int(changed),
                'dark_components_before': before, 'dark_components_after': after})
    json.dump({'report': rep, 'stones': [{'x': round(float(x), 3), 'y': round(float(y), 3), 'size': SZ[float(d)], 'd': float(d), 'color': c}
                                          for (x, y), d, c in zip(P, D, C)]}, open(out_json, 'w'))
    return rep


if __name__ == '__main__':
    N = sys.argv[1]
    r = run(N, f'{W}{N}_up6_rs.json', f'{W}{N}_final_rs.json')
    print({k: r[k] for k in ['stones', 'by_size', 'min_gap_mm', 'gap_violations', 'coverage', 'pupils', 'dark_dots_recoloured', 'dark_components_after']})
