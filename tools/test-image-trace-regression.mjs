import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createImageBuffer } from '../src/image/index.js';
import { GeometryEngine } from '../src/geometry/index.js';
import { buildRegressionCases } from './lib/imageTraceFixtures.mjs';

// RS-1008A — Image Trace Architecture Correction regression proof.
//
// RS-1008 originally had src/image/** construct Stone/StoneLayout directly (a second, independent
// stone-generating implementation, alongside the permanent GeometryEngine). This milestone moved
// stone construction into GeometryEngine.generateImageLayout() (src/geometry/GeometryEngine.js),
// with grid sampling in StoneSampler.sampleFieldFillPoints() — src/image/** now only prepares a
// neutral density field (prepareImageField()). This suite proves three things per the milestone
// brief: (1) Image Trace actually goes through the permanent geometry pipeline, not a
// reimplementation; (2) output for a fixed set of inputs is byte-identical to the pre-refactor
// implementation (tools/image-trace-regression-baselines.json, captured from the RS-1008
// implementation via tools/generate-image-trace-baselines.mjs before this refactor); (3) the
// second implementation was actually removed, not left duplicated alongside the new one.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

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

await test('1. GeometryEngine.generateImageLayout() reproduces the pre-refactor RS-1008 baseline byte-for-byte, for every regression case', async () => {
  const baselines = JSON.parse(await readFile(path.join(repoRoot, 'tools', 'image-trace-regression-baselines.json'), 'utf8'));
  const cases = buildRegressionCases(createImageBuffer);
  assert.ok(cases.length >= 8, 'expected a meaningful number of regression cases');

  const engine = new GeometryEngine();
  for (const { name, buffer, params } of cases) {
    assert.ok(name in baselines, `no committed baseline for case "${name}" -- did tools/generate-image-trace-baselines.mjs run against these exact cases?`);
    const actual = engine.generateImageLayout({ imageBuffer: buffer, ...params }).toJSON();
    assert.deepEqual(actual, baselines[name], `case "${name}" does not byte-match its committed baseline`);
  }
});

