"""
FONT-GEN-001 -- procedural glyph transform pipeline.

Every operation here is a shapely buffer-based morphological transform, chosen so a single shared
pipeline (no per-letter hand-editing) can apply size-specific correction *only* where a glyph's own
measured geometry falls below that size's threshold -- not a blanket fixed offset applied uniformly
regardless of a glyph's native proportions. This is the "systematic glyph-category rules ... not
manually editing individual glyph control points" approach the milestone brief requires, and a
deliberately different technique from FONT-CAL-001/002's rejected single-vertex/contiguous-span
pushes (see docs/specifications/FONT-CAL-001-*.md, FONT-CAL-002-*.md): those edited a handful of
outline points by hand-selected heuristics; this measures and corrects the *whole* glyph's stroke/
counter geometry against explicit mm-derived thresholds, glyph-category by glyph-category.

Pipeline per glyph (config-driven, all thresholds already converted from mm to font units by the
caller at the variant's minimum committed height -- see generate.py):

  1. terminal simplification / detail removal -- morphological opening (erode, dilate) at
     `terminalSimplifyFu`, removing spurs/flourishes smaller than that radius.
  2. minimum stroke-width enforcement -- measures the glyph's own thinnest bridge via an erosion
     sweep (`measure_min_half_width`) and expands the whole outline by only the measured deficit
     (never more), so already-adequate strokes are left alone.
  3. counter/loop enlargement -- same erosion-sweep measurement applied to each interior hole; a
     hole in a `looped-lowercase` glyph is checked against `minLoopOpeningFu` (stricter), every
     other hole against `minCounterOpeningFu`.
  4. junction/corner rounding -- a symmetric close-then-open round-join buffer pass that rounds
     both convex spikes and concave notches without changing net stroke width.
  5. cleanup -- drop sub-`min_area` slivers, simplify collinear points (RDP tolerance).
"""
from shapely.geometry import Polygon, MultiPolygon
from shapely.ops import unary_union

from .glyph_geometry import contours_to_geometry, geometry_to_contours

JOIN_STYLE_ROUND = 1


def _as_polygons(geometry):
    if geometry is None or geometry.is_empty:
        return []
    return list(geometry.geoms) if isinstance(geometry, MultiPolygon) else [geometry]


def measure_min_half_width(geometry, max_radius_fu, samples=10):
    """
    Sweeps erosion radius from small to `max_radius_fu` and returns the smallest radius at which
    the geometry's part count increases (a bridge/stroke pinches apart) or the geometry vanishes
    entirely -- i.e. an estimate of the thinnest stroke's half-width. Returns max_radius_fu
    unchanged if no thinning is detected within the swept range (glyph already meets the floor).
    """
    if geometry is None or geometry.is_empty or max_radius_fu <= 0:
        return max_radius_fu
    base_parts = len(_as_polygons(geometry))
    radii = [max_radius_fu * (i / samples) for i in range(1, samples + 1)]
    for r in radii:
        eroded = geometry.buffer(-r, join_style=JOIN_STYLE_ROUND)
        parts = _as_polygons(eroded)
        if eroded.is_empty or len(parts) > base_parts:
            return r
    return max_radius_fu


def _enforce_min_width(geometry, min_width_fu):
    target_half = min_width_fu / 2.0
    measured_half = measure_min_half_width(geometry, target_half)
    deficit = max(0.0, target_half - measured_half)
    if deficit <= 0:
        return geometry, 0.0
    expanded = geometry.buffer(deficit, join_style=JOIN_STYLE_ROUND)
    guarded = _guard_topology(geometry, expanded)
    return guarded, (deficit if guarded is expanded else 0.0)


def _is_sliver_hole(hole_poly, probe_radius_fu, collapse_fraction=0.15):
    """
    True if `hole_poly` is a long, thin sliver rather than a rounded letter counter -- eroding it by
    a modest `probe_radius_fu` collapses most of its area away (a real counter, being reasonably
    round/chunky, retains most of its area under the same small erosion). Sacramento's cursive
    outlines routinely contain exactly this shape: a long, thin, near-closed interior ring where a
    connecting stroke curves back close to itself (verified against the *unmodified* source font --
    a bare "h" and "l" glyph, with no transform applied at all, already render a large phantom
    closed loop at the stem's return curve via StoneSampler's arc-length sampling: a thin sliver's
    long path length still produces a full ring of sample points along its perimeter, regardless of
    how thin it is across its width -- see FONT-GEN-001 report's "hairline crossing artifact"
    finding). Raw hole area alone cannot distinguish this from a real counter (a long sliver can have
    just as much area as a small round bowl); this erosion-collapse test measures shape, not size.
    """
    if hole_poly.area <= 0:
        return True
    eroded_area = hole_poly.buffer(-probe_radius_fu, join_style=JOIN_STYLE_ROUND).area
    return eroded_area < hole_poly.area * collapse_fraction


