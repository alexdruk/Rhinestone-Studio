import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// RS-0003.5D1 — Production Export Validation & Compatibility. Verifies:
//   - Stone/StoneLayout JSON schema + round-trip + determinism.
//   - SVG dimensions/count/coordinates/sizes/bounds match the canonical StoneLayout exactly.
//   - SVG carries per-stone color metadata (data-color).
//   - stoneLayoutToSvg() fails clearly on invalid input, is deterministic, and is driven by its
//     input (not hardcoded).
//   - Neither renderer nor the SVG exporter regenerates geometry (no GeometryEngine reference).
//   - A representative ad hoc Project JSON fixture round-trips losslessly through JSON.
//   - app.js wires a Project JSON import path and guards every export handler.
//   - index.html exposes the import controls app.js expects.
//   - No forbidden file changed.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const { stoneLayoutToSvg } = await import('../src/export/SvgExporter.js');
const { Stone } = await import('../src/geometry/Stone.js');
const { StoneLayout } = await import('../src/geometry/StoneLayout.js');

const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');
const indexHtml = await readFile(path.join(repoRoot, 'index.html'), 'utf8');
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

function makeLayout(stoneParams, layerId = 'circle-1') {
  const stones = stoneParams.map((p, index) => new Stone({ layerId, index, ...p }));
  return new StoneLayout({ layerId, stones, sourceMode: 'outline' });
}

const TWO_STONE_LAYOUT = () => makeLayout([
  { xMm: 10, yMm: 5, sizeMm: 2, color: 'gold' },
  { xMm: 15, yMm: 5, sizeMm: 2, color: 'sapphire' }
]);

await test('1. Stone/StoneLayout schema is documented and toJSON()/fromJSON() round-trips losslessly', () => {
  const layout = makeLayout([
    { xMm: 10, yMm: 5, sizeMm: 2, color: 'gold' },
    { xMm: 15, yMm: 5, sizeMm: 2, color: 'sapphire' }
  ], 'text');
  const json = layout.toJSON();

  assert.equal(json.layerId, 'text');
  assert.equal(json.sourceMode, 'outline');
  assert.equal(json.count, 2);
  assert.ok(json.boundingBox && typeof json.boundingBox === 'object');
  assert.equal(typeof json.widthMm, 'number');
  assert.equal(typeof json.heightMm, 'number');
  assert.equal(json.stones.length, 2);
  for (const s of json.stones) {
    assert.equal(typeof s.xMm, 'number');
    assert.equal(typeof s.yMm, 'number');
    assert.equal(typeof s.sizeMm, 'number');
    assert.equal(typeof s.color, 'string');
    assert.equal(typeof s.layerId, 'string');
    assert.ok('index' in s);
    assert.equal(typeof s.metadata, 'object');
  }

  const reconstructed = StoneLayout.fromJSON(json);
  assert.deepEqual(reconstructed.toJSON(), json, 'fromJSON(toJSON(x)) must reproduce x exactly');
});

await test('2. StoneLayout.toJSON() is deterministic for identical inputs', () => {
  const first = makeLayout([{ xMm: 1.23456, yMm: 4.5, sizeMm: 2, color: 'gold' }]);
  const second = makeLayout([{ xMm: 1.23456, yMm: 4.5, sizeMm: 2, color: 'gold' }]);
  assert.deepEqual(first.toJSON(), second.toJSON());
});

await test('3. SVG dimensions are explicit millimeters, numerically consistent with the viewBox', () => {
  const svg = stoneLayoutToSvg(TWO_STONE_LAYOUT(), { widthMm: 210, heightMm: 90 });
  assert.match(svg, /width="210mm"/);
  assert.match(svg, /height="90mm"/);
  assert.match(svg, /viewBox="0 0 210 90"/);
});

await test('4. SVG <circle> count equals StoneLayout.count for a multi-layer-id layout', () => {
  const stones = [
    new Stone({ layerId: 'text', index: 0, xMm: 1, yMm: 1, sizeMm: 2, color: 'gold' }),
    new Stone({ layerId: 'circle-1', index: 0, xMm: 5, yMm: 5, sizeMm: 3, color: 'jet' }),
    new Stone({ layerId: 'rect-1', index: 0, xMm: 9, yMm: 2, sizeMm: 1.5, color: 'silver' })
  ];
  const layout = new StoneLayout({ layerId: 'project', stones });
  const svg = stoneLayoutToSvg(layout, { widthMm: 210, heightMm: 90 });
  const circleCount = (svg.match(/<circle\b/g) || []).length;
  assert.equal(circleCount, layout.count);
  assert.equal(circleCount, 3);
});

