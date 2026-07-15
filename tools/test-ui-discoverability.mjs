import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// UI discoverability (superseded by UI-001, "Complete Application Redesign"). The original version
// of this file (RS-1003 era) fixed a *symptom*: a single `.side` sidebar had grown to ~1615px of
// stacked content with no visual scroll affordance, burying layer-creation tools ~800px down the
// panel. UI-001 fixes the underlying *architecture* the symptom came from: there is no longer one
// long stacked sidebar at all. This file now asserts the structural properties that make that true,
// rather than a scroll-position heuristic tied to a layout UI-001 deliberately replaced.
//
// These are structural checks against the live index.html/app.js source (no DOM/browser
// dependency), matching the established convention for these guard tests.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const indexHtml = await readFile(path.join(repoRoot, 'index.html'), 'utf8');
const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');

async function test(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

function extractElementHtml(html, id) {
  const openTagMatch = html.match(new RegExp(`<([a-zA-Z]+)[^>]*\\bid="${id}"[^>]*>`));
  assert.ok(openTagMatch, `expected to find an element with id="${id}"`);
  const tag = openTagMatch[1];
  const start = openTagMatch.index + openTagMatch[0].length;
  const openRe = new RegExp(`<${tag}\\b`, 'g');
  const closeRe = new RegExp(`</${tag}>`, 'g');
  openRe.lastIndex = start;
  closeRe.lastIndex = start;
  let depth = 1;
  let cursor = start;
  while (depth > 0) {
    openRe.lastIndex = cursor;
    closeRe.lastIndex = cursor;
    const nextOpen = openRe.exec(html);
    const nextClose = closeRe.exec(html);
    assert.ok(nextClose, `unbalanced <${tag}> for id="${id}"`);
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth++;
      cursor = nextOpen.index + nextOpen[0].length;
    } else {
      depth--;
      cursor = nextClose.index + nextClose[0].length;
      if (depth === 0) return html.slice(start, nextClose.index);
    }
  }
  throw new Error(`unreachable: failed to extract #${id}`);
}

await test('1. the top menu exposes all nine required buttons, in the required order, always visible (not inside any Lightbox)', () => {
  const order = ['menuText', 'menuShapes', 'menuImport', 'menuImageTrace', 'menuExport', 'menuProdSheet', 'menuShipping', 'menuSettings', 'menuHelp'];
  const indices = order.map((id) => {
    const idx = indexHtml.indexOf(`id="${id}"`);
    assert.ok(idx > 0, `expected #${id} to exist`);
    return idx;
  });
  for (let i = 1; i < indices.length; i++) {
    assert.ok(indices[i] > indices[i - 1], `expected top-menu buttons in order: ${order[i - 1]} before ${order[i]}`);
  }
  const topbarMatch = indexHtml.match(/<header class="topbar">([\s\S]*?)<\/header>/);
  assert.ok(topbarMatch, 'expected a <header class="topbar"> element');
  for (const id of order) {
    assert.ok(topbarMatch[1].includes(`id="${id}"`), `expected #${id} inside the top bar (always visible, no scrolling, no dialog required to reach it)`);
  }
});

await test('2. the top bar also exposes Undo, Redo, and a Save shortcut', () => {
  const topbarMatch = indexHtml.match(/<header class="topbar">([\s\S]*?)<\/header>/);
  assert.ok(topbarMatch);
  for (const id of ['undoBtn', 'redoBtn', 'saveProject']) {
    assert.ok(topbarMatch[1].includes(`id="${id}"`), `expected #${id} inside the top bar`);
  }
});

await test('3. the left panel contains no per-layer-type parameter forms (textControls/shapeControls/svgControls/imageControls do not live there)', () => {
  const leftPanelMatch = indexHtml.match(/<aside class="left-panel"[^>]*>([\s\S]*?)<\/aside>/);
  assert.ok(leftPanelMatch, 'expected an <aside class="left-panel"> element');
  for (const id of ['textControls', 'shapeControls', 'svgControls', 'imageControls', 'curveControls']) {
    assert.ok(!leftPanelMatch[1].includes(`id="${id}"`), `expected #${id} (a per-layer-type detail form) to NOT be inside the left panel`);
  }
});

