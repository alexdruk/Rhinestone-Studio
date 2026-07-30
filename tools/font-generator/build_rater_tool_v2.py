#!/usr/bin/env python3
"""
FONT-DECISION-001 follow-up -- builds review/FONT-DECISION-001-rater-v2.html, a corrected copy of
build_rater_tool.py's rater tool.

Why a v2 rather than editing the original: a spot-check (rendering both render_ocr_image()'s
blur/rebinarize output -- what the original 60 items actually showed -- and render_review_png()'s
genuine gold-on-dark stone-dot output -- what a real product looks like -- for 8 items spanning
the t-crossbar defect, the SS20 "C"-split defect, and defect-free items still rated Unreadable)
found the two render modes mostly agree, but diverge on dense letter clusters (e.g. "Squad"),
where the blur step visibly over-merges stones into a blob that reads *less* legibly than the real
dot pattern. The original file and its ratings (font-decision-001-ratings.json) stay untouched and
traceable as what they actually were; this file replaces render_ocr_image() with render_review_png()
for the same 60 combinations, and is a self-contained fresh rating pass, not a resume.

Item set:
  - The same 60 items as v1 (Baloo2Variable generated wght400 at SS6/SS16/SS20 x 16 phrases [12
    longform + 4 required] = 48, plus Sacramento baseline at SS16 x 12 longform phrases = 12),
    re-rendered with render_review_png() instead of render_ocr_image().
  - New: Baloo2Variable BASELINE (untransformed source font, weights 400 and 500) at the same
    SS6/SS16/SS20 x 16 phrases = 96 items. This candidate has never been rated by a human at all
    (dot-render or otherwise) -- FONT-DECISION-001 Part A noted 500-800 only ever had native-geometry
    deficit measurements, never a rendered/read legibility pass. Weight 500 is included alongside
    400 since both static instances already exist on disk (fonts/sources/Baloo2/Baloo2-wght{400,500}.ttf,
    from select_source_weight.py) and folding them into this same re-render pass avoids a third
    round of tool-building.
  Total: 156 items.

Reuses pipeline.py's run_measure() (real measure.mjs -> GeometryEngine/StoneLayout production path)
and lib.render_stones.render_review_png() -- no new geometry/rendering logic. Renders directly to an
in-memory buffer (no intermediate PNG files on disk) since none of these images need to persist
outside this HTML file.

Usage:
  tmp/font-generator-venv/bin/python3 tools/font-generator/build_rater_tool_v2.py
"""
import base64
import io
import json
import random
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from paths import CONFIG_DIR, REPO_ROOT, TOOL_ROOT, output_dir, variant_filename as vf
from pipeline import run_measure
from lib.render_stones import render_review_png

REVIEW_ROOT = REPO_ROOT / "review"
CORPUS_LONGFORM = TOOL_ROOT / "corpus_longform.json"
CORPUS = TOOL_ROOT / "corpus.json"
OUT_PATH = REVIEW_ROOT / "FONT-DECISION-001-rater-v2.html"

REQUIRED_IDS = ["req-ashley", "req-bride-squad", "req-happy-birthday", "req-class-of-2027"]
LONGFORM_IDS = [f"long-{i:02d}" for i in range(1, 13)]
ALL_PHRASE_IDS = LONGFORM_IDS + REQUIRED_IDS
SIZES = ["SS6", "SS16", "SS20"]

BALOO2_WEIGHT_DIR = REPO_ROOT / "fonts" / "sources" / "Baloo2"
SACRAMENTO_BASELINE = REPO_ROOT / "fonts" / "sources" / "Sacramento" / "Sacramento.ttf"


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
    return round((config["supportedHeightRangeMm"][0] + config["supportedHeightRangeMm"][1]) / 2, 1)


