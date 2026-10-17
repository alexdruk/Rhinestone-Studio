"""Recolours isolated dark stones (one or two) that sit in a light area."""
from collections import Counter

import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from scipy.spatial import cKDTree

DARK = {"jet", "hematite"}


def _components(P, D, C, link=0.9):
    dark = np.array([c in DARK for c in C])
    t = cKDTree(P)
    pr = t.query_pairs(D.max() + link, output_type="ndarray")
    g = np.linalg.norm(P[pr[:, 0]] - P[pr[:, 1]], axis=1) - (D[pr[:, 0]] + D[pr[:, 1]]) / 2
    pr = pr[g <= link]
    dd = pr[dark[pr[:, 0]] & dark[pr[:, 1]]]
    n = len(P)
    A = coo_matrix((np.ones(len(dd)), (dd[:, 0], dd[:, 1])), shape=(n, n))
    ncomp, lab = connected_components(A, directed=False)
    nb = [[] for _ in range(n)]
    for i, j in pr:
        nb[i].append(j)
        nb[j].append(i)
    return dark, lab, nb


def clean(P, D, C, fixed=None, max_size=2, light_share=0.6):
    C = list(C)
    fixed = np.zeros(len(P), bool) if fixed is None else fixed
    dark, lab, nb = _components(P, D, C)
    sizes = Counter(lab[dark])
    changed = 0
    for i in np.nonzero(dark & ~fixed)[0]:
        if sizes[lab[i]] > max_size:
            continue
        if any(fixed[j] for j in nb[i]):
            continue
        others = [C[j] for j in nb[i] if not dark[j]]
        if len(nb[i]) == 0 or len(others) / max(1, len(nb[i])) < light_share:
            continue
        C[i] = Counter(others).most_common(1)[0][0]
        changed += 1
    return C, changed
