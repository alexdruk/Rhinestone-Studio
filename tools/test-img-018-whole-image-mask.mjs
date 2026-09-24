import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createImageBuffer, prepareImageField } from '../src/image/index.js';
import { prepareAutoColorField, chooseAutoColorCount } from '../src/image/AutoColourCount.js';
import { createGeometryEngine } from '../src/geometry/index.js';
import { STONE_COLORS } from '../src/renderer/StoneColors.js';

// IMG-018 -- whole-image mask. maskMode 'whole' makes every pixel subject, except where the
// transparent policy removes it (decision 2); Line Design masks by alpha only (decision 3); every
// read site resolves 'whole', and anything unknown or missing still reads as 'threshold' (decision 6).
// See docs/specifications/IMG-018-WholeImageMask.md.
//
// W1 pins the prepareImageField() mask, W2 the Staggered engine output, W3 Line Design, W4
// resolveImagePolygons(), W5 the permissive read sites and W6 the app.js/index.html source guards.
// Mutation-tested: Line Design not forwarded maskMode (W3), normalizeParams() collapsing 'whole'
// (W2), invert applied in 'whole' mode (W1, W2), normalizeImageParams() collapsing 'whole' (W4), the
// Line Design whole mask ignoring alpha (W3).

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

const PALETTE = Object.values(STONE_COLORS).map((c) => ({ id: c.id, hex: c.previewColor }));
const appJs = await readFile(fileURLToPath(new URL('../app.js', import.meta.url)), 'utf8');
const indexHtml = await readFile(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');

function blocksFixture() {
  const widthPx = 300, heightPx = 300;
  const data = new Uint8ClampedArray(widthPx * heightPx * 4);
  for (let y = 0; y < heightPx; y++) {
    for (let x = 0; x < widthPx; x++) {
      const o = (y * widthPx + x) * 4;
      const inDisc = (x - 150) * (x - 150) + (y - 150) * (y - 150) <= 60 * 60;
      const rgb = inDisc ? [250, 210, 40] : x >= 180 ? [30, 60, 180] : [200, 30, 40];
      data[o] = rgb[0]; data[o + 1] = rgb[1]; data[o + 2] = rgb[2]; data[o + 3] = 255;
    }
  }
  return { widthPx, heightPx, data };
}

function marginFixture() {
  const fixture = blocksFixture();
  const { widthPx, heightPx, data } = fixture;
  for (let y = 0; y < heightPx; y++) {
    for (let x = 0; x < widthPx; x++) {
      if (x < 20 || y < 20 || x >= 280 || y >= 280) {
        const o = (y * widthPx + x) * 4;
        data[o] = 0; data[o + 1] = 0; data[o + 2] = 0; data[o + 3] = 0;
      }
    }
  }
  return fixture;
}

const blocks = createImageBuffer(blocksFixture());
const margin = createImageBuffer(marginFixture());

const COMMON = {
  layerId: 'img018', xMm: 0, yMm: 0, widthMm: 60, heightMm: 60, stoneSizeMm: 2, gapMm: 0.3,
  palette: PALETTE, vividness: 1.4, maxWidthPx: 400, maxHeightPx: 400, transparent: 'ignore',
  threshold: 128, colorMap: {}
};
const FIELD_PARAMS = { transparent: 'ignore', threshold: 128, maxWidthPx: 400, maxHeightPx: 400, vividness: 1.4 };

const tally = (items, keyOf) => {
  const counts = {};
  for (const item of items) counts[keyOf(item)] = (counts[keyOf(item)] || 0) + 1;
  return counts;
};
const onCount = (data) => data.reduce((sum, v) => sum + (v > 0 ? 1 : 0), 0);

await test('W1. prepareImageField(): whole is all-ones, ignores invert, equals threshold 0 inverted', () => {
  const whole = prepareImageField(blocks, { ...FIELD_PARAMS, maskMode: 'whole' });
  assert.equal(onCount(whole.data), 90000);
  const wholeInverted = prepareImageField(blocks, { ...FIELD_PARAMS, maskMode: 'whole', invert: true });
  assert.deepEqual(wholeInverted, whole, 'whole with invert true is identical');
  const coloured = { ...FIELD_PARAMS, colorCount: 3, palette: PALETTE, colorMap: {} };
  const wholeColoured = prepareImageField(blocks, { ...coloured, maskMode: 'whole' });
  const thresholdZeroInverted = prepareImageField(blocks, { ...coloured, maskMode: 'threshold', threshold: 0, invert: true });
  assert.deepEqual(wholeColoured.data, thresholdZeroInverted.data, 'data matches threshold 0 inverted');
  assert.deepEqual(wholeColoured.labels, thresholdZeroInverted.labels, 'labels match threshold 0 inverted');
});

const engine = createGeometryEngine();
const autoCount = (params) => chooseAutoColorCount(prepareAutoColorField(blocks, params), PALETTE, { chromaScale: 1.4 }).resolvedCount;

await test('W2. generateImageLayout(), Staggered', () => {
  const cases = [
    [{ maskMode: 'subject' }, 2, 396, { sapphire: 296, gold: 100 }],
    [{ maskMode: 'whole' }, 3, 780, { siam: 384, sapphire: 296, gold: 100 }],
    [{ maskMode: 'whole', invert: true }, 3, 780, { siam: 384, sapphire: 296, gold: 100 }],
    [{ maskMode: 'threshold' }, 2, 680, { siam: 384, sapphire: 296 }]
  ];
  const layouts = [];
  for (const [mask, auto, count, colours] of cases) {
    const label = JSON.stringify(mask);
    const params = { ...COMMON, ...mask, imageBuffer: blocks, mode: 'staggered', fillGaps: true };
    const colorCount = autoCount(params);
    assert.equal(colorCount, auto, `Auto for ${label}`);
    const { stones } = engine.generateImageLayout({ ...params, colorCount });
    layouts.push(stones);
    assert.equal(stones.length, count, `stone count for ${label}`);
    assert.deepEqual(tally(stones, (s) => s.color), colours, `stone colours for ${label}`);
  }
  const summary = (stones) => stones.map((s) => [s.xMm, s.yMm, s.sizeMm, s.color]);
  assert.deepEqual(summary(layouts[2]), summary(layouts[1]), 'whole with invert true is identical to whole');
});

await test('W3. generateImageLayout(), Line Design', () => {
  const run = (imageBuffer, maskMode) => engine.generateImageLayout({ ...COMMON, imageBuffer, maskMode, mode: 'line-design' }).stones;
  const cases = [
    [blocks, 'blocks', 'subject', 211, { sapphire: 162, gold: 49 }],
    [blocks, 'blocks', 'whole', 399, { siam: 203, sapphire: 154, gold: 42 }],
    [margin, 'margin', 'whole', 293, { siam: 144, sapphire: 105, gold: 44 }],
    [margin, 'margin', 'subject', 293, { siam: 144, sapphire: 105, gold: 44 }]
  ];
  const layouts = {};
  for (const [imageBuffer, name, maskMode, count, colours] of cases) {
    const stones = run(imageBuffer, maskMode);
    layouts[`${name}:${maskMode}`] = stones;
    assert.equal(stones.length, count, `stone count for ${name} ${maskMode}`);
    assert.deepEqual(tally(stones, (s) => s.color), colours, `stone colours for ${name} ${maskMode}`);
  }
  const summary = (stones) => stones.map((s) => [s.xMm, s.yMm, s.sizeMm, s.color]);
  assert.deepEqual(summary(layouts['margin:subject']), summary(layouts['margin:whole']), 'margin subject is identical to margin whole');
});

await test('W4. resolveImagePolygons(), colorCount 3', () => {
  const regionIds = (maskMode) => engine.resolveImagePolygons({ ...COMMON, imageBuffer: blocks, mode: 'staggered', colorCount: 3, maskMode }).regions.map((r) => r.colorId);
  assert.deepEqual(regionIds('whole'), ['siam', 'sapphire', 'gold']);
  assert.deepEqual(regionIds('subject'), ['sapphire', 'gold']);
  assert.deepEqual(regionIds('threshold'), ['siam', 'sapphire']);
});

function sliceBraceBalanced(source, startIndex) {
  const open = source.indexOf('){', startIndex) + 1;
  assert.ok(open !== 0, 'expected a function body');
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) return source.slice(startIndex, i + 1); }
  }
  throw new Error('unbalanced braces');
}
function functionSource(marker) {
  const start = appJs.indexOf(marker);
  assert.ok(start !== -1, `expected to find ${marker} in app.js`);
  return sliceBraceBalanced(appJs, start);
}
const codeLines = (source) => source.split('\n').filter((line) => !line.trimStart().startsWith('//')).join('\n');

