import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createGeometryEngine } from '../src/geometry/index.js';
import { combineShapeSources, contourAreaAbs } from '../src/geometry/PathBoolean.js';
import { isPointInsidePolygons } from '../src/geometry/StoneSampler.js';
import { createImageBuffer, prepareImageField } from '../src/image/index.js';
import { stoneLayoutToSvg } from '../src/export/SvgExporter.js';

// IMG-008 -- unit tests for the Vector-first SVG export path: sampleSource()'s optional per-label
// mask restriction (src/geometry/PathBoolean.js), GeometryEngine.resolveImagePolygons() (the
// per-colour silhouette tracer, floored at one stone footprint), the grouped SVG document
// stoneLayoutToSvg() now emits when given `options.regions`, and app.js's exportSVG wiring. See
// docs/specifications/IMG-008-VectorFirstSvg.md, "Test Plan". Every literal pinned below is either
// measured on pristine `develop@49b3b26` (items 1, 8) or from this milestone's own implementation of
// decisions 1-2 (items 2-7) -- see that document's "Measured comparison" section.

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

// The two fixtures pinned by the spec's "Measured comparison" section, reproduced verbatim.
const N = 240;
const W = 60, H = 60;
const STONE = 2.8, GAP = 0.5;
const PALETTE = [
  { id: 'siam', hex: '#c81414' },
  { id: 'citrine', hex: '#e6c81e' },
  { id: 'sapphire', hex: '#1414c8' },
  { id: 'crystal', hex: '#ffffff' }
];

function lcg(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function heartInside(u, v) {
  const x = (u - 0.5) * 3.2, y = -(v - 0.5) * 3.2;
  const a = x * x + y * y - 1;
  return a * a * a - x * x * y * y * y < 0;
}
function starInside(u, v) {
  const cx = 0.5, cy = 0.5, R = 0.14, r = 0.06;
  const dx = u - cx, dy = v - cy;
  const ang = Math.atan2(dy, dx), d = Math.hypot(dx, dy);
  const k = 5, t = ((ang + Math.PI / 2) % (2 * Math.PI / k) + 2 * Math.PI) % (2 * Math.PI / k);
  const phase = Math.abs(t - Math.PI / k) / (Math.PI / k);
  return d < r + (R - r) * phase;
}
function ringInside(u, v) {
  const d = Math.hypot(u - 0.5, v - 0.5);
  return d > 0.44 && d < 0.49;
}
function logoBuffer() {
  const d = new Uint8ClampedArray(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let r = 0, g = 0, b = 0;
    for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
      const u = (x + (sx + 0.5) / 4) / N, v = (y + (sy + 0.5) / 4) / N;
      let c = [255, 255, 255];
      if (ringInside(u, v)) c = [20, 20, 200];
      if (heartInside(u, v)) c = [200, 20, 20];
      if (starInside(u, v)) c = [180, 120, 10];
      r += c[0]; g += c[1]; b += c[2];
    }
    const i = (y * N + x) * 4;
    d[i] = r / 16; d[i + 1] = g / 16; d[i + 2] = b / 16; d[i + 3] = 255;
  }
  return createImageBuffer({ widthPx: N, heightPx: N, data: d });
}
function photoBuffer() {
  const d = new Uint8ClampedArray(N * N * 4);
  const rnd = lcg(7);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N;
    const dd = Math.hypot(u - 0.45, v - 0.42);
    let lum = 235 - 210 * Math.max(0, 1 - dd / 0.42);
    lum += 40 * Math.sin(u * 40) * Math.sin(v * 33);
    const sh = Math.hypot(u - 0.6, v - 0.75);
    if (sh < 0.2) lum -= 90 * (1 - sh / 0.2);
    lum += (rnd() - 0.5) * 50;
    lum = Math.max(0, Math.min(255, lum));
    const i = (y * N + x) * 4;
    d[i] = lum; d[i + 1] = lum; d[i + 2] = lum; d[i + 3] = 255;
  }
  return createImageBuffer({ widthPx: N, heightPx: N, data: d });
}

