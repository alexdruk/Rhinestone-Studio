// IMG-021: rotated image stones. See docs/specifications/IMG-021-RotatedImageStones.md.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createGeometryEngine, GeometryEngine } from '../src/geometry/index.js';
import { combineShapeSources } from '../src/geometry/PathBoolean.js';
import { prepareImageField } from '../src/image/index.js';
import { STONE_COLORS } from '../src/renderer/StoneColors.js';
import { FontManager } from '../src/fonts/index.js';
import { createDefaultFontProviderRegistry } from '../src/text/index.js';
import { assertTestRegistered } from './lib/test-registration-assertions.mjs';

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

const appJs = await readFile(fileURLToPath(new URL('../app.js', import.meta.url)), 'utf8');
const PALETTE = Object.values(STONE_COLORS).map((c) => ({ id: c.id, hex: c.previewColor }));
const engine = createGeometryEngine();

function parseHex(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

// An asymmetric three-colour subject on a transparent background: a red bar across the top, a
// blue block at the lower left and a green disc at the lower right. Nothing about it is symmetric
// under 30 or 90 degrees, so a wrong pivot or direction moves stones.
function buildFixture(widthPx = 96, heightPx = 72) {
  const data = new Uint8ClampedArray(widthPx * heightPx * 4);
  const red = parseHex('#9b1c1c'), blue = parseHex('#2269d3'), green = parseHex('#1e7a4a');
  for (let y = 0; y < heightPx; y++) for (let x = 0; x < widthPx; x++) {
    const i = (y * widthPx + x) * 4;
    let c = null;
    if (y >= 6 && y < 22 && x >= 8 && x < 88) c = red;
    else if (y >= 26 && y < 66 && x >= 8 && x < 40) c = blue;
    else if ((x - 66) ** 2 + (y - 48) ** 2 <= 17 ** 2) c = green;
    if (c) { data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255; }
  }
  return { widthPx, heightPx, data };
}
const BUFFER = buildFixture();
const BOX = { xMm: 12, yMm: 20, widthMm: 64, heightMm: 48 };
const BASE = {
  imageBuffer: BUFFER, layerId: 'I', ...BOX, stoneSizeMm: 2, gapMm: 0.3, color: 'gold',
  threshold: 128, maxWidthPx: 96, maxHeightPx: 72, colorCount: 3, palette: PALETTE, colorMap: {}
};
const CASES = {
  fill: { mode: 'fill' },
  staggeredFillGaps: { mode: 'staggered', fillGaps: true },
  radial: { mode: 'radial' },
  contour: { mode: 'contour' },
  organic: { mode: 'organic', seed: 3, spread: 1.2 },
  edge: { mode: 'edge' },
  brightness: { mode: 'fill', sizeMode: 'brightness', brightnessSizesMm: [2, 2.8, 4] },
  mixed: { mode: 'contour', stoneSizeMm: 4, sizeMode: 'mixed', allowedSizesMm: [2, 2.8, 4], minSizeMm: 2, maxSizeMm: 4 },
  lineDesign: { mode: 'line-design' }
};

// Every field at full precision (String(number) round-trips), in order.
const stoneDigest = (stones) => createHash('sha256').update(stones.map((s) =>
  [s.xMm, s.yMm, s.sizeMm, s.color, s.index, JSON.stringify(s.metadata ?? {})].join(',')).join(';')).digest('hex').slice(0, 16);
const liveDigest = (stones) => createHash('sha256').update(stones.map((s) => [s.x, s.y, s.d, s.color, s.layerId].join(',')).join(';')).digest('hex').slice(0, 16);
const contourDigest = (contours) => createHash('sha256').update(contours.map((c) => c.map((p) => `${p.xMm},${p.yMm}`).join(' ')).join('|')).digest('hex').slice(0, 16);
const regionsDigest = (regions) => createHash('sha256').update(regions.map((r) => `${r.colorId}:${contourDigest(r.contours)}`).join(';')).digest('hex').slice(0, 16);

// Pinned on develop @ b22053b, where no image generation reads rotationDeg.
const PINNED = {
  engine: {
    fill: '99bd1dbc7b2d0392', staggeredFillGaps: '0cd88f9918a629a0', radial: 'f55eac61da9b1d9b',
    contour: '48d336f39f3d9731', organic: '7eb2c466ed7e2c57', edge: 'cb3b837fad7cdb1e',
    brightness: '79c5ffc4f959ee14', mixed: '13af874660954ffd', lineDesign: '2f97a31a8c3ce2cc'
  },
  live: { staggered: '797ad52ad3430136', lineDesign: '58883c2d1d3b23f8' },
  regions: 'b0678a09255c2e44',
  boolean: 'fdb389961b5ae2cf'
};

// The test's own rotation, independent of GeometryEngine's rotatePointsAroundCenter(): clockwise in
// the Y-down mm space, about the centre of the unrotated placement box.
function rotateAboutBoxCentre(p, deg, box = BOX) {
  const cx = box.xMm + box.widthMm / 2, cy = box.yMm + box.heightMm / 2;
  const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
  const dx = p.xMm - cx, dy = p.yMm - cy;
  return { xMm: cx + dx * c - dy * s, yMm: cy + dx * s + dy * c };
}
function assertRigidlyRotated(rotated, base, deg, label) {
  assert.equal(rotated.length, base.length, `${label}: same stone count`);
  assert.ok(base.length > 0, `${label}: the fixture produces stones`);
  for (let i = 0; i < base.length; i++) {
    const want = rotateAboutBoxCentre(base[i], deg);
    assert.ok(Math.abs(rotated[i].xMm - want.xMm) <= 1e-9 && Math.abs(rotated[i].yMm - want.yMm) <= 1e-9,
      `${label}: stone ${i} is at (${rotated[i].xMm}, ${rotated[i].yMm}), expected (${want.xMm}, ${want.yMm})`);
    assert.equal(rotated[i].sizeMm, base[i].sizeMm, `${label}: stone ${i} size`);
    assert.equal(rotated[i].color, base[i].color, `${label}: stone ${i} colour`);
    assert.equal(rotated[i].index, base[i].index, `${label}: stone ${i} index`);
    assert.deepEqual(rotated[i].metadata, base[i].metadata, `${label}: stone ${i} metadata`);
  }
}

// The real generateImageStonesLive() method body, extracted and run against stubs (the
// tools/test-img-013-fill-empty-slots.mjs item 12 pattern).
function extractMethod(startMarker) {
  const start = appJs.indexOf(startMarker);
  assert.ok(start !== -1, `expected to find ${startMarker} in app.js`);
  let depth = 0;
  for (let i = start + startMarker.length - 1; i < appJs.length; i++) {
    if (appJs[i] === '{') depth++;
    else if (appJs[i] === '}') { depth--; if (depth === 0) return appJs.slice(start, i + 1); }
  }
  throw new Error(`no closing brace for ${startMarker}`);
}
function buildGenerateImageStonesLive(lineDesignStoneCache = new Map(), lineDesignFrozen = false) {
  const source = extractMethod('async generateImageStonesLive(layer,{includeStats=false}={}){')
    .replace('async generateImageStonesLive(', 'async function generateImageStonesLive(');
  const deps = {
    imageBufferCache: new Map([['img1', BUFFER]]),
    decodeDataUrlToBuffer: async () => { throw new Error('unexpected decode'); },
    resolveImageFillMode: (v) => v ?? 'fill',
    resolveImageTransparentMode: (v) => v ?? 'white',
    resolveImageMaskMode: (v) => (v === 'subject' || v === 'whole' ? v : 'threshold'),
    resolveImageColorCount: (layer) => layer.colorCount ?? 1,
    imageColorPalette: () => PALETTE,
    resolveImageSeed: (v) => v ?? 1,
    resolveImageSpread: (v) => v ?? 1,
    resolveImageEdgeWidth: (v) => v ?? 6,
    resolveImageEdgeThinning: (v) => v ?? 1,
    resolveImageBrightnessThinning: (v) => v ?? 0,
    mixedSizeParamsFor: () => ({}),
    resolveImageVividness: (v) => (typeof v === 'number' ? v : 1),
    lineDesignStoneCache,
    lineDesignFrozen,
    lineDesignColorMapKey: (m) => Object.keys(m || {}).sort().map((k) => `${k}=${m[k]}`).join(',')
  };
  const names = Object.keys(deps);
  // eslint-disable-next-line no-new-func
  return new Function(...names, `return ${source};`)(...names.map((n) => deps[n]));
}
const LAYER = {
  id: 'I', imageSrc: 'img1', x: BOX.xMm, y: BOX.yMm, w: BOX.widthMm, h: BOX.heightMm,
  stoneSize: 2, gap: 0.3, color: 'gold', fillMode: 'staggered', threshold: 128, invert: false,
  blurRadiusPx: 0, maxWidthPx: 96, maxHeightPx: 72, transparent: 'white', maskMode: 'threshold',
  colorCount: 3, colorMap: {}
};
function spyEngine() {
  const calls = [];
  return { calls, generateImageLayout: (params) => { calls.push(params); return engine.generateImageLayout(params); } };
}

function polygonArea(contour) {
  let a = 0;
  for (let i = 0; i < contour.length; i++) { const p = contour[i], q = contour[(i + 1) % contour.length]; a += p.xMm * q.yMm - q.xMm * p.yMm; }
  return a / 2;
}
function areaCentroid(contours) {
  let area = 0, cx = 0, cy = 0;
  for (const contour of contours) for (let i = 0; i < contour.length; i++) {
    const p = contour[i], q = contour[(i + 1) % contour.length], cross = p.xMm * q.yMm - q.xMm * p.yMm;
    area += cross / 2; cx += (p.xMm + q.xMm) * cross / 6; cy += (p.yMm + q.yMm) * cross / 6;
  }
  return { area: Math.abs(area), xMm: cx / area, yMm: cy / area };
}
const booleanFieldSource = (over = {}) => ({ kind: 'field', field: prepareImageField(BUFFER, { threshold: 128, maxWidthPx: 96, maxHeightPx: 72 }), ...BOX, ...over });

await test('T1. Rotation 0 or missing is byte-identical to develop (pinned digests), every mode', () => {
  for (const [name, over] of Object.entries(CASES)) {
    const params = { ...BASE, ...over };
    const missing = stoneDigest(engine.generateImageLayout(params).stones);
    assert.equal(missing, PINNED.engine[name], `${name}: rotationDeg missing`);
    for (const rotationDeg of [0, 360, -0]) {
      assert.equal(stoneDigest(engine.generateImageLayout({ ...params, rotationDeg }).stones), PINNED.engine[name], `${name}: rotationDeg ${rotationDeg}`);
    }
  }
});

await test('T2. At 30 and 90 degrees every stone is the unrotated stone rotated about the box centre (1e-9 mm), same count, sizes, colours and Check & Fix stats', () => {
  for (const [name, over] of Object.entries(CASES)) {
    if (name === 'lineDesign') continue;
    const base = engine.generateImageLayout({ ...BASE, ...over });
    for (const deg of [30, 90]) {
      const rotated = engine.generateImageLayout({ ...BASE, ...over, rotationDeg: deg });
      assertRigidlyRotated(rotated.stones, base.stones, deg, `${name} at ${deg}`);
      assert.deepEqual(rotated.checkFixStats, base.checkFixStats, `${name} at ${deg}: checkFixStats`);
    }
    const negative = engine.generateImageLayout({ ...BASE, ...over, rotationDeg: -330 });
    assertRigidlyRotated(negative.stones, base.stones, 30, `${name} at -330`);
  }
});

await test('T3. Line Design at 30 and 90 degrees: every stone rotated rigidly, kinds and colours kept', () => {
  const base = engine.generateImageLayout({ ...BASE, ...CASES.lineDesign });
  assert.ok(base.stones.some((s) => s.metadata.kind !== base.stones[0].metadata.kind), 'the fixture produces more than one Line Design population');
  for (const deg of [30, 90]) {
    assertRigidlyRotated(engine.generateImageLayout({ ...BASE, ...CASES.lineDesign, rotationDeg: deg }).stones, base.stones, deg, `line-design at ${deg}`);
  }
});

await test('T4. app.js passes rotationDeg into every image generation call, and the Line Design cache key includes it', async () => {
  for (const fillMode of ['staggered', 'line-design']) {
    const spy = spyEngine();
    const cache = new Map();
    const fn = buildGenerateImageStonesLive(cache, false);
    const rotated = await fn.call({ permanentEngine: spy }, { ...LAYER, fillMode, rotationDeg: 30 });
    assert.equal(spy.calls.at(-1).rotationDeg, 30, `${fillMode}: params carry rotationDeg`);
    const base = await fn.call({ permanentEngine: spy }, { ...LAYER, fillMode, rotationDeg: 0 });
    assert.equal(spy.calls.at(-1).rotationDeg, 0, `${fillMode}: params carry rotationDeg 0`);
    const { rotationDeg: _omit, ...legacy } = { ...LAYER, fillMode };
    await fn.call({ permanentEngine: spy }, legacy);
    assert.equal(spy.calls.at(-1).rotationDeg, 0, `${fillMode}: a layer with no rotationDeg passes 0`);
    assertRigidlyRotated(rotated.map((s) => ({ xMm: s.x, yMm: s.y, sizeMm: s.d, color: s.color })), base.map((s) => ({ xMm: s.x, yMm: s.y, sizeMm: s.d, color: s.color })), 30, `${fillMode} through app.js`);
  }

  const spy = spyEngine();
  const cache = new Map();
  const fn = buildGenerateImageStonesLive(cache, false);
  const layer = { ...LAYER, fillMode: 'line-design', rotationDeg: 30 };
  await fn.call({ permanentEngine: spy }, layer);
  await fn.call({ permanentEngine: spy }, layer);
  assert.equal(spy.calls.length, 1, 'the same rotation hits the Line Design cache');
  await fn.call({ permanentEngine: spy }, { ...layer, rotationDeg: 45 });
  assert.equal(spy.calls.length, 2, 'a new rotation misses the Line Design cache');
  const key = /const key=\[layer\.id,[^\]]*\]\.join\('\|'\);/.exec(extractMethod('async generateImageStonesLive(layer,{includeStats=false}={}){'));
  assert.ok(key && key[0].includes('layer.rotationDeg??0'), 'the Line Design cache key includes layer.rotationDeg??0');

  const exportRegions = extractMethod('function resolveImageExportRegions(project){');
  assert.ok(exportRegions.includes('rotationDeg:layer.rotationDeg??0'), 'resolveImageExportRegions() passes rotationDeg');
  assert.ok(appJs.includes("return{kind:'field',field,xMm:layer.x,yMm:layer.y,widthMm:layer.w,heightMm:layer.h,rotationDeg:layer.rotationDeg??0};"), 'the Boolean field source carries rotationDeg');
  assert.match(appJs, /drag=\{kind:'rotate',[^;]*\};\n\s*if\(hit\.layer\.type==='image'&&resolveImageFillMode\(hit\.layer\.fillMode\)==='line-design'\)lineDesignFrozen=true;/, 'a rotate drag of a Line Design image freezes the cache');
});

