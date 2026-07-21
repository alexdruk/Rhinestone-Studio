import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertTestRegistered } from './lib/test-registration-assertions.mjs';

// S-110 (Expanded Shape Library & Smart Text-to-Shape Fitting) — structural proof for app.js/
// index.html, mirroring this repo's existing convention for testing app.js (no DOM/jsdom
// available; extract a specific function's source text via regex, then either execute it in
// isolation via `new Function` for small pure helpers, or assert on its structure/call-sites for
// helpers that are too entangled with live app state to run standalone -- see e.g.
// tools/test-text-position-workflow.mjs's own extractBlock()+`new Function` pattern).

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

function extractBlock(source, pattern, label) {
  const match = source.match(pattern);
  assert.ok(match, `expected to find ${label} in app.js`);
  return match[0];
}

const SHAPE_KINDS = ['circle', 'rectangle', 'ellipse', 'capsule', 'polygon', 'star', 'heart', 'arrow', 'cross', 'crescent', 'ring'];

// ---------------------------------------------------------------------------------------------
// 1. No duplicate Circle/Rectangle creation controls remain
// ---------------------------------------------------------------------------------------------

await test('1. the old left-panel #addCircle/#addRect buttons no longer exist in index.html', () => {
  assert.doesNotMatch(indexHtml, /id="addCircle"/);
  assert.doesNotMatch(indexHtml, /id="addRect"/);
});

await test('2. the old proxy #addCircleLightbox/#addRectLightbox buttons no longer exist, and app.js has no dangling references to any of the four old ids', () => {
  assert.doesNotMatch(indexHtml, /id="addCircleLightbox"/);
  assert.doesNotMatch(indexHtml, /id="addRectLightbox"/);
  for (const id of ['addCircle', 'addRect', 'addCircleLightbox', 'addRectLightbox']) {
    assert.doesNotMatch(appJs, new RegExp(`el\\('${id}'\\)`), `app.js must not reference el('${id}') any more`);
  }
});