def cases_for(phrase_ids, text_and_cat_by_id, size_upper, mid_mm):
    cases = []
    for pid in phrase_ids:
        text, category = text_and_cat_by_id[pid]
        cases.append({
            "id": f"{pid}__mid", "baseId": pid, "text": text, "category": category,
            "heightLabel": "mid", "stoneSizeId": size_upper.lower(), "heightMm": mid_mm
        })
    return cases


def render_b64(stones):
    buf = io.BytesIO()
    # PIL's Image.save() can't infer a format from a BytesIO's "name" (there isn't one), unlike a
    # real path -- render_review_png() doesn't take a format argument, so name the buffer as a hint.
    buf.name = "specimen.png"
    render_review_png(stones, buf)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def measure_and_render(font_path, phrase_ids, text_and_cat_by_id, size_upper, tmp_name):
    mid_mm = mid_mm_for(size_upper)
    cases = cases_for(phrase_ids, text_and_cat_by_id, size_upper, mid_mm)
    print(f"  measuring+rendering {len(cases)} cases from {font_path.name} ({size_upper})...")
    results = run_measure(font_path, cases, tmp_name)
    out = {}
    for r in results:
        if r.get("error"):
            print(f"    ERROR {r['label']}: {r['error']}")
            continue
        base_id = r["label"].split("__")[0]
        out[base_id] = {"text": r["text"], "image": render_b64(r["stones"])}
    return out


def main():
    text_and_cat_by_id = load_text_and_category_by_id()
    items = []

    # -- Same 60 combinations as v1, re-rendered with render_review_png() --
    for size in SIZES:
        font_path = output_dir(size) / vf("Baloo2Variable", size)
        rendered = measure_and_render(font_path, ALL_PHRASE_IDS, text_and_cat_by_id, size,
                                       f"v2-Baloo2Variable-generated-{size}")
        for pid in ALL_PHRASE_IDS:
            if pid not in rendered:
                continue
            items.append({
                "family": "Baloo2Variable (generated)", "size": size,
                "sampleText": rendered[pid]["text"], "image": rendered[pid]["image"]
            })

    sac_rendered = measure_and_render(SACRAMENTO_BASELINE, LONGFORM_IDS, text_and_cat_by_id, "SS16",
                                       "v2-Sacramento-baseline-SS16")
    for pid in LONGFORM_IDS:
        if pid not in sac_rendered:
            continue
        items.append({
            "family": "Sacramento (baseline)", "size": "SS16",
            "sampleText": sac_rendered[pid]["text"], "image": sac_rendered[pid]["image"]
        })

    # -- New: Baloo2Variable baseline, weights 400 and 500, never rated before --
    for weight in ["400", "500"]:
        font_path = BALOO2_WEIGHT_DIR / f"Baloo2-wght{weight}.ttf"
        for size in SIZES:
            rendered = measure_and_render(font_path, ALL_PHRASE_IDS, text_and_cat_by_id, size,
                                           f"v2-Baloo2Variable-baseline-wght{weight}-{size}")
            for pid in ALL_PHRASE_IDS:
                if pid not in rendered:
                    continue
                items.append({
                    "family": f"Baloo2Variable (baseline wght{weight})", "size": size,
                    "sampleText": rendered[pid]["text"], "image": rendered[pid]["image"]
                })

    random.Random(42).shuffle(items)
    for idx, item in enumerate(items):
        item["id"] = idx + 1

    data_json = json.dumps(items)

    html = HTML_TEMPLATE.replace("__ITEM_DATA__", data_json).replace("__TOTAL__", str(len(items)))
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(html)
    print(f"\nWrote {len(items)} items -> {OUT_PATH} ({OUT_PATH.stat().st_size / 1e6:.1f} MB)")


