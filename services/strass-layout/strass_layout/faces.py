"""IMG-026I: finishing passes for faces, run after tone separation.

soften_outlines turns a person's black outline stones that sit on skin into Smoked Topaz, away
from the eyes. calm_skin gives a lone skin stone the shade most of its neighbours share, when
that shade is a close neighbour on the skin ramp.
"""
import numpy as np
from scipy.spatial import cKDTree
from skimage.color import deltaE_ciede2000

from .distinct import SKIN

BLACK = {"jet", "hematite", "black-diamond", "jet-hematite"}
REACH = 0.6


def _neighbours(P, D):
    t = cKDTree(P)
    out = []
    for i, p in enumerate(P):
        nb = [j for j in t.query_ball_point(p, D[i] / 2 + D.max() / 2 + REACH) if j != i]
        out.append([j for j in nb if np.hypot(*(P[j] - p)) <= (D[i] + D[j]) / 2 + REACH])
    return out


def _near_eye(p, eyes, k):
    return any(np.hypot(p[0] - x, p[1] - y) < k * r for x, y, r in eyes)


def soften_outlines(P, D, C, eyes, nb=None):
    """Recolour jet stones with at least 40 % of their neighbours in skin colours and at most two
    black neighbours, outside 2.2 eye-zone radii, to smoked-topaz. Returns (colours, count)."""
    nb = nb if nb is not None else _neighbours(P, D)
    out = list(C)
    n = 0
    for i, c in enumerate(C):
        if c != "jet" or not nb[i] or _near_eye(P[i], eyes, 2.2):
            continue
        cs = [C[j] for j in nb[i]]
        skin = sum(x in SKIN for x in cs)
        black = sum(x in BLACK for x in cs)
        if skin >= 0.4 * len(cs) and black <= 2:
            out[i] = "smoked-topaz"
            n += 1
    return out, n


def calm_skin(P, D, C, pal, eyes, nb=None, max_de=15.0):
    """Recolour a skin stone that shares its colour with no neighbour, has at least four
    neighbours, and has at least 60 % of them in one other skin colour within max_de ΔE2000 of
    its own, to that colour. Stones inside 1.5 eye-zone radii keep their colour."""
    nb = nb if nb is not None else _neighbours(P, D)
    out = list(C)
    n = 0
    for i, c in enumerate(C):
        if c not in SKIN or len(nb[i]) < 4 or _near_eye(P[i], eyes, 1.5):
            continue
        cs = [C[j] for j in nb[i]]
        if c in cs:
            continue
        vals, cnt = np.unique(cs, return_counts=True)
        k = int(np.argmax(cnt))
        x = vals[k]
        if x not in SKIN or cnt[k] < 0.6 * len(cs):
            continue
        a, b = pal.lab[pal.ids.index(c)], pal.lab[pal.ids.index(x)]
        if deltaE_ciede2000(a[None], b[None])[0] <= max_de:
            out[i] = str(x)
            n += 1
    return out, n


def finish_faces(P, D, C, pal, face, eyes, rules):
    nb = None
    if rules.soft_outlines and face == "human":
        nb = _neighbours(P, D)
        C, _ = soften_outlines(P, D, C, eyes, nb)
    if rules.calm_skin:
        nb = nb if nb is not None else _neighbours(P, D)
        C, _ = calm_skin(P, D, C, pal, eyes, nb)
    return C
