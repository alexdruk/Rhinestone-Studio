"""
FONT-GEN-004 -- skeleton-rebuild glyph transform.

FONT-GEN-001/002/003 all corrected glyphs by *dilating the existing outline* (buffer-based
morphological expansion of strokes/counters -- see glyph_transform.py). All three showed
clusterCount fragmentation regression at most or all sizes; the hypothesis under test here is that
dilation itself -- not how much of it is applied -- is what adds fragmentation-prone perimeter,
since a dilated stroke's new perimeter scales with how much correction was needed, not with the
stroke's own length.

This module replaces the transform entirely for the glyphs it runs on: instead of correcting the
existing outline, it discards stroke *width* information and keeps only each stroke's centerline
(medial axis / skeleton), then rebuilds every stroke as a new band of uniform width
(`minFeatureWidthFu`, no wider) directly along that skeleton. A rebuilt stroke's perimeter scales
with its length x2 (both sides of a uniform-width band), not with a correction magnitude -- the
actual variable this milestone tests. Counters/loops are never separately "enlarged": an "o"'s
counter opening is whatever falls out of rebuilding the ring-shaped stroke around its own skeleton
loop at the target width -- there is no hole-specific step at all.

Pipeline per glyph:

  1. rasterize -- fill the glyph's shapely ink geometry (holes already correct via even-odd, see
     glyph_geometry.contours_to_geometry) onto a binary grid, cell size derived from
     minFeatureWidthFu the same way ContourRingSampler.js derives its distance-field grid from
     stone pitch (spacing / 8, see that module's CELL_SPACING_DIVISOR) -- an unrelated module for
     an unrelated fill mode, reused here only for its resolution convention, not its code.
  2. skeletonize -- skimage.morphology.skeletonize (standard topological thinning) reduces the
     mask to a 1px-wide medial-axis mask. No skeletonization utility already existed anywhere in
     this codebase to reuse: the one prior attempt at a shared centerline skeleton
     (`RhinestoneStrokeGeometry.js`, TXT-101A) failed manual QA and was deleted in commit
     `da2be76` before this milestone began -- see docs/specifications and this milestone's own
     report for that precedent and why this is still worth testing in a different context (baked
     font outlines, not runtime dot placement).
  3. graph + path trace -- the skeleton mask is turned into a pixel-adjacency graph (networkx) and
     decomposed into polyline paths: leaf<->junction and junction<->junction chains for branching
     strokes (e.g. "m"), and one full-loop path for a pure cycle with no junctions at all (e.g.
     "o", whose ink is a ring so its skeleton is itself a closed loop near the ring's middle).
  4. spur pruning -- short leaf-terminated paths below a small threshold are dropped before
     rebuilding, since raster/thinning noise near corners routinely produces tiny spurious
     branches that were never part of the glyph's real stroke structure.
  5. rebuild -- each surviving path becomes a shapely LineString (isolated single-pixel components,
     e.g. small dots/punctuation, become a Point instead), buffered to `minFeatureWidthFu` width
     with round caps/joins, then unioned into the final glyph geometry. No separate hole-opening
     step, no counter/loop threshold check, no corner-rounding pass -- the round-capped/joined
     buffer already produces rounded terminals and junctions as an emergent property of the
     reconstruction, not a correction applied afterward.

Deliberately NOT shared with glyph_transform.py: no `_enforce_min_width`, `_enlarge_holes`,
`_dissolve_sliver_holes`, `_simplify_details`, or `_round_junctions` calls -- this is a full
replacement of the glyph's geometry from its skeleton outward, not an incremental correction of the
existing outline, so none of that transform's guard/measurement machinery applies here. Nothing in
glyph_transform.py is imported, changed, or reused beyond the shared contours<->geometry conversion
helpers both transforms need.
"""
import networkx as nx
import numpy as np
from PIL import Image, ImageDraw
from shapely.geometry import LineString, MultiPolygon, Point
from shapely.ops import unary_union
from skimage.morphology import skeletonize

from .glyph_geometry import contours_to_geometry, geometry_to_contours

CAP_STYLE_ROUND = 1
JOIN_STYLE_ROUND = 1

