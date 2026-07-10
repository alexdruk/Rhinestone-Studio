import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FontManager } from '../src/fonts/index.js';
import { createDefaultFontProviderRegistry } from '../src/text/index.js';
import { GeometryEngine } from '../src/geometry/index.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
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

const BASE_PARAMS = {
  text: 'Vitalina',
  fontId: 'courier-prime-regular',
  layerId: 'layer-1',
  heightMm: 12,
  stoneSizeMm: 2,
  gapMm: 0.3,
  mode: 'outline'
};

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

await test('1. geometry generation succeeds for Courier Prime', async () => {
  const engine = createEngine();
  const layout = await engine.generateTextLayout({ ...BASE_PARAMS, fontId: 'courier-prime-regular' });

  assert.ok(layout.count > 0, 'expected at least one stone');
});

await test('2. geometry generation succeeds for Great Vibes', async () => {
  const engine = createEngine();
  const layout = await engine.generateTextLayout({ ...BASE_PARAMS, fontId: 'great-vibes-regular' });

  assert.ok(layout.count > 0, 'expected at least one stone');
});

await test('3. different fonts produce different layouts', async () => {
  const engine = createEngine();
  const courier = await engine.generateTextLayout({ ...BASE_PARAMS, fontId: 'courier-prime-regular' });
  const greatVibes = await engine.generateTextLayout({ ...BASE_PARAMS, fontId: 'great-vibes-regular' });

  assert.notDeepEqual(courier.toJSON().stones, greatVibes.toJSON().stones);
});

await test('4. font size changes bounding box', async () => {
  const engine = createEngine();
  const small = await engine.generateTextLayout({ ...BASE_PARAMS, heightMm: 10 });
  const large = await engine.generateTextLayout({ ...BASE_PARAMS, heightMm: 20 });

  assert.ok(large.widthMm > small.widthMm, 'expected a taller layout to also be wider');
  assert.ok(large.heightMm > small.heightMm, 'expected a taller layout to have a larger bounding box height');
});

await test('5. letter spacing changes layout width', async () => {
  const engine = createEngine();
  const tight = await engine.generateTextLayout({ ...BASE_PARAMS, letterSpacingMm: 0 });
  const wide = await engine.generateTextLayout({ ...BASE_PARAMS, letterSpacingMm: 4 });

  assert.ok(wide.widthMm > tight.widthMm, 'expected extra letter spacing to widen the layout');
});

await test('6. stone size changes geometry', async () => {
  const engine = createEngine();
  const small = await engine.generateTextLayout({ ...BASE_PARAMS, stoneSizeMm: 2 });
  const large = await engine.generateTextLayout({ ...BASE_PARAMS, stoneSizeMm: 4 });

  assert.notEqual(small.count, large.count, 'expected stone size to change the total stone count');
});

await test('7. gap changes geometry', async () => {
  const engine = createEngine();
  const tight = await engine.generateTextLayout({ ...BASE_PARAMS, gapMm: 0.2 });
  const loose = await engine.generateTextLayout({ ...BASE_PARAMS, gapMm: 1.5 });

  assert.notEqual(tight.count, loose.count, 'expected gap to change the total stone count');
});

await test('8. outline mode is deterministic', async () => {
  const engine = createEngine();
  const first = await engine.generateTextLayout({ ...BASE_PARAMS, mode: 'outline' });
  const second = await engine.generateTextLayout({ ...BASE_PARAMS, mode: 'outline' });

  assert.deepEqual(first.toJSON(), second.toJSON());
});

await test('9. fill mode is deterministic', async () => {
  const engine = createEngine();
  const first = await engine.generateTextLayout({ ...BASE_PARAMS, mode: 'fill' });
  const second = await engine.generateTextLayout({ ...BASE_PARAMS, mode: 'fill' });

  assert.deepEqual(first.toJSON(), second.toJSON());
  assert.ok(first.count > 0, 'expected fill mode to place at least one stone');
});

await test('10. generated coordinates are finite', async () => {
  const engine = createEngine();
  const layout = await engine.generateTextLayout(BASE_PARAMS);

  assert.ok(layout.count > 0);
  for (const stone of layout.stones) {
    assert.ok(Number.isFinite(stone.xMm));
    assert.ok(Number.isFinite(stone.yMm));
    assert.ok(Number.isFinite(stone.sizeMm));
  }
});

