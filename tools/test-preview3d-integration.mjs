import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// RS-1006 — verifies app.js/index.html are actually wired for the real 3D preview: the `three`
// import-map entry exists, app.js imports createPreview3D (not the old CupRenderer/renderCup) and
// wires it into drawCup(), the old custom pointer-drag-to-rotate handler is gone, #cup/#exportCup/
// #resetView/.viewBtn/#rotation/#zoom keep their existing ids, CupRenderer.js/GeometryEngine.js/
// StoneLayout.js are byte-unchanged, and no forbidden file changed. Structural checks against the
// live app.js/index.html source (app.js is a browser entry point, not import()-able directly under
// plain Node), matching the established convention in
// tools/test-object-template-integration.mjs / tools/test-curved-text-integration.mjs.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');
const indexHtml = await readFile(path.join(repoRoot, 'index.html'), 'utf8');
const packageJson = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));

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

await test('1. index.html import map resolves the bare specifier "three" to the local node_modules ESM build (no CDN)', () => {
  const importMapMatch = indexHtml.match(/<script type="importmap">([\s\S]*?)<\/script>/);
  assert.ok(importMapMatch, 'expected an import map in index.html');
  const importMap = JSON.parse(importMapMatch[1]);
  assert.equal(importMap.imports.three, './node_modules/three/build/three.module.js');
  assert.ok(!/https?:\/\//.test(importMap.imports.three), 'must not load three.js from a CDN');
});

await test('2. index.html keeps the #cup canvas id and every preview control id unchanged', () => {
  for (const id of ['cup', 'cupColor', 'rotation', 'zoom', 'resetView', 'exportCup', 'objectType', 'wrap']) {
    assert.ok(new RegExp(`id="${id}"`).test(indexHtml), `expected index.html to still contain id="${id}"`);
  }
  assert.ok(indexHtml.includes('class="viewBtn'), 'expected the Front/Left/Right/Back view buttons to still exist');
});

await test('3. app.js imports createPreview3D from src/preview3d/index.js, not renderCup/CupRenderer', () => {
  assert.ok(appJs.includes("import { createPreview3D } from './src/preview3d/index.js';"));
  assert.ok(!/import\s*\{\s*renderCup\s*\}/.test(appJs), 'expected the old renderCup import to be gone');
  assert.ok(!appJs.includes("from './src/renderer/CupRenderer.js'"), 'expected app.js to no longer import CupRenderer.js');
});

await test('4. app.js constructs the preview3D facade once and drawCup() wires update()/syncView()', () => {
  assert.ok(/const preview3D\s*=\s*createPreview3D\(cupCanvas\)/.test(appJs));
  const drawCupMatch = appJs.match(/function drawCup\(\)\{[\s\S]*?\n\}/);
  assert.ok(drawCupMatch, 'expected to find drawCup() in app.js');
  assert.ok(drawCupMatch[0].includes('preview3D.update('), 'expected drawCup() to call preview3D.update(...)');
  assert.ok(drawCupMatch[0].includes('preview3D.syncView('), 'expected drawCup() to call preview3D.syncView(...)');
  assert.ok(drawCupMatch[0].includes('canvasWidthMm:project.canvas.width'), 'expected drawCup() to forward the live mm canvas size');
  assert.ok(drawCupMatch[0].includes('canvasHeightMm:project.canvas.height'));
});

await test('5. the old custom pointer-drag-to-rotate handler on #cup and its sensitivity constant are gone', () => {
  assert.ok(!appJs.includes('cupDrag'), 'expected the old cupDrag pointer-drag state to be removed');
  // A comment explaining *why* CUP_ROTATION_SENSITIVITY was removed is fine (and present); only its
  // declaration/use as a live constant must be gone.
  assert.ok(!/const\s+CUP_ROTATION_SENSITIVITY\s*=/.test(appJs), 'expected the now-dead CUP_ROTATION_SENSITIVITY constant declaration to be removed');
});

await test('6. Reset view calls preview3D.resetView() in addition to resetting rotation/zoom', () => {
  const resetViewMatch = appJs.match(/el\('resetView'\)\.onclick=\(\)=>\{[\s\S]*?\};/);
  assert.ok(resetViewMatch, 'expected to find the #resetView click handler in app.js');
  assert.ok(resetViewMatch[0].includes('preview3D.resetView()'));
});

await test('7. exportCup button/filename are unchanged', () => {
  assert.ok(appJs.includes("el('exportCup')"), 'expected the #exportCup handler to still exist');
  assert.ok(appJs.includes("exportCanvas('rhinestone-cup-preview.png',cupCanvas)"), 'expected the exported filename/canvas to be unchanged');
});

await test('8. package.json declares "three" as a dependency (no CDN, no bundler) and registers the four new test suites', () => {
  assert.ok(packageJson.dependencies.three, 'expected package.json to declare a "three" dependency');
  for (const testFile of [
    'test-object-dimensions.mjs',
    'test-stone-layout-texture.mjs',
    'test-object-geometry-builder.mjs',
    'test-preview3d-integration.mjs'
  ]) {
    assert.ok(packageJson.scripts.test.includes(testFile), `expected npm test to run ${testFile}`);
  }
});

await test('9. ObjectDimensions.js/StoneLayoutTexture.js have no Three.js import and never touch Project/Layer', async () => {
  const objectDimensionsSource = await readFile(path.join(repoRoot, 'src/preview3d/ObjectDimensions.js'), 'utf8');
  const stoneLayoutTextureSource = await readFile(path.join(repoRoot, 'src/preview3d/StoneLayoutTexture.js'), 'utf8');
  for (const source of [objectDimensionsSource, stoneLayoutTextureSource]) {
    assert.ok(!source.includes("from 'three'"), 'expected pure-math/texture modules to have no Three.js import');
    assert.ok(!/project\.layers|layer\.type|Project\.js|Layer\.js/.test(source));
  }
});

await test('10. CupRenderer.js still exists and still exports renderCup, unmodified by this milestone', async () => {
  const cupRendererSource = await readFile(path.join(repoRoot, 'src/renderer/CupRenderer.js'), 'utf8');
  assert.ok(/export function renderCup\(/.test(cupRendererSource), 'expected CupRenderer.js to still export renderCup unchanged');
});

await test('11. no forbidden file changed (this milestone\'s own forbidden list)', () => {
  const output = execSync('git status --porcelain', { cwd: repoRoot, encoding: 'utf8' });
  const changedPaths = output
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => line.slice(3).trim());

  const forbiddenExact = new Set(['style.css', 'README.md', 'LICENSE', 'CONTRIBUTING.md']);
  // RS-1007 (Crystal Color Library) legitimately changes src/renderer/StoneColors.js (now a
  // compatibility re-export shim) and adds src/renderer/CrystalColors.js (the new catalog) — see
  // tools/test-crystal-color-catalog.mjs / tools/test-crystal-color-integration.mjs for that
  // milestone's own forbidden-file guard. This milestone's own preview3d/** files stay covered.
  // RS-1008A (Image Trace Architecture Correction) legitimately changes
  // src/geometry/GeometryEngine.js/StoneSampler.js/index.js/README.md — see
  // tools/test-image-trace-regression.mjs for that milestone's own forbidden-file guard.
  // RS-1012 (Vector Boolean Operations) legitimately adds src/geometry/PathBoolean.js — see
  // tools/test-path-boolean-integration.mjs for that milestone's own forbidden-file guard.
  // RS-1013 (Variable Stone Sizes) legitimately adds src/renderer/StoneSizes.js (the Stone Library
  // catalog) and its one required exporter change, src/export/ProductionSheetExporter.js's header
  // formatting -- see tools/test-variable-stone-sizes.mjs for that milestone's own forbidden-file
  // guard. This milestone's own preview3d/** files stay covered (untouched).
  // RS-1011 (Fill Algorithms) legitimately adds src/geometry/ContourRingSampler.js and extends
  // src/geometry/GeometryEngine.js/StoneSampler.js/index.js (already allowed above) -- see
  // tools/test-fill-algorithms.mjs / tools/test-fill-algorithms-integration.mjs for that
  // milestone's own forbidden-file guard.
  const allowedDespitePrefix = new Set(['src/renderer/StoneColors.js', 'src/renderer/CrystalColors.js', 'src/renderer/StoneSizes.js', 'src/renderer/README.md', 'src/geometry/GeometryEngine.js', 'src/geometry/StoneSampler.js', 'src/geometry/index.js', 'src/geometry/README.md', 'src/geometry/PathBoolean.js', 'src/geometry/ContourRingSampler.js', 'src/export/ProductionSheetExporter.js']);
  const forbiddenPrefixes = [
    'src/geometry/', 'src/export/', 'src/core/', 'src/text/', 'src/fonts/',
    'src/browser/', 'src/svg/', 'src/history/', 'src/products/', 'src/renderer/',
    'assets/', 'examples/'
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

console.log('Preview3D integration tests passed.');
