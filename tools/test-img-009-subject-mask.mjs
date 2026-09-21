import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createImageBuffer, prepareImageField, computeSubjectMask } from '../src/image/index.js';
import { quantizeColors } from '../src/image/ColorQuantize.js';
import { rgbToLab } from '../src/image/ColorSpace.js';
import { createGeometryEngine } from '../src/geometry/index.js';

// IMG-009 -- unit tests for the subject-mask operator: SubjectMask.js's computeSubjectMask() (alpha
// route, background route + largest-4-connected-component reduction), ImageFieldPipeline.js's
// maskMode choice at prepareImageField()'s single mask-assignment line, the pure rgbToLab()/
// cie76Distance() move to ColorSpace.js, and app.js's five maskMode wiring sites. See
// docs/specifications/IMG-009-SubjectMask.md, "Test Plan". Items 1 and 7 pin literals measured on
// pristine `develop` (before this milestone's changes); items 2-6 and 8-9 are measured from this
// milestone's own implementation -- see that document's "Measured comparison" section.

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

// The fixture pinned by the spec's "Measured comparison" section, reproduced verbatim.
const N = 240;
const PALETTE = [
  { id: 'jet', hex: '#141414' }, { id: 'siam', hex: '#9b1c1c' }, { id: 'sapphire', hex: '#2269d3' },
  { id: 'light-sapphire', hex: '#6fa8dc' }, { id: 'topaz', hex: '#e08e26' }, { id: 'citrine', hex: '#f2c94c' },
  { id: 'silver', hex: '#d8dde4' }, { id: 'crystal', hex: '#e9f7ff' }
];

function wingShape(u, v) {
  const x = (u - 0.5) * 2, y = (v - 0.5) * 2;
  return Math.hypot(x / 0.55, (y + 0.28) / 0.45) < 1
    || Math.hypot(x / 0.42, (y - 0.32) / 0.38) < 1
    || (Math.abs(x) < 0.06 && Math.abs(y) < 0.62);
}
function subjectColor(u, v) {
  const x = (u - 0.5) * 2, y = (v - 0.5) * 2;
  if (Math.abs(x) < 0.06 && Math.abs(y) < 0.62) return [60, 45, 35];
  if (Math.abs(Math.sin(x * 14 + y * 4)) > 0.93) return [45, 40, 40];
  if (y < -0.05) { const t = (x + 0.6) / 1.2; return [90 + 90 * t, 150 + 70 * t, 210 + 40 * t]; }
  const t = (y - 0.05) / 0.7; return [225 - 10 * t, 165 + 35 * t, 60 + 30 * t];
}
function build(withAlpha) {
  const d = new Uint8ClampedArray(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = (x + 0.5) / N, v = (y + 0.5) / N, i = (y * N + x) * 4;
    if (wingShape(u, v)) {
      const c = subjectColor(u, v);
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
    } else if (withAlpha) {
      d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = 0;
    } else {
      d[i] = d[i + 1] = d[i + 2] = 246; d[i + 3] = 255;
    }
  }
  return createImageBuffer({ widthPx: N, heightPx: N, data: d });
}

const opaqueBuffer = build(false);
const alphaBuffer = build(true);

function sha256(arr) {
  return crypto.createHash('sha256').update(Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength)).digest('hex');
}
function countOn(dataArray, threshold = 128) {
  let c = 0;
  for (let i = 0; i < dataArray.length; i++) if (dataArray[i] >= threshold) c++;
  return c;
}
function countMaskOn(mask) {
  let c = 0;
  for (let i = 0; i < mask.data.length; i++) if (mask.data[i] === 1) c++;
  return c;
}