await test('3. Circle and Rectangle are created only via the unified Design Shapes grid (one creation function, one set of buttons)', () => {
  assert.match(appJs, /async function createShapeLayer\(kind\)\{/, 'expected one unified createShapeLayer(kind) function');
  // S-110A: every 'circle' layer-object literal must live inside createShapeLayer() itself (its two
  // size branches -- sized-around-text vs. default) or referenceShapeLayer() (a measurement-only
  // object, never pushed to project.layers, used to size a shape around existing text) -- never a
  // second, independent circle-creation code path anywhere else in app.js.
  const createShapeLayerFn = appJs.match(/async function createShapeLayer\(kind\)\{[\s\S]*?\n\}/);
  const referenceShapeLayerFn = appJs.match(/function referenceShapeLayer\(kind\)\{[\s\S]*?\n\}/);
  assert.ok(createShapeLayerFn, 'expected to find createShapeLayer()');
  assert.ok(referenceShapeLayerFn, 'expected to find referenceShapeLayer()');
  const totalCircleLiterals = (appJs.match(/type:'circle'/g) || []).length;
  const inCreateShapeLayer = (createShapeLayerFn[0].match(/type:'circle'/g) || []).length;
  const inReferenceShapeLayer = (referenceShapeLayerFn[0].match(/type:'circle'/g) || []).length;
  assert.equal(totalCircleLiterals, inCreateShapeLayer + inReferenceShapeLayer, 'expected every circle layer-object literal to live inside createShapeLayer() or referenceShapeLayer(), not a third, independent code path');
});

// ---------------------------------------------------------------------------------------------
// 2. Shapes -> Design Shapes contains all 11 shapes, Object Templates stays separate
// ---------------------------------------------------------------------------------------------

await test('4. index.html\'s Design Shapes grid (#shapeGrid) lists exactly the 11 required shapes, each with a data-shape-kind', () => {
  const gridMatch = indexHtml.match(/<div class="shape-grid" id="shapeGrid">([\s\S]*?)<\/div>\s*<\/div>/);
  assert.ok(gridMatch, 'expected to find #shapeGrid in index.html');
  const grid = gridMatch[1];
  const kinds = [...grid.matchAll(/data-shape-kind="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(kinds.sort(), [...SHAPE_KINDS].sort(), 'expected exactly the 11 required shape kinds, no more, no fewer');
});

await test('5. Object Templates (Mug/Tumbler/Bottle, wrap mode) markup is unchanged and still contains none of the 11 shape kinds', () => {
  const templatesMatch = indexHtml.match(/<div class="lightbox-tab-panel" id="shapesPanelTemplates"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<footer/);
  assert.ok(templatesMatch, 'expected to find #shapesPanelTemplates in index.html');
  const templatesPanel = templatesMatch[1];
  assert.match(templatesPanel, /Mug/);
  assert.match(templatesPanel, /Straight Tumbler/);
  assert.match(templatesPanel, /Bottle/);
  for (const kind of ['data-shape-kind', 'shapeGrid']) {
    assert.doesNotMatch(templatesPanel, new RegExp(kind), `Object Templates must not contain Design Shapes' ${kind}`);
  }
});

// ---------------------------------------------------------------------------------------------
// 3. Every shape kind is wired into the shared, generic layer-type-union constants
// ---------------------------------------------------------------------------------------------

await test('6. XYWH_SHAPE_TYPES/SHAPE_LAYER_TYPES/VECTOR_FILL_MODE_TYPES all include every new shape kind (via SHAPE_LIBRARY_KINDS), and gate getLayerBBox/duplicateLayer/resolveLayerShapeSource/generate()', () => {
  assert.match(appJs, /const SHAPE_LAYER_TYPES=new Set\(\['circle','rectangle',\.\.\.SHAPE_LIBRARY_KINDS\]\);/);
  assert.match(appJs, /const XYWH_SHAPE_TYPES=new Set\(\['rectangle','svg','image','path',\.\.\.SHAPE_LIBRARY_KINDS\]\);/);
  assert.match(appJs, /const VECTOR_FILL_MODE_TYPES=new Set\(\['circle','rectangle','path',\.\.\.SHAPE_LIBRARY_KINDS\]\);/);

  const getLayerBBoxSrc = extractBlock(appJs, /function getLayerBBox\(l\)\{[\s\S]*?\n\}/, 'function getLayerBBox()');
  assert.match(getLayerBBoxSrc, /XYWH_SHAPE_TYPES\.has\(l\.type\)/);

  const duplicateLayerSrc = extractBlock(appJs, /function duplicateLayer\(id\)\{[\s\S]*?\n\}/, 'function duplicateLayer()');
  assert.match(duplicateLayerSrc, /XYWH_SHAPE_TYPES\.has\(copy\.type\)/);

  const resolveSrc = extractBlock(appJs, /async function resolveLayerShapeSource\(layer\)\{[\s\S]*?\n\}/, 'function resolveLayerShapeSource()');
  assert.match(resolveSrc, /SHAPE_LAYER_TYPES\.has\(layer\.type\)/);

  const generateSrc = extractBlock(appJs, / async generate\(project\)\{[\s\S]*?return new StoneLayout\(\{layerId:'project',stones\}\)\}/, 'GeometryEngine.generate()');
  assert.match(generateSrc, /SHAPE_LAYER_TYPES\.has\(l\.type\)/);
});

await test('7. SUPPORTED_LAYER_TYPES and validateProject() both accept every new shape kind, with configurable-shape-specific checks for Regular Polygon/Star/Ring', () => {
  assert.match(appJs, /const SUPPORTED_LAYER_TYPES=new Set\(\['text','circle','rectangle','svg','image','path',\.\.\.SHAPE_LIBRARY_KINDS\]\);/);
  const validateProjectSrc = extractBlock(appJs, /function validateProject\(obj\)\{[\s\S]*?\n\}/, 'function validateProject()');
  assert.match(validateProjectSrc, /XYWH_SHAPE_TYPES\.has\(l\.type\)/);
  assert.match(validateProjectSrc, /l\.type==='polygon'/);
  assert.match(validateProjectSrc, /l\.type==='star'/);
  assert.match(validateProjectSrc, /l\.type==='ring'/);
});

// ---------------------------------------------------------------------------------------------
// 4. Pure per-shape helper functions behave correctly when executed in isolation
// ---------------------------------------------------------------------------------------------

await test('8. defaultShapeExtraFields()/shapeExtraParams() round-trip Regular Polygon/Star/Ring\'s configurable fields correctly', () => {
  const defaultsSrc = extractBlock(appJs, /function defaultShapeExtraFields\(kind\)\{[\s\S]*?\n\}/, 'function defaultShapeExtraFields()');
  const extraParamsSrc = extractBlock(appJs, /function shapeExtraParams\(layer\)\{[\s\S]*?\n\}/, 'function shapeExtraParams()');
  // eslint-disable-next-line no-new-func
  const { defaultShapeExtraFields, shapeExtraParams } = new Function(`
    ${defaultsSrc}
    ${extraParamsSrc}
    return { defaultShapeExtraFields, shapeExtraParams };
  `)();

  assert.deepEqual(defaultShapeExtraFields('polygon'), { sides: 6 });
  assert.deepEqual(defaultShapeExtraFields('star'), { points: 5, innerRadiusRatio: 0.5 });
  assert.deepEqual(defaultShapeExtraFields('ring'), { innerRatio: 0.5 });
  assert.deepEqual(defaultShapeExtraFields('heart'), {});
  assert.deepEqual(defaultShapeExtraFields('rectangle'), {});

  assert.deepEqual(shapeExtraParams({ type: 'polygon', sides: 9 }), { sides: 9 });
  assert.deepEqual(shapeExtraParams({ type: 'star', points: 7, innerRadiusRatio: 0.3 }), { points: 7, innerRadiusRatio: 0.3 });
  assert.deepEqual(shapeExtraParams({ type: 'ring', innerRatio: 0.7 }), { innerRatio: 0.7 });
  assert.deepEqual(shapeExtraParams({ type: 'ellipse' }), {});
});

await test('9. shapeLayerResolveParams() builds Circle\'s cx/cy/r vs. every other kind\'s x/y/w/h, plus configurable extras', () => {
  const extraParamsSrc = extractBlock(appJs, /function shapeExtraParams\(layer\)\{[\s\S]*?\n\}/, 'function shapeExtraParams()');
  const resolveParamsSrc = extractBlock(appJs, /function shapeLayerResolveParams\(layer\)\{[\s\S]*?\n\}/, 'function shapeLayerResolveParams()');
  // eslint-disable-next-line no-new-func
  const { shapeLayerResolveParams } = new Function(`
    ${extraParamsSrc}
    ${resolveParamsSrc}
    return { shapeLayerResolveParams };
  `)();

  assert.deepEqual(
    shapeLayerResolveParams({ type: 'circle', id: 'c1', cx: 10, cy: 20, r: 5 }),
    { shape: 'circle', layerId: 'c1', cxMm: 10, cyMm: 20, radiusMm: 5 }
  );
  assert.deepEqual(
    shapeLayerResolveParams({ type: 'ellipse', id: 'e1', x: 1, y: 2, w: 30, h: 40 }),
    { shape: 'ellipse', layerId: 'e1', xMm: 1, yMm: 2, widthMm: 30, heightMm: 40 }
  );
  assert.deepEqual(
    shapeLayerResolveParams({ type: 'star', id: 's1', x: 0, y: 0, w: 50, h: 50, points: 6, innerRadiusRatio: 0.6 }),
    { shape: 'star', layerId: 's1', xMm: 0, yMm: 0, widthMm: 50, heightMm: 50, points: 6, innerRadiusRatio: 0.6 }
  );
});

// ---------------------------------------------------------------------------------------------
// 5. Smart Text-to-Shape Fitting: structural wiring
// ---------------------------------------------------------------------------------------------

await test('10. fitTextToShape() aborts (without mutating) for curved text and for a non-FITTABLE_SHAPE_TYPES shape, before doing any geometry work', () => {
  const fitSrc = extractBlock(appJs, /async function fitTextToShape\(textLayer,shapeLayer\)\{[\s\S]*?\n\}/, 'function fitTextToShape()');
  assert.match(fitSrc, /if\(textLayer\.curveEnabled\)\{/, 'must check curveEnabled first');
  assert.match(fitSrc, /reason:'curved'/);
  assert.match(fitSrc, /!FITTABLE_SHAPE_TYPES\.has\(shapeLayer\.type\)/, 'must check shape compatibility before resolving geometry');
  assert.match(fitSrc, /reason:'incompatible'/);
  assert.match(fitSrc, /reason:'legibility'/);
  // A pure "compute a plan" function: it must never assign to textLayer.* itself (mutation is
  // applyTextFitPlan()'s job, called only by the three explicit call sites below), so a failed fit
  // can never leave a partial write behind.
  assert.doesNotMatch(fitSrc, /textLayer\.(height|x|y)\s*=/);
});

await test('11. applyTextFitPlan() writes only height/x/y -- never font/stoneSize/gap/fillMode/color/curve fields', () => {
  const applySrc = extractBlock(appJs, /function applyTextFitPlan\(textLayer,plan\)\{[\s\S]*?\}/, 'function applyTextFitPlan()');
  assert.match(applySrc, /textLayer\.height=plan\.heightMm/);
  assert.match(applySrc, /textLayer\.x=plan\.xMm/);
  assert.match(applySrc, /textLayer\.y=plan\.yMm/);
  for (const forbiddenField of ['font', 'stoneSize', 'gap', 'fillMode', 'color', 'curveEnabled']) {
    assert.doesNotMatch(applySrc, new RegExp(`textLayer\\.${forbiddenField}\\s*=`));
  }
});

await test('12. Ring\'s fitting region is its inner opening alone (not the true annulus Boolean Operations use)', () => {
  const src = extractBlock(appJs, /function resolveShapeLayerPolygonsForFitting\(shapeLayer\)\{[\s\S]*?\n\}/, 'function resolveShapeLayerPolygonsForFitting()');
  assert.match(src, /shapeLayer\.type==='ring'/);
  assert.match(src, /polygons\[1\]/, 'expected the inner (index 1) contour to be selected for Ring fitting');
});

await test('13. createShapeLayer()/addText() each auto-fit only when exactly one OTHER layer is selected, and never persist a link between the two layers', () => {
  const createShapeSrc = extractBlock(appJs, /async function createShapeLayer\(kind\)\{[\s\S]*?\n\}/, 'function createShapeLayer()');
  assert.match(createShapeSrc, /singleOtherSelectedLayer\(\)/);
  assert.match(createShapeSrc, /other\.type==='text'/);
  assert.match(createShapeSrc, /FITTABLE_SHAPE_TYPES\.has\(kind\)/);
  assert.match(createShapeSrc, /fitTextToShape\(fitPartnerText,layer\)/);

  const addTextSrc = extractBlock(appJs, /async function addText\(\)\{[\s\S]*?\n\}/, 'function addText()');
  assert.match(addTextSrc, /singleOtherSelectedLayer\(\)/);
  assert.match(addTextSrc, /FITTABLE_SHAPE_TYPES\.has\(other\.type\)/);
  assert.match(addTextSrc, /fitTextToShape\(layer,fitPartnerShape\)/);

  // Neither creation function (nor the layer schema itself) ever writes a cross-layer reference
  // field -- fitting is a one-shot value copy, never a stored relationship.
  for (const fn of [createShapeSrc, addTextSrc]) {
    for (const forbiddenField of ['linkedLayerId', 'parentLayerId', 'associatedLayerId', 'groupId']) {
      assert.doesNotMatch(fn, new RegExp(forbiddenField));
    }
  }
});

await test('14. the explicit "Fit Text to Shape" button validates fully (commitHistory() only after success, mirroring runBooleanOp()\'s own convention) and the Add Text button exists', () => {
  assert.match(indexHtml, /id="fitTextToShapeBtn"/);
  assert.match(indexHtml, /id="addTextBtn"/);
  const clickHandlerSrc = extractBlock(appJs, /el\('fitTextToShapeBtn'\)\.onclick=async\(\)=>\{[\s\S]*?\n\};/, 'the #fitTextToShapeBtn click handler');
  const commitIndex = clickHandlerSrc.indexOf('commitHistory()');
  const planIndex = clickHandlerSrc.indexOf('const plan=await fitTextToShape');
  const applyIndex = clickHandlerSrc.indexOf('applyTextFitPlan(');
  assert.ok(planIndex !== -1 && commitIndex !== -1 && applyIndex !== -1, 'expected plan computation, commitHistory(), and applyTextFitPlan() all present');
  assert.ok(planIndex < commitIndex, 'the fit must be computed before commitHistory() is called');
  assert.ok(commitIndex < applyIndex, 'commitHistory() must run before the plan is applied');
});

await test('15. updateEditingUI() enables Fit Text to Shape only for a valid (exactly one text + one other layer) selection', () => {
  const src = extractBlock(appJs, /function updateEditingUI\(\)\{[\s\S]*?\n\}/, 'function updateEditingUI()');
  assert.match(src, /fitTextToShapeSelection\(\)/);
  assert.match(src, /el\('fitTextToShapeBtn'\)\.disabled=fitDisabled/);
});

// ---------------------------------------------------------------------------------------------
// 6. every new S-110 test file is registered in the correct suite/group (via
//    tools/test-groups.mjs + tools/run-tests.mjs, not a literal package.json chain)
// ---------------------------------------------------------------------------------------------

await test('16. every new S-110 test file is registered in its group and the default suite', () => {
  for (const { filename, group } of [
    { filename: 'test-shape-library.mjs', group: 'core' },
    { filename: 'test-shape-fit.mjs', group: 'core' },
    { filename: 'test-shape-library-integration.mjs', group: 'core' },
    { filename: 'test-shapes-design-consolidation.mjs', group: 'integration' },
  ]) {
    assertTestRegistered({ filename, group, includedInDefault: true });
  }
});

console.log('Design Shapes Consolidation (S-110) tests passed.');