await test('T4b. endActiveDrag() unfreezes and regenerates once after a rotate drag, as after a resize', () => {
  const body = extractMethod('function endActiveDrag(){');
  // eslint-disable-next-line no-new-func
  const run = new Function('state', `let drag=state.drag,activeGuides=[],lineDesignFrozen=state.frozen;const drawLayout=()=>{};const updateAll=()=>{state.updates++};const invalidateLineDesignCache=(id)=>{state.invalidated.push(id)};${body}endActiveDrag();state.frozen=lineDesignFrozen;`);
  for (const kind of ['resize', 'rotate']) {
    const state = { drag: { kind, layerId: 'I' }, frozen: true, updates: 0, invalidated: [] };
    run(state);
    assert.equal(state.frozen, false, `${kind}: unfrozen`);
    assert.deepEqual(state.invalidated, ['I'], `${kind}: cache invalidated`);
    assert.equal(state.updates, 1, `${kind}: one regeneration`);
  }
  const unfrozen = { drag: { kind: 'rotate', layerId: 'I' }, frozen: false, updates: 0, invalidated: [] };
  run(unfrozen);
  assert.equal(unfrozen.updates, 0, 'an unfrozen rotate drag does not regenerate at release');
});

await test('T5. A non-rotated project is unchanged: live stones, SVG regions and Boolean trace match develop', async () => {
  for (const fillMode of ['staggered', 'line-design']) {
    const fn = buildGenerateImageStonesLive(new Map(), false);
    const { rotationDeg: _omit, ...legacy } = { ...LAYER, fillMode };
    const pin = fillMode === 'staggered' ? 'staggered' : 'lineDesign';
    assert.equal(liveDigest(await fn.call({ permanentEngine: engine }, legacy)), PINNED.live[pin], `${fillMode}: no rotationDeg key`);
    assert.equal(liveDigest(await buildGenerateImageStonesLive(new Map(), false).call({ permanentEngine: engine }, { ...legacy, rotationDeg: 0 })), PINNED.live[pin], `${fillMode}: rotationDeg 0`);
  }
  for (const over of [{}, { rotationDeg: 0 }]) {
    assert.equal(regionsDigest(engine.resolveImagePolygons({ ...BASE, ...over }).regions), PINNED.regions, `regions ${JSON.stringify(over)}`);
    assert.equal(contourDigest(combineShapeSources(booleanFieldSource(over), null, 'union', { targetSpacingMm: 2.3 }).contours), PINNED.boolean, `boolean ${JSON.stringify(over)}`);
  }
});