// ---- Item 1: byte-identity of threshold mode --------------------------------------------------
// Digests measured on pristine `develop` (before ColorSpace.js/SubjectMask.js/maskMode existed),
// via prepareImageField(buffer, {threshold:128, maxWidthPx:400, maxHeightPx:400}).
const PRISTINE_DIGESTS = {
  opaque: {
    data: '418661ba245962286107cf60118a5616df837655159fccba6d2e2a237829f8b6',
    luminance: 'b23722ba26ff024a0fcc0eb0dca5c70958e3580d03cb951ff0719b93b847457e',
    alpha: '6364066cdff89acf5c8439baf90b282fdec7ae7be50b93c3dd4151162a5d0b98',
    edge: '7539f5b8abfe1c43e58b2b4cb6536778a7d4bdc60acccc4cf66c20e5f7946edb'
  },
  alpha: {
    data: '418661ba245962286107cf60118a5616df837655159fccba6d2e2a237829f8b6',
    luminance: 'd4b6be3b16ea79b1b2cd29011d09c75cd7780c051f5e92ad1081c04922bb8f39',
    alpha: '02ce9752c614f5302dad07b6a225543a5aecaedf6ad55b360eaee217c822b901',
    edge: '7539f5b8abfe1c43e58b2b4cb6536778a7d4bdc60acccc4cf66c20e5f7946edb'
  }
};

await test('1. Byte-identity of threshold mode: no maskMode and maskMode:"threshold" agree with each other and with pristine-tip digests, both fixture variants', () => {
  for (const [label, buffer] of [['opaque', opaqueBuffer], ['alpha', alphaBuffer]]) {
    const omitted = prepareImageField(buffer, { threshold: 128, maxWidthPx: 400, maxHeightPx: 400 });
    const explicit = prepareImageField(buffer, { threshold: 128, maxWidthPx: 400, maxHeightPx: 400, maskMode: 'threshold' });
    for (const channel of ['data', 'luminance', 'alpha', 'edge']) {
      assert.deepEqual(Array.from(omitted[channel]), Array.from(explicit[channel]), `${label}.${channel}: omitted vs explicit maskMode:'threshold' differ`);
      const digest = sha256(omitted[channel]);
      assert.equal(digest, PRISTINE_DIGESTS[label][channel], `${label}.${channel} sha256 does not match the pristine-tip digest`);
    }
  }
});

// ---- Item 2: coverage --------------------------------------------------------------------------
await test('2. Coverage: subject mode gives 0.294 (wingShape()\'s own count) on both variants, vs 0.095 in threshold mode', () => {
  let truthCount = 0;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = (x + 0.5) / N, v = (y + 0.5) / N;
    if (wingShape(u, v)) truthCount++;
  }
  assert.equal(truthCount, 16916);
  const truthCoverage = truthCount / (N * N);
  assert.ok(Math.abs(truthCoverage - 0.294) < 0.0005, 'expected wingShape() truth coverage to be ~0.294');

  for (const buffer of [opaqueBuffer, alphaBuffer]) {
    const subject = prepareImageField(buffer, { threshold: 128, maxWidthPx: 400, maxHeightPx: 400, maskMode: 'subject' });
    const threshold = prepareImageField(buffer, { threshold: 128, maxWidthPx: 400, maxHeightPx: 400, maskMode: 'threshold' });
    assert.equal(countOn(subject.data), truthCount, 'subject mode coverage must equal the independently computed wingShape() truth, not read off the mask');
    assert.equal(countOn(threshold.data), 5469);
    assert.ok(Math.abs(countOn(threshold.data) / (N * N) - 0.095) < 0.0005);
  }
});