# Matches ContourRingSampler.js's CELL_SPACING_DIVISOR convention: raster cell size = the relevant
# physical scale (there: stone pitch: here: target stroke width) / 8, fine enough to preserve
# curve shape and stroke connectivity without an unreasonably large grid.
CELL_SPACING_DIVISOR = 8
RASTER_PAD_CELLS = 3
# Mirrors ContourRingSampler.js's MAX_GRID_CELLS_BUDGET fail-safe shape (a per-glyph raster here,
# not per-shape-fill, so this never needs to trigger in practice at realistic glyph sizes -- see
# this milestone's report for the measured cols x rows range -- but stays as defense in depth).
MAX_GRID_CELLS_BUDGET = 4_000_000


def _as_polygons(geometry):
    if geometry is None or geometry.is_empty:
        return []
    return list(geometry.geoms) if isinstance(geometry, MultiPolygon) else [geometry]


def _rasterize(geometry, min_x, min_y, cols, rows, cell_size_fu):
    img = Image.new("L", (cols, rows), 0)
    draw = ImageDraw.Draw(img)
    for poly in _as_polygons(geometry):
        exterior = [((x - min_x) / cell_size_fu, rows - (y - min_y) / cell_size_fu) for x, y in poly.exterior.coords]
        draw.polygon(exterior, fill=255)
        for interior in poly.interiors:
            hole = [((x - min_x) / cell_size_fu, rows - (y - min_y) / cell_size_fu) for x, y in interior.coords]
            draw.polygon(hole, fill=0)
    return np.asarray(img) > 127


def _grid_to_point(row, col, min_x, min_y, rows, cell_size_fu):
    x = min_x + (col + 0.5) * cell_size_fu
    y = min_y + (rows - 1 - row + 0.5) * cell_size_fu
    return (x, y)


def _skeleton_graph(skel_mask):
    g = nx.Graph()
    ys, xs = np.nonzero(skel_mask)
    pts = set(zip(ys.tolist(), xs.tolist()))
    for (r, c) in pts:
        g.add_node((r, c))
        for dr in (-1, 0, 1):
            for dc in (-1, 0, 1):
                if dr == 0 and dc == 0:
                    continue
                nb = (r + dr, c + dc)
                if nb in pts:
                    g.add_edge((r, c), nb)
    return g


def _trace_paths(g):
    """
    Decomposes the skeleton pixel graph into pixel-coordinate paths: leaf<->junction and
    junction<->junction chains for any component with at least one non-degree-2 node (including
    degree-0 isolated pixels, kept as their own single-point "path"), plus one full-loop path per
    component that has no junction/leaf at all (every node degree 2 -- a pure cycle, e.g. "o").
    """
    paths = []
    visited_edges = set()

    def edge_key(a, b):
        return (a, b) if a <= b else (b, a)

    critical = {n for n in g.nodes if g.degree(n) != 2}

    for start in critical:
        if g.degree(start) == 0:
            paths.append([start])
            continue
        for nbr in g.neighbors(start):
            ek = edge_key(start, nbr)
            if ek in visited_edges:
                continue
            visited_edges.add(ek)
            path = [start, nbr]
            prev, cur = start, nbr
            while g.degree(cur) == 2 and cur not in critical:
                nxts = [n for n in g.neighbors(cur) if n != prev]
                if not nxts:
                    break
                nxt = nxts[0]
                ek2 = edge_key(cur, nxt)
                if ek2 in visited_edges:
                    break
                visited_edges.add(ek2)
                path.append(nxt)
                prev, cur = cur, nxt
            paths.append(path)

    for comp in nx.connected_components(g):
        if comp & critical:
            continue
        start = next(iter(comp))
        path = [start]
        prev, cur = None, start
        guard = 0
        while guard <= len(comp) + 2:
            guard += 1
            nbrs = [n for n in g.neighbors(cur) if n != prev]
            if not nbrs:
                break
            nxt = nbrs[0]
            if nxt == start:
                path.append(start)
                break
            path.append(nxt)
            prev, cur = cur, nxt
        paths.append(path)

    return paths


def _path_length_fu(points):
    return sum(
        ((points[i][0] - points[i - 1][0]) ** 2 + (points[i][1] - points[i - 1][1]) ** 2) ** 0.5
        for i in range(1, len(points))
    )