await test('T6. D3: SVG regions rotate rigidly with the stones; a rotated Boolean field source traces the rotated shape', () => {
  const base = engine.resolveImagePolygons(BASE);
  for (const deg of [30, 90]) {
    const rotated = engine.resolveImagePolygons({ ...BASE, rotationDeg: deg });
    assert.deepEqual(rotated.regions.map((r) => r.colorId), base.regions.map((r) => r.colorId), `${deg}: same regions`);
    rotated.regions.forEach((region, r) => {
      const flat = region.contours.flat(), baseFlat = base.regions[r].contours.flat();
      assert.equal(flat.length, baseFlat.length, `${deg}: region ${r} point count`);
      flat.forEach((p, i) => {
        const want = rotateAboutBoxCentre(baseFlat[i], deg);
        assert.ok(Math.abs(p.xMm - want.xMm) <= 1e-9 && Math.abs(p.yMm - want.yMm) <= 1e-9, `${deg}: region ${r} point ${i}`);
      });
    });
  }

  const upright = areaCentroid(combineShapeSources(booleanFieldSource(), null, 'union', { targetSpacingMm: 2.3 }).contours);
  for (const deg of [30, 90]) {
    const turned = areaCentroid(combineShapeSources(booleanFieldSource({ rotationDeg: deg }), null, 'union', { targetSpacingMm: 2.3 }).contours);
    const want = rotateAboutBoxCentre(upright, deg);
    assert.ok(Math.abs(turned.area - upright.area) / upright.area < 0.03, `${deg}: traced area ${turned.area} vs ${upright.area}`);
    assert.ok(Math.hypot(turned.xMm - want.xMm, turned.yMm - want.yMm) < 0.25, `${deg}: centroid (${turned.xMm}, ${turned.yMm}) vs (${want.xMm}, ${want.yMm})`);
  }
});