await test('W5. Read sites are permissive', () => {
  const threshold = prepareImageField(blocks, { ...FIELD_PARAMS, maskMode: 'threshold' });
  assert.deepEqual(prepareImageField(blocks, { ...FIELD_PARAMS, maskMode: 'bogus' }), threshold, "'bogus' equals 'threshold'");
  assert.deepEqual(prepareImageField(blocks, { ...FIELD_PARAMS }), threshold, "an omitted maskMode equals 'threshold'");

  // eslint-disable-next-line no-new-func
  const resolveImageMaskMode = new Function(`${functionSource('function resolveImageMaskMode(')}\nreturn resolveImageMaskMode;`)();
  for (const value of ['whole', 'subject', 'threshold']) assert.equal(resolveImageMaskMode(value), value, `${value} returns itself`);
  for (const value of ['bogus', undefined]) assert.equal(resolveImageMaskMode(value), 'threshold', `${String(value)} returns 'threshold'`);
});

await test('W6. Source guards', () => {
  assert.ok(indexHtml.includes('option value="whole"'), 'index.html has the whole option');
  const RESOLVED = 'resolveImageMaskMode(layer.maskMode)';
  const liveSource = codeLines(functionSource('async generateImageStonesLive('));
  const lineDesignBranch = liveSource.slice(liveSource.indexOf("if(mode==='line-design'){"));
  const lineDesignKey = /const key=\[layer\.id,[^\]]*\]\.join/.exec(lineDesignBranch);
  assert.ok(lineDesignKey && lineDesignKey[0].includes(RESOLVED), 'the Line Design cache key includes the resolved maskMode');
  const lineDesignParams = /const params=\{[^;]*\};/.exec(lineDesignBranch);
  assert.ok(lineDesignParams && lineDesignParams[0].includes(`,mode,`) && !lineDesignParams[0].includes('threshold:'), 'expected the Line Design params object first');
  assert.ok(lineDesignParams[0].includes(RESOLVED), 'the Line Design params include the resolved maskMode');
});