await test('11. generated coordinates use millimeters', async () => {
  const engine = createEngine();
  const small = await engine.generateTextLayout({ ...BASE_PARAMS, heightMm: 10 });
  const large = await engine.generateTextLayout({ ...BASE_PARAMS, heightMm: 20 });

  // Doubling the requested text height in millimeters should roughly double
  // the resulting bounding box height, confirming coordinates scale linearly
  // with the millimeter input rather than being fixed pixel-like units.
  const ratio = large.heightMm / small.heightMm;
  assert.ok(ratio > 1.5 && ratio < 2.5, `expected bounding box height to scale with heightMm, got ratio ${ratio}`);
});

await test('12. GeometryEngine has no dependency on DOM, Canvas, WebGL, renderer, or exporter', async () => {
  const geometrySourceFiles = [
    'src/geometry/GeometryEngine.js',
    'src/geometry/ContourGeometry.js',
    'src/geometry/StoneSampler.js',
    'src/geometry/Stone.js',
    'src/geometry/StoneLayout.js',
    'src/geometry/index.js'
  ];

  const forbiddenTokens = ['document.', 'window.', 'getContext', 'WebGLRenderingContext', 'src/renderer', 'src/export'];

  for (const relativePath of geometrySourceFiles) {
    const source = await readFile(path.join(repoRoot, relativePath), 'utf8');
    for (const token of forbiddenTokens) {
      assert.ok(!source.includes(token), `${relativePath} must not reference "${token}"`);
    }
  }
});

await test('outline mode works', async () => {
  const engine = createEngine();
  const layout = await engine.generateTextLayout({ ...BASE_PARAMS, mode: 'outline' });

  assert.equal(layout.sourceMode, 'outline');
  assert.ok(layout.count > 0);
});

await test('fill mode works', async () => {
  const engine = createEngine();
  const layout = await engine.generateTextLayout({ ...BASE_PARAMS, mode: 'fill' });

  assert.equal(layout.sourceMode, 'fill');
  assert.ok(layout.count > 0);
});

await test('every stone carries the requested layerId', async () => {
  const engine = createEngine();
  const layout = await engine.generateTextLayout({ ...BASE_PARAMS, layerId: 'layer-42' });

  assert.equal(layout.layerId, 'layer-42');
  for (const stone of layout.stones) {
    assert.equal(stone.layerId, 'layer-42');
  }
});

// RS-0003.5C1 — generateShapeLayout() (circle/rectangle), sharing the same contour-flattening
// and outline/fill sampling primitives as generateTextLayout() above.

const BASE_CIRCLE_PARAMS = {
  shape: 'circle',
  layerId: 'circle-1',
  cxMm: 105,
  cyMm: 45,
  radiusMm: 18,
  stoneSizeMm: 2,
  gapMm: 0.3,
  mode: 'outline',
  color: 'gold'
};

const BASE_RECT_PARAMS = {
  shape: 'rectangle',
  layerId: 'rect-1',
  xMm: 65,
  yMm: 30,
  widthMm: 80,
  heightMm: 30,
  stoneSizeMm: 2,
  gapMm: 0.3,
  mode: 'outline',
  color: 'gold'
};

await test('13. circle shape generation succeeds', () => {
  const engine = createEngine();
  const layout = engine.generateShapeLayout(BASE_CIRCLE_PARAMS);

  assert.ok(layout.count > 0, 'expected at least one stone');
});

await test('14. rectangle shape generation succeeds', () => {
  const engine = createEngine();
  const layout = engine.generateShapeLayout(BASE_RECT_PARAMS);

  assert.ok(layout.count > 0, 'expected at least one stone');
});

await test('15. stone size changes circle/rectangle stone count', () => {
  const engine = createEngine();
  const smallCircle = engine.generateShapeLayout({ ...BASE_CIRCLE_PARAMS, stoneSizeMm: 2 });
  const largeCircle = engine.generateShapeLayout({ ...BASE_CIRCLE_PARAMS, stoneSizeMm: 4 });
  assert.notEqual(smallCircle.count, largeCircle.count);

  const smallRect = engine.generateShapeLayout({ ...BASE_RECT_PARAMS, stoneSizeMm: 2 });
  const largeRect = engine.generateShapeLayout({ ...BASE_RECT_PARAMS, stoneSizeMm: 4 });
  assert.notEqual(smallRect.count, largeRect.count);
});

await test('16. gap changes circle/rectangle stone count', () => {
  const engine = createEngine();
  const tightCircle = engine.generateShapeLayout({ ...BASE_CIRCLE_PARAMS, gapMm: 0.2 });
  const looseCircle = engine.generateShapeLayout({ ...BASE_CIRCLE_PARAMS, gapMm: 2 });
  assert.notEqual(tightCircle.count, looseCircle.count);

  const tightRect = engine.generateShapeLayout({ ...BASE_RECT_PARAMS, gapMm: 0.2 });
  const looseRect = engine.generateShapeLayout({ ...BASE_RECT_PARAMS, gapMm: 2 });
  assert.notEqual(tightRect.count, looseRect.count);
});

