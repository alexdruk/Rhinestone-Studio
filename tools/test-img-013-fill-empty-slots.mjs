import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createGeometryEngine } from '../src/geometry/index.js';
import { prepareImageField } from '../src/image/index.js';
import { fieldLabelAt, fieldPixelOn } from '../src/geometry/StoneSampler.js';
import { generateGapFillStones, GAP_FILL_STONE_SIZE_MM } from '../src/geometry/GapFill.js';
import { STONE_COLORS } from '../src/renderer/StoneColors.js';

// IMG-013 -- Fill Empty Slots: a same-layer, additive gap-fill pass for image layers, always on for
// newly imported image layers (fillGaps:true set by the importImageFile new-layer factory), off/
// absent for every layer saved before this milestone (byte-identical regeneration). See
// docs/specifications/IMG-013-FillEmptySlots.md.
//
// Product-change override (this milestone shipped no Studio control/button -- fillGaps is a
// permissive per-layer field only, set once at import time): items 1-11/13 test src/geometry/
// GapFill.js and GeometryEngine.js directly; item 12 proves app.js's generateImageStonesLive()
// forwards it via the real, extracted source (the IMG-009 lesson: a source-text guard alone is not
// sufficient); item 14 pins the importImageFile factory literal; item 15 is the performance gate.

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

