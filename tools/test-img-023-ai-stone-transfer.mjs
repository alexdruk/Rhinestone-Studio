// IMG-023 -- AI stone transfer. Detection on a synthetic honeycomb drawn here, the greedy palette,
// the Jet rule, D2 sizing (canvas and Flat Sheet), byte identity for projects without the mode, the
// engine branch, a tolerance check against the reference prototype's pinned output on the same
// fixture, and source-level wiring. See docs/specifications/IMG-023-AiStoneTransfer.md, "Tests the
// build must add". No network, nothing read from tools/scratch/.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { STONE_COLORS } from '../src/renderer/StoneColors.js';
import { detectAiStones } from '../src/image/index.js';
import { isJetLikeLab, ellipseRowHalfWidths } from '../src/image/AiStoneDetect.js';
import { chooseAiStonePalette, placeAiStones, catalogueLabs, weightedLabDistance } from '../src/geometry/AiStoneSampler.js';
import { GeometryEngine } from '../src/geometry/index.js';
import { fitAiStoneBox, aiStoneEffectiveShrink } from '../src/redraw/index.js';
import { assertTestRegistered } from './lib/test-registration-assertions.mjs';

let failures = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    failures++;
    console.error(`✗ ${name}`);
    console.error(error);
  }
}

const appJs = await readFile(fileURLToPath(new URL('../app.js', import.meta.url)), 'utf8');
const indexHtml = await readFile(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');
const PALETTE = Object.values(STONE_COLORS).map((c) => ({ id: c.id, hex: c.previewColor }));
const engine = new GeometryEngine();

// ---- the synthetic detection fixture (spec: "Synthetic detection fixture") --------------------

const P = 16, ROWH = P * Math.sqrt(3) / 2, M = 20, W = 256, H = 248, ROWS = 16, COLS = 14, DOTLESS_ROW = 7;
const DISC2 = 45, OPAQUE2 = 92, DOT2 = 2.25;
const SAPPHIRE = [0x22, 0x69, 0xd3], GOLD = [0xf3, 0xbd, 0x32], JET = [0x14, 0x14, 0x14], GAP = [8, 8, 8], WHITE = [255, 255, 255];

function fixtureStones() {
  const stones = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cx = M + c * P + (r % 2 === 1 ? P / 2 : 0);
      const cy = M + r * ROWH;
      const edge = r === 0 || r === ROWS - 1 || c === 0 || c === COLS - 1;
      stones.push({ cx, cy, rgb: edge ? JET : (c < 7 ? SAPPHIRE : GOLD), dot: !(r === DOTLESS_ROW && !edge), hx: cx - 0.30 * P / 2, hy: cy - 0.35 * P / 2 });
    }
  }
  return stones;
}

function drawFixture() {
  const stones = fixtureStones();
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let best = -1, bd = Infinity;
      for (let i = 0; i < stones.length; i++) {
        const d = (x - stones[i].cx) * (x - stones[i].cx) + (y - stones[i].cy) * (y - stones[i].cy);
        if (d < bd) { bd = d; best = i; }
      }
      if (bd > OPAQUE2) continue;
      const s = stones[best];
      let rgb = bd <= DISC2 ? s.rgb : GAP;
      if (s.dot && (x - s.hx) * (x - s.hx) + (y - s.hy) * (y - s.hy) <= DOT2) rgb = WHITE;
      const o = (y * W + x) * 4;
      data[o] = rgb[0]; data[o + 1] = rgb[1]; data[o + 2] = rgb[2]; data[o + 3] = 255;
    }
  }
  return { widthPx: W, heightPx: H, data };
}

const FIXTURE = drawFixture();
const STONES = fixtureStones();
const DETECTION = detectAiStones(FIXTURE);

