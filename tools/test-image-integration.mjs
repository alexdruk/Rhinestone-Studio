import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// RS-1008 — verifies app.js is actually wired to src/image/**'s traceImageBufferToStoneLayout()
// for 'image' layers, that the ad hoc Project JSON validator accepts/rejects 'image' layers
// correctly, that the generic shape-editing code (bbox/drag/resize/duplicate/label) was extended
// to cover 'image', and that index.html exposes the controls app.js expects. Structural checks
// against the live app.js source, matching the existing convention in
// tools/test-svg-integration.mjs, because app.js is a browser entry point and is not
// import()-able directly under plain Node the way the permanent src/** modules are.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');
const indexHtml = await readFile(path.join(repoRoot, 'index.html'), 'utf8');

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

await test('1. generate() routes image layers through a live generation method calling traceImageBufferToStoneLayout', () => {
  assert.match(appJs, /if\(l\.type==='image'\)raw\.push\(\.\.\.await this\.generateImageStonesLive\(l\)\)/);
  assert.match(appJs, /async generateImageStonesLive\s*\(/, 'expected an async generateImageStonesLive method');
  assert.match(appJs, /traceImageBufferToStoneLayout\(buffer,params\)/, 'expected a call to traceImageBufferToStoneLayout');
});

await test('2. app.js imports the image pipeline from src/image/index.js, not a reimplementation', () => {
  assert.match(appJs, /import\s*\{[^}]*traceImageBufferToStoneLayout[^}]*\}\s*from\s*['"]\.\/src\/image\/index\.js['"]/);
});

await test('3. getLayerBBox()/drag-move/drag-resize/duplicateLayer()/layerLabel() each have an image case', () => {
  assert.match(appJs, /if\(l\.type==='rectangle'\|\|l\.type==='svg'\|\|l\.type==='image'\)return\{x:l\.x,y:l\.y,width:l\.w,height:l\.h,x2:l\.x\+l\.w,y2:l\.y\+l\.h\}/, 'expected getLayerBBox to treat image like rectangle/svg');
  assert.match(appJs, /l\.type==='rectangle'\|\|l\.type==='svg'\|\|l\.type==='image'\)\{l\.x=drag\.l0\.x\+dx;l\.y=drag\.l0\.y\+dy\}/, 'expected drag-move to treat image like rectangle/svg');
  assert.match(appJs, /l\.type==='rectangle'\|\|l\.type==='svg'\|\|l\.type==='image'\)\{let x0=drag\.b0\.x/, 'expected drag-resize to treat image like rectangle/svg');
  assert.match(appJs, /if\(copy\.type==='image'\)\{copy\.x\+=8;copy\.y\+=8\}/, 'expected duplicateLayer to nudge image layers');
  assert.match(appJs, /l\.type==='image'\?\(l\.imageName\|\|'Image'\)/, 'expected layerLabel to have an image case');
});

await test('4. SUPPORTED_LAYER_TYPES includes image', () => {
  assert.match(appJs, /SUPPORTED_LAYER_TYPES\s*=\s*new Set\(\[[^\]]*'image'[^\]]*\]\)/);
});

await test('5. validateProject() accepts a valid image layer and rejects one missing imageSrc / with an out-of-range threshold', async () => {
  const match = appJs.match(/function validateProject\(obj\)\{[\s\S]*?\n\}\n/);
  assert.ok(match, 'expected to find validateProject() in app.js');
  const source = appJs.slice(appJs.indexOf('const DEFAULT_PROJECT_NAME='), appJs.indexOf(match[0]) + match[0].length);
  const { getObjectTemplate } = await import('../src/products/index.js');
  // eslint-disable-next-line no-new-func
  const validateProject = new Function('getObjectTemplate', `${source}\nreturn validateProject;`)(getObjectTemplate);

  const baseProject = () => ({
    version: 2,
    canvas: { width: 210, height: 90 },
    layers: [
      { id: 'image1', type: 'image', imageSrc: 'data:image/png;base64,AAAA', x: 10, y: 10, w: 20, h: 20, threshold: 128, invert: false, blurRadiusPx: 0, maxWidthPx: 400, maxHeightPx: 400, stoneSize: 2, gap: 0.3, color: 'gold' }
    ]
  });

  assert.doesNotThrow(() => validateProject(baseProject()));

  const missingSource = baseProject();
  delete missingSource.layers[0].imageSrc;
  assert.throws(() => validateProject(missingSource), /imageSrc/);

  const badThreshold = baseProject();
  badThreshold.layers[0].threshold = 999;
  assert.throws(() => validateProject(badThreshold), /threshold/);

  const missingBBox = baseProject();
  delete missingBBox.layers[0].w;
  assert.throws(() => validateProject(missingBBox), /x\/y\/w\/h/);

  const badMax = baseProject();
  badMax.layers[0].maxWidthPx = -1;
  assert.throws(() => validateProject(badMax), /maxWidthPx/);
});