const engine = createGeometryEngine();

function baseImageParams(buffer, colorCount, extra = {}) {
  return {
    imageBuffer: buffer, layerId: 'img1', xMm: 0, yMm: 0, widthMm: W, heightMm: H,
    stoneSizeMm: STONE, gapMm: GAP, threshold: 128, maxWidthPx: N, maxHeightPx: N,
    colorCount, palette: colorCount > 1 ? PALETTE : null,
    ...extra
  };
}

function roundedAreas(contours) {
  return contours.map((c) => Math.round(contourAreaAbs(c) * 10) / 10);
}

await test('1. Byte-identity of the legacy document (no third argument), measured on pristine develop@49b3b26', () => {
  const logoLayout = engine.generateImageLayout({
    imageBuffer: logoBuffer(), layerId: 'img1', xMm: 0, yMm: 0, widthMm: W, heightMm: H,
    stoneSizeMm: STONE, gapMm: GAP, mode: 'fill', threshold: 128, maxWidthPx: N, maxHeightPx: N,
    colorCount: 1
  });
  assert.equal(logoLayout.stones.length, 166);
  const logoSvg = stoneLayoutToSvg(logoLayout, { widthMm: 60, heightMm: 60 });
  assert.equal(
    crypto.createHash('sha256').update(logoSvg).digest('hex'),
    '4b18330655e8903eba719c38314039a15bdc0ec94a39b1c521692146fd46f475'
  );

  const photoLayout = engine.generateImageLayout({
    imageBuffer: photoBuffer(), layerId: 'img1', xMm: 0, yMm: 0, widthMm: W, heightMm: H,
    stoneSizeMm: STONE, gapMm: GAP, mode: 'organic', seed: 1, spread: 1, threshold: 128,
    maxWidthPx: N, maxHeightPx: N, colorCount: 3, palette: PALETTE, colorMap: {}
  });
  assert.equal(photoLayout.stones.length, 58);
  const photoSvg = stoneLayoutToSvg(photoLayout, { widthMm: 60, heightMm: 60 });
  assert.equal(
    crypto.createHash('sha256').update(photoSvg).digest('hex'),
    'e8d4f4506fa19dc4a8298f1ee0a7d66c2325848527ea09b628ae44651567e70e'
  );
});

await test("2. sampleSource()'s label filter: raw contour counts per label, and null-clip identity", () => {
  const field = prepareImageField(logoBuffer(), { threshold: 128, maxWidthPx: N, maxHeightPx: N, colorCount: 3, palette: PALETTE });
  const baseSource = { kind: 'field', field, xMm: 0, yMm: 0, widthMm: W, heightMm: H };
  const targetSpacingMm = STONE + GAP;

  const perLabelCounts = [0, 1, 2].map((label) =>
    combineShapeSources({ ...baseSource, label }, null, 'union', { targetSpacingMm }).contours.length
  );
  assert.deepEqual(perLabelCounts, [2, 32, 2]);

  const withoutLabel = combineShapeSources(baseSource, null, 'union', { targetSpacingMm });
  assert.equal(withoutLabel.contours.length, 3);

  for (const label of [undefined, 0, 1, 2]) {
    const source = label === undefined ? baseSource : { ...baseSource, label };
    const withNullClip = combineShapeSources(source, null, 'union', { targetSpacingMm });
    const selfUnion = combineShapeSources(source, source, 'union', { targetSpacingMm });
    assert.deepEqual(withNullClip.contours, selfUnion.contours, `null clip must equal self-union for label ${label}`);
  }
});

