import assert from 'node:assert/strict';
import {
  createImageBuffer,
  prepareImageField
} from '../src/image/index.js';
import {
  quantizeColors,
  FIELD_ON_THRESHOLD as COLOR_QUANTIZE_FIELD_ON_THRESHOLD,
  NO_LABEL as COLOR_QUANTIZE_NO_LABEL
} from '../src/image/ColorQuantize.js';
import {
  createGeometryEngine,
  fieldLabelAt,
  findCrossGroupCollisions
} from '../src/geometry/index.js';
import {
  FIELD_ON_THRESHOLD as GEOMETRY_FIELD_ON_THRESHOLD,
  NO_LABEL as GEOMETRY_NO_LABEL
} from '../src/geometry/StoneSampler.js';

// IMG-002 -- unit tests for the color quantizer (src/image/ColorQuantize.js), its wiring into
// prepareImageField() (src/image/ImageFieldPipeline.js), and GeometryEngine.generateImageLayout()'s
// per-stone label lookup (fieldLabelAt(), src/geometry/StoneSampler.js). See
// docs/specifications/IMG-002-ColorLayers.md, "Test Plan".

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

function rgba(pixels) {
  const data = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach(([r, g, b, a], i) => {
    data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = a;
  });
  return data;
}

// A small synthetic catalog, independent of the real src/renderer/CrystalColors.js -- ColorQuantize.js
// never imports src/geometry/**/src/renderer/**, so its palette is always plain caller-supplied data;
// these hex values are deliberately close to the fixtures' own region colors below so nearestId
// resolution is unambiguous.
const PALETTE = [
  { id: 'p-red', hex: '#c81414' },
  { id: 'p-green', hex: '#14b414' },
  { id: 'p-blue', hex: '#1414c8' },
  { id: 'p-white', hex: '#ffffff' }
];

// 4x4: top-left quadrant fully transparent, top-right dark red, bottom-left dark green,
// bottom-right dark blue -- all luminance low enough (<128) to be FIELD_ON_THRESHOLD-eligible except
// the transparent quadrant, which transparent:'ignore' forces off regardless of luminance. Mirrors
// tools/test-img-001-field.mjs's transparentQuadrantBuffer()/QUADRANT_INDICES convention (4x4, no
// resize, exact 0/255 values, no box-average ambiguity at region boundaries).
function threeRegionTransparentQuadrantBuffer() {
  const pixels = [];
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      if (x < 2 && y < 2) pixels.push([0, 0, 0, 0]); // transparent quadrant
      else if (x >= 2 && y < 2) pixels.push([200, 20, 20, 255]); // dark red
      else if (x < 2 && y >= 2) pixels.push([20, 180, 20, 255]); // dark green
      else pixels.push([20, 20, 200, 255]); // dark blue
    }
  }
  return createImageBuffer({ widthPx: 4, heightPx: 4, data: rgba(pixels) });
}
const QUADRANT_TRANSPARENT = [0, 1, 4, 5];
const QUADRANT_RED = [2, 3, 6, 7];
const QUADRANT_GREEN = [8, 9, 12, 13];
const QUADRANT_BLUE = [10, 11, 14, 15];

// widthPx x heightPx, opaque, split into three equal vertical bands (red | green | blue) -- used by
// every test below that needs a real, sampleable placement box rather than exact single-pixel
// regions (mode-sequence comparison, cross-group collisions, colorMap override, NO_LABEL sweep).
function threeBandBuffer(widthPx, heightPx) {
  const pixels = [];
  const third = Math.floor(widthPx / 3);
  for (let y = 0; y < heightPx; y++) {
    for (let x = 0; x < widthPx; x++) {
      if (x < third) pixels.push([200, 20, 20, 255]);
      else if (x < third * 2) pixels.push([20, 180, 20, 255]);
      else pixels.push([20, 20, 200, 255]);
    }
  }
  return createImageBuffer({ widthPx, heightPx, data: rgba(pixels) });
}