// Reference output on the fixture (spec: "Reference output on the fixture"), one character per
// reference hexgrid() point: '.' not kept, J/S/G = jet/sapphire/gold.
const REFERENCE_GRID = {
  1.0: { rows: 18, cols: 16, total: 246, codes: [
    '................', '.JJJJJJJJJJJJJJ.', '.JJSSSSSJGGGGGJJ', '.JSSSSSSGGGGGGJ.', '.JJSSSSSJGGGGGJJ', '.JSSSSSSGGGGGGJ.',
    '.JJSSSSSJGGGGGJJ', '.JSSSSSSGGGGGGJ.', '.JJSSSSSJGGGGGJJ', '.JSSSSSSGGGGGGJ.', '.JJSSSSSJGGGGGJJ', '.JSSSSSSGGGGGGJ.',
    '.JJSSSSSJGGGGGJJ', '.JSSSSSSGGGGGGJ.', '.JJSSSSSJGGGGGJJ', '.JSSSSSSGGGGGGJ.', '.JJJJJJJJJJJJJJJ', '.JJJJJJJJJJJJJJ.'
  ] },
  0.8: { rows: 15, cols: 13, total: 148, codes: [
    '.............', '.JJJJJJJJJJJ.', '.JSSSSSGGGGGJ', '.JSSSSGGGGGJ.', '.JSSSSSGGGGGJ', '.JSSSSJGGGGJ.', '.JSSSSSGGGGG.',
    '.JSSSSJGGGGJ.', '.JSSSSSGGGGGJ', '.JSSSSJGGGGJ.', '.JSSSSSGGGGGJ', '.JSSSSGGGGGJ.', '.JSSSSSGGGGGJ', '.JJJJJJJJJJJ.',
    '.............'
  ] }
};
const CODE_ID = { J: 'jet', S: 'sapphire', G: 'gold' };

// ---- T1. Detection -----------------------------------------------------------------------------

await test('T1. detection on the synthetic honeycomb: 224 stones, pitch within 2% of 16, one-to-one within 1 px, the 12 dot-less discs found', () => {
  const sha = createHash('sha256').update(Buffer.from(FIXTURE.data.buffer)).digest('hex');
  assert.equal(sha, '06827c645e6d454c29843a35607f07500435986111e216879fd38bfa65b18253', 'the fixture is drawn exactly as the spec pins it');
  let opaque = 0, white = 0;
  for (let i = 0; i < W * H; i++) {
    if (FIXTURE.data[i * 4 + 3] === 255) opaque++;
    if (FIXTURE.data[i * 4] === 255 && FIXTURE.data[i * 4 + 1] === 255 && FIXTURE.data[i * 4 + 2] === 255) white++;
  }
  assert.deepEqual([opaque, white], [51014, 1442]);

  assert.equal(DETECTION.ok, true);
  assert.equal(DETECTION.dotCount, 212);
  assert.equal(DETECTION.stones.length, 224);
  assert.ok(Math.abs(DETECTION.pitchPx / 16 - 1) <= 0.02, `pitch ${DETECTION.pitchPx}`);
  const used = new Set();
  for (const [i, s] of STONES.entries()) {
    let best = -1, bd = Infinity;
    for (const [j, d] of DETECTION.stones.entries()) {
      const dist = Math.hypot(d.xPx - s.cx, d.yPx - s.cy);
      if (dist < bd) { bd = dist; best = j; }
    }
    assert.ok(bd <= 1.0, `stone ${i} (${s.cx}, ${s.cy.toFixed(2)}) nearest detection ${bd.toFixed(3)} px`);
    assert.ok(!used.has(best), `stone ${i} shares its detection`);
    used.add(best);
    if (!s.dot) assert.equal(DETECTION.stones[best].fromDot, false, `dot-less stone ${i} comes from the dot-less step`);
  }
  assert.equal(DETECTION.stones.filter((s) => !s.fromDot).length, 12);

  // Too few highlights: six white pixels on grey.
  const small = { widthPx: 60, heightPx: 20, data: new Uint8ClampedArray(60 * 20 * 4) };
  for (let i = 0; i < 60 * 20; i++) small.data.set([100, 100, 100, 255], i * 4);
  for (let k = 0; k < 6; k++) small.data.set([255, 255, 255, 255], (10 * 60 + 5 + k * 9) * 4);
  assert.deepEqual(detectAiStones(small), { ok: false, reason: 'too-few-highlights', dotCount: 6, widthPx: 60, heightPx: 20 });
});

