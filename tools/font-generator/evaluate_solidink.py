#!/usr/bin/env python3
"""
FONT-EVAL-001 -- solid-ink OCR ceiling evaluation.

For each (family, size) cell already measured by pipeline.py (FONT-GEN-001 through 005), renders
the same 171-case corpus as plain filled vector glyph outlines (lib/solid_ink.py -- no rhinestone
conversion, no GeometryEngine/measure.mjs involved at all) at the same physical letter heights, and
scores it with the exact same OCR pipeline (lib/ocr_eval.py) every prior milestone used. This
establishes whether the 0.85/0.80/1.0/0.15 acceptance thresholds (analyze.py THRESHOLDS) are
reachable in principle -- i.e. even with zero information loss from stone discretization -- for
each font/weight/size combination.

No Node round-trip needed: solid_ink.layout_text_contours() reads raw fontTools glyf outlines
directly, so this script never touches measure.mjs, GeometryEngine, or StoneLayout.

Usage:
  tmp/font-generator-venv/bin/python3 tools/font-generator/evaluate_solidink.py --size SS6
  tmp/font-generator-venv/bin/python3 tools/font-generator/evaluate_solidink.py --all
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from paths import (CONFIG_DIR, DEFAULT_FAMILY, FAMILY_SOURCE_FONTS, FAMILY_SIZE_SOURCE_FONTS,
                    output_dir, repo_relative, variant_filename)
from pipeline import load_corpus, build_cases
from lib.solid_ink import render_solid_ink_image
from lib.ocr_eval import evaluate

ALL_SIZES = ["SS6", "SS10", "SS16", "SS20", "SS30"]

# FONT-EVAL-001 grid -- mirrors FONT-GEN-005's re-validated grid exactly (docs/specifications/
# FONT-GEN-005-OCRRenderOrientationBugFix.md Sec.3): the 4 generated families plus their 3 distinct
# baseline source fonts. SacramentoSkeleton shares Sacramento's baseline (same source TTF,
# unmodified) -- BASELINE_REUSE routes it to Sacramento's already-computed baseline cell instead of
# re-rendering/re-scoring the identical font a second time, same convention pipeline.py's
# --reuse-baseline-from introduced.
FAMILIES = ["Sacramento", "Baloo2", "Baloo2Variable", "SacramentoSkeleton"]
BASELINE_REUSE = {"SacramentoSkeleton": "Sacramento"}


def solidink_json_filename(prefix, family, size_id_upper, variant):
    suffix = "" if family == DEFAULT_FAMILY else f".{family}"
    return f"{prefix}.solidink.{variant}{suffix}.{size_id_upper}.json"


def baseline_font_for(family, size_id_upper):
    if family in FAMILY_SIZE_SOURCE_FONTS:
        return FAMILY_SIZE_SOURCE_FONTS[family][size_id_upper]
    return FAMILY_SOURCE_FONTS[family]


def generated_font_for(family, size_id_upper):
    return output_dir(size_id_upper) / variant_filename(family, size_id_upper)


def evaluate_cases(font_path, cases, verbose, label):
    results = []
    for i, case in enumerate(cases):
        if verbose and i % 50 == 0:
            print(f"    [{label}] {i}/{len(cases)}")
        try:
            image = render_solid_ink_image(str(font_path), case["text"], case["heightMm"])
            ocr = evaluate(case["text"], image)
            ocr_error = None
        except Exception as exc:
            ocr = None
            ocr_error = str(exc)
        results.append({
            "label": case["id"],
            "baseId": case["baseId"],
            "text": case["text"],
            "category": case["category"],
            "heightLabel": case["heightLabel"],
            "heightMm": case["heightMm"],
            "ocr": ocr,
            "ocrError": ocr_error,
        })
    return results


def evaluate_size(size_id_upper, corpus_items, required_ids, family, variant, verbose=True):
    size_id = size_id_upper.lower()
    with open(CONFIG_DIR / f"{size_id_upper}.json") as f:
        config = json.load(f)
    heights_mm = {
        "min": config["supportedHeightRangeMm"][0],
        "mid": round((config["supportedHeightRangeMm"][0] + config["supportedHeightRangeMm"][1]) / 2, 1),
        "max": config["supportedHeightRangeMm"][1]
    }
    cases = build_cases(corpus_items, size_id, heights_mm)
    for c in cases:
        c["isRequiredPhrase"] = c["baseId"] in required_ids

    source_path = generated_font_for(family, size_id_upper) if variant == "generated" else baseline_font_for(family, size_id_upper)
    if verbose:
        print(f"[{size_id_upper}] {family} ({variant}): solid-ink OCR ({len(cases)} cases)...")
    results = evaluate_cases(source_path, cases, verbose, f"{family}-{variant}-{size_id_upper}")
    for r, c in zip(results, cases):
        r["isRequiredPhrase"] = c["isRequiredPhrase"]

    result = {
        "sizeId": size_id,
        "family": family,
        "variant": variant,
        "heightsMm": heights_mm,
        "config": config,
        "sourcePath": repo_relative(source_path),
        "solidink": results,
    }

    out_path = output_dir(size_id_upper) / solidink_json_filename("evaluation", family, size_id_upper, variant)
    with open(out_path, "w") as f:
        json.dump(result, f, indent=2)
    if verbose:
        print(f"[{size_id_upper}] {family} ({variant}) solid-ink evaluation -> {repo_relative(out_path)}")
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--size", choices=ALL_SIZES)
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--family", choices=FAMILIES)
    args = parser.parse_args()
    if not args.size and not args.all:
        parser.error("--size <SIZE> or --all required")

    corpus_items, required_ids = load_corpus()
    sizes = ALL_SIZES if args.all else [args.size]
    families = [args.family] if args.family else FAMILIES
    for size_id in sizes:
        for family in families:
            evaluate_size(size_id, corpus_items, required_ids, family, "generated")
            if family in BASELINE_REUSE:
                print(f"[{size_id}] {family} (baseline) reuses {BASELINE_REUSE[family]}'s baseline cell -- same unmodified source font, not re-rendered")
                continue
            evaluate_size(size_id, corpus_items, required_ids, family, "baseline")


if __name__ == "__main__":
    main()
