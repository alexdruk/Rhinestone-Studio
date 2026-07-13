import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// RS-1008 — verifies app.js is actually wired to the permanent GeometryEngine's
// generateImageLayout() for 'image' layers, that the ad hoc Project JSON validator accepts/rejects
// 'image' layers correctly, that the generic shape-editing code (bbox/drag/resize/duplicate/label)
// was extended to cover 'image', and that index.html exposes the controls app.js expects.
// Structural checks against the live app.js source, matching the existing convention in
// tools/test-svg-integration.mjs, because app.js is a browser entry point and is not
// import()-able directly under plain Node the way the permanent src/** modules are.
//
// RS-1008A updated tests 1/2 (generateImageStonesLive() now calls
// this.permanentEngine.generateImageLayout(), not a src/image/**-only function) and test 9's
// forbidden-file list (src/geometry/** is legitimately changed by this milestone's architecture
// correction — see tools/test-image-trace-regression.mjs for the dedicated proof that Image Trace
// actually uses the permanent pipeline and produces byte-identical output).

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

await test('1. generate() routes image layers through a live generation method calling the permanent engine\'s generateImageLayout', () => {
  assert.match(appJs, /if\(l\.type==='image'\)raw\.push\(\.\.\.await this\.generateImageStonesLive\(l\)\)/);
  assert.match(appJs, /async generateImageStonesLive\s*\(/, 'expected an async generateImageStonesLive method');
  assert.match(appJs, /this\.permanentEngine\.generateImageLayout\(params\)/, 'expected a call to this.permanentEngine.generateImageLayout');
});

await test('2. app.js imports src/image/**\'s field-preparation only (prepareImageField), not a Stone/StoneLayout-constructing function', () => {
  assert.match(appJs, /import\s*\{[^}]*prepareImageField[^}]*\}\s*from\s*['"]\.\/src\/image\/index\.js['"]/);
  assert.ok(!appJs.includes('traceImageBufferToStoneLayout'), 'app.js must not reference the removed direct-Stone/StoneLayout-construction function');
});

await test('3. getLayerBBox()/drag-move/drag-resize/duplicateLayer()/layerLabel() each have an image case', () => {
  // RS-1012 extended this same shared branch again to also cover 'path' layers (Boolean Operation
  // results) -- see tools/test-path-boolean-integration.mjs for the RS-1012-specific assertions.
  assert.match(appJs, /if\(l\.type==='rectangle'\|\|l\.type==='svg'\|\|l\.type==='image'\|\|l\.type==='path'\)return\{x:l\.x,y:l\.y,width:l\.w,height:l\.h,x2:l\.x\+l\.w,y2:l\.y\+l\.h\}/, 'expected getLayerBBox to treat image like rectangle/svg');
  // RS-1009 narrow carve-out: the per-type drag-move branch was replaced by a single
  // getLayerPosition()/setLayerPosition() pair used uniformly for every layer type -- see
  // docs/specifications/RS-1009-AlignmentSnapping.md. image still moves exactly like
  // rectangle/svg: setLayerPosition() falls through to its x/y branch.
  assert.match(appJs, /function setLayerPosition\(l,xMm,yMm\)\{if\(l\.type==='circle'\)\{l\.cx=xMm;l\.cy=yMm\}else\{l\.x=xMm;l\.y=yMm\}\}/, 'expected setLayerPosition to move image (and rectangle/svg/text) via l.x/l.y');
  assert.match(appJs, /for\(const id of drag\.layerIds\)\{[\s\S]*?setLayerPosition\(l,p0\.xMm\+dx,p0\.yMm\+dy\)/, 'expected the move-drag path to apply positions via setLayerPosition');
  assert.match(appJs, /l\.type==='rectangle'\|\|l\.type==='svg'\|\|l\.type==='image'\|\|l\.type==='path'\)\{let x0=drag\.b0\.x/, 'expected drag-resize to treat image like rectangle/svg');
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
  // src/geometry/ is legitimately changed by RS-1008A (the architecture correction this suite's
  // own header comment describes) -- see tools/test-image-trace-regression.mjs for that
  // milestone's own forbidden-file guard and its dedicated proof of correct, non-duplicated usage.
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

console.log('Image integration tests passed.');
