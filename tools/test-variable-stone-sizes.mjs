import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FontManager } from '../src/fonts/index.js';
import { createDefaultFontProviderRegistry } from '../src/text/index.js';
import { GeometryEngine, Stone, StoneLayout } from '../src/geometry/index.js';
import { createImageBuffer } from '../src/image/index.js';
import { computeProductionSheetLayout, productionSheetToSvg } from '../src/export/ProductionSheetExporter.js';
import { stoneLayoutToSvg } from '../src/export/SvgExporter.js';
import { STONE_SIZES } from '../src/renderer/StoneSizes.js';

// RS-1013 — Variable Stone Sizes. End-to-end proof that every supported layer type honors its own
// independent stoneSizeMm, that mixing sizes across layers in one project works with zero special
// casing anywhere, and that the Stone Library catalog is actually wired into the #stoneSize picker
// and the Production Sheet — not just present as an unused module. Structural checks against
// app.js/index.html follow the existing convention (app.js is a browser entry point, not
// import()-able under plain Node) established by tools/test-svg-integration.mjs et al.; geometry-
// level checks call the real, unmodified permanent GeometryEngine directly, exactly like
// tools/test-shape-geometry-integration.mjs / test-svg-integration.mjs / test-curved-text-integration.mjs.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');
const indexHtml = await readFile(path.join(repoRoot, 'index.html'), 'utf8');

const manifest = JSON.parse(await readFile(path.join(repoRoot, 'assets/fonts/manifest.json'), 'utf8'));
const fontManager = new FontManager(manifest);

