#!/usr/bin/env python3
"""
FONT-DECISION-001 Part B -- renders/measures the 12-item longform corpus (corpus_longform.json)
across the full grid used for clusterCount/geometry (7 variants x 5 sizes x 12 phrases = 420
cases, all automated -- no rendering needed for clusterCount, it comes straight off measure.mjs's
real production-pipeline output), and rasterizes OCR-style PNGs for a priority subset (Sacramento +
Baloo2Variable, baseline + generated, all 5 sizes x 12 phrases = 240 images) for manual
vision-transcription -- Baloo2/SacramentoSkeleton are excluded from the (expensive, manual) vision
pass since both are already unambiguous REJECT with no open findings, per FONT-GEN-002/004.

Reuses pipeline.py's run_measure() (real measure.mjs -> GeometryEngine/StoneLayout production path)
and lib.render_stones.render_ocr_image() (FONT-GEN-005 orientation-fixed renderer) -- no new
geometry/rendering logic.

Usage:
  tmp/font-generator-venv/bin/python3 tools/font-generator/render_decision001_longform.py
  tmp/font-generator-venv/bin/python3 tools/font-generator/render_decision001_longform.py --spotcheck
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from paths import CONFIG_DIR, REPO_ROOT, TOOL_ROOT, output_dir
from pipeline import run_measure
from lib.render_stones import render_ocr_image
from paths import FAMILY_SOURCE_FONTS, FAMILY_SIZE_SOURCE_FONTS, variant_filename as vf

OUT_DIR = REPO_ROOT / "tmp" / "font-decision-001" / "longform"
SIZES = ["SS6", "SS10", "SS16", "SS20", "SS30"]
CORPUS_FILE = TOOL_ROOT / "corpus_longform.json"

ALL_CELLS = []
for family in ["Sacramento", "Baloo2", "Baloo2Variable", "SacramentoSkeleton"]:
    ALL_CELLS.append((family, "generated"))
ALL_CELLS += [("Sacramento", "baseline"), ("Baloo2", "baseline"), ("Baloo2Variable", "baseline")]

# Priority subset for the manual vision-transcription pass -- Sacramento + Baloo2Variable only
# (the two families with open findings from FONT-EVAL-002/FONT-DIAG-002), all variants.
VISION_CELLS = {("Sacramento", "generated"), ("Sacramento", "baseline"),
                ("Baloo2Variable", "generated"), ("Baloo2Variable", "baseline")}


def load_longform_items():
    with open(CORPUS_FILE) as f:
        return json.load(f)["items"]


def font_path_for(family, variant, size_upper):
    if variant == "generated":
        return output_dir(size_upper) / vf(family, size_upper)
    if family in FAMILY_SIZE_SOURCE_FONTS:
        return FAMILY_SIZE_SOURCE_FONTS[family][size_upper]
    return FAMILY_SOURCE_FONTS[family]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--spotcheck", action="store_true",
                         help="Only Sacramento generated, SS16, first 2 phrases -- sanity check before the full run.")
    args = parser.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    items = load_longform_items()

    sizes = ["SS16"] if args.spotcheck else SIZES
    cells = [("Sacramento", "generated")] if args.spotcheck else ALL_CELLS
    phrases = items[:2] if args.spotcheck else items

    measurements = []  # every (family, variant, size) x phrase -- clusterCount coverage
    vision_manifest = []  # only the rendered priority subset

    for size_upper in sizes:
        size_id = size_upper.lower()
        with open(CONFIG_DIR / f"{size_upper}.json") as f:
            config = json.load(f)
        mid_mm = round((config["supportedHeightRangeMm"][0] + config["supportedHeightRangeMm"][1]) / 2, 1)

        cases = [{
            "id": f"{item['id']}__mid", "baseId": item["id"], "text": item["text"],
            "category": item["category"], "heightLabel": "mid", "stoneSizeId": size_id,
            "heightMm": mid_mm
        } for item in phrases]

        for family, variant in cells:
            font_path = font_path_for(family, variant, size_upper)
            tmp_name = f"longform-{family}-{variant}-{size_upper}"
            print(f"[{size_upper}] {family} ({variant}): measuring {len(cases)} longform cases...")
            results = run_measure(font_path, cases, tmp_name)

            want_render = (family, variant) in VISION_CELLS
            for r in results:
                if r.get("error"):
                    print(f"  ERROR {r['label']}: {r['error']}")
                    continue
                measurements.append({
                    "family": family, "variant": variant, "sizeId": size_upper,
                    "baseId": r["label"].split("__")[0], "text": r["text"],
                    "heightMm": mid_mm, "clusterCount": r.get("clusterCount"),
                    "collisionCount": r.get("collisionCount"), "stoneCount": r.get("stoneCount"),
                })
                if want_render:
                    image = render_ocr_image(r["stones"])
                    img_name = f"{family}-{variant}-{size_upper}-{r['label']}.png"
                    image.save(OUT_DIR / img_name)
                    vision_manifest.append({
                        "image": img_name, "family": family, "variant": variant, "sizeId": size_upper,
                        "baseId": r["label"].split("__")[0], "expectedText": r["text"], "heightMm": mid_mm
                    })

    with open(OUT_DIR / "measurements.json", "w") as f:
        json.dump(measurements, f, indent=2)
    with open(OUT_DIR / "manifest.json", "w") as f:
        json.dump(vision_manifest, f, indent=2)
    print(f"\n{len(measurements)} measured cases (clusterCount coverage), {len(vision_manifest)} images -> {OUT_DIR}")


if __name__ == "__main__":
    main()