await test('T1b. the elliptical kernels equal OpenCV\'s MORPH_ELLIPSE masks for k = 5, 7, 9', () => {
  const rows = (k) => ellipseRowHalfWidths(k).map((d) => Array.from({ length: k }, (_, x) => (Math.abs(x - Math.floor(k / 2)) <= d ? '1' : '0')).join(''));
  assert.deepEqual(rows(9), ['000010000', '011111110', '011111110', '111111111', '111111111', '111111111', '011111110', '011111110', '000010000']);
  assert.deepEqual(rows(7), ['0001000', '0111110', '1111111', '1111111', '1111111', '0111110', '0001000']);
  assert.deepEqual(rows(5), ['00100', '11111', '11111', '11111', '00100']);
});

// ---- T2. Palette -------------------------------------------------------------------------------

await test('T2. palette: a small distinct red (12 siam of 812, 1.48%) survives the 8-colour limit; a frequency pick would drop it', () => {
  const ids = PALETTE.map((p) => p.id);
  const cat = catalogueLabs(PALETTE);
  const labs = [];
  for (const id of ['crystal-clear', 'crystal', 'silver', 'gold', 'citrine', 'sapphire', 'light-sapphire', 'jet']) for (let i = 0; i < 100; i++) labs.push(cat[ids.indexOf(id)]);
  for (let i = 0; i < 12; i++) labs.push(cat[ids.indexOf('siam')]);
  const greedy = chooseAiStonePalette(labs, cat).map((k) => ids[k]);
  assert.deepEqual(greedy, ['crystal-clear', 'jet', 'siam', 'sapphire', 'light-sapphire', 'citrine', 'gold', 'silver']);

  const counts = new Array(cat.length).fill(0);
  for (const lab of labs) {
    let best = 0;
    for (let k = 1; k < cat.length; k++) if (weightedLabDistance(lab, cat[k]) < weightedLabDistance(lab, cat[best])) best = k;
    counts[best]++;
  }
  const frequency = counts.map((n, k) => [n, k]).filter(([n]) => n > 0).sort((a, b) => b[0] - a[0] || a[1] - b[1]).slice(0, 8).map(([, k]) => ids[k]);
  assert.ok(!frequency.includes('siam'), `frequency pick ${frequency}`);

  const eightSiam = labs.slice(0, 808);
  assert.ok(!chooseAiStonePalette(eightSiam, cat).map((k) => ids[k]).includes('siam'), 'with 8 siam greedy drops it too');
});

// ---- T3. Jet rule ------------------------------------------------------------------------------

function jetRuleCase(jetLikeCount) {
  const cat = catalogueLabs(PALETTE);
  const hematite = cat[PALETTE.findIndex((p) => p.id === 'hematite')];
  const sapphire = cat[PALETTE.findIndex((p) => p.id === 'sapphire')];
  const buffer = { widthPx: 30, heightPx: 30, data: new Uint8ClampedArray(30 * 30 * 4).fill(255) };
  const at = (deg) => [15 + 0.5 * Math.cos(deg * Math.PI / 180), 15 + 0.5 * Math.sin(deg * Math.PI / 180)];
  const stones = [0, 120, 240].map((deg, i) => {
    const lab = i < jetLikeCount ? hematite : sapphire;
    const [xPx, yPx] = at(deg);
    return { xPx, yPx, lab, jetLike: isJetLikeLab(lab), fromDot: true };
  });
  const detection = { ok: true, pitchPx: 1, widthPx: 30, heightPx: 30, dotCount: 3, stones };
  const ids = PALETTE.map((p) => p.id);
  const palette = chooseAiStonePalette(stones.map((s) => s.lab), cat).map((k) => ids[k]);
  const [placed] = placeAiStones({ detection, imageBuffer: buffer, placement: { xMm: 0, yMm: 0, widthMm: 30, heightMm: 30 }, stoneSizeMm: 2, gapMm: 0.3, palette: PALETTE, points: [{ xMm: 15, yMm: 15 }] });
  return { palette, color: placed.color };
}

await test('T3. Jet rule: 2 of 3 jet-like neighbours -> Jet even when the palette has no Jet; 1 of 3 -> not Jet; jet-like boundaries', () => {
  const two = jetRuleCase(2);
  assert.ok(!two.palette.includes('jet'), `palette ${two.palette}`);
  assert.equal(two.color, 'jet');
  const one = jetRuleCase(1);
  assert.notEqual(one.color, 'jet');
  assert.equal(isJetLikeLab([29.9, 14.9, 0]), true);
  assert.equal(isJetLikeLab([30, 0, 0]), false);
  assert.equal(isJetLikeLab([10, 15, 0]), false);
});

