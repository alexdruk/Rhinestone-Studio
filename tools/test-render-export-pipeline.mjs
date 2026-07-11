import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// RS-0003.5C2 — verifies the 2D canvas renderer, cup renderer, and SVG exporter extracted out of
// app.js consume only StoneLayout (never a layer type or project.layers), and that app.js is
// actually wired to call them instead of containing inline stone-drawing/SVG-string logic. The
// renderer/exporter behavioral checks use a minimal fake CanvasRenderingContext2D (records arc()
// calls, no-ops everything else) so they run under plain Node, no browser required.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const { drawStone, fitTransform, drawGrid, renderStoneLayout, renderProductionLayout } =
  await import('../src/renderer/CanvasRenderer2D.js');
const { renderCup } = await import('../src/renderer/CupRenderer.js');
const { stoneLayoutToSvg } = await import('../src/export/SvgExporter.js');
const { Stone } = await import('../src/geometry/Stone.js');
const { StoneLayout } = await import('../src/geometry/StoneLayout.js');

const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');
const canvasRenderer2DSource = await readFile(path.join(repoRoot, 'src/renderer/CanvasRenderer2D.js'), 'utf8');
const cupRendererSource = await readFile(path.join(repoRoot, 'src/renderer/CupRenderer.js'), 'utf8');
const svgExporterSource = await readFile(path.join(repoRoot, 'src/export/SvgExporter.js'), 'utf8');

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

function createFakeCtx() {
  const arcCalls = [];
  const target = {
    arc(x, y, r) { arcCalls.push({ x, y, r }); },
    createRadialGradient() { return { addColorStop() {} }; },
    createLinearGradient() { return { addColorStop() {} }; }
  };
  const ctx = new Proxy(target, {
    get(obj, prop) {
      if (prop in obj) return obj[prop];
      return () => {};
    },
    set(obj, prop, value) {
      obj[prop] = value;
      return true;
    }
  });
  return { ctx, arcCalls };
}

function makeLayout(stoneParams, layerId = 'layer-1') {
  const stones = stoneParams.map((p, index) => new Stone({ layerId, index, ...p }));
  return new StoneLayout({ layerId, stones });
}

await test('1. CanvasRenderer2D exports drawStone, fitTransform, drawGrid, renderStoneLayout, renderProductionLayout', () => {
  assert.equal(typeof drawStone, 'function');
  assert.equal(typeof fitTransform, 'function');
  assert.equal(typeof drawGrid, 'function');
  assert.equal(typeof renderStoneLayout, 'function');
  assert.equal(typeof renderProductionLayout, 'function');
});

await test('2. CupRenderer exports renderCup', () => {
  assert.equal(typeof renderCup, 'function');
});

await test('3. SvgExporter exports stoneLayoutToSvg', () => {
  assert.equal(typeof stoneLayoutToSvg, 'function');
});

await test('4. renderStoneLayout draws every stone at the transformed pixel position', () => {
  const layout = makeLayout([
    { xMm: 10, yMm: 5, sizeMm: 2, color: 'gold' },
    { xMm: -3, yMm: 7, sizeMm: 4, color: 'jet' }
  ]);
  const transform = { s: 2, ox: 10, oy: 20 };
  const { ctx, arcCalls } = createFakeCtx();
  renderStoneLayout(ctx, layout, transform);
  assert.equal(arcCalls.length, 2, 'expected exactly one arc() draw per stone');
  assert.deepEqual(arcCalls[0], { x: 10 + 10 * 2, y: 20 + 5 * 2, r: Math.max(2, 2 * 2 / 2) });
  assert.deepEqual(arcCalls[1], { x: 10 + -3 * 2, y: 20 + 7 * 2, r: Math.max(2, 4 * 2 / 2) });
});

await test('5. fitTransform computes the expected scale and offset for a known bounding box', () => {
  const boundingBoxMm = { minXmm: 0, minYmm: 0, widthMm: 100, heightMm: 50 };
  const { s, ox, oy } = fitTransform(boundingBoxMm, 400, 300, 20);
  const viewWidthMm = Math.max(70, 100 + 24);
  const viewHeightMm = Math.max(45, 50 + 24);
  const expectedS = Math.min((400 - 40) / viewWidthMm, (300 - 40) / viewHeightMm);
  assert.equal(s, expectedS);
  assert.equal(ox, 400 / 2 - (0 + 100 / 2) * expectedS);
  assert.equal(oy, 300 / 2 - (0 + 50 / 2) * expectedS);
});

await test('6. renderCup runs without throwing for "front" and every wrapped mode, and draws one stone per input in "front" mode', () => {
  const layout = makeLayout([
    { xMm: 0, yMm: 0, sizeMm: 2, color: 'gold' },
    { xMm: 10, yMm: 0, sizeMm: 2, color: 'gold' },
    { xMm: 20, yMm: 5, sizeMm: 2, color: 'silver' },
    { xMm: -10, yMm: -5, sizeMm: 2, color: 'jet' },
    { xMm: 5, yMm: 8, sizeMm: 2, color: 'rose' }
  ]);
  const baseOptions = { widthPx: 500, heightPx: 400, dpr: 1, cupColor: '#1f3556', rotationDeg: 0, zoom: 1 };

  const { ctx: frontCtx, arcCalls: frontArcs } = createFakeCtx();
  renderCup(frontCtx, layout, { ...baseOptions, wrap: 'front' });
  assert.equal(frontArcs.length, layout.count, 'front wrap must draw exactly one stone-arc per input Stone (no culling)');

  for (const wrap of ['wide', 'half', 'full']) {
    const { ctx } = createFakeCtx();
    assert.doesNotThrow(() => renderCup(ctx, layout, { ...baseOptions, wrap }), `renderCup threw for wrap: ${wrap}`);
  }
});