await test('3. resolveImagePolygons() on logo, colorCount:1', () => {
  const { regions, boundingBox } = engine.resolveImagePolygons(baseImageParams(logoBuffer(), 1, { color: 'crystal' }));
  assert.equal(regions.length, 1);
  assert.equal(regions[0].colorId, 'crystal');
  assert.equal(regions[0].contours.length, 3);
  const vertexCount = regions[0].contours.reduce((sum, c) => sum + c.length, 0);
  assert.equal(vertexCount, 657);
  assert.deepEqual(roundedAreas(regions[0].contours), [2713.7, 81.9, 835.1]);
  assert.ok(boundingBox);
});

await test('4. resolveImagePolygons() on logo, colorCount:3 -- label order and colorMap override', () => {
  const { regions } = engine.resolveImagePolygons(baseImageParams(logoBuffer(), 3, { colorMap: {} }));
  assert.equal(regions.length, 3);

  assert.equal(regions[0].colorId, 'siam');
  assert.equal(regions[0].contours.length, 2);
  assert.equal(regions[0].contours.reduce((s, c) => s + c.length, 0), 287);
  assert.deepEqual(roundedAreas(regions[0].contours), [1278.5, 118.6]);

  assert.equal(regions[1].colorId, 'citrine');
  assert.equal(regions[1].contours.length, 1);
  assert.equal(regions[1].contours.reduce((s, c) => s + c.length, 0), 99);
  assert.deepEqual(roundedAreas(regions[1].contours), [118.6]);

  assert.equal(regions[2].colorId, 'sapphire');
  assert.equal(regions[2].contours.length, 2);
  assert.equal(regions[2].contours.reduce((s, c) => s + c.length, 0), 516);
  assert.deepEqual(roundedAreas(regions[2].contours), [2713.7, 2198.7]);

  const { regions: remapped } = engine.resolveImagePolygons(baseImageParams(logoBuffer(), 3, { colorMap: { citrine: 'sapphire' } }));
  assert.equal(remapped.length, 3);
  assert.equal(remapped[0].colorId, 'siam');
  assert.equal(remapped[1].colorId, 'sapphire');
  assert.equal(remapped[2].colorId, 'sapphire');
  assert.deepEqual(remapped[0].contours, regions[0].contours);
  assert.deepEqual(remapped[1].contours, regions[1].contours);
  assert.deepEqual(remapped[2].contours, regions[2].contours);
});

await test('5. The area floor on photo -- raw vs. kept contour counts', () => {
  const oneColor = engine.resolveImagePolygons(baseImageParams(photoBuffer(), 1));
  assert.equal(oneColor.regions.length, 1);
  assert.equal(oneColor.regions[0].contours.length, 3);
  assert.deepEqual(roundedAreas(oneColor.regions[0].contours), [541.8, 7.8, 14.0]);

  const field = prepareImageField(photoBuffer(), { threshold: 128, maxWidthPx: N, maxHeightPx: N });
  const rawSource = { kind: 'field', field, xMm: 0, yMm: 0, widthMm: W, heightMm: H };
  const raw = combineShapeSources(rawSource, null, 'union', { targetSpacingMm: STONE + GAP });
  assert.equal(raw.contours.length, 448);

  const threeColor = engine.resolveImagePolygons(baseImageParams(photoBuffer(), 3));
  assert.equal(threeColor.regions.length, 3);

  const labeledField = prepareImageField(photoBuffer(), { threshold: 128, maxWidthPx: N, maxHeightPx: N, colorCount: 3, palette: PALETTE });
  const labeledSource = { kind: 'field', field: labeledField, xMm: 0, yMm: 0, widthMm: W, heightMm: H };
  // Ordered per-label, not sorted -- pins each label's own raw and kept count individually rather
  // than discarding the label-to-count mapping via a sort.
  const expectedByLabel = [
    { colorId: 'citrine', keptContours: 2, rawContours: 182 },
    { colorId: 'siam', keptContours: 7, rawContours: 405 },
    { colorId: 'crystal', keptContours: 7, rawContours: 559 }
  ];
  expectedByLabel.forEach((expected, label) => {
    assert.equal(threeColor.regions[label].colorId, expected.colorId, `label ${label} colorId`);
    assert.equal(threeColor.regions[label].contours.length, expected.keptContours, `label ${label} kept contour count`);
    const rawForLabel = combineShapeSources({ ...labeledSource, label }, null, 'union', { targetSpacingMm: STONE + GAP });
    assert.equal(rawForLabel.contours.length, expected.rawContours, `label ${label} raw contour count`);
  });
});

