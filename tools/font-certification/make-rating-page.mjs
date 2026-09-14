#!/usr/bin/env node
/**
 * READ-005 — build a blind rating page for a directory of opaque-slug renders.
 *
 *   node tools/font-certification/make-rating-page.mjs <renderDir> <outHtmlPath>
 *
 * e.g.
 *   node tools/font-certification/make-rating-page.mjs \
 *     tools/font-certification/output/read-005/tracking-renders \
 *     tools/font-certification/output/read-005/tracking-rating.html
 *
 * Tracked twin of the untracked output/read-005/make-rating-page.mjs written for the calibration
 * set: same three questions, same Q/W/E + A/S keyboard shortcuts, same after-every-keystroke
 * local-storage autosave, same natural-sort ordering, same "only filenames are read, the key is
 * never opened" property.
 *
 * The one deliberate difference is the local-storage key: it is derived from the render directory's
 * basename, so rating the tracking set cannot collide with — or overwrite — the completed
 * calibration session (`read005-ratings-v1`). The CSV download is likewise named after the set.
 */
import { readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function buildRatingPageHtml({ slugs, imgDir, storeKey, csvName }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rating ${slugs.length} renders</title>
<style>
  :root {
    --ground: #0f1720;
    --panel: #16202b;
    --edge: #24323f;
    --ink: #e6edf4;
    --ink-dim: #8fa3b6;
    --sel: #e6edf4;
    --sel-ink: #0f1720;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0; height: 100%;
    background: var(--ground); color: var(--ink);
    font-family: ui-sans-serif, -apple-system, "Helvetica Neue", Arial, sans-serif;
    font-size: 15px; line-height: 1.5;
  }
  body { display: flex; flex-direction: column; overflow: hidden; }

  .bar {
    display: flex; align-items: baseline; gap: 18px;
    padding: 14px 22px; border-bottom: 1px solid var(--edge);
    background: var(--panel); flex: none;
  }
  .count { font-variant-numeric: tabular-nums; font-weight: 600; letter-spacing: -0.01em; }
  .slug { color: var(--ink-dim); font-family: ui-monospace, Menlo, monospace; font-size: 13px; }
  .done { color: var(--ink-dim); font-size: 13px; margin-left: auto; font-variant-numeric: tabular-nums; }
  .track { height: 2px; background: var(--edge); flex: none; }
  .track > div { height: 100%; background: var(--ink-dim); width: 0; transition: width .18s ease; }

  .stage {
    flex: 1 1 auto; min-height: 0;
    display: flex; align-items: center; justify-content: center;
    padding: 24px; background: var(--ground);
  }
  .stage img { max-width: 100%; max-height: 100%; object-fit: contain; display: block; }

  .controls {
    flex: none; border-top: 1px solid var(--edge); background: var(--panel);
    padding: 16px 22px 18px;
    display: grid; grid-template-columns: auto 1fr; gap: 12px 28px; align-items: center;
  }
  .qlabel { color: var(--ink-dim); font-size: 14px; white-space: nowrap; }
  .opts { display: flex; gap: 8px; flex-wrap: wrap; }
  button.opt {
    font: inherit; color: var(--ink); background: transparent;
    border: 1px solid var(--edge); padding: 7px 15px; cursor: pointer;
  }
  button.opt.round { border-radius: 999px; }
  button.opt.square { border-radius: 4px; }
  button.opt:hover { border-color: var(--ink-dim); }
  button.opt[aria-pressed="true"] { background: var(--sel); color: var(--sel-ink); border-color: var(--sel); }
  button.opt .k {
    color: var(--ink-dim); font-size: 11px; margin-left: 8px;
    font-family: ui-monospace, Menlo, monospace;
  }
  button.opt[aria-pressed="true"] .k { color: var(--sel-ink); opacity: .55; }
  :focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }

  textarea {
    font: inherit; color: var(--ink); background: var(--ground);
    border: 1px solid var(--edge); border-radius: 4px;
    padding: 8px 10px; width: 100%; resize: vertical; min-height: 42px;
  }
  .foot { display: flex; align-items: center; gap: 14px; grid-column: 1 / -1; margin-top: 2px; }
  .hint { color: var(--ink-dim); font-size: 12.5px; }
  .foot button {
    font: inherit; color: var(--ink); background: transparent;
    border: 1px solid var(--edge); border-radius: 4px; padding: 7px 14px; cursor: pointer;
  }
  .foot button:hover { border-color: var(--ink-dim); }
  .foot .spacer { margin-left: auto; }
  @media (prefers-reduced-motion: reduce) { .track > div { transition: none; } }
</style>
</head>
<body>
  <div class="bar">
    <span class="count" id="count"></span>
    <span class="slug" id="slug"></span>
    <span class="done" id="done"></span>
  </div>
  <div class="track"><div id="trackfill"></div></div>

  <div class="stage"><img id="shot" alt=""></div>

  <div class="controls">
    <span class="qlabel">Can you read it?</span>
    <div class="opts" id="readable">
      <button class="opt round" data-v="yes" aria-pressed="false">Yes<span class="k">Q</span></button>
      <button class="opt round" data-v="struggle" aria-pressed="false">Struggle<span class="k">W</span></button>
      <button class="opt round" data-v="no" aria-pressed="false">No<span class="k">E</span></button>
    </div>

    <span class="qlabel">Would you sell it?</span>
    <div class="opts" id="sellable">
      <button class="opt square" data-v="yes" aria-pressed="false">Yes<span class="k">A</span></button>
      <button class="opt square" data-v="no" aria-pressed="false">No<span class="k">S</span></button>
    </div>

    <span class="qlabel">Notes</span>
    <textarea id="notes" rows="1" placeholder="What stands out — good or bad"></textarea>

    <div class="foot">
      <button id="prev">Previous</button>
      <button id="next">Next</button>
      <span class="hint">Arrows move. Q W E and A S answer. Esc leaves the notes box.</span>
      <span class="spacer"></span>
      <button id="download">Download CSV</button>
    </div>
  </div>

<script>
const SLUGS = ${JSON.stringify(slugs)};
const DIR = ${JSON.stringify(imgDir)};
const STORE = ${JSON.stringify(storeKey)};
const CSV_NAME = ${JSON.stringify(csvName)};

let data = {};
try {
  const raw = localStorage.getItem(STORE);
  if (raw) data = JSON.parse(raw);
} catch (e) {
  console.warn('Local storage unavailable — progress will not be saved between sessions.', e);
}

function save() {
  try { localStorage.setItem(STORE, JSON.stringify(data)); } catch (e) { /* keep going in-memory */ }
}

const rec = (s) => (data[s] ||= { readable: '', sellable: '', notes: '' });
const isRated = (s) => { const r = data[s]; return r && r.readable && r.sellable; };

let i = SLUGS.findIndex((s) => !isRated(s));
if (i < 0) i = 0;

const $ = (id) => document.getElementById(id);
const shot = $('shot'), notes = $('notes');

function paint() {
  const slug = SLUGS[i], r = rec(slug);
  shot.src = DIR + '/' + slug + '.png';
  $('count').textContent = (i + 1) + ' of ' + SLUGS.length;
  $('slug').textContent = slug;
  const n = SLUGS.filter(isRated).length;
  $('done').textContent = n + ' rated, ' + (SLUGS.length - n) + ' left';
  $('trackfill').style.width = (100 * n / SLUGS.length) + '%';
  for (const group of ['readable', 'sellable']) {
    for (const b of $(group).querySelectorAll('button')) {
      b.setAttribute('aria-pressed', String(b.dataset.v === r[group]));
    }
  }
  notes.value = r.notes || '';
}

function set(group, value) {
  const r = rec(SLUGS[i]);
  r[group] = r[group] === value ? '' : value;
  save();
  paint();
}

function go(delta) {
  const next = i + delta;
  if (next < 0 || next >= SLUGS.length) return;
  i = next;
  paint();
}

for (const group of ['readable', 'sellable']) {
  $(group).addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) set(group, b.dataset.v);
  });
}
notes.addEventListener('input', () => { rec(SLUGS[i]).notes = notes.value; save(); });
notes.addEventListener('keydown', (e) => { if (e.key === 'Escape') notes.blur(); });
$('prev').onclick = () => go(-1);
$('next').onclick = () => go(1);

