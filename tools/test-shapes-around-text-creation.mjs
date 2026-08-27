import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GeometryEngine, computeContainingShapeScale } from '../src/geometry/index.js';
import { BoundingBox } from '../src/text/VectorPath.js';
import { getObjectTemplate, getSafeAreaRectMm } from '../src/products/index.js';
import { assertTestRegistered } from './lib/test-registration-assertions.mjs';

// S-110A (Smart Shape-to-Text Creation) — extracts and REALLY EXECUTES app.js's own
// referenceShapeLayer()/computeShapeAroundText()/shapeAroundTextFitsPrintableArea() (via
// `new Function`, injecting a real GeometryEngine/BoundingBox/computeContainingShapeScale/
// getSafeAreaRectMm/getObjectTemplate and a minimal mocked getLayerBBox() -- the one dependency that
// needs live `layout` state this standalone script doesn't construct), matching this repo's
// established app.js-testing convention (see e.g. tools/test-text-position-workflow.mjs's
// computeAutoFitScale extraction). Structural checks against createShapeLayer()/addText()/
// fitTextToShape() cover the parts that are too entangled with live app state to execute standalone.

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

const shapeDefaultSizesSrc = extractBlock(appJs, /const SHAPE_DEFAULT_SIZES_MM=\{[\s\S]*?\n\};/, 'SHAPE_DEFAULT_SIZES_MM');
const defaultShapeExtraFieldsSrc = extractBlock(appJs, /function defaultShapeExtraFields\(kind\)\{[\s\S]*?\n\}/, 'defaultShapeExtraFields()');
const shapeExtraParamsSrc = extractBlock(appJs, /function shapeExtraParams\(layer\)\{[\s\S]*?\n\}/, 'shapeExtraParams()');
const shapeLayerResolveParamsSrc = extractBlock(appJs, /function shapeLayerResolveParams\(layer\)\{[\s\S]*?\n\}/, 'shapeLayerResolveParams()');
const resolveShapeLayerPolygonsForFittingSrc = extractBlock(appJs, /function resolveShapeLayerPolygonsForFitting\(shapeLayer\)\{[\s\S]*?\n\}/, 'resolveShapeLayerPolygonsForFitting()');
const defaultCircleRadiusSrc = extractBlock(appJs, /const DEFAULT_CIRCLE_RADIUS_MM=\d+;/, 'DEFAULT_CIRCLE_RADIUS_MM');
const referenceShapeLayerSrc = extractBlock(appJs, /function referenceShapeLayer\(kind\)\{[\s\S]*?\n\}/, 'referenceShapeLayer()');
const computeShapeAroundTextSrc = extractBlock(appJs, /function computeShapeAroundText\(kind,textLayer\)\{[\s\S]*?\n\}/, 'computeShapeAroundText()');
const shapeAroundTextFitsPrintableAreaSrc = extractBlock(appJs, /function shapeAroundTextFitsPrintableArea\(sized\)\{[\s\S]*?\n\}/, 'shapeAroundTextFitsPrintableArea()');

const permanentEngine = new GeometryEngine();
const mugTemplate = getObjectTemplate('mug');
const project = { canvas: { width: 210, height: 90 } }; // matches defaultProject()'s own mug canvas
const currentObjectTemplate = () => mugTemplate;

function textLayerWithBBox(bbox, extra = {}) {
  return { stoneSize: 2, gap: 0.3, __bbox: bbox, ...extra };
}

function build() {
  const getLayerBBox = (l) => l.__bbox;
  // eslint-disable-next-line no-new-func
  return new Function(
    'permanentEngine', 'BoundingBox', 'computeContainingShapeScale', 'getLayerBBox', 'getSafeAreaRectMm', 'currentObjectTemplate', 'project',
    `
    ${shapeDefaultSizesSrc}
    ${defaultShapeExtraFieldsSrc}
    ${shapeExtraParamsSrc}
    ${shapeLayerResolveParamsSrc}
    ${resolveShapeLayerPolygonsForFittingSrc}
    ${defaultCircleRadiusSrc}
    ${referenceShapeLayerSrc}
    ${computeShapeAroundTextSrc}
    ${shapeAroundTextFitsPrintableAreaSrc}
    return { computeShapeAroundText, referenceShapeLayer, shapeAroundTextFitsPrintableArea, SHAPE_DEFAULT_SIZES_MM };
    `
  )(permanentEngine, BoundingBox, computeContainingShapeScale, getLayerBBox, getSafeAreaRectMm, currentObjectTemplate, project);
}