function measureIoU(field, contours, label, widthMm, heightMm) {
  let inter = 0, union = 0;
  for (let py = 0; py < field.heightPx; py += 2) {
    for (let px = 0; px < field.widthPx; px += 2) {
      const idx = py * field.widthPx + px;
      let maskOn = field.data[idx] >= 128;
      if (maskOn && label !== undefined) maskOn = field.labels[idx] === label;
      const xMm = ((px + 0.5) / field.widthPx) * widthMm;
      const yMm = ((py + 0.5) / field.heightPx) * heightMm;
      const vectorOn = isPointInsidePolygons({ xMm, yMm }, contours);
      if (maskOn || vectorOn) union++;
      if (maskOn && vectorOn) inter++;
    }
  }
  return union === 0 ? 1 : inter / union;
}

await test('6. Fidelity: IoU of each kept region against its own mask, sampled on a 2px grid', () => {
  const oneColorField = prepareImageField(logoBuffer(), { threshold: 128, maxWidthPx: N, maxHeightPx: N });
  const { regions: oneColorRegions } = engine.resolveImagePolygons(baseImageParams(logoBuffer(), 1));
  assert.equal(measureIoU(oneColorField, oneColorRegions[0].contours, undefined, W, H).toFixed(3), '0.988');

  const threeColorField = prepareImageField(logoBuffer(), { threshold: 128, maxWidthPx: N, maxHeightPx: N, colorCount: 3, palette: PALETTE });
  const { regions: threeColorRegions } = engine.resolveImagePolygons(baseImageParams(logoBuffer(), 3));
  const labelFor = { siam: 0, citrine: 1, sapphire: 2 };
  const expectedIoU = { siam: '0.991', citrine: '0.959', sapphire: '0.971' };
  for (const region of threeColorRegions) {
    const iou = measureIoU(threeColorField, region.contours, labelFor[region.colorId], W, H);
    assert.equal(iou.toFixed(3), expectedIoU[region.colorId], `unexpected IoU for ${region.colorId}`);
  }

  const photoField = prepareImageField(photoBuffer(), { threshold: 128, maxWidthPx: N, maxHeightPx: N });
  const { regions: photoRegions } = engine.resolveImagePolygons(baseImageParams(photoBuffer(), 1));
  assert.equal(measureIoU(photoField, photoRegions[0].contours, undefined, W, H).toFixed(3), '0.825');
});