function parseHex(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

const PALETTE = Object.values(STONE_COLORS).map((c) => ({ id: c.id, hex: c.previewColor }));

// ---- Fixtures ---------------------------------------------------------------------------------

// A filled disc on white -- STEP 0's own single-colour fixture, reused here so item 13's literals
// were captured against the exact same buffer this file builds.
function buildDiscBuffer(widthPx, heightPx) {
  const data = new Uint8ClampedArray(widthPx * heightPx * 4);
  const cx = widthPx / 2, cy = heightPx / 2, r = Math.min(widthPx, heightPx) * 0.46;
  for (let y = 0; y < heightPx; y++) {
    for (let x = 0; x < widthPx; x++) {
      const i = (y * widthPx + x) * 4;
      const dx = x - cx, dy = y - cy;
      const inside = dx * dx + dy * dy <= r * r;
      data[i] = inside ? 0 : 255; data[i + 1] = inside ? 0 : 255; data[i + 2] = inside ? 0 : 255; data[i + 3] = 255;
    }
  }
  return { widthPx, heightPx, data };
}

// A four-quadrant swatch over a white border -- STEP 0's own colorCount:4/maskMode:'subject' fixture.
function buildFourQuadrantImageBuffer(widthPx, heightPx) {
  const data = new Uint8ClampedArray(widthPx * heightPx * 4);
  const colors = ['#9b1c1c', '#2269d3', '#2aa66a', '#f3bd32'];
  const x0 = Math.round(widthPx * 0.2), x1 = Math.round(widthPx * 0.8);
  const y0 = Math.round(heightPx * 0.2), y1 = Math.round(heightPx * 0.8);
  for (let y = 0; y < heightPx; y++) for (let x = 0; x < widthPx; x++) {
    const i = (y * widthPx + x) * 4;
    if (x >= x0 && x < x1 && y >= y0 && y < y1) {
      const quadrant = (x < widthPx / 2 ? 0 : 1) + (y < heightPx / 2 ? 0 : 2);
      const [cr, cg, cb] = parseHex(colors[quadrant]);
      data[i] = cr; data[i + 1] = cg; data[i + 2] = cb; data[i + 3] = 255;
    } else {
      data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = 255;
    }
  }
  return { widthPx, heightPx, data };
}

// A four-quadrant DISC (not a filled rectangle): fill mode hex-packs a solid rectangle with
// essentially no leftover room for a smaller filler, so a curved boundary is needed to expose real
// gaps -- the same reason Task D's own measurement fixture (spec section D) used a disc, not a
// rectangle.
function buildFourQuadrantDiscBuffer(widthPx, heightPx) {
  const data = new Uint8ClampedArray(widthPx * heightPx * 4);
  const colors = ['#9b1c1c', '#2269d3', '#2aa66a', '#f3bd32'];
  const cx = widthPx / 2, cy = heightPx / 2, r = Math.min(widthPx, heightPx) * 0.48;
  for (let y = 0; y < heightPx; y++) for (let x = 0; x < widthPx; x++) {
    const i = (y * widthPx + x) * 4;
    const dx = x - cx, dy = y - cy;
    if (dx * dx + dy * dy <= r * r) {
      const quadrant = (x < cx ? 0 : 1) + (y < cy ? 0 : 2);
      const [cr, cg, cb] = parseHex(colors[quadrant]);
      data[i] = cr; data[i + 1] = cg; data[i + 2] = cb; data[i + 3] = 255;
    } else {
      data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = 255;
    }
  }
  return { widthPx, heightPx, data };
}

const COLOR_FIXTURE_PARAMS = {
  layerId: 'L', xMm: 0, yMm: 0, widthMm: 60, heightMm: 60,
  stoneSizeMm: 2.8, gapMm: 0.3, mode: 'fill', color: 'jet',
  threshold: 128, invert: false, blurRadiusPx: 0, maxWidthPx: 400, maxHeightPx: 400,
  transparent: 'white', maskMode: 'threshold', colorCount: 4, palette: PALETTE, colorMap: {}
};

// ---- Item 1: off by default, byte-identical --------------------------------------------------
await test('1. Off by default: fillGaps omitted resolves to false in normalizeImageParams(), and generateImageLayout() produces the identical stone array (length, xMm/yMm/sizeMm/color, in order) whether fillGaps is omitted or explicitly false', () => {
  const engine = createGeometryEngine();
  const buffer = buildDiscBuffer(200, 200);
  const params = {
    imageBuffer: buffer, layerId: 'L1', xMm: 0, yMm: 0, widthMm: 60, heightMm: 60,
    stoneSizeMm: 2.0, gapMm: 0.3, mode: 'fill', color: 'jet',
    threshold: 128, invert: false, blurRadiusPx: 0, maxWidthPx: 400, maxHeightPx: 400,
    transparent: 'white', maskMode: 'threshold', colorCount: 1, palette: PALETTE, colorMap: {}
  };
  const omitted = engine.generateImageLayout(params);
  const explicitFalse = engine.generateImageLayout({ ...params, fillGaps: false });
  assert.equal(omitted.stones.length, explicitFalse.stones.length);
  for (let i = 0; i < omitted.stones.length; i++) {
    assert.equal(omitted.stones[i].xMm, explicitFalse.stones[i].xMm);
    assert.equal(omitted.stones[i].yMm, explicitFalse.stones[i].yMm);
    assert.equal(omitted.stones[i].sizeMm, explicitFalse.stones[i].sizeMm);
    assert.equal(omitted.stones[i].color, explicitFalse.stones[i].color);
  }
  assert.ok(omitted.stones.length > 0, 'expected the fixture to produce stones at all');
});

// ---- Item 2: on, adds only smaller stones, strictly additive prefix ---------------------------
await test('2. On: every added stone has sizeMm === GAP_FILL_STONE_SIZE_MM (2.0) and the pre-existing (fillGaps:false) stones are an unchanged prefix of the fillGaps:true output', () => {
  const engine = createGeometryEngine();
  const buffer = buildFourQuadrantDiscBuffer(200, 200);
  const params = { ...COLOR_FIXTURE_PARAMS, imageBuffer: buffer };
  const without = engine.generateImageLayout({ ...params, fillGaps: false });
  const withGaps = engine.generateImageLayout({ ...params, fillGaps: true });

  assert.ok(withGaps.stones.length > without.stones.length, 'expected fillGaps:true to add at least one stone on this deliberately coarse-pitch fixture');
  for (let i = 0; i < without.stones.length; i++) {
    assert.equal(withGaps.stones[i].xMm, without.stones[i].xMm, `prefix stone ${i} xMm`);
    assert.equal(withGaps.stones[i].yMm, without.stones[i].yMm, `prefix stone ${i} yMm`);
    assert.equal(withGaps.stones[i].sizeMm, without.stones[i].sizeMm, `prefix stone ${i} sizeMm`);
    assert.equal(withGaps.stones[i].color, without.stones[i].color, `prefix stone ${i} color`);
  }
  const added = withGaps.stones.slice(without.stones.length);
  assert.ok(added.length > 0);
  for (const stone of added) {
    assert.equal(stone.sizeMm, GAP_FILL_STONE_SIZE_MM);
  }
});

// ---- Items 3/4/11: hand-constructed known-gap fixture, direct GapFill.js unit tests -----------
// Three primary stones (sizeMm 2.8) in a row, 3.6mm pitch (past their own 3.1mm touching
// threshold), gapMm 0.3, filler 2.0mm. A tight placement rectangle bounds the cascade: only the
// row's own two adjacent gaps and the two second-round pockets they open (against the outer
// stones) fit inside it -- deterministically 4 filler stones, verified below by direct execution
// (not hand arithmetic) against a fixture chosen for a small, bounded, reachable gap structure.
function buildKnownGapFixture() {
  const gapMm = 0.3;
  const stoneSizeMm = 2.8;
  const D = 3.6;
  const baseStones = [
    { xMm: 0, yMm: 0, sizeMm: stoneSizeMm },
    { xMm: D, yMm: 0, sizeMm: stoneSizeMm },
    { xMm: 2 * D, yMm: 0, sizeMm: stoneSizeMm }
  ];
  const placement = { xMm: -2, yMm: -2, widthMm: 2 * D + 4, heightMm: 6 };
  const isInside = (xMm, yMm) => yMm >= 0;
  const colorAt = () => 'jet';
  return { baseStones, gapMm, isInside, placement, colorAt };
}

await test('3. Known gap count: the hand-constructed 3-stone-row fixture adds exactly 4 filler stones -- not "at least 4" or "roughly 4"', () => {
  const fixture = buildKnownGapFixture();
  const stones = generateGapFillStones({ ...fixture, layerId: 'L', startIndex: fixture.baseStones.length });
  assert.equal(stones.length, 4);
  for (const s of stones) assert.equal(s.sizeMm, GAP_FILL_STONE_SIZE_MM);
});

await test('4. No overlap, pairwise: every filler stone, checked against every other filler and every pre-existing stone, satisfies distance >= (sizeA+sizeB)/2 + gapMm', () => {
  const fixture = buildKnownGapFixture();
  const stones = generateGapFillStones({ ...fixture, layerId: 'L', startIndex: fixture.baseStones.length });
  assert.ok(stones.length > 0, 'expected the fixture to actually place filler stones (a non-vacuous check)');
  const all = [...fixture.baseStones, ...stones.map((s) => ({ xMm: s.xMm, yMm: s.yMm, sizeMm: s.sizeMm }))];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i], b = all[j];
      const dx = a.xMm - b.xMm, dy = a.yMm - b.yMm;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const minSep = (a.sizeMm + b.sizeMm) / 2 + fixture.gapMm;
      assert.ok(dist >= minSep - 1e-9, `pair (${i},${j}): distance ${dist} below minimum separation ${minSep}`);
    }
  }
});