await test('7. stoneLayoutToSvg produces a well-formed SVG with one <circle> per stone', () => {
  const layout = makeLayout([
    { xMm: 1.23456, yMm: 4.5, sizeMm: 2, color: 'gold' },
    { xMm: 9, yMm: 3, sizeMm: 3, color: 'sapphire' }
  ]);
  const svg = stoneLayoutToSvg(layout, { widthMm: 210, heightMm: 90 });
  assert.ok(svg.startsWith('<svg'), 'expected the SVG to start with <svg');
  assert.ok(svg.trim().endsWith('</svg>'), 'expected the SVG to end with </svg>');
  assert.ok(svg.includes('width="210mm"') && svg.includes('height="90mm"'), 'expected the canvas dimensions on the root element');
  const circleCount = (svg.match(/<circle\b/g) || []).length;
  assert.equal(circleCount, 2, 'expected exactly one <circle> per stone');
  assert.ok(svg.includes(`cx="${(1.23456).toFixed(3)}"`), 'expected the first stone\'s cx to be its xMm to 3 decimals');
  assert.ok(svg.includes(`r="${(2 / 2).toFixed(3)}"`), 'expected the first stone\'s r to be sizeMm/2 to 3 decimals');
});

await test('8. neither renderer nor the SVG exporter references a layer type or project.layers', () => {
  for (const [name, source] of [
    ['CanvasRenderer2D.js', canvasRenderer2DSource],
    ['CupRenderer.js', cupRendererSource],
    ['SvgExporter.js', svgExporterSource]
  ]) {
    assert.ok(!/project\.layers/.test(source), `${name} must not reference project.layers`);
    assert.ok(!/layer\.type|l\.type/.test(source), `${name} must not reference a layer's type`);
    assert.ok(!/['"](text|circle|rectangle)['"]/.test(source), `${name} must not reference a layer type literal`);
  }
});

await test('9. app.js imports the renderer/exporter modules and no longer contains the inline stone-drawing/SVG logic they replace', () => {
  assert.match(appJs, /import\s*\{\s*renderProductionLayout\s*\}\s*from\s*['"]\.\/src\/renderer\/CanvasRenderer2D\.js['"]/);
  assert.match(appJs, /import\s*\{\s*renderCup\s*\}\s*from\s*['"]\.\/src\/renderer\/CupRenderer\.js['"]/);
  assert.match(appJs, /import\s*\{\s*STONE_COLORS\s*\}\s*from\s*['"]\.\/src\/renderer\/StoneColors\.js['"]/);
  assert.match(appJs, /import\s*\{\s*stoneLayoutToSvg\s*\}\s*from\s*['"]\.\/src\/export\/SvgExporter\.js['"]/);

  assert.ok(!appJs.includes('function drawStone2D'), 'the inline drawStone2D primitive must be gone, not duplicated');
  assert.ok(!/function svg\s*\(/.test(appJs), 'the inline svg() SVG-string builder must be gone, not duplicated');
  assert.ok(!appJs.includes('layout.bbox'), 'the ad hoc layout.bbox accessor must be gone (StoneLayout uses getBoundingBox()/widthMm/heightMm)');
  assert.ok(!appJs.includes('layout.stats'), 'the ad hoc layout.stats accessor must be gone (StoneLayout uses .count)');

  assert.match(appJs, /new StoneLayout\(/, "generate() must construct a real StoneLayout");
  assert.match(appJs, /renderProductionLayout\(ctx,layout,/, 'drawLayout() must call renderProductionLayout with the generated layout');
  assert.match(appJs, /renderCup\(ctx,layout,/, 'drawCup() must call renderCup with the generated layout');
  assert.match(appJs, /stoneLayoutToSvg\(layout,/, 'the SVG export button must call stoneLayoutToSvg with the generated layout');
});

await test('10. no forbidden file changed', () => {
  const output = execSync('git status --porcelain', { cwd: repoRoot, encoding: 'utf8' });
  const changedPaths = output
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => line.slice(3).trim());

  // index.html is legitimately changed by RS-0003.5D1 (Project JSON import UI) and RS-1001 (SVG
  // import UI). src/geometry/ is legitimately changed by RS-1001 (generateSvgLayout()); see the
  // forbiddenPrefixes exception below for the documentation-only precedent this replaces.
  const forbiddenExact = new Set(['style.css', 'README.md', 'LICENSE', 'CONTRIBUTING.md']);
  const allowedDespitePrefix = new Set(['src/geometry/README.md']);
  const forbiddenPrefixes = [
    'src/text/',
    'src/fonts/',
    'src/core/',
    'src/browser/',
    'assets/'
  ];

  for (const changedPath of changedPaths) {
    assert.ok(!forbiddenExact.has(changedPath), `Forbidden file changed: ${changedPath}`);
    assert.ok(
      allowedDespitePrefix.has(changedPath) ||
      !forbiddenPrefixes.some((prefix) => changedPath.startsWith(prefix)),
      `Forbidden file changed: ${changedPath}`
    );
  }
});

console.log('Render/export pipeline tests passed.');
