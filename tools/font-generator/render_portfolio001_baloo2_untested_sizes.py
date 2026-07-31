#!/usr/bin/env python3
"""
FONT-PORTFOLIO-001 follow-up -- renders + measures Baloo2Variable baseline wght400 (the
FONT-DECISION-001-recommended production candidate) at SS10 and SS30 specifically -- the two
stone sizes FONT-DECISION-001's own human-rating pass never covered (it only rated SS6/SS16/SS20).
Given every font tested in this milestone (Sacramento, Dancing Script, Anton) collapsed hard on
human-rated readability at SS30, Baloo2Variable's SS30 standing needs direct evidence rather than
an assumption it would fare better untested.

Same 16-phrase corpus (4 required + 12 longform), same render_review_png() genuine stone-dot
render, same measure.mjs/GeometryEngine production path as render_portfolio001.py -- reuses its
helpers directly rather than duplicating them. 2 sizes x 16 phrases = 32 cases.

Usage:
  tmp/font-generator-venv/bin/python3 tools/font-generator/render_portfolio001_baloo2_gap_sizes.py
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pipeline import run_measure
from lib.render_stones import render_review_png
from render_portfolio001 import (
    REPO_ROOT, load_text_and_category_by_id, mid_mm_for, cases_for, ALL_PHRASE_IDS
)

OUT_DIR = REPO_ROOT / "tmp" / "font-portfolio-001-baloo2-gap-sizes"
RENDER_DIR = OUT_DIR / "renders"
FONT_PATH = REPO_ROOT / "fonts" / "sources" / "Baloo2" / "Baloo2-wght400.ttf"
SIZES = ["SS10", "SS30"]
FAMILY = "Baloo2Variable-wght400"


def main():
    RENDER_DIR.mkdir(parents=True, exist_ok=True)
    text_and_cat_by_id = load_text_and_category_by_id()

    measurements = []
    manifest = []

    for size_upper in SIZES:
        mid_mm, height_range = mid_mm_for(size_upper)
        cases = cases_for(ALL_PHRASE_IDS, text_and_cat_by_id, size_upper, mid_mm)
        tmp_name = f"portfolio001-baloo2gap-{size_upper}"
        print(f"[{FAMILY}] {size_upper}: measuring {len(cases)} cases (mid={mid_mm}mm, range={height_range})...")
        results = run_measure(FONT_PATH, cases, tmp_name)

        for r in results:
            if r.get("error"):
                print(f"  ERROR {r['label']}: {r['error']}")
                continue
            base_id = r["label"].split("__")[0]
            measurements.append({
                "family": FAMILY, "sizeId": size_upper, "baseId": base_id, "text": r["text"],
                "heightMm": mid_mm, "clusterCount": r.get("clusterCount"),
                "collisionCount": r.get("collisionCount"), "stoneCount": r.get("stoneCount"),
            })
            img_name = f"{FAMILY}-{size_upper}-{base_id}.png"
            img_path = RENDER_DIR / img_name
            render_review_png(r["stones"], img_path)
            manifest.append({
                "image": f"renders/{img_name}", "family": FAMILY, "sizeId": size_upper,
                "baseId": base_id, "expectedText": r["text"], "heightMm": mid_mm
            })

    with open(OUT_DIR / "measurements.json", "w") as f:
        json.dump(measurements, f, indent=2)
    with open(OUT_DIR / "manifest.json", "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"\n{len(measurements)} measured cases, {len(manifest)} rendered images -> {OUT_DIR}")


if __name__ == "__main__":
    main()
