"""Outline chains: small dark detections that touch each other in a run.

The AI draws outlines as chains of small dark stones. With Rules.keep_chains they are kept
as stones instead of being dropped as shadows or interstitial dots, and post_process()
does not recolour their fragments.
"""
import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from scipy.spatial import cKDTree


def chain_mask(det, col, s, rules):
    """Boolean mask over the detections det ([y, x, r, ...] in pixels, col their Lab colours):
    True for members of a dark chain. Empty when rules.keep_chains is off."""
    out = np.zeros(len(det), bool)
    if not rules.keep_chains or len(det) == 0:
        return out
    d_mm = 2 * det[:, 2] * s
    dark = (col[:, 0] < rules.chain_dark_l) & (d_mm >= 1.1) & (d_mm < 2.9)
    idx = np.nonzero(dark)[0]
    if len(idx) < rules.chain_min_len:
        return out
    pts = det[idx][:, [1, 0]]
    r = det[idx, 2]
    pairs = cKDTree(pts).query_pairs(rules.chain_link * 2 * r.max(), output_type="ndarray")
    if len(pairs) == 0:
        return out
    dist = np.linalg.norm(pts[pairs[:, 0]] - pts[pairs[:, 1]], axis=1)
    pairs = pairs[dist <= rules.chain_link * (r[pairs[:, 0]] + r[pairs[:, 1]])]
    n = len(idx)
    graph = coo_matrix((np.ones(len(pairs)), (pairs[:, 0], pairs[:, 1])), shape=(n, n))
    _, label = connected_components(graph, directed=False)
    sizes = np.bincount(label)
    out[idx[sizes[label] >= rules.chain_min_len]] = True
    return out