// ---- Item 3: route selection --------------------------------------------------------------------
await test('3. Route selection: alpha variant -> "alpha"; opaque variant -> "background" with backgroundRgb [246,246,246]; a 0.5% transparent variant takes background, a 2% variant takes alpha', () => {
  const opaqueResult = computeSubjectMask(opaqueBuffer, {});
  assert.equal(opaqueResult.route, 'background');
  assert.deepEqual(opaqueResult.backgroundRgb, [246, 246, 246]);

  const alphaResult = computeSubjectMask(alphaBuffer, {});
  assert.equal(alphaResult.route, 'alpha');
  assert.equal(alphaResult.backgroundRgb, null);

  const M = 20; // 400 px total: 2px = 0.5%, 8px = 2%
  function buildTransparentVariant(transparentCount) {
    const d = new Uint8ClampedArray(M * M * 4);
    for (let i = 0; i < M * M; i++) { d[i * 4] = 200; d[i * 4 + 1] = 50; d[i * 4 + 2] = 50; d[i * 4 + 3] = 255; }
    for (let i = 0; i < transparentCount; i++) d[i * 4 + 3] = 0;
    return createImageBuffer({ widthPx: M, heightPx: M, data: d });
  }
  const halfPercent = buildTransparentVariant(2);
  const twoPercent = buildTransparentVariant(8);
  assert.equal(computeSubjectMask(halfPercent, {}).route, 'background');
  assert.equal(computeSubjectMask(twoPercent, {}).route, 'alpha');
});

// ---- Item 4: tolerance insensitivity --------------------------------------------------------------
await test('4. Tolerance insensitivity: ΔE 8/12/20 give identical coverage on the opaque wing variant; a dedicated near-background fixture shows ΔE 2 is wired through (not ignored)', () => {
  const coverages = [8, 12, 20].map((de) => countMaskOn(computeSubjectMask(opaqueBuffer, { toleranceDe: de }).mask));
  assert.deepEqual(coverages, [16916, 16916, 16916]);

  // Dedicated fixture: a 245-gray background, a 10x10 red interior square (far from background,
  // unambiguously subject at every tested tolerance), ringed by a one-pixel-wide 233-gray fringe
  // touching the square (CIE76 distance from the 245-gray background ~4.19 -- above 2, below 8).
  const M = 40;
  const d = new Uint8ClampedArray(M * M * 4);
  for (let i = 0; i < M * M; i++) { d[i * 4] = 245; d[i * 4 + 1] = 245; d[i * 4 + 2] = 245; d[i * 4 + 3] = 255; }
  for (let y = 15; y < 25; y++) for (let x = 15; x < 25; x++) { const i = (y * M + x) * 4; d[i] = 200; d[i + 1] = 50; d[i + 2] = 50; d[i + 3] = 255; }
  for (let y = 14; y < 26; y++) for (let x = 14; x < 26; x++) {
    if (y >= 15 && y < 25 && x >= 15 && x < 25) continue;
    const i = (y * M + x) * 4; d[i] = 233; d[i + 1] = 233; d[i + 2] = 233; d[i + 3] = 255;
  }
  const fringeBuffer = createImageBuffer({ widthPx: M, heightPx: M, data: d });
  assert.equal(countMaskOn(computeSubjectMask(fringeBuffer, { toleranceDe: 2 }).mask), 144, 'ΔE 2 should include the fringe (interior 100 + ring 44), proving the parameter is wired through');
  assert.equal(countMaskOn(computeSubjectMask(fringeBuffer, { toleranceDe: 8 }).mask), 100, 'ΔE 8 should exclude the fringe, keeping only the interior square');
  assert.equal(countMaskOn(computeSubjectMask(fringeBuffer, { toleranceDe: 12 }).mask), 100);
  assert.equal(countMaskOn(computeSubjectMask(fringeBuffer, { toleranceDe: 20 }).mask), 100);
});

