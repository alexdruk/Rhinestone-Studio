#!/usr/bin/env python3
"""
FONT-PORTFOLIO-001 -- renders + measures the full corpus (4 required phrases + 12 longform
phrases = 16 per cell) for Sacramento, DancingScript, and Anton -- BASELINE ONLY (unmodified
source fonts; no fatten/enlarge transform, per this milestone's brief) -- at all 5 stone sizes,
using each size's validated supportedHeightRangeMm midpoint (same config/*.json this pipeline has
always used, mirrored in src/renderer/StoneSizes.js).

3 fonts x 5 sizes x 16 phrases = 240 cases. Reuses pipeline.py's run_measure() (real measure.mjs ->
GeometryEngine/StoneLayout production path) for clusterCount/collisionCount/stoneCount, and
lib.render_stones.render_review_png() (genuine gold-on-dark stone-dot render -- the mode
FONT-DECISION-001 Part E established as the one to use for anything a human will rate, superseding
render_ocr_image()'s blur/rebinarize render) for both the vision-transcription pass and the rater
tool. Also builds one contact-sheet PNG per (font, size) -- all 16 phrases labeled and stacked into
a single image -- purely to make the vision-transcription pass (a human/vision-capable model
reading each render and typing what it sees, per FONT-DECISION-001's vision_eval.py docstring)
tractable at this corpus's size; the contact sheet is a compositing-only visualization of the
already-rendered individual PNGs, not a new render path or new geometry.

Usage:
  tmp/font-generator-venv/bin/python3 tools/font-generator/render_portfolio001.py
  tmp/font-generator-venv/bin/python3 tools/font-generator/render_portfolio001.py --spotcheck
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from paths import CONFIG_DIR, REPO_ROOT, TOOL_ROOT
from pipeline import run_measure
from lib.render_stones import render_review_png
from PIL import Image, ImageDraw, ImageFont

OUT_DIR = REPO_ROOT / "tmp" / "font-portfolio-001"
RENDER_DIR = OUT_DIR / "renders"
SHEET_DIR = OUT_DIR / "sheets"
SIZES = ["SS6", "SS10", "SS16", "SS20", "SS30"]

FONTS = {
    "Sacramento": REPO_ROOT / "fonts" / "sources" / "Sacramento" / "Sacramento.ttf",
    "DancingScript": REPO_ROOT / "fonts" / "sources" / "DancingScript" / "DancingScript.ttf",
    "Anton": REPO_ROOT / "fonts" / "sources" / "Anton" / "Anton.ttf",
}

CORPUS_LONGFORM = TOOL_ROOT / "corpus_longform.json"
CORPUS = TOOL_ROOT / "corpus.json"
REQUIRED_IDS = ["req-ashley", "req-bride-squad", "req-happy-birthday", "req-class-of-2027"]
LONGFORM_IDS = [f"long-{i:02d}" for i in range(1, 13)]
ALL_PHRASE_IDS = REQUIRED_IDS + LONGFORM_IDS


def load_text_and_category_by_id():
    with open(CORPUS_LONGFORM) as f:
        longform = json.load(f)["items"]
    with open(CORPUS) as f:
        corpus = json.load(f)
    by_id = {item["id"]: (item["text"], item["category"]) for item in longform}
    by_id.update({item["id"]: (item["text"], item["category"]) for item in corpus["requiredPhrases"]})
    return by_id


def mid_mm_for(size_upper):
    with open(CONFIG_DIR / f"{size_upper}.json") as f:
        config = json.load(f)
    lo, hi = config["supportedHeightRangeMm"]
    return round((lo + hi) / 2, 1), (lo, hi)


def cases_for(phrase_ids, text_and_cat_by_id, size_upper, mid_mm):
    cases = []
    for pid in phrase_ids:
        text, category = text_and_cat_by_id[pid]
        cases.append({
            "id": f"{pid}__mid", "baseId": pid, "text": text, "category": category,
            "heightLabel": "mid", "stoneSizeId": size_upper.lower(), "heightMm": mid_mm
        })
    return cases


def build_contact_sheet(entries, out_path, label):
    """entries: list of (phrase_id, expected_text, PIL.Image). Stacks them vertically with a
    labeled header row per item so a single Read/view of this one file covers all phrases for
    this (font, size) cell."""
    pad = 12
    label_h = 28
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 20)
    except Exception:
        font = ImageFont.load_default()
    max_w = max(img.width for _, _, img in entries) + pad * 2
    total_h = sum(img.height + label_h + pad for _, _, img in entries) + pad
    sheet = Image.new("RGB", (max_w, total_h), (255, 255, 255))
    draw = ImageDraw.Draw(sheet)
    y = pad
    for pid, text, img in entries:
        draw.text((pad, y), f"{label} -- {pid}", fill=(11, 31, 58), font=font)
        y += label_h
        sheet.paste(img, (pad, y))
        y += img.height + pad
    sheet.save(out_path)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--spotcheck", action="store_true",
                         help="Only Anton, SS16, first 2 phrases -- sanity check before the full run.")
    args = parser.parse_args()

    RENDER_DIR.mkdir(parents=True, exist_ok=True)
    SHEET_DIR.mkdir(parents=True, exist_ok=True)
    text_and_cat_by_id = load_text_and_category_by_id()

    fonts = {"Anton": FONTS["Anton"]} if args.spotcheck else FONTS
    sizes = ["SS16"] if args.spotcheck else SIZES
    phrase_ids = ALL_PHRASE_IDS[:2] if args.spotcheck else ALL_PHRASE_IDS

    measurements = []
    manifest = []

    for family, font_path in fonts.items():
        for size_upper in sizes:
            mid_mm, height_range = mid_mm_for(size_upper)
            cases = cases_for(phrase_ids, text_and_cat_by_id, size_upper, mid_mm)
            tmp_name = f"portfolio001-{family}-baseline-{size_upper}"
            print(f"[{family}] {size_upper}: measuring {len(cases)} cases (mid={mid_mm}mm, range={height_range})...")
            results = run_measure(font_path, cases, tmp_name)

            sheet_entries = []
            for r in results:
                if r.get("error"):
                    print(f"  ERROR {r['label']}: {r['error']}")
                    continue
                base_id = r["label"].split("__")[0]
                measurements.append({
                    "family": family, "sizeId": size_upper, "baseId": base_id, "text": r["text"],
                    "heightMm": mid_mm, "clusterCount": r.get("clusterCount"),
                    "collisionCount": r.get("collisionCount"), "stoneCount": r.get("stoneCount"),
                })
                img_name = f"{family}-baseline-{size_upper}-{base_id}.png"
                img_path = RENDER_DIR / img_name
                render_review_png(r["stones"], img_path)
                manifest.append({
                    "image": f"renders/{img_name}", "family": family, "sizeId": size_upper,
                    "baseId": base_id, "expectedText": r["text"], "heightMm": mid_mm
                })
                sheet_entries.append((base_id, r["text"], Image.open(img_path)))

            # Chunk into small (4-item) contact sheets rather than one 16-item sheet -- a single
            # sheet stacking all 16 renders (each already up to 6000px wide for long phrases, per
            # render_review_png's own MAX_FINAL_WIDTH_PX) becomes tall enough (8000-12000px) that
            # downscaling it to fit a normal image viewport shrinks individual stone dots past
            # legibility. 4-per-sheet keeps each chunk close to the size of individually-viewed
            # renders while still cutting the read-call count 4x (240 -> 60).
            CHUNK = 4
            for i in range(0, len(sheet_entries), CHUNK):
                chunk = sheet_entries[i:i + CHUNK]
                sheet_name = f"{family}-{size_upper}-batch{i // CHUNK + 1}.png"
                build_contact_sheet(chunk, SHEET_DIR / sheet_name, f"{family} {size_upper}")

    with open(OUT_DIR / "measurements.json", "w") as f:
        json.dump(measurements, f, indent=2)
    with open(OUT_DIR / "manifest.json", "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"\n{len(measurements)} measured cases, {len(manifest)} rendered images -> {OUT_DIR}")


if __name__ == "__main__":
    main()
