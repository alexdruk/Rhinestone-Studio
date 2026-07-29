#!/usr/bin/env python3
"""
FONT-GEN-001 -- generates one Sacramento Rhinestone variant TTF from a size config.

Usage:
  tmp/font-generator-venv/bin/python3 tools/font-generator/generate.py --size SS6
  tmp/font-generator-venv/bin/python3 tools/font-generator/generate.py --all

mm-based thresholds in config/<SIZE>.json are converted to font units using the variant's own
*minimum* committed height (the worst case -- OpenTypeProvider.getTextPath scales every glyph
coordinate uniformly by heightMm/unitsPerEm, so a correction sized for the smallest height is
still comfortably met at every larger height in the range; see this tool's README).
"""
import argparse
import json
import sys
from pathlib import Path
from fontTools.ttLib import TTFont

sys.path.insert(0, str(Path(__file__).resolve().parent))
from paths import CONFIG_DIR, DEFAULT_FAMILY, output_dir, repo_relative, source_font_for, variant_filename, sized_json_filename
from lib.font_build import generate_variant

ALL_SIZES = ["SS6", "SS10", "SS16", "SS20", "SS30"]


def resolve_config(size_id, family=DEFAULT_FAMILY):
    config_path = CONFIG_DIR / f"{size_id}.json"
    with open(config_path) as f:
        raw = json.load(f)

    source_font = TTFont(str(source_font_for(family)))
    units_per_em = source_font["head"].unitsPerEm

    calibration_height_mm = raw["supportedHeightRangeMm"][0]
    fu_per_mm = units_per_em / calibration_height_mm

    resolved = dict(raw)
    resolved["calibrationHeightMm"] = calibration_height_mm
    resolved["unitsPerEm"] = units_per_em
    for mm_key in [
        "minFeatureWidthMm", "minCounterOpeningMm", "minLoopOpeningMm",
        "cornerRoundMm", "terminalSimplifyMm", "sideBearingAdjustMm"
    ]:
        fu_key = mm_key.replace("Mm", "Fu")
        resolved[fu_key] = raw[mm_key] * fu_per_mm
    resolved["minAreaFu"] = raw["minAreaMm2"] * (fu_per_mm ** 2)

    # Used by glyph_transform._enlarge_holes to tell a real letter counter from a thin sliver
    # artifact (see that module's _is_sliver_hole docstring).
    resolved["stoneDiameterFu"] = raw["stoneDiameterMm"] * fu_per_mm

    if family != DEFAULT_FAMILY:
        # Config files are per-size, not per-family (thresholds are proportional to stone
        # diameter, not to the source font -- see FONT-GEN-002 brief). Relabel only the
        # human-readable familyName; every threshold value is reused unchanged.
        resolved["familyName"] = raw["familyName"].replace(DEFAULT_FAMILY, family)
    return resolved


def generate_one(size_id, family=DEFAULT_FAMILY, verbose=True):
    config = resolve_config(size_id, family)
    out_dir = output_dir(size_id)
    out_font_path = out_dir / variant_filename(family, size_id)
    metadata_path = out_dir / sized_json_filename("generation-metadata", family, size_id)
    source_font = source_font_for(family)

    if verbose:
        print(f"[{size_id}] generating from {repo_relative(source_font)} -> {repo_relative(out_font_path)}")

    log = generate_variant(source_font, config, out_font_path)
    log["outputFont"] = repo_relative(out_font_path)
    log["sourceFont"] = repo_relative(source_font)

    with open(metadata_path, "w") as f:
        json.dump(log, f, indent=2)

    if verbose:
        print(f"[{size_id}] {log['glyphsTransformed']} glyphs transformed, metadata -> {repo_relative(metadata_path)}")
    return log


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--size", choices=ALL_SIZES)
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--family", default=DEFAULT_FAMILY)
    args = parser.parse_args()

    if not args.size and not args.all:
        parser.error("--size <SIZE> or --all is required")

    sizes = ALL_SIZES if args.all else [args.size]
    for size_id in sizes:
        generate_one(size_id, args.family)


if __name__ == "__main__":
    main()