document.addEventListener('keydown', (e) => {
  if (e.target === notes || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
  else if (k === 'q') set('readable', 'yes');
  else if (k === 'w') set('readable', 'struggle');
  else if (k === 'e') set('readable', 'no');
  else if (k === 'a') set('sellable', 'yes');
  else if (k === 's') set('sellable', 'no');
});

function csvCell(v) { return '"' + String(v ?? '').replace(/"/g, '""') + '"'; }

$('download').onclick = () => {
  const missing = SLUGS.filter((s) => !isRated(s)).length;
  if (missing > 0 && !confirm(missing + ' of ' + SLUGS.length + ' are still unrated. Download anyway?')) return;
  const lines = ['slug,readable,sellable,notes'];
  for (const s of SLUGS) {
    const r = rec(s);
    lines.push([s, r.readable, r.sellable, r.notes].map(csvCell).join(','));
  }
  const url = URL.createObjectURL(new Blob([lines.join('\\n') + '\\n'], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url; a.download = CSV_NAME; a.click();
  URL.revokeObjectURL(url);
};

paint();
</script>
</body>
</html>
`;
}

function main(argv) {
  const [renderDirArg, outPathArg] = argv;
  if (!renderDirArg || !outPathArg) {
    console.error('usage: node tools/font-certification/make-rating-page.mjs <renderDir> <outHtmlPath>');
    process.exit(1);
  }
  const renderDir = path.resolve(renderDirArg);
  const outPath = path.resolve(outPathArg);

  const slugs = readdirSync(renderDir)
    .filter((f) => f.toLowerCase().endsWith('.png'))
    .map((f) => f.replace(/\.png$/i, ''))
    .sort(new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare);

  if (slugs.length === 0) {
    console.error(`No PNGs found in ${renderDir} — generate the renders first.`);
    process.exit(1);
  }

  // Storage + CSV names keyed on the render directory's basename, so the tracking session gets its
  // own slot and cannot collide with the completed calibration session (`read005-ratings-v1`).
  const setName = path.basename(renderDir).replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const storeKey = `read005-${setName}-ratings-v1`;
  const csvName = `${setName}-ratings.csv`;

  // The <img src> is resolved relative to the HTML file's own location.
  const imgDir = path.relative(path.dirname(outPath), renderDir) || '.';

  writeFileSync(outPath, buildRatingPageHtml({ slugs, imgDir, storeKey, csvName }), 'utf8');
  console.log(`${slugs.length} renders -> ${outPath}`);
  console.log(`storage key: ${storeKey}   csv: ${csvName}`);
  console.log(`First: ${slugs[0]}   Last: ${slugs[slugs.length - 1]}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2));
}