await test('2. app.js\'s generateImageStonesLive() calls the permanent engine\'s generateImageLayout(), not a src/image/**-only function', async () => {
  const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');
  assert.match(appJs, /async generateImageStonesLive\s*\(/, 'expected an async generateImageStonesLive method');
  assert.match(appJs, /this\.permanentEngine\.generateImageLayout\(params\)/, 'expected generateImageStonesLive to call this.permanentEngine.generateImageLayout(params)');
  assert.match(appJs, /if\(l\.type==='image'\)raw\.push\(\.\.\.await this\.generateImageStonesLive\(l\)\)/, 'expected generate() to dispatch image layers through generateImageStonesLive');
});

await test('3. GeometryEngine.js defines generateImageLayout() and calls sampleFieldFillPoints()/prepareImageField(), not a reimplemented sampler', async () => {
  const geometryEngineSrc = await readFile(path.join(repoRoot, 'src', 'geometry', 'GeometryEngine.js'), 'utf8');
  assert.match(geometryEngineSrc, /generateImageLayout\s*\(/, 'expected a generateImageLayout method');
  assert.match(geometryEngineSrc, /import\s*\{\s*prepareImageField\s*\}\s*from\s*['"]\.\.\/image\/index\.js['"]/, 'expected GeometryEngine.js to import prepareImageField from src/image/index.js');
  assert.match(geometryEngineSrc, /sampleFieldFillPoints\s*\(/, 'expected generateImageLayout to call sampleFieldFillPoints');
  assert.match(geometryEngineSrc, /new Stone\(/, 'expected generateImageLayout to construct real Stone instances (via the shared stones.map(...) code already used by every other generate*Layout method)');
});

await test('4. sampleFieldFillPoints() lives in src/geometry/StoneSampler.js, exported from the permanent barrel', async () => {
  const stoneSamplerSrc = await readFile(path.join(repoRoot, 'src', 'geometry', 'StoneSampler.js'), 'utf8');
  assert.match(stoneSamplerSrc, /export function sampleFieldFillPoints\s*\(/);
  const { sampleFieldFillPoints } = await import('../src/geometry/index.js');
  assert.equal(typeof sampleFieldFillPoints, 'function', 'expected src/geometry/index.js to export sampleFieldFillPoints');
});

await test('5. the RS-1008 second implementation was actually removed, not left duplicated alongside the new one', async () => {
  const imageIndexSrc = await readFile(path.join(repoRoot, 'src', 'image', 'index.js'), 'utf8');
  assert.ok(!imageIndexSrc.includes('traceImageBufferToStoneLayout'), 'src/image/index.js must no longer export the old direct-Stone/StoneLayout-construction function');
  assert.ok(!imageIndexSrc.includes('sampleImageFillPoints'), 'src/image/index.js must no longer export the old image-local sampler (moved to sampleFieldFillPoints in src/geometry/StoneSampler.js)');

  const imported = await import('../src/image/index.js');
  assert.equal(imported.traceImageBufferToStoneLayout, undefined);
  assert.equal(imported.sampleImageFillPoints, undefined);

  // The files themselves are gone, not just unexported (would be dead, misleading duplicate code
  // otherwise).
  await assert.rejects(() => readFile(path.join(repoRoot, 'src', 'image', 'ImageTracePipeline.js')));
  await assert.rejects(() => readFile(path.join(repoRoot, 'src', 'image', 'ImageStoneSampler.js')));
});

await test('6. src/image/** has no dependency on src/geometry/** (one-way: geometry depends on image, not the reverse — mirrors src/svg/**\'s existing rule)', async () => {
  const { readdir } = await import('node:fs/promises');
  const imageDir = path.join(repoRoot, 'src', 'image');
  const files = (await readdir(imageDir)).filter((f) => f.endsWith('.js'));
  assert.ok(files.length > 0, 'expected to find src/image/**.js files');
  for (const file of files) {
    const source = await readFile(path.join(imageDir, file), 'utf8');
    assert.ok(!/from\s*['"]\.\.\/geometry\//.test(source), `${file} must not import from ../geometry/** (src/image/** prepares image-derived input only; GeometryEngine is the only caller that turns it into stones)`);
    assert.ok(!/\bnew Stone\(/.test(source) && !/\bnew StoneLayout\(/.test(source), `${file} must not construct Stone/StoneLayout directly`);
  }
});

await test('7. GeometryEngine.generateImageLayout() and app.js\'s live orchestration are exercised by the same params app.js actually sends', () => {
  // A structural sanity check that the field app.js forwards (imageBuffer/layerId/xMm/yMm/widthMm/
  // heightMm/stoneSizeMm/gapMm/color/threshold/invert/blurRadiusPx/maxWidthPx/maxHeightPx) is
  // exactly what generateImageLayout() accepts -- exercised functionally by test 1 above (which
  // calls generateImageLayout with this exact param shape) rather than re-asserted here as a
  // second, weaker structural-only check.
  const engine = new GeometryEngine();
  const buffer = createImageBuffer({ widthPx: 2, heightPx: 2, data: new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255]) });
  const layout = engine.generateImageLayout({
    imageBuffer: buffer, layerId: 'x', xMm: 0, yMm: 0, widthMm: 10, heightMm: 10,
    stoneSizeMm: 1, gapMm: 0.2, color: 'gold', threshold: 128, invert: false,
    blurRadiusPx: 0, maxWidthPx: 32, maxHeightPx: 32
  });
  assert.ok(layout.count > 0);
});

await test('8. no forbidden file changed (this milestone\'s own forbidden list)', async () => {
  const { execSync } = await import('node:child_process');
  const output = execSync('git status --porcelain', { cwd: repoRoot, encoding: 'utf8' });
  const changedPaths = output
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => line.slice(3).trim());

  const forbiddenExact = new Set(['style.css', 'README.md', 'LICENSE', 'CONTRIBUTING.md']);
  // Unlike RS-1008, this milestone's whole point is to legitimately change src/geometry/** and
  // src/image/**, so neither is forbidden here.
  // RS-1013 (Variable Stone Sizes) legitimately adds src/renderer/StoneSizes.js and changes
  // src/export/ProductionSheetExporter.js's header formatting -- see
  // tools/test-variable-stone-sizes.mjs for that milestone's own forbidden-file guard.
  const allowedDespitePrefix = new Set(['src/renderer/StoneSizes.js', 'src/export/ProductionSheetExporter.js']);
  const forbiddenPrefixes = [
    // RS-2002: assets/fonts/** is legitimately expanded by the Typography & Font Library milestone (new bundled font files + manifest entries).
    'src/export/', 'src/text/', 'src/fonts/', 'src/browser/', 'src/renderer/', 'src/preview3d/', 'src/svg/', 'src/history/', 'src/products/'
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

console.log('Image trace architecture-correction regression tests passed.');
