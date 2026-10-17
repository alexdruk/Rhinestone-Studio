import numpy as np
from collections import Counter
from scipy.spatial import cKDTree
from skimage.color import deltaE_ciede2000
import rs_fix as R


def smooth(P, D, C, lab, fixed, tol_abs=4.0, tol_rel=1.3, passes=2):
    ids = R.CAT_IDS
    d = np.stack([deltaE_ciede2000(lab, np.repeat(c[None], len(lab), 0), kL=R.KL, kH=R.KH) for c in R.CAT_LAB], 1)
    best = d.min(1)
    ok = (d <= best[:, None] + tol_abs) | (d <= best[:, None] * tol_rel)
    t = cKDTree(P)
    nb = t.query_ball_point(P, 2.7)
    C = list(C); changed = 0
    for _ in range(passes):
        for i in range(len(P)):
            if fixed[i]:
                continue
            cand = [ids[k] for k in np.nonzero(ok[i])[0]]
            if len(cand) < 2:
                continue
            cnt = Counter(C[j] for j in nb[i] if j != i)
            pick = max(cand, key=lambda c: (cnt.get(c, 0), -d[i, ids.index(c)]))
            if cnt.get(pick, 0) <= cnt.get(C[i], 0) or pick == C[i]:
                continue
            C[i] = pick; changed += 1
    return C, changed


FAMILY = {'light-peach': 'brown', 'light-colorado': 'brown', 'colorado-topaz': 'brown', 'smoked-topaz': 'brown',
          'light-smoked-topaz': 'brown', 'siam': 'red', 'light-siam': 'red', 'rose': 'pink', 'fuchsia': 'pink'}


def family_fix(P, D, C, lab, fixed, extra=14.0, share=0.4):
    ids = R.CAT_IDS
    d = np.stack([deltaE_ciede2000(lab, np.repeat(c[None], len(lab), 0), kL=R.KL, kH=R.KH) for c in R.CAT_LAB], 1)
    t = cKDTree(P); nb = t.query_ball_point(P, 6.0)
    C = list(C); changed = 0
    for i in range(len(P)):
        if fixed[i] or FAMILY.get(C[i]) != 'red':
            continue
        fam = Counter(FAMILY.get(C[j], C[j]) for j in nb[i] if j != i)
        tot = sum(fam.values())
        if tot == 0 or fam.get('brown', 0) / tot < share:
            continue
        browns = [k for k, c in enumerate(ids) if FAMILY.get(c) == 'brown']
        k = min(browns, key=lambda k: d[i, k])
        if d[i, k] <= d[i, ids.index(C[i])] + extra:
            C[i] = ids[k]; changed += 1
    return C, changed
