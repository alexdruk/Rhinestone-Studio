"""
FONT-GEN-001 -- glyph outline <-> shapely geometry conversion.

Converts a TrueType glyph's on/off-curve quadratic contours into flattened polygon rings (shapely),
applies procedural transforms, and converts the result back into simple line-segment contours for
fontTools' TTGlyphPen. Curves are flattened at generation time (24 segments/curve, finer than the
production pipeline's own runtime flattening of 16 -- see ContourGeometry.flattenContourToPolygon,
FONT-DIAG-001's pipeline trace) so the shipped outline is already at-or-above the fidelity the real
StoneSampler pipeline would produce from a live curve, and shapely never has to reason about
quadratic curves directly.
"""
from fontTools.pens.basePen import BasePen, decomposeQuadraticSegment
from shapely.geometry import Polygon, MultiPolygon
from shapely.ops import unary_union
from shapely.validation import make_valid
import functools

CURVE_FLATTEN_SEGMENTS = 24


def _quad_point(p0, p1, p2, t):
    x = (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0]
    y = (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]
    return (x, y)


class FlatteningPen(BasePen):
    """Records each contour as a flat list of (x, y) points (curves flattened to line segments)."""

    def __init__(self, glyphSet):
        super().__init__(glyphSet)
        self.contours = []
        self._current = []

    def _moveTo(self, pt):
        self._current = [pt]

    def _lineTo(self, pt):
        self._current.append(pt)

    def _curveToOne(self, p1, p2, p3):
        # Cubic curves don't occur in this TrueType source, but handle defensively via
        # subdivision so the tool doesn't silently mis-render a future source with cubics.
        p0 = self._current[-1]
        for i in range(1, CURVE_FLATTEN_SEGMENTS + 1):
            t = i / CURVE_FLATTEN_SEGMENTS
            mt = 1 - t
            x = mt**3 * p0[0] + 3 * mt**2 * t * p1[0] + 3 * mt * t**2 * p2[0] + t**3 * p3[0]
            y = mt**3 * p0[1] + 3 * mt**2 * t * p1[1] + 3 * mt * t**2 * p2[1] + t**3 * p3[1]
            self._current.append((x, y))

    def _qCurveToOne(self, p1, p2):
        p0 = self._current[-1]
        for i in range(1, CURVE_FLATTEN_SEGMENTS + 1):
            t = i / CURVE_FLATTEN_SEGMENTS
            self._current.append(_quad_point(p0, p1, p2, t))

    def qCurveTo(self, *points):
        # TrueType allows omitting on-curve points between consecutive off-curve points (implied
        # midpoint). decomposeQuadraticSegment (fontTools.pens.basePen) is the standard helper for
        # expanding that into simple (off, on) pairs -- reused rather than re-derived.
        if points[-1] is None:
            # A pure off-curve closed contour (fully implied on-curve points) -- fontTools passes
            # None as the final "on-curve" point in this rare case; close using the start point.
            points = points[:-1] + (self._current[0],)
        for segment in decomposeQuadraticSegment(points):
            self._qCurveToOne(*segment)

    def _closePath(self):
        if len(self._current) >= 3:
            self.contours.append(self._current)
        self._current = []

    def _endPath(self):
        self._closePath()


def flatten_glyph_to_contours(glyph_set, glyph_name):
    """Returns a list of contours, each a list of (x, y) float tuples, in font units."""
    pen = FlatteningPen(glyph_set)
    glyph_set[glyph_name].draw(pen)
    return pen.contours


def contours_to_geometry(contours):
    """
    Even-odd (XOR) composition of raw contours into a single shapely geometry -- robust to
    whatever nesting depth/winding direction the source font used (see this tool's README for the
    empirical winding check against Sacramento's own "o"/"i" glyphs). Real font outlines never
    partially self-overlap, so even-odd and TrueType's nonzero winding rule agree for every
    practical glyph.
    """
    if not contours:
        return None
    polys = []
    for c in contours:
        if len(c) < 3:
            continue
        p = Polygon(c)
        if not p.is_valid:
            p = make_valid(p)
        polys.append(p)
    if not polys:
        return None
    combined = functools.reduce(lambda a, b: a.symmetric_difference(b), polys)
    if combined.is_empty:
        return None
    return combined


def geometry_to_contours(geometry, min_area=0.5):
    """
    Converts a shapely Polygon/MultiPolygon back into a list of (points, is_hole) contours,
    dropping slivers smaller than min_area (font units^2) left over from buffer operations --
    the "remove duplicate or zero-length segments" / invalid-topology cleanup step.
    """
    if geometry is None or geometry.is_empty:
        return []
    polys = geometry.geoms if isinstance(geometry, MultiPolygon) else [geometry]
    out = []
    for poly in polys:
        if poly.area < min_area:
            continue
        exterior = list(poly.exterior.coords)[:-1]
        if len(exterior) >= 3:
            out.append((exterior, False))
        for interior in poly.interiors:
            pts = list(interior.coords)[:-1]
            if len(pts) >= 3 and abs(Polygon(pts).area) >= min_area:
                out.append((pts, True))
    return out


def signed_area(points):
    area = 0.0
    n = len(points)
    for i in range(n):
        x1, y1 = points[i]
        x2, y2 = points[(i + 1) % n]
        area += x1 * y2 - x2 * y1
    return area / 2.0