// ---- T4/T5. Scale, shrink, canvas and Flat Sheet sizing ---------------------------------------

const W0 = 1024 * 2.3 / 11.467;
const box = (canvas, extra = {}) => fitAiStoneBox({ centerXMm: canvas.width / 2, centerYMm: canvas.height / 2, widthPx: 1024, heightPx: 1024, aiPitchPx: 11.467, stoneSizeMm: 2, gapMm: 0.3, canvas, ...extra });
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

await test('T4. scale: w = widthPx x (stoneSize + gap) x shrink / aiPitchPx; resolveAiStoneShrink() accepts only 1, 0.9, 0.8', () => {
  near(box({ width: 1000, height: 1000 }).w, W0, 'shrink 1');
  assert.equal(W0.toFixed(2), '205.39', 'about 205.39 mm');
  near(box({ width: 1000, height: 1000 }, { shrink: 0.8 }).w, W0 * 0.8, 'shrink 0.8');
  const line = appJs.split('\n').find((l) => l.startsWith('function resolveAiStoneShrink(value){'));
  assert.ok(line, 'expected resolveAiStoneShrink() in app.js');
  const resolveAiStoneShrink = new Function(`${line}\nreturn resolveAiStoneShrink;`)();
  for (const [value, expected] of [[1, 1], [0.9, 0.9], [0.8, 0.8], [0.7, 1], ['0.9', 1], [undefined, 1], [NaN, 1]]) assert.equal(resolveAiStoneShrink(value), expected, String(value));
});

await test('T5. canvas and Flat Sheet sizing: fit to canvas minus 20 mm, hint below 0.8; a sheet grows to fit (to 500 mm) instead', () => {
  const eff = (b) => aiStoneEffectiveShrink({ w: b.w, h: b.h, widthPx: 1024, heightPx: 1024, aiPitchPx: 11.467, stoneSizeMm: 2, gapMm: 0.3 });
  const roomy = box({ width: 300, height: 250 });
  near(roomy.w, W0, 'fits 280 x 230');
  near(eff(roomy), 1, 'effective shrink 1');
  const mid = box({ width: 200, height: 200 });
  near(mid.w, 180, 'fitted to 180');
  assert.equal(eff(mid).toFixed(3), '0.876');
  assert.ok(eff(mid) >= 0.8 - 1e-9, 'no hint');
  const tight = box({ width: 150, height: 150 });
  near(tight.w, 130, 'fitted to 130');
  assert.equal(eff(tight).toFixed(3), '0.633');
  assert.ok(eff(tight) < 0.8 - 1e-9, 'hint');

  const sheet = box({ width: 150, height: 150 }, { sheetMaxMm: 500 });
  assert.deepEqual(sheet.canvas, { width: 226, height: 226 });
  near(sheet.w, W0, 'unshrunk on the grown sheet');
  const huge = fitAiStoneBox({ centerXMm: 75, centerYMm: 75, widthPx: 1024, heightPx: 1024, aiPitchPx: 4, stoneSizeMm: 2, gapMm: 0.3, canvas: { width: 150, height: 150 }, sheetMaxMm: 500 });
  assert.deepEqual(huge.canvas, { width: 500, height: 500 });
  near(huge.w, 480, 'fitted to 480');
  assert.ok(huge.x >= 0 && huge.y >= 0 && huge.x + huge.w <= 500 && huge.y + huge.h <= 500);

  const corner = fitAiStoneBox({ centerXMm: 10, centerYMm: 10, widthPx: 1024, heightPx: 1024, aiPitchPx: 11.467, stoneSizeMm: 2, gapMm: 0.3, canvas: { width: 300, height: 250 } });
  assert.deepEqual([corner.x, corner.y], [0, 0], 'shifted inside, not rescaled');
  near(corner.w, W0, 'kept size');
});

// ---- T6. Byte identity -------------------------------------------------------------------------

