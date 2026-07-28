#!/usr/bin/env python3
"""
FONT-GEN-001 -- builds the exception-focused HTML review page.

Reads every size's evaluation.<SIZE>.json + summary.<SIZE>.json (analyze.py output) and this
tool's generation-metadata.<SIZE>.json (per-glyph transform logs), renders a curated set of PNGs
into review/assets/ (representative successes, required phrases, worst-N, all failures,
confusable pairs, before/after glyphs), and writes review/FONT-GEN-001-review.html: one static
file, works from the local filesystem, with a searchable/filterable full-corpus table built from
an embedded JSON dataset (vanilla JS -- no CDN/build step, consistent with this repo's no-
framework rule).

Usage:
  tmp/font-generator-venv/bin/python3 tools/font-generator/build_review_html.py
"""
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from paths import REPO_ROOT, SOURCE_FONT, REVIEW_ROOT, REVIEW_ASSETS, output_dir
from lib.render_stones import render_review_png

ALL_SIZES = ["SS6", "SS10", "SS16", "SS20", "SS30"]
WORST_N = 10
NODE_MEASURE = REPO_ROOT / "tools" / "font-generator" / "measure.mjs"


def load_size_data(size_upper):
    out_dir = output_dir(size_upper)
    eval_path = out_dir / f"evaluation.{size_upper}.json"
    summary_path = out_dir / f"summary.{size_upper}.json"
    meta_path = out_dir / f"generation-metadata.{size_upper}.json"
    if not eval_path.exists():
        return None
    with open(eval_path) as f:
        evaluation = json.load(f)
    with open(summary_path) as f:
        summary = json.load(f)
    with open(meta_path) as f:
        metadata = json.load(f)
    return {"evaluation": evaluation, "summary": summary, "metadata": metadata}


def stone_lookup(rows):
    return {r["label"]: r for r in rows if not r.get("error")}


def fetch_stones(font_path, rows_by_id, case_ids, tag):
    """
    evaluation.<SIZE>.json intentionally strips stone positions (per this milestone's output
    restrictions, keeping output/ to fonts + metadata only) -- re-measures just the curated PNG
    subset on demand via the same real production pipeline (measure.mjs), instead of persisting
    stones for the full ~170-case corpus.
    """
    cases = [
        {"id": cid, "text": rows_by_id[cid]["text"], "stoneSizeId": rows_by_id[cid]["stoneSizeId"], "heightMm": rows_by_id[cid]["heightMm"]}
        for cid in case_ids if cid in rows_by_id
    ]
    if not cases:
        return {}
    tmp_dir = REPO_ROOT / "tmp" / "font-gen-001-review-assets"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    input_path = tmp_dir / f"{tag}.input.json"
    output_path = tmp_dir / f"{tag}.output.json"
    with open(input_path, "w") as f:
        json.dump({"fontPath": str(font_path), "cases": cases}, f)
    subprocess.run(["node", str(NODE_MEASURE), str(input_path), str(output_path)], check=True, cwd=str(REPO_ROOT))
    with open(output_path) as f:
        results = json.load(f)["results"]
    return {r["label"]: r for r in results if not r.get("error")}


def render_case_png(row, out_path):
    render_review_png(row["stones"], out_path)


