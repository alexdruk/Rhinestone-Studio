import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// RS-1001 — verifies app.js is actually wired to the permanent GeometryEngine's
// generateSvgLayout() for 'svg' layers, that pre-import validation goes through
// src/svg's parseSvgDocument() (not a reimplementation), that the ad hoc Project JSON
// validator accepts/rejects 'svg' layers correctly, that the generic shape-editing code
// (bbox/drag/resize/duplicate) was extended to cover 'svg', and that index.html exposes the
// controls app.js expects. Structural checks against the live app.js source, matching the
// existing convention in tools/test-shape-geometry-integration.mjs, because app.js is a browser
// entry point and is not import()-able directly under plain Node the way the permanent src/**
// modules are.

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

await test('1. generate() routes svg layers through a live generation method calling the permanent engine\'s generateSvgLayout', () => {
  assert.match(appJs, /if\(l\.type==='svg'\)raw\.push\(\.\.\.await this\.generateSvgStonesLive\(l\)\)/);
  assert.match(appJs, /async generateSvgStonesLive\s*\(/, 'expected an async generateSvgStonesLive method');
  assert.match(appJs, /this\.permanentEngine\.generateSvgLayout\(/, 'expected a call to generateSvgLayout on the permanent engine');
});

await test('2. svg layers forward svgSource/xMm/yMm/widthMm/heightMm/mode to the permanent engine', () => {
  assert.match(appJs, /svgSource:layer\.svgSource,layerId:layer\.id,xMm:layer\.x,yMm:layer\.y,widthMm:layer\.w,heightMm:layer\.h/);
  assert.match(appJs, /mode:layer\.mode==='fill'\?'fill':'outline'/);
});

await test('3. app.js imports parseSvgDocument from src/svg/index.js for pre-import validation, not a reimplemented parser', () => {
  assert.match(appJs, /import\s*\{\s*parseSvgDocument\s*\}\s*from\s*['"]\.\/src\/svg\/index\.js['"]/);
  assert.match(appJs, /parseSvgDocument\(svgSource\)/, 'expected the importSvgFile handler to call parseSvgDocument');
});

await test('4. index.html exposes the #importSvg button, #importSvgFile file input, and #svgControls/#svgMode', () => {
  assert.match(indexHtml, /<button id="importSvg"/);
  assert.match(indexHtml, /<input id="importSvgFile" type="file"/);
  assert.match(indexHtml, /<div id="svgControls"/);
  assert.match(indexHtml, /<select id="svgMode">/);
});

await test('5. the #importSvgFile change handler validates before adding a layer and reports failures via #status', () => {
  const handlerMatch = appJs.match(/el\('importSvgFile'\)\.addEventListener\('change',async e=>\{([\s\S]*?)\}\);/);
  assert.ok(handlerMatch, 'expected the importSvgFile change handler body');
  const body = handlerMatch[1];
  assert.match(body, /const parsed=parseSvgDocument\(svgSource\)/, 'handler must parse/validate before adding a layer');
  assert.match(body, /type:'svg'/, 'handler must add a layer with type svg on success');
  assert.match(body, /catch\s*\(error\)/, 'handler must catch parse/validation errors');
  assert.match(body, /el\('status'\)\.textContent=`SVG import failed/, 'handler must report failures via #status');
});

await test('6. validateProject() accepts a valid svg layer and rejects one missing svgSource', async () => {
  const match = appJs.match(/function validateProject\(obj\)\{[\s\S]*?\n\}\n/);
  assert.ok(match, 'expected to find validateProject() in app.js');
  // RS-1005: validateProject() now also references the top-level DEFAULT_PROJECT_NAME constant
  // (project.name's permissive default), so the extracted slice must start there instead of at
  // SUPPORTED_LAYER_TYPES -- the extra intervening source (defaultProject(), etc.) is harmless,
  // matching the precedent in tools/test-object-template-integration.mjs's extractProjectFunctions().
  const source = appJs.slice(appJs.indexOf('const DEFAULT_PROJECT_NAME='), appJs.indexOf(match[0]) + match[0].length);
  // RS-1004: validateProject() now calls the real getObjectTemplate() (imported at the top of
  // app.js) to normalize project.product; the extracted source snippet above does not include that
  // import, so it is injected as a function parameter instead, matching the precedent in
  // tools/test-examples-regression.mjs's extractValidateProject().
  const { getObjectTemplate } = await import('../src/products/index.js');
  // eslint-disable-next-line no-new-func
  const validateProject = new Function('getObjectTemplate', `${source}\nreturn validateProject;`)(getObjectTemplate);

  const baseProject = () => ({
    version: 2,
    canvas: { width: 210, height: 90 },
    layers: [
      { id: 'svg1', type: 'svg', svgSource: '<svg width="10mm" height="10mm"><rect width="1" height="1"/></svg>', x: 10, y: 10, w: 20, h: 20, stoneSize: 2, gap: 0.3, color: 'gold' }
    ]
  });

  assert.doesNotThrow(() => validateProject(baseProject()));

  const missingSource = baseProject();
  delete missingSource.layers[0].svgSource;
  assert.throws(() => validateProject(missingSource), /svgSource/);

  const missingBBox = baseProject();
  delete missingBBox.layers[0].w;
  assert.throws(() => validateProject(missingBBox), /x\/y\/w\/h/);
});

await test('7. getLayerBBox()/drag-move/drag-resize/duplicateLayer() each have an svg case', () => {
  // RS-1008 extended these same shared branches to also cover 'image' layers
  // (l.type==='rectangle'||l.type==='svg'||l.type==='image') -- the svg case itself is
  // unchanged, just no longer the last type in the condition. See tools/test-image-integration.mjs
  // for the RS-1008-specific assertions against the same lines.
  assert.match(appJs, /if\(l\.type==='rectangle'\|\|l\.type==='svg'\|\|l\.type==='image'\)return\{x:l\.x,y:l\.y,width:l\.w,height:l\.h,x2:l\.x\+l\.w,y2:l\.y\+l\.h\}/, 'expected getLayerBBox to treat svg like rectangle');
  // RS-1009 narrow carve-out: the per-type drag-move branch was replaced by a single
  // getLayerPosition()/setLayerPosition() pair used uniformly for every layer type (circle, text,
  // and rectangle/svg/image alike) -- see docs/specifications/RS-1009-AlignmentSnapping.md. svg
  // still moves exactly like rectangle/image: setLayerPosition() falls through to its x/y branch.
  assert.match(appJs, /function setLayerPosition\(l,xMm,yMm\)\{if\(l\.type==='circle'\)\{l\.cx=xMm;l\.cy=yMm\}else\{l\.x=xMm;l\.y=yMm\}\}/, 'expected setLayerPosition to move svg (and rectangle/image/text) via l.x/l.y');
  assert.match(appJs, /for\(const id of drag\.layerIds\)\{[\s\S]*?setLayerPosition\(l,p0\.xMm\+dx,p0\.yMm\+dy\)/, 'expected the move-drag path to apply positions via setLayerPosition');
  assert.match(appJs, /l\.type==='rectangle'\|\|l\.type==='svg'\|\|l\.type==='image'\)\{let x0=drag\.b0\.x/, 'expected drag-resize to treat svg like rectangle');
  assert.match(appJs, /if\(copy\.type==='svg'\)\{copy\.x\+=8;copy\.y\+=8\}/, 'expected duplicateLayer to nudge svg layers');
});

await test('8. no forbidden file changed (this milestone\'s own forbidden list)', () => {
  const output = execSync('git status --porcelain', { cwd: repoRoot, encoding: 'utf8' });
  const changedPaths = output
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => line.slice(3).trim());

  const forbiddenExact = new Set(['style.css', 'README.md', 'LICENSE', 'CONTRIBUTING.md']);
  // src/renderer/ is legitimately changed by S-001 (cup rendering/rotation stabilization) — see
  // tools/test-cup-rotation-stabilization.mjs for that milestone's own forbidden-file guard.
  // src/export/ is legitimately changed by RS-1005 (Production Sheet export) — see
  // tools/test-production-sheet-exporter.mjs for that milestone's own forbidden-file guard.
  const forbiddenPrefixes = ['src/text/', 'src/fonts/', 'src/core/', 'src/browser/', 'assets/', 'examples/'];

  for (const changedPath of changedPaths) {
    assert.ok(!forbiddenExact.has(changedPath), `Forbidden file changed: ${changedPath}`);
    assert.ok(
      !forbiddenPrefixes.some((prefix) => changedPath.startsWith(prefix)),
      `Forbidden file changed: ${changedPath}`
    );
  }
});

console.log('SVG integration tests passed.');
