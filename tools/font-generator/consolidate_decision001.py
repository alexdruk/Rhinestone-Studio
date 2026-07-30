#!/usr/bin/env python3
"""
FONT-DECISION-001 Part A -- consolidates vision-transcription (primary), pytesseract (secondary/
legacy) and clusterCount (geometry, unaffected) evidence -- previously scattered across
FONT-GEN-001/002/003/004/005 and FONT-EVAL-002 -- into one dataset.

Table 1 (accuracy, n=20 per family/variant: 4 required phrases x 5 sizes, mid-height, matching
FONT-EVAL-002's own sample exactly) is built from tmp/font-decision-001/vision-transcriptions.partA.json
(reconstructed by build_partA_vision_transcriptions.py) plus the matching per-case pytesseract rows
already present in generated-fonts/SS*/evaluation*.json (not re-derived).

Table 2 (clusterCount, per family x size) is pulled directly from the existing
generated-fonts/SS*/summary*.json mean fields -- geometry metrics were never affected by the
pytesseract/vision question and are reused as-is, per the milestone brief.

Usage:
  tmp/font-generator-venv/bin/python3 tools/font-generator/consolidate_decision001.py
"""
import json
from pathlib import Path
from statistics import mean

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from paths import REPO_ROOT, output_dir, sized_json_filename
from lib import vision_eval

ALL_SIZES = ["SS6", "SS10", "SS16", "SS20", "SS30"]
OUT_DIR = REPO_ROOT / "tmp" / "font-decision-001"
VISION_PARTA = OUT_DIR / "vision-transcriptions.partA.json"

# family -> the family-qualified key evaluation files are stored under (None == DEFAULT_FAMILY,
# i.e. unqualified filenames -- see paths.sized_json_filename).
EVAL_FAMILY_KEY = {
    "Sacramento": "Sacramento",
    "Baloo2": "Baloo2",
    "Baloo2Variable": "Baloo2Variable",
    "SacramentoSkeleton": "SacramentoSkeleton",
}


def load_eval(family, size_upper):
    path = output_dir(size_upper) / sized_json_filename("evaluation", family, size_upper)
    with open(path) as f:
        return json.load(f)


def pytesseract_row_for(evaluation, variant, base_id):
    rows = evaluation[variant]
    label = f"{base_id}__mid"
    for r in rows:
        if r["label"] == label:
            return r.get("ocr")
    return None


def build_table1(vision_rows):
    eval_cache = {}
    groups = {}
    for row in vision_rows:
        key = (row["family"], row["variant"])
        groups.setdefault(key, []).append(row)

    table1 = []
    for (family, variant), rows in groups.items():
        vision_results = []
        pytess_results = []
        for row in rows:
            v = vision_eval.evaluate(row["expectedText"], row["transcribedText"])
            vision_results.append(v)

            cache_key = (family, row["sizeId"])
            if cache_key not in eval_cache:
                eval_cache[cache_key] = load_eval(family, row["sizeId"])
            ocr = pytesseract_row_for(eval_cache[cache_key], variant, row["baseId"])
            if ocr is not None:
                pytess_results.append(ocr)

        n = len(rows)
        vision_exact = sum(1 for v in vision_results if v["exactMatch"])
        pytess_exact = sum(1 for o in pytess_results if o["exactMatch"])
        table1.append({
            "family": family,
            "variant": variant,
            "n": n,
            "visionCharAccuracy": round(mean(v["charAccuracy"] for v in vision_results), 4),
            "visionExactMatch": f"{vision_exact}/{n}",
            "pytesseractCharAccuracyLegacy": round(mean(o["charAccuracy"] for o in pytess_results), 4) if pytess_results else None,
            "pytesseractExactMatchLegacy": f"{pytess_exact}/{len(pytess_results)}" if pytess_results else None,
        })

    order = {"Sacramento": 0, "SacramentoSkeleton": 1, "Baloo2": 2, "Baloo2Variable": 3}
    table1.sort(key=lambda r: (order.get(r["family"], 99), r["variant"]))
    return table1


def build_table2():
    table2 = []
    for family in ["Sacramento", "SacramentoSkeleton", "Baloo2", "Baloo2Variable"]:
        for size_upper in ALL_SIZES:
            summary_path = output_dir(size_upper) / sized_json_filename("summary", family, size_upper)
            if not summary_path.exists():
                continue
            with open(summary_path) as f:
                summary = json.load(f)
            g, b = summary["generated"], summary["baseline"]
            table2.append({
                "family": family,
                "sizeId": size_upper,
                "meanClusterCountGenerated": g["meanClusterCount"],
                "meanClusterCountBaseline": b["meanClusterCount"],
                "meanStoneCountGenerated": g["meanStoneCount"],
            })
    return table2


def main():
    with open(VISION_PARTA) as f:
        vision_rows = json.load(f)

    table1 = build_table1(vision_rows)
    table2 = build_table2()

    # Baloo2Variable weights 500/600/700/800 -- explicitly no OCR/vision evaluation data exists
    # (only FONT-GEN-003's native-geometry weight-selection numbers, a different metric measured
    # pre-transform, not post-render readability). Documented rather than silently omitted.
    note = ("Baloo2Variable weights 500/600/700/800 have no OCR/vision evaluation data -- only "
            "wght400 was ever generated + evaluated (FONT-GEN-003 selected Regular at every size). "
            "Weights 500-800 were only measured for native-geometry deficit during weight "
            "selection (tools/font-generator/select_source_weight.py), not rendered or read.")

    out = {"table1AccuracyByFamilyVariant": table1, "table2ClusterCountByFamilySize": table2, "note": note}
    out_path = OUT_DIR / "consolidated.partA.json"
    with open(out_path, "w") as f:
        json.dump(out, f, indent=2)
    print(f"Wrote {out_path}")

    print("\n=== Table 1: accuracy (n=20 per family/variant: 4 required phrases x 5 sizes, mid-height) ===")
    for r in table1:
        print(f"  {r['family']:20s} {r['variant']:10s} vision charAcc={r['visionCharAccuracy']} exact={r['visionExactMatch']:6s} "
              f"| pytesseract(legacy) charAcc={r['pytesseractCharAccuracyLegacy']} exact={r['pytesseractExactMatchLegacy']}")

    print("\n=== Table 2: clusterCount, generated vs baseline, per size ===")
    for r in table2:
        print(f"  {r['family']:20s} {r['sizeId']:6s} generated={r['meanClusterCountGenerated']} baseline={r['meanClusterCountBaseline']}")

    print(f"\nNOTE: {note}")


if __name__ == "__main__":
    main()