async function extractProjectFunctions() {
  const validateMatch = appJs.match(/function validateProject\(obj\)\{[\s\S]*?\n\}\n/);
  const defaultMatch = appJs.match(/function defaultProject\(\)\{[\s\S]*?\}\}\n/);
  assert.ok(validateMatch && defaultMatch);
  const constantsStart = appJs.indexOf('const DEFAULT_TEXT_FONT_ID=');
  const source = `${appJs.slice(constantsStart, appJs.indexOf(defaultMatch[0]) + defaultMatch[0].length)}\n${appJs.slice(appJs.indexOf('const SUPPORTED_LAYER_TYPES=new Set'), appJs.indexOf(validateMatch[0]) + validateMatch[0].length)}`;
  const { SHAPE_LIBRARY_KINDS } = await import('../src/geometry/index.js');
  const { getObjectTemplate, getPlateDefaults, normalizePlateParams, VESSEL_PRODUCT_IDS, getVesselDefaults, normalizeVesselParams, deriveLegacyVesselParams, computeCanvasFromVessel } = await import('../src/products/index.js');
  // eslint-disable-next-line no-new-func
  return new Function(
    'getObjectTemplate', 'SHAPE_LIBRARY_KINDS', 'getPlateDefaults', 'normalizePlateParams',
    'VESSEL_PRODUCT_IDS', 'getVesselDefaults', 'normalizeVesselParams', 'deriveLegacyVesselParams', 'computeCanvasFromVessel',
    `${source}\nreturn { validateProject, defaultProject };`
  )(getObjectTemplate, SHAPE_LIBRARY_KINDS, getPlateDefaults, normalizePlateParams, VESSEL_PRODUCT_IDS, getVesselDefaults, normalizeVesselParams, deriveLegacyVesselParams, computeCanvasFromVessel);
}

const IMAGE_LAYER = { id: 'image1', type: 'image', visible: true, imageSrc: 'data:image/png;base64,AAAA', imageName: 'a.png', naturalWidthPx: 256, naturalHeightPx: 248, x: 20, y: 30, w: 100, h: 97, maskMode: 'subject', threshold: 128, stoneSize: 2, gap: 0.3, colorCount: 'auto', vividness: 1.4, rotationDeg: 0, fillMode: 'staggered', invert: false, transparent: 'ignore', blurRadiusPx: 0, maxWidthPx: 400, maxHeightPx: 400 };

await test('T6. byte identity: a project without the new fields round-trips unchanged; the shrink write adds no key to other modes; aiStoneDetection:null changes no stones', async () => {
  const { validateProject, defaultProject } = await extractProjectFunctions();
  const p0 = validateProject({ ...defaultProject(), layers: [...defaultProject().layers, IMAGE_LAYER] });
  const p1 = validateProject(JSON.parse(JSON.stringify(p0)));
  assert.equal(JSON.stringify(p1), JSON.stringify(p0));
  assert.ok(p1.layers.every((l) => !('aiStoneShrink' in l)));

  const statement = "if(resolveImageFillMode(l.fillMode)==='ai-stones'||l.aiStoneShrink!==undefined)l.aiStoneShrink=resolveAiStoneShrink(Number(el('imgAiStoneShrink').value));";
  assert.ok(appJs.includes(statement), 'the guarded write statement is present verbatim');
  const resolveImageFillMode = (v) => (['fill', 'staggered', 'radial', 'contour', 'organic', 'edge', 'line-design', 'ai-stones'].includes(v) ? v : 'fill');
  const resolveAiStoneShrink = (v) => (v === 0.9 || v === 0.8 ? v : 1);
  const run = (l) => { new Function('l', 'el', 'resolveImageFillMode', 'resolveAiStoneShrink', statement)(l, () => ({ value: '0.9' }), resolveImageFillMode, resolveAiStoneShrink); return l; };
  assert.ok(!('aiStoneShrink' in run({ fillMode: 'staggered' })), 'no key for a staggered layer');
  assert.equal(run({ fillMode: 'ai-stones' }).aiStoneShrink, 0.9);
  assert.equal(run({ fillMode: 'staggered', aiStoneShrink: 1 }).aiStoneShrink, 0.9, 'an existing key keeps being written');

  const base = { imageBuffer: FIXTURE, layerId: 'L', xMm: 0, yMm: 0, widthMm: 40, heightMm: 38.75, stoneSizeMm: 2, gapMm: 0.3, mode: 'staggered', maxWidthPx: 400, maxHeightPx: 400, transparent: 'ignore', maskMode: 'subject', colorCount: 3, palette: PALETTE };
  const a = engine.generateImageLayout(base).stones.map((s) => [s.xMm, s.yMm, s.color]);
  const b = engine.generateImageLayout({ ...base, aiStoneDetection: null }).stones.map((s) => [s.xMm, s.yMm, s.color]);
  assert.ok(a.length > 0);
  assert.deepEqual(b, a);
  assert.throws(() => engine.generateImageLayout({ ...base, aiStoneDetection: 'x' }), TypeError);
});