HTML_TEMPLATE = """<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>FONT-DECISION-001 v2 -- Single-Rater Legibility Review (genuine stone render)</title>
<style>
  body { background:#fff; color:#0b1f3a; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; margin:0; padding:0; display:flex; flex-direction:column; align-items:center; min-height:100vh; }
  header { width:100%; padding:16px 24px; border-bottom:2px solid #0b1f3a; box-sizing:border-box; display:flex; justify-content:space-between; align-items:center; }
  header h1 { font-size:16px; margin:0; }
  header .progress { font-size:14px; color:#4a5568; }
  #export-btn { border:1px solid #0b1f3a; background:#fff; color:#0b1f3a; padding:6px 14px; border-radius:6px; cursor:pointer; font-size:13px; }
  #export-btn:hover { background:#f3f6fb; }
  main { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:32px 16px; width:100%; box-sizing:border-box; }
  .specimen-frame { border:1px solid #d8e0ee; border-radius:10px; padding:28px; background:#0f1720; max-width:920px; width:100%; box-sizing:border-box; display:flex; align-items:center; justify-content:center; min-height:160px; }
  .specimen-frame img { max-width:100%; height:auto; display:block; }
  .buttons { display:flex; gap:14px; margin-top:28px; }
  .buttons button { font-size:15px; padding:12px 28px; border-radius:8px; border:2px solid #0b1f3a; background:#fff; color:#0b1f3a; cursor:pointer; font-weight:600; }
  .buttons button:hover { background:#0b1f3a; color:#fff; }
  .buttons button.readable { border-color:#0f6d34; color:#0f6d34; }
  .buttons button.readable:hover { background:#0f6d34; color:#fff; }
  .buttons button.unreadable { border-color:#9c1f1f; color:#9c1f1f; }
  .buttons button.unreadable:hover { background:#9c1f1f; color:#fff; }
  .buttons button.notsure { border-color:#8492a6; color:#8492a6; }
  .buttons button.notsure:hover { background:#8492a6; color:#fff; }
  .done { text-align:center; }
  .done h2 { font-size:20px; }
  .small-note { font-size:12px; color:#8492a6; margin-top:18px; text-align:center; max-width:600px; }
</style>
</head>
<body>
<header>
  <h1>FONT-DECISION-001 v2 -- Legibility Review (genuine stone render)</h1>
  <div class="progress" id="progress">0 of __TOTAL__</div>
  <button id="export-btn" onclick="exportResults()">Export results</button>
</header>
<main id="main">
  <div class="specimen-frame" id="frame">
    <img id="specimen-img" src="" alt="specimen">
  </div>
  <div class="buttons">
    <button class="readable" onclick="rate('Readable')">Readable</button>
    <button class="unreadable" onclick="rate('Unreadable')">Unreadable</button>
    <button class="notsure" onclick="rate('Not Sure')">Not Sure</button>
  </div>
  <div class="small-note">Single-rater tool -- rate each specimen as you would judge it at real product viewing distance. Your ratings are kept only in this browser tab; nothing is uploaded. Click "Export results" at any time to download a JSON file of everything rated so far.</div>
</main>
<script>
  const ITEMS = __ITEM_DATA__;
  let index = 0;
  const ratings = [];

  function showCurrent() {
    const p = document.getElementById('progress');
    if (index >= ITEMS.length) {
      document.getElementById('main').innerHTML = '<div class="done"><h2>All ' + ITEMS.length + ' items rated.</h2><p>Click "Export results" above to download your ratings.</p></div>';
      p.textContent = ITEMS.length + ' of ' + ITEMS.length;
      return;
    }
    p.textContent = (index + 1) + ' of ' + ITEMS.length;
    document.getElementById('specimen-img').src = 'data:image/png;base64,' + ITEMS[index].image;
  }

  function rate(rating) {
    const item = ITEMS[index];
    ratings.push({
      family: item.family,
      size: item.size,
      sampleText: item.sampleText,
      rating: rating,
      timestamp: new Date().toISOString()
    });
    index += 1;
    showCurrent();
  }

  function exportResults() {
    const blob = new Blob([JSON.stringify(ratings, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'font-decision-001-ratings-v2.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  showCurrent();
</script>
</body>
</html>
"""

if __name__ == "__main__":
    main()
