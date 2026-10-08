"""Eyes, fill and colour clean-up on top of the ordered layout.

Ported from post.py (EYE_MODE=copy, LASHES on). Pupils and face landmarks give the
eye stones; holes are filled again against the strict subject mask; stones without
a colour take their neighbours' colour; isolated dark stones and red stones among
brown ones are recoloured; any remaining gap violation is removed.
"""
from collections import Counter

import cv2
import numpy as np
from scipy import ndimage as ndi
from scipy.spatial import cKDTree

from . import darkdots
from .colour import snap_colours, stone_colours
from .chains import chain_mask
from .colsmooth import family_fix
from .eyes import build_eye_copy, find_pupils
from .geometry import GAP, SS4, fill, strict_mask, violations
from .rules import DEFAULT

SIZE_KEYS = {1.5: "ss4", 2.0: "ss6", 2.8: "ss10", 4.0: "ss16", 4.7: "ss20", 6.4: "ss30"}


def _eye_boxes(px, models):
    p = models.landmarks(px.onwhite)
    if p is None:
        return None
    out = []
    for sl in (slice(36, 42), slice(42, 48)):
        e = p[sl]
        c = e.mean(0)
        wd = np.ptp(e[:, 0])
        out.append((c[0], c[1], max(wd, 20)))
    return out