// ---- Item 5: largest-component reduction ----------------------------------------------------------
await test('5. Largest-component reduction: a detached 3x3 speckle is dropped (same coverage as clean); an enclosed background-colored hole reduces coverage by its exact pixel count', () => {
  const cleanOn = countMaskOn(computeSubjectMask(opaqueBuffer, {}).mask);
  assert.equal(cleanOn, 16916);

  // Speckle: 3x3 block at (2,2)-(4,4), well outside wingShape(), colored like the subject's body --
  // far enough from background to pass the ΔE gate on its own, but disconnected from the main shape.
  const speckleData = Uint8ClampedArray.from(opaqueBuffer.data);
  for (let y = 2; y < 5; y++) for (let x = 2; x < 5; x++) {
    const i = (y * N + x) * 4;
    speckleData[i] = 60; speckleData[i + 1] = 45; speckleData[i + 2] = 35; speckleData[i + 3] = 255;
  }
  const speckleBuffer = createImageBuffer({ widthPx: N, heightPx: N, data: speckleData });
  assert.equal(countMaskOn(computeSubjectMask(speckleBuffer, {}).mask), cleanOn, 'a disconnected speckle must be dropped by the largest-component reduction');

  // Hole: a 6x6 block at (100,100), verified strictly interior to the wing shape (with a 1px margin
  // all wingShape()-true), overwritten with the exact background color -- an enclosed hole.
  for (let y = 99; y <= 106; y++) for (let x = 99; x <= 106; x++) {
    const u = (x + 0.5) / N, v = (y + 0.5) / N;
    assert.ok(wingShape(u, v), `expected (${x},${y}) to be interior to the wing shape for the hole fixture's margin`);
  }
  const holeData = Uint8ClampedArray.from(opaqueBuffer.data);
  let holePixelCount = 0;
  for (let y = 100; y < 106; y++) for (let x = 100; x < 106; x++) {
    const i = (y * N + x) * 4;
    holeData[i] = 246; holeData[i + 1] = 246; holeData[i + 2] = 246; holeData[i + 3] = 255;
    holePixelCount++;
  }
  assert.equal(holePixelCount, 36);
  const holeBuffer = createImageBuffer({ widthPx: N, heightPx: N, data: holeData });
  const holeOn = countMaskOn(computeSubjectMask(holeBuffer, {}).mask);
  assert.equal(cleanOn - holeOn, holePixelCount, 'the hole must reduce coverage by exactly its own pixel count, no more (it stays a hole, not a component-severing cut)');
});

// ---- Item 6: colour recovery ------------------------------------------------------------------
await test('6. Colour recovery: colorCount:6 over the subject mask yields jet/siam/citrine/silver/light-sapphire; over the threshold mask, jet/siam', () => {
  const subject = prepareImageField(opaqueBuffer, { threshold: 128, maxWidthPx: 400, maxHeightPx: 400, maskMode: 'subject', colorCount: 6, palette: PALETTE });
  const threshold = prepareImageField(opaqueBuffer, { threshold: 128, maxWidthPx: 400, maxHeightPx: 400, maskMode: 'threshold', colorCount: 6, palette: PALETTE });
  assert.deepEqual(subject.colorGroups.map((g) => g.nearestId), ['jet', 'siam', 'citrine', 'silver', 'light-sapphire']);
  assert.deepEqual(threshold.colorGroups.map((g) => g.nearestId), ['jet', 'siam']);
});

// ---- Item 7: the Lab move is pure --------------------------------------------------------------
// Measured on pristine `develop` (before rgbToLab()/cie76Distance() moved out of ColorQuantize.js).
await test('7. The Lab move is pure: assignNearestIds() (via quantizeColors()) and rgbToLab() return the pristine-tip values after the move to ColorSpace.js', () => {
  const clusterRgbs = [
    [20, 20, 20], [155, 28, 28], [34, 105, 211], [111, 168, 220],
    [224, 142, 38], [242, 201, 76], [216, 221, 228], [233, 247, 255]
  ];
  const n = clusterRgbs.length;
  const r = new Uint8ClampedArray(n), g = new Uint8ClampedArray(n), b = new Uint8ClampedArray(n), data = new Uint8ClampedArray(n).fill(255);
  for (let i = 0; i < n; i++) { r[i] = clusterRgbs[i][0]; g[i] = clusterRgbs[i][1]; b[i] = clusterRgbs[i][2]; }
  const { colorGroups } = quantizeColors({ r, g, b, data, colorCount: n, palette: PALETTE });
  assert.deepEqual(colorGroups.map((grp) => grp.nearestId), [
    'jet', 'siam', 'topaz', 'citrine', 'sapphire', 'light-sapphire', 'silver', 'crystal'
  ]);

  const PRISTINE_LAB = [
    [[20, 20, 20], [6.318928745123017, -0.0000027236759098103747, 0.0000010894703639241499]],
    [[155, 28, 28], [33.7426798074643, 50.55356161264884, 34.110455380901286]],
    [[111, 168, 220], [66.93772211169767, -4.401231613319235, -32.03919328774527]]
  ];
  for (const [[cr, cg, cb], expectedLab] of PRISTINE_LAB) {
    const lab = rgbToLab(cr, cg, cb);
    for (let i = 0; i < 3; i++) {
      assert.ok(Math.abs(lab[i] - expectedLab[i]) < 1e-9, `rgbToLab(${cr},${cg},${cb})[${i}] = ${lab[i]}, expected ${expectedLab[i]}`);
    }
  }
});