await test('11. Repeat-until-no-candidate-fits terminates and is idempotent: running the pass again against its own first-pass output adds zero further stones', () => {
  const fixture = buildKnownGapFixture();
  const firstPass = generateGapFillStones({ ...fixture, layerId: 'L', startIndex: fixture.baseStones.length });
  assert.ok(firstPass.length > 0);
  const combinedBase = [...fixture.baseStones, ...firstPass.map((s) => ({ xMm: s.xMm, yMm: s.yMm, sizeMm: s.sizeMm }))];
  const secondPass = generateGapFillStones({ ...fixture, baseStones: combinedBase, layerId: 'L', startIndex: combinedBase.length });
  assert.equal(secondPass.length, 0, 'expected the pass to be a true fixed point, not merely out of rounds');
});

// ---- Item 5: no centre outside the mask --------------------------------------------------------
await test('5. No centre outside the mask: a mask notch carved exactly around one known candidate removes exactly that candidate from the output; every accepted stone (baseline or notched) independently satisfies isInside()', () => {
  const fixture = buildKnownGapFixture();
  const baseline = generateGapFillStones({ ...fixture, layerId: 'L', startIndex: fixture.baseStones.length });
  for (const s of baseline) assert.ok(fixture.isInside(s.xMm, s.yMm), `baseline stone (${s.xMm},${s.yMm}) fails isInside()`);
  assert.ok(baseline.some((s) => Math.hypot(s.xMm - 1.8, s.yMm - 2.012463) < 0.01), 'expected the baseline to include the known candidate at (1.8, ~2.0125)');

  const notchIsInside = (xMm, yMm) => {
    if (yMm < 0) return false;
    return Math.hypot(xMm - 1.8, yMm - 2.012463) >= 0.5;
  };
  const notched = generateGapFillStones({ ...fixture, isInside: notchIsInside, layerId: 'L', startIndex: fixture.baseStones.length });
  for (const s of notched) assert.ok(notchIsInside(s.xMm, s.yMm), `notched stone (${s.xMm},${s.yMm}) fails its own isInside()`);
  assert.ok(!notched.some((s) => Math.hypot(s.xMm - 1.8, s.yMm - 2.012463) < 0.5), 'expected the notched-out candidate to be absent from the notched output');
});