await test('4. the left panel scopes to exactly Project / Layers / Actions sections', () => {
  const leftPanelMatch = indexHtml.match(/<aside class="left-panel"[^>]*>([\s\S]*?)<\/aside>/);
  assert.ok(leftPanelMatch);
  const headings = [...leftPanelMatch[1].matchAll(/<h2>([^<]*)<\/h2>/g)].map((m) => m[1]);
  assert.deepEqual(headings, ['Project', 'Layers', 'Actions']);
});

// S-110 (Expanded Shape Library) superseded this test's own premise: Add circle/Add rectangle used
// to live as a *second*, duplicate creation control in the left panel's Layers section (the exact
// "fragmented interface" S-110 was asked to fix), proxied by dead buttons inside the Shapes ->
// Design Shapes Lightbox. S-110 removed the left-panel duplicates entirely -- Design Shapes is now
// the one place every shape (including Circle/Rectangle) is created. This test now asserts that
// single-source-of-truth property instead of the left panel location it used to check.
await test('5. layer-creation tools (all 11 Design Shapes, including Circle/Rectangle) are reachable inside Shapes -> Design Shapes, with no duplicate left-panel controls', () => {
  const leftPanelMatch = indexHtml.match(/<aside class="left-panel"[^>]*>([\s\S]*?)<\/aside>/);
  assert.ok(leftPanelMatch);
  assert.ok(!leftPanelMatch[1].includes('id="addCircle"'), 'the left panel must not contain a duplicate #addCircle');
  assert.ok(!leftPanelMatch[1].includes('id="addRect"'), 'the left panel must not contain a duplicate #addRect');

  const designPanelMatch = indexHtml.match(/<div class="lightbox-tab-panel" id="shapesPanelDesign">([\s\S]*?)<div id="shapeControls"/);
  assert.ok(designPanelMatch, 'expected #shapesPanelDesign in index.html');
  const shapeGridMatch = designPanelMatch[1].match(/<div class="shape-grid" id="shapeGrid">([\s\S]*?)<\/div>/);
  assert.ok(shapeGridMatch, 'expected #shapeGrid inside Design Shapes');
  for (const kind of ['circle', 'rectangle', 'ellipse', 'capsule', 'polygon', 'star', 'heart', 'arrow', 'cross', 'crescent', 'ring']) {
    assert.ok(shapeGridMatch[1].includes(`data-shape-kind="${kind}"`), `expected a ${kind} button in #shapeGrid`);
  }
});

await test('6. every per-layer-type detail control that used to live in the long sidebar still exists exactly once, now inside its Lightbox', () => {
  for (const id of ['textControls', 'shapeControls', 'svgControls', 'imageControls']) {
    const matches = indexHtml.match(new RegExp(`id="${id}"`, 'g')) || [];
    assert.equal(matches.length, 1, `expected exactly one element with id="${id}", found ${matches.length}`);
  }
  const textControlsBody = extractElementHtml(indexHtml, 'textControls');
  assert.ok(textControlsBody.includes('id="curveControls"'), 'expected #textControls to still contain #curveControls');
});

await test('7. app.js still wires every id this fix relies on', () => {
  // S-110: #addCircle/#addRect no longer exist (see test 5 above) -- #shapeGrid (the unified
  // Design Shapes creation control) and #addTextBtn (the new Add Text control) replace them.
  for (const id of ['shapeGrid', 'addTextBtn', 'importSvg', 'deleteSelected', 'layersList', 'curveEnabled', 'menuText', 'menuShapes', 'menuImport']) {
    assert.ok(appJs.includes(`el('${id}')`), `expected app.js to still wire #${id}`);
  }
});

console.log('UI discoverability tests passed.');
