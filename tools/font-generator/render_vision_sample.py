#!/usr/bin/env python3
"""
FONT-EVAL-002 Part B -- renders the vision-transcription sample: 4 required phrases x mid-height
x 7 font variants (4 generated + 3 distinct baselines) x 5 sizes = 140 rhinestone OCR-style PNGs.

Reuses pipeline.py's run_measure() (the real measure.mjs -> GeometryEngine/StoneLayout production
path -- same one every prior FONT-GEN milestone used) to get real stone positions, then
lib.render_stones.render_ocr_image() (the orientation-bug-fixed renderer from FONT-GEN-005) to
rasterize. No new geometry/rendering logic -- this script only re-targets the existing pipeline at
a small case subset and saves PNGs to disk (pipeline.py normally discards the rasterized image
after scoring it).

Usage:
  tmp/font-generator-venv/bin/python3 tools/font-generator/render_vision_sample.py
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from paths import CONFIG_DIR, REPO_ROOT, output_dir, variant_filename
from pipeline import load_corpus, run_measure
from lib.render_stones import render_ocr_image

OUT_DIR = REPO_ROOT / "tmp" / "font-eval-002-vision"
SIZES = ["SS6", "SS10", "SS16", "SS20", "SS30"]

# (family, variant) -> font path resolver. Mirrors evaluate_solidink.py's grid (7 distinct fonts):
# 4 generated rhinestone families + 3 distinct baselines (SacramentoSkeleton reuses Sacramento's
# baseline, so it isn't listed a second time here either -- consistent with FONT-GEN-005's own
# reuse convention).
from paths import FAMILY_SOURCE_FONTS, FAMILY_SIZE_SOURCE_FONTS, variant_filename as vf


def font_path_for(family, variant, size_upper):
    if variant == "generated":
        return output_dir(size_upper) / vf(family, size_upper)
    if family in FAMILY_SIZE_SOURCE_FONTS:
        return FAMILY_SIZE_SOURCE_FONTS[family][size_upper]
    return FAMILY_SOURCE_FONTS[family]


CELLS = []
for family in ["Sacramento", "Baloo2", "Baloo2Variable", "SacramentoSkeleton"]:
    CELLS.append((family, "generated"))
CELLS += [("Sacramento", "baseline"), ("Baloo2", "baseline"), ("Baloo2Variable", "baseline")]


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    corpus_items, required_ids = load_corpus()
    required_items = [c for c in corpus_items if c["id"] in required_ids]

    manifest = []
    for size_upper in SIZES:
        size_id = size_upper.lower()
        with open(CONFIG_DIR / f"{size_upper}.json") as f:
            config = json.load(f)
        mid_mm = round((config["supportedHeightRangeMm"][0] + config["supportedHeightRangeMm"][1]) / 2, 1)

        cases = [{
            "id": f"{item['id']}__mid", "baseId": item["id"], "text": item["text"],
            "category": item["category"], "heightLabel": "mid", "stoneSizeId": size_id,
            "heightMm": mid_mm
        } for item in required_items]

        for family, variant in CELLS:
            font_path = font_path_for(family, variant, size_upper)
            tmp_name = f"vision-{family}-{variant}-{size_upper}"
            print(f"[{size_upper}] {family} ({variant}): measuring {len(cases)} required-phrase cases...")
            results = run_measure(font_path, cases, tmp_name)
            for r in results:
                if r.get("error"):
                    print(f"  ERROR {r['label']}: {r['error']}")
                    continue
                image = render_ocr_image(r["stones"])
                img_name = f"{family}-{variant}-{size_upper}-{r['label']}.png"
                image.save(OUT_DIR / img_name)
                manifest.append({
                    "image": img_name, "family": family, "variant": variant, "sizeId": size_upper,
                    "baseId": r["label"].split("__")[0], "expectedText": r["text"], "heightMm": mid_mm
                })

    with open(OUT_DIR / "manifest.json", "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"\n{len(manifest)} images -> {OUT_DIR}")


if __name__ == "__main__":
    main()
