"""IMG-026O: size cap, overlap cleanup and hole fill after the layout.

Ported from PatternNifty's (IS, commit e9e7014) Node steps after the layout: src/pipeline/tiers.js
(capStoneSizes, pupilCentres), cleanup.js (removeCloseStones, the coverage after the cleanup) and
holes.js (subjectMask, findHoles, neighbourVote); the rules are IS spec docs/IS-001-Spec.md 7.4
and 7.5 and docs/exp-holes.md. In RS they run inside the service, after its own layout, so the
service stays the one stone producer. Each step is a Rules flag (size_cap, overlap_cleanup,
hole_fill); clean_up() runs the ones that are on, in that order.

Stones are the pipeline's dicts {x, y, size, d, color} in frame mm (AI pixel = mm / mmPerPx),
rounded to 0.001 mm as post_process wrote them; IS ran the same steps on the cropped /layout answer
(layout mm = frame mm - offsetMm), which only shifts every position by the same amount.
"""
import numpy as np
from scipy import ndimage as ndi
from scipy.spatial import cKDTree

from .geometry import holes
from .post import SIZE_KEYS

MIN_GAP_MM = 0.1
MAX_D = 4.0  # SS16
MAX_PUPIL_D = 4.7  # SS20
PUPIL_MATCH_MM = 0.002
NEIGHBOUR_GAP_MM = 0.5
COVERAGE_PX_PER_MM = 10
GRID_PX_PER_MM = 20
CLOSE_MM = 1.0
ENCLOSED_MAX_MM2 = 2 * np.pi  # two SS6 stones
FILL_SIZES = (2.0, 1.5)  # SS6, then SS4
CLEARANCE_CAP_MM = 4.0
VOTE_MM = 1.0
BLOCK = 64
EPS = 1e-9


def js_round(v):
    """JavaScript's Math.round: halves round up."""
    return np.floor(np.asarray(v, float) + 0.5)


def round3(v):
    return float(js_round(v * 1000) / 1000)


# --- Size cap (IS tiers.js) -------------------------------------------------------------------

def pupil_centres(face, pupils_at):
    """The centres [x, y] of the stones that may stay SS20: the reported pupils when the layout has a
    face (human or animal) and exactly two pupils. Otherwise none."""
    if face is None or pupils_at is None or len(pupils_at) != 2:
        return []
    return [tuple(p) for p in pupils_at]


def cap_sizes(stones, pupils=()):
    """Every stone larger than SS16 becomes SS16 at the same centre; a stone centred on one of
    pupils (within PUPIL_MATCH_MM) is only capped at SS20. Returns (stones, capped)."""
    out, capped = [], 0
    for q in stones:
        is_pupil = any(np.hypot(q["x"] - x, q["y"] - y) <= PUPIL_MATCH_MM for x, y in pupils)
        top = MAX_PUPIL_D if is_pupil else MAX_D
        if q["d"] <= top + EPS:
            out.append(q)
            continue
        capped += 1
        out.append(dict(q, d=top, size=SIZE_KEYS[top]))
    return out, capped


# --- Overlap cleanup (IS cleanup.js) ----------------------------------------------------------

def close_pairs(P, D, max_gap):
    """Every pair (i, j, gap), i < j, with rim gap (centre distance minus both radii) below max_gap."""
    if len(P) < 2:
        return np.zeros(0, int), np.zeros(0, int), np.zeros(0)
    pairs = cKDTree(P).query_pairs(float(D.max()) + max(max_gap, 0) + EPS, output_type="ndarray")
    if len(pairs) == 0:
        return np.zeros(0, int), np.zeros(0, int), np.zeros(0)
    i, j = pairs[:, 0], pairs[:, 1]
    gap = np.hypot(P[i, 0] - P[j, 0], P[i, 1] - P[j, 1]) - (D[i] + D[j]) / 2
    keep = gap < max_gap - EPS
    return i[keep], j[keep], gap[keep]


def remove_close(stones):
    """For every pair closer than MIN_GAP_MM, worst gap first, the smaller stone goes; on equal size
    the one with fewer neighbours (rim gap below NEIGHBOUR_GAP_MM, counted once before any removal),
    then the later one. A pair whose stone is already gone is skipped.
    Returns (kept stones in order, removed indices ascending)."""
    if len(stones) < 2:
        return list(stones), []
    P = np.array([[q["x"], q["y"]] for q in stones])
    D = np.array([q["d"] for q in stones])
    neighbours = np.zeros(len(stones), int)
    ni, nj, _ = close_pairs(P, D, NEIGHBOUR_GAP_MM)
    np.add.at(neighbours, ni, 1)
    np.add.at(neighbours, nj, 1)
    i, j, gap = close_pairs(P, D, MIN_GAP_MM)
    gone = set()
    for k in np.lexsort((j, i, gap)):
        a, b = int(i[k]), int(j[k])
        if a in gone or b in gone:
            continue
        if abs(D[a] - D[b]) > EPS:
            loser = a if D[a] < D[b] else b
        elif neighbours[a] != neighbours[b]:
            loser = a if neighbours[a] < neighbours[b] else b
        else:
            loser = b
        gone.add(loser)
    return [q for k, q in enumerate(stones) if k not in gone], sorted(gone)


