"""
Solid-ink OCR control -- renders a font's text as normal filled vector glyph outlines (no
rhinestone/stone conversion at all) at the same physical letter height the rhinestone pipeline
uses, so OCR accuracy against it can be compared as a readability ceiling against the real
StoneLayout-based renders (render_stones.py). Nothing here touches GeometryEngine/StoneLayout --
this is a standalone, out-of-band visualization path for this offline research tool only, same
category as render_stones.py itself (per CLAUDE.md, "renderers/exporters must never generate
stones" governs production code; this tool deliberately renders no stones at all).

Coordinate convention note: this module reads raw fontTools glyf contours directly (genuine
TrueType Y-up: ascender positive Y, descender negative Y) -- NOT the Y-down convention
StoneLayout.yMm has (see FONT-GEN-005's investigation: that Y-down-ness comes specifically from
opentype.js's Glyph.getPath() negating Y internally, which this module does not use at all). A
real Y-up->Y-down flip is required here, unlike render_stones.py's fixed functions.
"""
from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw

from .glyph_geometry import flatten_glyph_to_contours, contours_to_geometry

MAX_FINAL_WIDTH_PX = 6000
SUPERSAMPLE = 4  # matches render_ocr_image()'s own convention -- thin native strokes (e.g. Baloo2
# Regular measured well under 1mm in FONT-GEN-003's own Step 1) alias badly without this at
# reasonable output resolution, unfairly depressing the "ceiling" for lighter weights specifically.


def _as_polygons(geometry):
    from shapely.geometry import MultiPolygon
    if geometry is None or geometry.is_empty:
        return []
    return list(geometry.geoms) if isinstance(geometry, MultiPolygon) else [geometry]


def layout_text_contours(font_path, text, height_mm):
    """
    Lays out `text` left-to-right using the font's own advance widths (font units), scaled so the
    font's full em-square equals height_mm -- the exact convention OpenTypeProvider.getTextPath()
    uses (unitsToMm = heightMm / unitsPerEm) everywhere else in this codebase. No kerning applied
    (deliberately -- isolates raw glyph-shape legibility from production's exact letter-spacing,
    which is not what this ceiling control is testing).

    @returns (contours_mm, bounds_mm) where contours_mm is a flat list of (points, is_hole)-style
             raw point lists in mm (Y-up, not yet flipped for raster) and bounds_mm is
             (minx, miny, maxx, maxy).
    """
    font = TTFont(str(font_path))
    glyph_set = font.getGlyphSet()
    hmtx = font["hmtx"]
    cmap = font.getBestCmap()
    units_per_em = font["head"].unitsPerEm
    units_to_mm = height_mm / units_per_em

    cursor_fu = 0.0
    all_contours = []
    for ch in text:
        codepoint = ord(ch)
        glyph_name = cmap.get(codepoint)
        if glyph_name is None:
            if ch == " ":
                space_name = cmap.get(32)
                cursor_fu += (hmtx[space_name][0] if space_name else units_per_em * 0.25)
            continue
        contours = flatten_glyph_to_contours(glyph_set, glyph_name)
        for c in contours:
            all_contours.append([(x + cursor_fu, y) for (x, y) in c])
        cursor_fu += hmtx[glyph_name][0]

    if not all_contours:
        return [], (0, 0, 0, 0)

    geometry = contours_to_geometry(all_contours)
    if geometry is None or geometry.is_empty:
        return [], (0, 0, 0, 0)

    # Scale font units -> mm directly on the shapely geometry.
    from shapely.affinity import scale as shapely_scale
    geometry_mm = shapely_scale(geometry, xfact=units_to_mm, yfact=units_to_mm, origin=(0, 0))
    return geometry_mm, geometry_mm.bounds


def render_solid_ink_image(font_path, text, height_mm, px_per_mm=16, margin_px=24):
    """Returns a PIL Image (grayscale, white background, black ink) ready for pytesseract."""
    geometry_mm, (minx, miny, maxx, maxy) = layout_text_contours(font_path, text, height_mm)
    if geometry_mm is None or (hasattr(geometry_mm, "is_empty") and geometry_mm.is_empty):
        return Image.new("L", (200, 80), 255)

    pad_mm = height_mm * 0.08
    minx, miny, maxx, maxy = minx - pad_mm, miny - pad_mm, maxx + pad_mm, maxy + pad_mm
    width_mm = maxx - minx
    if width_mm * px_per_mm > MAX_FINAL_WIDTH_PX:
        px_per_mm = MAX_FINAL_WIDTH_PX / width_mm

    scale = px_per_mm * SUPERSAMPLE
    w = max(1, int((maxx - minx) * scale))
    h = max(1, int((maxy - miny) * scale))

    img = Image.new("L", (w, h), 255)
    draw = ImageDraw.Draw(img)
    for poly in _as_polygons(geometry_mm):
        # Genuine Y-up data (raw TrueType glyf contours, no opentype.js involved) -- a real flip
        # is required here: maxy (top of the glyph) -> row 0; miny (bottom) -> row h.
        exterior = [((x - minx) * scale, (maxy - y) * scale) for x, y in poly.exterior.coords]
        draw.polygon(exterior, fill=0)
        for interior in poly.interiors:
            hole = [((x - minx) * scale, (maxy - y) * scale) for x, y in interior.coords]
            draw.polygon(hole, fill=255)

    img = img.resize((max(1, w // SUPERSAMPLE), max(1, h // SUPERSAMPLE)), Image.LANCZOS)
    padded = Image.new("L", (img.width + margin_px * 2, img.height + margin_px * 2), 255)
    padded.paste(img, (margin_px, margin_px))
    return padded
