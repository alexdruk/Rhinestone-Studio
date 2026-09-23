import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createImageBuffer } from '../src/image/index.js';
import { prepareAutoColorField, chooseAutoColorCount } from '../src/image/AutoColourCount.js';
import { labelCatalogColors, FIELD_ON_THRESHOLD } from '../src/image/ColorQuantize.js';
import { generateLineDesignStonePoints } from '../src/geometry/LineDesignSampler.js';
import { createGeometryEngine } from '../src/geometry/index.js';
import { STONE_COLORS } from '../src/renderer/StoneColors.js';

// IMG-017 -- vividness. layer.vividness scales each subject pixel's Lab a* and b* before catalogue
// matching (decision 1), through labelCatalogColors()' chromaScale; 1 skips the multiply. Four Studio
// steps (decision 2), a permissive engine read site and a strict app.js resolver (decision 3), and
// Line Design's ink reference pass never scaled (decision 4). See
// docs/specifications/IMG-017-Vividness.md.
//
// T1-T5 pin the spec's fixture figures at the labelling, Auto, engine, polygon and Line Design stages.
// T6 is the app.js/index.html source guard, T8 the evaluated app.js resolver. T7 is the unchanged
// IMG-015/IMG-016 test files. Mutation-tested: chromaScale ignored (T1), Auto not forwarded (T2),
// normalizeImageParams() dropping vividness and the generateImageLayout() forward deleted (T3), the
// resolveImagePolygons() forward deleted (T4), chromaScale forwarded to the ink call and not forwarded
// to the colour call (T5), Number( removed from the Studio write (T6), a resolver accepting any finite
// number (T8).

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

function vividFixture() {
  const w = 120, h = 60, data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = 4 * (y * w + x);
    let c = [245, 245, 245];
    if (y >= 10 && y < 50 && x >= 10 && x < 40) c = [185, 120, 60];
    if (y >= 10 && y < 50 && x >= 45 && x < 75) c = [128, 128, 128];
    if (y >= 10 && y < 50 && x >= 80 && x < 110) c = [110, 55, 50];
    if (y >= 28 && y < 32 && x >= 10 && x < 110) c = [70, 30, 25];
    data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
  }
  return { widthPx: w, heightPx: h, data };
}

const IMPORT_DEFAULT_MASK_PARAMS = {
  maskMode: 'subject', transparent: 'ignore', threshold: 128, invert: false, blurRadiusPx: 0, maxWidthPx: 400, maxHeightPx: 400
};
const imageBuffer = createImageBuffer(vividFixture());
const field = prepareAutoColorField(imageBuffer, IMPORT_DEFAULT_MASK_PARAMS);
const eligible = Uint8Array.from(field.data, (v) => (v >= FIELD_ON_THRESHOLD ? 1 : 0));

const tally = (items, keyOf) => {
  const counts = {};
  for (const item of items) counts[keyOf(item)] = (counts[keyOf(item)] || 0) + 1;
  return counts;
};

await test('Fixture: 120x60 px with 3640 eligible pixels', () => {
  assert.equal(field.widthPx, 120);
  assert.equal(field.heightPx, 60);
  assert.equal(eligible.reduce((sum, v) => sum + v, 0), 3640);
});

await test('T1. labelCatalogColors() scales chroma before matching', () => {
  const expected = {
    1: { samples: ['light-colorado', 'black-diamond', 'smoked-topaz', 'smoked-topaz'], kept: ['black-diamond', 'smoked-topaz', 'light-colorado'] },
    1.2: { samples: ['topaz', 'black-diamond', 'smoked-topaz', 'smoked-topaz'], kept: ['topaz', 'black-diamond', 'smoked-topaz'] },
    1.4: { samples: ['topaz', 'black-diamond', 'smoked-topaz', 'smoked-topaz'], kept: ['topaz', 'black-diamond', 'smoked-topaz'] },
    1.6: { samples: ['topaz', 'black-diamond', 'siam', 'smoked-topaz'], kept: ['siam', 'topaz', 'black-diamond', 'smoked-topaz'] }
  };
  for (const chromaScale of [1, 1.2, 1.4, 1.6]) {
    const { labels, keptIds } = labelCatalogColors({ ...field, eligible, palette: PALETTE, maxColors: 8, chromaScale });
    const at = (x, y) => PALETTE[labels[y * 120 + x]].id;
    assert.deepEqual([at(25, 20), at(60, 20), at(95, 20), at(60, 30)], expected[chromaScale].samples, `sample labels at chromaScale ${chromaScale}`);
    assert.deepEqual(keptIds.map((c) => PALETTE[c].id), expected[chromaScale].kept, `kept colours at chromaScale ${chromaScale}`);
  }
});