// ---- T7. Engine --------------------------------------------------------------------------------

await test('T7. engine: ai-stones stones are stoneSize, catalogue colours; brightness/mixed/fill-gaps ignored; rotation applies; a passed detection is used', () => {
  const mm = 2.3 / DETECTION.pitchPx;
  const base = { imageBuffer: FIXTURE, layerId: 'L', xMm: 5, yMm: 5, widthMm: W * mm, heightMm: H * mm, stoneSizeMm: 2, gapMm: 0.3, mode: 'ai-stones', palette: PALETTE, aiStoneDetection: DETECTION };
  const layout = engine.generateImageLayout(base);
  assert.equal(layout.sourceMode, 'ai-stones');
  assert.ok(layout.stones.length > 200, `count ${layout.stones.length}`);
  assert.ok(layout.stones.every((s) => s.sizeMm === 2));
  assert.deepEqual([...new Set(layout.stones.map((s) => s.color))].sort(), ['gold', 'jet', 'sapphire']);
  const key = (l) => JSON.stringify(l.stones.map((s) => [s.xMm, s.yMm, s.sizeMm, s.color]));
  const same = [
    { sizeMode: 'brightness', brightnessSizesMm: [2, 2.8, 4] },
    { sizeMode: 'mixed', allowedSizesMm: [1.5, 2, 2.8] },
    { fillGaps: true },
    { threshold: 10, colorCount: 5, vividness: 1.6, maskMode: 'whole' }
  ];
  for (const extra of same) assert.equal(key(engine.generateImageLayout({ ...base, ...extra })), key(layout), JSON.stringify(extra));
  const rotated = engine.generateImageLayout({ ...base, rotationDeg: 30 });
  assert.equal(rotated.stones.length, layout.stones.length);
  assert.notEqual(key(rotated), key(layout));
  const withoutDetection = engine.generateImageLayout({ ...base, aiStoneDetection: undefined });
  assert.equal(key(withoutDetection), key(layout), 'the engine detects by itself when no detection is passed');
  const sapphireLab = catalogueLabs(PALETTE)[PALETTE.findIndex((p) => p.id === 'sapphire')];
  const forced = { ...DETECTION, stones: DETECTION.stones.map((s) => ({ ...s, lab: sapphireLab, jetLike: false })) };
  assert.deepEqual([...new Set(engine.generateImageLayout({ ...base, aiStoneDetection: forced }).stones.map((s) => s.color))], ['sapphire'], 'the passed detection is the one used');
});

// ---- T8. Tolerance against the reference -------------------------------------------------------

await test('T8. tolerance against the reference on the fixture: kept set within 1%, >= 95% colour agreement, palette/pitch/AI stones', () => {
  assert.equal(DETECTION.stones.length, 224);
  assert.ok(Math.abs(DETECTION.pitchPx / 16 - 1) <= 0.01, `pitch ${DETECTION.pitchPx}`);
  const ids = PALETTE.map((p) => p.id);
  assert.deepEqual(chooseAiStonePalette(DETECTION.stones.map((s) => s.lab), catalogueLabs(PALETTE)).map((k) => ids[k]), ['jet', 'sapphire', 'gold']);
  for (const shrink of [1.0, 0.8]) {
    const ref = REFERENCE_GRID[shrink];
    const mm = 2.3 / (16 / shrink);
    const points = [];
    for (let j = 0; j < ref.rows; j++) for (let k = 0; k < ref.cols; k++) points.push({ xMm: k * 2.3 + (j % 2 ? 1.15 : 0), yMm: j * 2.3 * Math.sqrt(3) / 2, code: ref.codes[j][k] });
    assert.equal(points.filter((p) => p.code !== '.').length, ref.total);
    const placed = placeAiStones({ detection: DETECTION, imageBuffer: FIXTURE, placement: { xMm: 0, yMm: 0, widthMm: W * mm, heightMm: H * mm }, stoneSizeMm: 2, gapMm: 0.3, palette: PALETTE, points });
    const byPos = new Map(placed.map((s) => [`${s.xMm},${s.yMm}`, s.color]));
    let keptDiff = 0, colourMatch = 0;
    for (const p of points) {
      const js = byPos.get(`${p.xMm},${p.yMm}`);
      if ((js !== undefined) !== (p.code !== '.')) keptDiff++;
      if (p.code !== '.' && js === CODE_ID[p.code]) colourMatch++;
    }
    assert.ok(keptDiff <= Math.floor(ref.total * 0.01), `shrink ${shrink}: kept set differs at ${keptDiff} points`);
    assert.ok(colourMatch / ref.total >= 0.95, `shrink ${shrink}: colour agreement ${(100 * colourMatch / ref.total).toFixed(1)}%`);
    console.log(`  shrink ${shrink}: kept-set differences ${keptDiff}, colour agreement ${(100 * colourMatch / ref.total).toFixed(1)}% (${colourMatch}/${ref.total})`);
  }
});