def area_under(P, D, box):
    """Pixels at COVERAGE_PX_PER_MM (pixel centre inside a circle) under at least one stone."""
    ppmm = COVERAGE_PX_PER_MM
    min_x, min_y, max_x, max_y = box
    w = int(np.ceil((max_x - min_x) * ppmm)) + 1
    h = int(np.ceil((max_y - min_y) * ppmm)) + 1
    occ = np.zeros((h, w), bool)
    for (x, y), d in zip(P, D):
        cx, cy, r = (x - min_x) * ppmm, (y - min_y) * ppmm, d / 2 * ppmm
        y0, y1 = max(0, int(np.floor(cy - r))), min(h - 1, int(np.ceil(cy + r)))
        x0, x1 = max(0, int(np.floor(cx - r))), min(w - 1, int(np.ceil(cx + r)))
        if y1 < y0 or x1 < x0:
            continue
        yy = (np.arange(y0, y1 + 1) + 0.5 - cy) ** 2
        xx = (np.arange(x0, x1 + 1) + 0.5 - cx) ** 2
        occ[y0:y1 + 1, x0:x1 + 1] |= yy[:, None] + xx[None, :] <= r * r
    return int(occ.sum())


def footprint(P, D):
    return (float((P[:, 0] - D / 2).min()), float((P[:, 1] - D / 2).min()),
            float((P[:, 0] + D / 2).max()), float((P[:, 1] + D / 2).max()))


# --- Subject mask and holes (IS holes.js) -----------------------------------------------------

def squared_edt(feature):
    """Squared Euclidean distance from every pixel to the nearest pixel with feature set (inf if
    there is none), exact integers as IS's squaredEdt."""
    if not feature.any():
        return np.full(feature.shape, np.inf)
    return np.rint(ndi.distance_transform_edt(~feature) ** 2)


def subject_mask(alpha8, s):
    """The subject at AI pixels: alpha >= 128, closed with a disc of CLOSE_MM across, then every
    enclosed transparent area (4-connected, not touching the image's border) of at most
    ENCLOSED_MAX_MM2 filled."""
    m = alpha8 >= 128
    r2 = (CLOSE_MM / 2 / s) ** 2
    dilated = squared_edt(m) <= r2
    closed = squared_edt(~dilated) > r2
    lab, n = ndi.label(~closed)  # 4-connected
    if n:
        size = np.bincount(lab.ravel(), minlength=n + 1)
        border = np.zeros(n + 1, bool)
        for edge in (lab[0], lab[-1], lab[:, 0], lab[:, -1]):
            border[edge] = True
        small = (size <= ENCLOSED_MAX_MM2 / (s * s)) & ~border
        small[0] = False
        closed = closed | small[lab]
    return closed


