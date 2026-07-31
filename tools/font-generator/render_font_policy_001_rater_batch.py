#!/usr/bin/env python3
"""
FONT-POLICY-001 -- human-rater validation batch for the candidate SS30 height ceiling.

The clusterCount/stoneCount fragmentation-ratio sweep (render_font_policy_001.py) found Sacramento
and Dancing Script's fragmentation ratio falls back to SS20 parity somewhere around 145-155mm, and
keeps improving (visually confirmed via genuine render_review_png dot renders) up to at least
170mm, while Anton and Baloo2Variable wght400 (control) show no such trend either way. This script
renders the FULL 16-phrase corpus at both the CURRENT ceiling (111mm) and one candidate raised
ceiling (165mm -- picked as comfortably past both script fonts' fragmentation-parity crossing point
and Anton/Baloo2Variable's demonstrated stability, while still fitting this project's own vessel
printable-height envelope: tumbler 135-155mm, bottle 120-160mm, plate centerWell 175-215mm --
see FONT-POLICY-001's findings doc) for all 4 fonts, so a human rater can directly compare the two
heights blind (family/size/height hidden during rating, same as every prior rater tool).

Per the milestone brief: do NOT update SS30.json / manifest.json / unsupportedStoneSizes from this
data alone -- this batch exists to gather the human-rating evidence the brief requires before any
production config change.

Usage:
  tmp/font-generator-venv/bin/python3 tools/font-generator/render_font_policy_001_rater_batch.py
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from paths import REPO_ROOT
from pipeline import run_measure
from lib.render_stones import render_review_png
from render_portfolio001 import load_text_and_category_by_id, ALL_PHRASE_IDS
from render_font_policy_001 import FONTS, cases_for

OUT_DIR = REPO_ROOT / "tmp" / "font-policy-001-rater-batch"
RENDER_DIR = OUT_DIR / "renders"

HEIGHTS_MM = [111, 165]  # current ceiling vs. candidate ceiling


def main():
    RENDER_DIR.mkdir(parents=True, exist_ok=True)
    text_and_cat_by_id = load_text_and_category_by_id()

    measurements = []
    manifest = []

    for family, font_path in FONTS.items():
        for height_mm in HEIGHTS_MM:
            cases = cases_for(ALL_PHRASE_IDS, text_and_cat_by_id, height_mm)
            tmp_name = f"policy001rater-{family}-h{height_mm}"
            print(f"[{family}] {height_mm}mm: measuring {len(cases)} cases...")
            results = run_measure(font_path, cases, tmp_name)

            for r in results:
                if r.get("error"):
                    print(f"  ERROR {r['label']}: {r['error']}")
                    continue
                base_id = r["label"].split("__")[0]
                measurements.append({
                    "family": family, "heightMm": height_mm, "baseId": base_id, "text": r["text"],
                    "clusterCount": r.get("clusterCount"),
                    "collisionCount": r.get("collisionCount"), "stoneCount": r.get("stoneCount"),
                })
                img_name = f"{family}-h{height_mm}-{base_id}.png"
                img_path = RENDER_DIR / img_name
                render_review_png(r["stones"], img_path)
                manifest.append({
                    "image": f"renders/{img_name}", "family": family, "heightMm": height_mm,
                    "baseId": base_id, "expectedText": r["text"]
                })

    with open(OUT_DIR / "measurements.json", "w") as f:
        json.dump(measurements, f, indent=2)
    with open(OUT_DIR / "manifest.json", "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"\n{len(measurements)} measured cases, {len(manifest)} rendered images -> {OUT_DIR}")


if __name__ == "__main__":
    main()