await test('T2. chooseAutoColorCount() counts the scaled labels', () => {
  assert.equal(chooseAutoColorCount(field, PALETTE, { chromaScale: 1 }).resolvedCount, 3);
  assert.equal(chooseAutoColorCount(field, PALETTE, { chromaScale: 1.6 }).resolvedCount, 4);
});

const engine = createGeometryEngine();
const ENGINE_PARAMS = {
  imageBuffer, layerId: 'img017', xMm: 0, yMm: 0, widthMm: 60, heightMm: 30, mode: 'staggered',
  stoneSizeMm: 2, gapMm: 0.3, colorCount: 8, fillGaps: true, palette: PALETTE, ...IMPORT_DEFAULT_MASK_PARAMS
};
const engineParams = (vividness) => (vividness === undefined ? { ...ENGINE_PARAMS } : { ...ENGINE_PARAMS, vividness });

await test('T3. generateImageLayout() honours vividness; invalid values read as 1; positions unchanged', () => {
  const natural = { 'black-diamond': 58, 'light-colorado': 59, 'smoked-topaz': 80 };
  const cases = [
    [undefined, natural], [1, natural], [0.5, natural], [3, natural], ['x', natural],
    [1.4, { 'black-diamond': 58, 'smoked-topaz': 80, topaz: 59 }],
    [1.6, { 'black-diamond': 58, siam: 59, 'smoked-topaz': 21, topaz: 59 }]
  ];
  const layouts = new Map();
  for (const [vividness, colours] of cases) {
    const { stones } = engine.generateImageLayout(engineParams(vividness));
    layouts.set(vividness, stones);
    assert.equal(stones.length, 197, `stone count at vividness ${String(vividness)}`);
    assert.deepEqual(tally(stones, (s) => s.color), colours, `stone colours at vividness ${String(vividness)}`);
  }
  const positions = (stones) => stones.map((s) => [s.xMm, s.yMm, s.sizeMm]);
  assert.deepEqual(positions(layouts.get(1.6)), positions(layouts.get(1)), 'stone positions at 1.6 match 1, in order');
});

await test('T4. resolveImagePolygons() honours vividness', () => {
  const regionIds = (vividness) => engine.resolveImagePolygons(engineParams(vividness)).regions.map((r) => r.colorId).sort();
  assert.deepEqual(regionIds(1), ['black-diamond', 'light-colorado', 'smoked-topaz']);
  assert.deepEqual(regionIds(1.6), ['black-diamond', 'siam', 'smoked-topaz', 'topaz']);
});

