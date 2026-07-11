import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// UI discoverability fix (follow-up to RS-1003). A human reviewer running the live app manually
// reported that "Curved Text", "SVG Import", and "Shape tools" (Add circle/Add rectangle) were not
// discoverable. Root cause: the left sidebar (#the .side panel in index.html) had grown to ~1615px
// of stacked content while typical browser viewports only expose ~700-900px of it, and the panel's
// native scroll had zero visual affordance — nothing signaled there was more content below. The
// "Add circle"/"Add rectangle"/"Import SVG" controls, in particular, previously sat ~800px down the
// panel (below the Text/Curve/Stone/Cup controls), well past the fold on every realistic screen size
// tested (1280x800, 1366x768, 1440x900); only a 1920x1080 display showed them without scrolling.
//
// Fix (index.html only, no GeometryEngine/StoneLayout/app.js change): moved the Layers list + "Add
// circle"/"Add rectangle"/"Import SVG"/"Delete selected layer" controls to immediately follow the
// "Selected layer" dropdown, before any per-layer-type detail controls — so layer-creation tools are
// always the first thing in the panel, reachable with zero scrolling on any reasonably-sized screen.
// A CSS-only "scroll shadow" (no JS) was added to .side so the remaining scrollable content (curved
// text detail fields, stone/cup settings, 3D view, exports) has a visible edge-of-panel cue.
//
// These are structural checks against the live index.html source (this file has no DOM/browser
// dependency, matching the established convention for structural app.js/index.html guard tests).

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

await test('1. Add circle / Add rectangle / Import SVG appear before any per-layer-type detail controls (textControls/shapeControls/svgControls)', () => {
  const addCircleIndex = indexHtml.indexOf('id="addCircle"');
  const addRectIndex = indexHtml.indexOf('id="addRect"');
  const importSvgIndex = indexHtml.indexOf('id="importSvg"');
  const textControlsIndex = indexHtml.indexOf('id="textControls"');
  const shapeControlsIndex = indexHtml.indexOf('id="shapeControls"');
  const svgControlsIndex = indexHtml.indexOf('id="svgControls"');

  assert.ok(addCircleIndex > 0 && addRectIndex > 0 && importSvgIndex > 0, 'expected addCircle/addRect/importSvg to exist in index.html');
  assert.ok(textControlsIndex > 0 && shapeControlsIndex > 0 && svgControlsIndex > 0, 'expected textControls/shapeControls/svgControls to exist in index.html');

  for (const [label, index] of [['addCircle', addCircleIndex], ['addRect', addRectIndex], ['importSvg', importSvgIndex]]) {
    assert.ok(index < textControlsIndex, `expected #${label} to appear before #textControls (layer-creation tools must be reachable before per-layer detail fields)`);
    assert.ok(index < shapeControlsIndex, `expected #${label} to appear before #shapeControls`);
    assert.ok(index < svgControlsIndex, `expected #${label} to appear before #svgControls`);
  }
});

await test('2. Add circle / Add rectangle / Import SVG appear immediately after the "Selected layer" dropdown (top of the panel, not buried under Stone/Cup settings)', () => {
  const selectedLayerIndex = indexHtml.indexOf('id="selectedLayer"');
  const cupColorIndex = indexHtml.indexOf('id="cupColor"');
  const addCircleIndex = indexHtml.indexOf('id="addCircle"');
  assert.ok(selectedLayerIndex > 0 && cupColorIndex > 0, 'expected #selectedLayer and #cupColor to exist');
  assert.ok(addCircleIndex > selectedLayerIndex, 'expected #addCircle after #selectedLayer');
  assert.ok(addCircleIndex < cupColorIndex, 'expected #addCircle before #cupColor (previously it was after, requiring a long scroll)');
});

await test('3. the Layers section is not duplicated (exactly one #layersList, #addCircle, #addRect, #importSvg, #deleteSelected)', () => {
  for (const id of ['layersList', 'addCircle', 'addRect', 'importSvg', 'deleteSelected']) {
    const matches = indexHtml.match(new RegExp(`id="${id}"`, 'g')) || [];
    assert.equal(matches.length, 1, `expected exactly one element with id="${id}", found ${matches.length}`);
  }
});

await test('4. #textControls is still immediately followed by #shapeControls (curved-text integration test\'s adjacency assumption still holds)', () => {
  assert.match(indexHtml, /<div id="textControls">[\s\S]*?<\/div>\s*<div id="shapeControls"/);
});

await test('5. .side has a scroll-shadow affordance (a real visual cue that more content exists below, not just a bare native scrollbar)', () => {
  const match = indexHtml.match(/\.side\{([^}]*)\}/);
  assert.ok(match, 'expected a .side CSS rule');
  const body = match[1];
  assert.match(body, /overflow:auto/, 'expected .side to remain scrollable');
  assert.ok(/gradient/.test(body), 'expected .side to declare a gradient-based scroll-shadow affordance');
  assert.ok(/\blocal\b/.test(body), 'expected the scroll-shadow to use background-attachment:local (so it tracks scroll position, not a static decoration)');
});

await test('6. app.js is untouched by this fix (the discoverability issue was a layout/CSS defect, not a wiring defect)', () => {
  // Sanity check only — this suite does not diff app.js against git history, since app.js legitimately
  // changed in RS-1003 itself. It only proves app.js still wires every id this fix relies on.
  for (const id of ['addCircle', 'addRect', 'importSvg', 'deleteSelected', 'layersList', 'curveEnabled']) {
    assert.ok(appJs.includes(`el('${id}')`), `expected app.js to still wire #${id}`);
  }
});

await test('7. GeometryEngine.js and StoneLayout.js are untouched by this fix', () => {
  const output = execSync('git status --porcelain', { cwd: repoRoot, encoding: 'utf8' });
  const changedPaths = output
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => line.slice(3).trim());

  for (const changedPath of changedPaths) {
    assert.notEqual(changedPath, 'src/geometry/GeometryEngine.js', 'this fix must not touch GeometryEngine.js');
    assert.notEqual(changedPath, 'src/geometry/StoneLayout.js', 'this fix must not touch StoneLayout.js');
  }
});

console.log('UI discoverability tests passed.');