await test('7. Document structure with options.regions', () => {
  const imageLayout = engine.generateImageLayout({
    imageBuffer: logoBuffer(), layerId: 'img1', xMm: 0, yMm: 0, widthMm: W, heightMm: H,
    stoneSizeMm: STONE, gapMm: GAP, mode: 'fill', threshold: 128, maxWidthPx: N, maxHeightPx: N,
    colorCount: 3, palette: PALETTE, colorMap: {}
  });
  assert.equal(imageLayout.stones.length, 166);

  const { regions: rawRegions } = engine.resolveImagePolygons(baseImageParams(logoBuffer(), 3, { colorMap: {} }));
  const regions = rawRegions.map((r) => ({ layerId: 'img1', colorId: r.colorId, contours: r.contours }));

  const legacySvg = stoneLayoutToSvg(imageLayout, { widthMm: 60, heightMm: 60 });
  const groupedSvg = stoneLayoutToSvg(imageLayout, { widthMm: 60, heightMm: 60 }, { regions });
  const emptyRegionsSvg = stoneLayoutToSvg(imageLayout, { widthMm: 60, heightMm: 60 }, { regions: [] });

  // Legacy shape: no <g> wrapper at all.
  assert.equal((legacySvg.match(/<g /g) || []).length, 0);

  for (const svg of [groupedSvg, emptyRegionsSvg]) {
    const regionsGroupIndex = svg.indexOf('<g id="regions">');
    const stonesGroupIndex = svg.indexOf('<g id="stones">');
    assert.ok(regionsGroupIndex !== -1 && stonesGroupIndex !== -1, 'expected both <g id="regions"> and <g id="stones">');
    assert.ok(regionsGroupIndex < stonesGroupIndex, 'expected regions before stones');
    assert.equal((svg.match(/<g id="regions">/g) || []).length, 1);
    assert.equal((svg.match(/<g id="stones">/g) || []).length, 1);
    assert.equal((svg.match(/<circle\b/g) || []).length, 166);
  }

  assert.equal((groupedSvg.match(/<path\b/g) || []).length, 3);
  assert.equal((groupedSvg.match(/<path\b[^>]*fill-rule="evenodd"[^>]*\/>/g) || []).length, 3);

  const siamPathMatch = groupedSvg.match(/<g data-layer="img1" data-color="siam">(<path[^>]*\/>)<\/g>/);
  assert.ok(siamPathMatch, 'expected a siam region <g><path/></g>');
  const siamZCount = (siamPathMatch[1].match(/Z/g) || []).length;
  assert.equal(siamZCount, 2, 'siam has 2 contours, so its path d should contain exactly two Z');
  // Pins the fill/fill-opacity/stroke/stroke-width/fill-rule attribute cluster as one literal
  // (the `d` attribute's own value is excluded -- it is the traced polyline itself, already
  // covered by siamZCount above and by items 4/6's contour-count/vertex/area/IoU assertions).
  const siamAttrsTail = siamPathMatch[1].match(/ fill="[^"]*" fill-opacity="[^"]*" stroke="[^"]*" stroke-width="[^"]*" fill-rule="[^"]*"\/>$/);
  assert.ok(siamAttrsTail, 'expected the siam path to end with its fill/stroke attribute cluster');
  assert.equal(siamAttrsTail[0], ' fill="#9b1c1c" fill-opacity="0.35" stroke="#4a0d0d" stroke-width="0.12" fill-rule="evenodd"/>');

  const stoneGroupColors = [...groupedSvg.matchAll(/<g data-layer="img1" data-color="([a-z]+)" data-size="2\.800">/g)].map((m) => m[1]);
  assert.deepEqual(stoneGroupColors, ['citrine', 'sapphire', 'siam']);

  const legacyCircleAttrs = [...legacySvg.matchAll(/<circle[^>]*\/>/g)].map((m) => m[0]);
  const groupedCircleAttrs = [...groupedSvg.matchAll(/<circle[^>]*\/>/g)].map((m) => m[0]);
  assert.deepEqual(new Set(legacyCircleAttrs), new Set(groupedCircleAttrs));
  assert.equal(legacyCircleAttrs.length, groupedCircleAttrs.length);

  // The Set comparison above is order-insensitive; separately confirm each group's circles keep
  // their relative order from the legacy document (spec decision 2: "circles keep their relative
  // order from stoneLayout.stones").
  const legacyIndexOf = new Map(legacyCircleAttrs.map((c, i) => [c, i]));
  for (const color of stoneGroupColors) {
    const groupMatch = groupedSvg.match(new RegExp(`<g data-layer="img1" data-color="${color}" data-size="2\\.800">([\\s\\S]*?)<\\/g>`));
    assert.ok(groupMatch, `expected a stone group for ${color}`);
    const indices = [...groupMatch[1].matchAll(/<circle[^>]*\/>/g)].map((m) => legacyIndexOf.get(m[0]));
    const ascending = [...indices].sort((a, b) => a - b);
    assert.deepEqual(indices, ascending, `${color} group circles must appear in the legacy document's relative order`);
  }
});

