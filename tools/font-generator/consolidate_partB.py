#!/usr/bin/env python3
"""
FONT-DECISION-001 Part B -- scores the 240 manually-vision-transcribed longform-corpus renders
(tmp/font-decision-001/vision-transcriptions.partB.json) via lib.vision_eval, and merges in
clusterCount/collisionCount/stoneCount from the full 420-case measurement grid
(tmp/font-decision-001/longform/measurements.json) for every family/variant/size, not just the
240-case vision-transcribed priority subset.

Usage:
  tmp/font-generator-venv/bin/python3 tools/font-generator/consolidate_partB.py
"""
import json
from pathlib import Path
from statistics import mean

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from paths import REPO_ROOT
from lib import vision_eval

OUT_DIR = REPO_ROOT / "tmp" / "font-decision-001"
LONGFORM_DIR = OUT_DIR / "longform"
CORPUS_FILE = REPO_ROOT / "tools" / "font-generator" / "corpus_longform.json"


def load_expected_text():
    with open(CORPUS_FILE) as f:
        items = json.load(f)["items"]
    return {item["id"]: item["text"] for item in items}


def main():
    with open(OUT_DIR / "vision-transcriptions.partB.json") as f:
        vision_rows = json.load(f)
    with open(LONGFORM_DIR / "measurements.json") as f:
        measurements = json.load(f)
    expected_by_id = load_expected_text()

    # Vision-scored table -- the 240-case priority subset (Sacramento + Baloo2Variable, all sizes).
    vision_scored = []
    for row in vision_rows:
        expected = expected_by_id[row["baseId"]]
        result = vision_eval.evaluate(expected, row["transcribedText"])
        vision_scored.append({**row, "expectedText": expected, "vision": result})

    groups = {}
    for row in vision_scored:
        key = (row["family"], row["variant"], row["sizeId"])
        groups.setdefault(key, []).append(row)

    table_vision = []
    for (family, variant, size_id), rows in sorted(groups.items()):
        char_accs = [r["vision"]["charAccuracy"] for r in rows]
        exact = sum(1 for r in rows if r["vision"]["exactMatch"])
        table_vision.append({
            "family": family, "variant": variant, "sizeId": size_id, "n": len(rows),
            "meanCharAccuracy": round(mean(char_accs), 4),
            "exactMatch": f"{exact}/{len(rows)}",
            "nonExactCases": [
                {"baseId": r["baseId"], "expected": r["expectedText"], "transcribed": r["transcribedText"]}
                for r in rows if not r["vision"]["exactMatch"]
            ],
        })

    # clusterCount table -- the full 420-case grid (all 7 variants x 5 sizes), independent of the
    # vision-transcription subset above.
    cluster_groups = {}
    for m in measurements:
        key = (m["family"], m["variant"], m["sizeId"])
        cluster_groups.setdefault(key, []).append(m["clusterCount"])
    table_cluster = [
        {"family": f, "variant": v, "sizeId": s, "n": len(counts), "meanClusterCount": round(mean(counts), 2)}
        for (f, v, s), counts in sorted(cluster_groups.items())
    ]

    out = {"visionByFamilyVariantSize": table_vision, "clusterCountByFamilyVariantSize": table_cluster}
    with open(OUT_DIR / "consolidated.partB.json", "w") as f:
        json.dump(out, f, indent=2)
    print(f"Wrote {OUT_DIR / 'consolidated.partB.json'}")

    print("\n=== Part B vision-transcription accuracy (12 longform phrases per cell) ===")
    for r in table_vision:
        print(f"  {r['family']:16s} {r['variant']:10s} {r['sizeId']:6s} charAcc={r['meanCharAccuracy']} exact={r['exactMatch']}")

    print("\n=== Part B clusterCount, full 7-variant x 5-size grid ===")
    for r in table_cluster:
        print(f"  {r['family']:20s} {r['variant']:10s} {r['sizeId']:6s} meanClusterCount={r['meanClusterCount']}")


if __name__ == "__main__":
    main()