def build_assets_for_size(size_upper, data):
    """Renders the curated PNG subset for one size, returns dict of {caseId: relPath}."""
    assets = {}
    gen_rows_by_id = {r["label"]: r for r in data["evaluation"]["generated"]}
    base_rows_by_id = {r["label"]: r for r in data["evaluation"]["baseline"]}
    size_dir = REVIEW_ASSETS / size_upper
    size_dir.mkdir(parents=True, exist_ok=True)

    summary = data["summary"]
    worst_ids = {w["id"] for w in summary["generated"]["worst"]}
    required_ids = {r["label"] for r in data["evaluation"]["generated"] if r.get("isRequiredPhrase")}

    representative_ids = set()
    for r in data["evaluation"]["generated"]:
        if r.get("heightLabel") == "mid" and not r.get("error") and r.get("ocr") and r["ocr"]["charAccuracy"] >= 0.95:
            representative_ids.add(r["label"])
        if len(representative_ids) >= 4:
            break

    wanted = worst_ids | required_ids | representative_ids
    generated_path = output_dir(size_upper) / f"SacramentoRhinestone_{size_upper}.ttf"
    gen_by_id = fetch_stones(generated_path, gen_rows_by_id, wanted, f"{size_upper}-assets-generated")
    base_by_id = fetch_stones(SOURCE_FONT, base_rows_by_id, wanted, f"{size_upper}-assets-baseline")

    for case_id in wanted:
        if case_id in gen_by_id:
            out_path = size_dir / f"{case_id}.generated.png"
            render_case_png(gen_by_id[case_id], out_path)
            assets[f"{case_id}.generated"] = f"assets/{size_upper}/{out_path.name}"
        if case_id in base_by_id:
            out_path = size_dir / f"{case_id}.baseline.png"
            render_case_png(base_by_id[case_id], out_path)
            assets[f"{case_id}.baseline"] = f"assets/{size_upper}/{out_path.name}"

    return assets, {"worstIds": sorted(worst_ids), "requiredIds": sorted(required_ids), "representativeIds": sorted(representative_ids)}


def escape(s):
    if s is None:
        return ""
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


PAGE_CSS = """
body { background:#fff; color:#0b1f3a; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; margin:0; padding:0; }
header { padding:20px 28px; border-bottom:2px solid #0b1f3a; }
header h1 { margin:0 0 4px; font-size:22px; }
header .sub { color:#4a5568; font-size:13px; }
nav.sizes { display:flex; gap:8px; padding:14px 28px; background:#f3f6fb; border-bottom:1px solid #d8e0ee; flex-wrap:wrap; }
nav.sizes button { border:1px solid #0b1f3a; background:#fff; color:#0b1f3a; padding:6px 14px; border-radius:6px; cursor:pointer; font-size:13px; }
nav.sizes button.active { background:#0b1f3a; color:#fff; }
.size-panel { display:none; padding:20px 28px 60px; }
.size-panel.active { display:block; }
.verdict-badge { display:inline-block; padding:3px 10px; border-radius:12px; font-size:12px; font-weight:600; }
.verdict-pass { background:#d7f5df; color:#0f6d34; }
.verdict-fail { background:#fbdada; color:#9c1f1f; }
.metrics-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:10px; margin:16px 0; }
.metric-card { border:1px solid #d8e0ee; border-radius:8px; padding:10px 12px; }
.metric-card .label { font-size:11px; color:#4a5568; }
.metric-card .value { font-size:20px; font-weight:600; color:#0b1f3a; }
.metric-card .baseline { font-size:11px; color:#8492a6; }
h2 { font-size:15px; margin:28px 0 10px; color:#1c3d6e; border-bottom:1px solid #d8e0ee; padding-bottom:4px; }
.case-grid { display:flex; flex-wrap:wrap; gap:14px; }
.case-card { border:1px solid #d8e0ee; border-radius:8px; padding:10px; max-width:340px; }
.case-card img { max-width:320px; display:block; border-radius:4px; margin-top:4px; }
.case-card .meta { font-size:11px; color:#4a5568; }
.case-card .ocr-text { font-size:12px; margin-top:4px; }
.fail { border-color:#e5a3a3; background:#fff8f8; }
.pair-fail { color:#9c1f1f; font-weight:600; }
table.results { border-collapse:collapse; width:100%; font-size:12px; margin-top:10px; }
table.results th, table.results td { border:1px solid #e2e8f0; padding:5px 8px; text-align:left; }
table.results th { background:#f3f6fb; position:sticky; top:0; }
tr.row-fail { background:#fff5f5; }
tr.row-required { background:#fffbe6; }
.controls { display:flex; gap:8px; margin:10px 0; flex-wrap:wrap; align-items:center; }
.controls input[type=text] { padding:5px 8px; border:1px solid #cbd5e1; border-radius:6px; width:220px; }
.controls select { padding:5px 8px; border:1px solid #cbd5e1; border-radius:6px; }
.table-wrap { max-height:520px; overflow:auto; border:1px solid #d8e0ee; border-radius:8px; }
.small-note { font-size:11px; color:#8492a6; margin-top:4px; }
"""