// ---- Item 6: whole stone inside the placement rectangle -----------------------------------------
await test('6. Whole stone inside the placement rectangle: a rect whose top edge falls exactly fillerRadius short of a known candidate rejects it; extending the rect by the missing margin accepts it', () => {
  const gapMm = 0.3, stoneSizeMm = 2.8, D = 3.6;
  const baseStones = [
    { xMm: 0, yMm: 0, sizeMm: stoneSizeMm },
    { xMm: D, yMm: 0, sizeMm: stoneSizeMm }
  ];
  const isInside = () => true;
  const colorAt = () => 'jet';

  // Candidate is at (1.8, ~2.0125); rect top at y=3.0 leaves the candidate's own footprint
  // (needs up to y=3.0125) just short of the edge -- rejected.
  const tooTight = { xMm: 0, yMm: -1, widthMm: D + 2.8, heightMm: 4 };
  const rejected = generateGapFillStones({ baseStones, gapMm, isInside, placement: tooTight, colorAt, layerId: 'L', startIndex: 2 });
  assert.equal(rejected.length, 0, 'expected the rect to reject a filler whose footprint would poke past the top edge');

  // The same rect, 0.1mm taller, clears the candidate's exact required margin -- accepted.
  const justEnough = { xMm: 0, yMm: -1, widthMm: D + 2.8, heightMm: 4.1 };
  const accepted = generateGapFillStones({ baseStones, gapMm, isInside, placement: justEnough, colorAt, layerId: 'L', startIndex: 2 });
  assert.equal(accepted.length, 1, 'expected exactly the one candidate to now fit');
  const s = accepted[0];
  assert.ok(s.yMm + GAP_FILL_STONE_SIZE_MM / 2 <= justEnough.yMm + justEnough.heightMm + 1e-9, 'accepted stone footprint must stay inside the rect');
});

// ---- Items 7/8/9: filler colour (decision 5) ----------------------------------------------------
await test('7. Filler colour, multi-colour: every added stone\'s colour equals imageRegionColorId()\'s rule (cluster at that pixel -> catalog nearestId), independently reconstructed via prepareImageField()/fieldLabelAt() against the real field, no colorMap override', () => {
  const engine = createGeometryEngine();
  const buffer = buildFourQuadrantDiscBuffer(200, 200);
  const params = { ...COLOR_FIXTURE_PARAMS, imageBuffer: buffer };
  const without = engine.generateImageLayout({ ...params, fillGaps: false });
  const withGaps = engine.generateImageLayout({ ...params, fillGaps: true });
  const added = withGaps.stones.slice(without.stones.length);
  assert.ok(added.length > 0, 'expected this fixture to actually add filler stones');

  const field = prepareImageField(buffer, {
    threshold: params.threshold, invert: params.invert, blurRadiusPx: params.blurRadiusPx,
    edgeBandFraction: 6 / params.widthMm, maxWidthPx: params.maxWidthPx, maxHeightPx: params.maxHeightPx,
    transparent: params.transparent, colorCount: params.colorCount, palette: params.palette, maskMode: params.maskMode
  });
  const placement = { xMm: params.xMm, yMm: params.yMm, widthMm: params.widthMm, heightMm: params.heightMm };
  let checkedAtLeastOneLabeled = false;
  for (const stone of added) {
    const label = fieldLabelAt(field, placement, stone.xMm, stone.yMm);
    assert.notEqual(label, 255, `expected added stone (${stone.xMm},${stone.yMm}) to resolve to a real cluster label, not NO_LABEL`);
    const group = field.colorGroups[label];
    const expectedColor = group.nearestId; // no colorMap override in this fixture
    assert.equal(stone.color, expectedColor, `added stone (${stone.xMm},${stone.yMm}) colour mismatch`);
    checkedAtLeastOneLabeled = true;
  }
  assert.ok(checkedAtLeastOneLabeled);
  assert.ok(new Set(added.map((s) => s.color)).size > 1, 'expected the added stones to span more than one colour on this multi-quadrant fixture');
});

await test('8. Filler colour, colorMap override: added stones whose cluster is overridden carry the overridden id, not the catalog default', () => {
  const engine = createGeometryEngine();
  const buffer = buildFourQuadrantDiscBuffer(200, 200);
  const baseParams = { ...COLOR_FIXTURE_PARAMS, imageBuffer: buffer };
  const without = engine.generateImageLayout({ ...baseParams, fillGaps: false });
  const withGapsNoOverride = engine.generateImageLayout({ ...baseParams, fillGaps: true });
  const addedNoOverride = withGapsNoOverride.stones.slice(without.stones.length);
  assert.ok(addedNoOverride.length > 0);

  const overriddenClusterId = addedNoOverride[0].color;
  const otherAddedColors = new Set(addedNoOverride.filter((s) => s.color !== overriddenClusterId).map((s) => s.color));
  assert.ok(otherAddedColors.size > 0, 'expected the fixture to add stones from more than one cluster, so the override is distinguishable from the rest');

  const overrideParams = { ...baseParams, colorMap: { [overriddenClusterId]: 'jet' } };
  const withOverride = engine.generateImageLayout({ ...overrideParams, fillGaps: true });
  const addedWithOverride = withOverride.stones.slice(without.stones.length);
  assert.equal(addedWithOverride.length, addedNoOverride.length, 'colorMap must not change which stones are placed, only their colour');

  for (let i = 0; i < addedNoOverride.length; i++) {
    const before = addedNoOverride[i];
    const after = addedWithOverride[i];
    assert.equal(after.xMm, before.xMm);
    assert.equal(after.yMm, before.yMm);
    if (before.color === overriddenClusterId) {
      assert.equal(after.color, 'jet', 'expected the overridden cluster\'s filler stones to carry the override colour');
    } else {
      assert.equal(after.color, before.color, 'expected non-overridden clusters to keep their catalog colour');
    }
  }
  assert.ok(addedWithOverride.some((s) => s.color === 'jet'), 'expected at least one filler stone to carry the override colour');
});