const BAND_SIZE_PX = 30;
const BASE_PARAMS = {
  layerId: 'img002-fixture', xMm: 2, yMm: 3, widthMm: 20, heightMm: 20,
  stoneSizeMm: 1.5, gapMm: 0.3, threshold: 128, invert: false, blurRadiusPx: 0,
  maxWidthPx: BAND_SIZE_PX, maxHeightPx: BAND_SIZE_PX, transparent: 'white', color: 'gold'
};

await test('1. quantizer determinism: ColorQuantize.js run twice on the same fixture/palette produces deepEqual labels/colorGroups', () => {
  const length = 20;
  const r = new Uint8ClampedArray(length), g = new Uint8ClampedArray(length), b = new Uint8ClampedArray(length);
  const data = new Uint8ClampedArray(length).fill(255);
  const shades = [[200, 20, 20], [20, 180, 20], [20, 20, 200], [120, 120, 10]];
  for (let i = 0; i < length; i++) {
    const [sr, sg, sb] = shades[i % shades.length];
    r[i] = sr; g[i] = sg; b[i] = sb;
  }

  const first = quantizeColors({ r, g, b, data, colorCount: 4, palette: PALETTE });
  const second = quantizeColors({ r, g, b, data, colorCount: 4, palette: PALETTE });
  assert.deepEqual(Array.from(first.labels), Array.from(second.labels));
  assert.deepEqual(first.colorGroups, second.colorGroups);
});

await test('2. region-correct labels: three flat color regions each get one consistent label, the transparent quadrant is NO_LABEL (255)', () => {
  const buffer = threeRegionTransparentQuadrantBuffer();
  const field = prepareImageField(buffer, {
    threshold: 128, invert: false, blurRadiusPx: 0, maxWidthPx: 4, maxHeightPx: 4,
    transparent: 'ignore', colorCount: 3, palette: PALETTE
  });

  assert.ok(field.labels, 'expected labels to be populated');
  for (const i of QUADRANT_TRANSPARENT) assert.equal(field.labels[i], 255, `pixel ${i} (transparent) expected NO_LABEL`);

  for (const region of [QUADRANT_RED, QUADRANT_GREEN, QUADRANT_BLUE]) {
    const regionLabels = new Set(region.map((i) => field.labels[i]));
    assert.equal(regionLabels.size, 1, `expected one consistent label across region pixels ${region}, got ${[...regionLabels]}`);
    assert.notEqual([...regionLabels][0], 255, `region ${region} unexpectedly resolved to NO_LABEL`);
  }
  const redLabel = field.labels[QUADRANT_RED[0]];
  const greenLabel = field.labels[QUADRANT_GREEN[0]];
  const blueLabel = field.labels[QUADRANT_BLUE[0]];
  assert.equal(new Set([redLabel, greenLabel, blueLabel]).size, 3, 'expected three distinct region labels');
});

await test('3. colorCount omitted: labels stays null and the field keeps exactly the seven-key IMG-001/IMG-004 shape (colorGroups absent)', () => {
  const buffer = threeRegionTransparentQuadrantBuffer();
  const field = prepareImageField(buffer, { threshold: 128, maxWidthPx: 4, maxHeightPx: 4, transparent: 'ignore' });
  // IMG-004: field.edge is computed unconditionally alongside data/luminance/alpha -- see
  // docs/specifications/IMG-004-EdgeAwareness.md decision 4.
  assert.deepEqual(new Set(Object.keys(field)), new Set(['widthPx', 'heightPx', 'data', 'luminance', 'alpha', 'edge', 'labels']));
  assert.equal(field.labels, null);
});