PAGE_JS = """
function filterTable(sizeId) {
  const search = document.getElementById('search-' + sizeId).value.toLowerCase();
  const statusFilter = document.getElementById('status-' + sizeId).value;
  const rows = document.querySelectorAll('#table-' + sizeId + ' tbody tr');
  rows.forEach(row => {
    const text = row.dataset.text.toLowerCase();
    const status = row.dataset.status;
    const matchesSearch = !search || text.includes(search) || row.dataset.id.toLowerCase().includes(search);
    const matchesStatus = statusFilter === 'all' || status === statusFilter;
    row.style.display = (matchesSearch && matchesStatus) ? '' : 'none';
  });
}
function showSize(sizeId) {
  document.querySelectorAll('.size-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('nav.sizes button').forEach(b => b.classList.remove('active'));
  document.getElementById('panel-' + sizeId).classList.add('active');
  document.getElementById('nav-' + sizeId).classList.add('active');
}
"""


def render_metric_card(label, value, baseline_value=None):
    baseline_html = f'<div class="baseline">baseline: {escape(baseline_value)}</div>' if baseline_value is not None else ""
    return f'<div class="metric-card"><div class="label">{escape(label)}</div><div class="value">{escape(value)}</div>{baseline_html}</div>'


def render_case_card(case_id, row, image_rel_path, extra_class=""):
    ocr = row.get("ocr") or {}
    img_html = f'<img src="{escape(image_rel_path)}" loading="lazy">' if image_rel_path else "<div>no image</div>"
    return f"""<div class="case-card {extra_class}">
      <div class="meta">"{escape(row['text'])}" &middot; {escape(row.get('heightMm'))}mm &middot; {escape(row.get('stoneCount'))} stones</div>
      {img_html}
      <div class="ocr-text">OCR: "{escape(ocr.get('rawOcrText',''))}" &middot; char {escape(ocr.get('charAccuracy'))} &middot; conf {escape(ocr.get('confidence'))}</div>
    </div>"""