await test('9. Filler colour, single-colour layer: colorCount<=1 -- every added stone\'s colour equals the layer\'s own options.color, exactly like every primary stone', () => {
  const engine = createGeometryEngine();
  const buffer = buildFourQuadrantDiscBuffer(200, 200);
  const params = { ...COLOR_FIXTURE_PARAMS, imageBuffer: buffer, colorCount: 1 };
  const without = engine.generateImageLayout({ ...params, fillGaps: false });
  const withGaps = engine.generateImageLayout({ ...params, fillGaps: true });
  const added = withGaps.stones.slice(without.stones.length);
  assert.ok(added.length > 0);
  for (const stone of added) assert.equal(stone.color, 'jet');
  assert.ok(without.stones.every((s) => s.color === 'jet'), 'sanity: primary stones are also all the layer colour in this mode');
});

// ---- Item 10: other layers ignored (decision 6) --------------------------------------------------
await test('10. Other layers ignored: generateImageLayout() for one layerId produces byte-identical gap-fill output whether or not a spatially-overlapping second image layer was generated first -- each call only ever sees its own layer\'s stones', () => {
  const engine = createGeometryEngine();
  const bufferA = buildDiscBuffer(200, 200);
  const bufferB = buildFourQuadrantDiscBuffer(200, 200);
  const paramsA = {
    imageBuffer: bufferA, layerId: 'layerA', xMm: 0, yMm: 0, widthMm: 60, heightMm: 60,
    stoneSizeMm: 2.8, gapMm: 0.3, mode: 'fill', color: 'jet',
    threshold: 128, invert: false, blurRadiusPx: 0, maxWidthPx: 400, maxHeightPx: 400,
    transparent: 'white', maskMode: 'threshold', colorCount: 1, palette: PALETTE, colorMap: {}, fillGaps: true
  };
  const paramsB = { ...COLOR_FIXTURE_PARAMS, imageBuffer: bufferB, layerId: 'layerB', fillGaps: true };

  const aAlone = engine.generateImageLayout(paramsA);
  // Generate B (overlapping the same xMm/yMm/widthMm/heightMm region as A) first, then A again --
  // a naive cross-layer implementation pooling stones would change A's result; the real per-layer
  // API surface (generateImageLayout() takes no "other layers" argument) cannot.
  engine.generateImageLayout(paramsB);
  const aAfterB = engine.generateImageLayout(paramsA);

  assert.equal(aAfterB.stones.length, aAlone.stones.length);
  for (let i = 0; i < aAlone.stones.length; i++) {
    assert.equal(aAfterB.stones[i].xMm, aAlone.stones[i].xMm);
    assert.equal(aAfterB.stones[i].yMm, aAlone.stones[i].yMm);
    assert.equal(aAfterB.stones[i].sizeMm, aAlone.stones[i].sizeMm);
    assert.equal(aAfterB.stones[i].color, aAlone.stones[i].color);
  }
});

// ---- Item 12: engine-level forwarding through app.js's real generateImageStonesLive() -----------
// The IMG-009 lesson (see tools/test-img-009-subject-mask.mjs item 9): a source-text/grep guard
// alone is not sufficient. Extracts the real method body (not a hand-copy) and executes it via
// new Function() against a real engine and stubbed caches/helpers, for a layer with fillGaps true
// vs. one without -- the true case must be a strict superset of the false case.
function extractGenerateImageStonesLiveSource(appJs) {
  const startMarker = "async generateImageStonesLive(layer,{includeStats=false}={}){";
  const start = appJs.indexOf(startMarker);
  assert.ok(start !== -1, 'expected to find generateImageStonesLive() in app.js');
  const braceStart = start + startMarker.length - 1;
  let depth = 0;
  for (let i = braceStart; i < appJs.length; i++) {
    if (appJs[i] === '{') depth++;
    else if (appJs[i] === '}') { depth--; if (depth === 0) return appJs.slice(start, i + 1); }
  }
  throw new Error('expected to find the matching closing "}" of generateImageStonesLive() in app.js');
}