await test('6. index.html exposes #importImage, #importImageFile, #imageImportPanel, and #imageControls with the documented field ids', () => {
  assert.match(indexHtml, /<button id="importImage"/);
  assert.match(indexHtml, /<input id="importImageFile" type="file"/);
  assert.match(indexHtml, /<div id="imageImportPanel"/);
  assert.match(indexHtml, /<div id="imageControls"/);
  for (const id of ['imgThreshold', 'imgInvert', 'imgBlurRadius', 'imgMaxWidth', 'imgMaxHeight']) {
    assert.match(indexHtml, new RegExp(`id="${id}"`), `expected index.html to define #${id}`);
  }
  for (const id of ['imgPreviewThreshold', 'imgPreviewInvert', 'imgPreviewBlur', 'imgPreviewMaxWidth', 'imgPreviewMaxHeight', 'imageImportPreviewCanvas', 'imageImportStoneCount', 'imageImportCancel', 'imageImportCommit']) {
    assert.match(indexHtml, new RegExp(`id="${id}"`), `expected index.html to define #${id}`);
  }
});

await test('7. HISTORY_TRACKED_CONTROL_IDS includes the post-commit imageControls field ids', () => {
  const match = appJs.match(/const HISTORY_TRACKED_CONTROL_IDS=\[[^\]]*\];/);
  assert.ok(match, 'expected to find HISTORY_TRACKED_CONTROL_IDS in app.js');
  for (const id of ['imgThreshold', 'imgInvert', 'imgBlurRadius', 'imgMaxWidth', 'imgMaxHeight']) {
    assert.ok(match[0].includes(`'${id}'`), `expected HISTORY_TRACKED_CONTROL_IDS to include '${id}'`);
  }
});

await test('8. the #importImageFile change handler validates the file type before decoding and reports failures via #status', () => {
  const handlerMatch = appJs.match(/el\('importImageFile'\)\.addEventListener\('change',async e=>\{([\s\S]*?)\n\}\);/);
  assert.ok(handlerMatch, 'expected the importImageFile change handler body');
  const body = handlerMatch[1];
  assert.match(body, /isSupportedImageFile\(file\)/, 'handler must validate the file type');
  assert.match(body, /decodeImageFileToBuffer\(file\)/, 'handler must decode via decodeImageFileToBuffer');
  assert.match(body, /catch\s*\(error\)/, 'handler must catch decode/validation errors');
  assert.match(body, /el\('status'\)\.textContent=`Image import failed/, 'handler must report failures via #status');
});

await test('9. no forbidden file changed (this milestone\'s own forbidden list)', () => {
  const output = execSync('git status --porcelain', { cwd: repoRoot, encoding: 'utf8' });
  const changedPaths = output
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => line.slice(3).trim());

  const forbiddenExact = new Set(['style.css', 'README.md', 'LICENSE', 'CONTRIBUTING.md']);
  const forbiddenPrefixes = [
    'src/geometry/', 'src/export/', 'src/text/', 'src/fonts/', 'src/core/', 'src/browser/',
    'src/renderer/', 'src/preview3d/', 'src/svg/', 'src/history/', 'src/products/',
    'assets/', 'examples/'
  ];

  for (const changedPath of changedPaths) {
    assert.ok(!forbiddenExact.has(changedPath), `Forbidden file changed: ${changedPath}`);
    assert.ok(
      !forbiddenPrefixes.some((prefix) => changedPath.startsWith(prefix)),
      `Forbidden file changed: ${changedPath}`
    );
  }
});

console.log('Image integration tests passed.');