def build_size_panel(size_upper, data, assets, curated):
    summary = data["summary"]
    g, b = summary["generated"], summary["baseline"]
    verdict = summary["verdict"]
    verdict_class = "verdict-pass" if verdict["passed"] else "verdict-fail"
    verdict_label = "PASS" if verdict["passed"] else "FAIL"
    cfg = summary["heightsMm"]

    metrics_html = "".join([
        render_metric_card("Mean char accuracy", g["meanCharAccuracy"], b["meanCharAccuracy"]),
        render_metric_card("Mean word accuracy", g["meanWordAccuracy"], b["meanWordAccuracy"]),
        render_metric_card("Exact-match rate", g["exactMatchRate"], b["exactMatchRate"]),
        render_metric_card("Required phrases", f"{g['requiredPhrasePassCount']}/{g['requiredPhraseCount']}", f"{b['requiredPhrasePassCount']}/{b['requiredPhraseCount']}"),
        render_metric_card("Unrecognized samples", f"{g['unrecognizedCount']}/{g['count']}", f"{b['unrecognizedCount']}/{b['count']}"),
        render_metric_card("Mean OCR confidence", g["meanConfidence"], b["meanConfidence"]),
    ])

    gen_by_id = stone_lookup(data["evaluation"]["generated"])

    # Representative successes
    rep_cards = "".join(
        render_case_card(cid, gen_by_id[cid], assets.get(f"{cid}.generated"))
        for cid in curated["representativeIds"] if cid in gen_by_id
    )

    # Required phrases (every height)
    required_rows = [r for r in data["evaluation"]["generated"] if r.get("isRequiredPhrase")]
    required_cards = "".join(
        render_case_card(r["label"], r, assets.get(f"{r['label']}.generated"), "" if (r.get("ocr") or {}).get("exactMatch") else "fail")
        for r in required_rows
    )

    # Worst-N
    worst_cards = "".join(
        render_case_card(cid, gen_by_id[cid], assets.get(f"{cid}.generated"), "fail")
        for cid in curated["worstIds"] if cid in gen_by_id
    )

    # All failures (exact-match false among non-required, beyond worst-N, capped for page size)
    all_failures = [r for r in data["evaluation"]["generated"] if r.get("ocr") and not r["ocr"]["exactMatch"]]
    failure_rows_html = "".join(
        f"<tr><td>{escape(r['label'])}</td><td>{escape(r['text'])}</td><td>{escape(r['heightMm'])}</td>"
        f"<td>{escape((r.get('ocr') or {}).get('rawOcrText'))}</td><td>{escape((r.get('ocr') or {}).get('charAccuracy'))}</td></tr>"
        for r in all_failures
    )

    # Ambiguous glyph pairs -- flag any confusable pair where BOTH glyphs individually OCR to the
    # same recognized character (a genuine collapse), summarized from the full corpus's single-char items.
    single_char_gen = {r["text"]: r for r in data["evaluation"]["generated"] if len(r["text"]) == 1 and r.get("ocr")}
    confusable_pairs = json.loads(open(REPO_ROOT / "tools/font-generator/corpus.json").read())["confusablePairs"]
    pair_rows = []
    for a, b_char in confusable_pairs:
        ra, rb = single_char_gen.get(a), single_char_gen.get(b_char)
        if not ra or not rb:
            continue
        collapsed = ra["ocr"]["actualNormalized"] and ra["ocr"]["actualNormalized"] == rb["ocr"]["actualNormalized"]
        pair_rows.append((a, b_char, ra["ocr"]["rawOcrText"], rb["ocr"]["rawOcrText"], collapsed))
    ambiguous_html = "".join(
        f"<tr class='{'pair-fail' if collapsed else ''}'><td>{escape(a)}</td><td>{escape(bc)}</td>"
        f"<td>{escape(ta)}</td><td>{escape(tb)}</td><td>{'COLLAPSED' if collapsed else 'ok'}</td></tr>"
        for a, bc, ta, tb, collapsed in pair_rows
    )

    # Geometry warnings from generation-metadata (glyphs where a min-width/hole correction hit the cap, or contour count changed unexpectedly)
    warn_rows = []
    for gl in data["metadata"]["glyphLogs"]:
        if gl["contoursAfter"] < gl["contoursBefore"]:
            warn_rows.append((gl["char"], "contour count decreased", f"{gl['contoursBefore']} -> {gl['contoursAfter']}"))
    warnings_html = "".join(
        f"<tr><td>{escape(c)}</td><td>{escape(w)}</td><td>{escape(d)}</td></tr>" for c, w, d in warn_rows
    ) or "<tr><td colspan='3'>No geometry warnings.</td></tr>"

    # Full searchable table (every case)
    all_rows_html = []
    for r in data["evaluation"]["generated"]:
        ocr = r.get("ocr") or {}
        status = "error" if r.get("error") else ("fail" if ocr and not ocr.get("exactMatch") else "pass")
        row_class = "row-fail" if status == "fail" else ("row-required" if r.get("isRequiredPhrase") else "")
        all_rows_html.append(
            f"<tr class='{row_class}' data-id='{escape(r['label'])}' data-text='{escape(r['text'])}' data-status='{status}'>"
            f"<td>{escape(r['label'])}</td><td>{escape(r['text'])}</td><td>{escape(r['category'])}</td>"
            f"<td>{escape(r['heightLabel'])} ({escape(r['heightMm'])}mm)</td>"
            f"<td>{escape(r.get('stoneCount'))}</td><td>{escape(r.get('collisionCount'))}</td><td>{escape(r.get('clusterCount'))}</td>"
            f"<td>{escape(ocr.get('rawOcrText'))}</td><td>{escape(ocr.get('charAccuracy'))}</td><td>{escape(ocr.get('wordAccuracy'))}</td>"
            f"<td>{escape(ocr.get('confidence'))}</td><td>{'yes' if r.get('isRequiredPhrase') else ''}</td></tr>"
        )
    all_rows_html = "".join(all_rows_html)

    findings_html = "".join(f"<li>{escape(f)}</li>" for f in verdict["findings"]) or "<li>None.</li>"

    return f"""
    <section id="panel-{size_upper}" class="size-panel">
      <h2 style="border:none;font-size:18px;margin-top:0;">{size_upper}
        <span class="verdict-badge {verdict_class}">{verdict_label}</span>
      </h2>
      <div class="small-note">
        Stone diameter {escape(data['summary']['heightsMm'])} &middot;
        Heights tested: min {cfg['min']}mm &middot; mid {cfg['mid']}mm &middot; max {cfg['max']}mm
      </div>
      <div class="metrics-grid">{metrics_html}</div>
      <h2>Threshold findings</h2>
      <ul>{findings_html}</ul>

      <h2>Required phrases (every tested height)</h2>
      <div class="case-grid">{required_cards or '<div>No data.</div>'}</div>

      <h2>Representative successful samples</h2>
      <div class="case-grid">{rep_cards or '<div>No data.</div>'}</div>

      <h2>Lowest-scoring OCR samples</h2>
      <div class="case-grid">{worst_cards or '<div>No data.</div>'}</div>

      <h2>All OCR failures ({len(all_failures)})</h2>
      <div class="table-wrap"><table class="results"><thead><tr><th>id</th><th>text</th><th>heightMm</th><th>OCR text</th><th>char acc</th></tr></thead>
      <tbody>{failure_rows_html or '<tr><td colspan=5>None -- every case exact-matched.</td></tr>'}</tbody></table></div>

      <h2>Ambiguous glyph pairs (single-character OCR collapse check)</h2>
      <div class="table-wrap"><table class="results"><thead><tr><th>char A</th><th>char B</th><th>OCR A</th><th>OCR B</th><th>status</th></tr></thead>
      <tbody>{ambiguous_html or '<tr><td colspan=5>No pairs evaluated.</td></tr>'}</tbody></table></div>

      <h2>Geometry warnings (generation-time)</h2>
      <div class="table-wrap"><table class="results"><thead><tr><th>glyph</th><th>warning</th><th>detail</th></tr></thead>
      <tbody>{warnings_html}</tbody></table></div>

      <h2>Full corpus results (searchable)</h2>
      <div class="controls">
        <input type="text" id="search-{size_upper}" placeholder="Search text or id..." oninput="filterTable('{size_upper}')">
        <select id="status-{size_upper}" onchange="filterTable('{size_upper}')">
          <option value="all">All statuses</option>
          <option value="pass">Pass</option>
          <option value="fail">Fail</option>
          <option value="error">Error</option>
        </select>
      </div>
      <div class="table-wrap">
        <table class="results" id="table-{size_upper}">
          <thead><tr><th>id</th><th>text</th><th>category</th><th>height</th><th>stones</th><th>collisions</th><th>clusters</th>
          <th>OCR text</th><th>char acc</th><th>word acc</th><th>confidence</th><th>required</th></tr></thead>
          <tbody>{all_rows_html}</tbody>
        </table>
      </div>
    </section>
    """