function buildGenerateImageStonesLive(source, deps) {
  const rewritten = source.replace('async generateImageStonesLive(', 'async function generateImageStonesLive(');
  // eslint-disable-next-line no-new-func
  const fn = new Function(
    'imageBufferCache', 'decodeDataUrlToBuffer', 'resolveImageFillMode', 'resolveImageTransparentMode',
    'resolveImageMaskMode', 'resolveImageColorCount', 'imageColorPalette', 'resolveImageSeed',
    'resolveImageSpread', 'resolveImageEdgeWidth', 'resolveImageEdgeThinning', 'resolveImageBrightnessThinning',
    'mixedSizeParamsFor',
    `return ${rewritten};`
  )(
    deps.imageBufferCache, deps.decodeDataUrlToBuffer, deps.resolveImageFillMode, deps.resolveImageTransparentMode,
    deps.resolveImageMaskMode, deps.resolveImageColorCount, deps.imageColorPalette, deps.resolveImageSeed,
    deps.resolveImageSpread, deps.resolveImageEdgeWidth, deps.resolveImageEdgeThinning, deps.resolveImageBrightnessThinning,
    deps.mixedSizeParamsFor
  );
  return fn;
}

await test('12. Engine-level forwarding: the real (extracted, not hand-copied) generateImageStonesLive() source forwards fillGaps into engine.generateImageLayout(), and the fillGaps:true layer\'s stones are a strict superset of the fillGaps:false layer\'s', async () => {
  const appJs = await readFile(fileURLToPath(new URL('../app.js', import.meta.url)), 'utf8');
  const source = extractGenerateImageStonesLiveSource(appJs);

  const buffer = buildFourQuadrantDiscBuffer(200, 200);
  const engine = createGeometryEngine();
  const generateImageStonesLive = buildGenerateImageStonesLive(source, {
    imageBufferCache: new Map([['img1', buffer]]),
    decodeDataUrlToBuffer: async () => { throw new Error('unexpected decode: buffer should already be cached'); },
    resolveImageFillMode: () => 'fill',
    resolveImageTransparentMode: (v) => v ?? 'white',
    resolveImageMaskMode: (v) => (v === 'subject' ? 'subject' : 'threshold'),
    resolveImageColorCount: (layer) => layer.colorCount ?? 1,
    imageColorPalette: () => PALETTE,
    resolveImageSeed: (v) => v ?? 1,
    resolveImageSpread: (v) => v ?? 1,
    resolveImageEdgeWidth: (v) => v ?? 6,
    resolveImageEdgeThinning: (v) => v ?? 1,
    resolveImageBrightnessThinning: (v) => v ?? 0,
    mixedSizeParamsFor: () => ({})
  });

  const baseLayer = {
    id: 'L1', imageSrc: 'img1', x: 0, y: 0, w: 60, h: 60,
    stoneSize: 2.8, gap: 0.3, fillMode: 'fill', color: 'jet',
    threshold: 128, invert: false, blurRadiusPx: 0, maxWidthPx: 400, maxHeightPx: 400,
    transparent: 'white', maskMode: 'threshold', colorCount: 4, colorMap: {},
    seed: 1, spread: 1, edgeWidthMm: 6, edgeThinning: 1, brightnessThinning: 0
  };

  const withoutStones = await generateImageStonesLive.call({ permanentEngine: engine }, { ...baseLayer, fillGaps: false });
  const withStones = await generateImageStonesLive.call({ permanentEngine: engine }, { ...baseLayer, fillGaps: true });

  assert.ok(withStones.length > withoutStones.length, 'expected fillGaps:true to produce strictly more stones than fillGaps:false');
  for (let i = 0; i < withoutStones.length; i++) {
    assert.equal(withStones[i].x, withoutStones[i].x, `prefix stone ${i} x`);
    assert.equal(withStones[i].y, withoutStones[i].y, `prefix stone ${i} y`);
    assert.equal(withStones[i].d, withoutStones[i].d, `prefix stone ${i} d`);
    assert.equal(withStones[i].color, withoutStones[i].color, `prefix stone ${i} color`);
  }
  for (const stone of withStones.slice(withoutStones.length)) {
    assert.equal(stone.d, GAP_FILL_STONE_SIZE_MM);
  }

  // Companion source-text guard, on top of (not instead of) the behavioural test above.
  assert.ok(source.includes('fillGaps:Boolean(layer.fillGaps)'), 'expected generateImageStonesLive() to forward fillGaps:Boolean(layer.fillGaps) into engine params');
});