// ---- T9. Wiring --------------------------------------------------------------------------------

function extractFunction(marker) {
  const start = appJs.indexOf(marker);
  assert.ok(start !== -1, `expected ${marker}`);
  let depth = 0;
  for (let i = start + marker.length - 1; i < appJs.length; i++) {
    if (appJs[i] === '{') depth++;
    else if (appJs[i] === '}') { depth--; if (depth === 0) return appJs.slice(start, i + 1); }
  }
  throw new Error(`no closing brace for ${marker}`);
}

await test('T9. wiring: index.html controls and AI image view; renderImageStudio() counts and disabling; history; imports', () => {
  assert.match(indexHtml, /<label id="imageStudioViewAi" hidden><input type="radio" name="imageStudioView" value="ai">AI image<\/label>/);
  assert.ok(indexHtml.includes('.view-toggle label[hidden]{display:none}'));
  assert.ok(indexHtml.includes('<option value="ai-stones">'));
  assert.match(indexHtml, /<select id="imgAiStoneShrink"[^>]*><option value="1" selected>[^<]*<\/option><option value="0\.9">[^<]*<\/option><option value="0\.8">[^<]*<\/option><\/select>/);
  for (const id of ['imgAiStoneShrinkHint', 'imageRedrawStatusDetail']) assert.ok(indexHtml.includes(`id="${id}"`), id);

  const studio = extractFunction('async function renderImageStudio(){');
  assert.equal((studio.match(/ctx\.drawImage\(/g) || []).length, 2);
  assert.equal((studio.match(/drawInBox\(/g) || []).length, 3);
  assert.ok(studio.includes("for(const id of['imgColorCount','imgVividness','imgColorPick0','imgColorPick1','imgColorPick2','imgColorPick3','imgColorPick4','imgColorPick5','imgColorPick6','imgColorPick7']){el(id).disabled=isAiStones;el(id).title=aiStonesUnusedTitle}"));
  assert.ok(studio.includes("el('imageStudioViewAi').hidden=!l.redraw;"));

  const history = /const HISTORY_TRACKED_CONTROL_IDS=\[([^\]]*)\];/.exec(appJs);
  assert.ok(history && history[1].split(',').includes("'imgAiStoneShrink'"));
  assert.match(appJs, /^import \{[^}]*\bdetectAiStones\b[^}]*\} from '\.\/src\/image\/index\.js';$/m);
  assert.match(appJs, /^import \{[^}]*\bSHEET_MAX_MM\b[^}]*\} from '\.\/src\/products\/index\.js';$/m);
  assert.ok(appJs.includes("aiStoneDetection:mode==='ai-stones'?aiStoneDetectionFor(layer.imageSrc,buffer):null,...mixedSizeParamsFor(layer)}"));
  assert.ok(!appJs.includes('OpenAI'), 'app.js never names OpenAI');
});

await test('Registered in tools/test-groups.mjs', () => {
  assertTestRegistered({ filename: 'test-img-023-ai-stone-transfer.mjs', group: 'geometry', includedInDefault: true });
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed.`);
  process.exitCode = 1;
}
