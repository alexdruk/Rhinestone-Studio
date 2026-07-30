#!/usr/bin/env python3
"""
FONT-EVAL-002 Part C -- renders the 12 human-panel stimulus items (user-specified subset):
Sacramento baseline, Sacramento generated (FONT-GEN-001), SacramentoSkeleton generated
(FONT-GEN-004), Baloo2Variable baseline at wght 400/500/600 -- x SS16 + SS30.

Text rotates through the 4 required phrases round-robin across the 12 items so no two adjacent
items repeat a word (avoids transcription-by-memory bias in the blind survey). Reuses
pipeline.py's run_measure() (real measure.mjs/GeometryEngine path) + render_stones.render_review_png()
(closer to real product-viewing appearance than the OCR-scoring render).

Usage:
  tmp/font-generator-venv/bin/python3 tools/font-generator/render_human_panel.py
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from paths import CONFIG_DIR, REPO_ROOT, output_dir, variant_filename
from pipeline import load_corpus, run_measure
from lib.render_stones import render_review_png

OUT_DIR = REPO_ROOT / "tmp" / "font-eval-002-panel"
BALOO2_DIR = REPO_ROOT / "fonts" / "sources" / "Baloo2"
SACRAMENTO_SRC = REPO_ROOT / "fonts" / "sources" / "Sacramento" / "Sacramento.ttf"

ITEMS = [
    {"label": "Sacramento baseline", "path": lambda s: SACRAMENTO_SRC},
    {"label": "Sacramento generated (FONT-GEN-001)", "path": lambda s: output_dir(s) / variant_filename("Sacramento", s)},
    {"label": "SacramentoSkeleton generated (FONT-GEN-004)", "path": lambda s: output_dir(s) / variant_filename("SacramentoSkeleton", s)},
    {"label": "Baloo2Variable baseline wght400", "path": lambda s: BALOO2_DIR / "Baloo2-wght400.ttf"},
    {"label": "Baloo2Variable baseline wght500", "path": lambda s: BALOO2_DIR / "Baloo2-wght500.ttf"},
    {"label": "Baloo2Variable baseline wght600", "path": lambda s: BALOO2_DIR / "Baloo2-wght600.ttf"},
]
SIZES = ["SS16", "SS30"]


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    corpus_items, required_ids = load_corpus()
    required_items = [c for c in corpus_items if c["id"] in required_ids]

    flat = [(item, size) for item in ITEMS for size in SIZES]
    manifest = []
    for i, (item, size_upper) in enumerate(flat):
        phrase = required_items[i % len(required_items)]
        with open(CONFIG_DIR / f"{size_upper}.json") as f:
            config = json.load(f)
        mid_mm = round((config["supportedHeightRangeMm"][0] + config["supportedHeightRangeMm"][1]) / 2, 1)
        case = {
            "id": f"{phrase['id']}__mid", "baseId": phrase["id"], "text": phrase["text"],
            "category": phrase["category"], "heightLabel": "mid", "stoneSizeId": size_upper.lower(),
            "heightMm": mid_mm
        }
        font_path = item["path"](size_upper)
        print(f"[{i+1}/12] {item['label']} {size_upper}: '{phrase['text']}'...")
        results = run_measure(font_path, [case], f"panel-{i}-{size_upper}")
        r = results[0]
        if r.get("error"):
            print(f"  ERROR: {r['error']}")
            continue
        img_name = f"panel-{i+1:02d}.png"
        render_review_png(r["stones"], OUT_DIR / img_name)
        manifest.append({
            "n": i + 1, "image": img_name, "label": item["label"], "sizeId": size_upper,
            "expectedText": phrase["text"], "heightMm": mid_mm, "fontPath": str(font_path)
        })

    with open(OUT_DIR / "manifest.json", "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"\n{len(manifest)} items -> {OUT_DIR}")


if __name__ == "__main__":
    main()