// ---- Item 13: byte identity vs. the pristine-tip STEP 0 baseline (commit d1cfca0) ----------------
// Literals captured at pristine tip via createGeometryEngine().generateImageLayout(params) -- the
// real production path -- for two fixtures (single-colour/threshold, colorCount-4/subject) across
// 'fill'/'staggered'/'organic', with fillGaps not present in params at all (matching every layer
// saved before this milestone). See the milestone's own STEP 0 capture.
const STEP0_BASELINE = {
  'disc-single-colour-threshold': {
    fill: { stoneCount: 457, first3: [[24.150000000000006, 3.4499999999999997, 2, 'jet'], [26.450000000000006, 3.4499999999999997, 2, 'jet'], [28.750000000000007, 3.4499999999999997, 2, 'jet']], last3: [[33.35000000000001, 56.34999999999998, 2, 'jet'], [35.650000000000006, 56.34999999999998, 2, 'jet'], [37.95, 56.34999999999998, 2, 'jet']] },
    staggered: { stoneCount: 526, first3: [[25.300000000000004, 3.1418584287042086, 2, 'jet'], [27.600000000000005, 3.1418584287042086, 2, 'jet'], [29.900000000000006, 3.1418584287042086, 2, 'jet']], last3: [[31.050000000000008, 56.92203600371781, 2, 'jet'], [33.35000000000001, 56.92203600371781, 2, 'jet'], [35.650000000000006, 56.92203600371781, 2, 'jet']] },
    organic: { stoneCount: 310, first3: [[24.622960516993565, 3.1769723019558564, 2, 'jet'], [26.613359412070963, 5.744501568515615, 2, 'jet'], [30.678776877075798, 7.41698182486747, 2, 'jet']], last3: [[43.86405138076221, 38.562713116436285, 2, 'jet'], [50.20622608043773, 42.43353715513589, 2, 'jet'], [52.771610998307004, 45.79479440750727, 2, 'jet']] }
  },
  'four-quadrant-colorCount4-subject': {
    fill: { stoneCount: 256, first3: [[12.650000000000002, 12.650000000000002, 2, 'siam'], [14.950000000000003, 12.650000000000002, 2, 'siam'], [17.250000000000004, 12.650000000000002, 2, 'siam']], last3: [[42.55, 47.14999999999999, 2, 'gold'], [44.849999999999994, 47.14999999999999, 2, 'gold'], [47.14999999999999, 47.14999999999999, 2, 'gold']] },
    staggered: { stoneCount: 279, first3: [[12.650000000000002, 13.101150572225253, 2, 'siam'], [14.950000000000003, 13.101150572225253, 2, 'siam'], [17.250000000000004, 13.101150572225253, 2, 'siam']], last3: [[41.39999999999999, 46.96274386019678, 2, 'gold'], [43.69999999999999, 46.96274386019678, 2, 'gold'], [45.999999999999986, 46.96274386019678, 2, 'gold']] },
    organic: { stoneCount: 167, first3: [[12.101530276860286, 12.11273134658361, 2, 'siam'], [14.878312411707473, 12.936858720332044, 2, 'siam'], [12.465634449726032, 16.282909075273086, 2, 'siam']], last3: [[47.90931128870325, 45.36976833124874, 2, 'gold'], [16.428125924919488, 47.854840667657484, 2, 'emerald'], [30.024318558893576, 47.918022620196346, 2, 'gold']] }
  }
};