def post_process(px, det, state, first, models, clock, rules=DEFAULT):
    """Return (stones, info). stones are dicts {x, y, size, d, color} in frame mm,
    rounded to 0.001 as the prototype wrote them; info has the strict mask and the
    eye data."""
    rgb, a = px.rgb, px.a
    s = first["s"]
    mask = strict_mask(a, first["mask"])
    main_px = 2 * np.median(det[det[:, 2] >= np.median(det[:, 2]), 2])
    P, D, C = first["P"], first["D"], list(first["ids"])
    keep = D <= 2.0
    P, D, C = P[keep], D[keep], [c for c, k in zip(C, keep) if k]

    cands = find_pupils(px, s, main_px, rules.pupil_core_only)
    boxes = _eye_boxes(px, models)
    Lim = None
    if boxes is not None:
        cands = [c for c in cands if any(np.hypot(c["x"] - bx, c["y"] - by) < 0.6 * bw for bx, by, bw in boxes)]
        Lim = cv2.cvtColor(px.onwhite, cv2.COLOR_RGB2LAB)[..., 0].astype(float) / 2.55
        for bx, by, bw in boxes:
            if any(np.hypot(c["x"] - bx, c["y"] - by) < 0.6 * bw for c in cands):
                continue
            r0 = int(0.7 * bw)
            y0, y1 = int(max(0, by - r0)), int(by + r0)
            x0, x1 = int(max(0, bx - r0)), int(bx + r0)
            sub = Lim[y0:y1, x0:x1]
            for thr in (20, 28, 36):
                dk = ndi.binary_opening(sub < thr, iterations=1)
                if not dk.any():
                    continue
                dt = ndi.distance_transform_edt(dk)
                yy, xx = np.unravel_index(np.argmax(dt), dt.shape)
                Di = 2 * dt.max()
                if Di >= 1.3 * main_px:
                    hl = sub > 85
                    if hl.any():
                        hy, hx = np.nonzero(hl)
                        k = np.argmin(np.hypot(hy - yy, hx - xx))
                        hy, hx = hy[k], hx[k]
                    else:
                        hy, hx = yy - Di / 3, xx + Di / 3
                    cands.append(dict(x=float(xx + x0), y=float(yy + y0), diam_mm=float(Di * s * 1.15), roundness=1.0, hx=float(hx + x0), hy=float(hy + y0)))
                    break
    if len(cands) == 2:
        d0, d1 = cands[0]["diam_mm"], cands[1]["diam_mm"]
        if max(d0, d1) / min(d0, d1) < 1.6:
            for c in cands:
                c["diam_mm"] = (d0 + d1) / 2
    pre = []
    zones = []
    for c in cands:
        st_, z = build_eye_copy(c, s, iris=boxes is None)
        pre += st_
        zones.append(z)
    if pre:
        need = [k for k, p in enumerate(pre) if p[3] is None]
        if need:
            pp = np.array([pre[k][4] for k in need])
            lab_ = stone_colours(rgb, a, np.stack([pp[:, 1] / s, pp[:, 0] / s, np.full(len(pp), 0.3 / s), np.zeros(len(pp))], 1))
            ids_, _ = snap_colours(lab_)
            for k, cc in zip(need, ids_):
                pre[k] = (pre[k][0], pre[k][1], pre[k][2], cc, None)
        pre = [p[:4] for p in pre]
    pupils = [round(c["diam_mm"], 2) for c in cands]

    col = first["col"]
    dmm = 2 * det[:, 2] * s
    good = dmm >= 1.6
    tg = cKDTree(det[good][:, [1, 0]] * s)
    dd, _ = tg.query(P)
    genuine = dd < 0.5

    n_fixed = len(pre)
    if pre:
        prP = np.array([[p[0], p[1]] for p in pre])
        prD = np.array([p[2] for p in pre])
        prC = [p[3] for p in pre]
        drop = np.zeros(len(P), bool)
        for (zx, zy, zr) in zones:
            drop |= np.hypot(P[:, 0] - zx, P[:, 1] - zy) < zr + D / 2 + GAP + 0.02
        P, D, C, genuine = P[~drop], D[~drop], [c for c, k in zip(C, drop) if not k], genuine[~drop]
        P = np.concatenate([P, prP])
        D = np.concatenate([D, prD])
        C = C + prC
        genuine = np.r_[genuine, np.ones(len(pre), bool)]
    if boxes is not None:
        for bx, by, bw in boxes:
            for k in np.argsort(-dmm):
                y_, x_, r_ = det[k, 0], det[k, 1], det[k, 2]
                if abs(x_ - bx) > 1.0 * bw or abs(y_ - by) > 0.7 * bw or dmm[k] < 0.7 or dmm[k] > 1.75:
                    continue
                if Lim[int(y_), int(x_)] > 35:
                    continue
                p_ = np.array([x_ * s, y_ * s])
                dd_ = np.hypot(P[:, 0] - p_[0], P[:, 1] - p_[1]) - (D + SS4) / 2
                if dd_.min() >= GAP + 0.01:
                    P = np.vstack([P, p_])
                    D = np.r_[D, SS4]
                    C = C + ["jet"]
                    genuine = np.r_[genuine, True]
                    n_fixed += 1
    fixed = np.r_[np.zeros(len(P) - n_fixed, bool), np.ones(n_fixed, bool)]
    clock.lap("eyes")

    for _ in range(3):
        fP, fD = fill(state, P, D, mask, s)
        if not len(fP):
            break
        P = np.concatenate([P, fP])
        D = np.concatenate([D, fD])
        C = C + [None] * len(fP)
        genuine = np.r_[genuine, np.zeros(len(fP), bool)]
        fixed = np.r_[fixed, np.zeros(len(fP), bool)]

    labS = stone_colours(rgb, a, np.stack([P[:, 1] / s, P[:, 0] / s, 0.42 * D / s, np.zeros(len(P))], 1))
    t = cKDTree(P)
    dark_ids = darkdots.DARK
    for i in [k for k in range(len(P)) if C[k] is None]:
        nb = [j for j in t.query_ball_point(P[i], 2.6) if j != i and C[j] is not None and not fixed[j]]
        if nb:
            cs = [C[j] for j in nb]
            light = [c for c in cs if c not in dark_ids]
            C[i] = Counter(light if len(light) >= 0.5 * len(cs) else cs).most_common(1)[0][0]
        else:
            C[i] = snap_colours(labS[i:i + 1])[0][0]
    genuine_dark = np.zeros(len(P), bool)
    gi = np.nonzero(genuine & ~fixed)[0]
    if len(gi):
        dd2, ii2 = tg.query(P[gi])
        genuine_dark[gi] = (col[good][ii2][:, 0] < 35) & (dmm[good][ii2] >= 1.7)
    chain = chain_mask(det, col, s, rules)
    if chain.any():
        near, _ = cKDTree(det[chain][:, [1, 0]] * s).query(P)
        genuine_dark |= near < 0.5
    C, _ = darkdots.clean(P, D, C, fixed=fixed | genuine_dark)
    for _ in range(5):
        C, _ = family_fix(P, D, C, labS, fixed & np.array([c in ("jet", "crystal-clear") for c in C]))
    clock.lap("colour")

    for _ in range(5):
        cnt, g = violations(P, D)
        if cnt.sum() == 0:
            break
        tq = cKDTree(P)
        pr = tq.query_pairs(D.max() + GAP + 0.05, output_type="ndarray")
        gg = np.linalg.norm(P[pr[:, 0]] - P[pr[:, 1]], axis=1) - (D[pr[:, 0]] + D[pr[:, 1]]) / 2
        kill = set()
        for (i, j) in pr[gg < GAP - 1e-6]:
            if fixed[i] and fixed[j]:
                continue
            kill.add(int(j if (fixed[i] or (not fixed[j] and D[j] <= D[i])) else i))
        km = np.array([k not in kill for k in range(len(P))])
        P, D, C, fixed = P[km], D[km], [c for c, k in zip(C, km) if k], fixed[km]
    stones = [{"x": round(float(x), 3), "y": round(float(y), 3), "size": SIZE_KEYS[float(d)], "d": float(d), "color": c}
              for (x, y), d, c in zip(P, D, C)]
    clock.lap("check")
    info = {"mask": mask, "face": "human" if boxes is not None else "animal", "pupilsMm": pupils}
    return stones, info