await test('T7. D4: the Studio frames the rotated box and draws every bitmap view through the rotated box', () => {
  const studio = extractMethod('async function renderImageStudio(){');
  assert.ok(studio.includes('const studioBox=rotatedCornersAABB(l.x,l.y,l.w,l.h,studioRotationDeg);'), 'the Studio frame is the rotated box');
  assert.ok(studio.includes('const bbox={minXmm:studioBox.x,minYmm:studioBox.y,widthMm:studioBox.width,heightMm:studioBox.height};'), 'fitTransform() fits the rotated box');
  assert.equal((studio.match(/ctx\.drawImage\(/g) || []).length, 2, 'the only drawImage() calls are the two inside drawInBox()');
  assert.equal((studio.match(/drawInBox\(/g) || []).length, 3, 'source, mask and colours each go through drawInBox()');
});

// Boolean Operations over every other operand kind. The polygon operands are resolved the way
// app.js's resolveLayerShapeSource() resolves them; the text operand uses the repo's own font files.
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const fontManager = new FontManager(JSON.parse(await readFile(path.join(repoRoot, 'assets/fonts/manifest.json'), 'utf8')));
const textEngine = new GeometryEngine({
  fontProviderRegistry: createDefaultFontProviderRegistry(fontManager, {
    loadFontBuffer: async (relativePath) => {
      const buffer = await readFile(path.join(repoRoot, relativePath));
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    }
  })
});
async function booleanOperands() {
  const text = await textEngine.resolveTextPolygons({ text: 'Ab', fontId: 'courier-prime-regular', layerId: 'T', heightMm: 24 });
  const polygons = (resolved) => ({ kind: 'polygons', polygons: resolved.polygons });
  return {
    path: polygons(engine.resolvePathPolygons({ contours: [[{ xMm: 0, yMm: 0 }, { xMm: 30, yMm: 4 }, { xMm: 22, yMm: 26 }, { xMm: 4, yMm: 20 }]], layerId: 'P', xMm: 20, yMm: 28, widthMm: 40, heightMm: 30 })),
    shape: polygons(engine.resolveShapePolygons({ shape: 'rectangle', layerId: 'S', xMm: 30, yMm: 15, widthMm: 50, heightMm: 20, rotationDeg: 20 })),
    text: { kind: 'polygons', polygons: text.polygons.map((poly) => poly.map((p) => ({ xMm: p.xMm + 40, yMm: p.yMm + 48 }))) },
    svg: polygons(engine.resolveSvgPolygons({ svgSource: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M2 2 L18 4 L10 18 Z"/></svg>', layerId: 'V', xMm: 40, yMm: 30, widthMm: 30, heightMm: 30 }))
  };
}
const BOOLEAN_OPERATIONS = ['union', 'subtract', 'intersect', 'xor'];
const booleanDigest = (subject, clip, operation) => contourDigest(combineShapeSources(subject, clip, operation, { targetSpacingMm: 2.3 }).contours);

// Pinned on the IMG-021 spec commit (5d80e6e), before any IMG-021 source change.
const PINNED_BOOLEAN = {
  'path alone': '7d2bcc6ca5c2473d', 'path union image': '66fec4feb5b5f033', 'image union path': '66fec4feb5b5f033',
  'path subtract image': '81847af5da621431', 'image subtract path': '4838c63a2546a357', 'path intersect image': '0aa4ae87ef19220a',
  'image intersect path': '0aa4ae87ef19220a', 'path xor image': '3520a267ada4a033', 'image xor path': '3520a267ada4a033',
  'shape alone': '9cb06ba7e14c7e80', 'shape union image': '0211247dbba42243', 'image union shape': '0211247dbba42243',
  'shape subtract image': 'f9af1a6b2edb7df9', 'image subtract shape': '45a454ca008a637b', 'shape intersect image': 'bd25bf76eed02523',
  'image intersect shape': 'bd25bf76eed02523', 'shape xor image': '433f95e8d74a077a', 'image xor shape': '433f95e8d74a077a',
  'text alone': '0263cb1d98c6dd79', 'text union image': '1cfd13f8b7ad1243', 'image union text': '1cfd13f8b7ad1243',
  'text subtract image': '60ef606963c6d5f2', 'image subtract text': '941f89add49de796', 'text intersect image': '4834d78c479fa4b5',
  'image intersect text': '4834d78c479fa4b5', 'text xor image': '07222105dd57e9fc', 'image xor text': '07222105dd57e9fc',
  'svg alone': '1b2d48c5235fb65b', 'svg union image': 'd719390fd7254d90', 'image union svg': 'd719390fd7254d90',
  'svg subtract image': '0fe1772b08183628', 'image subtract svg': '8fd29460ca5fbfad', 'svg intersect image': '0b222b5b7dc24a0e',
  'image intersect svg': '0b222b5b7dc24a0e', 'svg xor image': 'e0e42432a8b7510b', 'image xor svg': 'e0e42432a8b7510b',
  'path union shape': 'e9b4d2855caae19f', 'path subtract shape': '63493c0795a734b0', 'path intersect shape': 'b4c0f93e17730385',
  'path xor shape': '9d605d9c1a3b6d51', 'path union text': 'af2e02bae91ea094', 'path subtract text': '6d751cb35ed59a2d',
  'path intersect text': 'f0ace09eb5f4236c', 'path xor text': '2635d6fc36c02a8b', 'path union svg': '1b218a2e72e8d1ab',
  'path subtract svg': 'a8294332da940f52', 'path intersect svg': 'db97ed56c3266c8d', 'path xor svg': 'b9b73d1549c35275',
  'shape union text': 'fae33cf70a641864', 'shape subtract text': '2e1c7fe670e5c144', 'shape intersect text': '67d0f42aaffa06b4',
  'shape xor text': 'a1514f21771f29c5', 'shape union svg': '92a976ad1b9edf65', 'shape subtract svg': '258957fd6b424e82',
  'shape intersect svg': '03146b38c246ea58', 'shape xor svg': '98a75c9f269701c0', 'text union svg': 'fa7cff133e524d40',
  'text subtract svg': '9812d5af68d2aade', 'text intersect svg': '06a0713fb62769c0', 'text xor svg': '76b56ad51dae8bee'
};

await test('T8. D3: Boolean Operations on path, shape, text and SVG operands are byte-identical; a rotated image operand combines as the rotated shape', async () => {
  const operands = await booleanOperands();
  for (const [name, operand] of Object.entries(operands)) {
    assert.ok(operand.polygons.length > 0, `${name}: the operand has polygons`);
    assert.equal(booleanDigest(operand, null, 'union'), PINNED_BOOLEAN[`${name} alone`], `${name} alone`);
    for (const operation of BOOLEAN_OPERATIONS) {
      assert.equal(booleanDigest(operand, booleanFieldSource(), operation), PINNED_BOOLEAN[`${name} ${operation} image`], `${name} ${operation} image`);
      assert.equal(booleanDigest(booleanFieldSource(), operand, operation), PINNED_BOOLEAN[`image ${operation} ${name}`], `image ${operation} ${name}`);
    }
  }
  const names = Object.keys(operands);
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
    for (const operation of BOOLEAN_OPERATIONS) {
      assert.equal(booleanDigest(operands[names[i]], operands[names[j]], operation), PINNED_BOOLEAN[`${names[i]} ${operation} ${names[j]}`], `${names[i]} ${operation} ${names[j]}`);
    }
  }

  // The rotated image: turning the whole scene back by the image's rotation, combining with the
  // upright image and turning the result forward gives the same shape, to within the tracing grid
  // (the two traces sample different world-space grids, so thin text strokes differ by a few mm^2).
  const cx = BOX.xMm + BOX.widthMm / 2, cy = BOX.yMm + BOX.heightMm / 2;
  const turn = (p, deg) => {
    const r = deg * Math.PI / 180;
    return { xMm: cx + (p.xMm - cx) * Math.cos(r) - (p.yMm - cy) * Math.sin(r), yMm: cy + (p.xMm - cx) * Math.sin(r) + (p.yMm - cy) * Math.cos(r) };
  };
  for (const deg of [30, 90]) {
    for (const [name, operand] of Object.entries(operands)) {
      const turnedBack = { kind: 'polygons', polygons: operand.polygons.map((poly) => poly.map((p) => turn(p, -deg))) };
      for (const operation of ['union', 'intersect']) {
        const got = areaCentroid(combineShapeSources(booleanFieldSource({ rotationDeg: deg }), operand, operation, { targetSpacingMm: 2.3 }).contours);
        const upright = combineShapeSources(booleanFieldSource(), turnedBack, operation, { targetSpacingMm: 2.3 }).contours;
        const want = areaCentroid(upright.map((contour) => contour.map((p) => turn(p, deg))));
        const label = `${name} ${operation} image at ${deg}`;
        assert.ok(Math.abs(got.area - want.area) < 12, `${label}: area ${got.area} vs ${want.area}`);
        assert.ok(Math.hypot(got.xMm - want.xMm, got.yMm - want.yMm) < 0.5, `${label}: centroid (${got.xMm}, ${got.yMm}) vs (${want.xMm}, ${want.yMm})`);
      }
    }
  }
});

await test('Registered in tools/test-groups.mjs', () => {
  assertTestRegistered({ filename: 'test-img-021-rotated-image-stones.mjs', group: 'geometry', includedInDefault: true });
});
