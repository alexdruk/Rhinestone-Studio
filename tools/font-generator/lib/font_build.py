"""
FONT-GEN-001 -- assembles a generated rhinestone-variant TTF from the Sacramento source.

Only glyphs reachable from the ASCII 32-126 cmap range are touched (everything this milestone's
corpus/required phrases need); every other glyph, table, and the cmap itself are carried over
unchanged, so Unicode mappings and OpenType structure stay intact per the brief's processing
requirements (#9: "Preserve Unicode mappings and necessary OpenType structures").
"""
import copy
from fontTools.ttLib import TTFont, newTable
from fontTools.pens.ttGlyphPen import TTGlyphPen

from .glyph_geometry import flatten_glyph_to_contours, signed_area
from .glyph_transform import transform_glyph
from .glyph_category import categories_for_char

ASCII_RANGE = range(32, 127)


def _reverse_contour(points):
    return list(reversed(points))


def build_glyph_pen(glyph_set, contours):
    """
    Writes shapely-derived contours (exterior CCW / hole CW, GEOS's normalized convention) back
    into TrueType winding (shell CW / hole CCW -- verified empirically against this source font's
    own "o"/"i" glyphs, see glyph_geometry.py's module docstring) by reversing every ring, then
    emits a simple straight-line-segment glyph via TTGlyphPen (curves were already flattened before
    any shapely operation ran).
    """
    pen = TTGlyphPen(glyph_set)
    for points, _is_hole in contours:
        ring = _reverse_contour(points)
        pen.moveTo(ring[0])
        for pt in ring[1:]:
            pen.lineTo(pt)
        pen.closePath()
    return pen.glyph()


def generate_variant(source_path, config, out_path):
    """
    @param source_path  Path to Sacramento.ttf
    @param config       Resolved size config dict, including *Fu (font-unit) thresholds already
                         converted from mm at the variant's minimum committed height
    @param out_path     Path to write the generated TTF
    @returns generation log dict (glyph logs + summary), written alongside the font as metadata
    """
    font = TTFont(str(source_path))
    glyf = font["glyf"]
    glyph_set = font.getGlyphSet()
    hmtx = font["hmtx"]
    cmap = font.getBestCmap()
    units_per_em = font["head"].unitsPerEm

    glyph_logs = []
    side_bearing_adjust_fu = config.get("sideBearingAdjustFu", 0.0)

    for codepoint in ASCII_RANGE:
        char = chr(codepoint)
        glyph_name = cmap.get(codepoint)
        if glyph_name is None or char == " ":
            continue

        contours = flatten_glyph_to_contours(glyph_set, glyph_name)
        if not contours:
            continue  # e.g. space-like/empty glyphs -- nothing to transform

        categories = categories_for_char(char)
        new_contours, log = transform_glyph(contours, char, config, categories)
        log["glyphName"] = glyph_name
        glyph_logs.append(log)

        if not new_contours:
            continue  # transform degenerated the glyph to nothing -- keep original outline untouched
        new_glyph = build_glyph_pen(glyph_set, new_contours)
        new_glyph.recalcBounds(glyf)
        glyf[glyph_name] = new_glyph

        old_advance, _old_lsb = hmtx[glyph_name]
        new_advance = int(round(old_advance + 2 * side_bearing_adjust_fu))
        new_lsb = int(new_glyph.xMin) if hasattr(new_glyph, "xMin") else 0
        hmtx[glyph_name] = (max(new_advance, 1), new_lsb)

    _rename_font(font, config)
    font.save(str(out_path))

    return {
        "sizeId": config["sizeId"],
        "sourceFont": str(source_path),
        "outputFont": str(out_path),
        "unitsPerEm": units_per_em,
        "config": {k: v for k, v in config.items() if not k.startswith("_")},
        "glyphsTransformed": len(glyph_logs),
        "glyphLogs": glyph_logs
    }


def _rename_font(font, config):
    family = config["familyName"]
    full_name = f"{family} Regular"
    postscript_name = family.replace(" ", "") + "-Regular"
    name_table = font["name"]

    def set_name(name_id, value):
        name_table.setName(value, name_id, 3, 1, 0x409)
        name_table.setName(value, name_id, 1, 0, 0)

    set_name(1, family)       # Family
    set_name(2, "Regular")    # Subfamily
    set_name(3, postscript_name)  # Unique identifier
    set_name(4, full_name)    # Full name
    set_name(6, postscript_name)  # PostScript name
    set_name(16, family)      # Typographic family (kept identical to family; no style axes)
    set_name(17, "Regular")   # Typographic subfamily
