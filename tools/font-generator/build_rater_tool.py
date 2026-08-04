#!/usr/bin/env python3
"""
FONT-DECISION-001 Part C -- builds review/FONT-DECISION-001-rater.html: a self-contained,
single-rater local review tool (no server, no login, no submission backend), replacing the
FONT-EVAL-002 human-panel survey instrument that only ever collected one response.

Item set (~60, per the milestone brief's explicit priority list): Baloo2Variable generated
(the only weight ever transformed to rhinestone -- wght400, see FONT-GEN-003) at SS6/SS16/SS20,
each x all 16 phrases (12 new longform + 4 existing required phrases) = 48, plus Sacramento
baseline at SS16 x the 12 longform phrases = 12, for a comparison anchor. Total 60.

Reuses already-rendered PNGs -- no new rendering:
  - Longform renders: tmp/font-decision-001/longform/ (this milestone's Part B pass)
  - Required-phrase renders: tmp/font-eval-002-vision/ (FONT-EVAL-002's Part B pass, reused per
    this milestone's Part A "reuse existing renders" instruction)

Usage:
  tmp/font-generator-venv/bin/python3 tools/font-generator/build_rater_tool.py
"""
import base64
import json
import random
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
LONGFORM_DIR = REPO_ROOT / "tmp" / "font-decision-001" / "longform"
EVAL002_DIR = REPO_ROOT / "tmp" / "font-eval-002-vision"
CORPUS_LONGFORM = REPO_ROOT / "tools" / "font-generator" / "corpus_longform.json"
CORPUS = REPO_ROOT / "tools" / "font-generator" / "corpus.json"
OUT_PATH = REPO_ROOT / "review" / "FONT-DECISION-001-rater.html"

REQUIRED_IDS = ["req-ashley", "req-bride-squad", "req-happy-birthday", "req-class-of-2027"]
BV_SIZES = ["SS6", "SS16", "SS20"]


def load_text_by_id():
    with open(CORPUS_LONGFORM) as f:
        longform = json.load(f)["items"]
    with open(CORPUS) as f:
        corpus = json.load(f)
    by_id = {item["id"]: item["text"] for item in longform}
    by_id.update({item["id"]: item["text"] for item in corpus["requiredPhrases"]})
    return by_id


def b64_image(path):
    return base64.b64encode(path.read_bytes()).decode("ascii")


def main():
    text_by_id = load_text_by_id()
    items = []

    for size in BV_SIZES:
        for i in range(1, 13):
            base_id = f"long-{i:02d}"
            path = LONGFORM_DIR / f"Baloo2Variable-generated-{size}-{base_id}__mid.png"
            items.append({
                "family": "Baloo2Variable (generated)", "size": size,
                "sampleText": text_by_id[base_id], "image": b64_image(path)
            })
        for req_id in REQUIRED_IDS:
            path = EVAL002_DIR / f"Baloo2Variable-generated-{size}-{req_id}__mid.png"
            items.append({
                "family": "Baloo2Variable (generated)", "size": size,
                "sampleText": text_by_id[req_id], "image": b64_image(path)
            })

    for i in range(1, 13):
        base_id = f"long-{i:02d}"
        path = LONGFORM_DIR / f"Sacramento-baseline-SS16-{base_id}__mid.png"
        items.append({
            "family": "Sacramento (baseline)", "size": "SS16",
            "sampleText": text_by_id[base_id], "image": b64_image(path)
        })

    random.Random(42).shuffle(items)
    for idx, item in enumerate(items):
        item["id"] = idx + 1

    data_json = json.dumps(items)

    html = HTML_TEMPLATE.replace("__ITEM_DATA__", data_json).replace("__TOTAL__", str(len(items)))
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(html)
    print(f"Wrote {len(items)} items -> {OUT_PATH} ({OUT_PATH.stat().st_size / 1e6:.1f} MB)")


HTML_TEMPLATE = """<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>FONT-DECISION-001 -- Single-Rater Legibility Review</title>
<style>
  body { background:#fff; color:#0b1f3a; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; margin:0; padding:0; display:flex; flex-direction:column; align-items:center; min-height:100vh; }
  header { width:100%; padding:16px 24px; border-bottom:2px solid #0b1f3a; box-sizing:border-box; display:flex; justify-content:space-between; align-items:center; }
  header h1 { font-size:16px; margin:0; }
  header .progress { font-size:14px; color:#4a5568; }
  #export-btn { border:1px solid #0b1f3a; background:#fff; color:#0b1f3a; padding:6px 14px; border-radius:6px; cursor:pointer; font-size:13px; }
  #export-btn:hover { background:#f3f6fb; }
  main { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:32px 16px; width:100%; box-sizing:border-box; }
  .specimen-frame { border:1px solid #d8e0ee; border-radius:10px; padding:28px; background:#fafcff; max-width:920px; width:100%; box-sizing:border-box; display:flex; align-items:center; justify-content:center; min-height:160px; }
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
  <h1>FONT-DECISION-001 -- Legibility Review</h1>
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
    a.download = 'font-decision-001-ratings.json';
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