// ---- Item 8: invert and transparent still compose ------------------------------------------------
await test('8. Invert and transparent still compose: subject mode with invert:true gives 1-0.294 coverage on the opaque variant; transparent:"ignore" is unchanged from "white" on the alpha variant', () => {
  const inverted = prepareImageField(opaqueBuffer, { threshold: 128, maxWidthPx: 400, maxHeightPx: 400, maskMode: 'subject', invert: true });
  const normal = prepareImageField(opaqueBuffer, { threshold: 128, maxWidthPx: 400, maxHeightPx: 400, maskMode: 'subject' });
  assert.equal(countOn(inverted.data), N * N - 16916);
  assert.equal(countOn(inverted.data) + countOn(normal.data), N * N);

  const ignoreField = prepareImageField(alphaBuffer, { threshold: 128, maxWidthPx: 400, maxHeightPx: 400, maskMode: 'subject', transparent: 'ignore' });
  const whiteField = prepareImageField(alphaBuffer, { threshold: 128, maxWidthPx: 400, maxHeightPx: 400, maskMode: 'subject', transparent: 'white' });
  assert.deepEqual(Array.from(ignoreField.data), Array.from(whiteField.data));
});

// ---- Item 9: app-path source-text guard ---------------------------------------------------------
await test('9. App-path source-text guard: resolveImageMaskMode(), the five decision-6 sites, and the Studio control', () => {
  const appJs = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const indexHtml = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

  assert.ok(appJs.includes('function resolveImageMaskMode('), 'expected app.js to define resolveImageMaskMode()');

  // Decision 6's five sites, each identified by a stable substring already unique in app.js, checked
  // for maskMode: (params-object sites) or imgMaskMode (the two Studio control sites).
  const siteNeedles = [
    // app.js:1018 -- generateImageStonesLive()'s params object (the live generate path).
    { label: 'generateImageStonesLive() params', anchor: 'async generateImageStonesLive(layer,{includeStats=false}={}){', needle: 'maskMode:resolveImageMaskMode(layer.maskMode)' },
    // app.js:2487 -- Studio sync: control <- layer.
    { label: 'Studio sync (control<-layer)', anchor: "if(l.type==='image'){el('imgMaskMode')", needle: "el('imgMaskMode').value=resolveImageMaskMode(l.maskMode)" },
    // app.js:2638 -- Studio readback: layer <- control.
    { label: 'Studio readback (layer<-control)', anchor: "}else if(l.type==='image'){", needle: "l.maskMode=resolveImageMaskMode(el('imgMaskMode').value)" },
    // app.js:3217 -- resolveLayerShapeSource()'s prepareImageField() call (Boolean operations).
    { label: 'resolveLayerShapeSource() prepareImageField()', anchor: 'if(layer.type===\'image\'){', needle: 'maskMode:resolveImageMaskMode(layer.maskMode)' },
    // app.js:3239 -- resolveImageExportRegions()'s params object (IMG-008's SVG regions).
    { label: 'resolveImageExportRegions() params', anchor: 'function resolveImageExportRegions(project){', needle: 'maskMode:resolveImageMaskMode(layer.maskMode)' }
  ];
  for (const { label, needle } of siteNeedles) {
    assert.ok(appJs.includes(needle), `expected ${label} to contain "${needle}"`);
  }
  // Both prepareImageField() call sites inside resolveLayerShapeSource() and resolveImageExportRegions()
  // are otherwise textually near-identical (both build an image-layer params object from the same
  // layer fields) -- assert the exact needle count so a future edit can't silently satisfy this guard
  // from just one of the two.
  const maskModeParamOccurrences = (appJs.match(/maskMode:resolveImageMaskMode\(layer\.maskMode\)/g) || []).length;
  assert.equal(maskModeParamOccurrences, 3, 'expected exactly 3 occurrences of maskMode:resolveImageMaskMode(layer.maskMode) in app.js (generateImageStonesLive, resolveLayerShapeSource, resolveImageExportRegions)');

  assert.ok(indexHtml.includes('id="imgMaskMode"'), 'expected index.html to contain #imgMaskMode');

  const historyTrackedMarker = 'const HISTORY_TRACKED_CONTROL_IDS=[';
  const historyTrackedStart = appJs.indexOf(historyTrackedMarker);
  assert.ok(historyTrackedStart !== -1, 'expected to find HISTORY_TRACKED_CONTROL_IDS in app.js');
  const historyTrackedEnd = appJs.indexOf('];', historyTrackedStart);
  assert.ok(historyTrackedEnd !== -1, 'expected to find the closing "];" of HISTORY_TRACKED_CONTROL_IDS in app.js');
  const historyTrackedSrc = appJs.slice(historyTrackedStart, historyTrackedEnd);
  assert.ok(historyTrackedSrc.includes("'imgMaskMode'"), 'HISTORY_TRACKED_CONTROL_IDS is missing imgMaskMode');
});