// A short-text bbox comfortably smaller than the mug's 182x70mm safe area.
const SHORT_TEXT_BBOX = { x: 95, y: 40, x2: 115, y2: 50, width: 20, height: 10 };
// A bbox wider than the mug's whole printable area (182mm) -- must trigger the fallback.
const HUGE_TEXT_BBOX = { x: -50, y: 30, x2: 250, y2: 60, width: 300, height: 30 };

// --- 1. computeShapeAroundText() ------------------------------------------------------------

await test('1. computeShapeAroundText() sizes a shape around short text for every required kind, centered on the text', () => {
  const { computeShapeAroundText } = build();
  for (const kind of ['circle', 'rectangle', 'ellipse', 'heart', 'star', 'ring']) {
    const text = textLayerWithBBox(SHORT_TEXT_BBOX);
    const sized = computeShapeAroundText(kind, text);
    assert.ok(sized, `${kind}: expected a computed size`);
    assert.ok(sized.widthMm > SHORT_TEXT_BBOX.width, `${kind}: shape must be wider than the bare text`);
    assert.ok(sized.heightMm > SHORT_TEXT_BBOX.height, `${kind}: shape must be taller than the bare text`);
    const expectedCenterX = SHORT_TEXT_BBOX.x + SHORT_TEXT_BBOX.width / 2;
    const expectedCenterY = SHORT_TEXT_BBOX.y + SHORT_TEXT_BBOX.height / 2;
    assert.ok(Math.abs(sized.centerXmm - expectedCenterX) < 1e-6, `${kind}: must be centered on the text's own center`);
    assert.ok(Math.abs(sized.centerYmm - expectedCenterY) < 1e-6, `${kind}: must be centered on the text's own center`);
  }
});

await test('2. computeShapeAroundText() includes a stone-pitch production margin, not an arbitrary pixel value', () => {
  const { computeShapeAroundText } = build();
  const tightSpacing = computeShapeAroundText('circle', textLayerWithBBox(SHORT_TEXT_BBOX, { stoneSize: 1.4, gap: 0.2 }));
  const wideSpacing = computeShapeAroundText('circle', textLayerWithBBox(SHORT_TEXT_BBOX, { stoneSize: 4, gap: 0.5 }));
  assert.ok(wideSpacing.widthMm > tightSpacing.widthMm, 'a larger stone size/gap must require a larger surrounding shape');
  // The margin is exactly one stone-pitch (stoneSize+gap) per side -- required width = text width + 2*spacing.
  const spacingMm = 1.4 + 0.2;
  const { referenceShapeLayer } = build();
  void referenceShapeLayer; // (imported for symmetry with other tests in this file; unused here)
  assert.ok(tightSpacing.widthMm > SHORT_TEXT_BBOX.width + 2 * spacingMm - 0.5, 'expected the required box to include a full stone-pitch margin per side, not a smaller pixel-ish value');
});

await test('3. computeShapeAroundText() returns null when the text has no rendered extent yet', () => {
  const { computeShapeAroundText } = build();
  assert.equal(computeShapeAroundText('circle', textLayerWithBBox({ x: 0, y: 0, x2: 0, y2: 0, width: 0, height: 0 })), null);
});

// --- 2. shapeAroundTextFitsPrintableArea() ----------------------------------------------------

await test('4. shapeAroundTextFitsPrintableArea() accepts a shape sized around short text and rejects one sized around oversized text', () => {
  const { computeShapeAroundText, shapeAroundTextFitsPrintableArea } = build();
  const shortSized = computeShapeAroundText('circle', textLayerWithBBox(SHORT_TEXT_BBOX));
  assert.equal(shapeAroundTextFitsPrintableArea(shortSized), true, 'a shape sized around short, centered text should fit the mug\'s printable area');

  const hugeSized = computeShapeAroundText('rectangle', textLayerWithBBox(HUGE_TEXT_BBOX));
  assert.equal(shapeAroundTextFitsPrintableArea(hugeSized), false, 'a shape sized around text wider than the whole printable area must be rejected');
});

await test('5. shapeAroundTextFitsPrintableArea() reuses getSafeAreaRectMm() -- the exact printable rectangle, not merely a size comparison', () => {
  const { computeShapeAroundText, shapeAroundTextFitsPrintableArea } = build();
  const safe = getSafeAreaRectMm(mugTemplate, project.canvas.width, project.canvas.height);
  // A shape centered far outside the safe area (near the canvas edge) must be rejected even if its
  // own size alone would fit within the safe area's width/height -- proving this is a true
  // positional containment check, not merely "is the shape smaller than the safe area".
  const edgeText = textLayerWithBBox({ x: 0, y: 40, x2: 10, y2: 50, width: 10, height: 10 });
  const sized = computeShapeAroundText('circle', edgeText);
  assert.ok(sized.widthMm < safe.widthMm, 'sanity check: the shape itself is smaller than the safe area');
  assert.equal(shapeAroundTextFitsPrintableArea(sized), false, 'a shape centered outside the safe area\'s own bounds must be rejected even if its size alone would fit');
});

