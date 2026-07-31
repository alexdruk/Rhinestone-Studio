#!/usr/bin/env python3
"""
FONT-POLICY-001 -- SS30 height-ceiling sweep.

FONT-PORTFOLIO-001's human ratings collapsed at SS30 for Anton (6/16), Sacramento (2/16), and
Dancing Script (1/16), while Baloo2Variable wght400 held up (15/16) -- and a721445's follow-up
found clusterCount does NOT show a matching uniform spike at SS30, so fragmentation counts alone
cannot explain (or locate a fix for) the collapse. FONT-ARCH-001/FONT-CAL-001 already flagged
SS30's 106-111mm range as a "milestone-specified table" value, not derived from any font's own
metrics or a physical printable-area constraint -- this script tests whether raising it recovers
readability.

Sweeps stoneSizeId=ss30 across heights from the current 111mm ceiling up to 200mm (7 points: 111,
125, 140, 155, 170, 185, 200) for Anton, Sacramento, Dancing Script (the 3 fonts that collapsed)
and Baloo2Variable wght400 (control -- already passes, must not regress). Measures
clusterCount/collisionCount for the full 16-phrase corpus at every height (same measure.mjs/
GeometryEngine production path every prior milestone used), and renders genuine
render_review_png() stone-dot images for the 4 required phrases at every height (a representative
subset -- full 16-phrase renders happen later, only for whichever heights this sweep identifies as
candidates, per the milestone brief's rater-tool step).

Usage:
  tmp/font-generator-venv/bin/python3 tools/font-generator/render_font_policy_001.py
  tmp/font-generator-venv/bin/python3 tools/font-generator/render_font_policy_001.py --spotcheck
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from paths import REPO_ROOT, TOOL_ROOT
from pipeline import run_measure
from lib.render_stones import render_review_png
from render_portfolio001 import load_text_and_category_by_id, ALL_PHRASE_IDS, build_contact_sheet
from PIL import Image

OUT_DIR = REPO_ROOT / "tmp" / "font-policy-001"
RENDER_DIR = OUT_DIR / "renders"
SHEET_DIR = OUT_DIR / "sheets"

HEIGHTS_MM = [111, 125, 140, 155, 170, 185, 200]
REQUIRED_IDS = ["req-ashley", "req-bride-squad", "req-happy-birthday", "req-class-of-2027"]

FONTS = {
    "Anton": REPO_ROOT / "fonts" / "sources" / "Anton" / "Anton.ttf",
    "Sacramento": REPO_ROOT / "fonts" / "sources" / "Sacramento" / "Sacramento.ttf",
    "DancingScript": REPO_ROOT / "fonts" / "sources" / "DancingScript" / "DancingScript.ttf",
    "Baloo2Variable": REPO_ROOT / "fonts" / "sources" / "Baloo2" / "Baloo2-wght400.ttf",
}


def cases_for(phrase_ids, text_and_cat_by_id, height_mm):
    cases = []
    for pid in phrase_ids:
        text, category = text_and_cat_by_id[pid]
        cases.append({
            "id": f"{pid}__h{height_mm}", "baseId": pid, "text": text, "category": category,
            "heightLabel": f"h{height_mm}", "stoneSizeId": "ss30", "heightMm": height_mm
        })
    return cases


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--spotcheck", action="store_true",
                         help="Only Anton, 2 heights, 2 phrases -- sanity check before the full run.")
    args = parser.parse_args()

    RENDER_DIR.mkdir(parents=True, exist_ok=True)
    SHEET_DIR.mkdir(parents=True, exist_ok=True)
    text_and_cat_by_id = load_text_and_category_by_id()

    fonts = {"Anton": FONTS["Anton"]} if args.spotcheck else FONTS
    heights = HEIGHTS_MM[:2] if args.spotcheck else HEIGHTS_MM

    measurements = []
    manifest = []

    for family, font_path in fonts.items():
        for height_mm in heights:
            full_phrase_ids = ALL_PHRASE_IDS[:2] if args.spotcheck else ALL_PHRASE_IDS
            cases = cases_for(full_phrase_ids, text_and_cat_by_id, height_mm)
            tmp_name = f"policy001-{family}-h{height_mm}"
            print(f"[{family}] {height_mm}mm: measuring {len(cases)} cases (clusterCount sweep)...")
            results = run_measure(font_path, cases, tmp_name)

            sheet_entries = []
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
                if base_id in REQUIRED_IDS:
                    img_name = f"{family}-h{height_mm}-{base_id}.png"
                    img_path = RENDER_DIR / img_name
                    render_review_png(r["stones"], img_path)
                    manifest.append({
                        "image": f"renders/{img_name}", "family": family, "heightMm": height_mm,
                        "baseId": base_id, "expectedText": r["text"]
                    })
                    sheet_entries.append((base_id, r["text"], Image.open(img_path)))

            if sheet_entries:
                sheet_name = f"{family}-h{height_mm}.png"
                build_contact_sheet(sheet_entries, SHEET_DIR / sheet_name, f"{family} SS30 @ {height_mm}mm")

    with open(OUT_DIR / "measurements.json", "w") as f:
        json.dump(measurements, f, indent=2)
    with open(OUT_DIR / "manifest.json", "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"\n{len(measurements)} measured cases, {len(manifest)} rendered images -> {OUT_DIR}")


if __name__ == "__main__":
    main()