def _dissolve_sliver_holes(geometry, stone_diameter_fu):
    """
    Fills in (removes) any interior hole classified as a sliver artifact (see _is_sliver_hole),
    leaving every legitimate hole untouched. Runs *before* min-width enforcement's global dilation,
    on geometry still close to the original design -- classifying holes after that dilation would
    have already shrunk every hole (including small-but-real counters, e.g. a script "e"'s bowl),
    making them misread as slivers themselves (see FONT-GEN-001 report's "e" regression).
    """
    probe_radius_fu = stone_diameter_fu * 0.25
    polys = _as_polygons(geometry)
    if not polys:
        return geometry, 0

    dissolved_count = 0
    rebuilt = []
    for poly in polys:
        if not poly.interiors:
            rebuilt.append(poly)
            continue
        shell = Polygon(poly.exterior)
        keep_holes = []
        for interior in poly.interiors:
            hole_poly = Polygon(interior)
            if _is_sliver_hole(hole_poly, probe_radius_fu):
                dissolved_count += 1
                continue  # fill this artifact hole in -- do not keep it
            keep_holes.append(hole_poly)
        if keep_holes:
            rebuilt.append(shell.difference(unary_union(keep_holes)))
        else:
            rebuilt.append(shell)
    result = unary_union(rebuilt) if len(rebuilt) > 1 else rebuilt[0]
    # Dissolving a genuinely tiny artifact hole is an intended, expected hole-count decrease, so
    # this step is exempt from the hole-count guard -- but an unexpected shell split/merge or total
    # collapse is still rejected.
    shell_ok = (not result.is_empty) and _shell_count(result) == _shell_count(geometry)
    return (result, dissolved_count) if shell_ok else (geometry, 0)


def _enlarge_holes(geometry, normal_min_opening_fu, loop_min_opening_fu, is_looped_category):
    """
    Enlarges every remaining interior hole (already known legitimate -- sliver artifacts were
    dissolved earlier by _dissolve_sliver_holes) whose measured opening falls below its category's
    threshold. Runs *after* min-width enforcement's global dilation so the target size accounts for
    the glyph's final stroke width, not a since-superseded intermediate one.
    """
    threshold_fu = loop_min_opening_fu if is_looped_category else normal_min_opening_fu
    target_half = threshold_fu / 2.0
    if target_half <= 0:
        return geometry, []

    polys = _as_polygons(geometry)
    if not polys:
        return geometry, []

    corrections = []
    rebuilt = []
    for poly in polys:
        if not poly.interiors:
            rebuilt.append(poly)
            continue
        shell = Polygon(poly.exterior)
        new_holes = []
        for interior in poly.interiors:
            hole_poly = Polygon(interior)
            measured_half = measure_min_half_width(hole_poly, target_half)
            deficit = max(0.0, target_half - measured_half)
            if deficit > 0:
                hole_poly = hole_poly.buffer(deficit, join_style=JOIN_STYLE_ROUND)
                corrections.append(deficit)
            new_holes.append(hole_poly)
        merged_holes = unary_union(new_holes)
        rebuilt.append(shell.difference(merged_holes))
    result = unary_union(rebuilt) if len(rebuilt) > 1 else rebuilt[0]
    guarded = _guard_topology(geometry, result)
    return guarded, (corrections if guarded is result else [])


def _hole_count(geometry):
    return sum(len(p.interiors) for p in _as_polygons(geometry))


def _shell_count(geometry):
    return len(_as_polygons(geometry))