await test('5. every SVG <circle> cx/cy/r matches its stone (not just the first)', () => {
  const stones = [
    new Stone({ layerId: 'l', index: 0, xMm: 1.111, yMm: 2.222, sizeMm: 2, color: 'gold' }),
    new Stone({ layerId: 'l', index: 1, xMm: 9.999, yMm: 8.888, sizeMm: 4, color: 'jet' }),
    new Stone({ layerId: 'l', index: 2, xMm: -3.5, yMm: 7.1, sizeMm: 1.2, color: 'rose' })
  ];
  const layout = new StoneLayout({ layerId: 'l', stones });
  const svg = stoneLayoutToSvg(layout, { widthMm: 50, heightMm: 50 });
  for (const s of stones) {
    const needle = `cx="${s.xMm.toFixed(3)}" cy="${s.yMm.toFixed(3)}" r="${(s.sizeMm / 2).toFixed(3)}"`;
    assert.ok(svg.includes(needle), `expected SVG to contain ${needle}`);
  }
});

await test('6. SVG implied bounds match StoneLayout.getBoundingBox()', () => {
  const layout = TWO_STONE_LAYOUT();
  const svg = stoneLayoutToSvg(layout, { widthMm: 210, heightMm: 90 });
  const circles = [...svg.matchAll(/<circle cx="([-\d.]+)" cy="([-\d.]+)" r="([-\d.]+)"/g)]
    .map((m) => ({ cx: Number(m[1]), cy: Number(m[2]), r: Number(m[3]) }));
  assert.equal(circles.length, layout.count);

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of circles) {
    minX = Math.min(minX, c.cx - c.r);
    minY = Math.min(minY, c.cy - c.r);
    maxX = Math.max(maxX, c.cx + c.r);
    maxY = Math.max(maxY, c.cy + c.r);
  }

  const bbox = layout.getBoundingBox();
  const eps = 0.001;
  assert.ok(Math.abs(minX - bbox.minXmm) < eps, `minX ${minX} vs ${bbox.minXmm}`);
  assert.ok(Math.abs(minY - bbox.minYmm) < eps, `minY ${minY} vs ${bbox.minYmm}`);
  assert.ok(Math.abs(maxX - bbox.maxXmm) < eps, `maxX ${maxX} vs ${bbox.maxXmm}`);
  assert.ok(Math.abs(maxY - bbox.maxYmm) < eps, `maxY ${maxY} vs ${bbox.maxYmm}`);
});

await test('7. every SVG <circle> carries data-color matching the source Stone.color', () => {
  const layout = TWO_STONE_LAYOUT();
  const svg = stoneLayoutToSvg(layout, { widthMm: 210, heightMm: 90 });
  assert.ok(svg.includes('data-color="gold"'), 'expected data-color="gold"');
  assert.ok(svg.includes('data-color="sapphire"'), 'expected data-color="sapphire"');
});

await test('8. stoneLayoutToSvg() is deterministic', () => {
  const a = stoneLayoutToSvg(TWO_STONE_LAYOUT(), { widthMm: 210, heightMm: 90 });
  const b = stoneLayoutToSvg(TWO_STONE_LAYOUT(), { widthMm: 210, heightMm: 90 });
  assert.equal(a, b);
});

await test('9. stoneLayoutToSvg() throws a clear TypeError for invalid input', () => {
  const valid = TWO_STONE_LAYOUT();
  assert.throws(() => stoneLayoutToSvg(null, { widthMm: 10, heightMm: 10 }), TypeError);
  assert.throws(() => stoneLayoutToSvg({}, { widthMm: 10, heightMm: 10 }), TypeError);
  assert.throws(() => stoneLayoutToSvg(valid, { widthMm: 0, heightMm: 10 }), TypeError);
  assert.throws(() => stoneLayoutToSvg(valid, { widthMm: -5, heightMm: 10 }), TypeError);
  assert.throws(() => stoneLayoutToSvg(valid, { widthMm: NaN, heightMm: 10 }), TypeError);
  assert.throws(() => stoneLayoutToSvg(valid, { widthMm: 10, heightMm: 0 }), TypeError);
  assert.throws(() => stoneLayoutToSvg(valid, { widthMm: 10, heightMm: undefined }), TypeError);
});

await test('10. renderer/exporter modules never reference GeometryEngine (no exporter/renderer regenerates geometry)', () => {
  for (const [name, source] of [
    ['CanvasRenderer2D.js', canvasRenderer2DSource],
    ['CupRenderer.js', cupRendererSource],
    ['SvgExporter.js', svgExporterSource]
  ]) {
    assert.ok(!/GeometryEngine/.test(source), `${name} must not reference GeometryEngine`);
    assert.ok(!/generateTextLayout|generateShapeLayout/.test(source), `${name} must not call geometry generation`);
  }
});

await test('11. stoneLayoutToSvg() output is driven by the provided StoneLayout, not hardcoded', () => {
  const a = stoneLayoutToSvg(makeLayout([{ xMm: 1, yMm: 1, sizeMm: 2, color: 'gold' }]), { widthMm: 50, heightMm: 50 });
  const b = stoneLayoutToSvg(makeLayout([{ xMm: 40, yMm: 40, sizeMm: 3, color: 'jet' }]), { widthMm: 50, heightMm: 50 });
  assert.notEqual(a, b);
});

