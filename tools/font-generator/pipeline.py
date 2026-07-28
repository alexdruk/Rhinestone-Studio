#!/usr/bin/env python3
"""
FONT-GEN-001 -- evaluation orchestrator.

For one stone size: builds the case list (fixed corpus x min/mid/max heights), measures both the
generated variant and the original Sacramento (baseline) through the real production pipeline
(measure.mjs -> font-cal-001's measureProduction.mjs -> font-certification's productionAnalysis.mjs
-- unchanged), rasterizes each case's stones, runs OCR, and writes one aggregated evaluation JSON
per size to output/<SIZE>/. No CSV/SVG -- only TTFs, JSON metadata, and (for a curated subset)
PNGs under review/assets/, per this milestone's output restrictions.

Usage:
  tmp/font-generator-venv/bin/python3 tools/font-generator/pipeline.py --size SS6
  tmp/font-generator-venv/bin/python3 tools/font-generator/pipeline.py --all
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from paths import REPO_ROOT, CONFIG_DIR, CORPUS_FILE, SOURCE_FONT, output_dir, repo_relative
from lib.render_stones import render_ocr_image
from lib.ocr_eval import evaluate

ALL_SIZES = ["SS6", "SS10", "SS16", "SS20", "SS30"]
NODE_MEASURE = REPO_ROOT / "tools" / "font-generator" / "measure.mjs"


def load_corpus():
    with open(CORPUS_FILE) as f:
        data = json.load(f)
    items = list(data["requiredPhrases"]) + list(data["items"])
    seen = set()
    unique = []
    for item in items:
        if item["id"] in seen:
            continue
        seen.add(item["id"])
        unique.append(item)
    required_ids = {p["id"] for p in data["requiredPhrases"]}
    return unique, required_ids


def build_cases(corpus_items, size_id, heights_mm):
    cases = []
    for height_label, height_mm in heights_mm.items():
        for item in corpus_items:
            cases.append({
                "id": f"{item['id']}__{height_label}",
                "baseId": item["id"],
                "text": item["text"],
                "category": item["category"],
                "heightLabel": height_label,
                "stoneSizeId": size_id,
                "heightMm": height_mm
            })
    return cases


def run_measure(font_path, cases, tmp_name):
    tmp_dir = REPO_ROOT / "tmp" / "font-gen-001-eval"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    input_path = tmp_dir / f"{tmp_name}.input.json"
    output_path = tmp_dir / f"{tmp_name}.output.json"
    with open(input_path, "w") as f:
        json.dump({"fontPath": str(font_path), "cases": cases}, f)
    subprocess.run(
        ["node", str(NODE_MEASURE), str(input_path), str(output_path)],
        check=True, cwd=str(REPO_ROOT)
    )
    with open(output_path) as f:
        return json.load(f)["results"]


def evaluate_case(measurement, required_ids, case_meta_by_id):
    # measureFont()'s Node round-trip only preserves fields analyzeOne() itself sets -- custom
    # fields attached to the outgoing case (category, heightLabel, baseId) are dropped, so they're
    # restored here from the case list Python built before that round-trip.
    meta = case_meta_by_id.get(measurement["label"], {})
    if measurement.get("error"):
        return {
            **{k: v for k, v in measurement.items() if k != "stones"},
            **meta,
            "ocr": None,
            "isRequiredPhrase": meta.get("baseId", measurement["label"].split("__")[0]) in required_ids
        }
    stones = measurement["stones"]
    base_id = meta.get("baseId", measurement["label"].split("__")[0])
    try:
        image = render_ocr_image(stones)
        ocr = evaluate(measurement["text"], image)
        ocr_error = None
    except Exception as exc:
        # A single case's OCR/render step must not abort the whole size's evaluation -- record the
        # failure as data (visible in the review page's failure table) and keep going, per the
        # brief's "when a repair is unsafe... record the limitation, continue processing" policy.
        ocr = None
        ocr_error = str(exc)
    return {
        **{k: v for k, v in measurement.items() if k != "stones"},
        **meta,
        "ocr": ocr,
        "ocrError": ocr_error,
        "isRequiredPhrase": base_id in required_ids
    }


def evaluate_size(size_id_upper, corpus_items, required_ids, verbose=True):
    size_id = size_id_upper.lower()
    with open(CONFIG_DIR / f"{size_id_upper}.json") as f:
        config = json.load(f)
    lo, mid_hi = config["supportedHeightRangeMm"]
    heights_mm = {
        "min": config["supportedHeightRangeMm"][0],
        "mid": round((config["supportedHeightRangeMm"][0] + config["supportedHeightRangeMm"][1]) / 2, 1),
        "max": config["supportedHeightRangeMm"][1]
    }
    cases = build_cases(corpus_items, size_id, heights_mm)
    case_meta_by_id = {c["id"]: {"category": c["category"], "heightLabel": c["heightLabel"], "baseId": c["baseId"]} for c in cases}

    generated_path = output_dir(size_id_upper) / f"SacramentoRhinestone_{size_id_upper}.ttf"

    if verbose:
        print(f"[{size_id_upper}] measuring generated variant ({len(cases)} cases)...")
    generated_results = run_measure(generated_path, cases, f"{size_id_upper}-generated")

    if verbose:
        print(f"[{size_id_upper}] measuring baseline Sacramento ({len(cases)} cases)...")
    baseline_results = run_measure(SOURCE_FONT, cases, f"{size_id_upper}-baseline")

    if verbose:
        print(f"[{size_id_upper}] rendering + OCR generated...")
    generated_eval = [evaluate_case(m, required_ids, case_meta_by_id) for m in generated_results]
    if verbose:
        print(f"[{size_id_upper}] rendering + OCR baseline...")
    baseline_eval = [evaluate_case(m, required_ids, case_meta_by_id) for m in baseline_results]

    result = {
        "sizeId": size_id,
        "heightsMm": heights_mm,
        "config": config,
        "generated": generated_eval,
        "baseline": baseline_eval
    }

    out_path = output_dir(size_id_upper) / f"evaluation.{size_id_upper}.json"
    with open(out_path, "w") as f:
        json.dump(result, f, indent=2)
    if verbose:
        print(f"[{size_id_upper}] evaluation -> {repo_relative(out_path)}")
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--size", choices=ALL_SIZES)
    parser.add_argument("--all", action="store_true")
    args = parser.parse_args()
    if not args.size and not args.all:
        parser.error("--size <SIZE> or --all required")

    corpus_items, required_ids = load_corpus()
    sizes = ALL_SIZES if args.all else [args.size]
    for size_id in sizes:
        evaluate_size(size_id, corpus_items, required_ids)


if __name__ == "__main__":
    main()
