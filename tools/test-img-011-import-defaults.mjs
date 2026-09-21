import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// IMG-011 -- unit tests for the five new-image import defaults: (1) computeDefaultImagePlacement()
// now targets 200mm on the image's longer side (was a fixed 96/25.4 px/mm conversion) before the
// existing canvas-minus-20mm clamp and centring; (2) the Image menu reveals the 2D canvas only, via
// a new sibling revealCanvasOnlyForLightbox(), instead of Dual Workspace; (3) a freshly imported
// image layer now defaults to stoneSize 2 (SS6), colorCount 6, and fillMode 'staggered' instead of
// inheriting the previously-selected layer's stone size and defaulting to a single color/'fill'.
// Every read-site default (resolveImageFillMode()'s 'fill' fallback, generateImageStonesLive()'s
// colorCount??1) is deliberately untouched, so a project saved before this milestone still
// regenerates byte-identically -- item 4 pins that. See docs/specifications/IMG-011-ImportDefaults.md.

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

function extractComputeDefaultImagePlacement(appJs) {
  const match = appJs.match(/function computeDefaultImagePlacement\(naturalWidthPx,naturalHeightPx\)\{[\s\S]*?\n\}/);
  assert.ok(match, 'expected to find computeDefaultImagePlacement() in app.js');
  return match[0];
}

function buildComputeDefaultImagePlacement(source, stubProject) {
  // eslint-disable-next-line no-new-func
  return new Function('project', `${source}\nreturn computeDefaultImagePlacement;`)(stubProject);
}

function extractImportImageFileHandler(appJs) {
  const match = appJs.match(/el\('importImageFile'\)\.addEventListener\('change',async e=>\{[\s\S]*?\n\}\);/);
  assert.ok(match, "expected to find el('importImageFile').addEventListener('change',...) in app.js");
  return match[0];
}

await test('1. computeDefaultImagePlacement() scales the image to 200mm on its longer side (preserving aspect ratio), then clamps to canvas-minus-20mm and centres', async () => {
  const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');
  const source = extractComputeDefaultImagePlacement(appJs);

  const cases = [
    { canvas: { width: 257.610597594363, height: 85 }, img: [800, 747], expect: { x: 93.999409, y: 10, w: 69.611780, h: 65 } },
    { canvas: { width: 300, height: 300 }, img: [800, 747], expect: { x: 50, y: 56.625, w: 200, h: 186.75 } },
    { canvas: { width: 300, height: 300 }, img: [300, 600], expect: { x: 100, y: 50, w: 100, h: 200 } },
    { canvas: { width: 300, height: 300 }, img: [40, 40], expect: { x: 50, y: 50, w: 200, h: 200 } }
  ];

  for (const { canvas, img, expect } of cases) {
    const compute = buildComputeDefaultImagePlacement(source, { canvas });
    const result = compute(img[0], img[1]);
    for (const key of ['x', 'y', 'w', 'h']) {
      assert.equal(
        result[key].toFixed(6),
        expect[key].toFixed(6),
        `canvas ${canvas.width}x${canvas.height}, image ${img[0]}x${img[1]}px: expected ${key}=${expect[key]}, got ${result[key]}`
      );
    }
  }
});

await test("2. the importImageFile handler's new-layer literal defaults to stoneSize:2, colorCount:6, fillMode:'staggered', and no longer reads selectedLayer().stoneSize", async () => {
  const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');
  const handler = extractImportImageFileHandler(appJs);
  assert.match(handler, /stoneSize:2,/, 'expected the new image layer to default stoneSize to 2');
  assert.match(handler, /colorCount:6,/, 'expected the new image layer to default colorCount to 6');
  assert.match(handler, /fillMode:'staggered'/, "expected the new image layer to default fillMode to 'staggered'");
  assert.ok(!handler.includes('selectedLayer().stoneSize'), 'expected the new image layer to no longer inherit stoneSize from selectedLayer()');
});

await test("3. el('menuImageTrace').onclick calls revealCanvasOnlyForLightbox(), not revealDualWorkspaceForLightbox()", async () => {
  const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');
  assert.match(
    appJs,
    /el\('menuImageTrace'\)\.onclick=\(\)=>\{revealCanvasOnlyForLightbox\(\);lightboxes\.imagetrace\.open\(\);setActiveTopMenuButton\('menuImageTrace'\)\}/,
    'expected #menuImageTrace to call revealCanvasOnlyForLightbox()'
  );
  assert.ok(
    !/el\('menuImageTrace'\)\.onclick=\(\)=>\{revealDualWorkspaceForLightbox\(\)/.test(appJs),
    'expected #menuImageTrace to no longer call revealDualWorkspaceForLightbox()'
  );
});

await test('4. read-site defaults are untouched: resolveImageFillMode() still falls back to \'fill\', generateImageStonesLive() still reads colorCount:layer.colorCount??1 -- saved projects regenerate byte-identically', async () => {
  const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');

  const fillModeMatch = appJs.match(/function resolveImageFillMode\(value\)\{[\s\S]*?\}/);
  assert.ok(fillModeMatch, 'expected to find resolveImageFillMode() in app.js');
  // eslint-disable-next-line no-new-func
  const resolveImageFillMode = new Function('IMAGE_FILL_MODES', `${fillModeMatch[0]}\nreturn resolveImageFillMode;`)(
    new Set(['fill', 'staggered', 'radial', 'contour', 'organic', 'edge'])
  );
  assert.equal(resolveImageFillMode(undefined), 'fill', 'expected resolveImageFillMode(undefined) to still fall back to \'fill\'');
  assert.equal(resolveImageFillMode(null), 'fill', 'expected resolveImageFillMode(null) to still fall back to \'fill\'');

  assert.match(appJs, /colorCount:layer\.colorCount\?\?1/, 'expected generateImageStonesLive() to still read colorCount:layer.colorCount??1');
});

console.log('IMG-011 import defaults tests passed.');