// --- 3. Structural checks: createShapeLayer()/addText()/fitTextToShape() -----------------------

await test('6. createShapeLayer() computes the shape-around-text decision BEFORE commitHistory(), and only mutates the text layer in the fallback branch', () => {
  const fn = extractBlock(appJs, /async function createShapeLayer\(kind,extraFieldsOverride=\{\},displayLabelOverride=null\)\{[\s\S]*?\n\}/, 'createShapeLayer()');
  const commitIndex = fn.indexOf('commitHistory();');
  const sizedIndex = fn.indexOf('computeShapeAroundText(');
  const fitsIndex = fn.indexOf('shapeAroundTextFitsPrintableArea(');
  assert.ok(sizedIndex !== -1 && fitsIndex !== -1 && commitIndex !== -1);
  assert.ok(sizedIndex < commitIndex, 'computeShapeAroundText() must run before commitHistory() (a pure read, validated before any mutation)');
  assert.ok(fitsIndex < commitIndex, 'shapeAroundTextFitsPrintableArea() must run before commitHistory()');
  // The "sized around text" branch must never write to fitPartnerText -- it only reads
  // layerLabel(fitPartnerText) for the status message.
  const successBranch = fn.slice(fn.indexOf('if(shapeAroundText){'), fn.indexOf('}else if(fitPartnerText){'));
  assert.doesNotMatch(successBranch, /fitPartnerText\.\w+\s*=/, 'the shape-sized-around-text branch must never assign to any fitPartnerText field');
  assert.doesNotMatch(successBranch, /applyTextFitPlan/, 'the shape-sized-around-text branch must never call applyTextFitPlan()');
});

await test('7. createShapeLayer() still falls back to fitTextToShape()/applyTextFitPlan() -- the unmodified S-110 workflow -- when the shape would not fit', () => {
  const fn = extractBlock(appJs, /async function createShapeLayer\(kind,extraFieldsOverride=\{\},displayLabelOverride=null\)\{[\s\S]*?\n\}/, 'createShapeLayer()');
  assert.match(fn, /await fitTextToShape\(fitPartnerText,layer\)/);
  assert.match(fn, /applyTextFitPlan\(fitPartnerText,plan\)/);
  assert.match(fn, /shapeAroundTextRejected/, 'expected a distinct flag explaining a rejected shape-around-text attempt');
});

await test('8. fitTextToShape()/applyTextFitPlan()/addText() are untouched by S-110A -- the explicit "Fit Text to Shape" command and text-creation-while-shape-selected workflow are unchanged', () => {
  // Byte-identical to the S-110 implementation (no reference to the new shape-around-text helpers).
  const fitTextToShapeFn = extractBlock(appJs, /async function fitTextToShape\(textLayer,shapeLayer\)\{[\s\S]*?\n\}/, 'fitTextToShape()');
  assert.doesNotMatch(fitTextToShapeFn, /computeShapeAroundText|shapeAroundTextFitsPrintableArea|referenceShapeLayer/);
  const addTextFn = extractBlock(appJs, /async function addText\(\)\{[\s\S]*?\n\}/, 'addText()');
  assert.doesNotMatch(addTextFn, /computeShapeAroundText|shapeAroundTextFitsPrintableArea|referenceShapeLayer/, 'addText() (create text while a shape is selected) is a different workflow, unaffected by S-110A');
});

await test('9. no new "Fit Shape to Text" command was introduced, and no hidden link field is stored on either layer', () => {
  assert.doesNotMatch(appJs, /Fit Shape to Text/i);
  assert.doesNotMatch(indexHtml, /Fit Shape to Text/i);
  assert.doesNotMatch(indexHtml, /id="fitShapeToText/i);
  for (const forbiddenField of ['linkedTextId', 'linkedShapeId', 'parentLayerId', 'associatedLayerId', 'sizedAroundLayerId']) {
    assert.doesNotMatch(appJs, new RegExp(forbiddenField));
  }
});

await test('10. this milestone\'s test file is registered in test:integration and the default suite (via tools/test-groups.mjs + tools/run-tests.mjs, not a literal package.json chain)', () => {
  assertTestRegistered({
    filename: 'test-shapes-around-text-creation.mjs',
    group: 'integration',
    includedInDefault: true,
  });
});

console.log('Smart Shape-to-Text Creation (S-110A) tests passed.');
