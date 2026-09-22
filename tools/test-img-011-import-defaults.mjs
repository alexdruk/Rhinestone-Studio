import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// IMG-011 -- unit tests for the five new-image import defaults: (1) computeDefaultImagePlacement()
// now targets 200mm on the image's longer side (was a fixed 96/25.4 px/mm conversion) before the
// existing canvas-minus-20mm clamp and centring; (2) the Image menu reveals the 2D canvas only, via
// a new sibling revealCanvasOnlyForLightbox(), instead of Dual Workspace; (3) a freshly imported
// image layer now defaults to stoneSize 2 (SS6), colorCount 'auto', and fillMode 'staggered' instead
// of inheriting the previously-selected layer's stone size and defaulting to a single color/'fill'.
// Every read-site default (resolveImageFillMode()'s 'fill' fallback) is deliberately untouched, so a
// project saved before this milestone still regenerates byte-identically -- item 4 pins that. See
// docs/specifications/IMG-011-ImportDefaults.md.
//
// IMG-012 follow-up: item 2's colorCount literal was 6 (IMG-011's own default) and is now 'auto'
// (IMG-012 replaces it, decision 1); item 4's generateImageStonesLive() guard was
// colorCount:layer.colorCount??1 and now reads colorCount:resolveImageColorCount(layer) (IMG-012's
// resolver, called at every numeric read site) -- both updated below to match, test-side only, per
// docs/specifications/IMG-012-AutoColourCount.md Task F item 13.

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

function extractImageStudioRemoveHandler(appJs) {
  const match = appJs.match(/el\('imageStudioRemove'\)\.onclick=\(\)=>\{[\s\S]*?\};/);
  assert.ok(match, "expected to find el('imageStudioRemove').onclick=... in app.js");
  return match[0];
}

function buildImageStudioRemoveHandler(source, { selectedLayer, deleteLayer, lightboxes }) {
  const elTarget = {};
  const el = (id) => {
    assert.equal(id, 'imageStudioRemove', `unexpected el('${id}') in extracted source`);
    return elTarget;
  };
  // eslint-disable-next-line no-new-func
  new Function('el', 'selectedLayer', 'deleteLayer', 'lightboxes', source)(el, selectedLayer, deleteLayer, lightboxes);
  return elTarget.onclick;
}

function makeFakeImageTraceTextLightboxes() {
  const state = { imagetrace: false, text: false };
  return {
    imagetrace: {
      get isOpen() { return state.imagetrace; },
      open() { state.imagetrace = true; state.text = false; },
      close() { state.imagetrace = false; }
    },
    text: {
      get isOpen() { return state.text; },
      open() { state.text = true; state.imagetrace = false; },
      close() { state.text = false; }
    }
  };
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

await test("2. the importImageFile handler's new-layer literal defaults to stoneSize:2, colorCount:'auto', fillMode:'staggered', and no longer reads selectedLayer().stoneSize", async () => {
  const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');
  const handler = extractImportImageFileHandler(appJs);
  assert.match(handler, /stoneSize:2,/, 'expected the new image layer to default stoneSize to 2');
  assert.match(handler, /colorCount:'auto',/, "expected the new image layer to default colorCount to 'auto' (IMG-012)");
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

await test("4. read-site defaults are untouched: resolveImageFillMode() still falls back to 'fill'; generateImageStonesLive() now reads colorCount:resolveImageColorCount(layer) (IMG-012), which is byte-identical to the old colorCount??1 for every numeric/absent colorCount -- saved projects regenerate byte-identically", async () => {
  const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');

  const fillModeMatch = appJs.match(/function resolveImageFillMode\(value\)\{[\s\S]*?\}/);
  assert.ok(fillModeMatch, 'expected to find resolveImageFillMode() in app.js');
  // eslint-disable-next-line no-new-func
  const resolveImageFillMode = new Function('IMAGE_FILL_MODES', `${fillModeMatch[0]}\nreturn resolveImageFillMode;`)(
    new Set(['fill', 'staggered', 'radial', 'contour', 'organic', 'edge'])
  );
  assert.equal(resolveImageFillMode(undefined), 'fill', 'expected resolveImageFillMode(undefined) to still fall back to \'fill\'');
  assert.equal(resolveImageFillMode(null), 'fill', 'expected resolveImageFillMode(null) to still fall back to \'fill\'');

  assert.match(appJs, /colorCount:resolveImageColorCount\(layer\)/, 'expected generateImageStonesLive() to read colorCount:resolveImageColorCount(layer) (IMG-012)');
});

await test("5. imageStudioRemove reopens Image → Strass after deleteLayer() triggers the S-105 auto-switch to Text", async () => {
  const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');
  const source = extractImageStudioRemoveHandler(appJs);

  const lightboxes = makeFakeImageTraceTextLightboxes();
  const deleteLayerCalls = [];
  const deleteLayer = (id) => {
    deleteLayerCalls.push(id);
    // Reproduces syncSelectedControlsFromLayer()'s S-105 auto-switch block, which deleteLayer()
    // triggers by selecting project.layers[0] -- here that newly-selected layer is a text layer,
    // so it opens Text (which, per the fake lightboxes' exclusivity, closes Image Trace).
    lightboxes.text.open();
  };
  const onclick = buildImageStudioRemoveHandler(source, {
    selectedLayer: () => ({ id: 'img1', type: 'image' }),
    deleteLayer,
    lightboxes
  });

  lightboxes.imagetrace.open();
  onclick();

  assert.deepEqual(deleteLayerCalls, ['img1'], 'expected deleteLayer() to be called with the selected image layer id');
  assert.equal(lightboxes.imagetrace.isOpen, true, 'expected Image Trace to be reopened after the auto-switch closed it');
  assert.equal(lightboxes.text.isOpen, false, 'expected Text to end up closed once Image Trace is reopened');
});

await test('5b. imageStudioRemove does nothing when the selected layer is not an image', async () => {
  const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');
  const source = extractImageStudioRemoveHandler(appJs);

  const lightboxes = makeFakeImageTraceTextLightboxes();
  const deleteLayerCalls = [];
  const deleteLayer = (id) => {
    deleteLayerCalls.push(id);
    lightboxes.text.open();
  };
  const onclick = buildImageStudioRemoveHandler(source, {
    selectedLayer: () => ({ id: 'text1', type: 'text' }),
    deleteLayer,
    lightboxes
  });

  lightboxes.imagetrace.open();
  onclick();

  assert.deepEqual(deleteLayerCalls, [], 'expected deleteLayer() to never be called for a non-image selected layer');
  assert.equal(lightboxes.imagetrace.isOpen, true, 'expected Image Trace to stay open (untouched)');
  assert.equal(lightboxes.text.isOpen, false, 'expected Text to stay closed (nothing should open)');
});

console.log('IMG-011 import defaults tests passed.');