await test('4. byte-identity vs. develop: colorCount omitted, generateImageLayout() matches a stone list frozen from develop', () => {
  // Reference values captured by running develop's (pre-IMG-002) GeometryEngine.generateImageLayout()
  // directly: `git archive develop src | tar -x` into a scratch copy of the whole src/ tree (develop
  // at f1e5dee, the exact merge-base of this branch and develop -- `git diff 733801c develop --
  // src/geometry src/image` produced no output, confirming every intervening geometry/image file is
  // byte-identical to this branch's own parent commit), then a scratch script
  // (tools/scratch/run-img002-baseline.mjs, discarded after use, never committed) called
  // createGeometryEngine({}).generateImageLayout() with the exact buffer/params below and printed the
  // result. Output (8 stones, two rows of four, sizeMm 2, color 'gold'):
  //   [{xMm:4.15,yMm:6.15},{xMm:6.449999999999999,yMm:6.15},{xMm:8.75,yMm:6.15},{xMm:11.05,yMm:6.15},
  //    {xMm:4.15,yMm:8.45},{xMm:6.449999999999999,yMm:8.45},{xMm:8.75,yMm:8.45},{xMm:11.05,yMm:8.45}]
  const buffer = createImageBuffer({
    widthPx: 4,
    heightPx: 4,
    data: rgba(Array.from({ length: 16 }, (_, i) => (i < 8 ? [0, 0, 0, 255] : [255, 255, 255, 255])))
  });

  const engine = createGeometryEngine({});
  const result = engine.generateImageLayout({
    imageBuffer: buffer, layerId: 'img002-ref', xMm: 3, yMm: 5, widthMm: 10, heightMm: 10,
    stoneSizeMm: 2, gapMm: 0.3, mode: 'fill', color: 'gold', threshold: 128, invert: false,
    blurRadiusPx: 0, maxWidthPx: 4, maxHeightPx: 4, transparent: 'white'
  });

  const expected = [
    { xMm: 4.15, yMm: 6.15, sizeMm: 2, color: 'gold', index: 0 },
    { xMm: 6.449999999999999, yMm: 6.15, sizeMm: 2, color: 'gold', index: 1 },
    { xMm: 8.75, yMm: 6.15, sizeMm: 2, color: 'gold', index: 2 },
    { xMm: 11.05, yMm: 6.15, sizeMm: 2, color: 'gold', index: 3 },
    { xMm: 4.15, yMm: 8.45, sizeMm: 2, color: 'gold', index: 4 },
    { xMm: 6.449999999999999, yMm: 8.45, sizeMm: 2, color: 'gold', index: 5 },
    { xMm: 8.75, yMm: 8.45, sizeMm: 2, color: 'gold', index: 6 },
    { xMm: 11.05, yMm: 8.45, sizeMm: 2, color: 'gold', index: 7 }
  ];
  assert.deepEqual(result.stones.map((s) => ({ xMm: s.xMm, yMm: s.yMm, sizeMm: s.sizeMm, color: s.color, index: s.index })), expected);
});

await test('5. FIELD_ON_THRESHOLD and NO_LABEL parity: src/geometry/StoneSampler.js and src/image/ColorQuantize.js agree', () => {
  assert.equal(GEOMETRY_FIELD_ON_THRESHOLD, COLOR_QUANTIZE_FIELD_ON_THRESHOLD);
  assert.equal(COLOR_QUANTIZE_FIELD_ON_THRESHOLD, 128);
  assert.equal(GEOMETRY_NO_LABEL, COLOR_QUANTIZE_NO_LABEL);
  assert.equal(COLOR_QUANTIZE_NO_LABEL, 255);
});

await test('6. per mode: colorCount:3 and colorCount:1 produce identical (xMm, yMm, sizeMm, index) sequences -- only color differs', () => {
  const buffer = threeBandBuffer(BAND_SIZE_PX, BAND_SIZE_PX);
  const engine = createGeometryEngine({});
  for (const mode of ['fill', 'staggered', 'radial', 'contour']) {
    const single = engine.generateImageLayout({ ...BASE_PARAMS, imageBuffer: buffer, mode, colorCount: 1 });
    const multi = engine.generateImageLayout({ ...BASE_PARAMS, imageBuffer: buffer, mode, colorCount: 3, palette: PALETTE });
    assert.ok(single.stones.length > 0, `mode ${mode}: expected the baseline run to produce stones`);
    assert.equal(multi.stones.length, single.stones.length, `mode ${mode}: stone count differs`);
    for (let i = 0; i < single.stones.length; i++) {
      assert.equal(multi.stones[i].xMm, single.stones[i].xMm, `mode ${mode} stone ${i} xMm`);
      assert.equal(multi.stones[i].yMm, single.stones[i].yMm, `mode ${mode} stone ${i} yMm`);
      assert.equal(multi.stones[i].sizeMm, single.stones[i].sizeMm, `mode ${mode} stone ${i} sizeMm`);
      assert.equal(multi.stones[i].index, single.stones[i].index, `mode ${mode} stone ${i} index`);
    }
  }
});

