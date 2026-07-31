#!/usr/bin/env python3
"""
FONT-POLICY-001 -- builds the human-rater HTML tool validating the candidate SS30 height ceiling
(165mm) against the current one (111mm). 4 fonts x 2 heights x 16 phrases = 128 items, one file per
font (mirrors build_rater_tool_portfolio001.py's split -- 32 items each, small enough for one
sitting). Height is hidden during rating (labeled only "A"/"B" per item, position randomized) same
as every prior rater tool hid family/size -- a rater who knows which is "the new one" isn't rating
blind.

Reuses render_font_policy_001_rater_batch.py's already-rendered PNGs
(tmp/font-policy-001-rater-batch/renders/, produced by lib.render_stones.render_review_png() --
the genuine gold-on-dark stone-dot render).

Usage:
  tmp/font-generator-venv/bin/python3 tools/font-generator/build_rater_tool_font_policy_001.py
"""
import base64
import json
import random
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "tmp" / "font-policy-001-rater-batch"
REVIEW_ROOT = REPO_ROOT / "review"

FONTS = ["Anton", "Sacramento", "DancingScript", "Baloo2Variable"]


def build_items_for_family(manifest, family):
    items = [m for m in manifest if m["family"] == family]
    height_order = {111: 0, 165: 1}
    items.sort(key=lambda m: (m["baseId"], height_order[m["heightMm"]]))
    out = []
    for m in items:
        img_path = DATA_DIR / m["image"]
        b64 = base64.b64encode(img_path.read_bytes()).decode("ascii")
        out.append({
            "family": family, "heightMm": m["heightMm"],
            "sampleText": m["expectedText"], "baseId": m["baseId"], "image": b64
        })
    return out


def main():
    manifest = json.load(open(DATA_DIR / "manifest.json"))
    REVIEW_ROOT.mkdir(parents=True, exist_ok=True)

    for family in FONTS:
        items = build_items_for_family(manifest, family)
        random.Random(42).shuffle(items)
        for idx, item in enumerate(items):
            item["id"] = idx + 1

        data_json = json.dumps(items)
        out_path = REVIEW_ROOT / f"FONT-POLICY-001-rater-{family}.html"
        html = HTML_TEMPLATE.replace("__FAMILY__", family).replace("__ITEM_DATA__", data_json).replace("__TOTAL__", str(len(items)))
        out_path.write_text(html)
        print(f"Wrote {len(items)} items -> {out_path} ({out_path.stat().st_size / 1e6:.1f} MB)")


HTML_TEMPLATE = """<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>FONT-POLICY-001 -- __FAMILY__ SS30 Height Ceiling Review (genuine stone render)</title>
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
  <h1>FONT-POLICY-001 -- __FAMILY__ SS30 Height Ceiling Review (genuine stone render)</h1>
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
  <div class="small-note">Single-rater tool -- rate each specimen as you would judge it at real product viewing distance. Height (111mm current vs. 165mm candidate) is intentionally hidden so you rate blind. Your ratings are kept only in this browser tab; nothing is uploaded. Click "Export results" at any time to download a JSON file of everything rated so far.</div>
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
      heightMm: item.heightMm,
      baseId: item.baseId,
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
    a.download = 'font-policy-001-ratings-__FAMILY__.json';
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