def main():
    sizes_data = {}
    for size_upper in ALL_SIZES:
        data = load_size_data(size_upper)
        if data is not None:
            sizes_data[size_upper] = data

    if not sizes_data:
        print("No evaluation data found -- run pipeline.py and analyze.py first.")
        return

    nav_html = "".join(
        f'<button id="nav-{s}" onclick="showSize(\'{s}\')" class="{"active" if i == 0 else ""}">{s}</button>'
        for i, s in enumerate(sizes_data)
    )

    panels_html = []
    for i, (size_upper, data) in enumerate(sizes_data.items()):
        assets, curated = build_assets_for_size(size_upper, data)
        panel = build_size_panel(size_upper, data, assets, curated)
        if i == 0:
            panel = panel.replace('class="size-panel"', 'class="size-panel active"', 1)
        panels_html.append(panel)

    html = f"""<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>FONT-GEN-001 Review -- Sacramento Rhinestone Family</title>
<style>{PAGE_CSS}</style>
</head>
<body>
<header>
  <h1>FONT-GEN-001 -- Procedural Sacramento Rhinestone Family Review</h1>
  <div class="sub">5 variants (SS6/SS10/SS16/SS20/SS30), each generated directly from Sacramento-Regular.ttf, evaluated via OCR-based readability testing against the real production pipeline.</div>
</header>
<nav class="sizes">{nav_html}</nav>
{''.join(panels_html)}
<script>{PAGE_JS}</script>
</body>
</html>"""

    out_path = REVIEW_ROOT / "FONT-GEN-001-review.html"
    with open(out_path, "w") as f:
        f.write(html)
    print(f"Wrote {out_path}")


if __name__ == "__main__":
    main()
