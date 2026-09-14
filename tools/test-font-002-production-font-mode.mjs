/**
 * FONT-002 (Production Font Mode) -- behavioral regression tests for the app.js-level changes this
 * milestone made, extracted and REALLY EXECUTED via `new Function` (matching this repo's established
 * app.js-testing convention -- see tools/test-shapes-around-text-creation.mjs / memory
 * `rhinestone-studio-conventions`), not just re-derived assumptions about behavior.
 *
 * Covers exactly the gap TXT-103A's audit flagged and this milestone was asked to close: selecting
 * an authored-stone-center-font (RS Block/RS Modern) text layer and clicking "Fit Text to Shape"
 * must return a clean `{ok:false,...}` with a clear message, never throw/reject unhandled. Also
 * covers the "unavailable font" fix (no silent substitution) and the isAuthoredStoneFontId/
 * isFontKnown capability helpers every other FONT-002 UI gate reads.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GeometryEngine, FITTABLE_SHAPE_TYPES, computeInscribedRect, computeShapeFitScale, MIN_HEIGHT_TO_STONE_RATIO } from '../src/geometry/index.js';
import { computeTextLayerPositionForTargetCenterMm } from '../src/editing/index.js';
import { BoundingBox } from '../src/text/VectorPath.js';
import { FontManager } from '../src/fonts/index.js';
import { createDefaultFontProviderRegistry } from '../src/text/index.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');
const manifest = JSON.parse(await readFile(path.join(repoRoot, 'assets/fonts/manifest.json'), 'utf8'));

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

// These four are one-liners packed on a shared physical line with neighboring functions (app.js is
// deliberately dense -- see memory rhinestone-studio-conventions), so `\n\}` (used below for
// genuinely multi-line functions) would never match on the same line and would overshoot forward to
// the next occurrence anywhere in the file. None of these bodies contain a literal `{`/`}` of their
// own, so a non-greedy `.*?\}` (single-line only, since `.` excludes `\n`) stops at exactly their own
// closing brace instead.
const resolveFontProviderIdSrc = extractBlock(appJs, /function resolveFontProviderId\(fontId\)\{.*?\}/, 'resolveFontProviderId()');
const isAuthoredStoneFontIdSrc = extractBlock(appJs, /function isAuthoredStoneFontId\(fontId\)\{.*?\}/, 'isAuthoredStoneFontId()');
const isFontKnownSrc = extractBlock(appJs, /function isFontKnown\(fontId\)\{.*?\}/, 'isFontKnown()');
const shapeDisplayLabelsSrc = extractBlock(appJs, /const SHAPE_DISPLAY_LABELS=\{[\s\S]*?\n\};/, 'SHAPE_DISPLAY_LABELS');
const shapeExtraParamsSrc = extractBlock(appJs, /function shapeExtraParams\(layer\)\{[\s\S]*?\n\}/, 'shapeExtraParams()');
const shapeLayerResolveParamsSrc = extractBlock(appJs, /function shapeLayerResolveParams\(layer\)\{[\s\S]*?\n\}/, 'shapeLayerResolveParams()');
const resolveShapeLayerPolygonsForFittingSrc = extractBlock(appJs, /function resolveShapeLayerPolygonsForFitting\(shapeLayer\)\{[\s\S]*?\n\}/, 'resolveShapeLayerPolygonsForFitting()');
const layerLabelSrc = extractBlock(appJs, /function layerLabel\(l\)\{.*?\}/, 'layerLabel()');
// READ-009 moved the MIN_HEIGHT_TO_STONE_RATIO declaration itself into src/geometry/TextAutoFit.js
// (app.js now imports it); fitTextToShape()'s body still reads it as a free variable unchanged, so
// it's redeclared here from the real imported value rather than sliced out of app.js source.
const minRatioSrc = `const MIN_HEIGHT_TO_STONE_RATIO=${MIN_HEIGHT_TO_STONE_RATIO};`;
const fitTextToShapeSrc = extractBlock(appJs, /async function fitTextToShape\(textLayer,shapeLayer\)\{[\s\S]*?\n\}/, 'fitTextToShape()');

const fontManager = new FontManager(manifest);
const fontProviderRegistry = createDefaultFontProviderRegistry(fontManager);
const permanentEngine = new GeometryEngine({ fontProviderRegistry });
const project = { canvas: { width: 210, height: 90 } }; // matches defaultProject()'s own mug canvas
// FONT-002: fitTextToShape() falls back to DEFAULT_TEXT_FONT_ID for a font id TEXT_ENGINE_FONT_IDS
// doesn't recognize as *known* -- mirrored here exactly as app.js's own `TEXT_ENGINE_FONT_IDS.has(...)
// ? ... : DEFAULT_TEXT_FONT_ID` pattern, since that constant/set aren't part of the extracted source.
const DEFAULT_TEXT_FONT_ID = 'rs-block';
const TEXT_ENGINE_FONT_IDS = new Set(fontManager.listFonts().map((f) => f.id));

// eslint-disable-next-line no-new-func
function build() {
  return new Function(
    'permanentEngine', 'fontManager', 'project', 'BoundingBox', 'FITTABLE_SHAPE_TYPES', 'computeInscribedRect', 'computeShapeFitScale',
    'TEXT_ENGINE_FONT_IDS', 'DEFAULT_TEXT_FONT_ID', 'computeTextLayerPositionForTargetCenterMm',
    `
    ${resolveFontProviderIdSrc}
    ${isAuthoredStoneFontIdSrc}
    ${isFontKnownSrc}
    ${shapeDisplayLabelsSrc}
    ${shapeExtraParamsSrc}
    ${shapeLayerResolveParamsSrc}
    ${resolveShapeLayerPolygonsForFittingSrc}
    ${layerLabelSrc}
    ${minRatioSrc}
    ${fitTextToShapeSrc}
    return { fitTextToShape, isAuthoredStoneFontId, isFontKnown, resolveFontProviderId };
    `
  )(permanentEngine, fontManager, project, BoundingBox, FITTABLE_SHAPE_TYPES, computeInscribedRect, computeShapeFitScale, TEXT_ENGINE_FONT_IDS, DEFAULT_TEXT_FONT_ID, computeTextLayerPositionForTargetCenterMm);
}

const { fitTextToShape, isAuthoredStoneFontId, isFontKnown, resolveFontProviderId } = build();

// READ-008: the legibility floor is now 16 x stone diameter (was 6 x stone pitch), so a legible
// 'Alex' at a 2.8mm stone needs >= 44.8mm of height -- the rectangle and the text layer's default
// height are sized so test 6's end-to-end fit has real room, rather than tripping the raised floor.
const RECTANGLE_SHAPE = { id: 'shape1', type: 'rectangle', x: 10, y: 5, w: 180, h: 80, stoneSize: 2.8, gap: 0.3 };

function textLayer(overrides = {}) {
  return {
    id: 'text1', type: 'text', text: 'Alex', font: 'rs-block', height: 50, stoneSize: 2.8, gap: 0.3,
    curveEnabled: false, ...overrides
  };
}

// ---------------------------------------------------------------------------------------------
// 1. isAuthoredStoneFontId() / isFontKnown() / resolveFontProviderId()
// ---------------------------------------------------------------------------------------------

await test('1. isAuthoredStoneFontId() is true for both Production Fonts, false for legacy OpenType and unknown ids', () => {
  assert.equal(isAuthoredStoneFontId('rs-block'), true);
  assert.equal(isAuthoredStoneFontId('rs-modern'), true);
  assert.equal(isAuthoredStoneFontId('courier-prime-regular'), false);
  assert.equal(isAuthoredStoneFontId('totally-unknown-font-id'), false);
});

await test('2. isFontKnown() distinguishes legacy-but-known from genuinely unknown font ids', () => {
  assert.equal(isFontKnown('courier-prime-regular'), true);
  assert.equal(isFontKnown('rs-block'), true);
  assert.equal(isFontKnown('totally-unknown-font-id'), false);
});

await test('3. resolveFontProviderId() falls back to opentype for an unknown id (unchanged pre-FONT-002 behavior)', () => {
  assert.equal(resolveFontProviderId('totally-unknown-font-id'), 'opentype');
});

// ---------------------------------------------------------------------------------------------
// 2. fitTextToShape() against Production Fonts -- the audit-flagged crash gap (TXT-103A), now fixed
// ---------------------------------------------------------------------------------------------

await test('4. fitTextToShape() against an RS Block text layer returns a clean {ok:false} rejection, never throws', async () => {
  const plan = await fitTextToShape(textLayer({ font: 'rs-block' }), RECTANGLE_SHAPE);
  assert.equal(plan.ok, false);
  assert.equal(plan.reason, 'fixed-size');
  assert.match(plan.message, /Production Font/);
});

await test('5. fitTextToShape() against an RS Modern text layer returns a clean {ok:false} rejection, never throws', async () => {
  const plan = await fitTextToShape(textLayer({ font: 'rs-modern' }), RECTANGLE_SHAPE);
  assert.equal(plan.ok, false);
  assert.equal(plan.reason, 'fixed-size');
  assert.match(plan.message, /Production Font/);
});

await test('6. fitTextToShape() against a legacy OpenType text layer still works end-to-end (unaffected by the Production Font gate)', async () => {
  const plan = await fitTextToShape(textLayer({ font: 'courier-prime-regular' }), RECTANGLE_SHAPE);
  assert.equal(plan.ok, true);
  assert.ok(Number.isFinite(plan.heightMm) && plan.heightMm > 0);
});

await test('7. fitTextToShape() against a text layer with a genuinely unknown font id returns {ok:false} instead of throwing or substituting a font', async () => {
  const plan = await fitTextToShape(textLayer({ font: 'totally-unknown-font-id' }), RECTANGLE_SHAPE);
  assert.equal(plan.ok, false);
  assert.equal(plan.reason, 'empty-text');
});

console.log('FONT-002 Production Font Mode tests passed.');
