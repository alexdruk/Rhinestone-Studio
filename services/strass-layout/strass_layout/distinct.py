"""Tone separation: k-means (14) on the stone colours, assigned to catalogue colours so
that clearly different tones of one hue family stay different. Skin tones stay in skin."""
import numpy as np
from sklearn.cluster import KMeans
from skimage.color import deltaE_ciede2000

from .colour import CAT_IDS, CAT_LAB, KH, KL, snap_colours, stone_colours

SKIN = {"light-peach", "light-colorado", "colorado-topaz", "smoked-topaz", "light-smoked-topaz", "topaz"}


def _fam(a, b):
    ids = CAT_IDS
    cat = CAT_LAB
    pa, pb = cat[ids.index(a)], cat[ids.index(b)]
    if (a in SKIN) != (b in SKIN):
        return False
    ca, cb = np.hypot(*pa[1:]), np.hypot(*pb[1:])
    if ca < 10 and cb < 10:
        return True
    if ca < 10 or cb < 10:
        return False
    ha = np.degrees(np.arctan2(pa[2], pa[1])) % 360
    hb = np.degrees(np.arctan2(pb[2], pb[1])) % 360
    return min(abs(ha - hb), 360 - abs(ha - hb)) < 25


def _distinct(C, lab, prot, k=14, sep=12.0, extra=12.0):
    ids = CAT_IDS
    cat = CAT_LAB
    free = np.nonzero(~prot)[0]
    if len(free) < k:
        return C, 0
    km = KMeans(k, n_init=3, random_state=0).fit(lab[free])
    cen = km.cluster_centers_
    cnt = np.bincount(km.labels_, minlength=k)
    d = np.stack([deltaE_ciede2000(cen, np.repeat(c[None], k, 0), kL=KL, kH=KH) for c in cat], 1)
    order = np.argsort(-cnt)
    assign = {}
    for ci in order:
        cands = np.argsort(d[ci])
        pick = cands[0]
        for cj, kk in assign.items():
            if kk == pick and deltaE_ciede2000(cen[ci], cen[cj]) > sep:
                for alt in cands[1:4]:
                    hp = np.degrees(np.arctan2(cat[pick, 2], cat[pick, 1])) % 360
                    ha = np.degrees(np.arctan2(cat[alt, 2], cat[alt, 1])) % 360
                    cp = np.hypot(*cat[pick, 1:])
                    ca = np.hypot(*cat[alt, 1:])
                    same = (cp < 10 and ca < 10) or (cp >= 10 and ca >= 10 and min(abs(hp - ha), 360 - abs(hp - ha)) < 25)
                    if ids[pick] in SKIN or ids[alt] in SKIN:
                        same = same and ids[pick] in SKIN and ids[alt] in SKIN
                    if same and d[ci, alt] <= d[ci, pick] + extra and alt not in assign.values():
                        pick = alt
                        break
                break
        assign[ci] = pick
    moved = {ci for ci in assign if assign[ci] != np.argmin(d[ci])}
    C = list(C)
    ch = 0
    for i, lbl in zip(free, km.labels_):
        new = ids[assign[lbl]]
        own = snap_colours(lab[i:i + 1])[0][0]
        if own != C[i]:
            continue
        if new != C[i] and (lbl in moved or _fam(C[i], new)):
            C[i] = new
            ch += 1
    return C, ch


def distinct_tones(rgb, a, s, P, D, C):
    """Colour ids after tone separation, for stones at P (mm), diameters D (mm) and ids C."""
    lab = stone_colours(rgb, a, np.stack([P[:, 1] / s, P[:, 0] / s, 0.42 * D / s, np.zeros(len(P))], 1))
    prot = np.array([d != 2.0 and d != 1.5 or c in ("jet",) for c, d in zip(C, D)])
    C2, _ = _distinct(C, lab, prot)
    return C2