await test('7. findCrossGroupCollisions() over colorCount:3 stones, grouped into per-color synthetic layerIds, returns []', () => {
  const buffer = threeBandBuffer(BAND_SIZE_PX, BAND_SIZE_PX);
  const engine = createGeometryEngine({});
  const multi = engine.generateImageLayout({ ...BASE_PARAMS, imageBuffer: buffer, mode: 'fill', colorCount: 3, palette: PALETTE });
  assert.ok(multi.stones.length > 0);
  // d = stoneSizeMm + gapMm (the sampling pitch), per the spec's own Test Plan wording -- not
  // s.sizeMm (the physical stone diameter). The per-mask-sampling regression this case exists to
  // catch produced a 3.143 mm cross-color center distance at stone size 3.0 / pitch 3.3: legal at
  // d = sizeMm (min separation 3.0) but illegal at d = pitch (min separation 3.3). See
  // docs/specifications/IMG-002-ColorLayers.md decision 1.
  //
  // The 1e-9mm slack below is float noise, not tolerance for a real violation: findCrossGroupCollisions()'s
  // threshold is a strict `<` on (a.d+b.d)/2, and the accumulated grid walk (`localXMm += spacingMm`
  // in sampleFieldFillPoints()) lands adjacent same-row points at this fixture's 1.8mm pitch up to
  // ~3e-15mm off the nominal value -- two stones exactly one pitch apart are legal, not a collision,
  // but land marginally under 1.8 by float accumulation and false-positive under a bare `<` test.
  // 1e-9 is roughly six orders of magnitude above accumulated double-precision error at millimeter
  // magnitudes, and nine below any physically meaningful overlap, so it can only ever absorb float
  // noise, never mask a real spacing violation -- the historical regression above was 0.157mm inside
  // the pitch, eight orders of magnitude clear of this slack.
  const collisionDiameterMm = BASE_PARAMS.stoneSizeMm + BASE_PARAMS.gapMm - 1e-9;
  const flatStones = multi.stones.map((s) => ({ x: s.xMm, y: s.yMm, d: collisionDiameterMm, layerId: s.color }));
  assert.deepEqual(findCrossGroupCollisions(flatStones), []);
});

await test('8. colorMap override applies to matching nearestId stones; an unknown colorMap key is ignored', () => {
  const buffer = threeBandBuffer(BAND_SIZE_PX, BAND_SIZE_PX);
  const engine = createGeometryEngine({});
  const base = engine.generateImageLayout({ ...BASE_PARAMS, imageBuffer: buffer, mode: 'fill', colorCount: 3, palette: PALETTE });
  assert.ok(base.stones.length > 0);
  const targetColor = base.stones[0].color;
  const overridden = engine.generateImageLayout({
    ...BASE_PARAMS, imageBuffer: buffer, mode: 'fill', colorCount: 3, palette: PALETTE,
    colorMap: { [targetColor]: 'custom-override-id', 'totally-bogus-nearest-id': 'should-be-ignored' }
  });
  assert.equal(overridden.stones.length, base.stones.length);
  let sawOverride = false;
  for (let i = 0; i < base.stones.length; i++) {
    if (base.stones[i].color === targetColor) {
      assert.equal(overridden.stones[i].color, 'custom-override-id');
      sawOverride = true;
    } else {
      assert.equal(overridden.stones[i].color, base.stones[i].color, `stone ${i} unexpectedly changed color`);
    }
  }
  assert.ok(sawOverride, 'expected at least one stone to receive the override');
});