def _guard_topology(original, candidate):
    """
    Buffer-based morphological passes (opening/closing) can silently erase a hole (e.g. a
    counter/loop whose wall is thinner than the pass's radius) or merge/split shells -- both are
    readability regressions worse than the defect the pass was meant to fix. Any step that would
    change the hole count or shell count is rejected wholesale (falls back to its input) rather
    than applied partially, so every accepted transform is provably non-destructive to topology.
    """
    if candidate is None or candidate.is_empty:
        return original
    if _hole_count(candidate) < _hole_count(original):
        return original
    if _shell_count(candidate) != _shell_count(original):
        return original
    return candidate


def _simplify_details(geometry, terminal_radius_fu):
    if terminal_radius_fu <= 0:
        return geometry
    # Cap the opening radius to a safe fraction of the glyph's own thinnest existing feature so it
    # can only smooth/remove genuinely small spurs, never eat through a stroke or counter wall
    # that is part of the glyph's real structure (see FONT-GEN-001 report's SS6 "o" regression).
    safe_radius = min(terminal_radius_fu, measure_min_half_width(geometry, terminal_radius_fu) * 0.6)
    if safe_radius <= 0:
        return geometry
    opened = geometry.buffer(-safe_radius, join_style=JOIN_STYLE_ROUND)
    opened = opened.buffer(safe_radius, join_style=JOIN_STYLE_ROUND)
    return _guard_topology(geometry, opened)


def _round_junctions(geometry, radius_fu):
    if radius_fu <= 0:
        return geometry
    closed = geometry.buffer(radius_fu, join_style=JOIN_STYLE_ROUND).buffer(-radius_fu, join_style=JOIN_STYLE_ROUND)
    closed = _guard_topology(geometry, closed)
    opened = closed.buffer(-radius_fu, join_style=JOIN_STYLE_ROUND).buffer(radius_fu, join_style=JOIN_STYLE_ROUND)
    return _guard_topology(closed, opened)


def transform_glyph(contours, char, config, categories):
    """
    @param contours  list of raw flattened contours (font units) for one glyph
    @param char      the glyph's character (for category lookup / logging)
    @param config    resolved per-size threshold dict (font units already converted from mm)
    @param categories set of category strings from glyph_category.categories_for_char()
    @returns (new_contours, log) where log records what changed (for the machine-readable
             transformation log the milestone brief requires)
    """
    geometry = contours_to_geometry(contours)
    log = {"char": char, "categories": sorted(categories), "operations": []}
    if geometry is None:
        return [], log

    original_area = geometry.area

    geometry = _simplify_details(geometry, config["terminalSimplifyFu"])
    log["operations"].append({"type": "terminal-simplify", "radiusFu": config["terminalSimplifyFu"]})

    # Classify holes (real counter vs. sliver artifact) on geometry still close to the original
    # design, before min-width enforcement's global dilation would shrink every hole first.
    geometry, dissolved_count = _dissolve_sliver_holes(geometry, config["stoneDiameterFu"])
    if dissolved_count:
        log["operations"].append({"type": "artifact-hole-dissolve", "holesDissolved": dissolved_count})

    geometry, width_deficit = _enforce_min_width(geometry, config["minFeatureWidthFu"])
    if width_deficit > 0:
        log["operations"].append({"type": "min-width-enforcement", "expandedByFu": round(width_deficit, 2)})

    # Enlarge remaining (already-known-legitimate) holes *after* the dilation above, so the target
    # size is checked against the glyph's final stroke width rather than a since-superseded one.
    is_looped = "looped-lowercase" in categories
    geometry, hole_corrections = _enlarge_holes(
        geometry, config["minCounterOpeningFu"], config["minLoopOpeningFu"], is_looped
    )
    if hole_corrections:
        log["operations"].append({
            "type": "loop-opening" if is_looped else "counter-enlargement",
            "holesCorrected": len(hole_corrections),
            "maxDeficitFu": round(max(hole_corrections), 2)
        })

    geometry = _round_junctions(geometry, config["cornerRoundFu"])
    log["operations"].append({"type": "corner-rounding", "radiusFu": config["cornerRoundFu"]})

    new_contours = geometry_to_contours(geometry, min_area=config.get("minAreaFu", 4.0))
    log["areaBefore"] = round(original_area, 1)
    log["areaAfter"] = round(geometry.area, 1) if not geometry.is_empty else 0.0
    log["contoursBefore"] = len(contours)
    log["contoursAfter"] = len(new_contours)
    return new_contours, log
