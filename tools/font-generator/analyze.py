#!/usr/bin/env python3
"""
FONT-GEN-001 -- aggregates one size's evaluation.<SIZE>.json into acceptance-threshold findings.

Usage:
  tmp/font-generator-venv/bin/python3 tools/font-generator/analyze.py --size SS6
  tmp/font-generator-venv/bin/python3 tools/font-generator/analyze.py --all
"""
import argparse
import json
import sys
from pathlib import Path
from statistics import mean

sys.path.insert(0, str(Path(__file__).resolve().parent))
from paths import DEFAULT_FAMILY, output_dir, repo_relative, sized_json_filename

ALL_SIZES = ["SS6", "SS10", "SS16", "SS20", "SS30"]

# FONT-GEN-001 documented acceptance thresholds -- applied identically to every size (per brief:
# "Apply the same threshold definitions to all five variants... do not silently lower a threshold
# to accept a weak font").
THRESHOLDS = {
    "minCharAccuracy": 0.85,
    "minWordAccuracy": 0.80,
    "minRequiredPhraseAccuracy": 1.0,   # required phrases must be exact-match at every tested height
    "minConfidence": 40.0,              # tesseract confidence, 0-100 scale, where available
    "maxUnrecognizedSamples": 0.15,     # fraction of non-required corpus samples allowed 0% char accuracy
    "maxAmbiguousPairRepeats": 2        # a confusable pair may be confused at most this many height/size combos before flagging
}


def summarize(evaluation, required_ids=None):
    def agg(rows):
        rows_with_ocr = [r for r in rows if r.get("ocr")]
        char_accs = [r["ocr"]["charAccuracy"] for r in rows_with_ocr]
        word_accs = [r["ocr"]["wordAccuracy"] for r in rows_with_ocr]
        confidences = [r["ocr"]["confidence"] for r in rows_with_ocr if r["ocr"]["confidence"] is not None]
        exact = [r for r in rows_with_ocr if r["ocr"]["exactMatch"]]
        required = [r for r in rows_with_ocr if r["isRequiredPhrase"]]
        required_pass = [r for r in required if r["ocr"]["exactMatch"]]
        unrecognized = [r for r in rows_with_ocr if r["ocr"]["charAccuracy"] == 0.0]
        errors = [r for r in rows if r.get("error")]
        # Geometry metrics straight from the real production pipeline (measure.mjs), independent
        # of OCR -- see FONT-GEN-001 report Sec.8/9 for why clusterCount is weighted as a second,
        # unambiguous line of evidence alongside OCR.
        cluster_counts = [r["clusterCount"] for r in rows if not r.get("error") and r.get("clusterCount") is not None]
        collision_counts = [r["collisionCount"] for r in rows if not r.get("error") and r.get("collisionCount") is not None]
        stone_counts = [r["stoneCount"] for r in rows if not r.get("error") and r.get("stoneCount") is not None]
        return {
            "count": len(rows),
            "errors": len(errors),
            "meanCharAccuracy": round(mean(char_accs), 4) if char_accs else None,
            "meanWordAccuracy": round(mean(word_accs), 4) if word_accs else None,
            "meanConfidence": round(mean(confidences), 1) if confidences else None,
            "meanClusterCount": round(mean(cluster_counts), 2) if cluster_counts else None,
            "meanCollisionCount": round(mean(collision_counts), 2) if collision_counts else None,
            "meanStoneCount": round(mean(stone_counts), 1) if stone_counts else None,
            "exactMatchRate": round(len(exact) / len(rows_with_ocr), 4) if rows_with_ocr else None,
            "requiredPhraseCount": len(required),
            "requiredPhrasePassCount": len(required_pass),
            "requiredPhraseAccuracy": round(len(required_pass) / len(required), 4) if required else None,
            "unrecognizedCount": len(unrecognized),
            "unrecognizedFraction": round(len(unrecognized) / len(rows_with_ocr), 4) if rows_with_ocr else None,
            "worst": sorted(
                ({"id": r["label"], "text": r["text"], "heightMm": r["heightMm"],
                  "charAccuracy": r["ocr"]["charAccuracy"], "rawOcrText": r["ocr"]["rawOcrText"]}
                 for r in rows_with_ocr),
                key=lambda x: x["charAccuracy"]
            )[:10]
        }

    return {
        "sizeId": evaluation["sizeId"],
        "heightsMm": evaluation["heightsMm"],
        "generated": agg(evaluation["generated"]),
        "baseline": agg(evaluation["baseline"])
    }


def check_thresholds(summary):
    g = summary["generated"]
    findings = []
    passed = True

    def fail(msg):
        nonlocal passed
        passed = False
        findings.append(msg)

    if g["meanCharAccuracy"] is None or g["meanCharAccuracy"] < THRESHOLDS["minCharAccuracy"]:
        fail(f"meanCharAccuracy {g['meanCharAccuracy']} < {THRESHOLDS['minCharAccuracy']}")
    if g["meanWordAccuracy"] is None or g["meanWordAccuracy"] < THRESHOLDS["minWordAccuracy"]:
        fail(f"meanWordAccuracy {g['meanWordAccuracy']} < {THRESHOLDS['minWordAccuracy']}")
    if g["requiredPhraseAccuracy"] is None or g["requiredPhraseAccuracy"] < THRESHOLDS["minRequiredPhraseAccuracy"]:
        fail(f"requiredPhraseAccuracy {g['requiredPhraseAccuracy']} < {THRESHOLDS['minRequiredPhraseAccuracy']}")
    if g["unrecognizedFraction"] is not None and g["unrecognizedFraction"] > THRESHOLDS["maxUnrecognizedSamples"]:
        fail(f"unrecognizedFraction {g['unrecognizedFraction']} > {THRESHOLDS['maxUnrecognizedSamples']}")

    return {"passed": passed, "findings": findings, "thresholds": THRESHOLDS}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--size", choices=ALL_SIZES)
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--family", default=DEFAULT_FAMILY)
    args = parser.parse_args()
    sizes = ALL_SIZES if args.all else [args.size]

    for size_id in sizes:
        eval_path = output_dir(size_id) / sized_json_filename("evaluation", args.family, size_id)
        with open(eval_path) as f:
            evaluation = json.load(f)
        summary = summarize(evaluation)
        verdict = check_thresholds(summary)

        summary_path = output_dir(size_id) / sized_json_filename("summary", args.family, size_id)
        with open(summary_path, "w") as f:
            json.dump({**summary, "verdict": verdict}, f, indent=2)

        g, b = summary["generated"], summary["baseline"]
        print(f"\n=== {size_id} ===")
        print(f"  generated: charAcc={g['meanCharAccuracy']} wordAcc={g['meanWordAccuracy']} "
              f"exactRate={g['exactMatchRate']} requiredPhrase={g['requiredPhrasePassCount']}/{g['requiredPhraseCount']} "
              f"unrecognized={g['unrecognizedCount']}/{g['count']}")
        print(f"  baseline:  charAcc={b['meanCharAccuracy']} wordAcc={b['meanWordAccuracy']} "
              f"exactRate={b['exactMatchRate']} requiredPhrase={b['requiredPhrasePassCount']}/{b['requiredPhraseCount']} "
              f"unrecognized={b['unrecognizedCount']}/{b['count']}")
        print(f"  verdict: {'PASS' if verdict['passed'] else 'FAIL'} -- {verdict['findings']}")


if __name__ == "__main__":
    main()