await test('9. one group per catalogue colour (IMG-015): two pixel colours nearest the same catalog entry form one group with that entry, not two groups with distinct entries', () => {
  const length = 10;
  const r = new Uint8ClampedArray(length), g = new Uint8ClampedArray(length), b = new Uint8ClampedArray(length);
  const data = new Uint8ClampedArray(length).fill(255);
  for (let i = 0; i < 7; i++) { r[i] = 40; g[i] = 40; b[i] = 40; }
  for (let i = 7; i < 10; i++) { r[i] = 5; g[i] = 5; b[i] = 5; }

  const contestedPalette = [
    { id: 'near-black', hex: '#101010' },
    { id: 'distant', hex: '#ffffff' }
  ];
  const { colorGroups } = quantizeColors({ r, g, b, data, colorCount: 2, palette: contestedPalette });
  assert.deepEqual(colorGroups, [{ rgb: [30, 30, 30], pixelShare: 1, nearestId: 'near-black' }]);
});

await test('10. NO_LABEL unreachability: across all four modes, with and without sizeMode:"mixed", zero stones (base or infill) resolve to NO_LABEL; mixed always adds infill', () => {
  const buffer = threeBandBuffer(BAND_SIZE_PX, BAND_SIZE_PX);
  const engine = createGeometryEngine({});
  // stoneSizeMm:3 (not BASE_PARAMS's 1.5) -- at 1.5 with this fixture, mixed mode's own eligible
  // gaps are already almost fully covered by the primary pitch, so its own infill pass adds nearly
  // nothing (measured against develop's engine: Fill +0, Staggered +0, Radial +2, Contour +0) and
  // an empty-infill regression here would have gone undetected. At 3 the primary pitch leaves real
  // gaps for infill to fill (measured: Fill +16, Staggered +5, Radial +26, Contour +11), so the
  // strictly-greater assertion below actually exercises the infill path it's meant to guard.
  const TEST_STONE_SIZE_MM = 3;
  const mixedOptions = { sizeMode: 'mixed', allowedSizesMm: [3, 0.6], minSizeMm: 0.6, maxSizeMm: 3, conservativeDetail: 1.0 };

  for (const mode of ['fill', 'staggered', 'radial', 'contour']) {
    const baseModeParams = { ...BASE_PARAMS, imageBuffer: buffer, mode, colorCount: 3, palette: PALETTE, stoneSizeMm: TEST_STONE_SIZE_MM };
    let uniformCount = null;
    for (const mixed of [false, true]) {
      const params = { ...baseModeParams, ...(mixed ? mixedOptions : {}) };
      const result = engine.generateImageLayout(params);
      assert.ok(result.stones.length > 0, `mode ${mode} mixed=${mixed}: expected stones`);
      if (!mixed) uniformCount = result.stones.length;
      else assert.ok(result.stones.length > uniformCount, `mode ${mode}: expected mixed infill to strictly add stones over uniform (uniform=${uniformCount}, mixed=${result.stones.length})`);

      const field = prepareImageField(buffer, {
        threshold: params.threshold, invert: params.invert, blurRadiusPx: params.blurRadiusPx,
        maxWidthPx: params.maxWidthPx, maxHeightPx: params.maxHeightPx, transparent: params.transparent,
        colorCount: params.colorCount, palette: PALETTE
      });
      const placement = { xMm: params.xMm, yMm: params.yMm, widthMm: params.widthMm, heightMm: params.heightMm };
      for (const stone of result.stones) {
        const label = fieldLabelAt(field, placement, stone.xMm, stone.yMm);
        assert.notEqual(label, 255, `mode ${mode} mixed=${mixed}: stone at (${stone.xMm}, ${stone.yMm}) resolved to NO_LABEL`);
      }
    }
  }
});

console.log('IMG-002 color-layer tests passed.');
