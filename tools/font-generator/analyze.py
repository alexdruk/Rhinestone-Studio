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
from lib import vision_eval

ALL_SIZES = ["SS6", "SS10", "SS16", "SS20", "SS30"]

# FONT-GEN-001 documented acceptance thresholds -- applied identically to every size. Retired as
# the acceptance gate per FONT-EVAL-002 Sec.5 / FONT-DECISION-001: pytesseract was found to be the
# confound behind every REJECT verdict, not font legibility (a vision-capable read of the same
# renders scored 132/140 exact where pytesseract scored 30/140). Kept here unchanged, and
# check_thresholds() still computes against it, purely as a secondary/legacy metric for
# continuity with FONT-GEN-001-004's historical numbers -- it is NOT the signal acceptance
# decisions are based on going forward. No calibrated numeric vision threshold exists (or is
# invented here); direct/vision review is the acceptance signal (see FONT-DECISION-001's rater
# tool). See meanCharAccuracyVision/requiredPhraseAccuracyVision below for the primary metric.
THRESHOLDS = {
    "minCharAccuracy": 0.85,
    "minWordAccuracy": 0.80,
    "minRequiredPhraseAccuracy": 1.0,   # required phrases must be exact-match at every tested height
    "minConfidence": 40.0,              # tesseract confidence, 0-100 scale, where available
    "maxUnrecognizedSamples": 0.15,     # fraction of non-required corpus samples allowed 0% char accuracy
    "maxAmbiguousPairRepeats": 2        # a confusable pair may be confused at most this many height/size combos before flagging
}


def attach_vision(rows, vision_lookup):
    """
    FONT-DECISION-001 -- attaches a `visionOcr` field (vision_eval.evaluate() result) to any row
    whose (baseId, heightLabel) matches a supplied manual vision-transcription. `vision_lookup` is
    keyed by (baseId, heightLabel) -> transcribedText. Rows with no matching transcription are
    left untouched (no `visionOcr` key) -- vision-transcription is manual and only ever covers a
    curated subset, never the full corpus, so absence here is expected, not an error.
    """
    if not vision_lookup:
        return rows
    for r in rows:
        transcribed = vision_lookup.get((r.get("baseId"), r.get("heightLabel")))
        if transcribed is not None:
            r["visionOcr"] = vision_eval.evaluate(r["text"], transcribed)
    return rows


def summarize(evaluation, required_ids=None, vision_lookup=None):
    if vision_lookup:
        attach_vision(evaluation["generated"], vision_lookup)
        attach_vision(evaluation["baseline"], vision_lookup)

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

        # FONT-DECISION-001 -- vision-transcription aggregates, additive only. Populated only for
        # rows a manual vision pass actually covered (attach_vision(), called from summarize() when
        # a vision_lookup is supplied) -- vision-transcription is manual and never covers the full
        # corpus, so these are None/empty whenever no vision data was attached, same as before this
        # change. This, not meanCharAccuracy/requiredPhraseAccuracy above, is the primary
        # acceptance-relevant signal per FONT-EVAL-002/FONT-DECISION-001.
        rows_with_vision = [r for r in rows if r.get("visionOcr")]
        vision_char_accs = [r["visionOcr"]["charAccuracy"] for r in rows_with_vision]
        vision_exact = [r for r in rows_with_vision if r["visionOcr"]["exactMatch"]]
        vision_required = [r for r in rows_with_vision if r["isRequiredPhrase"]]
        vision_required_pass = [r for r in vision_required if r["visionOcr"]["exactMatch"]]

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
            "visionSampleCount": len(rows_with_vision),
            "meanCharAccuracyVision": round(mean(vision_char_accs), 4) if vision_char_accs else None,
            "exactMatchRateVision": round(len(vision_exact) / len(rows_with_vision), 4) if rows_with_vision else None,
            "requiredPhraseCountVision": len(vision_required),
            "requiredPhrasePassCountVision": len(vision_required_pass),
            "requiredPhraseAccuracyVision": round(len(vision_required_pass) / len(vision_required), 4) if vision_required else None,
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
    """
    Legacy pytesseract-based gate (FONT-GEN-001). Retired as the acceptance signal per
    FONT-EVAL-002 Sec.5 / FONT-DECISION-001 -- retained unmodified, computing the same thresholds
    against the same pytesseract fields, purely so historical PASS/FAIL numbers stay comparable
    across milestones. Do not treat this verdict as the acceptance decision; see
    meanCharAccuracyVision/requiredPhraseAccuracyVision in summarize() and this repo's
    docs/specifications/FONT-DECISION-001-*.md for the metric decisions are actually based on now.
    """
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

    return {"passed": passed, "findings": findings, "thresholds": THRESHOLDS, "metric": "legacyPytesseract"}


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