await test('8. Colour-rule factoring is a pure move: generateImageLayout() stone breakdown, measured on pristine develop@49b3b26', () => {
  const layout = engine.generateImageLayout({
    imageBuffer: logoBuffer(), layerId: 'img1', xMm: 0, yMm: 0, widthMm: W, heightMm: H,
    stoneSizeMm: STONE, gapMm: GAP, mode: 'fill', threshold: 128, maxWidthPx: N, maxHeightPx: N,
    colorCount: 3, palette: PALETTE, colorMap: {}
  });
  assert.equal(layout.stones.length, 166);
  const counts = {};
  for (const s of layout.stones) counts[s.color] = (counts[s.color] || 0) + 1;
  assert.deepEqual(counts, { siam: 109, sapphire: 46, citrine: 11 });
});

function extractFunctionBody(source, signatureMarker, label) {
  const start = source.indexOf(signatureMarker);
  assert.ok(start !== -1, `expected to find "${signatureMarker}" (${label}) in app.js`);
  const braceStart = start + signatureMarker.length - 1;
  assert.equal(source[braceStart], '{', `expected signatureMarker to end at ${label}'s body-opening "{"`);
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`expected to find the matching closing "}" of ${label} in app.js`);
}

await test('9. App-path source-text guard: resolveImageExportRegions() and the exportSVG handler', () => {
  const appSrc = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');

  assert.ok(!/async function resolveImageExportRegions\(/.test(appSrc), 'resolveImageExportRegions must not be async');
  const body = extractFunctionBody(appSrc, 'function resolveImageExportRegions(project){', 'resolveImageExportRegions()');
  for (const needle of [
    'threshold:', 'invert:', 'blurRadiusPx:', 'maxWidthPx:', 'maxHeightPx:',
    'transparent:resolveImageTransparentMode(', 'colorCount:', 'palette:imageColorPalette()',
    'colorMap:', 'edgeWidthMm:resolveImageEdgeWidth(', 'stoneSizeMm:', 'gapMm:',
    'permanentEngine.resolveImagePolygons(', 'imageBufferCache.get('
  ]) {
    assert.ok(body.includes(needle), `resolveImageExportRegions() is missing "${needle}"`);
  }

  const handlerRe = /el\('exportSVG'\)\.onclick=\(\)=>\{if\(!layout\)\{[^}]*return\}try\{/;
  assert.match(appSrc, handlerRe, 'expected #exportSVG handler to guard on !layout before a try block');
  const handlerStart = appSrc.indexOf("el('exportSVG')");
  const handlerEnd = appSrc.indexOf('\n', handlerStart);
  const handlerLine = appSrc.slice(handlerStart, handlerEnd);
  assert.ok(handlerLine.includes('resolveImageExportRegions(project)'), 'exportSVG handler must call resolveImageExportRegions(project)');
  assert.ok(handlerLine.includes('{regions'), 'exportSVG handler must pass {regions to stoneLayoutToSvg(');
});

await test('10. Purity guard still holds (re-run of test-render-export-pipeline.mjs test 8, against SvgExporter.js)', () => {
  const svgExporterSource = fs.readFileSync(new URL('../src/export/SvgExporter.js', import.meta.url), 'utf8');
  assert.ok(!/project\.layers/.test(svgExporterSource), 'SvgExporter.js must not reference project.layers');
  assert.ok(!/layer\.type|l\.type/.test(svgExporterSource), "SvgExporter.js must not reference a layer's type");
  assert.ok(!/['"](text|circle|rectangle)['"]/.test(svgExporterSource), 'SvgExporter.js must not reference a layer type literal');
});

console.log('IMG-008 vector-first SVG tests passed.');