def _path_to_geometry(points, width_fu, simplify_tolerance_fu):
    dedup = [points[0]]
    for p in points[1:]:
        if p != dedup[-1]:
            dedup.append(p)
    if len(dedup) == 1:
        return Point(dedup[0]).buffer(width_fu / 2.0)
    line = LineString(dedup)
    if simplify_tolerance_fu > 0:
        simplified = line.simplify(simplify_tolerance_fu, preserve_topology=False)
        if not simplified.is_empty and len(simplified.coords) >= 2:
            line = simplified
    return line.buffer(width_fu / 2.0, cap_style=CAP_STYLE_ROUND, join_style=JOIN_STYLE_ROUND)


def transform_glyph_skeleton(contours, char, config, categories):
    """
    Same signature/contract as glyph_transform.transform_glyph: takes raw flattened contours (font
    units) for one glyph and the resolved per-size config, returns (new_contours, log).
    """
    geometry = contours_to_geometry(contours)
    log = {"char": char, "categories": sorted(categories), "operations": []}
    if geometry is None:
        return [], log

    original_area = geometry.area
    width_fu = config["minFeatureWidthFu"]
    cell_size_fu = max(width_fu / CELL_SPACING_DIVISOR, 1.0)

    min_x, min_y, max_x, max_y = geometry.bounds
    pad = cell_size_fu * RASTER_PAD_CELLS
    min_x, min_y, max_x, max_y = min_x - pad, min_y - pad, max_x + pad, max_y + pad
    cols = max(4, int((max_x - min_x) / cell_size_fu) + 1)
    rows = max(4, int((max_y - min_y) / cell_size_fu) + 1)
    if cols * rows > MAX_GRID_CELLS_BUDGET:
        scale = ((cols * rows) / MAX_GRID_CELLS_BUDGET) ** 0.5
        cell_size_fu *= scale
        cols = max(4, int((max_x - min_x) / cell_size_fu) + 1)
        rows = max(4, int((max_y - min_y) / cell_size_fu) + 1)

    log["operations"].append({"type": "rasterize", "cols": cols, "rows": rows, "cellSizeFu": round(cell_size_fu, 2)})

    mask = _rasterize(geometry, min_x, min_y, cols, rows, cell_size_fu)
    if not mask.any():
        log["areaBefore"] = round(original_area, 1)
        log["areaAfter"] = 0.0
        log["contoursBefore"] = len(contours)
        log["contoursAfter"] = 0
        return [], log

    skel = skeletonize(mask)
    g = _skeleton_graph(skel)
    raw_paths = _trace_paths(g)
    log["operations"].append({"type": "skeleton-extract", "skeletonPixelCount": int(skel.sum()), "pathCount": len(raw_paths)})

    degree = dict(g.degree())
    spur_threshold_fu = max(cell_size_fu * 2, width_fu * 0.25)
    kept_paths, pruned = [], 0
    for path in raw_paths:
        if len(path) < 2:
            kept_paths.append(path)
            continue
        deg_a, deg_b = degree.get(path[0], 0), degree.get(path[-1], 0)
        is_spur = (deg_a == 1) != (deg_b == 1)  # exactly one true leaf end, other end is a junction
        if is_spur:
            points = [_grid_to_point(r, c, min_x, min_y, rows, cell_size_fu) for r, c in path]
            if _path_length_fu(points) < spur_threshold_fu:
                pruned += 1
                continue
        kept_paths.append(path)
    if not kept_paths:
        kept_paths = raw_paths  # entire glyph was spur noise -- fall back rather than emit nothing
    if pruned:
        log["operations"].append({"type": "spur-prune", "prunedCount": pruned, "thresholdFu": round(spur_threshold_fu, 2)})

    simplify_tolerance_fu = cell_size_fu
    strokes = []
    for path in kept_paths:
        points = [_grid_to_point(r, c, min_x, min_y, rows, cell_size_fu) for r, c in path]
        strokes.append(_path_to_geometry(points, width_fu, simplify_tolerance_fu))
    strokes = [s for s in strokes if s is not None and not s.is_empty]

    result = unary_union(strokes) if strokes else None
    log["operations"].append({"type": "stroke-rebuild", "widthFu": round(width_fu, 2), "strokeCount": len(strokes)})

    new_contours = geometry_to_contours(result, min_area=config.get("minAreaFu", 4.0)) if result is not None else []
    log["areaBefore"] = round(original_area, 1)
    log["areaAfter"] = round(result.area, 1) if (result is not None and not result.is_empty) else 0.0
    log["contoursBefore"] = len(contours)
    log["contoursAfter"] = len(new_contours)
    return new_contours, log
