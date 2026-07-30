#!/usr/bin/env python3
"""
FONT-EVAL-001 -- aggregates one evaluation.solidink.<variant>[.<family>].<SIZE>.json into
acceptance-threshold findings, using the exact same THRESHOLDS/check_thresholds() logic as
analyze.py (imported directly, not duplicated) so solid-ink and rhinestone verdicts are
apples-to-apples comparable.

Usage:
  tmp/font-generator-venv/bin/python3 tools/font-generator/analyze_solidink.py --all
"""
import argparse
import json
import sys
from pathlib import Path
from statistics import mean

sys.path.insert(0, str(Path(__file__).resolve().parent))
from paths import DEFAULT_FAMILY, output_dir, repo_relative
from analyze import THRESHOLDS
from evaluate_solidink import ALL_SIZES, FAMILIES, BASELINE_REUSE, solidink_json_filename


def summarize(evaluation):
    rows = evaluation["solidink"]
    rows_with_ocr = [r for r in rows if r.get("ocr")]
    char_accs = [r["ocr"]["charAccuracy"] for r in rows_with_ocr]
    word_accs = [r["ocr"]["wordAccuracy"] for r in rows_with_ocr]
    exact = [r for r in rows_with_ocr if r["ocr"]["exactMatch"]]
    required = [r for r in rows_with_ocr if r["isRequiredPhrase"]]
    required_pass = [r for r in required if r["ocr"]["exactMatch"]]
    unrecognized = [r for r in rows_with_ocr if r["ocr"]["charAccuracy"] == 0.0]
    return {
        "sizeId": evaluation["sizeId"], "family": evaluation["family"], "variant": evaluation["variant"],
        "count": len(rows),
        "meanCharAccuracy": round(mean(char_accs), 4) if char_accs else None,
        "meanWordAccuracy": round(mean(word_accs), 4) if word_accs else None,
        "exactMatchRate": round(len(exact) / len(rows_with_ocr), 4) if rows_with_ocr else None,
        "requiredPhraseCount": len(required),
        "requiredPhrasePassCount": len(required_pass),
        "requiredPhraseAccuracy": round(len(required_pass) / len(required), 4) if required else None,
        "unrecognizedCount": len(unrecognized),
        "unrecognizedFraction": round(len(unrecognized) / len(rows_with_ocr), 4) if rows_with_ocr else None,
    }


def check_thresholds(summary):
    findings = []
    passed = True

    def fail(msg):
        nonlocal passed
        passed = False
        findings.append(msg)

    if summary["meanCharAccuracy"] is None or summary["meanCharAccuracy"] < THRESHOLDS["minCharAccuracy"]:
        fail(f"meanCharAccuracy {summary['meanCharAccuracy']} < {THRESHOLDS['minCharAccuracy']}")
    if summary["meanWordAccuracy"] is None or summary["meanWordAccuracy"] < THRESHOLDS["minWordAccuracy"]:
        fail(f"meanWordAccuracy {summary['meanWordAccuracy']} < {THRESHOLDS['minWordAccuracy']}")
    if summary["requiredPhraseAccuracy"] is None or summary["requiredPhraseAccuracy"] < THRESHOLDS["minRequiredPhraseAccuracy"]:
        fail(f"requiredPhraseAccuracy {summary['requiredPhraseAccuracy']} < {THRESHOLDS['minRequiredPhraseAccuracy']}")
    if summary["unrecognizedFraction"] is not None and summary["unrecognizedFraction"] > THRESHOLDS["maxUnrecognizedSamples"]:
        fail(f"unrecognizedFraction {summary['unrecognizedFraction']} > {THRESHOLDS['maxUnrecognizedSamples']}")

    return {"passed": passed, "findings": findings, "thresholds": THRESHOLDS}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--all", action="store_true")
    args = parser.parse_args()

    all_summaries = []
    for size_upper in ALL_SIZES:
        for family in FAMILIES:
            variants = [("generated", family)]
            if family in BASELINE_REUSE:
                variants.append(("baseline", BASELINE_REUSE[family]))
            else:
                variants.append(("baseline", family))
            for variant, source_family in variants:
                path = output_dir(size_upper) / solidink_json_filename("evaluation", source_family, size_upper, variant)
                with open(path) as f:
                    evaluation = json.load(f)
                summary = summarize(evaluation)
                verdict = check_thresholds(summary)
                out_path = output_dir(size_upper) / solidink_json_filename("summary", source_family, size_upper, variant)
                with open(out_path, "w") as f:
                    json.dump({**summary, "verdict": verdict, "displayFamily": family}, f, indent=2)
                all_summaries.append({**summary, "verdict": verdict, "displayFamily": family})
                print(f"{size_upper:>5} {family:<20} {variant:<10} charAcc={summary['meanCharAccuracy']} "
                      f"wordAcc={summary['meanWordAccuracy']} reqPhrase={summary['requiredPhrasePassCount']}/{summary['requiredPhraseCount']} "
                      f"unrecFrac={summary['unrecognizedFraction']} -- {'PASS' if verdict['passed'] else 'FAIL'}")

    passing = [s for s in all_summaries if s["verdict"]["passed"]]
    print(f"\n{len(passing)} / {len(all_summaries)} cells clear all four thresholds on solid ink (zero stone discretization).")


if __name__ == "__main__":
    main()
