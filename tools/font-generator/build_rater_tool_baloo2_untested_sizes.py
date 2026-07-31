#!/usr/bin/env python3
"""
FONT-PORTFOLIO-001 follow-up -- builds the rater HTML for Baloo2Variable baseline wght400 at
SS10 and SS30 (32 items: 16 phrases x 2 sizes) -- the two stone sizes FONT-DECISION-001's human
rating pass never covered. Reuses render_portfolio001_baloo2_untested_sizes.py's already-rendered
PNGs and build_rater_tool_portfolio001.py's HTML template verbatim (same vanilla-JS single-file
rater UI, same Readable/Unreadable/Not Sure flow, family/size hidden during rating).

Usage:
  tmp/font-generator-venv/bin/python3 tools/font-generator/build_rater_tool_baloo2_untested_sizes.py
"""
import base64
import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_rater_tool_portfolio001 import HTML_TEMPLATE

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "tmp" / "font-portfolio-001-baloo2-gap-sizes"
REVIEW_ROOT = REPO_ROOT / "review"
FAMILY_LABEL = "Baloo2Variable (baseline wght400)"


def main():
    manifest = json.load(open(DATA_DIR / "manifest.json"))
    size_order = {"SS10": 0, "SS30": 1}
    manifest.sort(key=lambda m: (size_order[m["sizeId"]], m["baseId"]))

    items = []
    for m in manifest:
        img_path = DATA_DIR / m["image"]
        b64 = base64.b64encode(img_path.read_bytes()).decode("ascii")
        items.append({
            "family": FAMILY_LABEL, "size": m["sizeId"],
            "sampleText": m["expectedText"], "image": b64
        })

    random.Random(42).shuffle(items)
    for idx, item in enumerate(items):
        item["id"] = idx + 1

    REVIEW_ROOT.mkdir(parents=True, exist_ok=True)
    out_path = REVIEW_ROOT / "FONT-PORTFOLIO-001-rater-Baloo2Variable-SS10-SS30.html"
    html = (HTML_TEMPLATE
            .replace("__FAMILY__", "Baloo2Variable-wght400-SS10-SS30")
            .replace("__ITEM_DATA__", json.dumps(items))
            .replace("__TOTAL__", str(len(items))))
    out_path.write_text(html)
    print(f"Wrote {len(items)} items -> {out_path} ({out_path.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
