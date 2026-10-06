"""Recolours red stones that sit among brown (skin) stones to the nearest brown."""
from collections import Counter

import numpy as np
from scipy.spatial import cKDTree
from skimage.color import deltaE_ciede2000

from .colour import CAT_IDS, CAT_LAB, KH, KL

FAMILY = {"light-peach": "brown", "light-colorado": "brown", "colorado-topaz": "brown", "smoked-topaz": "brown",
          "light-smoked-topaz": "brown", "siam": "red", "light-siam": "red", "rose": "pink", "fuchsia": "pink"}


def family_fix(P, D, C, lab, fixed, extra=14.0, share=0.4):
    ids = CAT_IDS
    d = np.stack([deltaE_ciede2000(lab, np.repeat(c[None], len(lab), 0), kL=KL, kH=KH) for c in CAT_LAB], 1)
    t = cKDTree(P)
    nb = t.query_ball_point(P, 6.0)
    C = list(C)
    changed = 0
    for i in range(len(P)):
        if fixed[i] or FAMILY.get(C[i]) != "red":
            continue
        fam = Counter(FAMILY.get(C[j], C[j]) for j in nb[i] if j != i)
        tot = sum(fam.values())
        if tot == 0 or fam.get("brown", 0) / tot < share:
            continue
        browns = [k for k, c in enumerate(ids) if FAMILY.get(c) == "brown"]
        k = min(browns, key=lambda k: d[i, k])
        if d[i, k] <= d[i, ids.index(C[i])] + extra:
            C[i] = ids[k]
            changed += 1
    return C, changed