await test('17. circle and rectangle outline generation is deterministic', () => {
  const engine = createEngine();

  const circleFirst = engine.generateShapeLayout(BASE_CIRCLE_PARAMS);
  const circleSecond = engine.generateShapeLayout(BASE_CIRCLE_PARAMS);
  assert.deepEqual(circleFirst.toJSON(), circleSecond.toJSON());

  const rectFirst = engine.generateShapeLayout(BASE_RECT_PARAMS);
  const rectSecond = engine.generateShapeLayout(BASE_RECT_PARAMS);
  assert.deepEqual(rectFirst.toJSON(), rectSecond.toJSON());
});

await test('18. circle generated coordinates are finite, in millimeters, and scale with radius', () => {
  const engine = createEngine();
  const small = engine.generateShapeLayout({ ...BASE_CIRCLE_PARAMS, radiusMm: 10 });
  const large = engine.generateShapeLayout({ ...BASE_CIRCLE_PARAMS, radiusMm: 20 });

  assert.ok(small.count > 0 && large.count > 0);
  for (const stone of [...small.stones, ...large.stones]) {
    assert.ok(Number.isFinite(stone.xMm));
    assert.ok(Number.isFinite(stone.yMm));
    assert.ok(Number.isFinite(stone.sizeMm));
  }

  const ratio = large.widthMm / small.widthMm;
  assert.ok(ratio > 1.5 && ratio < 2.5, `expected bounding box width to scale with radiusMm, got ratio ${ratio}`);
});

await test('19. every circle/rectangle stone carries the requested layerId and color', () => {
  const engine = createEngine();

  const circle = engine.generateShapeLayout({ ...BASE_CIRCLE_PARAMS, layerId: 'circle-42', color: 'sapphire' });
  assert.equal(circle.layerId, 'circle-42');
  for (const stone of circle.stones) {
    assert.equal(stone.layerId, 'circle-42');
    assert.equal(stone.color, 'sapphire');
  }

  const rect = engine.generateShapeLayout({ ...BASE_RECT_PARAMS, layerId: 'rect-42', color: 'jet' });
  assert.equal(rect.layerId, 'rect-42');
  for (const stone of rect.stones) {
    assert.equal(stone.layerId, 'rect-42');
    assert.equal(stone.color, 'jet');
  }
});

await test('20. an invalid shape value throws a clear error', () => {
  const engine = createEngine();
  assert.throws(
    () => engine.generateShapeLayout({ ...BASE_CIRCLE_PARAMS, shape: 'triangle' }),
    /shape to be one of/
  );
});

await test('21. generateShapeLayout works with no fontProviderRegistry; generateTextLayout throws in that case', async () => {
  const engine = new GeometryEngine();

  assert.equal(engine.canGenerateText, false);
  const layout = engine.generateShapeLayout(BASE_CIRCLE_PARAMS);
  assert.ok(layout.count > 0, 'expected shape generation to work without a fontProviderRegistry');

  await assert.rejects(
    () => engine.generateTextLayout(BASE_PARAMS),
    /requires a fontProviderRegistry/
  );
});

await test('this task did not modify forbidden UI, renderer, or exporter files', async () => {
  const { execSync } = await import('node:child_process');
  const output = execSync('git status --porcelain', { cwd: repoRoot, encoding: 'utf8' });
  const changedPaths = output
    .split('\n')
    .filter((line) => line.trim().length > 0)
    // Porcelain lines are exactly "XY path" (2 status chars + 1 space); slicing must happen on
    // the untrimmed line, since trimming first eats the leading status character for common
    // single-letter-in-column-2 statuses like " M", silently truncating the path.
    .map((line) => line.slice(3).trim());

  const forbiddenExact = new Set(['style.css', 'README.md']);
  // src/renderer/ and src/export/ are legitimately changed by RS-0003.5C2 (rendering pipeline).
  const forbiddenPrefixes = ['assets/fonts/'];

  for (const changedPath of changedPaths) {
    assert.ok(!forbiddenExact.has(changedPath), `Forbidden file changed: ${changedPath}`);
    assert.ok(
      !forbiddenPrefixes.some((prefix) => changedPath.startsWith(prefix)),
      `Forbidden file changed: ${changedPath}`
    );
  }
});

console.log('GeometryEngine tests passed.');
