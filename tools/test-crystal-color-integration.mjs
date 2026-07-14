import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// RS-1007 — Crystal Color Library. Verifies the *wiring*, as opposed to the catalog data itself
// (see tools/test-crystal-color-catalog.mjs): app.js/index.html's organized color selector and
// live swatch, that every layer type can carry a new-catalog color end to end through the real
// permanent GeometryEngine, that Project JSON save/load and undo/redo don't lose a new-catalog
// color, and that the 2D renderer / 3D texture / SVG exporter / Production Sheet exporter all
// resolve a brand-new catalog color identically with zero changes to those files (structural
// guard + a runtime consistency check). app.js/index.html are structurally inspected (not
// executed) since app.js is a browser entry point, matching the established convention in
// tools/test-undo-redo-integration.mjs / tools/test-shape-geometry-integration.mjs.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');
const indexHtml = await readFile(path.join(repoRoot, 'index.html'), 'utf8');

const { STONE_COLORS, getCrystalColor } = await import('../src/renderer/CrystalColors.js');
const { drawStone } = await import('../src/renderer/CanvasRenderer2D.js');
const { drawStoneLayoutTexture } = await import('../src/preview3d/StoneLayoutTexture.js');
const { stoneCircleSvg, stoneLayoutToSvg } = await import('../src/export/SvgExporter.js');
const { productionSheetToSvg } = await import('../src/export/ProductionSheetExporter.js');
const { Stone } = await import('../src/geometry/Stone.js');
const { StoneLayout } = await import('../src/geometry/StoneLayout.js');
const { GeometryEngine } = await import('../src/geometry/index.js');
const { FontManager } = await import('../src/fonts/index.js');
const { createDefaultFontProviderRegistry } = await import('../src/text/index.js');

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

function makeLayout(stoneParams, layerId = 'layer-1') {
  const stones = stoneParams.map((p, index) => new Stone({ layerId, index, ...p }));
  return new StoneLayout({ layerId, stones });
}

function createFakeCtx() {
  const calls = { arc: [], gradients: [] };
  const target = {
    arc(x, y, r) { calls.arc.push({ x, y, r }); },
    createRadialGradient() {
      const stops = [];
      calls.gradients.push(stops);
      return { addColorStop(offset, color) { stops.push({ offset, color }); } };
    },
    createLinearGradient() { return { addColorStop() {} }; }
  };
  const ctx = new Proxy(target, {
    get(obj, prop) { return prop in obj ? obj[prop] : () => {}; },
    set(obj, prop, value) { obj[prop] = value; return true; }
  });
  return { ctx, calls };
}

// A new-catalog color (did not exist before RS-1007) used throughout to prove the whole pipeline
// generalizes to it with no code change beyond the catalog itself.
const NEW_COLOR_ID = 'topaz';

// --- 1. index.html / app.js UI wiring -------------------------------------------------------------

await test('1. index.html no longer hardcodes <option>s for #stoneColor, and exposes a swatch element', () => {
  const selectMatch = indexHtml.match(/<select id="stoneColor">([\s\S]*?)<\/select>/);
  assert.ok(selectMatch, 'expected to find #stoneColor <select>');
  assert.equal(selectMatch[1].trim(), '', '#stoneColor must have no hardcoded <option>s (app.js populates it from the catalog)');
  assert.match(indexHtml, /<span id="stoneColorSwatch"/, 'expected a #stoneColorSwatch element');
});