await test('13. Byte identity: STEP 0 literals (disc/single-colour/threshold and four-quadrant/colorCount4/subject, fill/staggered/organic, fillGaps absent) reproduce exactly on this tip', () => {
  const engine = createGeometryEngine();
  const fixtures = {
    'disc-single-colour-threshold': {
      buffer: buildDiscBuffer(200, 200),
      params: {
        layerId: 'step0-disc', xMm: 0, yMm: 0, widthMm: 60, heightMm: 60,
        stoneSizeMm: 2.0, gapMm: 0.3, color: 'jet',
        threshold: 128, invert: false, blurRadiusPx: 0, maxWidthPx: 400, maxHeightPx: 400,
        transparent: 'white', maskMode: 'threshold', colorCount: 1, palette: PALETTE, colorMap: {}
      }
    },
    'four-quadrant-colorCount4-subject': {
      buffer: buildFourQuadrantImageBuffer(200, 200),
      params: {
        layerId: 'step0-quad', xMm: 0, yMm: 0, widthMm: 60, heightMm: 60,
        stoneSizeMm: 2.0, gapMm: 0.3, color: 'jet',
        threshold: 128, invert: false, blurRadiusPx: 0, maxWidthPx: 400, maxHeightPx: 400,
        transparent: 'white', maskMode: 'subject', colorCount: 4, palette: PALETTE, colorMap: {}
      }
    }
  };

  for (const [fixtureName, baseline] of Object.entries(STEP0_BASELINE)) {
    const { buffer, params } = fixtures[fixtureName];
    for (const mode of ['fill', 'staggered', 'organic']) {
      const layout = engine.generateImageLayout({ ...params, imageBuffer: buffer, mode });
      const golden = baseline[mode];
      assert.equal(layout.stones.length, golden.stoneCount, `${fixtureName}/${mode}: stone count`);
      const pick = (s) => [s.xMm, s.yMm, s.sizeMm, s.color];
      assert.deepEqual(layout.stones.slice(0, 3).map(pick), golden.first3, `${fixtureName}/${mode}: first 3 stones`);
      assert.deepEqual(layout.stones.slice(-3).map(pick), golden.last3, `${fixtureName}/${mode}: last 3 stones`);
    }
  }
});

// ---- Item 14: importImageFile factory literal ----------------------------------------------------
function extractImportImageFileHandler(appJs) {
  const match = appJs.match(/el\('importImageFile'\)\.addEventListener\('change',async e=>\{[\s\S]*?\n\}\);/);
  assert.ok(match, "expected to find el('importImageFile').addEventListener('change',...) in app.js");
  return match[0];
}

await test("14. The importImageFile new-layer factory literal contains fillGaps:true, so every newly imported image layer is gap-filled automatically", async () => {
  const appJs = await readFile(fileURLToPath(new URL('../app.js', import.meta.url)), 'utf8');
  const handler = extractImportImageFileHandler(appJs);
  assert.match(handler, /fillGaps:true/, 'expected the new image layer literal to default fillGaps to true');
});

// ---- Item 15: timing -------------------------------------------------------------------------------
await test('15. Timing: the gap-fill pass alone, isolated from field prep/primary sampling, completes in under 100ms at ~2,500 base stones', () => {
  const engine = createGeometryEngine();
  const buffer = buildDiscBuffer(500, 500);
  const widthMm = 180;
  const stoneSizeMm = 2.8, gapMm = 0.3;
  const baseParams = {
    imageBuffer: buffer, layerId: 'perf', xMm: 0, yMm: 0, widthMm, heightMm: widthMm,
    stoneSizeMm, gapMm, mode: 'fill', color: 'jet',
    threshold: 128, invert: false, blurRadiusPx: 0, maxWidthPx: 500, maxHeightPx: 500,
    transparent: 'white', maskMode: 'threshold', colorCount: 1, palette: PALETTE, colorMap: {}
  };
  const layout = engine.generateImageLayout(baseParams);
  console.log(`   [item 15] base stone count at widthMm=${widthMm}: ${layout.stones.length}`);
  assert.ok(layout.stones.length >= 2000, `expected the fixture to land near 2,500 base stones, got ${layout.stones.length}`);

  const field = prepareImageField(buffer, {
    threshold: baseParams.threshold, invert: baseParams.invert, blurRadiusPx: baseParams.blurRadiusPx,
    edgeBandFraction: 6 / widthMm, maxWidthPx: baseParams.maxWidthPx, maxHeightPx: baseParams.maxHeightPx,
    transparent: baseParams.transparent, colorCount: baseParams.colorCount, palette: baseParams.palette, maskMode: baseParams.maskMode
  });
  const placement = { xMm: 0, yMm: 0, widthMm, heightMm: widthMm };
  const isInside = (xMm, yMm) => fieldPixelOn(field, xMm - placement.xMm, yMm - placement.yMm, placement.widthMm, placement.heightMm);
  const colorAt = () => 'jet';

  const t0 = performance.now();
  const gapStones = generateGapFillStones({
    baseStones: layout.stones, gapMm, isInside, placement, colorAt, layerId: 'perf', startIndex: layout.stones.length
  });
  const elapsedMs = performance.now() - t0;
  console.log(`   [item 15] gap-fill pass time at ${layout.stones.length} base stones: ${elapsedMs.toFixed(2)}ms (added ${gapStones.length})`);
  assert.ok(elapsedMs < 100, `gap-fill pass took ${elapsedMs.toFixed(2)}ms at ${layout.stones.length} base stones, exceeding the 100ms budget`);
});

console.log('IMG-013 fill empty slots tests passed.');