class SubjectGrid:
    """The grid over the subject in frame mm: grid pixel (i, j) has its centre at
    (x0 + (i + 0.5) / ppmm, y0 + (j + 0.5) / ppmm); mask_clear is the distance (mm) from that centre
    to the nearest grid pixel outside the subject (0 outside)."""

    def __init__(self, mask, s, ppmm=GRID_PX_PER_MM):
        ys, xs = np.nonzero(mask)
        self.empty = not len(xs)
        if self.empty:
            return
        min_x, max_x, min_y, max_y = xs.min(), xs.max(), ys.min(), ys.max()
        self.ppmm = ppmm
        self.x0, self.y0 = (min_x - 1) * s, (min_y - 1) * s
        self.w = int(np.ceil((max_x - min_x + 3) * s * ppmm))
        self.h = int(np.ceil((max_y - min_y + 3) * s * ppmm))
        px = js_round((self.x0 + (np.arange(self.w) + 0.5) / ppmm) / s).astype(int)
        py = js_round((self.y0 + (np.arange(self.h) + 0.5) / ppmm) / s).astype(int)
        hh, ww = mask.shape
        okx, oky = (px >= 0) & (px < ww), (py >= 0) & (py < hh)
        inside = np.zeros((self.h, self.w), bool)
        inside[np.ix_(oky, okx)] = mask[np.ix_(py[oky], px[okx])]
        self.mask_clear = np.where(inside, np.sqrt(squared_edt(~inside)) / ppmm, 0).astype(np.float32)

    def carve(self, out, x, y, radius):
        """out = min(out, distance to (x, y) - radius) where that is below the cap; returns the
        window (i0, i1, j0, j1)."""
        ppmm = self.ppmm
        reach = radius + CLEARANCE_CAP_MM
        i0, i1 = max(0, int(np.floor((x - reach - self.x0) * ppmm))), min(self.w - 1, int(np.ceil((x + reach - self.x0) * ppmm)))
        j0, j1 = max(0, int(np.floor((y - reach - self.y0) * ppmm))), min(self.h - 1, int(np.ceil((y + reach - self.y0) * ppmm)))
        if i1 >= i0 and j1 >= j0:
            dx = self.x0 + (np.arange(i0, i1 + 1) + 0.5) / ppmm - x
            dy = self.y0 + (np.arange(j0, j1 + 1) + 0.5) / ppmm - y
            c = (np.sqrt(dy[:, None] ** 2 + dx[None, :] ** 2) - radius).astype(np.float32)
            np.minimum(out[j0:j1 + 1, i0:i1 + 1], c, out=out[j0:j1 + 1, i0:i1 + 1])
        return i0, i1, j0, j1


