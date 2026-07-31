#!/usr/bin/env python3
"""
FONT-DECISION-001 Part A -- reconstructs the 140-case vision-transcription dataset from
FONT-EVAL-002 (as corrected by FONT-DIAG-002) without re-viewing any image.

Why this is valid: the renders in tmp/font-eval-002-vision/ are byte-identical to what EVAL-002
and DIAG-002 already scored (no font regeneration since). 132 of 140 cases were exact-match
(transcribedText == expectedText by definition); the remaining 8 have their actual read text
quoted verbatim in FONT-EVAL-002 Sec.3's table, as corrected by FONT-DIAG-002's root-cause
re-inspection (Sacramento generated SS30 "Class of 2027" corrected from a reported miss back to
an exact match -- that correction is applied here too).

Usage:
  tmp/font-generator-venv/bin/python3 tools/font-generator/build_partA_vision_transcriptions.py
"""
import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
MANIFEST = REPO_ROOT / "tmp" / "font-eval-002-vision" / "manifest.json"
OUT_DIR = REPO_ROOT / "tmp" / "font-decision-001"

# FONT-EVAL-002 Sec.3's 8 non-exact transcriptions, as corrected by FONT-DIAG-002 (the original
# report's Sacramento generated SS30 "Class of 202" miss was a transcription error against a
# compressed review sheet, not a real defect -- DIAG-002 confirmed SS30 reads correctly and
# complete, so it is NOT listed here as non-exact; only the 8 real misses are).
NON_EXACT = {
    ("Baloo2Variable", "generated", "SS6", "req-happy-birthday"): "Happy Biri hday",
    ("Baloo2Variable", "generated", "SS10", "req-happy-birthday"): "Happy Biri hday",
    ("Baloo2Variable", "generated", "SS16", "req-happy-birthday"): "Happy Biri hday",
    ("Baloo2Variable", "generated", "SS20", "req-happy-birthday"): "Happy Biri hday",
    ("Baloo2Variable", "generated", "SS30", "req-happy-birthday"): "Happy Biri hday",
    ("Baloo2Variable", "generated", "SS20", "req-class-of-2027"): "C lass of 2027",
    ("Sacramento", "generated", "SS6", "req-class-of-2027"): "Class of 202",
    ("Baloo2Variable", "generated", "SS6", "req-class-of-2027"): "Class of 2021",
}


def main():
    with open(MANIFEST) as f:
        manifest = json.load(f)
    assert len(manifest) == 140, f"expected 140 manifest entries, found {len(manifest)}"

    rows = []
    for item in manifest:
        key = (item["family"], item["variant"], item["sizeId"], item["baseId"])
        transcribed = NON_EXACT.get(key, item["expectedText"])
        rows.append({
            "family": item["family"],
            "variant": item["variant"],
            "sizeId": item["sizeId"],
            "baseId": item["baseId"],
            "expectedText": item["expectedText"],
            "transcribedText": transcribed,
            "source": "FONT-EVAL-002 (corrected by FONT-DIAG-002)"
        })

    assert sum(1 for r in rows if r["transcribedText"] != r["expectedText"]) == 8

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / "vision-transcriptions.partA.json"
    with open(out_path, "w") as f:
        json.dump(rows, f, indent=2)
    print(f"Wrote {len(rows)} rows -> {out_path}")


if __name__ == "__main__":
    main()
