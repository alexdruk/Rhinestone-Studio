#!/usr/bin/env python3
"""
FONT-GEN-003 -- measures each Baloo 2 named weight instance's own native (untransformed)
minimum stroke width and minimum counter/loop opening, and selects the best-fit source weight
per stone size (the instance needing the smallest correction to clear that size's thresholds).

Reuses lib.glyph_transform's existing functions unchanged -- measure_min_half_width (the exact
erosion-sweep primitive generate.py's transform already uses to size its own corrections),
_simplify_details and _dissolve_sliver_holes (the same two pre-processing steps transform_glyph()
itself runs, in the same order, before it ever measures a glyph for width/hole correction) -- and
generate.py's own resolve_config() for the mm<->fu conversion. No new transform or evaluation
logic, per the brief.

Measurement note: a first pass measured raw, fully-untransformed outlines directly and found the
font-wide minimum stroke half-width dominated by acute-angle joint notches in specific glyphs
(e.g. Baloo 2's "z", "k", "R" diagonal-to-stem joins) -- real geometric pinch points, but ones
transform_glyph() itself heals via its own terminal-simplify opening pass *before* it ever reaches
min-width enforcement (confirmed against FONT-GEN-002's own generation-metadata: e.g. "k" at SS30
logs no min-width-enforcement operation at all despite this raw pinch). Measuring raw outlines
therefore produced a non-monotonic, unrepresentative result (ExtraBold appearing "thinner" than
Regular). This script instead measures at the same point in the pipeline transform_glyph() itself
measures from -- post terminal-simplify, post sliver-dissolve -- which is what "native, as the
transform pipeline actually sees it" means in context, and what actually predicts Step 3's
per-glyph correction pressure.

Usage:
  tmp/font-generator-venv/bin/python3 tools/font-generator/select_source_weight.py
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from paths import CONFIG_DIR, REPO_ROOT, repo_relative
from lib.glyph_geometry import flatten_glyph_to_contours, contours_to_geometry
from lib.glyph_transform import measure_min_half_width, _as_polygons, _simplify_details, _dissolve_sliver_holes
from lib.glyph_category import categories_for_char
from fontTools.ttLib import TTFont
from shapely.geometry import Polygon
from generate import resolve_config

ALL_SIZES = ["SS6", "SS10", "SS16", "SS20", "SS30"]
WEIGHTS = [400, 500, 600, 700, 800]
WEIGHT_LABELS = {400: "Regular", 500: "Medium", 600: "SemiBold", 700: "Bold", 800: "ExtraBold"}
ASCII_RANGE = range(32, 127)

# Generous sweep caps (font units, 1000 upm) -- comfortably above any real stem/counter half-width
# in this font (spot-checked 35-90fu / 90-150fu across all 5 weights), so the erosion sweep finds
# the true post-simplify minimum rather than being capped by an arbitrary threshold-derived radius
# (unlike generate.py's own per-glyph correction sweep, which only needs to sweep up to its own
# size's threshold since it only cares whether a deficit exists, not the exact native value).
STROKE_SWEEP_CAP_FU = 300
HOLE_SWEEP_CAP_FU = 500
SWEEP_SAMPLES = 80


def measure_weight_native_fu(font_path, terminal_simplify_fu, stone_diameter_fu):
    """
    Font-wide native minimum half-width (fu) for stroke, counter (non-looped holes), and loop
    (looped-lowercase category holes), across the ASCII 32-126 glyph set generate.py itself
    processes, measured after the same terminal-simplify + sliver-dissolve pre-passes
    transform_glyph() runs before its own width/hole measurement. Returns full widths
    (2x half-width), matching how thresholds are expressed.
    """
    font = TTFont(str(font_path))
    glyph_set = font.getGlyphSet()
    cmap = font.getBestCmap()

    min_stroke_half = None
    min_counter_half = None
    min_loop_half = None

    for codepoint in ASCII_RANGE:
        char = chr(codepoint)
        glyph_name = cmap.get(codepoint)
        if glyph_name is None or char == " ":
            continue
        contours = flatten_glyph_to_contours(glyph_set, glyph_name)
        if not contours:
            continue
        geometry = contours_to_geometry(contours)
        if geometry is None:
            continue

        geometry = _simplify_details(geometry, terminal_simplify_fu)
        geometry, _dissolved = _dissolve_sliver_holes(geometry, stone_diameter_fu)
        if geometry is None or geometry.is_empty:
            continue

        stroke_half = measure_min_half_width(geometry, STROKE_SWEEP_CAP_FU, samples=SWEEP_SAMPLES)
        if min_stroke_half is None or stroke_half < min_stroke_half:
            min_stroke_half = stroke_half

        is_looped = "looped-lowercase" in categories_for_char(char)
        for poly in _as_polygons(geometry):
            for interior in poly.interiors:
                hole_poly = Polygon(interior)
                hole_half = measure_min_half_width(hole_poly, HOLE_SWEEP_CAP_FU, samples=SWEEP_SAMPLES)
                if is_looped:
                    if min_loop_half is None or hole_half < min_loop_half:
                        min_loop_half = hole_half
                else:
                    if min_counter_half is None or hole_half < min_counter_half:
                        min_counter_half = hole_half

    return {
        "minFeatureWidthFu": min_stroke_half * 2 if min_stroke_half is not None else None,
        "minCounterOpeningFu": min_counter_half * 2 if min_counter_half is not None else None,
        "minLoopOpeningFu": min_loop_half * 2 if min_loop_half is not None else None,
        "unitsPerEm": font["head"].unitsPerEm,
    }


def fu_to_mm(fu, units_per_em, height_mm):
    if fu is None:
        return None
    fu_per_mm = units_per_em / height_mm
    return fu / fu_per_mm


def main():
    weight_paths = {w: REPO_ROOT / "fonts" / "sources" / "Baloo2" / f"Baloo2-wght{w}.ttf" for w in WEIGHTS}
    for w, p in weight_paths.items():
        if not p.exists():
            raise SystemExit(f"Missing instanced weight file: {p} -- run the instancing step first.")

    sizes = {}
    for size_id in ALL_SIZES:
        with open(CONFIG_DIR / f"{size_id}.json") as f:
            sizes[size_id] = json.load(f)

    # resolve_config() only needs a Baloo2-family font to read unitsPerEm (1000, identical across
    # every named instance of the same variable font -- verified) and the size config; it does not
    # depend on which weight is eventually selected, so "Baloo2" (the existing ExtraBold-sourced
    # registry entry) is reused purely for this shared conversion, exactly as generate.py computes
    # it for real generation runs (calibrated at each size's minimum committed height).
    resolved_by_size = {size_id: resolve_config(size_id, family="Baloo2") for size_id in ALL_SIZES}

    # native_fu[size_id][weight] -- pre-processing (terminal-simplify/sliver-dissolve) is
    # size-specific (its Fu radius depends on that size's own mm thresholds), so the measurement
    # itself must run per (size, weight) pair, not once per weight.
    native_fu = {size_id: {} for size_id in ALL_SIZES}
    for size_id in ALL_SIZES:
        resolved = resolved_by_size[size_id]
        for w, p in weight_paths.items():
            native_fu[size_id][w] = measure_weight_native_fu(
                p, resolved["terminalSimplifyFu"], resolved["stoneDiameterFu"]
            )

    table = {}
    for size_id, cfg in sizes.items():
        lo, hi = cfg["supportedHeightRangeMm"]
        midpoint_mm = round((lo + hi) / 2, 2)
        thresholds = {
            "minFeatureWidthMm": cfg["minFeatureWidthMm"],
            "minCounterOpeningMm": cfg["minCounterOpeningMm"],
            "minLoopOpeningMm": cfg["minLoopOpeningMm"],
        }
        table[size_id] = {"midpointHeightMm": midpoint_mm, "thresholds": thresholds, "weights": {}}

        for w in WEIGHTS:
            fu = native_fu[size_id][w]
            native_mm = {
                key: fu_to_mm(fu[key.replace("Mm", "Fu")], fu["unitsPerEm"], midpoint_mm)
                for key in thresholds
            }
            deficits = {}
            for key in thresholds:
                deficit = round(max(0.0, thresholds[key] - native_mm[key]), 3)
                deficits[key] = deficit
            total_deficit_mm = round(sum(deficits.values()), 3)
            worst_metric = max(deficits, key=lambda k: deficits[k])
            table[size_id]["weights"][w] = {
                "label": WEIGHT_LABELS[w],
                "nativeMm": {k: round(v, 3) for k, v in native_mm.items()},
                "deficitMm": deficits,
                "totalDeficitMm": total_deficit_mm,
                "worstMetric": worst_metric,
                "clearsAllThresholds": total_deficit_mm == 0.0,
            }

    selection = {}
    for size_id in ALL_SIZES:
        weights_here = table[size_id]["weights"]
        # Smallest total positive correction needed across all 3 metrics; ties broken by lighter
        # weight (prefer the instance that needed to travel least from its own native design).
        best_w = min(WEIGHTS, key=lambda w: (weights_here[w]["totalDeficitMm"], w))
        selection[size_id] = {
            "selectedWeight": best_w,
            "selectedLabel": WEIGHT_LABELS[best_w],
            "totalDeficitMm": weights_here[best_w]["totalDeficitMm"],
            "clearsAllThresholds": weights_here[best_w]["clearsAllThresholds"],
            "extraBoldTotalDeficitMm": weights_here[800]["totalDeficitMm"],
        }

    out = {"nativeFu": native_fu, "table": table, "selection": selection}
    out_path = REPO_ROOT / "tmp" / "font-gen-003-weight-selection.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(out, f, indent=2)
    print(f"Wrote {repo_relative(out_path)}")

    for size_id in ALL_SIZES:
        s = selection[size_id]
        print(f"{size_id}: selected {s['selectedLabel']} ({s['selectedWeight']}) "
              f"totalDeficit={s['totalDeficitMm']}mm clearsAll={s['clearsAllThresholds']} "
              f"(ExtraBold totalDeficit was {s['extraBoldTotalDeficitMm']}mm)")


if __name__ == "__main__":
    main()