class _Blocks:
    """The maximum of each BLOCK x BLOCK block of the clearance, for IS's argmax: the first block
    (row-major) holding the largest value, then the first pixel (row-major) in it with that value."""

    def __init__(self, clear):
        self.clear = clear
        h, w = clear.shape
        self.bh, self.bw = -(-h // BLOCK), -(-w // BLOCK)
        self.top = np.full((self.bh, self.bw), -np.inf)
        for bj in range(self.bh):
            for bi in range(self.bw):
                self.refresh(bi, bj)

    def refresh(self, bi, bj):
        self.top[bj, bi] = self.clear[bj * BLOCK:(bj + 1) * BLOCK, bi * BLOCK:(bi + 1) * BLOCK].max()

    def argmax(self):
        bj, bi = np.unravel_index(int(np.argmax(self.top)), self.top.shape)
        sub = self.clear[bj * BLOCK:(bj + 1) * BLOCK, bi * BLOCK:(bi + 1) * BLOCK]
        y, x = np.unravel_index(int(np.argmax(sub)), sub.shape)
        return bi * BLOCK + x, bj * BLOCK + y, float(sub[y, x])


def find_holes(P, D, mask, s):
    """The greedy hole search: the free spot farthest from everything first, SS6 while one fits,
    then SS4. A hole has its whole stone inside the subject (on the GRID_PX_PER_MM grid) and a rim
    gap of at least MIN_GAP_MM to every stone and every earlier hole (exact). Returns [(x, y, d)]
    in frame mm, rounded to 0.001."""
    grid = SubjectGrid(mask, s)
    if grid.empty:
        return []
    clear = np.full((grid.h, grid.w), CLEARANCE_CAP_MM, np.float32)
    for (x, y), d in zip(P, D):
        grid.carve(clear, x, y, d / 2 + MIN_GAP_MM)
    np.minimum(clear, grid.mask_clear, out=clear)
    blocks = _Blocks(clear)
    tree = cKDTree(P) if len(P) else None
    reach_extra = (float(D.max()) if len(D) else 0) / 2 + MIN_GAP_MM + 0.01
    found = []

    def min_gap(x, y, d):
        g = np.inf
        if tree is not None:
            idx = tree.query_ball_point((x, y), d / 2 + reach_extra)
            if idx:
                g = float((np.hypot(P[idx, 0] - x, P[idx, 1] - y) - (D[idx] + d) / 2).min())
        for hx, hy, hd in found:
            g = min(g, float(np.hypot(hx - x, hy - y)) - (hd + d) / 2)
        return g

    for d in FILL_SIZES:
        while True:
            i, j, value = blocks.argmax()
            if value < d / 2 - EPS:
                break
            x = round3(grid.x0 + (i + 0.5) / grid.ppmm)
            y = round3(grid.y0 + (j + 0.5) / grid.ppmm)
            if min_gap(x, y, d) < MIN_GAP_MM - EPS:
                clear[j, i] = -1
                blocks.refresh(i // BLOCK, j // BLOCK)
                continue
            found.append((x, y, d))
            i0, i1, j0, j1 = grid.carve(clear, x, y, d / 2 + MIN_GAP_MM)
            for bj in range(j0 // BLOCK, j1 // BLOCK + 1):
                for bi in range(i0 // BLOCK, i1 // BLOCK + 1):
                    blocks.refresh(bi, bj)
    return found


def neighbour_vote(P, D, colours, targets):
    """Colours by IS's neighbour vote for the stones at the indices in targets (in that order);
    colours[i] gives the others'. Targets are decided in rounds: a target with a decided stone
    within VOTE_MM of its edge takes the colour with the largest summed weight 1 - gap / VOTE_MM
    among them, on a tie the nearest one's (then the lower index); a round's results vote in the
    next round. When a round decides nothing, every target left takes the nearest decided stone's
    colour. Returns {index: colour}."""
    targets = list(targets)
    tset = set(targets)
    colour = {i: colours[i] for i in range(len(P)) if i not in tset}
    out = {}
    tree = cKDTree(P)
    dmax = float(D.max())
    gap_of = lambda a, b: float(np.hypot(P[a, 0] - P[b, 0], P[a, 1] - P[b, 1])) - (D[a] + D[b]) / 2
    open_ = targets
    while open_:
        decided, still = [], []
        for i in open_:
            voters = []
            for j in tree.query_ball_point(P[i], D[i] / 2 + dmax / 2 + VOTE_MM):
                if j == i or j not in colour:
                    continue
                g = gap_of(i, j)
                if g < VOTE_MM:
                    voters.append((g, j))
            if not voters:
                still.append(i)
                continue
            weight = {}
            for g, j in voters:
                weight[colour[j]] = weight.get(colour[j], 0) + 1 - max(0.0, g) / VOTE_MM
            top = max(weight.values())
            tied = {c for c, w in weight.items() if w >= top - 1e-9}
            _, j = min((g, j) for g, j in voters if colour[j] in tied)
            decided.append((i, colour[j]))
        if not decided:
            for i in still:
                best = None
                for j, c in colour.items():
                    g = gap_of(i, j)
                    if best is None or g < best[0]:
                        best = (g, c)
                out[i] = best[1] if best else colours[i]
            break
        for i, c in decided:
            colour[i] = c
            out[i] = c
        open_ = still
    return out


# --- The steps together -----------------------------------------------------------------------

def clean_up(stones, alpha8, s, face, pupils_at, cover_mask, rules):
    """The build O steps that rules turns on, in IS's order: cap, cleanup, hole fill with the vote.
    Returns (stones, stats). stats: capped, removed, removedShare (removed over the stones before
    the cleanup), filled, and coverage, IS's coverage after the cleanup: the service's coverage of
    the stones before the steps times the area under the stones after them over the area under the
    stones before them, both at COVERAGE_PX_PER_MM over the box of the stones before."""
    before = stones
    capped = removed = filled = 0
    n_before_cleanup = len(stones)
    if rules.size_cap:
        stones, capped = cap_sizes(stones, pupil_centres(face, pupils_at))
    if rules.overlap_cleanup:
        n_before_cleanup = len(stones)
        stones, gone = remove_close(stones)
        removed = len(gone)
    if rules.hole_fill:
        P = np.array([[q["x"], q["y"]] for q in stones]).reshape(-1, 2)
        D = np.array([q["d"] for q in stones])
        found = find_holes(P, D, subject_mask(alpha8, s), s)
        if found:
            n = len(stones)
            P = np.vstack([P, [[x, y] for x, y, _ in found]])
            D = np.r_[D, [d for _, _, d in found]]
            colours = [q["color"] for q in stones] + [None] * len(found)
            voted = neighbour_vote(P, D, colours, range(n, n + len(found)))
            stones = stones + [{"x": x, "y": y, "size": SIZE_KEYS[d], "d": d, "color": voted[n + k]}
                               for k, (x, y, d) in enumerate(found)]
            filled = len(found)
    P0 = np.array([[q["x"], q["y"]] for q in before])
    D0 = np.array([q["d"] for q in before])
    cover_before = holes(P0, D0, cover_mask, s)[1]
    if capped or removed or filled:
        P1 = np.array([[q["x"], q["y"]] for q in stones])
        D1 = np.array([q["d"] for q in stones])
        box = footprint(P0, D0)
        coverage = cover_before * area_under(P1, D1, box) / area_under(P0, D0, box)
    else:
        coverage = cover_before
    stats = {
        "capped": capped,
        "removed": removed,
        "removedShare": removed / n_before_cleanup if n_before_cleanup else 0.0,
        "filled": filled,
        "coverage": float(coverage),
    }
    return stones, stats
