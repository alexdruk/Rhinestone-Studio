"""The ordered layout: OpenAI's own stone positions, pushed apart to the gap rule.

Ported from rs_fix.run. Detected stones become production stones: shadows, painted
gap dots, interstitial dots and stones inside big ones are dropped, big stones are
tiled, positions are legalised to gap >= 0.1 mm, holes OpenAI left are filled, and
every stone gets its nearest catalogue colour.
"""
import cv2
import numpy as np
from scipy.spatial import cKDTree
from skimage.color import deltaE_ciede2000, rgb2lab

from .colour import snap_colours, stone_colours
from .chains import chain_mask
from .errors import NoStones
from .geometry import GAP, SS4, SS6, fill, resolve_idx, subject_mask
from .rules import DEFAULT

CATCH_LAB = np.array([99.0, 0.0, 0.0])


def scale_from(pitch_mm, det):
    rb = np.median(det[det[:, 2] >= np.median(det[:, 2]), 2])
    m = det[det[:, 2] >= 0.75 * rb]
    d, _ = cKDTree(m[:, :2]).query(m[:, :2], 2)
    return pitch_mm / np.median(d[:, 1])


def ordered_layout(px, det, state, rules=DEFAULT):
    """Return a dict with mm-per-pixel s, the subject mask, the colours col, and the
    stones P (mm, rounded to 0.001 as the prototype wrote them), D (mm) and ids."""
    rgb, a = px.rgb, px.a
    pitch = state.pitch
    s = scale_from(pitch, det)
    pitch_px = pitch / s
    mask = subject_mask(a, det, pitch_px)
    col = stone_colours(rgb, a, det)
    d_mm = 2 * det[:, 2] * s
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
    gap_alpha_mean = float(a[gpx].mean()) if gpx.any() else 0.0
    if gap_alpha_mean > 0.5:
        glab = np.median(rgb2lab(rgb)[gpx & (a > 0.5)], 0)
        dg = deltaE_ciede2000(col, np.repeat(glab[None], len(col), 0))
        gapdrop = (d_mm < 1.6) & (dg < 12)
    mainm2 = d_mm >= 1.6
    inter = np.zeros(len(det), bool)
    if mainm2.sum() > 10:
        tm = cKDTree(det[mainm2][:, :2])
        rmain = det[mainm2][:, 2]
        main_d = np.median(2 * rmain)
        kq = min(6, int(mainm2.sum()))
        for i in np.nonzero(~mainm2)[0]:
            dd_, jj = tm.query(det[i, :2], kq)
            free = np.min(dd_ - rmain[jj])
            if 2 * free < 0.6 * main_d:
                inter[i] = True
    chain = chain_mask(det, col, s, rules)
    shadow &= ~chain
    inter &= ~chain
    use = ~tiny & ~inside_big & ~shadow & ~gapdrop & ~inter
    P, Dl, C, S, Mn = [], [], [], [], []
    sq3 = np.sqrt(3)
    for i in np.nonzero(use)[0]:
        y, x = det[i, 0] * s, det[i, 1] * s
        if big[i]:
            R = d_mm[i] / 2
            if R - SS6 / 2 + 0.25 >= pitch:
                dd, pt = SS6, pitch
            else:
                dd, pt = SS4, SS4 + GAP + 0.04
            tile = []
            for q in range(-5, 6):
                for rr_ in range(-5, 6):
                    px_ = (q + rr_ / 2) * pt
                    py_ = rr_ * pt * sq3 / 2
                    if np.hypot(px_, py_) <= max(0.0, R - dd / 2 + 0.25):
                        tile.append((px_, py_))
            catch = None
            if col[i][0] < 35 and len(tile) >= 7:
                cand = [t_ for t_ in tile if 0 < np.hypot(*t_) <= pt * 1.01]
                catch = max(cand, key=lambda t_: t_[0] - t_[1])
            for px_, py_ in tile:
                P.append((x + px_, y + py_))
                Dl.append(dd)
                S.append(9.0)
                Mn.append(False)
                C.append(CATCH_LAB if (px_, py_) == catch else col[i])
        else:
            P.append((x, y))
            Dl.append(SS4 if minor_det[i] else SS6)
            C.append(col[i])
            S.append(det[i, 3])
            Mn.append(bool(minor_det[i]))
    if not P:
        raise NoStones("No stone survived the ordered layout.")
    P, D, C, S, Mn = np.array(P), np.array(Dl), np.array(C), np.array(S), np.array(Mn)
    my = np.clip((P[:, 1] / s).astype(int), 0, a.shape[0] - 1)
    mx = np.clip((P[:, 0] / s).astype(int), 0, a.shape[1] - 1)
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
    A = P.copy()
    P2, D2, A2, keep_idx = resolve_idx(P, D.copy(), A, S.copy(), Mn.copy())
    C2 = C[keep_idx]
    fP, fD = fill(state, P2, D2, mask, s)
    keep_det = np.nonzero(use)[0]
    vor = cKDTree(det[keep_det][:, [1, 0]] * s)
    fC = col[keep_det][vor.query(fP)[1]] if len(fP) else np.zeros((0, 3))
    PP = np.concatenate([P2, fP])
    DD = np.concatenate([D2, fD])
    CC = np.concatenate([C2, fC])
    AA = PP.copy()
    AA[:len(P2)] = A2
    SS_ = np.r_[np.full(len(P2), 2.0), np.ones(len(fP))]
    MN = np.r_[np.zeros(len(P2), bool), np.ones(len(fP), bool)]
    P3, D3, A3, k3 = resolve_idx(PP, DD.copy(), AA, SS_, MN)
    CC = CC[k3]
    ids, _ = snap_colours(CC)
    P3 = np.array([[round(float(x), 3), round(float(y), 3)] for x, y in P3])
    return {"s": s, "mask": mask, "col": col, "P": P3, "D": D3, "ids": ids}