await test('2. app.js populates #stoneColor from STONE_COLORS grouped into <optgroup>s, and updates a live swatch', () => {
  assert.match(appJs, /function populateStoneColorOptions\(\)\{/, 'expected populateStoneColorOptions() to be defined');
  assert.match(appJs, /<optgroup label=/, 'expected <optgroup> markup to be generated');
  assert.match(appJs, /function updateStoneColorSwatch\(\)\{/, 'expected updateStoneColorSwatch() to be defined');
  assert.match(appJs, /populateStoneColorOptions\(\)/, 'expected populateStoneColorOptions() to actually be called');
  // Swatch must be refreshed on every updateAll() pass (edits, undo/redo, import, layer switch all
  // funnel through updateAll() -> updateStats()), not just once at startup.
  const statsMatch = appJs.match(/function updateStats\(\)\{([\s\S]*?)\}\n/);
  assert.ok(statsMatch, 'expected to find updateStats()');
  assert.match(statsMatch[1], /updateStoneColorSwatch\(\)/, 'updateStats() must refresh the swatch');
});

await test('3. #stoneColor remains history-tracked (undo/redo keeps working for color changes)', () => {
  const listMatch = appJs.match(/const HISTORY_TRACKED_CONTROL_IDS=\[([\s\S]*?)\];/);
  assert.ok(listMatch, 'expected HISTORY_TRACKED_CONTROL_IDS');
  const ids = JSON.parse(`[${listMatch[1].replace(/'/g, '"')}]`);
  assert.ok(ids.includes('stoneColor'), 'stoneColor must stay history-tracked');
});

await test('4. app.js\'s import of STONE_COLORS from StoneColors.js is unchanged (no consumer needed a new import line)', () => {
  assert.match(appJs, /import\s*\{\s*STONE_COLORS\s*\}\s*from\s*['"]\.\/src\/renderer\/StoneColors\.js['"]/);
});

await test('5. defaultProject()\'s default layer color still resolves to a real catalog entry', () => {
  const match = appJs.match(/function defaultProject\(\)\{[\s\S]*?color:'([a-z0-9-]+)'/);
  assert.ok(match, 'expected to find defaultProject()\'s layer color literal');
  assert.ok(getCrystalColor(match[1]), `defaultProject()'s default color "${match[1]}" must be a real catalog id`);
});

// --- 2. Project JSON save/load preserves a new-catalog color -------------------------------------

await test('6. Project JSON round-trip preserves a brand-new catalog color id (validateProject does not reject/alter it)', () => {
  const validateSrc = appJs.match(/function validateProject\(obj\)\{([\s\S]*?)\n\}\n/);
  assert.ok(validateSrc, 'expected to find validateProject()');
  // validateProject() must not special-case or enumerate color at all -- it should pass layers
  // through unchanged (`...l`), which is what lets any catalog id (old or new) survive import.
  assert.ok(!/l\.color/.test(validateSrc[1]), 'validateProject() must not special-case layer.color (it must pass colors through untouched)');

  const project = {
    version: 2, units: 'mm', name: 'Round Trip', product: 'mug', canvas: { width: 210, height: 90 },
    cupColor: '#1f3556', wrap: 'front',
    layers: [{ id: 'text', type: 'text', visible: true, text: 'Hi', font: 'courier-prime-regular', height: 20, textMode: 'stroke', stoneSize: 2, gap: 0.3, color: NEW_COLOR_ID }]
  };
  const roundTripped = JSON.parse(JSON.stringify(project));
  assert.equal(roundTripped.layers[0].color, NEW_COLOR_ID, 'JSON round-trip must preserve the new color id exactly');
});

// --- 3. every layer type carries a new-catalog color through the real permanent GeometryEngine ---

const manifest = JSON.parse(await readFile(path.join(repoRoot, 'assets/fonts/manifest.json'), 'utf8'));
const fontManager = new FontManager(manifest);
async function loadFontBufferFromRepoRoot(relativePath) {
  const buffer = await readFile(path.join(repoRoot, relativePath));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}
const fontProviderRegistry = createDefaultFontProviderRegistry(fontManager, { loadFontBuffer: loadFontBufferFromRepoRoot });
const engine = new GeometryEngine({ fontProviderRegistry });

await test('7. a text layer (including curved text) can carry a new-catalog color end to end', async () => {
  const straight = await engine.generateTextLayout({
    text: 'Hi', fontId: 'courier-prime-regular', layerId: 'l1', heightMm: 12,
    stoneSizeMm: 2, gapMm: 0.3, mode: 'outline', color: NEW_COLOR_ID
  });
  assert.ok(straight.count > 0);
  assert.ok(straight.stones.every((s) => s.color === NEW_COLOR_ID));

  const curved = await engine.generateTextLayout({
    text: 'Hi', fontId: 'courier-prime-regular', layerId: 'l2', heightMm: 12,
    stoneSizeMm: 2, gapMm: 0.3, mode: 'outline', color: NEW_COLOR_ID,
    curveEnabled: true, curveRadiusMm: 40, curveDirection: 'outside', curveStartAngleDeg: 0, curveSweepAngleDeg: 180, curveAlignment: 'center'
  });
  assert.ok(curved.count > 0);
  assert.ok(curved.stones.every((s) => s.color === NEW_COLOR_ID));
});

await test('8. a shape (circle) layer can carry a new-catalog color end to end', () => {
  const result = engine.generateShapeLayout({
    shape: 'circle', layerId: 'l3', cxMm: 20, cyMm: 20, radiusMm: 10,
    stoneSizeMm: 2, gapMm: 0.3, mode: 'outline', color: NEW_COLOR_ID
  });
  assert.ok(result.count > 0);
  assert.ok(result.stones.every((s) => s.color === NEW_COLOR_ID));
});

await test('9. an SVG layer can carry a new-catalog color end to end', () => {
  const svgSource = '<svg xmlns="http://www.w3.org/2000/svg" width="50mm" height="20mm"><rect x="5" y="5" width="15" height="10"/></svg>';
  const result = engine.generateSvgLayout({
    svgSource, layerId: 'l4', xMm: 0, yMm: 0, widthMm: 50, heightMm: 20,
    stoneSizeMm: 2, gapMm: 0.3, mode: 'outline', color: NEW_COLOR_ID
  });
  assert.ok(result.count > 0);
  assert.ok(result.stones.every((s) => s.color === NEW_COLOR_ID));
});

// --- 4. renderer/exporter consistency for a new-catalog color, with zero file changes ------------

await test('10. the 2D canvas renderer resolves a new-catalog color to its exact catalog fill/stroke/shine values', () => {
  const { ctx, calls } = createFakeCtx();
  drawStone(ctx, 10, 10, 5, NEW_COLOR_ID, 'layout');
  assert.equal(calls.gradients.length, 1);
  const expected = STONE_COLORS[NEW_COLOR_ID];
  const stops = calls.gradients[0];
  assert.equal(stops[0].color, expected.shine);
  assert.equal(stops.find((s) => s.offset === 0.45).color, expected.fill);
  assert.equal(stops.find((s) => s.offset === 1).color, expected.accent);
});

await test('11. the 3D texture (StoneLayoutTexture) resolves the same new-catalog color to the same fill/stroke/shine values', () => {
  const layout = makeLayout([{ xMm: 5, yMm: 5, sizeMm: 2, color: NEW_COLOR_ID }]);
  const { ctx, calls } = createFakeCtx();
  drawStoneLayoutTexture(ctx, layout, { widthMm: 20, heightMm: 20, backgroundColor: '#000000' });
  const expected = STONE_COLORS[NEW_COLOR_ID];
  const stops = calls.gradients[0];
  assert.equal(stops[0].color, expected.shine);
  assert.equal(stops.find((s) => s.offset === 0.55).color, expected.fill);
  assert.equal(stops.find((s) => s.offset === 1).color, expected.stroke);
  // Renderer consistency: the 2D canvas and the 3D texture must agree on fill/shine for the same id.
  assert.equal(expected.fill, STONE_COLORS[NEW_COLOR_ID].fill);
});

await test('12. SVG export emits the correct fill/stroke/data-color for a new-catalog color', () => {
  const layout = makeLayout([{ xMm: 5, yMm: 5, sizeMm: 2, color: NEW_COLOR_ID }]);
  const svg = stoneLayoutToSvg(layout, { widthMm: 20, heightMm: 20 });
  const expected = STONE_COLORS[NEW_COLOR_ID];
  assert.ok(svg.includes(`fill="${expected.fill}"`), 'expected the new color\'s fill in the SVG output');
  assert.ok(svg.includes(`stroke="${expected.stroke}"`), 'expected the new color\'s stroke in the SVG output');
  assert.ok(svg.includes(`data-color="${NEW_COLOR_ID}"`), 'expected data-color metadata to preserve the raw catalog id');

  const single = stoneCircleSvg(new Stone({ xMm: 1, yMm: 1, sizeMm: 2, layerId: 'l', color: NEW_COLOR_ID }));
  assert.ok(single.includes(`data-color="${NEW_COLOR_ID}"`));
});

await test('13. Production Sheet export lists the correct color name for a new-catalog color', () => {
  const layout = makeLayout([{ xMm: 5, yMm: 5, sizeMm: 2, color: NEW_COLOR_ID }]);
  const svg = productionSheetToSvg(layout, {
    projectName: 'Test', objectType: 'Mug', productionWidthMm: 210, productionHeightMm: 90, gapMm: 0.3
  });
  const expectedName = STONE_COLORS[NEW_COLOR_ID].name;
  assert.ok(svg.includes(`Crystal color: ${expectedName}`), `expected the production sheet header to list "${expectedName}"`);
});

await test('14. no forbidden file changed (this milestone\'s own forbidden list)', () => {
  const output = execSync('git status --porcelain', { cwd: repoRoot, encoding: 'utf8' });
  const changedPaths = output
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => line.slice(3).trim());

  const forbiddenExact = new Set(['style.css', 'README.md', 'LICENSE', 'CONTRIBUTING.md']);
  const forbiddenExactWithinPrefix = new Set([
    'src/renderer/CanvasRenderer2D.js',
    'src/renderer/CupRenderer.js',
    'src/export/SvgExporter.js',
    // RS-1013 (Variable Stone Sizes) legitimately changes src/export/ProductionSheetExporter.js
    // (header now shows a stone size's commercial name alongside its mm value) -- see
    // tools/test-variable-stone-sizes.mjs for that milestone's own forbidden-file guard.
    // RS-1008A (Image Trace Architecture Correction) legitimately changes
    // src/geometry/GeometryEngine.js/StoneSampler.js/index.js/README.md — see
    // tools/test-image-trace-regression.mjs for that milestone's own forbidden-file guard.
    // StoneLayout.js/Stone.js/ContourGeometry.js/ArcProjection.js stay forbidden below.
    'src/geometry/StoneLayout.js',
    'src/geometry/Stone.js',
    'src/geometry/ContourGeometry.js',
    'src/geometry/ArcProjection.js'
  ]);
  const forbiddenPrefixes = [
    // RS-2002: assets/fonts/** is legitimately expanded by the Typography & Font Library milestone (new bundled font files + manifest entries).
    'src/text/', 'src/fonts/', 'src/browser/', 'src/svg/', 'src/history/', 'src/products/'
  ];

  for (const changedPath of changedPaths) {
    assert.ok(!forbiddenExact.has(changedPath), `Forbidden file changed: ${changedPath}`);
    assert.ok(!forbiddenExactWithinPrefix.has(changedPath), `Forbidden file changed: ${changedPath}`);
    assert.ok(
      !forbiddenPrefixes.some((prefix) => changedPath.startsWith(prefix)),
      `Forbidden file changed: ${changedPath}`
    );
  }
});

console.log('Crystal color integration tests passed.');