await test('T5. Line Design: geometry identical at every factor; only colour-pass colours move', () => {
  const run = (chromaScale) => generateLineDesignStonePoints({
    imageBuffer, placement: { xMm: 0, yMm: 0, widthMm: 60, heightMm: 30 }, gapMm: 0.3, layerId: 'img017', palette: PALETTE, chromaScale
  });
  const natural = run(1);
  const bold = run(1.6);
  assert.equal(natural.length, 138);
  assert.equal(bold.length, 138);
  const geometry = (points) => points.map((p) => [p.xMm, p.yMm, p.sizeMm, p.kind]);
  assert.deepEqual(geometry(bold), geometry(natural), 'point geometry and kind at 1.6 match 1, in order');
  const byKind = (points, kind) => tally(points.filter((p) => p.kind === kind), (p) => p.color);
  const expected = {
    1: {
      outline: { 'light-colorado': 23, 'smoked-topaz': 29, 'black-diamond': 23 },
      fill: { 'light-colorado': 4, 'black-diamond': 4, 'smoked-topaz': 4 },
      pocket: { 'light-colorado': 12, 'black-diamond': 13, 'smoked-topaz': 13 },
      line: { 'smoked-topaz': 13 }
    },
    1.6: {
      outline: { topaz: 23, 'smoked-topaz': 6, 'black-diamond': 23, siam: 23 },
      fill: { topaz: 4, 'black-diamond': 4, siam: 4 },
      pocket: { topaz: 12, 'black-diamond': 13, siam: 13 },
      line: { 'smoked-topaz': 13 }
    }
  };
  for (const [chromaScale, points] of [[1, natural], [1.6, bold]]) {
    for (const kind of ['outline', 'fill', 'pocket', 'line']) {
      assert.deepEqual(byKind(points, kind), expected[chromaScale][kind], `${kind} colours at chromaScale ${chromaScale}`);
    }
  }
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
const RESOLVED = 'resolveImageVividness(layer.vividness)';

await test('T6. app.js and index.html source guards', () => {
  assert.ok(codeLines(functionSource('function autoColorCountKeyParts(')).includes(RESOLVED), 'autoColorCountKeyParts() keys on the resolved vividness');

  const colorFieldSource = codeLines(functionSource('function computeImageColorField('));
  assert.ok(colorFieldSource.includes(`const vividness=${RESOLVED};`), 'computeImageColorField() resolves vividness');
  assert.match(colorFieldSource, /const key=\[[^\]]*\bvividness\b[^\]]*\]\.join/, 'the computeImageColorField() cache key includes vividness');
  assert.match(colorFieldSource, /prepareImageField\(buffer,\{[^}]*\bvividness\b[^}]*\}\)/, 'the computeImageColorField() prepareImageField() call passes vividness');

  const liveSource = codeLines(functionSource('async generateImageStonesLive('));
  const lineDesignKey = /const key=\[layer\.id,[^\]]*\]\.join/.exec(liveSource);
  assert.ok(lineDesignKey && lineDesignKey[0].includes(RESOLVED), 'the Line Design cache key includes the resolved vividness');
  const liveParams = [...liveSource.matchAll(/const params=\{[^;]*\};/g)].map((m) => m[0]);
  assert.equal(liveParams.length, 2, 'expected the Line Design and live params objects');
  for (const params of liveParams) assert.ok(params.includes(`vividness:${RESOLVED}`), `params pass vividness: ${params.slice(0, 80)}`);

  const exportSource = codeLines(functionSource('function resolveImageExportRegions('));
  assert.ok(exportSource.includes(`vividness:${RESOLVED}`), 'resolveImageExportRegions() params pass vividness');

  const factory = /const layer=\{id:'image'\+Date\.now\(\),type:'image',[^;]*\};/.exec(appJs);
  assert.ok(factory && factory[0].includes(',vividness:1.4,'), 'the import factory sets vividness:1.4');

  const history = /const HISTORY_TRACKED_CONTROL_IDS=\[([^\]]*)\];/.exec(appJs);
  assert.ok(history && history[1].split(',').includes("'imgVividness'"), 'HISTORY_TRACKED_CONTROL_IDS includes imgVividness');

  assert.ok(codeLines(functionSource('function syncSelectedControlsFromLayer(')).includes("el('imgVividness').value=resolveImageVividness(l.vividness)"), 'the Studio read sets imgVividness from resolveImageVividness(l.vividness)');
  assert.ok(codeLines(functionSource('function writeSelectedControlsToLayer(')).includes("l.vividness=resolveImageVividness(Number(el('imgVividness').value));"), 'the Studio write statement is present verbatim');

  const resolverSource = codeLines(functionSource('function resolveImageColorCount('));
  assert.match(resolverSource, new RegExp(`chooseAutoColorCount\\(field,imageColorPalette\\(\\),\\{chromaScale:${RESOLVED.replace(/[.()]/g, '\\$&')}\\}\\)`), 'the chooseAutoColorCount() call passes chromaScale');

  const select = /<select\b[^>]*\bid="imgVividness"[^>]*>([\s\S]*?)<\/select>/.exec(indexHtml);
  assert.ok(select, 'index.html has a imgVividness select');
  const options = [...select[1].matchAll(/<option\b[^>]*\bvalue="([^"]*)"[^>]*>([^<]*)<\/option>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(options, [['1', 'Natural'], ['1.2', 'Rich'], ['1.4', 'Vivid'], ['1.6', 'Bold']]);
  const selected = [...select[1].matchAll(/<option\b([^>]*)>([^<]*)<\/option>/g)].filter((m) => /\bselected\b/.test(m[1])).map((m) => m[2]);
  assert.deepEqual(selected, ['Vivid'], 'only the Vivid option carries selected');
});

await test('T8. resolveImageVividness() accepts exactly the four steps', () => {
  const stepsLine = /const IMAGE_VIVIDNESS_STEPS=[^;]*;/.exec(appJs);
  assert.ok(stepsLine, 'expected IMAGE_VIVIDNESS_STEPS in app.js');
  const resolverSource = functionSource('function resolveImageVividness(');
  // eslint-disable-next-line no-new-func
  const resolveImageVividness = new Function(`${stepsLine[0]}\n${resolverSource}\nreturn resolveImageVividness;`)();
  for (const value of [1, 1.2, 1.4, 1.6]) assert.equal(resolveImageVividness(value), value, `${value} returns itself`);
  for (const value of [1.3, 2, 0.5, 0, NaN, undefined, null, '1.4', 'x']) {
    assert.equal(resolveImageVividness(value), 1, `${String(value)} returns 1`);
  }
});
