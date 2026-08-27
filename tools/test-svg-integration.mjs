import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
  // RS-1011: mode now widens through resolveVectorFillMode() (staggered/radial/contour, not just
  // outline/fill) instead of the old two-value inline ternary -- see
  // docs/specifications/RS-1011-FillAlgorithms.md.
  assert.match(appJs, /mode:resolveVectorFillMode\(layer\.mode\)/);
});

await test('3. app.js imports parseSvgDocument from src/svg/index.js for pre-import validation, not a reimplemented parser', () => {
  assert.match(appJs, /import\s*\{\s*parseSvgDocument\s*\}\s*from\s*['"]\.\/src\/svg\/index\.js['"]/);
  assert.match(appJs, /parseSvgDocument\(svgSource\)/, 'expected the importSvgFile handler to call parseSvgDocument');
});

await test('4. index.html exposes the #importSvg button, #importSvgFile file input, and #svgControls/#svgMode', () => {
  assert.match(indexHtml, /<button id="importSvg"/);
  assert.match(indexHtml, /<input id="importSvgFile" type="file"/);
  assert.match(indexHtml, /<div id="svgControls"/);
  assert.match(indexHtml, /<select id="svgMode"/);
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
  // S-112: validateProject() also calls normalizePlateParams() (project.plate's own
  // permissive-default normalizer) -- injected as a function parameter for the same reason
  // getObjectTemplate is above.
  const { getObjectTemplate, normalizePlateParams, VESSEL_PRODUCT_IDS, getVesselDefaults, normalizeVesselParams, deriveLegacyVesselParams, computeCanvasFromVessel } = await import('../src/products/index.js');
  // S-110: validateProject() also references the module-level XYWH_SHAPE_TYPES constant, and the
  // extracted slice's own SUPPORTED_LAYER_TYPES declaration spreads SHAPE_LIBRARY_KINDS (both
  // declared well before this extracted slice begins) -- both injected as function parameters for
  // the same reason getObjectTemplate is above.
  const { SHAPE_LIBRARY_KINDS } = await import('../src/geometry/index.js');
  const XYWH_SHAPE_TYPES = new Set(['rectangle', 'svg', 'image', 'path', ...SHAPE_LIBRARY_KINDS]);
  // RS-2010: validateProject() also references VESSEL_PRODUCT_IDS/getVesselDefaults/
  // normalizeVesselParams/deriveLegacyVesselParams -- injected for the same reason
  // normalizePlateParams is above.
  // eslint-disable-next-line no-new-func
  const validateProject = new Function(
    'getObjectTemplate', 'normalizePlateParams', 'XYWH_SHAPE_TYPES', 'SHAPE_LIBRARY_KINDS',
    'VESSEL_PRODUCT_IDS', 'getVesselDefaults', 'normalizeVesselParams', 'deriveLegacyVesselParams', 'computeCanvasFromVessel',
    `${source}\nreturn validateProject;`
  )(getObjectTemplate, normalizePlateParams, XYWH_SHAPE_TYPES, SHAPE_LIBRARY_KINDS, VESSEL_PRODUCT_IDS, getVesselDefaults, normalizeVesselParams, deriveLegacyVesselParams, computeCanvasFromVessel);

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
  // RS-1008 extended these same shared branches to also cover 'image' layers, RS-1012 extended them
  // again to also cover 'path' layers (Boolean Operation results), and S-110 generalized the whole
  // `l.type==='rectangle'||l.type==='svg'||l.type==='image'||l.type==='path'` union (plus nine new
  // shape kinds) into one shared XYWH_SHAPE_TYPES set -- the svg case itself is unchanged, just
  // expressed via that set's membership test instead of an inline `||` chain. See
  // tools/test-image-integration.mjs for the RS-1008-specific assertions and
  // tools/test-path-boolean-integration.mjs for the RS-1012-specific assertions against the same lines.
  // fix/rotated-layer-bbox-hittest extended this same branch again, to route it through
  // rotatedCornersAABB() so a rotated shape's bbox reflects its true rotated footprint -- a no-op at
  // 0deg, so svg's own unrotated bbox is unchanged.
  assert.match(appJs, /if\(XYWH_SHAPE_TYPES\.has\(l\.type\)\)return rotatedCornersAABB\(l\.x,l\.y,l\.w,l\.h,l\.rotationDeg\|\|0\);/, 'expected getLayerBBox to route svg through rotatedCornersAABB like every other XYWH type');
  // RS-1009 narrow carve-out: the per-type drag-move branch was replaced by a single
  // getLayerPosition()/setLayerPosition() pair used uniformly for every layer type (circle, text,
  // and rectangle/svg/image alike) -- see docs/specifications/RS-1009-AlignmentSnapping.md. svg
  // still moves exactly like rectangle/image: setLayerPosition() falls through to its x/y branch.
  assert.match(appJs, /function setLayerPosition\(l,xMm,yMm\)\{if\(l\.type==='circle'\)\{l\.cx=xMm;l\.cy=yMm\}else\{l\.x=xMm;l\.y=yMm\}\}/, 'expected setLayerPosition to move svg (and rectangle/image/text) via l.x/l.y');
  assert.match(appJs, /for\(const id of drag\.layerIds\)\{[\s\S]*?setLayerPosition\(l,p0\.xMm\+dx,p0\.yMm\+dy\)/, 'expected the move-drag path to apply positions via setLayerPosition');
  // RS-3030: the unrotated fast path picked up an `&&!drag.rotationDeg` guard (the rotated case
  // now branches to its own local-axis resize algorithm, see the milestone doc) -- svg still isn't
  // special-cased, it's still gated purely by XYWH_SHAPE_TYPES membership like rectangle/image/path.
  assert.match(appJs, /XYWH_SHAPE_TYPES\.has\(l\.type\)(?:&&[^)]*)?\)\{let x0=drag\.b0\.x/, 'expected drag-resize to treat svg like rectangle');
  // RS-3011 Step 2 added a drawingTool.duplicateShapeForLayer() call inside this same branch (so a
  // Design-drawn 'path' shape's Paper.js item gets cloned alongside the layer) -- this checks the
  // enduring invariant (XYWH_SHAPE_TYPES.has(copy.type) still gates an x/y offset assignment for
  // copy) rather than the exact old one-liner, so it doesn't re-break on the next legitimate edit
  // inside this block.
  assert.match(appJs, /if\(XYWH_SHAPE_TYPES\.has\(copy\.type\)\)\{[^}]*copy\.x\s*\+=[^;]+;[^}]*copy\.y\s*\+=[^;]+;[^}]*\}/, 'expected duplicateLayer to nudge svg layers');
});
console.log('SVG integration tests passed.');