// ---- Item 10: engine end-to-end -- maskMode actually reaches generateImageLayout()/resolveImagePolygons() ----
// Item 9's source-text guard proves app.js forwards maskMode: into the params objects it hands the
// engine; it does NOT prove the engine does anything with it. GeometryEngine.js's normalizeImageParams()
// builds an explicit whitelisted options object (no catch-all spread) and both generateImageLayout()'s
// and resolveImagePolygons()'s own prepareImageField() calls forward maskMode by hand -- drop either
// forward and every other test in this file (and all 153 in the default suite) still passes, since
// none of them call the engine with maskMode: 'subject' and check its effect. This item does.
await test('10. Engine end-to-end: generateImageLayout()/resolveImagePolygons() actually produce different output for maskMode "threshold" vs "subject" on the opaque wing variant', () => {
  const engine = createGeometryEngine();
  const baseParams = (maskMode) => ({
    imageBuffer: opaqueBuffer,
    layerId: 'L1',
    xMm: 0, yMm: 0, widthMm: 60, heightMm: 60,
    stoneSizeMm: 2, gapMm: 0.3, mode: 'fill', color: 'jet',
    threshold: 128, maxWidthPx: 400, maxHeightPx: 400,
    maskMode
  });

  const thresholdLayout = engine.generateImageLayout(baseParams('threshold'));
  const subjectLayout = engine.generateImageLayout(baseParams('subject'));
  assert.equal(thresholdLayout.stones.length, 69, 'generateImageLayout() maskMode:"threshold" stone count');
  assert.equal(subjectLayout.stones.length, 196, 'generateImageLayout() maskMode:"subject" stone count');

  const thresholdPolygons = engine.resolveImagePolygons(baseParams('threshold'));
  const subjectPolygons = engine.resolveImagePolygons(baseParams('subject'));
  const contourCount = (result) => result.regions.reduce((sum, r) => sum + r.contours.length, 0);
  assert.equal(contourCount(thresholdPolygons), 5, 'resolveImagePolygons() maskMode:"threshold" contour count');
  assert.equal(contourCount(subjectPolygons), 1, 'resolveImagePolygons() maskMode:"subject" contour count');
});
