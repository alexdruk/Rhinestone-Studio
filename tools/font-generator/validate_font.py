#!/usr/bin/env python3
"""
FONT-GEN-001 -- font structural validation.

Checks the milestone brief's "Font Validation" list against a generated TTF: fontTools reload,
required tables, internal naming, cmap coverage, glyph bounds, advance widths/side bearings.
Independent of the OCR/production-readability pipeline (pipeline.py) -- this only asks "is the
file a well-formed, loadable font", not "is it readable".

Usage:
  tmp/font-generator-venv/bin/python3 tools/font-generator/validate_font.py --size SS6
  tmp/font-generator-venv/bin/python3 tools/font-generator/validate_font.py --all
"""
import argparse
import json
import sys
from pathlib import Path
from fontTools.ttLib import TTFont

sys.path.insert(0, str(Path(__file__).resolve().parent))
from paths import DEFAULT_FAMILY, output_dir, repo_relative, variant_filename

ALL_SIZES = ["SS6", "SS10", "SS16", "SS20", "SS30"]
REQUIRED_TABLES = ["cmap", "glyf", "head", "hhea", "hmtx", "maxp", "name", "post", "loca"]
REQUIRED_ASCII = list(range(32, 127))


def validate(size_id_upper, expected_family=DEFAULT_FAMILY):
    font_path = output_dir(size_id_upper) / variant_filename(expected_family, size_id_upper)
    findings = []
    checks = {}

    try:
        font = TTFont(str(font_path))
        checks["reload"] = True
    except Exception as e:
        return {
            "sizeId": size_id_upper, "fontPath": repo_relative(font_path),
            "checks": {"reload": False}, "findings": [f"Failed to reload: {e}"], "passed": False
        }

    missing_tables = [t for t in REQUIRED_TABLES if t not in font]
    checks["requiredTables"] = len(missing_tables) == 0
    if missing_tables:
        findings.append(f"Missing required tables: {missing_tables}")

    family = font["name"].getDebugName(1)
    full_name = font["name"].getDebugName(4)
    checks["namingIsNotPlaceholder"] = "ElegantCursive" not in (family or "") and "ElegantCursive" not in (full_name or "")
    checks["namingIdentifiesVariant"] = size_id_upper in (family or "") and expected_family in (family or "")
    if not checks["namingIdentifiesVariant"]:
        findings.append(f"Family name '{family}' does not clearly identify {size_id_upper}")

    cmap = font.getBestCmap()
    missing_cps = [cp for cp in REQUIRED_ASCII if cp != 32 and cp not in cmap]
    checks["cmapCoverage"] = len(missing_cps) == 0
    if missing_cps:
        findings.append(f"Missing cmap coverage for codepoints: {missing_cps}")

    glyf = font["glyf"]
    hmtx = font["hmtx"]
    bad_bounds = []
    bad_advances = []
    for cp in REQUIRED_ASCII:
        name = cmap.get(cp)
        if not name:
            continue
        glyph = glyf[name]
        if glyph.numberOfContours != 0:
            if glyph.xMax < glyph.xMin or glyph.yMax < glyph.yMin:
                bad_bounds.append(name)
        advance, lsb = hmtx[name]
        if advance <= 0:
            bad_advances.append(name)
    checks["validGlyphBounds"] = len(bad_bounds) == 0
    checks["usableAdvanceWidths"] = len(bad_advances) == 0
    if bad_bounds:
        findings.append(f"Invalid bounds for glyphs: {bad_bounds}")
    if bad_advances:
        findings.append(f"Non-positive advance width for glyphs: {bad_advances}")

    checks["unitsPerEmPreserved"] = font["head"].unitsPerEm > 0
    passed = all(checks.values())

    return {
        "sizeId": size_id_upper,
        "fontPath": repo_relative(font_path),
        "family": family,
        "fullName": full_name,
        "checks": checks,
        "findings": findings,
        "passed": passed
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--size", choices=ALL_SIZES)
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--family", default=DEFAULT_FAMILY)
    args = parser.parse_args()
    sizes = ALL_SIZES if args.all else [args.size]

    results = {}
    for size_id in sizes:
        result = validate(size_id, args.family)
        results[size_id] = result
        status = "PASS" if result["passed"] else "FAIL"
        print(f"[{size_id}] {status} -- {result['family']!r} -- findings: {result['findings'] or 'none'}")

    return results


if __name__ == "__main__":
    main()