async function loadFontBufferFromRepoRoot(relativePath) {
  const buffer = await readFile(path.join(repoRoot, relativePath));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function createEngine() {
  const fontProviderRegistry = createDefaultFontProviderRegistry(fontManager, {
    loadFontBuffer: loadFontBufferFromRepoRoot
  });
  return new GeometryEngine({ fontProviderRegistry });
}

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

const SVG_FIXTURE = '<svg xmlns="http://www.w3.org/2000/svg" width="20mm" height="20mm"><rect x="0" y="0" width="20" height="20"/></svg>';

function checkerboardImageBuffer(sizePx = 8) {
  const data = new Uint8ClampedArray(sizePx * sizePx * 4);
  for (let y = 0; y < sizePx; y++) {
    for (let x = 0; x < sizePx; x++) {
      const on = (x + y) % 2 === 0;
      const i = (y * sizePx + x) * 4;
      const v = on ? 0 : 255; // dark pixels trace under the default threshold
      data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
    }
  }
  return createImageBuffer({ widthPx: sizePx, heightPx: sizePx, data });
}

await test('1. every catalog stone size produces geometry whose stones carry exactly that sizeMm (rectangle, outline mode)', () => {
  const engine = createEngine();
  for (const size of STONE_SIZES) {
    const layout = engine.generateShapeLayout({
      shape: 'rectangle', layerId: `rect-${size.id}`, xMm: 0, yMm: 0, widthMm: 40, heightMm: 20,
      stoneSizeMm: size.diameterMm, gapMm: 0.3, mode: 'outline'
    });
    assert.ok(layout.count > 0, `expected stones for ${size.name}`);
    for (const stone of layout.stones) assert.equal(stone.sizeMm, size.diameterMm, `${size.name} stone sizeMm mismatch`);
  }
});

await test('2. mixed per-layer stone sizes: text, curved text, circle, rectangle, svg, image, and path layers each keep their own independent stoneSizeMm in one combined layout', async () => {
  const engine = createEngine();

  const straightText = await engine.generateTextLayout({
    text: 'Hi', fontId: 'courier-prime-regular', layerId: 'text-1', heightMm: 10,
    stoneSizeMm: 2.0, gapMm: 0.3, mode: 'outline'
  });
  const curvedText = await engine.generateTextLayout({
    text: 'Hi', fontId: 'courier-prime-regular', layerId: 'text-curved', heightMm: 10,
    stoneSizeMm: 2.8, gapMm: 0.3, mode: 'outline',
    curveEnabled: true, curveRadiusMm: 40, curveDirection: 'outside', curveStartAngleDeg: 0, curveSweepAngleDeg: 90, curveAlignment: 'center'
  });
  const circle = engine.generateShapeLayout({ shape: 'circle', layerId: 'circle-1', cxMm: 20, cyMm: 20, radiusMm: 10, stoneSizeMm: 4.0, gapMm: 0.3, mode: 'outline' });
  const rectangle = engine.generateShapeLayout({ shape: 'rectangle', layerId: 'rect-1', xMm: 0, yMm: 0, widthMm: 30, heightMm: 15, stoneSizeMm: 4.7, gapMm: 0.3, mode: 'outline' });
  const svg = engine.generateSvgLayout({ svgSource: SVG_FIXTURE, layerId: 'svg-1', widthMm: 25, heightMm: 25, stoneSizeMm: 6.4, gapMm: 0.3, mode: 'outline' });
  const image = engine.generateImageLayout({
    imageBuffer: checkerboardImageBuffer(), layerId: 'image-1', xMm: 0, yMm: 0, widthMm: 20, heightMm: 20,
    stoneSizeMm: 1.5, gapMm: 0.2, maxWidthPx: 64, maxHeightPx: 64
  });
  const pathContours = [[{ xMm: 0, yMm: 0 }, { xMm: 10, yMm: 0 }, { xMm: 10, yMm: 10 }, { xMm: 0, yMm: 10 }]];
  const pathLayer = engine.generatePathLayout({ contours: pathContours, layerId: 'path-1', stoneSizeMm: 3.3, gapMm: 0.3, mode: 'outline' });

  const layers = { straightText, curvedText, circle, rectangle, svg, image, pathLayer };
  const expected = { straightText: 2.0, curvedText: 2.8, circle: 4.0, rectangle: 4.7, svg: 6.4, image: 1.5, pathLayer: 3.3 };

  for (const [key, layout] of Object.entries(layers)) {
    assert.ok(layout.count > 0, `expected stones for ${key}`);
    for (const stone of layout.stones) assert.equal(stone.sizeMm, expected[key], `${key} stone sizeMm mismatch`);
  }

  // Combined into one project-level layout (what app.js's GeometryEngine wrapper's dedupe/merge
  // step ultimately produces), every distinct size must still be present and attributable to the
  // right layerId -- proving mixing sizes across layers needs no per-size special case anywhere.
  const allStones = Object.values(layers).flatMap((l) => l.stones);
  const sizesByLayer = new Map(allStones.map((s) => [s.layerId, s.sizeMm]));
  for (const [key, layout] of Object.entries(layers)) {
    const layerId = layout.layerId;
    assert.equal(sizesByLayer.get(layerId), expected[key]);
  }
  const distinctSizes = new Set(allStones.map((s) => s.sizeMm));
  assert.equal(distinctSizes.size, 7, 'expected all 7 distinct per-layer sizes to survive combination');
});

function mixedSizeLayout() {
  const stones = [
    new Stone({ xMm: 0, yMm: 0, sizeMm: 2.0, layerId: 'a', color: 'gold' }),   // SS6
    new Stone({ xMm: 5, yMm: 0, sizeMm: 4.0, layerId: 'b', color: 'gold' }),   // SS16
    new Stone({ xMm: 10, yMm: 0, sizeMm: 1.5, layerId: 'c', color: 'gold' })   // custom, no catalog match
  ];
  return new StoneLayout({ layerId: 'project', stones });
}

await test('3. Production Sheet header shows the commercial name alongside mm for catalog sizes, and plain mm for a custom size', () => {
  const layout = computeProductionSheetLayout(mixedSizeLayout(), {
    projectName: 'Mixed Sizes', objectType: 'Mug', productionWidthMm: 100, productionHeightMm: 60,
    gapMm: 0.3, pageSize: 'A4', marginMm: 10
  });
  const sizeLine = layout.headerLines.find((l) => l.text.startsWith('Stone size:'));
  assert.ok(sizeLine, 'expected a Stone size header line');
  assert.equal(sizeLine.text, 'Stone size: 1.5 mm, SS6 (2 mm), SS16 (4 mm)');
});

await test('4. distinctSizesMm remains a plain sorted-ascending mm array (unchanged shape for existing consumers/tests)', () => {
  const layout = computeProductionSheetLayout(mixedSizeLayout(), {
    productionWidthMm: 100, productionHeightMm: 60
  });
  assert.deepEqual(layout.distinctSizesMm, [1.5, 2, 4]);
});

await test('5. Production Sheet SVG and stoneLayoutToSvg() both render every stone at its own individual radius (mixed sizes survive both exporters unchanged)', () => {
  const layout = mixedSizeLayout();
  const sheetSvg = productionSheetToSvg(layout, { productionWidthMm: 100, productionHeightMm: 60, gapMm: 0.3 });
  const layerSvg = stoneLayoutToSvg(layout, { widthMm: 50, heightMm: 20 });
  for (const stone of layout.stones) {
    const r = (stone.sizeMm / 2).toFixed(3);
    assert.ok(sheetSvg.includes(`r="${r}"`), `expected production sheet SVG to include a circle of radius ${r} for stone sizeMm ${stone.sizeMm}`);
    assert.ok(layerSvg.includes(`r="${r}"`), `expected layer SVG export to include a circle of radius ${r} for stone sizeMm ${stone.sizeMm}`);
  }
});

await test('6. app.js imports the Stone Library and populates #stoneSize from it at startup (no hardcoded <option> list left in index.html)', () => {
  // FONT-DECISION-001 (Studio Integration follow-up) widened this import with three more named
  // exports (stoneSizeHeightMidpointMm/isHeightWithinStoneSizeRange/stoneSizeEntirelyExceedsPrintableHeight)
  // -- matched loosely (listStoneSizes/findStoneSizeByDiameterMm present, somewhere before the closing
  // brace) rather than requiring an exact two-name list, so future additions to this import don't
  // require touching this milestone's own test.
  assert.match(appJs, /import\s*\{\s*listStoneSizes,\s*findStoneSizeByDiameterMm,[^}]*\}\s*from\s*['"]\.\/src\/renderer\/StoneSizes\.js['"]/);
  assert.match(appJs, /function populateStoneSizeOptions\(\)\{/, 'expected a populateStoneSizeOptions helper');
  // RS-2002 inserted its own conditional font-population startup call between
  // populateStoneSizeOptions() and syncSelectedControlsFromLayer() (see app.js) -- match loosely
  // across that gap rather than requiring the two calls immediately adjacent.
  assert.match(appJs, /populateStoneColorOptions\(\);populateStoneSizeOptions\(\);[\s\S]{0,600}?syncSelectedControlsFromLayer\(\)/, 'expected populateStoneSizeOptions to run once at startup, alongside populateStoneColorOptions');
  const stoneSizeSelectHtml = indexHtml.match(/<select id="stoneSize"[^>]*>([\s\S]*?)<\/select>/);
  assert.ok(stoneSizeSelectHtml, 'expected a #stoneSize select in index.html');
  assert.equal(stoneSizeSelectHtml[1].trim(), '', 'expected #stoneSize to start empty and be populated by populateStoneSizeOptions(), like #stoneColor');
});

await test('7. populateStoneSizeOptions(), executed against the real catalog, produces one option per catalog entry with both the commercial name and the mm value', async () => {
  const fnSource = appJs.match(/function populateStoneSizeOptions\(\)\{[\s\S]*?\n\}/)[0];
  const escapeHtmlSource = appJs.match(/function escapeHtml\([\s\S]*?\n\}/)[0];
  const { listStoneSizes } = await import('../src/renderer/StoneSizes.js');
  const mockSelect = { _html: '', set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html; } };
  // eslint-disable-next-line no-new-func
  const run = new Function('el', 'listStoneSizes', `${escapeHtmlSource}\n${fnSource}\npopulateStoneSizeOptions();`);
  run((id) => (id === 'stoneSize' ? mockSelect : null), listStoneSizes);
  const values = [...mockSelect._html.matchAll(/<option value="([^"]+)">([^<]+)<\/option>/g)];
  assert.equal(values.length, STONE_SIZES.length);
  const ss16 = values.find((m) => m[1] === '4');
  assert.ok(ss16, 'expected an option with value "4" for SS16');
  assert.equal(ss16[2], 'SS16 — 4.0 mm');
});

await test('8. ensureStoneSizeOption() injects a truthful "Custom" option for a legacy/non-catalog stoneSize, and injects nothing (beyond removing any stale custom option) for a catalog-exact value', async () => {
  const fnSource = appJs.match(/function ensureStoneSizeOption\(select,diameterMm\)\{[\s\S]*?\n\}/)[0];
  const { findStoneSizeByDiameterMm } = await import('../src/renderer/StoneSizes.js');

  function makeMockSelect(initialOptionValues) {
    const options = initialOptionValues.map((v) => ({ value: v, dataset: {}, remove() { options.splice(options.indexOf(this), 1); } }));
    return {
      options,
      querySelector(sel) {
        assert.equal(sel, 'option[data-custom="1"]');
        return options.find((o) => o.dataset.custom === '1') || null;
      },
      appendChild(opt) { opt.remove = () => options.splice(options.indexOf(opt), 1); options.push(opt); },
    };
  }
  // eslint-disable-next-line no-new-func
  const documentShim = { createElement: () => ({ dataset: {} }) };
  const run = new Function('findStoneSizeByDiameterMm', 'document', `return ${fnSource}`);
  const ensureStoneSizeOption = run(findStoneSizeByDiameterMm, documentShim);

  // Legacy value (1.5mm) not in the catalog -- a synthetic Custom option must appear.
  const select1 = makeMockSelect(['2', '2.8', '4', '4.7', '6.4']);
  ensureStoneSizeOption(select1, 1.5);
  const custom = select1.options.find((o) => o.dataset.custom === '1');
  assert.ok(custom, 'expected a synthetic Custom option for a non-catalog stoneSize');
  assert.equal(custom.value, '1.5');

  // Catalog-exact value (4mm, SS16) -- no Custom option should remain.
  ensureStoneSizeOption(select1, 4);
  assert.ok(!select1.options.some((o) => o.dataset.custom === '1'), 'expected no stale Custom option once the layer is back on a catalog size');

  // Re-selecting a different custom value must replace, not accumulate, the synthetic option.
  ensureStoneSizeOption(select1, 1.5);
  ensureStoneSizeOption(select1, 3.3);
  const customOptions = select1.options.filter((o) => o.dataset.custom === '1');
  assert.equal(customOptions.length, 1, 'expected exactly one synthetic Custom option, never accumulating stale ones');
  assert.equal(customOptions[0].value, '3.3');
});

await test('9. Stone Library-selected stoneSize round-trips through undo/redo, duplicate, and save/load exactly like every other tracked layer field (already-generic mechanisms, verified rather than reimplemented)', () => {
  assert.match(appJs, /const HISTORY_TRACKED_CONTROL_IDS=\[[^\]]*'stoneSize'/, 'expected stoneSize to remain a history-tracked control');
  // duplicateLayer() deep-clones the whole layer object (JSON.parse(JSON.stringify(l))) before any
  // per-type field nudging, so stoneSize (a plain field on every layer type) is carried over
  // automatically -- no per-type "copy stoneSize" line exists or is needed.
  assert.match(appJs, /function duplicateLayer\(id\)\{[\s\S]*?const copy=JSON\.parse\(JSON\.stringify\(l\)\)/, 'expected duplicateLayer to deep-clone the source layer (stoneSize included) before applying position nudges');
  // Save/load is JSON.stringify(project)/JSON.parse of the whole project -- again already generic,
  // stoneSize needs no dedicated (de)serialization path.
  assert.match(appJs, /JSON\.stringify\(project,null,2\)/, 'expected project export to be a plain JSON.stringify of the whole project (stoneSize included automatically)');
});

await test('10. new layers (add circle/add rectangle/SVG import/Image Trace import) inherit the currently selected layer\'s stoneSize, so a mixed-size project stays intentional rather than silently resetting to a default', () => {
  assert.match(appJs, /stoneSize:l\.stoneSize\|\|2/, 'expected addCircle/addRect to inherit the selected layer\'s stoneSize');
  assert.match(appJs, /stoneSize:base\.stoneSize\|\|2/, 'expected SVG import / Image Trace import to inherit the selected layer\'s stoneSize');
});
console.log('Variable stone size tests passed.');