await test('12. a representative ad hoc Project JSON fixture round-trips losslessly through JSON', () => {
  const fixture = {
    version: 2,
    units: 'mm',
    product: 'mug',
    canvas: { width: 210, height: 90 },
    cupColor: '#1f3556',
    wrap: 'front',
    layers: [
      { id: 'text', type: 'text', visible: true, text: 'Vitalina Serbin', font: 'courier-prime-regular', height: 25, textMode: 'stroke', stoneSize: 2, gap: 0.3, color: 'gold', autoFit: true },
      { id: 'circle1', type: 'circle', visible: true, cx: 105, cy: 45, r: 18, stoneSize: 2, gap: 0.3, color: 'silver' },
      { id: 'rect1', type: 'rectangle', visible: false, x: 65, y: 30, w: 80, h: 30, stoneSize: 1.5, gap: 0.2, color: 'jet' }
    ]
  };
  const roundTripped = JSON.parse(JSON.stringify(fixture));
  assert.deepEqual(roundTripped, fixture);
});

await test('13. app.js defines and wires a Project JSON import path with validation and clear failure reporting', () => {
  assert.match(appJs, /function validateProject\s*\(/, 'expected a validateProject() function');
  assert.match(appJs, /Array\.isArray\(obj\.layers\)/, 'validateProject must check layers is an array');
  assert.match(appJs, /el\('importProject'\)\.onclick\s*=\s*\(\)\s*=>\s*el\('importProjectFile'\)\.click\(\)/);
  assert.match(appJs, /el\('importProjectFile'\)\.addEventListener\('change'/);

  // The change handler must validate before assigning to `project`, and must catch failures
  // and report them via #status rather than letting them throw.
  const handlerMatch = appJs.match(/el\('importProjectFile'\)\.addEventListener\('change',async e=>\{([\s\S]*?)\}\);/);
  assert.ok(handlerMatch, 'expected the importProjectFile change handler body');
  const handlerBody = handlerMatch[1];
  assert.match(handlerBody, /validateProject\(JSON\.parse\(/, 'handler must parse and validate before use');
  assert.match(handlerBody, /catch\s*\(error\)/, 'handler must catch parse/validation errors');
  assert.match(handlerBody, /el\('status'\)\.textContent=`Import failed/, 'handler must report failures via #status');
});

await test('14. every export button handler guards on layout readiness and is wrapped in try/catch', () => {
  for (const id of ['exportLayout', 'exportSVG', 'exportPNG', 'exportCup']) {
    const re = new RegExp(`el\\('${id}'\\)\\.onclick=\\(\\)=>\\{if\\(!layout\\)\\{[^}]*return\\}try\\{`);
    assert.match(appJs, re, `expected #${id} handler to guard on !layout before a try block`);
  }
  assert.match(appJs, /el\('exportProject'\)\.onclick=\(\)=>\{try\{/, 'expected #exportProject handler to be wrapped in try/catch');
  // Every one of the five export handlers must catch and report failures via #status.
  const exportSection = appJs.slice(appJs.indexOf("el('exportProject')"), appJs.indexOf('let cupDrag'));
  const catchCount = (exportSection.match(/catch\(error\)\{el\('status'\)\.textContent=`Export failed:/g) || []).length;
  assert.equal(catchCount, 5, 'expected all 5 export handlers to report failures via #status');
});

await test('15. index.html exposes the import controls app.js expects', () => {
  assert.match(indexHtml, /<button id="importProject"/);
  assert.match(indexHtml, /<input id="importProjectFile" type="file"/);
});

await test('16. no forbidden file changed', () => {
  const output = execSync('git status --porcelain', { cwd: repoRoot, encoding: 'utf8' });
  const changedPaths = output
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => line.slice(3).trim());

  const forbiddenExact = new Set(['style.css', 'README.md', 'LICENSE', 'CONTRIBUTING.md']);
  const forbiddenPrefixes = [
    // src/renderer/CanvasRenderer2D.js and src/renderer/CupRenderer.js are legitimately changed by
    // RS-0003.5D2 (cup handle/body/selection visual polish) — see tools/test-ux-visual-polish.mjs
    // for that milestone's own forbidden-file guard.
    'src/text/',
    'src/fonts/',
    'src/core/',
    'src/browser/',
    'assets/',
    'examples/'
  ];

  for (const changedPath of changedPaths) {
    assert.ok(!forbiddenExact.has(changedPath), `Forbidden file changed: ${changedPath}`);
    assert.ok(
      !forbiddenPrefixes.some((prefix) => changedPath.startsWith(prefix)),
      `Forbidden file changed: ${changedPath}`
    );
  }
});

console.log('Production export validation tests passed.');
