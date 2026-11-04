"""IMG-026I, J and M: finishing passes for faces, run after tone separation.

skin_nearest (IMG-026J) gives every SS4 or SS6 skin and fur stone the skin colour nearest its own
mean colour, undoing the tone-separation moves inside the skin ramp.

soften_outlines turns a person's black outline stones that sit on skin into Smoked Topaz, away
from the eyes. calm_skin gives a lone skin stone the shade most of its neighbours share, when
that shade is a close neighbour on the skin ramp.

IMG-026M (from IS): Rules.warm_shadow (IS-05d) lets skin_nearest prefer Colorado Topaz to a near-tie
Smoked Topaz; Rules.lone_white_skin (IS PN-04h, lone_white_skin, after calm_skin) gives a lone white
stone in skin, which reads as a hole, its skin neighbours' colour.

RS-3044: Rules.pale_skin (pale_skin, after lone_white_skin, on a person's face) gives a stone the AI
painted in its pale cream lit-skin colour, which the snap split into whites and golds, the skin colour
nearest its read colour. RS-3045 (from IS PN-11, commit 6e097d5): only in small groups (at most
Rules.pale_skin_group stones) whose outside neighbours are at least half light skin colours
(catalogue L* at least Rules.pale_skin_min_l), in one pass, so it no longer creeps into white fur.
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


# IMG-026M (IS-05d): the two stones the AI's shadow skin lies between (Rules.warm_shadow).
SMOKED, COLORADO = "smoked-topaz", "colorado-topaz"


def skin_nearest(D, C, lab, pal, warm_de=None):
    """Recolour each SS4 or SS6 stone whose colour is in distinct.SKIN to the SKIN colour (Topaz
    excepted) nearest its Lab colour in ΔE2000. Returns (colours, count).

    IMG-026M (IS-05d): with warm_de (Rules.warm_shadow), a stone whose nearest is Smoked Topaz takes
    Colorado Topaz when that is at most warm_de further away."""
    ids = [k for k in pal.ids if k in SKIN and k != "topaz"]
    cat = pal.lab[[pal.ids.index(k) for k in ids]]
    out = list(C)
    n = 0
    for i, c in enumerate(C):
        if c not in SKIN or D[i] not in (1.5, 2.0):
            continue
        de = deltaE_ciede2000(np.repeat(lab[i][None], len(ids), 0), cat)
        new = ids[int(np.argmin(de))]
        if warm_de is not None and new == SMOKED and de[ids.index(COLORADO)] - de.min() <= warm_de:
            new = COLORADO
        if new != c:
            out[i] = new
            n += 1
    return out, n


# IMG-026M (IS PN-04h): the near-white stones lone_white_skin recolours.
WHITE = {"crystal-clear", "crystal", "silver"}


def lone_white_skin(P, D, C, pal, eyes, nb=None):
    """IMG-026M (IS PN-04h): an SS4 or SS6 WHITE stone with at least four neighbours, all of them in
    skin colours, outside 1.5 eye-zone radii (so a pupil's catch-light stays), takes the colour most
    of its neighbours have (on a tie the lighter one). The AI paints such a stone as a highlight on
    skin; in stones it reads as a hole. Returns (colours, count)."""
    nb = nb if nb is not None else _neighbours(P, D)
    out = list(C)
    n = 0
    for i, c in enumerate(C):
        if c not in WHITE or D[i] not in (1.5, 2.0) or len(nb[i]) < 4 or _near_eye(P[i], eyes, 1.5):
            continue
        cs = [C[j] for j in nb[i]]
        if not all(x in SKIN for x in cs):
            continue
        vals, cnt = np.unique(cs, return_counts=True)
        best = [str(v) for v, k in zip(vals, cnt) if k == cnt.max()]
        out[i] = max(best, key=lambda k: pal.lab[pal.ids.index(k)][0])
        n += 1
    return out, n


# RS-3044: the read colour of the AI's pale cream lit skin: L* above PALE_L, chroma and hue (degrees)
# within PALE_CHROMA and PALE_HUE, both ends included.
PALE_L = 85.0
PALE_CHROMA = (8.0, 40.0)
PALE_HUE = (25.0, 100.0)
# RS-3045 (IS PN-11 follow-up): the largest group pale_skin changes (Rules.pale_skin_group) and the
# fewest outside neighbours a group needs.
PALE_GROUP = 4
PALE_MIN_OUTSIDE = 4
# RS-3045 (IS PN-11 second follow-up): an outside neighbour counts as skin only in a skin colour whose
# catalogue L* is at least this (Rules.pale_skin_min_l; at 70 Silk and Light Peach).
PALE_MIN_L = 70.0


def is_pale_cream(lab):
    """RS-3044: True for each Lab colour that is pale warm cream (PALE_L, PALE_CHROMA, PALE_HUE)."""
    lab = np.atleast_2d(np.asarray(lab, float))
    chroma = np.hypot(lab[:, 1], lab[:, 2])
    hue = np.degrees(np.arctan2(lab[:, 2], lab[:, 1])) % 360
    return ((lab[:, 0] > PALE_L) & (chroma >= PALE_CHROMA[0]) & (chroma <= PALE_CHROMA[1])
            & (hue >= PALE_HUE[0]) & (hue <= PALE_HUE[1]))


def pale_groups(P, D, C, lab, eyes, nb=None):
    """RS-3045 (IS PN-11 follow-up): the candidates of pale_skin, found once: SS4 or SS6 stones outside
    1.5 eye-zone radii whose colour is not a skin colour and whose read colour (lab, inner 60 %) is pale
    warm cream (is_pale_cream), grouped so that neighbouring candidates (_neighbours) share a group.
    Returns a list of groups, each a sorted list of stone indices."""
    nb = nb if nb is not None else _neighbours(P, D)
    pale = is_pale_cream(lab)
    cand = {i for i in range(len(C)) if pale[i] and D[i] in (1.5, 2.0) and C[i] not in SKIN and not _near_eye(P[i], eyes, 1.5)}
    groups, seen = [], set()
    for i in sorted(cand):
        if i in seen:
            continue
        group, todo = [], [i]
        seen.add(i)
        while todo:
            k = todo.pop()
            group.append(k)
            for j in nb[k]:
                if j in cand and j not in seen:
                    seen.add(j)
                    todo.append(j)
        groups.append(sorted(group))
    return groups


def light_skin(pal, min_l=PALE_MIN_L):
    """RS-3045 (IS PN-11 second follow-up): the skin colours (distinct.SKIN) whose catalogue L* is at
    least min_l."""
    return {k for k in pal.ids if k in SKIN and pal.lab[pal.ids.index(k)][0] >= min_l}


def pale_skin(P, D, C, lab, pal, eyes, nb=None, group=PALE_GROUP, min_l=PALE_MIN_L):
    """RS-3044, by small groups since RS-3045 (IS PN-11 follow-ups): the stones the AI painted in its
    pale cream lit skin. A group of pale_groups changes when it has at most `group` stones and at least
    PALE_MIN_OUTSIDE outside neighbours (stones touching the group that are not in it, each counted
    once), of which at least half are light skin colours (light_skin, catalogue L* at least min_l, so
    tan fur and copper hair do not count): then each of its stones takes the skin colour (distinct.SKIN,
    Topaz excepted, as skin_nearest) nearest its own read colour in ΔE2000. One pass, on the colours
    before the rule; a larger group (fur, a white animal) stays. Returns (colours, count)."""
    nb = nb if nb is not None else _neighbours(P, D)
    ids = [k for k in pal.ids if k in SKIN and k != "topaz"]
    cat = pal.lab[[pal.ids.index(k) for k in ids]]
    light = light_skin(pal, min_l)
    out = list(C)
    n = 0
    for g in pale_groups(P, D, C, lab, eyes, nb):
        if len(g) > group:
            continue
        inside = set(g)
        outside = {j for k in g for j in nb[k]} - inside
        if len(outside) < PALE_MIN_OUTSIDE or sum(C[j] in light for j in outside) < 0.5 * len(outside):
            continue
        for i in g:
            out[i] = ids[int(np.argmin(deltaE_ciede2000(np.repeat(lab[i][None], len(ids), 0), cat)))]
            n += 1
    return out, n


# RS-3044's rule in rounds, kept for BUILD_RS3044 only (Rules.pale_skin_rounds; RS-3045 replaced it).
PALE_ROUNDS = 5


def pale_skin_rounds(P, D, C, lab, pal, eyes, nb=None, rounds=PALE_ROUNDS):
    """RS-3044 (BUILD_RS3044 only since RS-3045): an SS4 or SS6 stone outside 1.5 eye-zone radii whose
    read colour (lab, inner 60 %) is pale warm cream (is_pale_cream) and whose colour is not a skin
    colour, with at least four neighbours of which at least half are in skin colours, takes the skin
    colour (distinct.SKIN, Topaz excepted, as skin_nearest) nearest its read colour in ΔE2000. Each
    round reads the colours the round before left, so pairs and triples of such stones change from
    their edge inward; it repeats until no stone changes, at most `rounds` rounds. Returns (colours, count)."""
    nb = nb if nb is not None else _neighbours(P, D)
    ids = [k for k in pal.ids if k in SKIN and k != "topaz"]
    cat = pal.lab[[pal.ids.index(k) for k in ids]]
    pale = is_pale_cream(lab)
    cand = [i for i in range(len(C)) if pale[i] and D[i] in (1.5, 2.0) and len(nb[i]) >= 4 and not _near_eye(P[i], eyes, 1.5)]
    out = list(C)
    changed = set()
    for _ in range(rounds):
        now = {}
        for i in cand:
            if out[i] in SKIN:
                continue
            if sum(out[j] in SKIN for j in nb[i]) >= 0.5 * len(nb[i]):
                now[i] = ids[int(np.argmin(deltaE_ciede2000(np.repeat(lab[i][None], len(ids), 0), cat)))]
        if not now:
            break
        for i, c in now.items():
            out[i] = c
        changed.update(now)
    return out, len(changed)


def finish_faces(P, D, C, pal, face, eyes, rules, lab=None):
    nb = None
    if rules.skin_nearest:
        C, _ = skin_nearest(D, C, lab, pal, rules.warm_shadow_de if rules.warm_shadow else None)
    if rules.soft_outlines and face == "human":
        nb = _neighbours(P, D)
        C, _ = soften_outlines(P, D, C, eyes, nb)
    if rules.calm_skin:
        nb = nb if nb is not None else _neighbours(P, D)
        C, _ = calm_skin(P, D, C, pal, eyes, nb)
    if rules.lone_white_skin:  # IMG-026M (IS PN-04h)
        nb = nb if nb is not None else _neighbours(P, D)
        C, _ = lone_white_skin(P, D, C, pal, eyes, nb)
    if rules.pale_skin and face == "human":  # RS-3044
        nb = nb if nb is not None else _neighbours(P, D)
        if rules.pale_skin_rounds:  # BUILD_RS3044
            C, _ = pale_skin_rounds(P, D, C, lab, pal, eyes, nb)
        else:  # RS-3045
            C, _ = pale_skin(P, D, C, lab, pal, eyes, nb, rules.pale_skin_group, rules.pale_skin_min_l)
    return C
