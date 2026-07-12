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

await test('5. layer-creation tools (Add circle/Add rectangle) are reachable inside the Layers section of the left panel with zero scrolling required beyond the panel itself, immediately after the layer list', () => {
  const leftPanelMatch = indexHtml.match(/<aside class="left-panel"[^>]*>([\s\S]*?)<\/aside>/);
  assert.ok(leftPanelMatch);
  const body = leftPanelMatch[1];
  const layersListIndex = body.indexOf('id="layersList"');
  const addCircleIndex = body.indexOf('id="addCircle"');
  const addRectIndex = body.indexOf('id="addRect"');
  const actionsHeadingIndex = body.indexOf('Actions');
  assert.ok(layersListIndex > 0 && addCircleIndex > 0 && addRectIndex > 0 && actionsHeadingIndex > 0);
  assert.ok(addCircleIndex > layersListIndex && addCircleIndex < actionsHeadingIndex, 'expected #addCircle inside the Layers section');
  assert.ok(addRectIndex > layersListIndex && addRectIndex < actionsHeadingIndex, 'expected #addRect inside the Layers section');
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
  for (const id of ['addCircle', 'addRect', 'importSvg', 'deleteSelected', 'layersList', 'curveEnabled', 'menuText', 'menuShapes', 'menuImport']) {
    assert.ok(appJs.includes(`el('${id}')`), `expected app.js to still wire #${id}`);
  }
});

console.log('UI discoverability tests passed.');
